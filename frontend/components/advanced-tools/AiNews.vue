<template>
  <!-- Two lists, and the difference between them is the point.
       First, headlines: what AI vendors and tech outlets published in their own
       RSS / Atom feeds, read server-side (/api/ai-news) because a browser cannot
       read a feed across origins. Every row links to the publisher's page; the
       summary is the feed's own first lines, never something this build wrote.
       Second, incidents: what the services this site measures said about their own
       outages on their status pages. -->
  <div class="ai-news-section my-4 space-y-4">
    <p class="text-sm text-muted-foreground leading-relaxed">{{ t('ainews.Note') }}</p>

    <!-- ── Headlines ── -->
    <div v-if="news.items.length" class="space-y-3">
      <SectionTitle :title="t('ainews.EditorialTitle')">
        <template #aside>
          <span v-if="news.updatedAt" class="text-xs font-normal text-muted-foreground">
            {{ t('ainews.Updated', { time: formatDate(news.updatedAt) }) }}
          </span>
        </template>
      </SectionTitle>
      <ToggleGroup
        :model-value="newsTag"
        type="single"
        variant="outline"
        :spacing="2"
        class="w-full flex-wrap justify-start"
        @update:model-value="(v) => v && (newsTag = v)"
      >
        <ToggleGroupItem value="all" :class="tagClass">{{ t('ainews.TagAll') }}</ToggleGroupItem>
        <ToggleGroupItem v-for="row in news.tags" :key="row.tag" :value="row.tag" :class="tagClass">
          {{ row.tag }}
          <span class="ms-1 jn-nums text-xs font-normal text-muted-foreground">{{ row.count }}</span>
        </ToggleGroupItem>
      </ToggleGroup>
      <div class="jn-card rounded-[var(--radius)] overflow-hidden">
        <ul class="divide-y">
          <li v-for="item in visibleNews" :key="item.id" class="px-4 py-3">
            <p class="text-sm font-medium leading-relaxed">
              <a :href="item.link" target="_blank" rel="noopener noreferrer"
                class="underline-offset-2 hover:underline">{{ item.title }}</a>
            </p>
            <p v-if="item.summary" class="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-2">{{ item.summary }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-2">
              <span class="jn-nums text-xs font-normal text-muted-foreground">{{ formatDay(item.publishedAt) }}</span>
              <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
                :title="item.via ? t('ainews.Via', { via: item.via }) : null">{{ item.sourceName }}</span>
              <span v-for="tagName in item.tags" :key="tagName"
                class="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{{ tagName }}</span>
            </div>
          </li>
        </ul>
      </div>
      <p class="text-xs font-normal text-muted-foreground leading-relaxed">
        {{ t('ainews.Sources', { list: sourceList }) }}
        <template v-if="failedSources">· {{ t('ainews.SourcesFailed', { list: failedSources }) }}</template>
      </p>
    </div>
    <CapabilitySlot
      v-else-if="!newsLoading"
      :title="t('ainews.EditorialTitle')"
      state="placeholder"
      :note="t('ainews.EditorialNote')"
      :needs="t('ainews.EditorialNeeds')"
    />

    <!-- ── Vendor incidents ── -->
    <SectionTitle :title="t('ainews.IncidentsTitle')" />
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="action" :disabled="loading || newsLoading" @click="() => { load(); loadNews(); }">
        <Spinner v-if="loading" class="size-4" />
        {{ loading ? t('ainews.Loading') : t('ainews.Refresh') }}
      </Button>
      <span v-if="updatedAt" class="text-xs font-normal text-muted-foreground">
        {{ t('ainews.Updated', { time: formatDate(updatedAt) }) }}
      </span>
    </div>

    <!-- An open-ended facet row: a wrapping group of detached pills, never the
         connected default form whose seam breaks as soon as it wraps. -->
    <ToggleGroup
      :model-value="tag"
      type="single"
      variant="outline"
      :spacing="2"
      class="w-full flex-wrap justify-start"
      @update:model-value="(v) => v && (tag = v)"
    >
      <ToggleGroupItem value="all" :class="tagClass">{{ t('ainews.TagAll') }}</ToggleGroupItem>
      <ToggleGroupItem
        v-for="category in categories"
        :key="category.id"
        :value="category.id"
        :class="tagClass"
      >
        {{ t(`ainews.tag.${category.id}`) }}
        <span class="ms-1 jn-nums text-xs font-normal text-muted-foreground">{{ category.count }}</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <div v-if="fetchFailed" class="rounded-lg border border-destructive-soft bg-destructive-soft px-4 py-3">
      <p class="text-sm leading-relaxed text-destructive-soft-fg">{{ t('ainews.Failed') }}</p>
    </div>

    <template v-else>
      <div v-if="visible.length" class="jn-card rounded-[var(--radius)] overflow-hidden">
        <ul class="divide-y">
          <li v-for="item in visible" :key="item.key" class="px-4 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {{ item.providerName }}
              </span>
              <VerdictChip :tone="toneOf(item)" :label="statusLabel(item.status)" />
              <span v-if="impactOf(item) > 0" class="inline-flex items-center" :title="indicatorLabel(item.impact)">
                <TriangleAlert v-for="n in impactOf(item)" :key="n" class="size-3 me-0.5" />
              </span>
              <span class="ms-auto jn-nums text-xs font-normal text-muted-foreground">
                {{ formatDate(item.startedAt) }}
              </span>
            </div>
            <p class="mt-1.5 text-sm leading-relaxed">
              <a
                :href="item.url || item.providerPage"
                target="_blank"
                rel="noopener noreferrer"
                class="underline-offset-2 hover:underline"
              >{{ item.name }}</a>
            </p>
          </li>
        </ul>
      </div>

      <!-- Nothing to report is an answer, not an absence: the providers that are
           green are counted, so "no incidents" is a statement about them. -->
      <div v-else-if="!loading" class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('ainews.QuietTitle')">
          <template #aside>
            <VerdictChip tone="ok" :label="t('ainews.QuietChip', { n: healthyCount })" />
          </template>
        </SectionTitle>
        <p class="text-sm leading-relaxed text-muted-foreground">{{ t('ainews.QuietNote') }}</p>
        <dl class="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <template v-for="provider in providers" :key="provider.id">
            <KeyRow :label="provider.name" :value="indicatorText(provider.indicator)" :tone="indicatorTone(provider.indicator)" />
          </template>
        </dl>
      </div>
    </template>

    <p class="text-xs font-normal text-muted-foreground leading-relaxed">{{ t('ainews.Caveat') }}</p>
  </div>
</template>

<script setup>
// The AI news surface: publisher headlines from `/api/ai-news` (the feeds and
// their parser live in common/ai-news.js), then the incidents from the status
// pages this deployment already polls.
//
// Two snapshot-read endpoints, both already built for the Service Status board:
// `/api/service-status` returns every provider's light, and `/api/service-status/
// detail` returns one provider's incidents. Neither reaches upstream on a request —
// the back end refreshes on its own five-minute schedule — so pulling every
// provider's detail from here is a memory read each, not a vendor hit each.
//
// Deliberately absent: any story this build wrote itself. A row exists only because
// a publisher or vendor published it, and the row links to the page it came from.

import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TriangleAlert } from '@lucide/vue';

