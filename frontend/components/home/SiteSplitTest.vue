<template>
    <section class="mb-6 border-t pt-8">
        <header class="mb-3">
            <h2 class="text-xl font-bold tracking-tight md:text-2xl">{{ t('home.split.title') }}</h2>
            <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{{ t('home.split.desc') }}</p>
        </header>

        <div class="jn-card overflow-hidden rounded-[10px]">
            <!-- The finding before the table that proves it: which address this
                 network belongs to the visitor, and which sites were reached from a
                 different one. Two rulers — what a STUN server reflected and how many
                 destinations agreed to be reached — get two lines rather than one
                 averaged number, because on a split network they disagree as a matter
                 of course and both sentences are true. -->
            <div class="border-b px-4 py-3">
                <SectionTitle :title="t('home.split.egress.title')" />

                <dl v-if="attribution.primary" class="mt-1 divide-y divide-dashed divide-border">
                    <KeyRow>
                        <template #label>{{ t('home.split.egress.primary') }}</template>
                        <span class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
                            <Icon
                                v-if="attribution.primary.country_code"
                                :icon="'circle-flags:' + attribution.primary.country_code.toLowerCase()"
                                class="size-3.5 shrink-0 rounded-[2px] object-contain" />
                            <RouterLink
                                :to="`/ip/${attribution.primary.ip}`"
                                data-mask="ip"
                                class="jn-nums font-mono text-[13px] text-foreground no-underline hover:underline"
                                >{{ attribution.primary.ip }}</RouterLink>
                            <span class="text-[11px] font-normal text-muted-foreground">
                                {{ t(`home.split.egress.basis.${attribution.primary.basis}`) }}
                            </span>
                        </span>
                    </KeyRow>
                    <KeyRow :label="t('home.split.col.geo')" :value="geoLineOf(attribution.primary)" wide />
                    <KeyRow
                        :label="t('home.split.egress.primarySeen')"
                        :value="t('home.split.egress.seen', { n: attribution.primary.seenBy, total: denominator })"
                        nums />

                    <!-- The other ruler, shown only when it names a different
                         address. Saying "your machine is in the mainland and forty-one
                         sites went out overseas" is the whole finding; hiding either
                         half of it would be a cleaner-looking page that lied. -->
                    <KeyRow v-if="attribution.conflict">
                        <template #label>{{ t('home.split.egress.default') }}</template>
                        <span class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
                            <Icon
                                v-if="attribution.defaultEgress.country_code"
                                :icon="'circle-flags:' + attribution.defaultEgress.country_code.toLowerCase()"
                                class="size-3.5 shrink-0 rounded-[2px] object-contain" />
                            <RouterLink
                                :to="`/ip/${attribution.defaultEgress.ip}`"
                                data-mask="ip"
                                class="jn-nums font-mono text-[13px] text-foreground no-underline hover:underline"
                                >{{ attribution.defaultEgress.ip }}</RouterLink>
                            <span class="jn-nums text-[11px] font-normal text-muted-foreground">
                                {{ t('home.split.egress.seen', { n: attribution.defaultEgress.seenBy, total: denominator }) }}
                            </span>
                        </span>
                    </KeyRow>
                </dl>

                <!-- An address no destination was willing to name is still an
                     address: it came from a source or a leak, and a table that only
                     counted echoes would report one exit for a network with two. -->
                <ul v-if="othersByAddress.length" class="mt-2 divide-y divide-dashed divide-border rounded-[8px] border border-dashed px-3 py-1">
                    <li v-for="group in othersByAddress" :key="group.ip" class="py-2">
                        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span class="text-[11px] font-semibold tracking-[0.4px] text-muted-foreground uppercase">
                                {{ t('home.split.egress.other') }}
                            </span>
                            <Icon
                                v-if="group.country_code"
                                :icon="'circle-flags:' + group.country_code.toLowerCase()"
                                class="size-3.5 shrink-0 rounded-[2px] object-contain" />
                            <RouterLink
                                :to="`/ip/${group.ip}`"
                                data-mask="ip"
                                class="jn-nums font-mono text-[13px] font-semibold text-foreground no-underline hover:underline"
                                >{{ group.ip }}</RouterLink>
                            <span class="jn-nums text-[11px] text-muted-foreground">
                                {{ group.seenBy
                                    ? t('home.split.egress.seen', { n: group.seenBy, total: denominator })
                                    : t('home.split.egress.noEcho') }}
                            </span>
                        </div>
                        <p v-if="group.names.length" class="mt-1 truncate text-[12px] text-muted-foreground" :title="group.names.join(' · ')">
                            {{ t('home.split.egress.routed', { sites: group.shown }) }}
                        </p>
                    </li>
                </ul>

                <p v-else-if="attribution.primary && total" class="mt-2 text-[13px] text-muted-foreground">
                    {{ t('home.split.egress.none') }}
                </p>
                <p v-else-if="!attribution.primary" class="mt-1 text-[13px] text-muted-foreground">
                    {{ running || leakRunning ? t('home.split.row.waiting') : t('home.split.egress.noneYet') }}
                </p>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2.5">
                <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span class="jn-nums">{{ answered }} / {{ total }}</span>
                    <span
                        v-if="distinct.length > 1"
                        class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-soft-fg">
                        {{ t('home.split.summary.split', { n: distinct.length }) }}
                    </span>
                    <span
                        v-else-if="distinct.length === 1"
                        class="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success-soft-fg">
                        {{ t('home.split.summary.single') }}
                    </span>
                </div>
                <Button variant="outline" size="sm" :disabled="running" @click="$emit('run')">
                    <Spinner v-if="running" class="me-1.5" />
                    <RefreshCw v-else class="me-1.5 size-3.5" />
                    {{ t('home.split.rerun') }}
                </Button>
            </div>

            <p v-if="!total && !running" class="px-4 py-6 text-[13px] text-muted-foreground">
                {{ t(planFailed ? 'home.split.planFailed' : 'home.split.row.waiting') }}
            </p>

            <div v-else class="overflow-x-auto">
                <!-- A fixed three-column table cannot fit a phone, and letting it try
                     makes the IP column overflow into the geolocation one. The minimum
                     keeps every column's proportion and lets the card scroll instead —
                     the alignment down the IP column is the whole point of a table, so
                     it is not what gets dropped. -->
                <table class="w-full min-w-[620px] table-fixed border-collapse text-sm">
                    <thead>
                        <!-- A filled header band rather than a bare row of labels:
                             the table runs to forty-odd rows, and the column
                             meanings have to survive a scroll to the middle of it. -->
                        <tr class="border-b bg-muted/60 text-left text-xs text-foreground">
                            <th class="w-[40%] px-4 py-2.5 font-semibold">{{ t('home.split.col.site') }}</th>
                            <th class="w-[24%] px-3 py-2.5 font-semibold">{{ t('home.split.col.ip') }}</th>
                            <th class="px-4 py-2.5 font-semibold">{{ t('home.split.col.geo') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Zebra striping, because the eye is tracking one row
                             across three columns that are far apart. -->
                        <tr v-for="(row, i) in tableRows" :key="row.host"
                            class="border-b border-dashed last:border-b-0"
                            :class="i % 2 ? 'bg-muted/40' : ''">
                            <td class="px-4 py-2.5">
                                <div class="flex min-w-0 items-center gap-2">
                                    <SiteIcon :icon="row.icon" :name="row.name" :seed="row.host" :size="22" />
                                    <span class="truncate font-semibold" :title="row.host">{{ row.name }}</span>
                                    <!-- The chips are the only thing on this row that
                                         says where the destination belongs. A ranking
                                         row is placed by its traffic rank, which is a
                                         stronger statement than "international", so it
                                         carries that one and not the other — two chips
                                         saying where a site is from would be one too
                                         many. No score, no reasoning, no numbers. -->
                                    <span
                                        v-if="row.rank"
                                        class="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success-soft-fg">
                                        {{ t('home.split.rank', { rank: row.rank }) }}
                                    </span>
                                    <span
                                        v-else
                                        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                        :class="row.kind === 'international' ? BADGE.international : BADGE.country">
                                        {{ row.kind === 'international' ? t('home.split.international') : countryName(row.cc) }}
                                    </span>
                                    <span
                                        v-if="row.group"
                                        class="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                                        {{ t(`home.split.group.${row.group}`) }}
                                    </span>
                                </div>
                            </td>

                            <td class="px-3 py-2.5">
                                <div class="flex min-w-0 items-center gap-1.5">
                                    <Icon
                                        v-if="geoOf(row)?.country_code || row.loc"
                                        :icon="'circle-flags:' + String(geoOf(row)?.country_code || row.loc).toLowerCase()"
                                        class="size-3.5 shrink-0 rounded-[2px] object-contain" />
                                    <RouterLink
                                        v-if="row.ip"
                                        :to="`/ip/${row.ip}`"
                                        data-mask="ip"
                                        class="jn-nums truncate font-mono text-[13px] text-foreground no-underline hover:underline"
                                        :title="row.host">{{ row.ip }}</RouterLink>
                                    <!-- This destination was reached from an address
                                         that is not the one the visitor is. One chip,
                                         no explanation: the panel above already named
                                         the address and the ruler that picked it. -->
                                    <span
                                        v-if="isForeign(row)"
                                        class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                        :class="BADGE.other"
                                        :title="t('home.split.egress.otherHint')">
                                        {{ t('home.split.egress.otherShort') }}
                                    </span>
                                    <span v-else-if="row.state === 'pending'" class="jn-queued text-[13px] text-muted-foreground">
                                        {{ t('home.split.row.waiting') }}
                                    </span>
                                    <!-- A row with no address to report did not fail to
                                         answer — it answered a different question. The
                                         samples and their median are what it measured,
                                         so they go in the cell the address would have
                                         occupied rather than being hidden below. -->
                                    <div v-else-if="row.dots?.length" class="flex min-w-0 flex-1 items-center justify-between gap-2">
                                        <span class="flex shrink-0 items-center gap-[3px] overflow-hidden" :aria-label="t('home.query.samples')">
                                            <span
                                                v-for="(dot, i) in row.dots" :key="i"
                                                class="h-1.5 w-1.5 shrink-0 rounded-full"
                                                :class="dotClass(dot.tone)"
                                                :title="dot.ok ? Math.round(dot.ms) + ' ms' : t('home.query.timeout')" />
                                        </span>
                                        <span class="jn-nums shrink-0 text-[13px] font-semibold" :class="textClass(row.tone)">
                                            {{ row.ms == null ? t('home.split.row.unreachable') : Math.round(row.ms) + 'ms' }}
                                        </span>
                                    </div>
                                    <!-- Three states remain that are not a measurement:
                                         the destination refused every connection, it
                                         answered but gave nothing to read, and the row
                                         never ran. Collapsing the first into the second
                                         would throw away the single most useful finding
                                         for someone in a censored network — that the
                                         site did not answer *them*. -->
                                    <span v-else-if="row.state === 'unknown'" class="text-[13px] text-muted-foreground">
                                        {{ t('home.split.row.unknown') }}
                                    </span>
                                    <span v-else-if="row.reachable === false" class="text-[13px] font-medium" :class="textClass('fail')">
                                        {{ t('home.split.row.unreachable') }}
                                    </span>
                                    <span v-else class="jn-nums truncate text-[13px] text-muted-foreground">
                                        {{ t('home.split.row.noAnswer') }}
                                        <span v-if="row.ms != null" class="ms-1" :class="textClass(row.tone)">{{ Math.round(row.ms) }}ms</span>
                                    </span>
                                </div>
                            </td>

                            <td class="px-4 py-2.5">
                                <span class="block truncate text-[13px] text-muted-foreground" :title="geoLine(row)">
                                    <template v-if="geoLine(row)">{{ geoLine(row) }}</template>
                                    <span v-else-if="row.state === 'pending'" class="jn-queued">{{ t('home.split.row.waiting') }}</span>
                                    <!-- An answered row whose geolocation has not landed
                                         is still in flight, not unknown. Saying 未知
                                         here would blame the destination for a lookup
                                         that has not come back yet. -->
                                    <span v-else-if="running" class="jn-queued">{{ t('home.split.row.waiting') }}</span>
                                    <template v-else>—</template>
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Only when rows are already on screen: a re-run whose plan failed
                 leaves the previous answers up, and the caption has to say that the
                 list is now stale rather than complete. -->
            <p v-if="planFailed && total" class="border-t bg-muted/30 px-4 py-2 text-[13px] text-muted-foreground">
                {{ t('home.split.planFailed') }}
            </p>

            <p v-if="total" class="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
                {{ t('home.split.footnote') }}
            </p>
        </div>
    </section>
</template>

<script setup>
// The routing table: one row per destination, showing what that destination
// actually saw, under one panel saying which of those addresses the visitor is.
//
// One flat table, in the reading order the reference layout uses — Website, IP,
// Geolocation — because the question every row answers is the same question and a
// row that needs a section header to explain itself is a row that has stopped being
// a table. That includes the ten biggest sites on the internet, which used to sit
// under the table in a block of their own because they have no address to put in
// the middle column; they are rows now, and they say in their own cell that what
// they measured was a round trip.
//
// What the block above the table is allowed to explain is the *measurement*: which
// address a STUN server reflected, how many destinations agreed to be reached from
// each one, and which sites therefore went out a different way than the visitor
// does. Which countries appear as rows is still decided on the server and still not
// shown — the badge carries the name of the place a destination belongs to and
// nothing else, because how that name was arrived at is a judgement about the
// visitor, not a fact about the site.

import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { RefreshCw } from '@lucide/vue';
import Button from '@/components/ui/button/Button.vue';
import { Spinner } from '@/components/ui/spinner';
import SiteIcon from '@/components/widgets/SiteIcon.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import getCountryName from '@/data/country-name.js';
import { useStatusTone } from '@/composables/use-status-tone.js';

const props = defineProps({
    tableRows: { type: Array, required: true },
    geolocations: { type: Object, default: () => ({}) },
    running: { type: Boolean, default: false },
    planFailed: { type: Boolean, default: false },
    distinct: { type: Array, default: () => [] },
    answered: { type: Number, default: 0 },
    // Which address the visitor is, and which ones only part of the table was
    // reached from. Shape is `classifyEgress`'s own — see utils/egress-attribution.js.
    attribution: { type: Object, default: () => ({ entries: [], others: [], foreignRouted: [] }) },
    // The homepage's own STUN pass is still gathering. Without this, a visitor would
    // read "no other exits" while the one signal that could name them is in flight.
    leakRunning: { type: Boolean, default: false },
});

defineEmits(['run']);

const { t, locale } = useI18n();
const { textClass, dotClass } = useStatusTone();

const BADGE = {
    international: 'bg-action-soft text-action-soft-fg',
    country: 'bg-info-soft text-info-soft-fg',
    other: 'bg-warning-soft text-warning-soft-fg',
};

const countryName = (cc) => getCountryName(cc, locale.value) || cc;

const geoOf = (row) => (row.ip ? props.geolocations[row.ip] : null);

// One address, one line of place. The lookup the page already trusts comes first
// because it is the one that names the city; the entry's own country is the echo or
// the leak's answer, which is enough to show before a lookup lands but not enough to
// override one.
const geoLineOf = (entry) => {
    if (!entry) return '';
    const g = props.geolocations[entry.ip];
    if (g) return [g.city, g.region, g.country_name, g.org].filter(Boolean).join(' ');
    return [entry.country_code ? countryName(entry.country_code) : '', entry.org].filter(Boolean).join(' ');
};

// How many site names one exit row will carry before it becomes a count. A list of
// forty names would not be a summary, and the full set is one click away in the
// `其它` chip's own title attribute.
const NAMED_SITES = 6;

const othersByAddress = computed(() => {
    const routed = props.attribution.foreignRouted || [];
    return (props.attribution.others || []).map((other) => {
        const names = routed.filter((row) => row.ip === other.ip).map((row) => row.name);
        return {
            ...other,
            names,
            shown: names.length > NAMED_SITES
                ? `${names.slice(0, NAMED_SITES).join(' · ')} +${names.length - NAMED_SITES}`
                : names.join(' · '),
        };
    });
});

// The row's own marker beside the address: this destination was reached from an
// address that is not the one the visitor is. Kept to one chip per row and no
// explanation, because the panel above already said which address and why.
const isForeign = (row) => Boolean(row.ip && props.attribution.primary && row.ip !== props.attribution.primary.ip);

const geoLine = (row) => {
    const g = geoOf(row);
    if (g) {
        // `country_name` and `org` are the geo handler's canonical field names —
        // ipinfo itself answers `country` with a code and `org` with "AS15169
        // Google LLC", both of which the handler has already unpacked.
        return [g.city, g.region, g.country_name, g.org].filter(Boolean).join(' ');
    }
    // The echo carries a country code of its own, so a traced row can say where it
    // landed before the geolocation lookup has come back. Two sources for one cell,
    // but always the lookup first: it is the one that names the city.
    if (row.loc) return getCountryName(row.loc, locale.value) || row.loc;
    return null;
};

const total = computed(() => props.tableRows.length);

// The exit counts are read against the destinations that *named* an address, not
// against the whole table. Most national services are not behind Cloudflare and
// never will be, so two thirds of a real run answers a timed request without saying
// whose address it saw — and a column whose numbers do not add up reads as a network
// problem rather than as thirty destinations that stay silent by design.
const denominator = computed(() => props.attribution.attributed || total.value);
</script>
