<template>
    <!-- Hero anatomy: flag · address · place string · gauge · score. The gauge
         is a continuous ramp with a pointer because the address's position on
         the scale is what you read first; the ramp is our five-band trust
         gradient rather than a rainbow, so the colour under the pointer still
         means the thing the band means. -->
    <div class="jn-card overflow-hidden rounded-[var(--radius)]">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b bg-gradient-to-b from-muted/50 to-transparent px-4 py-3">
            <div class="flex min-w-0 items-center gap-2.5">
                <Icon
                    v-if="countryCode"
                    :icon="'circle-flags:' + countryCode"
                    class="size-5 shrink-0 rounded-sm shadow-sm" />
                <div class="min-w-0">
                    <div class="jn-nums truncate font-mono text-lg leading-tight font-bold tracking-tight sm:text-xl">
                        {{ ip }}
                    </div>
                    <div class="truncate text-xs text-muted-foreground">{{ place || ' ' }}</div>
                </div>
            </div>

            <div class="ms-auto flex items-center gap-4">
                <div class="hidden w-40 sm:block">
                    <div class="relative h-2.5 overflow-hidden rounded-full">
                        <div class="absolute inset-0 trust-ramp"></div>
                        <div
                            v-if="score != null"
                            class="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-foreground shadow-sm"
                            :style="{ left: score + '%' }"
                            role="presentation"></div>
                    </div>
                    <div class="jn-nums mt-1 flex justify-between text-[0.6rem] leading-none text-muted-foreground">
                        <span>{{ t('dossier.gauge.low') }}</span>
                        <span>{{ t('dossier.gauge.high') }}</span>
                    </div>
                </div>

                <div
                    v-if="score != null"
                    class="rounded-lg px-3 py-1.5 text-center"
                    :class="pillClass">
                    <div class="jn-nums text-2xl leading-none font-extrabold">{{ score }}</div>
                    <div class="mt-0.5 text-[0.7rem] leading-none font-semibold">{{ t(`trustip.band.${band}`) }}</div>
                </div>
                <VerdictChip v-else tone="muted" :label="t('trustip.nonPublic')" />
            </div>
        </div>

        <div class="px-4 py-3">
            <slot />
        </div>
    </div>
</template>

<script setup>
// The dossier's hero row. Takes the assembled trust result and shows the
// address, where it is, and how far along the trust scale it sits.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';

const props = defineProps({
    ip: { type: String, required: true },
    trust: { type: Object, required: true },
    place: { type: String, default: '' },
    countryCode: { type: String, default: '' },
});

const { t } = useI18n();

const score = computed(() => props.trust?.score ?? null);
const band = computed(() => props.trust?.band ?? null);

const PILL = {
    1: 'bg-trust-1-soft text-trust-1-fg',
    2: 'bg-trust-2-soft text-trust-2-fg',
    3: 'bg-trust-3-soft text-trust-3-fg',
    4: 'bg-trust-4-soft text-trust-4-fg',
    5: 'bg-trust-5-soft text-trust-5-fg',
};
const pillClass = computed(() => PILL[band.value] || 'bg-muted text-muted-foreground');
</script>

<style scoped>
/* The five trust anchors, blended at their boundaries so the ramp reads as one
   scale while the pointer's colour still agrees with the band it lands in. */
.trust-ramp {
    background: linear-gradient(
        90deg,
        var(--trust-1) 0%,
        var(--trust-2) 25%,
        var(--trust-3) 50%,
        var(--trust-4) 75%,
        var(--trust-5) 100%
    );
}
</style>
