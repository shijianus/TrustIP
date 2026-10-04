<template>
    <!-- One ring, one judgement. The arc is the value; when there is no value
         the ring stays whole but hollow, so an unmeasured scenario keeps its
         place in the row instead of becoming a gap in the layout. -->
    <div class="flex flex-col items-center gap-1">
        <div class="relative" :style="{ width: size + 'px', height: size + 'px' }">
            <svg viewBox="0 0 40 40" class="size-full -rotate-90" role="img" :aria-label="aria">
                <circle
                    cx="20" cy="20" r="16" fill="none" stroke-width="4"
                    class="stroke-muted-foreground/15" />
                <circle
                    v-if="hasValue"
                    cx="20" cy="20" :r="16" fill="none" stroke-width="4" stroke-linecap="round"
                    :stroke-dasharray="`${arc} ${CIRCUMFERENCE - arc}`"
                    stroke-dashoffset="0"
                    :class="arcClass" />
                <circle
                    v-else
                    cx="20" cy="20" r="16" fill="none" stroke-width="4" stroke-linecap="round"
                    stroke-dasharray="3 5" class="stroke-muted-foreground/30" />
            </svg>
            <div class="absolute inset-0 flex items-center justify-center">
                <span v-if="hasValue" class="jn-nums text-[13px] leading-none font-bold" :class="textClass">
                    {{ value }}
                </span>
                <span v-else class="text-[13px] leading-none text-muted-foreground">·</span>
            </div>
        </div>
        <span class="text-[11px] leading-none font-medium text-muted-foreground">{{ label }}</span>
    </div>
</template>

<script setup>
// A single judgement rendered as a ring — the scenario row's unit.
//
// The dashed hollow ring is the not-measured state and it is deliberately
// distinct from a full one at 0: "we do not look at this" and "we looked and
// found nothing" are different answers, and a reader who cannot tell them apart
// will act on the wrong one.

import { computed } from 'vue';

const props = defineProps({
    label: { type: String, required: true },
    value: { type: Number, default: null },
    // ok / warn / bad / muted — the same four the verdict chips speak.
    tone: { type: String, default: 'muted' },
    size: { type: Number, default: 52 },
});

const CIRCUMFERENCE = 2 * Math.PI * 16;

const hasValue = computed(() => Number.isFinite(props.value));
const arc = computed(() => (Math.max(0, Math.min(100, props.value ?? 0)) / 100) * CIRCUMFERENCE);
const arcClass = computed(() => ({
    ok: 'fill-none stroke-success',
    warn: 'fill-none stroke-warning',
    bad: 'fill-none stroke-destructive',
    muted: 'fill-none stroke-muted-foreground',
}[props.tone] || 'fill-none stroke-muted-foreground'));
const textClass = computed(() => ({
    ok: 'text-success-soft-fg',
    warn: 'text-warning-soft-fg',
    bad: 'text-destructive-soft-fg',
    muted: 'text-muted-foreground',
}[props.tone] || 'text-muted-foreground'));

const aria = computed(() => (hasValue.value ? `${props.label}: ${props.value}` : `${props.label}: —`));
</script>
