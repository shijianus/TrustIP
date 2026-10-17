<template>
  <section class="mb-10">
    <!-- Header -->
    <header class="mb-2 flex flex-col items-start justify-between gap-4">
      <div class="flex flex-row items-center justify-between gap-4 w-full">
        <h2 id="WebRTC"
          class="m-0 flex min-w-0 flex-1 items-center gap-2 text-xl md:text-3xl font-semibold tracking-tight leading-tight">
          🚱 {{ t('webrtc.Title') }}
        </h2>
        <JnTooltip :text="t('Tooltips.RefreshWebRTC')" side="left">
          <Button size="icon" variant="outline" class="shrink-0 cursor-pointer" @click="checkAllWebRTC(true)"
            aria-label="Refresh WebRTC Test">
            <component :is="isStarted ? RotateCw : Play" />
          </Button>
        </JnTooltip>
      </div>
      <div class="text-base text-muted-foreground">
        <p v-if="!isSimpleMode">{{ t('webrtc.Note') }}</p>
      </div>
    </header>

    <!-- Card grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card v-for="(stun, index) in stunServers" :key="stun.id"
        class="keyboard-shortcut-card jn-card min-w-0 overflow-hidden transition-transform duration-300 ease-out hover:-translate-y-1.5 data-[keyboard-hover=true]:ring-2 data-[keyboard-hover=true]:ring-focus-ring/60">
        <CardContent class="p-4 min-w-0">
          <!-- Top: service provider icon + name -->
          <div class="flex flex-col gap-2 mb-1 w-full min-w-0">
            <div class="flex items-center gap-2 min-w-0 w-full">
            <Flower class="size-6 text-muted-foreground shrink-0" />
            <span class="text-base font-medium truncate min-w-0 flex-1">{{ t('webrtc.Name') }}</span>
            <span class="font-mono text-muted-foreground shrink-0">#{{ index + 1 }}</span>
          </div>

          <!-- STUN URL (secondary information) -->
          <p v-if="stun.url" class="w-full min-w-0 mb-1 text-xs font-mono text-muted-foreground truncate" :title="stun.url">
            {{ stun.url }}
          </p>
          </div>

          <!-- IP -->
          <div class="flex items-center gap-1.5 text-base mb-3 min-w-0 min-h-6">
            <span class="relative flex shrink-0">
              <span v-if="toneOf(stun) === 'wait'"
                class="absolute inline-flex size-2 rounded-full bg-info opacity-75 animate-ping"></span>
              <span class="relative inline-flex size-2 rounded-full" :class="dotClass(toneOf(stun))"></span>
            </span>
            <FitText :text="stun.ip" :tiers="INLINE_TIERS" :title="stun.ip" class="font-mono min-w-0"
              :class="textClass(toneOf(stun))" :data-mask="maskAttr(stun.ip)" />
          </div>

          <!-- NAT + ISP + Country -->
          <dl v-if="stun.natType" class="rounded-md bg-muted/50 p-3 space-y-2 text-sm">
            <div>
              <dt class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Network class="size-3.5" />
                <span>NAT</span>
              </dt>
              <dd class="font-medium wrap-break-word">
                <span v-if="!isFieldPending(stun.natType)">{{ stun.natType }}</span>
                <span v-else class="text-muted-foreground font-normal">—</span>
              </dd>
            </div>
            <div>
              <dt class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <EthernetPort class="size-3.5" />
                <span>{{ t('ipInfos.ISP') }}</span>
              </dt>
              <dd class="font-medium wrap-break-word" :title="stun.org">
                <span v-if="!isFieldPending(stun.org)">{{ stun.org }}</span>
                <span v-else class="text-muted-foreground font-normal">—</span>
              </dd>
            </div>
            <div>
              <dt class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <MapPin class="size-3.5" />
                <span>{{ t('ipInfos.Country') }}</span>
              </dt>
              <dd class="font-medium flex items-center gap-1.5 flex-wrap">
                <template v-if="!isFieldPending(stun.country)">
                  <Icon v-if="stun.country_code" :icon="'circle-flags:' + stun.country_code" class="shrink-0 size-4" />
                  <span class="wrap-break-word">{{ stun.country }}</span>
                </template>
                <span v-else class="text-muted-foreground font-normal">—</span>
              </dd>
            </div>
          </dl>

          <!-- SDP / ICE event log -->
          <Collapsible v-if="stun.sdpLog.length" v-model:open="stun.sdpOpen" class="mt-3 flex flex-col">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" class="self-end text-xs text-muted-foreground cursor-pointer"
                :aria-expanded="stun.sdpOpen" :aria-label="`${t('webrtc.SdpLog')} (${stun.sdpLog.length})`">
                <span class="inline-flex items-center gap-1.5">
                  <FileText class="size-3.5" />
                  <span>{{ t('webrtc.SdpLog') }}</span>
                  <span class="tabular-nums opacity-70">({{ stun.sdpLog.length }})</span>
                </span>
                <ChevronDown class="size-3.5 shrink-0 transition-transform duration-200"
                  :class="stun.sdpOpen ? 'rotate-180' : ''" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="relative mt-2">
                <pre
                  class="p-4 pr-8 rounded-md bg-muted/50 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">{{ stun.sdpLog.join('\n') }}</pre>
                <CopyButton :value="() => stun.sdpLog.join('\n')" :tooltip="t('Tooltips.CopySdpLog')"
                  class="absolute top-2 right-2" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>

    <!-- Every address this browser hands out, not only the one a STUN server
         reflected. The cards above answer "did the network say who I am"; this table
         answers the broader question a visitor compares against browserleaks-style
         results — what does each ICE path leak, including the interface addresses the
         browser emits whether or not any server replied. A `host` row is therefore
         never counted as a leak, and the verdict row says which kinds appeared. -->
    <div class="mt-4 jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('webrtc.CandTitle')">
        <template #aside>
          <VerdictChip
            v-if="candState === 'done'"
            :tone="candTone"
            :label="candVerdict"
          />
          <span v-else-if="candState === 'running'" class="text-xs text-muted-foreground">{{ t('webrtc.StatusTesting') }}</span>
        </template>
      </SectionTitle>

      <div v-if="candidates.length" class="overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b text-start">
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('webrtc.CandColType') }}</th>
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('webrtc.CandColAddress') }}</th>
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('webrtc.CandColScope') }}</th>
              <th scope="col" class="py-2 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('webrtc.CandColPath') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in candidates" :key="`${row.raw}-${i}`" class="border-b last:border-0">
              <td class="py-2 pe-3 whitespace-nowrap">{{ t(`webrtc.NATType.${row.type}`) }}</td>
              <td class="py-2 pe-3 min-w-0">
                <span class="break-all font-mono text-xs">{{ row.address || '—' }}</span>
              </td>
              <td class="py-2 pe-3">
                <VerdictChip
                  :tone="row.public ? 'warn' : 'muted'"
                  :label="row.public ? t('webrtc.CandPublic') : t('webrtc.CandPrivate')"
                />
              </td>
              <td class="py-2 text-xs font-normal text-muted-foreground">
                {{ [row.protocol, row.port].filter(Boolean).join(' · ') || '—' }}
                <span class="whitespace-nowrap"> · {{ t('webrtc.CandVia', { url: candServer }) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else-if="candState === 'done'" class="text-sm leading-relaxed text-muted-foreground">
        {{ t('webrtc.CandNone') }}
      </p>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ t('webrtc.CandNote') }}</p>
    </div>

    <!-- Per-server probe matrix: every candidate each STUN server produced, the way
         a visitor compares against other leak-test sites (#, address, type, family,
         location, status). The cards above keep their one-answer-per-server shape;
         this is the evidence under them, and the test-process log below carries
         the same rows with timing and raw lines. -->
    <div v-if="probeRows.length || probeState === 'running'" class="mt-4 jn-card rounded-[var(--radius)] p-4"
      data-webrtc-probe-matrix>
      <SectionTitle :title="t('testlog.webrtc.MatrixTitle')">
        <template #aside>
          <span v-if="probeState === 'running'" class="text-xs text-muted-foreground">{{ t('webrtc.StatusTesting') }}</span>
        </template>
      </SectionTitle>
      <!-- Narrow screens: one block per candidate, so a 40-character mDNS name
           never squeezes the other columns into one letter per line. -->
      <ul class="md:hidden rounded-md border divide-y text-sm">
        <li v-for="(row, i) in probeRows" :key="`m-${row.server}-${i}`" class="p-2.5 min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-mono text-xs text-muted-foreground">#{{ i + 1 }}</span>
            <span class="font-medium">{{ row.server }}</span>
            <span class="ms-auto"><VerdictChip :tone="row.tone" :label="row.status" /></span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            <span class="font-mono">{{ row.type || '—' }}</span>
            <template v-if="row.family"> · {{ t(`testlog.family.${row.family}`) }}</template>
            <template v-if="row.protocol"> · {{ row.protocol }}</template>
            <span class="block font-mono break-all">{{ row.url }}</span>
          </p>
          <p class="mt-1 font-mono text-xs break-all">{{ row.address || '—' }}</p>
          <p v-if="row.location" class="mt-1 text-xs text-muted-foreground">{{ row.location }}</p>
        </li>
      </ul>
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b text-start">
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">#</th>
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('testlog.webrtc.ColServer') }}</th>
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('webrtc.CandColAddress') }}</th>
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('webrtc.CandColType') }}</th>
              <th scope="col" class="py-2 pe-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('testlog.webrtc.ColLocation') }}</th>
              <th scope="col" class="py-2 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ t('testlog.webrtc.ColStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in probeRows" :key="`${row.server}-${i}`" class="border-b last:border-0 align-top">
              <td class="py-2 pe-3 font-mono text-xs text-muted-foreground">{{ i + 1 }}</td>
              <td class="py-2 pe-3 text-xs">
                <span class="font-medium">{{ row.server }}</span>
                <span class="block font-mono text-muted-foreground break-all">{{ row.url }}</span>
              </td>
              <td class="py-2 pe-3"><span class="break-all font-mono text-xs">{{ row.address || '—' }}</span></td>
              <td class="py-2 pe-3 text-xs whitespace-nowrap">
                <span class="font-mono">{{ row.type || '—' }}</span>
                <span v-if="row.family" class="block text-muted-foreground">{{ t(`testlog.family.${row.family}`) }}<template v-if="row.protocol"> · {{ row.protocol }}</template></span>
              </td>
              <td class="py-2 pe-3 text-xs">{{ row.location || '—' }}</td>
              <td class="py-2">
                <VerdictChip :tone="row.tone" :label="row.status" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ t('testlog.webrtc.MatrixNote') }}</p>
    </div>

    <TestRunLog :log="testLog" default-open />

    <!-- Section banner slot (data-driven; see InfoBanner.vue) -->
    <InfoBanner section="webrtc" :settled="hasEverSettled" />
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive, watch } from 'vue';
import { useMainStore } from '@/store';
import { useI18n } from 'vue-i18n';
import { trackEvent } from '@/utils/analytics';
import { emitAppEvent, waitForAppEvent } from '@/utils/app-events';
import { useAppCommand } from '@/composables/use-app-command.js';
import { JnTooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useStatusTone, ipFieldTone, isFieldPending as isFieldPendingShared } from '@/composables/use-status-tone.js';
import { createMaskGate } from '@/composables/use-info-mask.js';
import { useMaxmind } from '@/composables/use-maxmind.js';
import { STUN_SERVERS, gatherStunCandidate, gatherAllCandidates, natTypeCodeOf, probeServers } from '@/utils/webrtc-ice.js';
import { cloudflareV4 } from '@/utils/getips/cloudflare-v4.js';
import { cloudflareV6 } from '@/utils/getips/cloudflare-v6.js';
import { useTestLog, describeCandidate, webrtcVerdict } from '@/composables/use-test-log.js';
import TestRunLog from '@/components/widgets/TestRunLog.vue';
import { isUsablePublicIP } from '@/utils/valid-ip.js';
import { Play, MapPin, EthernetPort, Flower, Network, RotateCw, FileText, ChevronDown } from '@lucide/vue';
import { Icon } from '@iconify/vue';
import FitText from '@/components/widgets/FitText.vue';
import CopyButton from '@/components/widgets/CopyButton.vue';
import InfoBanner from '@/components/widgets/InfoBanner.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import { INLINE_TIERS } from '@/composables/use-fit-text.js';

