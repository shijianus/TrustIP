<template>
    <div
        class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
        :class="highlight ? 'bg-background ring-1 ring-foreground/20' : 'bg-muted/40'">
        <span
            class="jn-nums shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold"
            :class="node.tier1 ? 'bg-action-soft text-action-soft-fg' : 'bg-background text-foreground-secondary'">
            AS{{ node.asn }}
        </span>
        <span class="min-w-0 flex-1 truncate" :title="node.org || ''">
            {{ node.org || t('dossier.topology.unknownOrg') }}
        </span>
        <span
            v-if="node.customers"
            class="jn-nums shrink-0 text-muted-foreground"
            :title="t('dossier.topology.customersTip')">
            {{ compact(node.customers) }}
        </span>
    </div>
</template>

<script setup>
// One network in the topology diagram. The badge is the only visual
// distinction the underlying data supports: blue marks a Tier-1, which is a
// fact from the snapshot rather than an inference, and the trailing number is
// how many ASes buy transit from this one.

import { useI18n } from 'vue-i18n';

const props = defineProps({
    node: { type: Object, required: true },
    highlight: { type: Boolean, default: false },
});

const { t } = useI18n();

// 12,400 → "12.4k". Customer counts span four orders of magnitude, and a
// column of raw integers makes the small networks unreadable.
const compact = (n) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n);
</script>