import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { unixToDateTime, formatIsoDate } from '@/utils/time-utils.js';
import {
  indicatorToTone, incidentStatusTone, impactLevel,
} from '@/utils/service-status-tone.js';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import CapabilitySlot from '@/components/widgets/CapabilitySlot.vue';

const { t, locale } = useI18n();

// A provider's facet comes from the overview (`category`, set in
// common/service-status-providers.js). A tag is never shown for a category with
// nothing in it.
const categoryOf = (providerId) => providers.value.find((p) => p.id === providerId)?.category || null;

const tagClass = 'group h-7 rounded-full px-2.5 text-xs cursor-pointer';

const loading = ref(true);
const fetchFailed = ref(false);
const updatedAt = ref(null);
const providers = ref([]);
const incidents = ref([]);
const tag = ref('all');

// Publisher headlines. A failed read leaves the list empty and the slot below
// states the gap; it never blocks the incidents list.
const newsLoading = ref(true);
const news = ref({ updatedAt: null, items: [], tags: [], sources: [] });
const newsTag = ref('all');

const loadNews = async () => {
  newsLoading.value = true;
  try {
    const res = await fetchWithTimeout('/api/ai-news', { timeoutMs: 30000 });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    news.value = {
      updatedAt: body.updatedAt || null,
      items: Array.isArray(body.items) ? body.items : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      sources: Array.isArray(body.sources) ? body.sources : [],
    };
  } catch (err) {
    console.warn('ai news feeds unavailable', err);
    news.value = { updatedAt: null, items: [], tags: [], sources: [] };
  } finally {
    newsLoading.value = false;
  }
};

