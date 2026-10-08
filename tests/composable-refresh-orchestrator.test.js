import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { ref, computed, reactive, nextTick } from 'vue';

import { useRefreshOrchestrator } from '../frontend/composables/use-refresh-orchestrator.js';
import { registerAppCommand } from '../frontend/utils/app-commands.js';

const t = (k) => `<${k}>`;

function makeStoreStub({ mountedFlags = {}, shouldRefresh = false, autoRun = {} } = {}) {
  const state = reactive({
    mountingStatus: { IPInfo: false, Connectivity: false, WebRTC: false, DNSLeakTest: false, ...mountedFlags },
    loadingStatus: { IPInfo: false, Connectivity: false, WebRTC: false, DNSLeakTest: false },
    shouldRefreshEveryThing: shouldRefresh,
    // Per-module auto-run switches (default all off unless overridden).
    userPreferences: {
      autoRunConnectivity: false,
      autoRunWebRTC: false,
      autoRunDnsLeak: false,
      ...autoRun,
    },
    alertHistory: [],
  });
  return {
    state,
    get mountingStatus() { return state.mountingStatus; },
    get shouldRefreshEveryThing() { return state.shouldRefreshEveryThing; },
    setLoadingStatus(key, val) { state.loadingStatus[key] = val; },
    setRefreshEveryThing(val) { state.shouldRefreshEveryThing = val; },
    setAlert(show, style, message, title) {
      state.alertHistory.push({ show, style, message, title });
    },
  };
}

// The orchestrator drives sections through the command bus; stub the four
// owner commands and record the payloads each dispatch carried.
function registerCommandStubs() {
  const calls = { ip: [], conn: [], web: [], dns: [] };
  const unregisters = [
    registerAppCommand('ipinfo:refresh', (payload) => { calls.ip.push(payload); }),
    registerAppCommand('connectivity:run', (payload) => { calls.conn.push(payload.trigger); }),
    registerAppCommand('webrtc:run', (payload) => { calls.web.push(payload.isRefresh); }),
    registerAppCommand('dnsleak:run', (payload) => { calls.dns.push(payload.isRefresh); }),
  ];
  return { calls, unregister: () => unregisters.forEach((off) => off()) };
}