const { t } = useI18n();
const store = useMainStore();
const userPreferences = computed(() => store.userPreferences);
// Skip the info-mask blur on waiting/error placeholders (not a real IP).
const maskAttr = createMaskGate(t);
const isSimpleMode = computed(() => userPreferences.value.simpleMode);
const { dotClass, textClass } = useStatusTone();
const { lookupMaxmind } = useMaxmind();

const isStarted = ref(false);
// Sticky settled flag for the section's banner slot: true once a full STUN
// pass finishes (including the WebRTC-unavailable path).
const hasEverSettled = ref(false);
const IPArray = ref([]);
// The card state, seeded from the shared server list so the homepage's quiet pass
// and this section cannot drift apart on which STUN servers count.
const stunServers = reactive(STUN_SERVERS.map((server) => ({
  ...server,
  ip: t('webrtc.StatusWait'), natType: t('webrtc.StatusWait'), country: t('webrtc.StatusWait'),
  country_code: '', org: t('webrtc.StatusWait'), sdpLog: [], sdpOpen: false,
})));

// WebRTC can be absent entirely: privacy-hardened browsers.
const isWebRtcAvailable = typeof RTCPeerConnection === 'function';

// The candidate enumeration asks one server, not all four: a `host` candidate is the
// browser repeating its own interfaces, so every pass would report the same list, and
// four peer connections for one finding is four times the UDP for nothing new.
const candServer = STUN_SERVERS[0].url;
const candidates = ref([]);
const candState = ref('idle');

