<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.topology.title')">
            <template #aside>
                <VerdictChip tone="info" :label="t('dossier.topology.source')" />
            </template>
        </SectionTitle>

        <p v-if="!origin" class="text-sm text-muted-foreground">{{ t('dossier.topology.noAsn') }}</p>

        <div v-else class="space-y-3">
            <!-- Three columns: this AS, who it buys transit from, and the
                 settlement-free peers it swaps traffic with. Node weight is
                 the customer count — how many ASes buy transit from that
                 network — because that is what the snapshot actually
                 measures. The diagram this one is modelled on draws edge
                 widths from path proportions, which need a looking-glass
                 view of who carries the prefix; we do not query one, so the
                 edges stay uniform rather than implying a number we lack. -->
            <div class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg border bg-muted/30 p-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {{ t('dossier.topology.origin') }}
                    </p>
                    <NodeCard :node="origin" highlight />
                </div>
                <div class="rounded-lg border p-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {{ t('dossier.topology.providers') }}
                        <span class="jn-nums normal-case">({{ providers.length }})</span>
                    </p>
                    <div class="space-y-2">
                        <NodeCard v-for="n in providers" :key="n.asn" :node="n" />
                        <p v-if="!providers.length" class="text-xs text-muted-foreground">
                            {{ t('dossier.topology.noProviders') }}
                        </p>
                    </div>
                </div>
                <div class="rounded-lg border p-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {{ t('dossier.topology.peers') }}
                        <span class="jn-nums normal-case">({{ peers.length }})</span>
                    </p>
                    <div class="space-y-2">
                        <NodeCard v-for="n in peers" :key="n.asn" :node="n" />
                        <p v-if="!peers.length" class="text-xs text-muted-foreground">
                            {{ t('dossier.topology.noPeers') }}
                        </p>
                    </div>
                </div>
            </div>

            <p class="text-xs leading-relaxed text-muted-foreground">
                {{ t('dossier.topology.legend') }}
            </p>
        </div>
    </div>
</template>

<script setup>
// The address's BGP neighbourhood, computed from the CAIDA relationship
// snapshot loaded at boot. No network request and no third-party key: the
// provider/peer graph is already in this process's memory.
//
// A Tier-1 in the provider column has no upstream of its own, which is what
// makes it Tier-1 — the second hop therefore legitimately comes back empty
// there, and is not rendered as a gap.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import NodeCard from '@/components/ip-infos/TopologyNode.vue';

const props = defineProps({
    topology: { type: Object, default: null },
});

const { t } = useI18n();

const origin = computed(() => props.topology?.origin || null);
const providers = computed(() => props.topology?.providers || []);
const peers = computed(() => props.topology?.peers || []);
</script>
