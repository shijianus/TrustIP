<!-- BrandWordmark — the TrustMy.IP lockup: the beacon mark, the split-weight
     wordmark (`Trust` bold + `My.IP` extralight) and the EpoCanvas publisher
     eyebrow. It owns the boot shimmer so every call site reads the same while
     the app is still loading; hosts keep their own link/button wrapper and
     colour (the mark inherits `fill`, the text inherits `color`). -->
<template>
  <span :class="['inline-flex items-center gap-1.5', TEXT[size]]">
    <brandIcon :class="ICON[size]" />
    <span class="tracking-tight truncate">
      <span class="font-bold">Trust</span><span class="font-extralight" :class="shimmerClass">My.IP</span>
    </span>
    <!-- Publisher credit. A styled span rather than <Badge>, which renders a
         div and this root is inline-level. Dropped on phones: the standalone
         header has to fit brand + breadcrumb + back button at 320px. Gated on
         the store rather than `hidden sm:inline-flex`, because the legacy
         `.hidden { display: none !important }` rule in style.css outranks the
         responsive utility and would hide it at every width. -->
    <span v-if="publisher && !isMobile"
      :class="cn(badgeVariants({ variant: 'outline' }), 'shrink-0 border-muted-foreground/40 py-0 font-semibold uppercase tracking-[0.14em] text-muted-foreground', EYEBROW[size])">EpoCanvas</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';
import brandIcon from '@/components/svgicons/Brand.vue';
import { badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useMainStore } from '@/store';

const props = defineProps({
  // Lockup scale. `md` is the header row (23px mark, text-lg); `sm` is for
  // tight chrome where the wordmark has to share a line with controls.
  size: {
    type: String,
    default: 'md',
    validator: (v) => v === 'md' || v === 'sm',
  },
  // While the app is still loading, the extralight half carries a sweeping
  // underline. Only the boot-time call sites pass it.
  loading: { type: Boolean, default: false },
  publisher: { type: Boolean, default: true },
});

const TEXT = { md: 'text-lg', sm: 'text-sm' };
// The mark ships at 23px; `size-*` on the root svg overrides its width/height
// attributes, which is how the compact lockup shrinks it.
const ICON = { md: 'size-[23px]', sm: 'size-4' };
const EYEBROW = { md: 'h-[18px] px-1.5 text-[10px]', sm: 'h-[15px] px-1 text-[9px]' };

const store = useMainStore();
const isDarkMode = computed(() => store.isDarkMode);
const isMobile = computed(() => store.isMobile);

const shimmerClass = computed(() => {
  if (!props.loading) return '';
  return isDarkMode.value ? 'jn-shimmer-dark' : 'jn-shimmer-light';
});
</script>

<style scoped>
.jn-shimmer-light,
.jn-shimmer-dark {
  position: relative;
  overflow: hidden;
  display: inline-flex;
}

.jn-shimmer-light::before,
.jn-shimmer-dark::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: -100%;
  width: 100%;
  height: 10%;
  animation: jn-shimmer-slide 1s linear infinite;
}

.jn-shimmer-light::before {
  background-color: rgb(0, 0, 0);
}

.jn-shimmer-dark::before {
  background-color: rgb(255, 255, 255);
}

@keyframes jn-shimmer-slide {
  from {
    left: -100%;
  }

  to {
    left: 100%;
  }
}
</style>
