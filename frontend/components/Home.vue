<template>
  <NavBar />
  <User ref="userRef" />
  <Achievements ref="achievementsRef" />
  <Preferences />
  <main id="mainpart" class="w-full jn-container">
    <div class="rounded-md">
      <MyIpQuery
        :mask-active="infoMaskLevel > 0"
        :egress-ips="egressIps"
        :geolocations="splitGeos"
        :split-running="splitRunning"
        :attribution="splitAttribution"
        @toggle-mask="toggleInfoMask" />
      <SiteSplitTest
        :table-rows="splitTableRows"
        :geolocations="splitGeos"
        :distinct="egressIps"
        :answered="splitAnswered"
        :plan-failed="splitPlanFailed"
        :attribution="splitAttribution"
        :leak-running="leakRunning"
        :running="splitRunning || splitLocating > 0"
        @run="runSplit" />
      <!-- The Advanced Tools drawer, with no grid above it. It stays mounted
           here because the keyboard shortcuts and the `?tool=<slug>` query open
           it from `/`, and a drawer whose host moved would leave those keys
           doing nothing. Its card grid has its own page at /tools. -->
      <AdvancedTools ref="advancedToolsRef" host-only />
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
import AdvancedTools from './Advanced.vue';
import InfoMask from './widgets/InfoMask.vue';
import FloatingDock from './widgets/FloatingDock.vue';

// Vue + Store
import { ref, computed, onMounted, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';

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
import { useIpCards } from '@/composables/use-ip-cards.js';
import { useRefreshOrchestrator } from '@/composables/use-refresh-orchestrator.js';
import { useShortcuts } from '@/composables/use-shortcuts.js';
import { useDocumentMeta } from '@/composables/use-document-meta.js';
import { useSiteSplit } from '@/composables/use-site-split.js';
import { useEgressLeak } from '@/composables/use-egress-leak.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { isUsablePublicIP } from '@/utils/valid-ip.js';

const { t } = useI18n();
const store = useMainStore();
const router = useRouter();
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

// The address engine. `/` no longer draws the per-source cards, but it still
// has to run the measurement they were the picture of: the summary card above
// and the routing table both read `ipinfo:finished`, and the refresh
// orchestrator, the `1-6` shortcuts and PersonaCheck all reach this work through
// the `ipinfo:refresh` command registered here. On `/ipinfo` that owner is the
// grid instead, and only one of the two routes is mounted at a time.
const { ipDataCards } = useIpCards();

// Every address a source resolved about the visitor, at whatever display count
// the visitor picked. The card grid's own count stays theirs to choose; this is
// the list of exits, and one source answering with an address no other source
// mentioned is the leak this page exists to find — so it belongs on screen even
// when the card that learned it is hidden by that preference.
const ownExits = computed(() => {
    const ips = [];
    for (const card of ipDataCards) {
        if (card.ip && isUsablePublicIP(card.ip) && !ips.includes(card.ip)) ips.push(card.ip);
    }
    return ips;
});

// The visitor's own exits, already geolocated by the cards. The routing table
// folds these over whatever it looked up itself, because one address cannot be
// two cities on one page — see use-site-split.js.
const ownGeolocations = computed(() => {
    const out = {};
    for (const card of ipDataCards) {
        if (!card.ip || !isUsablePublicIP(card.ip) || out[card.ip]) continue;
        if (!card.country_code && !card.city && !card.country_name) continue;
        out[card.ip] = {
            city: card.city,
            region: card.region,
            country: card.country_code,
            country_code: card.country_code,
            country_name: card.country_name,
            org: card.isp,
        };
    }
    return out;
});

// The IP-routing table. Its state lives here rather than inside the component
// because two panels read it — the summary strip in the opening card and the
// table itself — and a destination probed twice could answer twice differently.
//
// Geolocation of an egress address the cards did not already resolve goes
// through `/api/ipsb` — the same key-free source the dossier treats as its
// primary geo answer, and the one that returns the ASN's organisation name,
// which is the column's most useful field. A split network answers every
// destination with two or three addresses, so this is called once per *distinct*
// exit, not once per row.
const geoLookup = async (ip) => {
    const res = await fetchWithTimeout(`/api/ipsb?ip=${encodeURIComponent(ip)}`, { timeoutMs: 12000 });
    if (!res.ok) throw new Error(`ipsb ${res.status}`);
    return res.json();
};

// The one STUN pass the routing table needs to tell a rented exit from the machine
// behind it. Quiet, and with no share in the report or the achievements: the table
// needs an address, not a second record of a test the visitor never asked to run.
const { leaks, running: leakRunning, run: runLeakCheck } = useEgressLeak({ geoLookup });

const {
    tableRows: splitTableRows, geolocations: splitGeos,
    egressIps, answered: splitAnswered, planFailed: splitPlanFailed,
    running: splitRunning, locating: splitLocating, run: runSplit,
    attribution: splitAttribution,
} = useSiteSplit({ geoLookup, ownGeolocations, knownExits: ownExits, leaks });

// Refresh / initial load sequence — scoped to what this page actually runs.
// The leak and connectivity *sections* are not mounted here, so neither is waited
// on; the routing table does run its own one-pass STUN check (above), quietly, and
// is not waiting for the section's version of it either.
const { loadingControl } = useRefreshOrchestrator({
    store,
    t,
    infoMaskLevel,
    sections: ['IPInfo'],
});

// Shortcuts
const { loadShortcuts } = useShortcuts({
    refs: {
        queryIPRef, helpModalRef, shareReportRef, advancedToolsRef,
        isInfosLoaded, toggleInfoMask,
    },
    store, t, configs, userPreferences, router,
});

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
    // Neither is awaited. The STUN pass starts first because it is the slowest
    // signal the work order reads, and the table measures the visitor's own paths
    // and takes as long as their slowest destination — nothing else on the page
    // depends on either of them.
    runLeakCheck();
    runSplit();
});
</script>