const visibleNews = computed(() => (newsTag.value === 'all'
  ? news.value.items
  : news.value.items.filter((item) => item.tags?.includes(newsTag.value))));
const sourceList = computed(() => news.value.sources.filter((s) => s.ok)
  .map((s) => (s.via ? `${s.name} (${t('ainews.Via', { via: s.via })})` : s.name)).join(' · '));
const failedSources = computed(() => news.value.sources.filter((s) => !s.ok).map((s) => s.name).join(' · '));

const load = async () => {
  loading.value = true;
  fetchFailed.value = false;
  try {
    const res = await fetchWithTimeout('/api/service-status', { timeoutMs: 10000 });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const overview = await res.json();
    const list = Array.isArray(overview.providers) ? overview.providers : [];
    providers.value = list;
    updatedAt.value = overview.updatedAt || null;

    // Details are per-provider because the overview deliberately omits the heavier
    // arrays. A provider whose detail read failed simply contributes no rows — its
    // light still shows in the quiet panel below.
    const details = await Promise.allSettled(
      list.map((provider) => fetchWithTimeout(
        `/api/service-status/detail?id=${encodeURIComponent(provider.id)}`,
        { timeoutMs: 10000 },
      ).then(async (detailRes) => (detailRes.ok ? detailRes.json() : null))),
    );
    incidents.value = details.flatMap((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return [];
      const provider = list[i];
      return (result.value.incidents || []).map((incident) => ({
        ...incident,
        key: `${provider.id}:${incident.id}`,
        providerId: provider.id,
        providerName: provider.name,
        providerPage: provider.page,
      }));
    });
  } catch (err) {
    console.warn('service status unavailable', err);
    fetchFailed.value = true;
    providers.value = [];
    incidents.value = [];
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  load();
  loadNews();
});

const categories = computed(() => {
  const counts = new Map();
  for (const provider of providers.value) {
    const { category } = provider;
    if (!category) continue;
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
});

const sortedIncidents = computed(() => [...incidents.value]
  .sort((a, b) => (Date.parse(b.startedAt ?? '') || 0) - (Date.parse(a.startedAt ?? '') || 0)));

const visible = computed(() => (tag.value === 'all'
  ? sortedIncidents.value
  : sortedIncidents.value.filter((item) => categoryOf(item.providerId) === tag.value)));

const healthyCount = computed(() => providers.value.filter((p) => p.indicator === 'none').length);

// ── Labels ───────────────────────────────────────────────────────────────────

const toneOf = (item) => incidentStatusTone(item.status);

const statusLabel = (status) => {
  if (!status) return '';
  const key = `serviceStatus.incidentStatus.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

const impactOf = (item) => impactLevel(item.impact);

const indicatorLabel = (impact) => {
  const key = `serviceStatus.indicator.${impact}`;
  const label = t(key);
  return label === key ? impact : label;
};

const indicatorText = (indicator) => indicatorLabel(indicator || 'unknown');
const indicatorTone = (indicator) => indicatorToTone(indicator);

const formatDate = (iso) => unixToDateTime(Date.parse(iso ?? ''), locale.value);
const formatDay = (iso) => formatIsoDate(iso ? String(iso).slice(0, 10) : '', locale.value);
</script>
