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
            <!-- Coastlines decoded from the same TopoJSON the latency map uses,
                 over the graticule this panel already plots against. The
                 bundled world image is a Pacific-centred map with Chinese
                 labels, so plotting lat/long onto it would put the marker in
                 the wrong place and show text no locale asked for. -->
            <svg viewBox="0 0 360 180" class="aspect-2/1 w-full rounded-md border bg-info-soft" role="img"
                :aria-label="t('dossier.map.aria', { place })">
                <g fill-rule="evenodd" class="fill-success-soft/45 stroke-success-soft-fg/30" stroke-width="0.25">
                    <path v-for="(d, i) in land" :key="'l' + i" :d="d" />
                </g>
                <g stroke="currentColor" class="text-muted-foreground/20" stroke-width="0.4">
                    <line v-for="i in 11" :key="'v' + i" :x1="(i - 1) * 36" y1="0" :x2="(i - 1) * 36" y2="180" />
                    <line v-for="i in 7" :key="'h' + i" :x1="0" :y1="(i - 1) * 30" x2="360" :y2="(i - 1) * 30" />
                </g>
                <line x1="0" y1="90" x2="360" y2="90" class="stroke-foreground-secondary/40" stroke-width="0.6" stroke-dasharray="3 2" />
                <line :x1="x(0)" y1="0" :x2="x(0)" y2="180" class="stroke-foreground-secondary/40" stroke-width="0.6" stroke-dasharray="3 2" />

                <circle
                    v-for="(o, i) in others" :key="'o' + i"
                    :cx="x(o.lon)" :cy="y(o.lat)" r="2.4"
                    class="fill-action/70" />

                <circle :cx="x(primary.lon)" :cy="y(primary.lat)" r="5" class="fill-destructive/25">
                    <animate attributeName="r" values="4;8;4" dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <circle :cx="x(primary.lon)" :cy="y(primary.lat)" r="3" class="fill-destructive" />
            </svg>

            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span class="jn-nums font-mono font-semibold text-success-soft-fg">
                    {{ primary.lat.toFixed(3) }}, {{ primary.lon.toFixed(3) }}
                </span>
                <span class="text-muted-foreground">
                    {{ t('dossier.map.primary', { source: primary.label }) }}
                </span>
                <span v-if="maxOffsetKm != null" class="jn-nums text-muted-foreground">
                    ± {{ maxOffsetKm }} km
                </span>
            </div>
        </a>
    </div>
</template>

<script setup>
// Where the geolocation sources put the address, plotted on a world map.
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

const x = (lon) => ((Number(lon) + 180) / 360) * 360;
const y = (lat) => ((90 - Number(lat)) / 180) * 180;

const withCoords = computed(() => (props.geo?.sources || []).filter((s) => s.lat != null && s.lon != null));
// First source with coordinates is the primary, matching the source list's
// order so the pin and the top row never disagree.
const primary = computed(() => withCoords.value[0] || null);
const others = computed(() => withCoords.value.slice(1));
const maxOffsetKm = computed(() => props.geo?.maxOffsetKm ?? null);
const place = computed(() => {
    const c = props.geo?.consensus || {};
    return [c.country, c.city].filter(Boolean).join(' ') || primary.value?.label || '';
});
</script>
