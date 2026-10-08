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
        class="keyboard-shortcut-card jn-card min-w-0 overflow-hidden transition-transform duration-300 ease-out hover:-translate-y-1.5 data-[keyboard-hover=true]:ring-2 data-[keyboard-hover=true]:ring-green-500/50">
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
import { STUN_SERVERS, gatherStunCandidate, natTypeCodeOf } from '@/utils/webrtc-ice.js';
import { Play, MapPin, EthernetPort, Flower, Network, RotateCw, FileText, ChevronDown } from '@lucide/vue';
import { Icon } from '@iconify/vue';
import FitText from '@/components/widgets/FitText.vue';
import CopyButton from '@/components/widgets/CopyButton.vue';
import InfoBanner from '@/components/widgets/InfoBanner.vue';
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
