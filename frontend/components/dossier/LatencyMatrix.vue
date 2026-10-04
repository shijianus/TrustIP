<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.latency.matrixTitle')">
            <template #aside>
                <span v-if="matrix.source" class="text-xs text-muted-foreground">{{ matrix.source }}</span>
            </template>
        </SectionTitle>

        <p v-if="unsupported" class="text-sm text-muted-foreground">{{ t('dossier.latency.v6Note') }}</p>

        <template v-else>
            <div class="grid grid-cols-4 gap-2 lg:grid-cols-8">
                <div v-for="cell in cells" :key="cell.location" class="px-0.5 py-1 text-center">
                    <div class="mb-0.5 flex items-center justify-center gap-1">
                        <Icon
                            v-if="cell.country"
                            :icon="'circle-flags:' + cell.country.toLowerCase()"
                            class="h-3.5 w-5 shrink-0 rounded-[2px] object-contain" />
                        <span class="truncate text-[0.7rem] leading-none whitespace-nowrap text-muted-foreground">
                            {{ cell.city || cell.location }}
                        </span>
                    </div>
                    <div class="jn-nums text-[0.8rem] leading-tight" :class="valueClass(cell)">
                        {{ valueOf(cell) }}
                    </div>
                </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button variant="action" size="sm" :disabled="status === 'running'" @click="run">
                    <Spinner v-if="status === 'running'" class="me-1.5" />
                    {{ buttonLabel }}
                </Button>
                <p v-if="runError" class="text-xs text-destructive-soft-fg">
                    {{ t('dossier.latency.runFailed') }}
                </p>
                <p v-else-if="!ran" class="text-xs leading-relaxed text-muted-foreground">
                    {{ t('dossier.latency.cost') }}
                </p>
            </div>

            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ t('dossier.latency.note') }}</p>
            <p v-if="matrix.addressFamily?.experimental" class="text-xs leading-relaxed text-muted-foreground">
                {{ t('dossier.latency.experimental') }}
            </p>
        </template>
    </div>
</template>

<script setup>
// Round-trip time from a fixed set of probe locations, one cell per location.
//
// Flag above, city beside it, number underneath: the eye scans a strip of
// national flags with a measurement under each, which is the only way eight of
// these fit in a card without becoming a table.
//
// Only the minimum is shown. Average, jitter and loss each need several
// samples to mean anything, and a single probe run cannot support them without
// implying precision it does not have.
//
// The measurement runs in this browser, against Globalping, and only when the
// visitor asks. The quota that pays for it belongs to their own address rather
// than to this deployment, so spending eight probes on a page view nobody
// wanted would be a charge the reader never agreed to — which is also why the
// cells are drawn before any number exists rather than hidden until they do.

import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { useStatusTone } from '@/composables/use-status-tone.js';
import { useGlobalpingMeasurement } from '@/composables/use-globalping-measurement.js';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import Button from '@/components/ui/button/Button.vue';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps({
    matrix: { type: Object, default: null },
});

const { t } = useI18n();
const { textClass } = useStatusTone();

const plan = computed(() => props.matrix?.results || []);
const unsupported = computed(() => props.matrix?.unsupported === true);
// Measurement results land by index in `cells`, keyed on the plan row they
// belong to. Before a run every cell is the plan's own `pending`.
const answers = ref({});
const ran = ref(false);
const runError = ref(false);

const cells = computed(() => plan.value.map((cell) => ({
    ...cell,
    ...(answers.value[cell.location] || {}),
})));

const { status, start } = useGlobalpingMeasurement({ pollInterval: 1500, maxRetries: 8 });

const buttonLabel = computed(() => {
    if (status.value === 'running') return t('dossier.latency.measuring');
    return ran.value ? t('dossier.latency.runAgain') : t('dossier.latency.run');
});

const valueOf = (cell) => {
    if (cell.state === 'ok' && typeof cell.ms === 'number') return `${cell.ms.toFixed(0)} ms`;
    // Nothing is queued until the visitor asks, so a waiting cell before the
    // first run says "—" like any other absent value rather than pretending a
    // probe is on its way.
    if (cell.state === 'pending') return ran.value ? t('dossier.latency.queued') : '—';
    return t(`dossier.latency.${cell.state}`);
};

const valueClass = (cell) => {
    if (cell.state !== 'ok') {
        return cell.state === 'pending' && ran.value ? 'jn-queued' : 'text-muted-foreground';
    }
    // Thresholds are the same three the connectivity tests already use, so
    // "fast" means one colour everywhere in the app.
    const tone = cell.ms < 80 ? 'ok-fast' : cell.ms < 180 ? 'ok-slow' : 'fail';
    return `${textClass(tone)} font-medium`;
};

// A probe's city string is Globalping's own ("Frankfurt am Main" for the cell
// planned as "Frankfurt"), so a city is claimed by the longest plan row it
// contains. Countries narrow it first: two of the eight cells are American.
const claim = (probe) => {
    const same = plan.value.filter((c) => String(c.country).toUpperCase() === String(probe.country).toUpperCase());
    const byCity = same.find((c) => (probe.city || '').toLowerCase().startsWith(c.city.toLowerCase()));
    return byCity || same.find((c) => !answers.value[c.location]);
};

const applyResults = (data) => {
    const next = {};
    for (const item of data.results || []) {
        const cell = claim(item.probe || {});
        if (!cell || next[cell.location]) continue;
        const finished = item.result?.status === 'finished';
        const ms = item.result?.stats?.min;
        next[cell.location] = finished && ms != null
            ? { state: 'ok', ms }
            : { state: item.result?.status === 'failed' ? 'failed' : 'timeout', ms: null };
    }
    answers.value = { ...answers.value, ...next };
    return Object.keys(next).length > 0;
};

function run() {
    const measurement = props.matrix?.measurement;
    if (!measurement?.body) return;
    runError.value = false;
    ran.value = true;
    start(measurement.body, {
        // Polls arrive partial; every answered cell resolves early and the rest
        // stay queued until the composable gives up, which is the honest shape
        // of a probe network where some nodes simply do not take the job.
        onResults: applyResults,
        onError: () => { runError.value = true; },
    });
}
</script>
