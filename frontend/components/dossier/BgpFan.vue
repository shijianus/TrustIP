<template>
    <div class="jn-card rounded-[var(--radius)] p-4">
        <SectionTitle :title="t('dossier.topology.title')">
            <template #aside>
                <VerdictChip tone="info" :label="t('dossier.topology.source')" />
            </template>
        </SectionTitle>

        <p v-if="!origin" class="text-sm text-muted-foreground">{{ t('dossier.topology.noAsn') }}</p>

        <template v-else>
            <!-- Three columns with drawn connectors: the graph is the point, so
                 the edges are actual lines rather than implied by adjacency.
                 Widths stay uniform because path proportion needs a looking-glass
                 view of who carries the prefix, which this build does not query;
                 a varying width would be read as measured share. -->
            <div class="overflow-x-auto">
                <svg :viewBox="`0 0 ${W} ${H}`" class="block w-full min-w-[760px]"
                    role="img" :aria-label="ariaSummary">
                    <line
                        v-for="(e, i) in edges" :key="'e' + i"
                        :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
                        class="stroke-muted-foreground/45" stroke-width="1.4"
                        :stroke-dasharray="e.dashed ? '5 4' : null" />

                    <g v-for="(n, i) in nodes" :key="'n' + i">
                        <rect
                            :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="6"
                            :class="[
                                n.tier1 ? 'fill-action-soft stroke-action'
                                    : (n.origin ? 'fill-foreground stroke-foreground' : 'fill-muted stroke-muted-foreground/35'),
                            ]"
                            :stroke-width="n.tier1 || n.origin ? 1.6 : 1"
                            :stroke-dasharray="n.peer ? '4 3' : null" />
                        <text
                            :x="n.x + 8" :y="n.y + 15"
                            class="text-[10.5px] font-semibold"
                            :class="n.origin ? 'fill-background' : 'fill-foreground'">
                            AS{{ n.asn }}
                        </text>
                        <text
                            :x="n.x + 8" :y="n.y + 27"
                            class="text-[9.5px]"
                            :class="n.origin ? 'fill-background/70' : 'fill-muted-foreground'">
                            {{ truncate(n.org) }}
                        </text>
                        <text
                            v-if="n.customers"
                            :x="n.x + NODE_W - 7" :y="n.y + 15" text-anchor="end"
                            class="text-[9.5px]"
                            :class="n.origin ? 'fill-background/70' : 'fill-muted-foreground'">
                            {{ compact(n.customers) }}
                        </text>
                    </g>

                    <text v-for="(c, i) in colLabels" :key="'c' + i" :x="c.x" :y="12"
                        class="text-[9px] font-semibold uppercase tracking-wide fill-muted-foreground">
                        {{ c.label }}
                    </text>

                    <!-- An empty third column is the correct answer for a
                         network whose upstreams are all Tier 1 — they have
                         nothing above them — but a blank space reads as a
                         section that failed to load, so it is said out loud. -->
                    <text v-if="!secondHop.length" :x="colX(2)" :y="rowY(0) + 14"
                        class="text-[10px] fill-muted-foreground">
                        {{ t('dossier.topology.noSecondHop') }}
                    </text>
                </svg>
            </div>

            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                {{ t('dossier.topology.legend') }}
            </p>
        </template>
    </div>
</template>

<script setup>
// The address's BGP neighbourhood as a drawn graph, computed from the CAIDA
// relationship snapshot already loaded at boot — no request, no key.
//
// A Tier-1 in the upstream column has no upstream of its own; that is what
// makes it Tier-1, so an empty second hop behind it is the correct answer and
// not a gap to apologise for.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';

const props = defineProps({
    topology: { type: Object, default: null },
});

const { t } = useI18n();

const NODE_W = 168;
const NODE_H = 34;
// Wide enough that the three columns fill a desktop card at roughly their own
// size instead of ballooning: the SVG carries no explicit height, so the
// viewBox ratio is what fixes the text size on screen.
const GAP_X = 150;
const GAP_Y = 10;
const TOP = 26;
const W = (NODE_W + GAP_X) * 3;

const origin = computed(() => props.topology?.origin || null);
const providers = computed(() => props.topology?.providers || []);
const peers = computed(() => props.topology?.peers || []);

const colX = (col) => col * (NODE_W + GAP_X);
const rowY = (i) => TOP + i * (NODE_H + GAP_Y);

// Right-hand column is the upstreams' own upstreams, flattened with a back
// reference so an edge can be drawn from the provider that led to it.
const secondHop = computed(() => {
    const out = [];
    for (const hop of props.topology?.secondHop || []) {
        for (const up of hop.upstreams || []) out.push({ ...up, via: hop.via });
    }
    return out.slice(0, 8);
});

const nodes = computed(() => {
    if (!origin.value) return [];
    const list = [
        { ...origin.value, origin: true, x: colX(0), y: rowY(0) },
        ...providers.value.map((n, i) => ({ ...n, x: colX(1), y: rowY(i) })),
        ...secondHop.value.map((n, i) => ({ ...n, x: colX(2), y: rowY(i) })),
    ];
    // Peers share the middle column beneath the upstreams; they are a
    // different relationship and colouring them the same would flatten it.
    const peerStart = providers.value.length;
    peers.value.forEach((n, i) => list.push({ ...n, peer: true, x: colX(1), y: rowY(peerStart + i) }));
    return list;
});

const H = computed(() => TOP + Math.max(1, nodes.value.length) * (NODE_H + GAP_Y) + 6);

const edges = computed(() => {
    if (!origin.value) return [];
    const out = [];
    const from = { x: colX(0) + NODE_W, y: rowY(0) + NODE_H / 2 };
    providers.value.forEach((n, i) => out.push({
        x1: from.x, y1: from.y, x2: colX(1), y2: rowY(i) + NODE_H / 2,
    }));
    peers.value.forEach((n, i) => out.push({
        x1: from.x, y1: from.y, x2: colX(1), y2: rowY(providers.value.length + i) + NODE_H / 2, dashed: true,
    }));
    secondHop.value.forEach((n, i) => {
        const pi = providers.value.findIndex((p) => p.asn === n.via);
        if (pi < 0) return;
        out.push({
            x1: colX(1) + NODE_W, y1: rowY(pi) + NODE_H / 2,
            x2: colX(2), y2: rowY(i) + NODE_H / 2,
        });
    });
    return out;
});

const colLabels = computed(() => [
    { x: colX(0), label: t('dossier.topology.origin') },
    { x: colX(1), label: t('dossier.topology.providers') },
    { x: colX(2), label: t('dossier.topology.secondHop') },
]);

const ariaSummary = computed(() => `${origin.value?.asn || ''} → ${providers.value.length} upstreams, ${peers.value.length} peers`);

const compact = (n) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n);
const truncate = (s) => (s || t('dossier.topology.unknownOrg')).slice(0, 24);
</script>
