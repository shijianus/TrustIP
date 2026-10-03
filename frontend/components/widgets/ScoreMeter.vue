<template>
    <div class="w-32 shrink-0" role="img" :aria-label="ariaLabel">
        <!-- Five cells, filled up to the address's band, all in that band's
             colour. A continuous gradient would show a position; this shows a
             verdict — and the two disagree the moment the number and the
             category are drawn from different scales, which a rainbow ramp
             beside a five-band ladder inevitably does. -->
        <div class="flex gap-1">
            <span
                v-for="n in 5"
                :key="n"
                class="h-3 flex-1 rounded-[2px] transition-colors"
                :class="n <= band ? fillClass : 'bg-muted'"></span>
        </div>

        <!-- The part this panel is honest about: how far down the score could
             have gone had every signal it could not measure resolved against
             the address. A whisker that shrinks as evidence accumulates is the
             difference between a measurement and a guess. -->
        <div class="relative mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <span
                class="absolute inset-y-0 rounded-full"
                :class="rangeClass"
                :style="rangeStyle"></span>
        </div>

        <div class="mt-1 flex justify-between text-[0.6rem] leading-none text-muted-foreground">
            <span>{{ t('trustip.meter.low') }}</span>
            <span v-if="capped" class="font-semibold">{{ t('trustip.meter.' + capped) }}</span>
            <span>{{ t('trustip.meter.high') }}</span>
        </div>
    </div>
</template>

<script setup>
// The trust score's meter: a five-band ladder plus an uncertainty whisker.
//
// Sits beside the number rather than replacing it — the ladder is for reading
// at a glance across many lookups, the number is for comparing two.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    band: { type: Number, required: true },
    score: { type: Number, required: true },
    // Worst case the same evidence could have supported, from the engine's
    // per-signal worst-case table.
    floor: { type: Number, default: null },
    // Why the displayed score sits under what the evidence would otherwise
    // total: `disqualified` (a routing contradiction caps it) or `evidence`
    // (too little was measurable to claim a high band).
    capped: { type: String, default: null },
});

const { t } = useI18n();

const BAND_FILL = {
    1: 'bg-trust-1',
    2: 'bg-trust-2',
    3: 'bg-trust-3',
    4: 'bg-trust-4',
    5: 'bg-trust-5',
};

const BAND_RANGE = {
    1: 'bg-trust-1/45',
    2: 'bg-trust-2/45',
    3: 'bg-trust-3/45',
    4: 'bg-trust-4/45',
    5: 'bg-trust-5/45',
};

const fillClass = computed(() => BAND_FILL[props.band] || 'bg-muted');
const rangeClass = computed(() => BAND_RANGE[props.band] || 'bg-muted-foreground/40');

const rangeStyle = computed(() => {
    const floor = typeof props.floor === 'number' ? Math.min(props.floor, props.score) : props.score;
    const left = (floor / 100) * 100;
    const width = Math.max(0, ((props.score - floor) / 100) * 100);
    return { left: `${left}%`, width: `${width}%` };
});

const ariaLabel = computed(() =>
    `${props.score}/100 — ${t(`trustip.band.${props.band}`)}${props.floor != null && props.floor < props.score ? `, ≥ ${props.floor}` : ''}`);
</script>
