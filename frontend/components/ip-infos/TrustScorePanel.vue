<template>
    <div class="jn-card overflow-hidden rounded-[var(--radius)]">
        <!-- ── Hero row ───────────────────────────────────────────────
             The address and its verdict on one line: who they are on the left,
             how much to trust them on the right. Mirrors the reading order of a
             lookup result — identify, then judge. -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b bg-gradient-to-b from-muted/50 to-transparent px-4 py-3">
            <div class="flex min-w-0 items-center gap-2.5">
                <Icon v-if="countryCode" :icon="'circle-flags:' + countryCode.toLowerCase()" class="size-5 shrink-0 rounded-sm shadow-sm" />
                <div class="min-w-0">
                    <div class="jn-nums truncate font-mono text-lg leading-tight font-bold tracking-tight sm:text-xl">
                        {{ ip }}
                    </div>
                    <div class="truncate text-xs text-muted-foreground">
                        {{ geoLine || ' ' }}
                    </div>
                </div>
            </div>

            <div v-if="state === 'ready' && result" class="ms-auto flex items-center gap-4">
                <ScoreMeter :band="result.band" :score="result.score" :floor="result.floor" :capped="result.capped" />
                <div class="text-right">
                    <div class="jn-nums text-3xl leading-none font-extrabold" :class="scoreTextClass">
                        {{ result.score }}
                    </div>
                    <div class="mt-1 text-xs font-semibold" :class="scoreTextClass">
                        {{ t(`trustip.band.${result.band}`) }}
                    </div>
                </div>
            </div>

            <div v-else-if="state === 'ready'" class="ms-auto">
                <VerdictChip tone="muted" :label="t('trustip.nonPublic')" />
            </div>
        </div>

        <!-- ── Evidence ──────────────────────────────────────────────── -->
        <div class="px-4 py-3">
            <div v-if="state === 'loading'" class="space-y-2">
                <div v-for="n in 5" :key="n" class="jn-skeleton h-4 w-full"></div>
            </div>

            <div v-else-if="state === 'error'" class="flex items-start gap-2 rounded-md border border-destructive-soft bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-fg">
                <TriangleAlert class="mt-0.5 size-4 shrink-0" />
                <span>{{ t('trustip.fetchFailed') }}</span>
                <Button variant="ghost" size="sm" class="ms-auto shrink-0" @click="run">
                    <RotateCw class="size-3.5" />
                    {{ t('trustip.retry') }}
                </Button>
            </div>

            <template v-else-if="result">
                <SectionTitle :title="t('trustip.signalsTitle')">
                    <template #aside>
                        <span class="jn-nums text-xs text-muted-foreground">
                            {{ t('trustip.confidence', { measured: result.confidence.measured, total: result.confidence.total }) }}
                        </span>
                    </template>
                </SectionTitle>

                <dl class="divide-y divide-dashed divide-border">
                    <KeyRow
                        v-for="signal in result.signals"
                        :key="signal.id"
                        :label="signalLabel(signal)"
                        wide
                    >
                        <template #label>
                            <span class="inline-flex items-center gap-1.5">
                                <component :is="ICONS[signal.id]" class="size-3.5 text-muted-foreground" />
                                {{ signalLabel(signal) }}
                            </span>
                        </template>
                        <span class="inline-flex items-center gap-2 justify-end">
                            <!-- The evidence text sits under the verdict it
                                 produced: a chip alone asks for trust, a chip
                                 with the matched string shows its work. -->
                            <span class="hidden truncate text-xs text-muted-foreground sm:inline">
                                {{ evidenceOf(signal) }}
                            </span>
                            <VerdictChip :tone="chipTone(signal)" :label="verdictOf(signal)" />
                        </span>
                    </KeyRow>
                </dl>

                <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {{ t('trustip.notMeasured', { gaps: gapsLine }) }}
                </p>
            </template>
        </div>
    </div>
</template>

<script setup>
// TrustMy.IP's own trust assessment for one address, rendered as the lead
// block of the IP section.
//
// The score is computed server-side from public registry evidence by
// common/trust-score.js; this component only presents it, and it presents the
// breakdown as loudly as the number. A bare 0–100 would be a claim; the row
// under it naming the string that matched is what makes the claim checkable.
//
// Deliberately absent: any impression that a signal we could not measure is a
// clean one. `notMeasured` is the renderer's version of the engine's `GAPS`.

