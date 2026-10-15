<script setup>
// Skeleton — the placeholder a block shows while its data is on the way.
// A shimmer over the muted token (.jn-skeleton in style.css), not a spinner:
// it holds the exact footprint of the content that replaces it, so nothing
// jumps when the value lands (Material 3 / Apple "placeholder" pattern), and it
// stops moving under prefers-reduced-motion. Purely decorative — the region
// that owns it announces loading (aria-busy / role="status"), not each bar.
//   <Skeleton class="h-4 w-32" />
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <div data-slot="skeleton" aria-hidden="true" :class="cn('jn-skeleton h-4 w-full', $props.class)" />
</template>
