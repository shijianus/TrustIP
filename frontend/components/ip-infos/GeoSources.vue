<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.geo.title')">
            <template #aside>
                <VerdictChip :tone="tone" :label="t(`dossier.geo.${agreement}`)" />
            </template>
        </SectionTitle>

        <p v-if="!sources.length" class="text-sm text-muted-foreground">{{ t('dossier.geo.none') }}</p>

        <div v-else class="space-y-3">
            <!-- Two columns of source answers on wide screens. Each row is
                 labelled with that source's own flag rather than its name,
                 because the name competes for the space the answer needs; the
                 source is in the `title` and below the fold in the footer. -->
            <dl class="grid gap-x-6 sm:grid-cols-2">
                <div
                    v-for="(s, i) in sources"
                    :key="s.id"
                    class="flex min-w-0 items-baseline justify-between gap-4 border-b border-dashed py-1.5 text-sm last:border-b-0 max-sm:border-b-0"
                    :class="{ 'sm:border-b': true }">
                    <dt class="flex min-w-0 items-center gap-1.5 font-normal text-muted-foreground">
                        <Icon
                            :icon="'circle-flags:' + (s.country_code || '??').toLowerCase()"
                            class="size-4 shrink-0 rounded-sm" />
                        <span class="truncate">{{ s.label }}</span>
                    </dt>
                    <dd class="min-w-0 flex-1 truncate text-right font-semibold" :title="full(s)">
                        {{ full(s) }}
                        <a
                            v-if="s.lat != null && s.lon != null"
                            :href="`https://www.google.com/maps?q=${s.lat},${s.lon}`"
                            target="_blank" rel="nofollow noopener"
                            class="jn-nums ms-2 align-baseline text-[0.72rem] font-normal text-muted-foreground no-underline hover:underline"
                            :title="t('dossier.geo.map')">
                            {{ s.lat.toFixed(3) }}, {{ s.lon.toFixed(3) }}
                        </a>
                    </dd>
                </div>
            </dl>

            <!-- The spread is the headline: one source pointing elsewhere is
                 usually that source being wrong about a border, and naming a
                 winner would invite the reader to treat the remaining
                 disagreement as zero. When they do not disagree, saying so
                 plainly beats quoting a distance of zero. -->
            <p class="text-xs leading-relaxed text-muted-foreground">
                <template v-if="maxOffsetKm === null">{{ t('dossier.geo.noCoords') }}</template>
                <template v-else-if="maxOffsetKm <= 100">{{ t('dossier.geo.agree', { place: consensusPlace }) }}</template>
                <template v-else>{{ t('dossier.geo.consensus', {
                    place: consensusPlace,
                    km: maxOffsetKm < 10 ? maxOffsetKm.toFixed(1) : Math.round(maxOffsetKm),
                }) }}</template>
            </p>
        </div>
    </div>
</template>

<script setup>
// What several independent geolocation services say about one address, and
// how far apart they are.
//
// The point of the section is the disagreement, not the answer: an IP's city
// is an estimate several vendors make differently, and showing one of them
// alone would present a guess as a fact.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';

const props = defineProps({
    geo: { type: Object, required: true },
});

const { t } = useI18n();

const sources = computed(() => props.geo?.sources || []);
const maxOffsetKm = computed(() => props.geo?.maxOffsetKm ?? null);
const agreement = computed(() => props.geo?.consensus?.agreement || 'single-source');

const TONE = { agreeing: 'ok', diverging: 'warn', 'single-fix': 'muted', 'single-source': 'muted' };
const tone = computed(() => TONE[agreement.value] || 'muted');

const consensusPlace = computed(() => {
    const c = props.geo?.consensus || {};
    return [c.country, c.city].filter(Boolean).join(' / ') || '—';
});

const full = (s) => [s.country, s.region, s.city].filter(Boolean).join(' / ') || '—';
</script>