const runCandidateGather = (signal) => {
  candidates.value = [];
  candState.value = 'running';
  return gatherAllCandidates(candServer, { signal, timeoutMs: 6000 }).then((result) => {
    if (result.reason === 'aborted') return;
    candidates.value = (result.candidates || []).map((row) => ({
      ...row,
      public: Boolean(row.ip) && isUsablePublicIP(row.ip),
    }));
    candState.value = 'done';
    // Same recorder the cards use: an address this browser gave out is an address the
    // visitor may want looked up later, and the IP page it links to is the only place
    // that says what it is. A `host` address is excluded — it is a LAN name, not
    // something the internet can see.
    const fresh = candidates.value.filter((row) => row.public && row.ip);
    if (fresh.length) {
      IPArray.value = [...IPArray.value, ...fresh.map((row) => ({ ip: row.ip, country: '' }))];
    }
  });
};

// The verdict is about the reflection, not the interface address: a `host` row is
// this machine's own LAN name and every browser emits it, while an address a server
// said back is the finding the cards above already report. Both are listed, because
// the point of this table is to show what each path produced.
const candTone = computed(() => {
  if (!candidates.value.length) return 'muted';
  return candidates.value.some((row) => row.public) ? 'warn' : 'ok-fast';
});

const candVerdict = computed(() => {
  if (!candidates.value.length) return t('webrtc.CandNone');
  const publicCount = candidates.value.filter((row) => row.public).length;
  return publicCount
    ? t('webrtc.CandPublicSeen', { n: publicCount })
    : t('webrtc.CandPrivateOnly');
});

