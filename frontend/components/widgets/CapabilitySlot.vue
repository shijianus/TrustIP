<template>
    <!-- Real section chrome around an honest gap. The layout the dossier
         promises stays intact — the reader still sees where the information
         would sit and can tell "this address has nothing here" apart from
         "this build does not look at that" — and the reason is stated once,
         in the same voice as the rest of the panel. -->
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="title">
            <template #aside>
                <VerdictChip :tone="badgeTone" :label="badgeLabel" />
            </template>
        </SectionTitle>

        <!-- Delegated: the capability exists, on a page built for it. A link
             beats a "coming soon", and beats a duplicate implementation. -->
        <div v-if="state === 'delegated'" class="flex flex-wrap items-center gap-3">
            <p class="min-w-0 flex-1 text-sm text-muted-foreground">{{ note }}</p>
            <!-- A link, not a Button with `as`: the primitive types `as` as a
                 string, and handing it a component object warns in dev and buys
                 nothing here. -->
            <RouterLink
                :to="target"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-action px-3 py-1.5 text-sm font-medium text-action-foreground no-underline transition-opacity hover:opacity-90">
                {{ cta }}
                <ArrowUpRight class="size-3.5" />
            </RouterLink>
        </div>

        <!-- Partial: some rows are real and are rendered by the caller; the
             rest are named here so the missing ones are not silently absent. -->
        <div v-else-if="state === 'partial'" class="space-y-2">
            <slot />
            <p class="text-xs leading-relaxed text-muted-foreground">
                {{ t('dossier.slot.missing') }} {{ missingList }}
            </p>
        </div>

        <div v-else class="space-y-2">
            <p class="text-sm leading-relaxed text-muted-foreground">{{ note }}</p>
            <div v-if="needs" class="rounded-md border border-dashed bg-muted/30 px-3 py-2">
                <p class="text-xs leading-relaxed">
                    <span class="me-1.5 font-semibold text-foreground-secondary">{{ t('dossier.slot.needs') }}</span>
                    <span class="text-muted-foreground">{{ needs }}</span>
                </p>
            </div>
        </div>
    </div>
</template>

<script setup>
// A dossier section whose data this build does not have.
//
// Three states, because "we don't show that" has three different answers:
// `placeholder` (no source), `delegated` (a source exists, on another page),
// and `partial` (some rows are real, others are not). Collapsing them into one
// grey box would throw away the only information that makes the gap
// actionable — which is the difference between a placeholder you can finish
// and one you cannot.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ArrowUpRight } from '@lucide/vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';

const props = defineProps({
    title: { type: String, required: true },
    // placeholder | delegated | partial
    state: { type: String, default: 'placeholder' },
    note: { type: String, default: '' },
    // What would have to be added to make this section real.
    needs: { type: String, default: '' },
    // For `delegated`: the route that does have the capability.
    to: { type: [String, Object], default: null },
    cta: { type: String, default: '' },
    // For `partial`: the row labels that are absent.
    missing: { type: Array, default: () => [] },
});

const { t } = useI18n();

const badgeTone = computed(() => ({
    delegated: 'info',
    partial: 'warn',
    placeholder: 'muted',
}[props.state] || 'muted'));

const badgeLabel = computed(() => t(`dossier.slot.badge.${props.state}`));

const missingList = computed(() => props.missing.join(', '));

const target = computed(() => props.to || '/');
</script>
