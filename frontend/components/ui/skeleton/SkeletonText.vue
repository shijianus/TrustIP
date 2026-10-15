<script setup>
// A paragraph-shaped skeleton: `lines` bars, the last one shorter, on the
// 8px rhythm. For a block whose final height is "a few lines of text".
import { computed } from 'vue';
import { cn } from '@/lib/utils';
import Skeleton from './Skeleton.vue';

const props = defineProps({
  lines: { type: Number, default: 3 },
  class: { type: [String, Array, Object], default: undefined },
});

// Widths cycle so a stack never reads as a solid block; the last line is the
// short one, the way real text ends.
const WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-5/6'];
const rows = computed(() => Array.from({ length: Math.max(1, props.lines) }, (_, i) => (
  i === props.lines - 1 && props.lines > 1 ? 'w-3/5' : WIDTHS[i % WIDTHS.length]
)));
</script>

<template>
  <div data-slot="skeleton-text" aria-hidden="true" :class="cn('flex flex-col gap-2', props.class)">
    <Skeleton v-for="(w, i) in rows" :key="i" :class="['h-3.5', w]" />
  </div>
</template>
