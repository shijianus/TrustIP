<!-- NavRail — the flat route rail: every tool one page deep, one click away
     from any page that carries it. Rendered by the dashboard's fixed header
     (Nav.vue) and by the standalone pages' sticky header
     (StandalonePageHeader.vue); the destination list, the labels, where each
     item links and what reads as current all live in data/rail.js, so this file
     holds no navigation data of its own. One thing it does decide: while the
     visitor is on the dashboard, an item naming one of its sections scrolls to
     that section instead of navigating away — the destination the old anchor
     row had, kept next to the page the same section now has too.

     Two density tricks keep ten items readable from 320px up (both driven by
     one breakpoint, below, so they cannot drift apart):
       1. every item renders both its full and its short label and CSS picks
          one — the row never wraps and never hides an item to fit. The pair
          comes from the data (`rail.full.<id>` / `rail.short.<id>`), not from
          an attribute selector keyed on a pathname.
       2. under the breakpoint the row is a horizontal strip: hidden
          scrollbar, a right-edge mask fade so it reads as scrollable,
          proximity snap, and the current item scrolled into view on arrival.
     The row is scrollable at every width — an overflowing header is a dead
     end — but the fade only appears where the strip is the intended
     interaction.

     Focus rings stay visible on purpose: `*:focus { outline: none }` in
     style.css would otherwise leave keyboard visitors with no rail at all, so
     each link carries a `:focus-visible` ring on the `--ring` token. -->
<template>
  <nav class="jn-rail mx-auto w-full max-w-[1600px] px-3 sm:px-4" :aria-label="t('nav.Navigation')">
    <ul ref="listRef" class="jn-rail-list flex h-10 items-center gap-0.5">
      <li v-for="item in RAIL_ITEMS" :key="item.id" class="jn-rail-item">
        <RouterLink :to="railTarget(item)"
          :aria-current="isActive(item) ? 'page' : undefined"
          :class="linkClass(isActive(item))">
          <span class="jn-rail-label-full">{{ t(`rail.full.${item.id}`) }}</span>
          <span class="jn-rail-label-short">{{ t(`rail.short.${item.id}`) }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { RAIL_ITEMS, resolveRail, resolveRailTarget } from '@/data/rail.js';

const { t } = useI18n();
const route = useRoute();

const listRef = ref(null);

// What this item links to: its own page. Every rail item is a route now that
// `/` no longer hosts the sections, so there is no scroll case left to branch
// on. data/rail.js owns the rule; this is the one place it is read.
const railTarget = (item) => resolveRailTarget(item);

// The path decides which item reads as current, on every route including `/`.
const activeId = computed(() => resolveRail(route.path)?.id ?? null);

const isActive = (item) => item.id === activeId.value;

// Same shape as the old anchor row — `bg-accent` for the current destination,
// muted + hover tint otherwise — so the header reads as one system.
const linkClass = (active) => [
  'block whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium no-underline transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
];

// Bring the current item into the strip on arrival. Two guards, because a page
// load must never move the page: the row only acts when it genuinely scrolls,
// and `block: 'nearest'` means the vertical axis is left alone whenever the row
// is already on screen (which it always is — both headers pin to the top).
const scrollActiveIntoView = () => {
  const list = listRef.value;
  if (!list || list.clientWidth >= list.scrollWidth) return;
  const active = list.querySelector('[aria-current="page"]');
  if (!active) return;
  active.scrollIntoView({ inline: 'center', block: 'nearest' });
};

onMounted(() => nextTick(scrollActiveIntoView));
watch(activeId, () => nextTick(scrollActiveIntoView));
</script>

<style scoped>
/* One breakpoint, 580px: below it the short labels show and the strip gets its
   fade. A media query rather than Tailwind utilities because the mask, the
   hidden scrollbar and the snap trio have no readable utility form here, and
   keeping the label swap in the same block is what stops the two tricks from
   drifting onto different widths. */
.jn-rail-label-short {
  display: none;
}

/* Never shrink, never wrap: an item that gave way under pressure would defeat
   the point of a scrollable row. */
.jn-rail-list {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scroll-snap-type: x proximity;
}

.jn-rail-list::-webkit-scrollbar {
  display: none;
}

.jn-rail-item {
  flex: 0 0 auto;
  scroll-snap-align: start;
}

@media (max-width: 580px) {
  .jn-rail-label-full {
    display: none;
  }

  .jn-rail-label-short {
    display: inline;
  }

  /* Right-edge fade: the last visible item dissolves into the viewport, which
     is what tells a visitor the row continues. */
  .jn-rail-list {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
  }
}
</style>
