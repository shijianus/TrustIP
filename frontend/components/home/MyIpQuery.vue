<template>
    <section class="mb-8">
        <h1 class="mb-1 text-[1.4em] leading-tight font-bold tracking-tight min-[481px]:text-[1.75em]">
            {{ t('home.query.title') }}
        </h1>

        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p class="m-0 min-w-0 flex-1 basis-auto text-[0.9em] text-muted-foreground">{{ t('home.query.desc') }}</p>
            <!-- The switch hides below 720px rather than shrinking: under that
                 the address column needs the width more than the toggle does. -->
            <label
                class="flex shrink-0 cursor-pointer items-center gap-1.5 text-[0.8em] text-muted-foreground select-none max-[720px]:hidden">
                {{ t('home.query.maskIps') }}
                <Switch
                    :model-value="maskActive"
                    class="h-5 w-9"
                    @update:model-value="$emit('toggle-mask')" />
            </label>
        </div>

        <!-- One bordered box, no shadow: the card's own 1px border is the whole
             of its separation from the page, so the shared `jn-card` (which
             adds a shadow and stretches to its grid cell) does not belong here. -->
        <div class="mb-5 rounded-[10px] border px-4 py-3.5 min-[481px]:px-5 min-[481px]:py-[18px] md:px-7 md:py-6">
            <div v-if="!primary">
                <div class="jn-skeleton mb-2 h-7 w-56"></div>
                <div class="jn-skeleton mb-2 h-4 w-72"></div>
                <div class="jn-skeleton h-4 w-40"></div>
            </div>

            <div class="flex flex-col gap-[14px] md:flex-row md:items-start md:gap-8">
                <!-- One address in this column: the one the visitor came to
                     read, at the page's largest type, linking to the dossier
                     rather than offering a copy button. Every other exit this
                     network used — the other family included — is a cell in the
                     summary under the strip, which is where a second answer
                     belongs: as one of the addresses, not as a second copy of
                     the whole block. -->
                <div v-if="primary" class="min-w-0 md:w-[260px] md:shrink-0">
                    <div class="mb-1.5 text-[0.78em] tracking-[0.5px] text-muted-foreground uppercase">
                        {{ primary.label }}
                    </div>
                    <div class="mb-2.5 flex min-w-0 items-center gap-1.5 font-bold text-[1.15em] text-foreground min-[481px]:gap-3 min-[481px]:text-[1.5em]">
                        <Icon
                            v-if="primary.country_code"
                            :icon="'circle-flags:' + primary.country_code"
                            class="size-[22px] shrink-0 rounded-[2px]" />
                        <RouterLink
                            :to="`/ip/${primary.ip}`"
                            data-mask="ip"
                            class="min-w-0 text-inherit no-underline hover:underline hover:decoration-1 hover:underline-offset-[3px]"
                            :title="primary.ip">
                            <FitText :text="primary.ip" :tiers="IP_VALUE_TIERS" :max-lines="2" />
                        </RouterLink>
                    </div>
                    <div
                        class="truncate text-[0.85em] font-medium leading-snug min-[481px]:text-[1em]"
                        :title="primary.geoLine">
                        {{ primary.geoLine || '—' }}
                    </div>
                    <div class="mt-2.5 text-[0.72em] text-muted-foreground">{{ primary.sourceLine }}</div>
                </div>

                <div class="min-w-0 flex-1">
                    <div class="mb-2 flex items-center justify-between gap-2 text-[0.8em] text-muted-foreground uppercase">
                        <span class="tracking-[0.5px]">{{ t('home.query.connectivity') }}</span>
                        <RouterLink
                            to="/link"
                            class="text-[0.88em] font-normal whitespace-nowrap text-muted-foreground no-underline hover:underline">
                            {{ t('home.query.viewMore') }}
                        </RouterLink>
                    </div>
                    <!-- Three columns where the card is wide enough to spend
                         ~200px per cell, which is where the strip is designed
                         to be read. Narrower than that the name and the twelve
                         dots are the first casualties — a cell that shows "Te…"
                         and three dots has lost both of the things it is for,
                         so the row gives up columns before it gives those up. -->
                    <div class="grid grid-cols-1 gap-2 min-[481px]:grid-cols-2 lg:grid-cols-3">
                        <div
                            v-for="probe in probes" :key="probe.host"
                            class="flex min-w-0 items-center gap-1.5 rounded-[8px] border px-2 py-1.5 text-[0.78em] min-[481px]:px-2.5 min-[481px]:py-2 min-[481px]:text-[0.82em]">
                            <SiteIcon :icon="probe.icon" :name="probe.name" :seed="probe.host" :size="16" />
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1 leading-tight">
                                    <span class="truncate font-medium">{{ probe.name }}</span>
                                    <Icon
                                        v-if="probe.country"
                                        :icon="'circle-flags:' + probe.country.toLowerCase()"
                                        class="size-3 shrink-0 rounded-[1px]" />
                                </div>
                                <div class="mt-1 flex gap-0.5 overflow-hidden" :aria-label="t('home.query.samples')">
                                    <span
                                        v-for="(dot, i) in probe.dots" :key="i"
                                        class="h-1 w-1 shrink-0 rounded-full min-[481px]:h-1.5 min-[481px]:w-1.5"
                                        :class="dotClass(dot)"
                                        :title="dot.ok ? Math.round(dot.ms) + ' ms' : t('home.query.timeout')" />
                                    <span
                                        v-for="n in pendingDots(probe)" :key="'p' + n"
                                        class="h-1 w-1 shrink-0 rounded-full bg-muted min-[481px]:h-1.5 min-[481px]:w-1.5" />
                                </div>
                            </div>
                            <span class="min-w-[4.2em] shrink-0 text-right text-[1em] font-semibold whitespace-nowrap" :class="msClass(probe)">
                                {{ probe.ms == null ? '—' : Math.round(probe.ms) + 'ms' }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- The finding, stated before the table that proves it: one
                 address means no split, more than one means the network routes
                 by destination, and each is clickable because the next question
                 is always "is that one any good". -->
            <div v-if="primary" class="mt-3 mb-4">
                <p class="mb-1.5 text-[0.85em] text-muted-foreground">
                    {{ t('home.query.egressTitle', { n: egressIps.length }) }}
                </p>
                <div class="grid grid-cols-1 gap-2 min-[481px]:grid-cols-2 lg:grid-cols-3">
                    <RouterLink
                        v-for="ip in egressList" :key="ip"
                        :to="`/ip/${ip}`"
                        data-mask="ip"
                        class="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-[6px] border bg-card px-2.5 py-2 font-mono text-[0.9em] no-underline transition-colors hover:bg-accent"
                        :title="t('home.query.egressHint', { ip })">
                        <Icon
                            v-if="geolocations[ip]?.country_code"
                            :icon="'circle-flags:' + geolocations[ip].country_code.toLowerCase()"
                            class="size-4 shrink-0 rounded-[2px] min-[481px]:size-5" />
                        <span class="jn-nums truncate text-foreground">{{ ip }}</span>
                        <!-- The one cell of these that the routing table has committed
                             to as the visitor's own address. Same word, same rule as
                             the panel under the heading: this is not a pick from the
                             list, it is the answer to "which one am I". -->
                        <span
                            v-if="ip === classified?.ip"
                            class="ms-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-sans font-semibold"
                            :class="egressList.length > 1 ? 'bg-warning-soft text-warning-soft-fg' : 'bg-success-soft text-success-soft-fg'">
                            {{ t('home.split.egress.primary') }}
                        </span>
                    </RouterLink>
                    <p v-if="!egressIps.length" class="col-span-full text-[0.88em] text-muted-foreground">
                        {{ splitRunning ? t('home.query.probing') : t('home.query.noneYet') }}
                    </p>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup>
// The homepage's opening block: the visitor's own address, how fast six
// destinations answer it, and which exit each site was reached from.
//
// Nothing here resolves the IP independently. The card snapshot below already
// did, on the same sources, and a second answer that disagreed with the first
// would be worse than no answer at all — so this rides the `ipinfo:finished`
// event the cards emit and can never drift from them.

import { ref, computed, onMounted, onScopeDispose } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { Switch } from '@/components/ui/switch';
import SiteIcon from '@/components/widgets/SiteIcon.vue';
import FitText from '@/components/widgets/FitText.vue';
import { onAppEvent } from '@/utils/app-events.js';
import { useStatusTone } from '@/composables/use-status-tone.js';
import { useConnectivityProbes } from '@/composables/use-connectivity-probes.js';
import { CONNECTIVITY_PROBES, PROBE_SAMPLES } from '@/utils/latency-probes.js';

const props = defineProps({
    maskActive: { type: Boolean, default: false },
    // The routing table's answers, lifted so the summary and the table below
    // read one source of truth rather than probing twice.
    egressIps: { type: Array, default: () => [] },
    geolocations: { type: Object, default: () => ({}) },
    splitRunning: { type: Boolean, default: false },
    // Which of those addresses the routing table has decided the visitor *is* — the
    // same answer the table's own panel is built on, read from one source so the two
    // cannot name different addresses for one network.
    attribution: { type: Object, default: () => ({}) },
});

defineEmits(['toggle-mask']);

const { t } = useI18n();
const { textClass } = useStatusTone();

// The address is the one string on the page with no acceptable substitute, so
// it gets the largest type the column will hold and steps down only as far as
// it must rather than wrapping into a fourth line.
const IP_VALUE_TIERS = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm'];

const cards = ref([]);
const unsubscribe = onAppEvent('ipinfo:finished', (payload) => {
    cards.value = payload?.cards || [];
});
onScopeDispose(() => unsubscribe());

const geo = computed(() => cards.value.find((c) => c.ip && !String(c.ip).includes(':')) || null);
const geo6 = computed(() => cards.value.find((c) => c.ip && String(c.ip).includes(':')) || null);

// The address the routing table has decided *is* this visitor. A STUN answer beats
// a count of routes beats the source's own resolution — see
// `utils/egress-attribution.js` for why a rented exit and the machine behind it are
// two different answers to two different questions.
const classified = computed(() => props.attribution?.primary || null);

// The one address in this column: the one the visitor came to read, at the page's
// largest type, linking to the dossier rather than offering a copy button. Every
// other exit this network used — the other family included — is a cell in the
// summary under the strip, which is where a second answer belongs: as one of the
// addresses, not as a second copy of the whole block.
//
// Until the table has an answer, the hero falls back to the card's IPv4, and says
// so by naming the source rather than leaving the reader to guess which of the two
// it is looking at.
const primary = computed(() => {
    const hit = classified.value;
    const card = hit ? null : (geo.value || geo6.value);
    const ip = hit?.ip || card?.ip;
    if (!ip) return null;
    const geoOfIp = props.geolocations[ip] || {};
    return {
        label: ip.includes(':') ? 'IPv6' : 'IPv4',
        ip,
        country_code: (hit?.country_code || geoOfIp.country_code || card?.country_code || '').toLowerCase(),
        geoLine: [geoOfIp.city, geoOfIp.region, geoOfIp.country_name, geoOfIp.org].filter(Boolean).join(' ')
            || [card?.country, card?.region, card?.city, card?.isp].filter(Boolean).join(' '),
        sourceLine: hit
            ? `${t('home.split.egress.primary')} · ${t(`home.split.egress.basis.${hit.basis}`)}`
            : (card?.isp || card?.source || ''),
    };
});

// The primary first, then the rest in the order the sources and the echoes named
// them. A list that reshuffles as each destination answers is a list nobody can
// read twice in a row, so only the one address the panel above commits to moves.
const egressList = computed(() => {
    const first = classified.value?.ip;
    if (!first) return props.egressIps;
    return [first, ...props.egressIps.filter((ip) => ip !== first)];
});

const { rows: probes, run: runProbes } = useConnectivityProbes({ probes: CONNECTIVITY_PROBES });

const dotClass = (dot) => (dot.ok ? {
    'ok-fast': 'bg-success',
    'ok-slow': 'bg-warning',
    fail: 'bg-destructive',
}[dot.tone] || 'bg-muted-foreground/40' : 'bg-destructive');

// The row is drawn at its full length before any sample lands, so a probe
// still running reads as in-progress rather than as six failures.
const pendingDots = (probe) => Math.max(0, PROBE_SAMPLES - probe.dots.length);

const msClass = (probe) => (probe.ms == null
    ? 'text-muted-foreground'
    : `${textClass(probe.tone)} font-semibold`);

onMounted(() => { runProbes(); });
</script>
