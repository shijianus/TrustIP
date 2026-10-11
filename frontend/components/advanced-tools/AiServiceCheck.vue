<template>
  <!-- One AI service, one exit address, everything this build can say about it.
       The aggregate page (`/ai`) compares the services against each other; this
       page answers the question a visitor arriving for *one* service actually
       asks: what does that service see, and is what it sees a problem. -->
  <div class="ai-service-section my-4 space-y-4">
    <p class="text-sm text-muted-foreground leading-relaxed">{{ t('aiService.Note', { name: service?.name ?? '' }) }}</p>

    <!-- An IPv6-only visitor gets a warning, not a verdict: this build has no
         evidence about how one particular vendor treats IPv6 exits, and the copy
         says which of the two that is. -->
    <div v-if="ipv6Only" class="rounded-lg border border-warning-soft bg-warning-soft px-4 py-3">
      <p class="text-sm leading-relaxed text-warning-soft-fg">{{ t('aiService.Ipv6Warning') }}</p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button variant="action" :disabled="running || !service" @click="run">
        <Spinner v-if="running" class="size-4" />
        {{ running ? t('aiService.Checking') : t('aiService.Run') }}
      </Button>
      <VerdictChip
        v-if="!running && exitIp"
        :tone="judged.split === null ? 'muted' : (judged.split ? 'warn' : 'ok')"
        :label="splitLabel"
      />
      <span v-else-if="!running" class="text-sm text-muted-foreground">{{ t('aiService.NotYet') }}</span>
    </div>

    <!-- ── The two addresses this page is about ───────────────────────── -->
    <div class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('aiService.EgressTitle')">
        <template #aside>
          <VerdictChip v-if="judged.ms != null" tone="info" :label="`${judged.ms} ms`" />
        </template>
      </SectionTitle>
      <dl class="divide-y divide-dashed divide-border">
        <KeyRow :label="t('aiService.Control')" wide :nums="true">
          <span class="break-all font-mono text-xs font-normal">{{ controlIp || '—' }}</span>
        </KeyRow>
        <KeyRow :label="t('aiService.ExitFor', { name: service?.name ?? '' })" wide :nums="true">
          <span class="break-all font-mono text-xs font-normal">{{ exitIp || '—' }}</span>
        </KeyRow>
        <KeyRow :label="t('aiService.Ruler')">
          <span class="text-xs font-normal text-muted-foreground leading-relaxed">{{ t('aiService.RulerNote') }}</span>
        </KeyRow>
      </dl>
      <p v-if="reasonText" class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ reasonText }}</p>
    </div>

    <!-- ── Trust score and the safety ladder ──────────────────────────── -->
    <TrustScorePanel v-if="exitIp" :ip="exitIp" :geo="exitGeo" />
    <CapabilitySlot
      v-else-if="!running"
      :title="t('aiService.TrustTitle')"
      state="placeholder"
      :note="t('aiService.TrustNoExit')"
      :needs="t('aiService.TrustNeeds')"
    />

    <!-- ── What the exit is ───────────────────────────────────────────── -->
    <div v-if="exitIp" class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('aiService.AttrTitle')">
        <template #aside>
          <Icon
            v-if="showFlag"
            :icon="`circle-flags:${String(exitGeo?.country_code || '').toLowerCase()}`"
            class="size-4 shrink-0"
          />
        </template>
      </SectionTitle>
      <dl v-if="exitGeo" class="divide-y divide-dashed divide-border">
        <KeyRow :label="t('aiService.AttrRegion')" :value="regionText" wide />
        <KeyRow :label="t('aiService.AttrCity')" :value="exitGeo.city || null" />
        <KeyRow :label="t('aiService.AttrAsn')" :value="exitGeo.asn || null" :nums="true" />
        <KeyRow :label="t('aiService.AttrCarrier')" :value="exitGeo.org || exitGeo.isp || null" wide />
      </dl>
      <p v-else-if="geoState === 'loading'" class="text-xs text-muted-foreground">{{ t('aiService.Checking') }}</p>
      <p v-else class="text-xs leading-relaxed text-muted-foreground">{{ t('aiService.AttrFailed') }}</p>
    </div>

    <!-- ── Does the service answer, and where does it say it serves ───── -->
    <div v-if="service" class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('aiService.ReachTitle')">
        <template #aside>
          <VerdictChip :tone="verdictTone" :label="verdictLabel" />
        </template>
      </SectionTitle>
      <dl class="divide-y divide-dashed divide-border">
        <KeyRow v-for="host in probeHosts" :key="host" :label="host" wide :nums="true">
          <span v-if="reach[host]?.state === EGRESS_STATE.answered" class="text-xs font-normal">
            {{ t('aiService.ReachAnswered', { ms: reach[host].ms, colo: reach[host].colo || '—' }) }}
          </span>
          <span v-else-if="reach[host]" class="text-xs font-normal text-muted-foreground">
            {{ reasonOf(reach[host].state) }}
          </span>
          <span v-else class="text-xs font-normal text-muted-foreground">—</span>
        </KeyRow>
        <KeyRow v-if="service.regions?.source" :label="t('aiService.Source')">
          <a
            :href="service.regions.source"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs font-normal underline underline-offset-2"
          >{{ service.regions.source.replace(/^https?:\/\//, '') }}</a>
        </KeyRow>
      </dl>
    </div>

    <!-- ── What else leaves the machine ───────────────────────────────── -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('aiService.DnsTitle')">
          <template #aside>
            <VerdictChip :tone="dnsTone" :label="dnsLabel" />
          </template>
        </SectionTitle>
        <dl v-if="dnsRows.length" class="divide-y divide-dashed divide-border">
          <KeyRow v-for="row in dnsRows" :key="row.id" :label="row.name" wide :nums="true">
            <span class="break-all font-mono text-xs font-normal">{{ row.ip || t('aiService.DnsFailed') }}</span>
          </KeyRow>
        </dl>
        <p v-else class="text-xs leading-relaxed text-muted-foreground">{{ t('aiService.DnsPending') }}</p>
      </div>

      <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('aiService.UdpTitle')">
          <template #aside>
            <VerdictChip :tone="udpTone" :label="udpLabel" />
          </template>
        </SectionTitle>
        <dl v-if="leaks.length" class="divide-y divide-dashed divide-border">
          <KeyRow v-for="leak in leaks" :key="leak.ip" :label="leak.country_code || '—'" wide :nums="true">
            <span class="break-all font-mono text-xs font-normal">{{ leak.ip }}</span>
          </KeyRow>
        </dl>
        <p v-else-if="udpRunning" class="text-xs text-muted-foreground">{{ t('aiService.Checking') }}</p>
        <p v-else class="text-xs leading-relaxed text-muted-foreground">{{ t('aiService.UdpSilent') }}</p>
      </div>
    </div>

    <!-- ── The browser that is asking ─────────────────────────────────── -->
    <div class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('aiService.DeviceTitle')" />
      <dl class="divide-y divide-dashed divide-border">
        <KeyRow :label="t('aiService.DeviceTz')" :value="device.timeZone" wide />
        <KeyRow :label="t('aiService.DeviceLang')" :value="device.languages" wide />
        <KeyRow :label="t('aiService.DeviceSystem')" :value="device.system" wide />
        <KeyRow :label="t('aiService.DeviceTouch')" :value="device.touch" />
        <KeyRow :label="t('aiService.DeviceNetwork')" :value="device.network" />
        <KeyRow :label="t('aiService.DeviceDnt')" :value="device.dnt" />
        <KeyRow :label="t('aiService.DeviceGpu')" :value="device.gpu" wide />
      </dl>
      <div class="mt-3">
        <CapabilitySlot
          :title="t('aiService.DeviceCanvasTitle')"
          state="delegated"
          :note="t('aiService.DeviceCanvasNote')"
          :to="{ path: '/tools/browserinfo' }"
          :cta="t('aiService.DeviceCanvasCta')"
        />
      </div>
    </div>

    <!-- ── This exit, as the browser recorded it ──────────────────────── -->
    <div class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('aiService.HistTitle')">
        <template #aside>
          <Button v-if="hasHistory" variant="ghost" size="sm" @click="clearHistory">
            <Trash2 class="size-3.5" />
            {{ t('aiService.HistClear') }}
          </Button>
        </template>
      </SectionTitle>
      <dl v-if="seenExits.length" class="divide-y divide-dashed divide-border">
        <KeyRow
          v-for="entry in seenExits"
          :key="entry.ip"
          :label="formatIsoDate(entry.lastSeen, locale)"
          :nums="true"
          wide
        >
          <span class="break-all font-mono text-xs font-normal">{{ entry.ip }}</span>
        </KeyRow>
      </dl>
      <p v-else class="text-xs leading-relaxed text-muted-foreground">{{ t('aiService.HistEmpty') }}</p>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ t('aiService.HistPrivacy') }}</p>
    </div>

    <p class="text-xs font-normal text-muted-foreground leading-relaxed">{{ t('aiCheck.Caveat') }}</p>
  </div>
</template>

<script setup>
// The single-service AI risk page — `/claude` and `/gpt`.
//
// Composition, not a second measurement. Every number on this page comes from a
// function the app already runs elsewhere: the echo is `readTrace` / `judgeRow`
// from `composables/use-ai-egress.js` (the same two the aggregate `/ai` page uses,
// so an exit cannot be one address here and another there), the score is
// `ip-infos/TrustScorePanel.vue` (which owns its own fetch and its own honest
// `gaps` line), the UDP pass is `composables/use-egress-leak.js` (the headless
// gatherer the homepage's routing table uses), and the DNS rows are the same
// provider objects `DnsLeaksTest.vue` iterates.
//
// Only two things are asked here that no other page asks: the *country* of this
// one exit (one `/api/ipsb` lookup, the key-free source the homepage geocodes its
// rows with) and the reachability probe against the service's second hostname.
//
// What is deliberately absent: any judgement of the vendor's moderation. This page
// reports what left the machine and what public registries say about that address.
// Whether an account gets flagged depends on evidence this build cannot see.

import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { Trash2 } from '@lucide/vue';

import {
    AI_EGRESS_SERVICES, EGRESS_CONTROL, REGION_VERDICT, nonCountryLoc,
} from '@/utils/ai-service-regions.js';
import { EGRESS_STATE, judgeRow, readTrace } from '@/composables/use-ai-egress.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { isValidIP } from '@/utils/valid-ip.js';
import { useEgressLeak } from '@/composables/use-egress-leak.js';
import { useIpHistory } from '@/composables/use-ip-history.js';
import { groupHistoryByIP } from '@/utils/ip-history.js';
import { detectBrowser, detectOS } from '@/utils/system-detect.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import { runWithRetry, ipApi, ipleak, fastly } from '@/utils/dnsleaks/index.js';
import getCountryName from '@/data/country-name.js';
import { useMainStore } from '@/store.js';

import Button from '@/components/ui/button/Button.vue';
import Spinner from '@/components/ui/spinner/Spinner.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import CapabilitySlot from '@/components/widgets/CapabilitySlot.vue';
import TrustScorePanel from '@/components/ip-infos/TrustScorePanel.vue';

const props = defineProps({
    // Which service this page is about — its `id` in `common/ai-service-regions.js`.
    // Set from the tool registry, so `/claude` and `/gpt` are one component and two
    // addresses rather than two copies of a template.
    service: { type: String, required: true },
});

const { t, locale } = useI18n();
const store = useMainStore();

const service = computed(() => AI_EGRESS_SERVICES.find((item) => item.id === props.service) || null);

// The service's own hostname plus the one its API sits behind: a tunnel that
// carries the web app but not the API is a real and common misconfiguration, and
// only two probes can show it.
const EXTRA_HOSTS = { claude: ['anthropic.com'], chatgpt: ['openai.com'], gemini: ['aistudio.google.com'] };
const probeHosts = computed(() => (service.value ? [service.value.host, ...(EXTRA_HOSTS[service.value.id] || [])] : []));

const GEO_TIMEOUT_MS = 12000;

const running = ref(false);
const controlIp = ref(null);
const judged = ref({ state: EGRESS_STATE.pending, split: null, verdict: null, locNote: null });
const exitGeo = ref(null);
const geoState = ref('idle');
const reach = ref({});

const exitIp = computed(() => judged.value.ip || null);

// One geolocation per address, from the key-free source the homepage geocodes its
// routing-table rows with — so this page's country and the table's cannot disagree.
const fetchGeo = async (ip) => {
    if (!isValidIP(ip)) return null;
    try {
        const res = await fetchWithTimeout(`/api/ipsb?ip=${encodeURIComponent(ip)}`, { timeoutMs: GEO_TIMEOUT_MS });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
};

// The page's own row additionally reports whether the lookup is in flight or dead,
// because an empty attribute panel must say which of the two it is. The leak rows
// below geocode through the quiet form: a failed place-name for a leaked address
// is not this panel's business.
const lookupGeo = async (ip) => {
    if (!isValidIP(ip)) return null;
    geoState.value = 'loading';
    const body = await fetchGeo(ip);
    geoState.value = body ? 'ready' : 'failed';
    return body;
};

// The homepage's quiet UDP pass, and the same provider objects the DNS section
// iterates. A browser with WebRTC disabled answers no leak at all, which the
// panel below reports as silence rather than as safety.
const { leaks, running: udpRunning, run: runUdp } = useEgressLeak({ geoLookup: fetchGeo });
const DNS_PROVIDERS = [ipApi, ipleak, fastly];
const dnsRows = ref([]);

const settled = (result) => (result?.status === 'fulfilled' ? result.value : { state: EGRESS_STATE.blocked });

const measure = async () => {
    const target = service.value;
    if (!target) return;
    running.value = true;
    exitGeo.value = null;
    geoState.value = 'idle';
    try {
        const hosts = probeHosts.value;
        // The control first: every split marker on the page is measured against
        // its answer, and `judgeRow` withholds them all when it did not answer.
        const traces = await Promise.allSettled([
            readTrace(EGRESS_CONTROL.host),
            ...hosts.map((host) => readTrace(host)),
        ]);
        const control = settled(traces[0]);
        controlIp.value = control.state === EGRESS_STATE.answered ? control.ip : null;

        const own = settled(traces[1]);
        judged.value = judgeRow(target, own, controlIp.value);
        reach.value = Object.fromEntries(hosts.map((host, i) => [host, settled(traces[i + 1])]));

        if (judged.value.ip) exitGeo.value = await lookupGeo(judged.value.ip);

        const dnsAnswers = await Promise.allSettled(DNS_PROVIDERS.map((provider) => runWithRetry(provider)));
        dnsRows.value = DNS_PROVIDERS.map((provider, i) => ({
            id: provider.id,
            name: provider.name,
            ip: dnsAnswers[i].status === 'fulfilled' ? dnsAnswers[i].value?.ip || null : null,
        }));

        await runUdp();
    } finally {
        running.value = false;
    }
};

const run = async () => {
    if (running.value) return;
    await measure();
};

onMounted(run);

// ── Labels ───────────────────────────────────────────────────────────────────

const REASONS = {
    [EGRESS_STATE.noEndpoint]: 'aiCheck.reason.noEndpoint',
    [EGRESS_STATE.timeout]: 'aiCheck.reason.timeout',
    [EGRESS_STATE.blocked]: 'aiCheck.reason.blocked',
    [EGRESS_STATE.pending]: 'aiService.NotYet',
};

const reasonOf = (state) => t(REASONS[state] || 'aiCheck.reason.blocked');
const reasonText = computed(() => (
    judged.value.state === EGRESS_STATE.answered ? '' : reasonOf(judged.value.state)
));

const splitLabel = computed(() => {
    if (judged.value.split === null) return t('aiCheck.SplitUnknown');
    return judged.value.split ? t('aiCheck.SplitYes') : t('aiCheck.SplitNo');
});

const VERDICT_TONES = {
    [REGION_VERDICT.supported]: 'ok',
    [REGION_VERDICT.unsupported]: 'bad',
    [REGION_VERDICT.unknown]: 'muted',
};

const verdictTone = computed(() => VERDICT_TONES[judged.value.verdict] || 'muted');

const verdictLabel = computed(() => {
    if (judged.value.locNote) return t('aiCheck.RegionNoCountry');
    if (!judged.value.ip) return t('aiService.NotYet');
    if (judged.value.verdict === REGION_VERDICT.unknown) return t('aiCheck.RegionNoList');
    return judged.value.verdict === REGION_VERDICT.supported
        ? t('aiCheck.RegionSupported')
        : t('aiCheck.RegionUnsupported');
});

const showFlag = computed(() => {
    const code = String(exitGeo.value?.country_code || '').toUpperCase();
    return /^[A-Z]{2}$/.test(code) && !nonCountryLoc(code);
});

const regionText = computed(() => {
    const geo = exitGeo.value;
    if (!geo) return null;
    const country = getCountryName(geo.country_code, locale.value) || geo.country_name || geo.country || '';
    return [country, geo.region].filter(Boolean).join(' · ') || null;
});

// A resolver that answered with an address is a leak only against a stated ruler:
// the visitor's own exit. With no exit to compare, the row says "answered", never
// "safe".
const dnsTone = computed(() => {
    if (!dnsRows.value.length) return 'muted';
    if (dnsRows.value.every((row) => !row.ip)) return 'bad';
    if (!exitIp.value) return 'info';
    return dnsRows.value.some((row) => row.ip && row.ip !== exitIp.value) ? 'warn' : 'ok';
});

const dnsLabel = computed(() => {
    if (!dnsRows.value.length) return t('aiService.DnsPending');
    if (dnsRows.value.every((row) => !row.ip)) return t('aiService.DnsFailed');
    if (!exitIp.value) return t('aiService.DnsAnswered');
    return dnsTone.value === 'warn' ? t('aiService.DnsDiffers') : t('aiService.DnsSame');
});

const udpTone = computed(() => (udpRunning.value ? 'info' : (leaks.value.length ? 'warn' : 'muted')));
const udpLabel = computed(() => {
    if (udpRunning.value) return t('aiService.Checking');
    if (leaks.value.length) return t('aiService.UdpFound', { n: leaks.value.length });
    return t('aiService.UdpNone');
});

// Read once, on purpose: nothing here changes while the page is open, and a
// reactive WebGL probe would re-allocate a graphics context on every re-render.
const readGpu = () => {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        // A browser that hides its renderer answers with null, which the row shows
        // as an em dash. A masked string is the browser's answer, not ours to
        // interpret.
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') || null : null;
    } catch {
        return null;
    }
};

const yesNo = (value) => (value ? t('aiService.Yes') : t('aiService.No'));

const device = ref({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    languages: navigator.languages?.join(', ') || navigator.language || null,
    system: [detectOS(), detectBrowser()].filter(Boolean).join(' · ') || null,
    touch: yesNo(Boolean(window.matchMedia?.('(pointer: coarse)').matches)),
    network: navigator.connection?.effectiveType || null,
    dnt: yesNo(navigator.doNotTrack === '1'),
    gpu: readGpu(),
});

const { sortedDays, hasHistory, clearHistory } = useIpHistory({ store });

// The visitor's own recorded addresses, which `utils/ip-history.js` keeps in this
// browser. Both exits this page measured are looked for by name: "have I been here
// before" is the question, and the five most recent answers are enough to show it.
const seenExits = computed(() => {
    const wanted = new Set([exitIp.value, controlIp.value].filter(Boolean));
    return groupHistoryByIP(sortedDays.value)
        .filter((entry) => wanted.size === 0 || wanted.has(entry.ip))
        .slice(0, 5);
});

// Both halves matter: an address list that holds a colon and no dotted quad is an
// IPv6-only machine, and saying "IPv6 present" would also fire on a dual stack,
// where the service is very likely reached over IPv4 anyway.
const isV4 = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(String(ip));
const isV6 = (ip) => String(ip).includes(':');
const ipv6Only = computed(() => {
    const ips = (store.allIPs || []).map((entry) => entry?.ip ?? entry).filter(Boolean);
    return ips.length > 0 && ips.some(isV6) && !ips.some(isV4);
});
</script>
