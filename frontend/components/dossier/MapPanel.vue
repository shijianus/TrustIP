<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.map.panelTitle')">
            <template #aside>
                <span class="jn-nums text-xs text-muted-foreground">
                    {{ t('dossier.map.others', { n: others.length }) }}
                </span>
            </template>
        </SectionTitle>

        <p v-if="!primary" class="text-sm text-muted-foreground">{{ t('dossier.map.none') }}</p>

        <a
            v-else
            :href="`https://www.google.com/maps?q=${primary.lat},${primary.lon}`"
            target="_blank" rel="nofollow noopener"
            class="group block">
            <!-- Two maps, one data set. The big one is the same equirectangular
                 coastline paths with a window punched into them — a viewBox a
                 quarter of the world's width, centred on the fix — so the zoom
                 cannot disagree with the coordinates beside it. The inset keeps
                 the window in its global context, which is the only reason a
                 zoomed map is not just a crop. -->
            <div class="relative overflow-hidden rounded-md border bg-info-soft">
                <svg :viewBox="window" class="block aspect-2/1 w-full" role="img"
                    :aria-label="t('dossier.map.aria', { place })">
                    <g fill-rule="evenodd" class="fill-success-soft/55 stroke-success-soft-fg/35" :stroke-width="stroke">
                        <path v-for="(d, i) in land" :key="'l' + i" :d="d" />
                    </g>
                    <g :stroke-width="grid">
                        <line v-for="m in meridians" :key="'m' + m" :x1="m" :y1="win.y" :x2="m" :y2="win.y + WIN_H" class="stroke-muted-foreground/20" />
                        <line v-for="p in parallels" :key="'p' + p" :x1="win.x" :y1="p" :x2="win.x + WIN_W" :y2="p" class="stroke-muted-foreground/20" />
                    </g>

                    <circle v-for="(o, i) in others" :key="'o' + i" :cx="px(o.lon)" :cy="py(o.lat)" :r="dot" class="fill-action/70">
                        <title>{{ o.label }}</title>
                    </circle>

                    <circle :cx="px(primary.lon)" :cy="py(primary.lat)" :r="dot * 2.1" class="fill-destructive/25">
                        <animate attributeName="r" :values="`${dot * 1.7};${dot * 3.2};${dot * 1.7}`" dur="2.4s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2.4s" repeatCount="indefinite" />
                    </circle>
                    <circle :cx="px(primary.lon)" :cy="py(primary.lat)" :r="dot" class="fill-destructive" />

                    <text
                        :x="px(primary.lon) + dot * 3" :y="py(primary.lat) - dot * 1.5"
                        class="font-semibold fill-foreground" :font-size="labelSize"
                        :textLength="label.length > 18 ? labelSize * 9 : null" lengthAdjust="spacingAndGlyphs">
                        {{ label }}
                    </text>
                </svg>

                <span class="jn-nums absolute top-1.5 left-2 rounded bg-card/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-success-soft-fg">
                    {{ primary.lat.toFixed(2) }}, {{ primary.lon.toFixed(2) }}
                </span>

                <span class="absolute right-1.5 bottom-1.5 rounded bg-card/85 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {{ t('dossier.map.primary', { source: primary.label }) }}
                </span>

                <svg v-if="land.length" viewBox="0 0 360 180" class="absolute bottom-1.5 left-1.5 hidden h-[46px] w-[92px] rounded border bg-card/85 sm:block"
                    aria-hidden="true">
                    <g fill-rule="evenodd" class="fill-muted-foreground/25 stroke-none">
                        <path v-for="(d, i) in land" :key="'s' + i" :d="d" />
                    </g>
                    <rect :x="win.x" :y="win.y" :width="WIN_W" :height="WIN_H"
                        class="fill-none stroke-action" stroke-width="3" />
                    <circle :cx="px(primary.lon)" :cy="py(primary.lat)" r="7" class="fill-destructive" />
                </svg>
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span class="text-muted-foreground">{{ place }}</span>
                <span v-if="maxOffsetKm != null" class="jn-nums text-muted-foreground">
                    ± {{ maxOffsetKm }} km
                </span>
            </div>
        </a>
    </div>
</template>

<script setup>
// Where the geolocation sources put the address, on a zoomed world map.
//
// The pin pulses and the disagreeing sources are drawn as separate dots, so a
// scatter is visible before any number is read — that is the whole reason this
// panel exists next to the source-by-source list rather than instead of it.
//
// The coastlines arrive asynchronously and are decoration: an empty map still
// plots the address correctly, so a failure to decode them changes nothing the
// reader relies on.

import { computed, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { loadWorldLand } from '@/utils/world-land.js';
import SectionTitle from '@/components/widgets/SectionTitle.vue';

const props = defineProps({
    geo: { type: Object, required: true },
});

const { t } = useI18n();

const land = ref([]);
onMounted(() => { loadWorldLand().then((paths) => { land.value = paths; }); });

// World space is 360×180 with one unit per degree, so a window is just a
// smaller viewBox. A quarter of the world's width keeps the region readable
// without making a single city look like a continent.
const WIN_W = 94.4;
const WIN_H = 47.2;

const withCoords = computed(() => (props.geo?.sources || []).filter((s) => s.lat != null && s.lon != null));
// First source with coordinates is the primary, matching the source list's
// order so the pin and the top row never disagree.
const primary = computed(() => withCoords.value[0] || null);
const others = computed(() => withCoords.value.slice(1));
const maxOffsetKm = computed(() => props.geo?.maxOffsetKm ?? null);

const px = (lon) => Number(lon) + 180;
const py = (lat) => 90 - Number(lat);

// Clamped so the window never runs off the poles or the antimeridian — a view
// that clipped half the map would look like a rendering fault, not a framing
// decision.
const win = computed(() => {
    const p = primary.value;
    if (!p) return { x: (360 - WIN_W) / 2, y: (180 - WIN_H) / 2 };
    return {
        x: Math.min(Math.max(px(p.lon) - WIN_W / 2, 0), 360 - WIN_W),
        y: Math.min(Math.max(py(p.lat) - WIN_H / 2, 0), 180 - WIN_H),
    };
});
const window = computed(() => `${win.value.x} ${win.value.y} ${WIN_W} ${WIN_H}`);

// Everything inside the window is drawn in degree units, so each size is the
// world-space figure divided by the zoom to land at a stable pixel size.
const zoom = WIN_W / 360;
const dot = +(0.9 * zoom * 3.6).toFixed(3);
const stroke = +(0.25 * zoom * 4).toFixed(3);
const grid = +(0.4 * zoom * 4).toFixed(3);
const labelSize = +(2.6 * zoom * 4).toFixed(2);

const step = 15;
const meridians = computed(() => {
    const out = [];
    for (let m = -180 + step; m < 180; m += step) out.push(m + 180);
    return out.filter((x) => x > win.value.x && x < win.value.x + WIN_W);
});
const parallels = computed(() => {
    const out = [];
    for (let p = -75 + step; p < 90; p += step) out.push(90 - p);
    return out.filter((y) => y > win.value.y && y < win.value.y + WIN_H);
});

const place = computed(() => {
    const c = props.geo?.consensus || {};
    // `region` is per-source — the consensus votes on country and city only,
    // where the sources actually disagree — so it comes from the primary fix.
    return [c.city, primary.value?.region, c.country].filter(Boolean).join(' · ') || primary.value?.label || '';
});
const label = computed(() => {
    const c = props.geo?.consensus || {};
    const text = [c.city, c.country].filter(Boolean).join(', ') || c.country || '';
    return text.length > 26 ? `${text.slice(0, 25)}…` : text;
});
</script>