import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import {
    Building2, SearchCheck, Route, ShieldCheck, CalendarClock, Globe,
    TriangleAlert, RotateCw,
} from '@lucide/vue';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import { useStatusTone } from '@/composables/use-status-tone.js';
import Button from '@/components/ui/button/Button.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import ScoreMeter from '@/components/widgets/ScoreMeter.vue';

const props = defineProps({
    ip: { type: String, required: true },
    // The geo answer the IP cards already resolved, passed down so the panel
    // does not ask a second time for the same country and ASN.
    geo: { type: Object, default: null },
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

const state = ref('idle');
const result = ref(null);
const evidence = ref(null);

const geoLine = computed(() => {
  const g = props.geo || {};
  return [g.country_name || g.country, g.region, g.city, g.isp || g.org].filter(Boolean).join(' · ');
});
const countryCode = computed(() => (props.geo?.country_code || '').toUpperCase());

const scoreTextClass = computed(() => {
    if (!result.value) return '';
    return {
        1: 'text-destructive-soft-fg',
        2: 'text-destructive-soft-fg',
        3: 'text-warning-soft-fg',
        4: 'text-success-soft-fg',
        5: 'text-success-soft-fg',
    }[result.value.band] || '';
});

const gapsLine = computed(() => (result.value?.gaps || []).map((g) => t(`trustip.gap.${g}`)).join(', '));

// A key that has not been translated yet should show the raw token, not the
// dotted path — an unreadable `trustip.value.datacenter` in a screenshot is
// worse than `datacenter`.
const softT = (key, fallback) => (te(key) ? t(key) : fallback);

const signalLabel = (signal) => softT(signal.label, signal.id);
const verdictOf = (signal) => {
    if (signal.state === 'unknown') return t('trustip.verdict.notMeasured');
    if (signal.state === 'negative') return softT(`trustip.verdict.${signal.id}`, t('trustip.verdict.flagged'));
    if (signal.state === 'positive') return softT(`trustip.verdict.${signal.id}`, t('trustip.verdict.good'));
    return t('trustip.verdict.neutral');
};

const chipTone = (signal) => ({
    unknown: 'muted',
    neutral: 'info',
    caution: 'warn',
    positive: 'ok',
    negative: 'bad',
}[signal.state] || 'muted');

// What the signal actually saw. Registry text and the RIR's own words first —
// those are checkable — then the machine's reading of them.
//
// An unmeasured signal shows no evidence line at all: its own detail (an
// `unclassified` class, a `null` RPKI state) describes the gap in our
// knowledge, and printing it next to "Not measured" reads as a second,
// contradicting verdict.
const evidenceOf = (signal) => {
    if (signal.state === 'unknown') return '';
    if (signal.matched) return formatEvidence(signal.id, signal.matched);
    const detail = signal.detail;
    if (!detail || detail === 'not-applicable' || detail === 'unknown') return '';
    return softT(`trustip.value.${detail}`, detail);
};

// The engine reports the literal registry string it read, which for an
// allocation date is an RIR timestamp. Evidence has to stay checkable, so the
// value is reformatted rather than replaced — same date, visitor's calendar.
const formatEvidence = (id, value) => {
    if (id === 'allocationAge') {
        const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
        return match ? formatIsoDate(match[0], locale.value) : value;
    }
    return value;
};

async function run() {
    if (!props.ip) return;
    state.value = 'loading';
    try {
        // The address is the only input. Geo and ASN facts are re-read
        // server-side rather than echoed up from the cards: a score a visitor
        // can steer by editing the request is not a score.
        const res = await fetchWithTimeout(`/api/trustscore?ip=${encodeURIComponent(props.ip)}`, { timeoutMs: 15000 });
        if (!res.ok) throw new Error(`trustscore ${res.status}`);
        const body = await res.json();
        result.value = body;
        evidence.value = body.evidence;
        state.value = 'ready';
    } catch (err) {
        console.warn('trust score unavailable', err);
        state.value = 'error';
    }
}

watch(() => props.ip, run, { immediate: true });
</script>
