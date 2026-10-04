<template>
    <div>
        <SectionTitle :title="t('trustip.signalsTitle')">
            <template #aside>
                <span class="jn-nums text-xs text-muted-foreground">
                    {{ t('trustip.confidence', { measured: confidence.measured, total: confidence.total }) }}
                </span>
            </template>
        </SectionTitle>

        <dl class="divide-y divide-dashed divide-border">
            <KeyRow v-for="signal in signals" :key="signal.id" :label="signalLabel(signal)" wide>
                <template #label>
                    <span class="inline-flex items-center gap-1.5">
                        <component :is="ICONS[signal.id] || Globe" class="size-3.5 text-muted-foreground" />
                        {{ signalLabel(signal) }}
                    </span>
                </template>
                <span class="inline-flex items-center justify-end gap-2">
                    <!-- An unmeasured signal shows no evidence line: its own
                         detail describes a gap in what we know, and printing it
                         beside "Not measured" reads as a second, contradicting
                         verdict. -->
                    <span class="hidden truncate text-xs whitespace-nowrap text-muted-foreground sm:inline">
                        {{ evidenceOf(signal) }}
                    </span>
                    <VerdictChip :tone="chipTone(signal)" :label="verdictOf(signal)" />
                </span>
            </KeyRow>
        </dl>

        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
            {{ t('trustip.notMeasured', { gaps: gapsLine }) }}
        </p>
    </div>
</template>

<script setup>
// The trust score's evidence, row by row.
//
// Broken out of the hero so both the dashboard panel and the dossier can show
// the same breakdown with the same rules — one row per signal, the literal
// text that produced the verdict beside it, and an unmeasured signal never
// dressed up as a clean one.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Building2, SearchCheck, Route, ShieldCheck, CalendarClock, Globe } from '@lucide/vue';
import { useStatusTone } from '@/composables/use-status-tone.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';

const props = defineProps({
    signals: { type: Array, default: () => [] },
    confidence: { type: Object, default: () => ({ measured: 0, total: 0 }) },
    gaps: { type: Array, default: () => [] },
});

const { t, te, locale } = useI18n();
const { chipClass } = useStatusTone();

const ICONS = {
    registryClass: Building2,
    rdns: SearchCheck,
    announcement: Route,
    rpki: ShieldCheck,
    allocationAge: CalendarClock,
    nativeness: Globe,
    publicness: Globe,
};

// A key nobody translated shows the raw token rather than the dotted path —
// `trustip.value.datacenter` in a screenshot is worse than `datacenter`.
const softT = (key, fallback) => (te(key) ? t(key) : fallback);

const signalLabel = (signal) => softT(signal.label, signal.id);

const verdictOf = (signal) => {
    if (signal.state === 'unknown') return t('trustip.verdict.notMeasured');
    if (signal.state === 'negative') return softT(`trustip.verdict.${signal.id}`, t('trustip.verdict.flagged'));
    if (signal.state === 'positive') return softT(`trustip.verdict.${signal.id}`, t('trustip.verdict.good'));
    return t('trustip.verdict.neutral');
};

const chipTone = (signal) => ({
    unknown: 'muted', neutral: 'info', caution: 'warn', positive: 'ok', negative: 'bad',
}[signal.state] || 'muted');

const evidenceOf = (signal) => {
    if (signal.state === 'unknown') return '';
    if (signal.matched) {
        if (signal.id === 'allocationAge') {
            const m = /^\d{4}-\d{2}-\d{2}/.exec(signal.matched);
            return m ? formatIsoDate(m[0], locale.value) : signal.matched;
        }
        return signal.matched;
    }
    const detail = signal.detail;
    if (!detail || detail === 'not-applicable' || detail === 'unknown') return '';
    return softT(`trustip.value.${detail}`, detail);
};

const gapsLine = computed(() => props.gaps.map((g) => t(`trustip.gap.${g}`)).join(', '));
</script>