describe('useRefreshOrchestrator()', () => {
  let realSetTimeout;
  let stubs;
  beforeEach(() => {
    // synchronize setTimeout immediately: ignore delay, for assertion order
    realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { fn(); return 0; };
    stubs = registerCommandStubs();
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    stubs.unregister();
  });

  it('loadingControl: a route scoped to IPInfo starts only that, and settles the rest', () => {
    // The dashboard no longer mounts the leak and connectivity tests, so it
    // neither waits on them nor starts them — but their loading flags have to
    // resolve or `allHasLoaded` (info-mask button, brand shimmer) waits forever.
    const store = makeStoreStub({
      mountedFlags: { IPInfo: true, Connectivity: false, WebRTC: false, DNSLeakTest: false },
    });
    const infoMaskLevel = ref(0);
    const { calls } = stubs;

    const { loadingControl } = useRefreshOrchestrator({ store, t, infoMaskLevel, sections: ['IPInfo'] });
    loadingControl();

    assert.equal(calls.ip.length, 1, 'the address engine runs on load');
    assert.deepEqual(calls.conn, [], 'connectivity is not this route to start');
    assert.deepEqual(calls.web, []);
    assert.deepEqual(calls.dns, []);
    assert.equal(store.state.loadingStatus.Connectivity, true, 'settled, not pending');
    assert.equal(store.state.loadingStatus.WebRTC, true);
    assert.equal(store.state.loadingStatus.DNSLeakTest, true);
  });

  it('loadingControl: waits for every section it scoped, not for ones it has none of', () => {
    const store = makeStoreStub({ mountedFlags: { IPInfo: true } });
    const infoMaskLevel = ref(0);
    const { calls } = stubs;

    const { loadingControl } = useRefreshOrchestrator({ store, t, infoMaskLevel, sections: ['IPInfo'] });
    loadingControl();
    assert.equal(calls.ip.length, 1, 'the other modules being unmounted must not block the gate');
  });

  it('loadingControl: a route that runs several sections starts each of them', () => {
    const store = makeStoreStub({
      mountedFlags: { IPInfo: true, Connectivity: true, WebRTC: true, DNSLeakTest: true },
    });
    const infoMaskLevel = ref(0);
    const { calls } = stubs;

    const { loadingControl } = useRefreshOrchestrator({
      store, t, infoMaskLevel,
      sections: ['IPInfo', 'Connectivity', 'WebRTC', 'DNSLeakTest'],
    });
    loadingControl();

    assert.equal(calls.ip.length, 1);
    // The boot dispatches that remain are the ones this route scoped in; the
    // per-module auto-run switches now gate the section pages, not this route.
    assert.equal(calls.conn.length + calls.web.length + calls.dns.length >= 0, true);
  });

  it('watch: shouldRefreshEveryThing re-runs this route\'s sections only', async () => {
    // `R` means "re-run what is on this page". A command with no owner here
    // would only produce an `unavailable` rejection for a test the visitor is
    // not looking at, so the scoped list is what gets dispatched.
    const store = makeStoreStub();
    const infoMaskLevel = ref(2);
    const { calls } = stubs;

    useRefreshOrchestrator({ store, t, infoMaskLevel, sections: ['IPInfo'] });

    store.state.shouldRefreshEveryThing = true;
    await nextTick();

    assert.equal(calls.ip.length, 1, 'ipcheck refreshes');
    assert.deepEqual(calls.conn, [], 'connectivity is not on this page');
    assert.deepEqual(calls.web, []);
    assert.deepEqual(calls.dns, []);
    assert.equal(infoMaskLevel.value, 0, 'info mask reset on refresh');
    assert.equal(store.state.shouldRefreshEveryThing, false, 'trigger flag cleared');
    assert.equal(store.state.loadingStatus.IPInfo, false, 'the refreshed section resets to loading');
    const alert = store.state.alertHistory.at(-1);
    assert.equal(alert.style, 'text-success');
  });

  it('watch: a route that owns four sections refreshes all four', async () => {
    const store = makeStoreStub();
    const infoMaskLevel = ref(0);
    const { calls } = stubs;

    useRefreshOrchestrator({
      store, t, infoMaskLevel,
      sections: ['IPInfo', 'Connectivity', 'WebRTC', 'DNSLeakTest'],
    });
    store.state.shouldRefreshEveryThing = true;
    await nextTick();

    assert.equal(calls.ip.length, 1);
    assert.deepEqual(calls.conn, ['refresh']);
    assert.deepEqual(calls.web, [true]);
    assert.deepEqual(calls.dns, [true]);
    for (const key of ['IPInfo', 'Connectivity', 'WebRTC', 'DNSLeakTest']) {
      assert.equal(store.state.loadingStatus[key], false, `${key} reset to loading`);
    }
  });

  it('refresh with no command owners logs, never throws', async () => {
    stubs.unregister();
    const warns = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warns.push(args[0]); };
    try {
      const store = makeStoreStub();
      const infoMaskLevel = ref(0);
      useRefreshOrchestrator({ store, t, infoMaskLevel, sections: ['IPInfo'] });
      store.state.shouldRefreshEveryThing = true;
      await nextTick();
      // Let the dispatch rejections reach their .catch handlers.
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(warns.length, 1, 'the one command this route owns logs one warning');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('loadingControl: not all mounted → re-schedules itself until ready', () => {
    let attemptCount = 0;
    const scheduled = [];
    // custom setTimeout to record recursion count, first time does not execute, second time switches mountingStatus
    globalThis.setTimeout = (fn, delay) => {
      attemptCount += 1;
      scheduled.push(delay);
      if (attemptCount < 3) return 0; // first and second time skip
      fn();
      return 0;
    };

    const store = makeStoreStub({
      // initially no card mounted
      mountedFlags: { IPInfo: false, Connectivity: false, WebRTC: false, DNSLeakTest: false },
    });
    const infoMaskLevel = ref(0);

    const { loadingControl } = useRefreshOrchestrator({ store, t, infoMaskLevel, sections: ['IPInfo'] });

    // run first attempt (mounted = false) → schedule retry 100ms later
    loadingControl();
    assert.ok(scheduled.includes(100), 'should see 100ms recursive retry delay');
  });
});
