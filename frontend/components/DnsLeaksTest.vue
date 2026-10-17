<template>
  <!-- DNS Leak Test -->
  <section class="mb-10">
    <!-- Header -->
    <header class="mb-2 flex flex-col items-start justify-between gap-4">
      <div class="flex flex-row items-center justify-between gap-4 w-full">
        <h2 id="DNSLeakTest"
          class="m-0 flex min-w-0 flex-1 items-center gap-2 text-xl md:text-3xl font-semibold tracking-tight leading-tight">
          🛑 {{ t('dnsleaktest.Title') }}
        </h2>
        <JnTooltip :text="t('Tooltips.RefreshDNSLeakTest')" side="left">
          <Button size="icon" variant="outline" class="shrink-0 cursor-pointer" @click="checkAllDNSLeakTest(true)"
            aria-label="Refresh DNS Leak Test">
            <component :is="isStarted ? RotateCw : Play" />
          </Button>
        </JnTooltip>
      </div>
      <div class="text-base text-muted-foreground">
        <p v-if="!isSimpleMode">{{ t('dnsleaktest.Note') }}</p>
      </div>
    </header>

    <!-- Card grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card v-for="(leak, index) in leakTest" :key="leak.slot"
        class="keyboard-shortcut-card jn-card min-w-0 overflow-hidden transition-transform duration-300 ease-out hover:-translate-y-1.5 data-[keyboard-hover=true]:ring-2 data-[keyboard-hover=true]:ring-focus-ring/60">
        <CardContent class="p-4 min-w-0">
          <!-- Top: heartbeat icon + name + index -->
          <div class="flex flex-col gap-2 mb-3 w-full min-w-0">
            <div class="flex items-center gap-2 min-w-0 w-full">
              <DoorOpen class="size-6 text-muted-foreground shrink-0" />
              <span class="text-base font-medium truncate min-w-0 flex-1">{{ leak.name }}</span>

              <span class="font-mono text-muted-foreground shrink-0">#{{ index + 1 }}</span>
            </div>
            <!-- Provider that actually answered (changes on fallback). -->
            <p class="w-full min-w-0 mb-1 text-xs font-mono text-muted-foreground truncate" :title="leak.providerName">
              {{ leak.providerName }}
            </p>
          </div>

          <!-- Endpoint status row -->
          <div class="flex items-center gap-1.5 mb-3 min-w-0 min-h-6">
            <span class="relative flex shrink-0">
              <span v-if="toneOf(leak) === 'wait'"
                class="absolute inline-flex size-2 rounded-full bg-info opacity-75 animate-ping"></span>
              <span class="relative inline-flex size-2 rounded-full" :class="dotClass(toneOf(leak))"></span>
            </span>
            <FitText :text="leak.ip" :tiers="INLINE_TIERS" :title="leak.ip" class="font-mono min-w-0"
              :class="textClass(toneOf(leak))" :data-mask="maskAttr(leak.ip)" />
          </div>

          <!-- ISP + Country sub-block -->
          <dl class="rounded-md bg-muted/50 p-3 space-y-2 text-sm">
            <div>
              <dt class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <EthernetPort class="size-3.5" />
                <span>{{ t('ipInfos.ISP') }}</span>
              </dt>
              <dd class="font-medium wrap-break-word" :title="leak.org">
                <span v-if="!isFieldPending(leak.org)">{{ leak.org }}</span>
                <span v-else class="text-muted-foreground font-normal">—</span>
              </dd>
            </div>
            <div>
              <dt class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <MapPin class="size-3.5" />
                <span>{{ t('dnsleaktest.EndpointCountry') }}</span>
              </dt>
              <dd class="font-medium flex items-center gap-1.5 flex-wrap">
                <template v-if="!isFieldPending(leak.country)">
                  <Icon v-if="leak.country_code" :icon="'circle-flags:' + leak.country_code.toLowerCase()"
                    class="shrink-0 size-4" />
                  <span class="wrap-break-word">{{ leak.country }}</span>
                </template>
                <span v-else class="text-muted-foreground font-normal">—</span>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>

    <TestRunLog :log="testLog" />

    <!-- Section banner slot (data-driven; see InfoBanner.vue); settled once
         the homepage test has resolved (success or timeout). -->
    <InfoBanner section="dnsleak" :settled="hasEverSettled" />
  </section>
</template>


