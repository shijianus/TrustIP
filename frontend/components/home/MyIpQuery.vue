<template>
    <section class="mb-6">
        <h1 class="text-[26px] leading-tight font-bold tracking-tight md:text-[28px]">
            {{ t('home.query.title') }}
        </h1>

        <div class="mt-1.5 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p class="text-sm text-muted-foreground">{{ t('home.query.desc') }}</p>
            <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
                {{ t('home.query.maskIps') }}
                <Switch
                    :model-value="maskActive"
                    class="h-5 w-9"
                    @update:model-value="$emit('toggle-mask')" />
            </label>
        </div>

        <div class="jn-card overflow-hidden rounded-[10px]">
            <div v-if="!families.length" class="px-6 py-8">
                <div class="jn-skeleton mb-3 h-7 w-56"></div>
                <div class="jn-skeleton mb-2 h-4 w-72"></div>
                <div class="jn-skeleton h-4 w-40"></div>
            </div>

            <div v-for="(family, fi) in families" :key="family.label" :class="fi ? 'border-t' : ''">
                <div class="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:px-7">
                    <!-- The address column: what you came here to read, so it
                         carries the page's largest type, and a link to the
                         dossier rather than a copy button — the answer to
                         "and is it any good?" is a page, not a clipboard. -->
                    <div class="min-w-0 shrink-0 lg:w-[260px]">
                        <div class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {{ family.label }}
                        </div>
                        <div class="mt-1 flex items-center gap-2">
                            <Icon
                                v-if="family.country_code"
                                :icon="'circle-flags:' + family.country_code"
                                class="size-6 shrink-0 rounded-sm" />
                            <RouterLink
                                :to="`/ip/${family.ip}`"
                                data-mask="ip"
                                class="jn-nums min-w-0 truncate font-mono text-[22px] leading-tight font-bold text-foreground no-underline hover:underline sm:text-2xl"
                                :title="family.ip">
                                {{ family.ip }}
                            </RouterLink>
                        </div>
                        <div class="mt-1.5 text-[15px] leading-snug font-medium" :title="family.geoLine">
                            {{ family.geoLine || '—' }}
                        </div>
                        <div class="mt-0.5 text-[13px] text-muted-foreground">{{ family.sourceLine }}</div>
                    </div>

                    <div class="min-w-0 flex-1">
                        <div class="mb-2 flex items-baseline justify-between gap-3">
                            <span class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                {{ t('home.query.connectivity') }}
                            </span>
                            <RouterLink to="/link" class="text-xs text-muted-foreground no-underline hover:underline">
                                {{ t('home.query.viewMore') }}
                            </RouterLink>
                        </div>
                        <!-- One column on a phone: two made every cell ~170px,
                             and after the monogram and the figure that left
                             about four characters of name — "Te…" is not a
                             label. A taller strip that reads is worth more
                             than a compact one that has to be guessed. -->
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                            <div
                                v-for="probe in probes" :key="probe.host"
                                class="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                                <Monogram :text="probe.name" class="size-6 shrink-0" />
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-1 text-[13px] leading-tight">
                                        <span class="truncate">{{ probe.name }}</span>
                                        <Icon
                                            v-if="probe.country"
                                            :icon="'circle-flags:' + probe.country.toLowerCase()"
                                            class="size-3.5 shrink-0 rounded-[1px]" />
                                    </div>
                                    <div class="mt-1 flex min-w-0 items-center gap-[3px] overflow-hidden" :aria-label="t('home.query.samples')">
                                        <span
                                            v-for="(dot, i) in probe.dots" :key="i"
                                            class="h-1.5 w-1.5 shrink-0 rounded-full"
                                            :class="dotClass(dot)"
                                            :title="dot.ok ? Math.round(dot.ms) + ' ms' : t('home.query.timeout')" />
                                        <span v-if="!probe.dots.length" class="jn-queued text-[11px] leading-none text-muted-foreground">
                                            {{ t('home.query.probing') }}
                                        </span>
                                    </div>
                                </div>
                                <span class="jn-nums shrink-0 text-[13px] font-semibold" :class="msClass(probe)">
                                    {{ probe.ms == null ? '—' : Math.round(probe.ms) + 'ms' }}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- The finding, stated before the table that proves it: one
                     address means no split, more than one means the network
                     routes by destination, and each is clickable because the
                     next question is always "is that one any good". -->
                <div class="border-t bg-muted/30 px-5 py-4 lg:px-7">
                    <p class="mb-2 text-[13px] font-medium">
                        {{ t('home.query.egressTitle', { n: egressIps.length }) }}
                    </p>
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        <RouterLink
                            v-for="ip in egressIps" :key="ip"
                            :to="`/ip/${ip}`"
                            data-mask="ip"
                            class="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-2 no-underline transition-transform duration-300 ease-out hover:-translate-y-0.5"
                            :title="t('home.query.egressHint', { ip })">
                            <Icon
                                v-if="geolocations[ip]?.country_code"
                                :icon="'circle-flags:' + geolocations[ip].country_code.toLowerCase()"
                                class="size-4 shrink-0 rounded-sm" />
                            <span class="jn-nums truncate font-mono text-[13px] font-semibold text-foreground">{{ ip }}</span>
                        </RouterLink>
                        <p v-if="!egressIps.length" class="col-span-full text-[13px] text-muted-foreground">
                            {{ splitRunning ? t('home.query.probing') : t('home.query.noneYet') }}
                        </p>
                    </div>
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
import Monogram from '@/components/widgets/Monogram.vue';
import { onAppEvent } from '@/utils/app-events.js';
import { useStatusTone } from '@/composables/use-status-tone.js';
import { useConnectivityProbes } from '@/composables/use-connectivity-probes.js';
import { CONNECTIVITY_PROBES } from '@/data/site-split.js';

const props = defineProps({
    maskActive: { type: Boolean, default: false },
    // The routing table's answers, lifted so the summary and the table below
    // read one source of truth rather than probing twice.
    egressIps: { type: Array, default: () => [] },
    geolocations: { type: Object, default: () => ({}) },
    splitRunning: { type: Boolean, default: false },
});

defineEmits(['toggle-mask']);

const { t } = useI18n();
const { textClass } = useStatusTone();

const cards = ref([]);
const unsubscribe = onAppEvent('ipinfo:finished', (payload) => {
    cards.value = payload?.cards || [];
});
onScopeDispose(() => unsubscribe());

const geo = computed(() => cards.value.find((c) => c.ip && !String(c.ip).includes(':')) || null);
const geo6 = computed(() => cards.value.find((c) => c.ip && String(c.ip).includes(':')) || null);

const families = computed(() => [geo.value, geo6.value].filter(Boolean).map((card) => ({
    label: card.ip.includes(':') ? 'IPv6' : 'IPv4',
    ip: card.ip,
    country_code: (card.country_code || '').toLowerCase(),
    geoLine: [card.country, card.region, card.city, card.isp].filter(Boolean).join(' '),
    sourceLine: card.isp || card.source || '',
})));

const { rows: probes, run: runProbes } = useConnectivityProbes({ probes: CONNECTIVITY_PROBES });

const dotClass = (dot) => (dot.ok ? {
    'ok-fast': 'bg-success',
    'ok-slow': 'bg-warning',
    fail: 'bg-destructive',
}[dot.tone] || 'bg-muted-foreground/40' : 'bg-destructive');

const msClass = (probe) => (probe.ms == null
    ? 'text-muted-foreground'
    : `${textClass(probe.tone)} font-semibold`);

onMounted(() => { runProbes(); });
</script>
