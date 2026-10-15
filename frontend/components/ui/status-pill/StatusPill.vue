<script setup>
// StatusPill — a state shown as icon + text on a tinted well, never colour
// alone (WCAG 1.4.1; Apple HIG and Material both pair status hue with a
// glyph). Each tone uses the theme's `-soft` / `-soft-fg` pair, which clears
// 4.5:1 in both themes, so the pill reads the same in light and dark.
//   <StatusPill tone="success">OK</StatusPill>
//   <StatusPill tone="warning" :icon="false">Slow</StatusPill>
import { computed } from 'vue';
import { CircleCheck, TriangleAlert, CircleX, Info, CircleDashed, LoaderCircle } from '@lucide/vue';
import { cn } from '@/lib/utils';

const props = defineProps({
  // success | warning | error | info | neutral | pending
  tone: { type: String, default: 'neutral' },
  // false hides the glyph (only where the text alone already names the state)
  icon: { type: Boolean, default: true },
  size: { type: String, default: 'sm' }, // sm | md
  class: { type: [String, Array, Object], default: undefined },
});

const TONES = {
  success: { cls: 'bg-success-soft text-success-soft-fg', glyph: CircleCheck },
  warning: { cls: 'bg-warning-soft text-warning-soft-fg', glyph: TriangleAlert },
  error: { cls: 'bg-destructive-soft text-destructive-soft-fg', glyph: CircleX },
  info: { cls: 'bg-info-soft text-info-soft-fg', glyph: Info },
  pending: { cls: 'bg-muted text-muted-foreground', glyph: LoaderCircle },
  neutral: { cls: 'bg-muted text-muted-foreground', glyph: CircleDashed },
};
const spec = computed(() => TONES[props.tone] || TONES.neutral);
</script>

<template>
  <span data-slot="status-pill" :data-tone="tone"
    :class="cn('inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap jn-nums',
      size === 'md' ? 'h-7 px-2.5 text-sm' : 'h-5 px-2 text-xs', spec.cls, props.class)">
    <component :is="spec.glyph" v-if="icon" aria-hidden="true"
      :class="[size === 'md' ? 'size-4' : 'size-3.5', 'shrink-0', tone === 'pending' && 'animate-spin']" />
    <slot />
  </span>
</template>
