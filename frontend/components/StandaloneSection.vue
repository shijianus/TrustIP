<!-- StandaloneSection — one home-page section as its own page.

     The rail destinations that used to be anchors (`/link`, `/webrtc`, `/dns`,
     `/speedtest`, `/tools`) render here. The route carries the section id in
     `meta`, and data/rail.js resolves it to the very component the dashboard
     mounts: this file owns the page chrome (header, footer, head tags, the
     boot dispatch) and nothing else, so a section's logic has one home and
     cannot fork.

     No duplicate title: the section renders its own `<h2 id="…">`, which is
     both its visible heading and its `/#<SectionId>` anchor on the dashboard,
     so the page shows that heading rather than adding an `<h1>` of the same
     words. The header's breadcrumb carries it for orientation. -->
<template>
  <div class="flex min-h-screen flex-col">
    <!-- User system dialogs host (Benefits & Usage) — the sign-in gated tools
         link to it from their quota hints, so they work here too. -->
    <User />

    <StandalonePageHeader :title="page ? t(page.titleKey) : ''" rail />

    <main class="flex-1">
      <div class="mx-auto w-full max-w-[1000px] px-5 py-6 max-[480px]:px-3 max-[480px]:py-3.5">
        <component :is="sectionComponent" v-if="sectionComponent" />
      </div>
    </main>

    <Footer />
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { SECTION_PAGE_BY_ID } from '@/data/rail.js';
import { useMainStore } from '@/store';
import { useDocumentMeta } from '@/composables/use-document-meta.js';
import { dispatchAppCommand, waitForAppCommand } from '@/utils/app-commands.js';
import IpInfos from '@/components/IpInfos.vue';
import ConnectivityTest from '@/components/ConnectivityTest.vue';
import WebRtcTest from '@/components/WebRtcTest.vue';
import DnsLeaksTest from '@/components/DnsLeaksTest.vue';
import SpeedTest from '@/components/SpeedTest.vue';
import AdvancedTools from '@/components/Advanced.vue';
import Footer from '@/components/Footer.vue';
import StandalonePageHeader from '@/components/StandalonePageHeader.vue';
import User from '@/components/User.vue';

// Section id → the component that page renders. The names must match
// RAIL_SECTION_PAGES in data/rail.js — the route only ever carries an id from
// that list. Static imports: these are the components the entry chunk already
// downloads, so lazifying them here buys a round trip for code that is on the
// wire anyway, and Vite says so at build time.
const SECTION_COMPONENTS = {
  IPInfo: IpInfos,
  Connectivity: ConnectivityTest,
  WebRTC: WebRtcTest,
  DNSLeakTest: DnsLeaksTest,
  SpeedTest,
  AdvancedTools,
};

const { t } = useI18n();
const route = useRoute();
const store = useMainStore();

const page = computed(() => SECTION_PAGE_BY_ID.get(route.meta.section) || null);

const sectionComponent = computed(() => SECTION_COMPONENTS[route.meta.section] ?? null);

// Per-page head: localized title + the section's own note as its description,
// canonical on this path. A section id the registry doesn't know about has no
// head to write, so the guard also keeps `useDocumentMeta` from pinning the
// homepage defaults over a page that rendered nothing.
useDocumentMeta(() => {
  if (!page.value) return {};
  return {
    title: `${t(page.value.titleKey)} · TrustMy.IP`,
    description: t(page.value.noteKey),
    canonical: `${window.location.origin}${route.path}`,
  };
});

// Whether this section starts its test on arrival without being asked. The
// per-module `autoRun*` switches used to gate the dashboard, which ran every
// module unprompted; the dashboard no longer hosts them, so the same preference
// now gates the page that does the work. A section with no `boot` at all
// (SpeedTest, AdvancedTools) is not started anywhere and keeps its Run control.
const AUTO_RUN_PREF = {
  Connectivity: 'autoRunConnectivity',
  WebRTC: 'autoRunWebRTC',
  DNSLeakTest: 'autoRunDnsLeak',
};

// Run this section's test on arrival, the way the dashboard's refresh
// orchestrator does. The wait is what makes it safe: the component owns the
// command and registers it at setup, but it arrives as an async chunk, so the
// dispatch has to happen after the owner exists.
const bootSection = () => {
  const boot = page.value?.boot;
  if (!boot) return;
  const pref = AUTO_RUN_PREF[route.meta.section];
  if (pref && store.userPreferences[pref] === false) return;
  waitForAppCommand(boot.command, { timeoutMs: 10000 })
    .then(() => dispatchAppCommand(boot.command, boot.payload))
    .catch((error) => {
      console.warn(`[standalone-section] ${boot.command} did not run:`, error);
    });
};

onMounted(bootSection);

// `/link` → `/dns` keeps this component mounted (one route record, different
// meta), so onMounted alone would boot only the first page visited.
watch(() => route.meta.section, bootSection);
</script>