// ── Test-process log + probe matrix ───────────────────────────────────────────
// Every server in the probe list gets one full gathering pass (all candidate types,
// not only the first reflexive one), and HTTP is asked where it exits, so the
// verdict can compare the two. The verdict rules live in use-test-log.js
// (`webrtcVerdict`) where they are unit-tested.
const testLog = useTestLog('webrtc');
const probeRows = ref([]);
const probeState = ref('idle');

const familyLabel = (c) => c.family;

const candidateStatus = (c) => {
  if (c.type === 'srflx' || c.type === 'prflx') {
    return c.public
      ? { tone: 'warn', status: t('testlog.webrtc.StatusPublic') }
      : { tone: 'info', status: t('testlog.webrtc.StatusPrivateReflexive') };
  }
  if (c.family === 'mdns') return { tone: 'ok', status: t('testlog.webrtc.StatusMdns') };
  if (c.type === 'relay') return { tone: 'muted', status: t('testlog.webrtc.StatusRelay') };
  return c.public
    ? { tone: 'warn', status: t('testlog.webrtc.StatusPublic') }
    : { tone: 'muted', status: t('testlog.webrtc.StatusLocal') };
};

// HTTP exit, both families, from the same Cloudflare echoes the IP cards use first.
const probeEgress = async () => {
  const ips = [];
  for (const [provider, endpoint, family] of [
    [cloudflareV4, 'https://1.0.0.1/cdn-cgi/trace', 'IPv4'],
    [cloudflareV6, 'https://[2606:4700:4700::1111]/cdn-cgi/trace', 'IPv6'],
  ]) {
    try {
      const ip = await testLog.timed(
        { kind: 'egress', target: provider.name, endpoint, protocol: `HTTPS GET (${family})` },
        () => provider.run(),
        (value) => (value ? { result: 'ok', value } : { result: 'fail', error: 'empty answer' }),
      );
      if (ip) ips.push(ip);
    } catch { /* recorded as a failed step; an absent family is ordinary */ }
  }
  return ips;
};

