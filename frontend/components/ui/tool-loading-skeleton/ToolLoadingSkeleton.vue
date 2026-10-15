<template>
    <!-- w-screen gives the skeleton intrinsic width — the drawer canvas is
         width:fit-content and would collapse to zero without it; max-w-full
         clamps it back inside any container.
         Shaped like a tool page — an intro paragraph, an input row with its
         run button, then a result card — so the layout does not jump when
         the tool lands. Shimmer (.jn-skeleton) instead of animate-pulse: it
         stops under prefers-reduced-motion, and it reads as "loading", not
         "disabled". -->
    <div class="w-screen max-w-full space-y-6 py-4" role="status" aria-busy="true"
        :aria-label="t('uikit.loading')">
        <SkeletonText :lines="3" />
        <div class="flex items-center gap-2">
            <Skeleton class="h-9 flex-1 rounded-md" />
            <Skeleton class="h-9 w-12 rounded-md" />
        </div>
        <div class="space-y-4 rounded-lg border bg-card p-6 shadow-card">
            <Skeleton class="h-4 w-1/3" />
            <SkeletonText :lines="4" />
        </div>
        <span class="sr-only">{{ t('uikit.loading') }}</span>
    </div>
</template>

<script setup>
// Chunk-download placeholder for lazy tool components (Advanced.vue drawer
// + StandaloneTool.vue). A skeleton, not a spinner: tools run their own
// spinners after mount, and two near-identical spinners read as a glitch.
import { useI18n } from 'vue-i18n';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

const { t } = useI18n();
</script>
