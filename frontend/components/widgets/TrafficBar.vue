<template>
    <!-- One bar, two populations. The split is the answer; the pill above it
         names which side is larger. With no measurement the bar is drawn as
         the same shape in its empty state — hatched, no split — because a row
         that collapses to a sentence makes the panel look shorter than it is. -->
    <div class="flex w-full min-w-0 flex-col items-end gap-1">
        <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold" :class="pillClass">
            {{ text }}
        </span>
        <div class="flex h-1.5 w-full max-w-[140px] overflow-hidden rounded-full" :class="trackClass">
            <template v-if="hasValue">
                <div class="h-full bg-success" :style="{ width: `${value}%` }"></div>
                <div class="h-full flex-1 bg-destructive"></div>
            </template>
        </div>
    </div>
</template>

<script setup>
// The human-versus-automated traffic split for a network.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    // Percentage of traffic judged human, 0-100. Null when unmeasured.
    value: { type: Number, default: null },
});

const { t } = useI18n();

const hasValue = computed(() => Number.isFinite(props.value));
const text = computed(() => (hasValue.value
    ? t('dossier.traffic.pct', { n: Math.round(props.value) })
    : t('trustip.verdict.notMeasured')));
const pillClass = computed(() => (hasValue.value
    ? 'bg-success-soft text-success-soft-fg'
    : 'bg-muted text-muted-foreground'));
// Hatched rather than flat: an empty bar that looks like a 0 % reading is the
// single easiest mistake to make with a chart like this.
const trackClass = computed(() => (hasValue.value ? '' : 'jn-hatch'));
</script>
