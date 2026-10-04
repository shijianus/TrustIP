<template>
    <!-- The frame is drawn whether or not anything fills it: axes, the plot
         band, the day labels at either end. An empty chart with its axes is
         legible as "nothing recorded"; an empty div is legible as broken. -->
    <div class="min-w-0">
        <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img" :aria-label="aria">
            <defs>
                <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style="stop-color: var(--action)" stop-opacity="0.30" />
                    <stop offset="100%" style="stop-color: var(--action)" stop-opacity="0.02" />
                </linearGradient>
            </defs>

            <line
                v-for="(y, i) in gridYs" :key="'g' + i"
                :x1="PAD_L" :y1="y" :x2="W - PAD_R" :y2="y"
                class="stroke-muted-foreground/12" stroke-width="1" stroke-dasharray="2 4" />

            <template v-if="hasSeries">
                <path :d="areaPath" :fill="`url(#${gradId})`" />
                <path :d="linePath" fill="none" class="stroke-action" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
                <g v-for="(p, i) in plotted" :key="'p' + i">
                    <circle :cx="p.x" :cy="p.y" r="2.4" class="fill-action">
                        <title>{{ p.label }}</title>
                    </circle>
                </g>
                <g :transform="`translate(${peak.x} ${peak.y})`">
                    <circle r="4.6" class="fill-none stroke-action" stroke-width="1.4" />
                    <text y="-9" text-anchor="middle" class="text-[9px] font-semibold fill-foreground">
                        {{ t('dossier.heat.peak', { v: peak.v, d: peak.short }) }}
                    </text>
                </g>
            </template>

            <rect
                v-else
                :x="PAD_L" :y="PAD_T" :width="W - PAD_L - PAD_R" :height="H - PAD_T - PAD_B"
                class="jn-hatch fill-none stroke-muted-foreground/20" stroke-width="1" rx="4" />

            <text v-if="!hasSeries" :x="W / 2" :y="H / 2 + 3" text-anchor="middle"
                class="text-[8px] fill-muted-foreground">
                {{ emptyLabel }}
            </text>

            <text :x="PAD_L" :y="H - 4" class="text-[9px] fill-muted-foreground">{{ firstLabel }}</text>
            <text :x="W - PAD_R" :y="H - 4" text-anchor="end" class="text-[9px] fill-muted-foreground">{{ lastLabel }}</text>
        </svg>
    </div>
</template>

<script setup>
// A daily trend line for a network block, drawn from whatever observations
// exist. Nothing observes anything per prefix yet, so in this build the empty
// branch is the one that renders — and it renders the same axes, the same plot
// band and the same day range, so the section is finished work awaiting a
// source rather than a stub.
//
// The curve is a Catmull-Rom spline flattened to cubic Béziers rather than
// straight segments: a daily count that steps at every sample reads as a
// broken axis, and the shape people expect from a trend is a continuous one.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    // [{ day: 'YYYY-MM-DD', value: 0-100 }] oldest first.
    points: { type: Array, default: () => [] },
    emptyLabel: { type: String, default: '' },
});

const { t } = useI18n();

const W = 320;
const H = 118;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 16;
const PAD_B = 16;
const gradId = `jn-trend-${Math.random().toString(36).slice(2, 8)}`;

const shortDay = (day) => {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(day || '');
    return m ? `${Number(m[1])}/${Number(m[2])}` : (day || '');
};

const series = computed(() => props.points.filter((p) => Number.isFinite(p?.value)));
const hasSeries = computed(() => series.value.length > 1);
const gridYs = computed(() => [0.25, 0.5, 0.75].map((f) => PAD_T + (H - PAD_T - PAD_B) * f));

const plotted = computed(() => {
    const n = series.value.length;
    const span = H - PAD_T - PAD_B;
    const max = Math.max(...series.value.map((p) => p.value)) || 1;
    return series.value.map((p, i) => ({
        x: PAD_L + (n === 1 ? 0 : (i * (W - PAD_L - PAD_R)) / (n - 1)),
        y: PAD_T + span - (p.value / max) * span,
        v: p.value,
        short: shortDay(p.day),
        label: `${shortDay(p.day)} · ${p.value}`,
    }));
});

const peak = computed(() => plotted.value.reduce((best, p) => (p.v > best.v ? p : best), plotted.value[0] || { x: 0, y: 0, v: 0, short: '' }));
const firstLabel = computed(() => shortDay(series.value[0]?.day) || '');
const lastLabel = computed(() => shortDay(series.value[series.value.length - 1]?.day) || '');
const aria = computed(() => (hasSeries.value
    ? t('dossier.heat.aria', { n: series.value.length, peak: peak.value.v })
    : props.emptyLabel));

// Catmull-Rom through the sample points, emitted as cubic Béziers. The
// 1/6 factor is the standard tension for a uniform parameterisation.
const linePath = computed(() => {
    const pts = plotted.value;
    if (pts.length < 2) return '';
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        d += ` C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6},`
            + `${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6},${p2.x} ${p2.y}`;
    }
    return d;
});

const areaPath = computed(() => {
    if (!linePath.value) return '';
    const base = H - PAD_B;
    const pts = plotted.value;
    return `${linePath.value} L${pts[pts.length - 1].x} ${base} L${pts[0].x} ${base} Z`;
});
</script>
