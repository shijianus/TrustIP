<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.heat.title')">
            <template #aside>
                <VerdictChip :tone="hasData ? 'info' : 'muted'" :label="hasData ? window : t('trustip.verdict.notMeasured')" />
            </template>
        </SectionTitle>

        <!-- Three tiles, then the curve under them. The tiles hold the numbers
             and the curve holds the shape; either alone makes the other hard to
             read, which is why the reference pairs them and why the empty state
             keeps both. -->
        <div class="mb-3 grid grid-cols-3 gap-2">
            <div v-for="tile in tiles" :key="tile.label" class="rounded-lg border border-dashed px-2 py-2 text-center">
                <div class="text-[10px] leading-tight text-muted-foreground">{{ tile.label }}</div>
                <div class="jn-nums mt-1 text-base leading-none font-bold" :class="tile.class">{{ tile.value }}</div>
            </div>
        </div>

        <TrendChart :points="points" :empty-label="t('dossier.heat.empty')" />

        <p v-if="hasData" class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ t('dossier.heat.footer') }}</p>
        <NeedsLine v-else :text="t('dossier.heat.needs')" />
    </div>
</template>

<script setup>
// How much traffic a network block has been carrying lately.
//
// This build records no per-prefix observations, so the curve is empty — but
// the tiles, the axes and the day range are all drawn, because the section's
// job is to answer the question "is this block busy" and the honest answer
// needs the same shape as the real one.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import TrendChart from '@/components/widgets/TrendChart.vue';
import NeedsLine from '@/components/widgets/NeedsLine.vue';

const props = defineProps({
    // { index, weekDelta, mode, points: [{ day, value }] } — absent until
    // something is recording per-prefix counts.
    heat: { type: Object, default: null },
});

const { t } = useI18n();

const points = computed(() => props.heat?.points || []);
const hasData = computed(() => points.value.length > 1);
const window = computed(() => t('dossier.heat.days', { n: points.value.length }));

const MODE_CLASS = { hot: 'text-destructive-soft-fg', active: 'text-warning-soft-fg', normal: 'text-muted-foreground', cold: 'text-info-soft-fg' };

const tiles = computed(() => {
    const h = props.heat || {};
    const delta = Number.isFinite(h.weekDelta) ? h.weekDelta : null;
    return [
        { label: t('dossier.heat.index'), value: Number.isFinite(h.index) ? h.index : '—', class: '' },
        {
            label: t('dossier.heat.weekChange'),
            value: delta === null ? '—' : `${delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} ${Math.abs(delta)}%`,
            class: delta === null ? 'text-muted-foreground' : (delta > 0 ? 'text-destructive-soft-fg' : 'text-success-soft-fg'),
        },
        {
            label: t('dossier.heat.trend'),
            value: h.mode ? t(`dossier.heat.mode.${h.mode}`) : '—',
            class: MODE_CLASS[h.mode] || 'text-muted-foreground',
        },
    ];
});
</script>