<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import { useMainStore } from '@/store';
import { useI18n } from 'vue-i18n';
import { trackEvent } from '@/utils/analytics';
import { emitAppEvent, waitForAppEvent } from '@/utils/app-events';
import { useAppCommand } from '@/composables/use-app-command.js';
import { JnTooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useStatusTone, ipFieldTone, isFieldPending as isFieldPendingShared } from '@/composables/use-status-tone.js';
import { createMaskGate } from '@/composables/use-info-mask.js';
import { useMaxmind } from '@/composables/use-maxmind.js';
import { EthernetPort, Play, MapPin, RotateCw, DoorOpen } from '@lucide/vue';
import { Icon } from '@iconify/vue';
import FitText from '@/components/widgets/FitText.vue';
import InfoBanner from '@/components/widgets/InfoBanner.vue';
import { INLINE_TIERS } from '@/composables/use-fit-text.js';
import {
  ipApi, bashws, myipstack, fastly, browserleaks, surfshark, ipleak,
  createDnsLeakRunner,
} from '@/utils/dnsleaks';
import { readTrace } from '@/composables/use-ai-egress.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { useTestLog, dnsLeakVerdict, traceOutcome } from '@/composables/use-test-log.js';
import TestRunLog from '@/components/widgets/TestRunLog.vue';

// All providers in priority order: the first SLOT_COUNT hold a card each,
// the rest are standbys. New provider = file under utils/dnsleaks + append.
const PROVIDERS = [ipApi, surfshark, myipstack, fastly, bashws, browserleaks, ipleak];
const SLOT_COUNT = 4;
const ACTIVE = PROVIDERS.slice(0, SLOT_COUNT);


const { t } = useI18n();
const store = useMainStore();
const { lookupMaxmind } = useMaxmind();
// Skip the info-mask blur on waiting/error placeholders (not a real IP).
const maskAttr = createMaskGate(t);
const isStarted = ref(false);
const userPreferences = computed(() => store.userPreferences);
const isSimpleMode = computed(() => userPreferences.value.simpleMode);
// Sticky settled flag for the section's banner slot.
const hasEverSettled = ref(false);
let runId = 0;
// Test-process log: every provider's DNS probe, each geo lookup, and the HTTP exit
// the resolvers are compared with (verdict rules: use-test-log.js dnsLeakVerdict).
const testLog = useTestLog('dnsleak');
// The address HTTP leaves from, with its country — a Cloudflare echo, the same
// one the IP cards ask first.
const EGRESS_HOST = '1.0.0.1';

const { dotClass, textClass } = useStatusTone();

// Business status → 4 tone levels
const toneOf = (leak) => ipFieldTone(leak.ip, {
  waitLabels: [t('dnsleaktest.StatusWait'), t('dnsleaktest.StatusTesting')],
  errorLabels: t('dnsleaktest.StatusError'),
});


// Status
const isFieldPending = (value) => isFieldPendingShared(value, {
  waitLabels: [t('dnsleaktest.StatusWait'), t('dnsleaktest.StatusTesting')],
  errorLabels: t('dnsleaktest.StatusError'),
});

const createDefaultCard = () => ({
  name: t('dnsleaktest.Name'),
  country_code: '',
  country: t('dnsleaktest.StatusWait'),
  ip: t('dnsleaktest.StatusWait'),
  org: t('dnsleaktest.StatusWait'),
});

// `slot` is the card's stable key; `id` / `providerName` follow the
// provider that actually answered.
const leakTest = reactive(ACTIVE.map((p) => ({
  ...createDefaultCard(),
  slot: p.id,
  id: p.id,
  providerName: p.name,
})));

// Apply MaxMind lookup to a card that already has a resolved leak IP.
const applyMaxMindGeo = async (index, ip, currentRun) => {
  const geo = await testLog.timed(
    { kind: 'geo', target: ip, endpoint: `/api/maxmind?ip=${ip}`, protocol: 'HTTPS GET' },
    () => lookupMaxmind(ip),
    (g) => (g ? { result: 'ok', value: [g.country_code, g.country, g.org].filter(Boolean).join(' · ') } : { result: 'fail', error: 'no geolocation answer (source unavailable or address unknown)' }),
  );
  if (currentRun !== runId) return;
  if (geo) {
    leakTest[index].country_code = geo.country_code;
    leakTest[index].country = geo.country;
    leakTest[index].org = geo.org;
    return;
  }
  leakTest[index].country = t('dnsleaktest.StatusError');
  leakTest[index].country_code = '';
  leakTest[index].org = t('dnsleaktest.StatusError');
};

const markLeakCardError = (index) => {
  leakTest[index].ip = t('dnsleaktest.StatusError');
  leakTest[index].country = t('dnsleaktest.StatusError');
  leakTest[index].country_code = '';
  leakTest[index].org = t('dnsleaktest.StatusError');
};

// Run one slot through its fallback chain (see utils/dnsleaks); the card
// flips to error only when the whole chain fails.
const runProvider = async (index, run, currentRun) => {
  if (currentRun !== runId) return;
  try {
    const { ip, provider } = await run(index);
    if (currentRun !== runId) return;
    leakTest[index].id = provider.id;
    leakTest[index].providerName = provider.name;
    leakTest[index].ip = ip;
    await applyMaxMindGeo(index, ip, currentRun);
  } catch (error) {
    if (currentRun !== runId) return;
    console.error('Error fetching leak test data:', error);
    markLeakCardError(index);
  }
};

