<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.blocklists.title')">
            <template #aside>
                <VerdictChip :tone="headTone" :label="headLabel" />
            </template>
        </SectionTitle>

        <!-- One row per zone, in the order they are queried. The zone name is
             the subject of the accusation, so it stays visible in full and only
             the verdict moves to the right. -->
        <dl v-if="rows.length" class="divide-y divide-dashed divide-border">
            <KeyRow v-for="row in rows" :key="row.id" :label="row.label">
                <span class="inline-flex items-center justify-end gap-2">
                    <VerdictChip :tone="row.tone" :label="row.verdict" />
                    <span v-if="row.code" class="jn-nums text-xs text-muted-foreground">{{ row.code }}</span>
                </span>
            </KeyRow>
        </dl>

        <!-- Which recursor answered is part of what a listing means: the same
             zone read through an intercepting resolver would accuse everyone. -->
        <p v-if="rows.length" class="mt-2 text-xs leading-relaxed text-muted-foreground">
            {{ t('dossier.blocklists.through', { resolver: blocklists.resolver || '—' }) }}
        </p>
        <NeedsLine v-else :text="t('dossier.blocklists.needs')" />
    </div>
</template>

<script setup>
// What the public blocklists say about this address, zone by zone.
//
// A pass with nothing to report is drawn as the declared gap it is, with the
// same shape as before the queries existed: the section's place in the layout
// carries the reason, so "we could not ask" never shares a page with "clean".

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import NeedsLine from '@/components/widgets/NeedsLine.vue';

const props = defineProps({
    // The evidence summary from common/dnsbl.js: `{ zones, answered, listed,
    // botnet, resolver, results: [{ id, label, status, listed, codes }] }`.
    blocklists: { type: Object, default: null },
});

const { t } = useI18n();

const listed = computed(() => Number(props.blocklists?.listed) || 0);
const answered = computed(() => Number(props.blocklists?.answered) || 0);

// `bad` only when a zone actually named the address; `ok` needs at least one
// truthful answer behind it, or an unanswered pass would read as a clean sheet.
const headTone = computed(() => (listed.value > 0 ? 'bad' : answered.value > 0 ? 'ok' : 'muted'));
const headLabel = computed(() => {
    if (listed.value > 0) return t('dossier.blocklists.listed');
    if (answered.value > 0) return t('dossier.blocklists.clean');
    return t('trustip.verdict.notMeasured');
});

const ROW = {
    listed: { tone: 'bad', key: 'dossier.blocklists.listed' },
    clean: { tone: 'ok', key: 'dossier.blocklists.clean' },
};

const rows = computed(() => (props.blocklists?.results || []).map((r) => {
    const read = ROW[r.status] || { tone: 'muted', key: 'trustip.verdict.notMeasured' };
    return {
        id: r.id,
        label: r.label,
        tone: read.tone,
        verdict: t(read.key),
        // The raw 127.0.0.x is the zone's own words about which of its lists
        // fired; an answer we could not read has no code to show.
        code: r.listed ? r.codes?.[0]?.address || null : null,
    };
}));
</script>