const runProbeMatrix = async (signal) => {
  probeState.value = 'running';
  probeRows.value = [];
  const servers = probeServers();
  const egressPromise = probeEgress();

  const probes = await Promise.all(servers.map(async (server) => {
    const handle = testLog.open({
      kind: 'stun',
      target: server.testOnly ? `${server.id} (test-only)` : server.id,
      endpoint: `stun:${server.url}`,
      protocol: 'UDP · STUN Binding (ICE)',
    });
    const result = await gatherAllCandidates(server.url, { signal, timeoutMs: 6000 });
    if (result.reason === 'aborted') { handle.end({ result: 'skip', error: 'aborted' }); return null; }
    const described = (result.candidates || []).map((c) => ({ ...c, ...describeCandidate(c) }));
    const reflexive = described.filter((c) => c.type === 'srflx' || c.type === 'prflx');
    const summary = described.length
      ? described.map((c) => `${c.type}:${c.address}`).join(', ')
      : null;
    const iceErrors = (result.errors || []).map((e) => `${e.code ?? ''} ${e.text ?? ''}`.trim()).filter(Boolean);
    handle.end({
      result: result.reason === 'unavailable' ? 'skip' : (reflexive.length ? 'ok' : 'fail'),
      value: summary,
      error: reflexive.length ? null : [t('testlog.webrtc.NoReflexive'), ...new Set(iceErrors)].join(' — '),
      raw: { candidates: result.candidates, errors: result.errors, elapsedMs: result.elapsedMs },
    });
    // One line per candidate, timed from the start of its server's pass.
    described.forEach((c) => testLog.add({
      kind: 'candidate',
      target: server.id,
      endpoint: `stun:${server.url}`,
      protocol: [c.protocol, familyLabel(c)].filter(Boolean).join(' · '),
      durationMs: c.at,
      result: 'info',
      value: `${c.type} ${c.address}${c.port ? `:${c.port}` : ''}`,
      note: candidateStatus(c).status,
      raw: c.raw,
    }));
    return { server, ok: result.ok, reason: result.reason, candidates: described };
  }));

  const done = probes.filter(Boolean);
  const egressIps = await egressPromise;

  // Location for every public address any server produced, one lookup each.
  const publicIps = [...new Set(done.flatMap((p) => p.candidates.filter((c) => c.public).map((c) => c.ip)))];
  const geoByIp = {};
  await Promise.all(publicIps.map(async (ip) => {
    const geo = await testLog.timed(
      { kind: 'geo', target: ip, endpoint: `/api/maxmind?ip=${ip}`, protocol: 'HTTPS GET' },
      () => lookupMaxmind(ip),
      (g) => (g ? { result: 'ok', value: [g.country_code, g.country, g.org].filter(Boolean).join(' · ') } : { result: 'fail', error: 'no geolocation answer (source unavailable or address unknown)' }),
    ).catch(() => null);
    if (geo) geoByIp[ip] = [geo.country, geo.org].filter(Boolean).join(' · ');
  }));

  probeRows.value = done.flatMap((p) => {
    if (!p.candidates.length) {
      return [{
        server: p.server.id, url: p.server.url, address: null, type: null, family: null, protocol: null,
        location: null, tone: 'muted', status: t('testlog.webrtc.StatusNoAnswer'),
      }];
    }
    return p.candidates.map((c) => ({
      server: p.server.id,
      url: p.server.url,
      address: c.port ? `${c.address}:${c.port}` : c.address,
      type: c.type,
      family: c.family,
      protocol: c.protocol,
      location: c.public ? (geoByIp[c.ip] || null) : t('testlog.webrtc.LocationLan'),
      ...candidateStatus(c),
    }));
  });
  probeState.value = 'done';
  testLog.finish(webrtcVerdict({ available: true, probes: done, egressIps }));
};

