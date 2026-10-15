<template>
  <!-- Standalone page for a single advanced tool, reached at /tools/:slug
       (new-window / shareable / crawlable) or at the rail's short alias of it
       (`/ping`, `/status`, `/whois`). Renders the exact same tool component
       the drawer does, just inside a minimal page chrome instead of the
       homepage + drawer. -->
  <div class="flex min-h-screen flex-col">
    <!-- User system dialogs host (Benefits & Usage) — the sign-in gated tools
         link to it from their quota hints, and it fetches the user's usage
         snapshot so their frontend quota gate works here too. -->
    <User />

    <!-- Slim header: brand → home, current tool breadcrumb, back link, rail. -->
    <StandalonePageHeader :title="tool ? `${tool.emoji} ${t(tool.titleKey)}` : ''" rail />

    <!-- Content: an <h1> for the tool (SEO), then the tool body itself -->
    <main class="flex-1">
      <div class="mx-auto w-full max-w-[1000px] px-5 py-6 max-[480px]:px-3 max-[480px]:py-4">
        <h1 v-if="tool" class="jn-text-display mb-4 flex items-center gap-2">
          <span aria-hidden="true">{{ tool.emoji }}</span>
          {{ t(tool.titleKey) }}
        </h1>
        <component :is="toolComponent" v-if="toolComponent" v-bind="tool.props" />
      </div>
    </main>

    <Footer />
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { TOOL_BY_SLUG } from '@/data/tools.js';
import { useDocumentMeta } from '@/composables/use-document-meta.js';
import Footer from '@/components/Footer.vue';
import StandalonePageHeader from '@/components/StandalonePageHeader.vue';
import User from '@/components/User.vue';
import { ToolLoadingSkeleton } from '@/components/ui/tool-loading-skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// noStandalone tools are blacklisted from this page entirely — they depend on
// homepage state, so the drawer on the homepage is their only home.
//
// The slug arrives either from the path (`/tools/:slug`) or from `meta.tool`
// (the rail's short alias, e.g. `/ping` → `pingtest` — see data/rail.js and
// router/index.js). The alias is the same route record, so nothing else here
// branches on which form the visitor used.
const registered = TOOL_BY_SLUG.get(route.params.slug ?? route.meta.tool) || null;
const tool = computed(() => (registered && !registered.noStandalone ? registered : null));

// The skeleton covers the chunk download — same treatment as the homepage
// drawer; `delay` keeps fast loads flash-free.
//
// A chunk that fails to download (dropped connection, or a deploy replaced the
// hashed file mid-visit) used to leave the page blank under its title. It now
// lands on an error state that says so and offers Retry. Retry reloads the
// page rather than re-calling the loader: the browser's module map remembers
// a failed dynamic import for the life of the document, and after a deploy
// only a fresh document knows the new chunk names.
const ToolLoadError = () => h(EmptyState, {
    tone: 'error',
    description: t('uikit.loadFailedBody'),
    class: 'rounded-lg border bg-card shadow-card',
    onRetry: () => window.location.reload(),
});

const toolComponent = computed(() => (tool.value
    ? defineAsyncComponent({
        loader: tool.value.component,
        loadingComponent: ToolLoadingSkeleton,
        errorComponent: ToolLoadError,
        delay: 200,
    })
    : null));

// Per-tool head: localized title + description, self-referential canonical.
useDocumentMeta(() => {
  if (!tool.value) return {};
  return {
    title: `${t(tool.value.titleKey)} · IPCheck.ing`,
    description: t(tool.value.noteKey),
    canonical: `${window.location.origin}/tools/${tool.value.slug}`,
  };
});

// Unknown slug → bounce to the homepage rather than show an empty shell; a
// blacklisted tool keeps its destination by reopening as the homepage drawer.
if (!tool.value) {
    router.replace(registered?.noStandalone
        ? { path: '/', query: { tool: registered.slug } }
        : '/');
}
</script>