// Check all. Staggers startup by 200ms per provider to avoid a thundering-
// herd on first paint.
const checkAllDNSLeakTest = async (isRefresh) => {
  const currentRun = ++runId;
  testLog.begin({ providers: PROVIDERS.map((p) => p.name).join(', '), slots: SLOT_COUNT });
  const egress = testLog.timed(
    { kind: 'egress', target: 'Cloudflare', endpoint: `https://${EGRESS_HOST}/cdn-cgi/trace`, protocol: 'HTTPS GET' },
    () => readTrace(EGRESS_HOST),
    traceOutcome,
  ).catch(() => null);
  // Every resolver address any provider reported this run, card or standby.
  const resolverIps = new Set();
  const run = createDnsLeakRunner(PROVIDERS, SLOT_COUNT, {
    // Each provider's DNS probe as one step: a unique hostname whose lookup the
    // provider's authoritative server records, then an HTTPS fetch that reads
    // back which resolver asked.
    wrap: (provider, probe) => testLog.timed(
      { kind: 'dns', target: provider.name, endpoint: provider.endpoint || null, protocol: 'DNS → HTTPS GET' },
      probe,
      (answer) => {
        if (answer?.ip) resolverIps.add(answer.ip);
        return { result: 'ok', value: answer?.ip, raw: answer };
      },
    ),
  });
  isStarted.value = true;
  if (isRefresh) trackEvent('Section', 'RefreshClick', 'DNSLeakTest');
  // Every run starts from the primary provider and "Testing…" — on boot
  // this is a no-op for the slot, on refresh it drops the fallback result.
  leakTest.forEach((server, index) => {
    server.id = ACTIVE[index].id;
    server.providerName = ACTIVE[index].name;
    server.ip = t('dnsleaktest.StatusTesting');
    server.country = t('dnsleaktest.StatusTesting');
    server.country_code = '';
    server.org = t('dnsleaktest.StatusTesting');
  });

  const delayedRun = (index, delay) => new Promise((resolve) => {
    setTimeout(() => {
      runProvider(index, run, currentRun).then(resolve, resolve);
    }, delay);
  });

  const promises = ACTIVE.map((_, index) => delayedRun(index, index * 200));

  const allSettledPromise = Promise.allSettled(promises);
  // The log closes on the real end of the run, not the cards' 6 s race: a slow
  // provider's answer belongs in the record even after the cards moved on.
  Promise.all([allSettledPromise, egress]).then(async ([, trace]) => {
    if (currentRun !== runId) return;
    const resolvers = [...resolverIps].map((ip) => ({
      ip,
      country_code: leakTest.find((card) => card.ip === ip)?.country_code || '',
    }));
    // A resolver the cards could not place (no MaxMind database, or a standby
    // that never had a card) is asked the key-free /api/ipsb source once, for the
    // verdict only — the cards keep their own source.
    await Promise.all(resolvers.filter((r) => !r.country_code).map(async (r) => {
      const geo = await testLog.timed(
        { kind: 'geo', target: r.ip, endpoint: `/api/ipsb?ip=${r.ip}`, protocol: 'HTTPS GET', note: t('testlog.note.geoFallback') },
        () => fetchWithTimeout(`/api/ipsb?ip=${encodeURIComponent(r.ip)}`).then((res) => (res.ok ? res.json() : null)),
        (g) => (g?.country_code ? { result: 'ok', value: [g.country_code, g.org].filter(Boolean).join(' · ') } : { result: 'fail', error: 'no geolocation answer' }),
      ).catch(() => null);
      if (geo?.country_code) r.country_code = geo.country_code;
    }));
    if (currentRun !== runId) return;
    testLog.finish(dnsLeakVerdict({
      resolvers,
      egressCountry: trace?.state === 'answered' ? trace.loc || '' : '',
    }));
  });
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 6000));

  return Promise.race([allSettledPromise, timeoutPromise]).then(() => {
    if (currentRun !== runId) return;
    store.setLoadingStatus('DNSLeakTest', true);
    // Local sticky flag for the Enhanced DNS Leak Test banner
    hasEverSettled.value = true;
    // Domain event: snapshot for the report collector (cards whose ip slot
    // still holds a wait/error label are dropped by the builder).
    emitAppEvent('dnsleak:finished', {
      providers: leakTest.map((card) => ({
        id: card.id,
        name: card.providerName,
        ip: card.ip,
        country_code: card.country_code,
        org: card.org,
      })),
    });
  });
};

// Command owner: run all leak providers. Resolves with the next
// dnsleak:finished snapshot.
useAppCommand('dnsleak:run', ({ isRefresh = false } = {}) => {
  const finished = waitForAppEvent('dnsleak:finished');
  checkAllDNSLeakTest(isRefresh);
  return finished;
});

onMounted(() => {
  store.setMountingStatus('DNSLeakTest', true);
});
</script>