// One controller per pass, so a refresh or an unmount stops ICE gathering rather
// than leaving four peer connections running until their own timeouts expire.
let gatherAbort = null;

// Business status → 4 tone levels. "WebRTC unavailable" renders green on
// purpose: for a leak test, a browser with WebRTC disabled is a protective
// state (same visual language as InfoMask), not an error.
const toneOf = (stun) => stun.ip === t('webrtc.StatusUnavailable')
  ? 'ok-fast'
  : ipFieldTone(stun.ip, {
    waitLabels: [t('webrtc.StatusWait'), t('webrtc.StatusTesting')],
    errorLabels: t('webrtc.StatusError'),
  });

// Single field in dl block is in "no data" state (waiting/error).
// Fields may fail independently (e.g. IP success but country lookup fails),
// so the check is run per-field in the template.
const isFieldPending = (value) => isFieldPendingShared(value, {
  waitLabels: [t('webrtc.StatusWait'), t('webrtc.StatusTesting')],
  errorLabels: [t('webrtc.StatusError'), t('webrtc.StatusUnavailable')],
});

// Run a STUN test against one server, then put what it reported on the card.
//
// The gathering itself lives in `utils/webrtc-ice.js`, shared with the homepage's
// routing table: two definitions of "what counts as a leak" on one page is how a
// privacy tool starts disagreeing with itself about the visitor's own address.
const checkSTUNServer = (stun) => {
  // A fresh array rather than length = 0, so the panel scroll position resets
  // cleanly between runs.
  stun.sdpLog = [];
  stun.sdpOpen = false;

  return gatherStunCandidate(stun.url, {
    signal: gatherAbort.signal,
    onLog: (line) => { stun.sdpLog.push(line); },
  }).then(async (result) => {
    // An aborted pass leaves the card as it was: nobody is reading it any more, and
    // writing "error" over the previous answer would be a lie about the network.
    if (result.reason === 'aborted') return;

    if (!result.ok) {
      const statusKey = result.reason === 'unavailable' ? 'StatusUnavailable' : 'StatusError';
      const label = t(`webrtc.${statusKey}`);
      stun.ip = label;
      stun.natType = label;
      // Locale-free twin of the label, consumed by the report builder.
      stun.natTypeCode = statusKey === 'StatusUnavailable' ? 'unavailable' : 'error';
      stun.country = label;
      stun.country_code = '';
      stun.org = label;
      return;
    }

    stun.ip = result.ip;
    stun.natType = determineNATType(result.candidate);
    stun.natTypeCode = natTypeCodeOf(result.candidate);
    IPArray.value = [...IPArray.value, { ip: result.ip, country: '' }];
    // useMaxmind swallows its own errors and returns null on miss, so
    // a single null check handles both "no MaxMind source" and "upstream
    // failure" paths.
    const geo = await lookupMaxmind(result.ip);
    if (geo) {
      stun.country_code = geo.country_code;
      stun.country = geo.country;
      stun.org = geo.org;
      // Back-fill details for the Globalping picker + IP history.
      IPArray.value = [...IPArray.value, { ip: result.ip, country: geo.country_code, location: geo.country, asn: geo.asn, org: geo.org }];
    } else {
      stun.country = t('webrtc.StatusError');
      stun.org = t('webrtc.StatusError');
    }
  });
};

