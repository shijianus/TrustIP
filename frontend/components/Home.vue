<template>
  <NavBar />
  <User ref="userRef" />
  <Achievements ref="achievementsRef" />
  <Preferences />
  <main id="mainpart" class="mx-auto w-full px-4 jn-container">
    <div class="rounded-md">
      <MyIpQuery
        :mask-active="infoMaskLevel > 0"
        :egress-ips="egressIps"
        :geolocations="splitGeos"
        :split-running="splitRunning"
        @toggle-mask="toggleInfoMask" />
      <SiteSplitTest
        :rows="splitRows"
        :geolocations="splitGeos"
        :running="splitRunning"
        @run="runSplit" />
      <IPCheck />
      <Connectivity />
      <WebRTC />
      <DNSLeaks />
      <SpeedTest />
      <AdvancedTools ref="advancedToolsRef" />
    </div>
  </main>
  <FloatingDock :ready="showMaskButton" :mask-active="infoMaskLevel > 0">
    <InfoMask :showMaskButton.value="showMaskButton" :infoMaskLevel.value="infoMaskLevel"
      :toggleInfoMask="toggleInfoMask" />
    <ShareReport ref="shareReportRef" />
    <IPHistory />
    <QueryIP ref="queryIPRef" />
  </FloatingDock>
  <HelpModal ref="helpModalRef" />
  <Additional />
  <Footer />
</template>

<script setup>
// The homepage. Holds every top-level section plus the Advanced Tools drawer.
// Split out of App.vue when the app moved to history-mode routing: App is now a
// thin shell, and this component is what /'s <router-view> renders. The truly
// global widgets (tooltip provider, toast, PWA, theme) stay in App.
//
// Components — the test sections and the always-visible chrome load
// synchronously; everything the first paint can't show (dialogs, drawers,
// the below-fold Additional/Footer) is an async component so its code stays
// out of the route chunk and out of the mount's critical path. Their
// template refs are null until the chunk lands — consumers (use-shortcuts)
// must optional-chain.
import NavBar from './Nav.vue';
import MyIpQuery from './home/MyIpQuery.vue';
import SiteSplitTest from './home/SiteSplitTest.vue';
import IPCheck from './IpInfos.vue';
import Connectivity from './ConnectivityTest.vue';
import WebRTC from './WebRtcTest.vue';
import DNSLeaks from './DnsLeaksTest.vue';
import SpeedTest from './SpeedTest.vue';
import AdvancedTools from './Advanced.vue';
import InfoMask from './widgets/InfoMask.vue';
import FloatingDock from './widgets/FloatingDock.vue';

// Vue + Store
import { ref, computed, onMounted, defineAsyncComponent } from 'vue';

// Async (off-critical-path) components
const Additional = defineAsyncComponent(() => import('./Additional.vue'));
const Footer = defineAsyncComponent(() => import('./Footer.vue'));
const User = defineAsyncComponent(() => import('./User.vue'));
const Achievements = defineAsyncComponent(() => import('./Achievements.vue'));
const Preferences = defineAsyncComponent(() => import('./widgets/Preferences.vue'));
const QueryIP = defineAsyncComponent(() => import('./widgets/QueryIP.vue'));
const HelpModal = defineAsyncComponent(() => import('./widgets/Help.vue'));
const IPHistory = defineAsyncComponent(() => import('./widgets/IPHistory.vue'));
const ShareReport = defineAsyncComponent(() => import('./report/ShareReportDialog.vue'));
import { useMainStore } from '@/store';
import { useI18n } from 'vue-i18n';

// Composables
import { useInfoMask } from '@/composables/use-info-mask.js';
import { useRefreshOrchestrator } from '@/composables/use-refresh-orchestrator.js';
import { useShortcuts } from '@/composables/use-shortcuts.js';
import { useSectionTracking } from '@/composables/use-section-tracking.js';
import { useSectionHashScroll } from '@/composables/use-section-hash.js';
import { useDocumentMeta } from '@/composables/use-document-meta.js';
import { useSiteSplit } from '@/composables/use-site-split.js';
import { SPLIT_SITES } from '@/data/site-split.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';

const { t } = useI18n();
const store = useMainStore();
const configs = computed(() => store.configs);
const userPreferences = computed(() => store.userPreferences);

// Template refs — UI chrome only; the test sections are reached through the
// command bus (utils/app-commands.js), not refs.
const userRef = ref(null);
const achievementsRef = ref(null);
const queryIPRef = ref(null);
const helpModalRef = ref(null);
const shareReportRef = ref(null);
const advancedToolsRef = ref(null);

// Info mask
const { infoMaskLevel, isInfosLoaded, showMaskButton, toggleInfoMask } = useInfoMask({
    store,
    t,
});

// The IP-routing table. Its state lives here rather than inside the component
// because two panels read it — the summary strip in the opening card and the
// table itself — and a destination probed twice could answer twice differently.
//
// Geolocation of each distinct egress address goes through `/api/ipsb` — the
// same key-free source the dossier treats as its primary geo answer, and the
// one that returns the ASN's organisation name, which is the column's most
// useful field. A split network answers forty-four destinations with two
// addresses, so this is called twice, not forty-four times.
const geoLookup = async (ip) => {
    const res = await fetchWithTimeout(`/api/ipsb?ip=${encodeURIComponent(ip)}`, { timeoutMs: 12000 });
    if (!res.ok) throw new Error(`ipsb ${res.status}`);
    return res.json();
};

const {
    rows: splitRows, geolocations: splitGeos, running: splitRunning, run: runSplit,
} = useSiteSplit({ sites: SPLIT_SITES, geoLookup });

const egressIps = computed(() => [...new Set(splitRows.value.filter((r) => r.ip).map((r) => r.ip))]);

// Refresh / initial load sequence
const { loadingControl } = useRefreshOrchestrator({
    store,
    t,
    userPreferences,
    infoMaskLevel,
});

// Shortcuts
const { loadShortcuts } = useShortcuts({
    refs: {
        queryIPRef, helpModalRef, shareReportRef, advancedToolsRef,
        isInfosLoaded, toggleInfoMask,
    },
    store, t, configs, userPreferences,
});

// Scroll monitoring + section tracking (logic from widgets/Patch.vue)
useSectionTracking();

// `/#<SectionId>` deep links — the anchors the rail replaced with routes.
useSectionHashScroll();

// Localized homepage head. Provide title/description explicitly via t() rather
// than leaning on use-document-meta's DEFAULT_META snapshot: that snapshot is
// taken at module load, before the (now async) locale messages land, so it would
// pin the head to index.html's English title. Reactive t() also re-applies the
// right copy when SPA-navigating back from a /tools/:slug page.
useDocumentMeta(() => ({
    title: t('page.title'),
    description: t('page.description'),
    canonical: `${window.location.origin}/`,
}));

onMounted(() => {
    loadingControl();
    loadShortcuts();
    // Deliberately not awaited: the routing table measures the visitor's own
    // paths and takes as long as their slowest destination, and nothing else
    // on the page depends on it.
    runSplit();
});
</script>