// Analyze ICE candidate information, infer NAT type
const determineNATType = (candidate) => {
  const parts = candidate.split(' ');
  const type = parts[7];
  if (type === 'host') return t('webrtc.NATType.host');
  if (type === 'srflx') return t('webrtc.NATType.srflx');
  if (type === 'prflx') return t('webrtc.NATType.prflx');
  if (type === 'relay') return t('webrtc.NATType.relay');
  return t('webrtc.NATType.unknown');
};

// Domain event: snapshot of all STUN cards for the report collector (servers
// still waiting carry no natTypeCode and are dropped by the builder).
const emitWebrtcFinished = () => {
  hasEverSettled.value = true;
  emitAppEvent('webrtc:finished', {
    servers: stunServers.map((server) => ({
      id: server.id,
      url: server.url,
      ip: server.ip,
      natTypeCode: server.natTypeCode,
      country_code: server.country_code,
      org: server.org,
    })),
  });
};

// Test all STUN servers
const checkAllWebRTC = async (isRefresh) => {
  if (isRefresh) trackEvent('Section', 'RefreshClick', 'WebRTC');
  isStarted.value = true;
  gatherAbort?.abort();
  gatherAbort = new AbortController();
  testLog.begin({
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    webrtc: isWebRtcAvailable,
    servers: probeServers().map((server) => server.url).join(', '),
  });

  // No WebRTC in this browser: mark every card with the dedicated state
  // (dl detail fields render as "—" via isFieldPending) and finish the
  // section immediately.
  if (!isWebRtcAvailable) {
    const label = t('webrtc.StatusUnavailable');
    stunServers.forEach((server) => {
      server.ip = label;
      server.natType = label;
      server.natTypeCode = 'unavailable';
      server.country = label;
      server.country_code = '';
      server.org = label;
    });
    store.setLoadingStatus('WebRTC', true);
    emitWebrtcFinished();
    testLog.add({ kind: 'env', target: 'RTCPeerConnection', result: 'skip', error: t('webrtc.StatusUnavailable') });
    testLog.finish(webrtcVerdict({ available: false }));
    return;
  }

  const promises = stunServers.map((server) => {
    server.ip = t('webrtc.StatusTesting');
    server.natType = t('webrtc.StatusTesting');
    server.natTypeCode = undefined;
    server.country = t('webrtc.StatusTesting');
    server.country_code = '';
    server.org = t('webrtc.StatusTesting');
    return checkSTUNServer(server);
  });

  // Alongside the cards, on the same controller: one refresh must not leave an
  // earlier enumeration gathering after the section has moved on.
  const gathered = runCandidateGather(gatherAbort.signal);
  promises.push(gathered);
  // The log's matrix runs beside the cards but outside their 6 s race: its own
  // passes time out at 6 s too, and the egress echo and geo lookups follow them.
  runProbeMatrix(gatherAbort.signal).catch((error) => {
    console.error('WebRTC probe matrix error:', error);
    testLog.finish({ verdict: 'inconclusive', reason: 'internalError', params: { error: String(error?.message || error) } });
  });

  const allSettledPromise = Promise.allSettled(promises);
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 6000));
  return Promise.race([allSettledPromise, timeoutPromise]).then(() => {
    store.setLoadingStatus('WebRTC', true);
    emitWebrtcFinished();
  });
};

// Command owner: run all STUN checks. Resolves with the next webrtc:finished
// snapshot (also emitted when WebRTC is unavailable in this browser).
useAppCommand('webrtc:run', ({ isRefresh = false } = {}) => {
  const finished = waitForAppEvent('webrtc:finished');
  checkAllWebRTC(isRefresh);
  return finished;
});

onMounted(() => {
  store.setMountingStatus('WebRTC', true);
});

// Stop any still-gathering peer connections if the component unmounts mid-test —
// otherwise ICE keeps running for seconds and callbacks fire on refs that no
// longer exist.
onBeforeUnmount(() => { gatherAbort?.abort(); });

watch(IPArray, () => {
  store.updateAllIPs(IPArray.value);
}, { deep: true });
</script>
