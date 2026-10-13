<template>
    <div class="min-h-screen">
        <StandalonePageHeader :rail="true" :title="t('dossier.title')" />

        <main class="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-6">
            <h1 class="mb-1 text-2xl font-semibold tracking-tight md:text-3xl">
                🔍 {{ t('dossier.title') }}
            </h1>
            <p class="mb-4 text-sm text-muted-foreground md:text-base">{{ t('dossier.subtitle') }}</p>

            <div class="mb-6 flex gap-2">
                <Input
                    v-model="draft"
                    :placeholder="t('dossier.placeholder')"
                    class="font-mono"
                    autocomplete="off" autocorrect="off" autocapitalize="off"
                    spellcheck="false" data-1p-ignore data-lpignore="true"
                    @keyup.enter="lookup" />
                <Button variant="action" :disabled="!looksLikeIp" @click="lookup">{{ t('dossier.go') }}</Button>
            </div>

            <div v-if="!target" class="jn-card rounded-[var(--radius)] p-6 text-sm text-muted-foreground">
                {{ t('dossier.hint') }}
            </div>

            <CapabilitySlot
                v-else-if="!served"
                state="delegated" :title="t('dossier.title')"
                :note="t('dossier.notServedNote')" to="/ipinfo" :cta="t('dossier.notServedCta')" />

            <div v-else-if="error" class="rounded-lg border border-destructive-soft bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-fg">
                {{ error }}
                <Button variant="ghost" size="sm" class="ms-2" @click="load(target)">{{ t('dossier.retry') }}</Button>
            </div>

            <div v-else-if="!dossier" class="space-y-4">
                <div class="jn-card rounded-[var(--radius)] p-4">
                    <div class="jn-skeleton mb-3 h-5 w-52"></div>
                    <div class="space-y-2"><div v-for="n in 5" :key="n" class="jn-skeleton h-4 w-full"></div></div>
                </div>
                <div class="grid gap-4 md:grid-cols-2">
                    <div v-for="n in 4" :key="n" class="jn-card rounded-[var(--radius)] p-4">
                        <div class="jn-skeleton mb-3 h-4 w-32"></div>
                        <div v-for="m in 5" :key="m" class="jn-skeleton mb-2 h-4 w-full"></div>
                    </div>
                </div>
            </div>

            <template v-else>
                <!-- Anycast public service: its geolocation is the point of
                     presence the visitor reached, so the location, history and
                     neighbour sections below would be noise. Say that once, up
                     front, and keep them — a page that silently drops sections
                     looks broken rather than deliberate. -->
                <div v-if="identity.anycast" class="mb-4 rounded-[var(--radius)] border border-info-soft bg-info-soft px-4 py-3">
                    <p class="text-sm font-semibold text-info-soft-fg">{{ t('dossier.anycast.title') }}</p>
                    <p class="mt-1 text-xs leading-relaxed text-info-soft-fg/90">{{ t('dossier.anycast.note') }}</p>
                </div>

                <!-- 1 — hero -->
                <div class="mb-4">
                    <DossierHero :ip="target" :trust="trust" :place="placeLine" :country-code="countryCode">
                        <TrustSignals :signals="trust.signals" :confidence="trust.confidence" :gaps="trust.gaps" />
                    </DossierHero>
                </div>

                <!-- 2 — usage/type | ASN/provider -->
                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.usage')" />
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.row.native')">
                                <span class="inline-flex items-center gap-1.5">
                                    <Icon v-if="countryCode" :icon="'circle-flags:' + countryCode" class="size-4 rounded-sm" />
                                    <VerdictChip :tone="nativeness.tone" :label="nativeness.label" />
                                </span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.tags')">
                                <span class="flex flex-wrap justify-end gap-1">
                                    <VerdictChip
                                        v-for="tag in tags" :key="tag.label"
                                        :tone="tag.tone" :label="tag.label" />
                                    <VerdictChip v-if="!tags.length" tone="muted" :label="t('trustip.verdict.notMeasured')" />
                                </span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.ispType')">
                                <span class="font-semibold" :class="classTextTone">{{ operatorType }}</span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.humanBot')">
                                <TrafficBar :value="null" />
                            </KeyRow>
                            <!-- Three rings rather than one verdict: the question
                                 a visitor is really asking is "can I run *this*
                                 from it", and a single score would hide which
                                 use the network fails. -->
                            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1.5">
                                <dt class="min-w-0 text-sm font-normal text-muted-foreground">{{ t('dossier.row.scene') }}</dt>
                                <dd class="flex items-center gap-3">
                                    <GaugeRing
                                        v-for="s in scenarios" :key="s.key"
                                        :label="s.label" :value="s.value" :tone="s.tone" :size="46" />
                                </dd>
                            </div>
                            <KeyRow :label="t('dossier.row.company')" :value="network.asOrg" wide />
                            <!-- Three names for one network, because the
                                 registries keep three and each answers a
                                 different question: how the AS is listed, who
                                 legally holds it, and what the routing table
                                 calls it. -->
                            <KeyRow :label="t('dossier.row.provider')" :value="network.holderName" wide />
                        </dl>
                    </div>

                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.asn')" />
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.row.asn')">
                                <span class="inline-flex items-center gap-1.5">
                                    <span class="jn-nums font-mono font-semibold">{{ network.asn ? 'AS' + network.asn : '—' }}</span>
                                    <CopyButton v-if="network.asn" :value="'AS' + network.asn" />
                                </span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.asnOrg')" :value="network.asName || network.asOrg" wide />
                            <KeyRow :label="t('dossier.row.asnKind')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.asnSize')" :nums="true">
                                <span v-if="network.ipv4Total" class="jn-nums font-semibold">{{ network.ipv4Total.toLocaleString(locale) }}</span>
                                <VerdictChip v-else tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.bandwidth')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.asnRegistered')" :value="asnRegisteredDate" />
                            <KeyRow :label="t('dossier.row.registered')" :value="allocationDate" />
                            <KeyRow :label="t('dossier.row.cidr')" :nums="true">
                                <span class="font-mono text-xs">{{ network.cidr || '—' }}</span>
                            </KeyRow>
                        </dl>
                    </div>
                </div>

                <!-- 3 — three dense columns -->
                <div class="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.technical')" />
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.row.bogon')">
                                <VerdictChip tone="ok" :label="t('dossier.row.bogonNo')" />
                            </KeyRow>
                            <!-- A PTR is read from the right — the domain is the
                                 answer and the host octets are noise — so
                                 ellipsising it would keep exactly the wrong
                                 half. It gets the whole line and wraps instead. -->
                            <KeyRow :label="t('dossier.row.rdns')">
                                <span class="break-all font-mono text-xs font-normal">{{ network.rdns || '—' }}</span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.ports')">
                                <!-- Three answers, not one: the ports the archive
                                     saw, an address it has never looked at, and a
                                     deployment that does not ask it at all. The
                                     last two both read "nothing here" if the row is
                                     given a single fallback. -->
                                <span v-if="openPorts" class="break-all font-mono text-xs font-normal">{{ openPorts }}</span>
                                <span v-else-if="scanSeen" class="jn-nums text-xs font-normal">—</span>
                                <VerdictChip
                                    v-else
                                    tone="muted"
                                    :label="scanMissing ? t('dossier.deep.nodata') : t('trustip.verdict.notMeasured')"
                                />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.announce')" :nums="true">
                                {{ network.announce ? `${network.announce.v4Count} · ${Math.round((network.announce.smallShare || 0) * 100)}% ≤/24` : '—' }}
                            </KeyRow>
                        </dl>
                    </div>

                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.threat')">
                            <template #aside>
                                <span class="jn-nums text-xs text-muted-foreground">{{ threatScore }}</span>
                            </template>
                        </SectionTitle>
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.row.riskFlags')">
                                <VerdictChip :tone="riskFlagsChip.tone" :label="riskFlagsChip.label" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.abuseLevel')">
                                <VerdictChip :tone="abuseLevelChip.tone" :label="abuseLevelChip.label" />
                            </KeyRow>
                            <!-- Honeypot hits need traffic this build never sees.
                                 The row stays, and answers about the gap: an
                                 absent row is a bug, a declared one is data. -->
                            <KeyRow :label="t('dossier.row.honeypot')">
                                <VerdictChip tone="muted" :label="t('dossier.deep.nodata')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.rpki')">
                                <VerdictChip :tone="rpkiTone" :label="rpkiLabel" />
                            </KeyRow>
                        </dl>
                    </div>

                    <!-- Deep risk check: four named lookups, each with its own
                         three-state answer. A row that cannot be answered shows
                         "not measured" — never the green that would be read as
                         "checked and clean". -->
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.deep')">
                            <template #aside>
                                <span class="jn-nums text-xs text-muted-foreground">{{ deepScore }}</span>
                            </template>
                        </SectionTitle>
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow v-for="row in deepRows" :key="row.label" :label="row.label">
                                <!-- Three answers, not two. "Not detected" is a
                                     claim about the address; "no data" is a claim
                                     about this build, and collapsing them would
                                     hand every unmeasured network a clean bill. -->
                                <VerdictChip :tone="row.tone" :label="row.label2" />
                            </KeyRow>
                        </dl>
                    </div>
                </div>

                <!-- 4 — VPN traceability -->
                <div class="mb-4">
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.vpntrace')"
                        :note="t('dossier.slot.vpntraceNote')" :needs="t('dossier.slot.vpntraceNeeds')" />
                </div>

                <!-- 5 — global latency matrix -->
                <div class="mb-4">
                    <LatencyMatrix :matrix="dossier.latency" />
                </div>

                <!-- 6 — prefix heat | location map -->
                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <HeatTrend :heat="dossier.heat" />
                    <MapPanel :geo="dossier.geo" />
                </div>

                <!-- 7 — multi-source geolocation -->
                <div class="mb-4">
                    <GeoSources :geo="dossier.geo" />
                </div>

                <!-- 8 — related domains -->
                <div class="mb-4">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.related')">
                            <template #aside>
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </template>
                        </SectionTitle>
                        <CellGrid :items="relatedDomains" :empty="t('dossier.related.empty')" />
                        <NeedsLine :text="t('dossier.related.needs')" />
                    </div>
                </div>

                <!-- 9 — location history | same-facility activity -->
                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.locationHistory')">
                            <template #aside>
                                <span class="jn-nums text-xs text-muted-foreground">{{ locationHistory.length }}</span>
                            </template>
                        </SectionTitle>
                        <dl v-if="locationHistory.length" class="divide-y divide-dashed divide-border">
                            <KeyRow
                                v-for="(row, i) in locationHistory" :key="i"
                                :label="historyDate(row.date)" :nums="true">
                                <span class="inline-flex items-center gap-1.5 text-xs font-normal">
                                    <Icon v-if="row.country_code" :icon="'circle-flags:' + row.country_code" class="size-3.5 rounded-sm" />
                                    {{ [row.country, row.region, row.city].filter(Boolean).join(' / ') }}
                                </span>
                            </KeyRow>
                        </dl>
                        <!-- The frame without invented dates: four plausible
                             entries would read as a log that merely looked
                             empty at the top, which is a claim about the
                             address rather than about this build. -->
                        <p v-else class="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                            {{ t('dossier.history.empty') }}
                        </p>
                        <NeedsLine :text="t('dossier.history.needs')" />
                    </div>
                    <CapabilitySlot
                        :state="neighbourSlot.status" :title="t('dossier.sec.neighbours')"
                        :missing="neighbourGaps" :needs="t('dossier.neighbours.needs')">
                        <CellGrid :items="neighbours" :empty="neighboursEmpty" />
                    </CapabilitySlot>
                </div>

                <!-- 10 — BGP graph -->
                <div class="mb-4">
                    <BgpFan :topology="dossier.topology" />
                </div>

                <!-- 11 — DNSBL -->
                <div class="mb-4">
                    <BlocklistPanel :blocklists="dossier.blocklists" :gap-key="dossier.slots?.blocklists?.gapKey || ''" />
                </div>

                <!-- 12 — ASN history | company history -->
                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.asnHistory')">
                            <template #aside>
                                <span class="jn-nums text-xs text-muted-foreground">{{ asnHistory.length }}</span>
                            </template>
                        </SectionTitle>
                        <dl v-if="asnHistory.length" class="divide-y divide-dashed divide-border">
                            <KeyRow
                                v-for="row in asnHistory.slice(0, 8)" :key="row.asn"
                                :label="historyDate(row.first)" :nums="true">
                                <span class="text-xs font-normal">
                                    AS{{ row.asn }} · {{ row.org || t('dossier.topology.unknownOrg') }}
                                    <span class="jn-nums ms-1 text-muted-foreground">{{ row.prefix }}</span>
                                </span>
                            </KeyRow>
                        </dl>
                        <p v-else class="text-sm text-muted-foreground">
                            {{ asnHistoryFailed ? t('dossier.asnHistory.failed') : t('dossier.asnHistory.empty') }}
                        </p>
                        <p v-if="asnHistory.length" class="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {{ t('dossier.asnHistory.note') }}
                        </p>
                    </div>
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.companyHistory')"
                        :note="t('dossier.slot.companyHistoryNote')" :needs="t('dossier.slot.companyHistoryNeeds')" />
                </div>

                <!-- 13 — same-facility providers / customers -->
                <div class="mb-4">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.colocated')">
                            <template #aside>
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </template>
                        </SectionTitle>
                        <CellGrid :items="colocated" :empty="t('dossier.colocated.empty')" />
                        <NeedsLine :text="t('dossier.colocated.needs')" />
                    </div>
                </div>

                <!-- 14 — actions beside cross-checks: the in-app siblings that
                     answer questions this page cannot, then the third-party
                     views a visitor can disagree with us against. -->
                <div class="mb-4 grid gap-4 lg:grid-cols-[auto_1fr]">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.sec.actions')" />
                        <div class="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
                            <RouterLink
                                v-for="a in actions" :key="a.to"
                                :to="a.to"
                                class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-foreground-secondary no-underline transition-colors hover:bg-accent">
                                <component :is="a.icon" class="size-4 shrink-0" />
                                {{ a.label }}
                            </RouterLink>
                        </div>
                        <!-- The shareable card. Gated on a font rather than a key:
                             a host that cannot draw text answers 503, so the button
                             is hidden instead of offering a download that fails. -->
                        <div v-if="canShareCard"
                            class="mt-3 flex flex-wrap gap-2 border-t border-dashed border-border pt-3 lg:flex-col lg:items-stretch">
                            <a :href="cardUrl" :download="`trustip-${target}.png`"
                                class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-foreground-secondary no-underline transition-colors hover:bg-accent">
                                <ImageIcon class="size-4 shrink-0" />
                                {{ t('ipCard.download') }}
                            </a>
                            <CopyButton :value="cardUrl" :tooltip="t('ipCard.copyLink')" :aria-label="t('ipCard.copyLink')" />
                        </div>
                    </div>

                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.cross.title')" />
                        <div class="flex flex-wrap gap-2">
                            <a
                                v-for="link in crossChecks" :key="link.label"
                                :href="link.url" target="_blank" rel="nofollow noopener"
                                class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-foreground-secondary no-underline transition-colors hover:bg-accent">
                                {{ link.label }}
                                <ArrowUpRight class="size-3" />
                            </a>
                        </div>
                    </div>
                </div>
            </template>
        </main>

        <Footer />
    </div>
</template>

<script setup>
// The IP dossier: one address, everything this build can establish about it,
// laid out section by section in the order a lookup is read.
//
// Sections with no backing data are rendered as declared gaps with their real
// row shape, not omitted. A page that silently lacks a section teaches the
// visitor nothing; a row that says "not measured" tells them exactly where the
// boundary of this build is, and a placeholder naming the source that would
// fill it is a task rather than a mystery.

import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { Icon } from '@iconify/vue';
import { ArrowUpRight, Globe2, Activity, Radar, Gauge, Image as ImageIcon } from '@lucide/vue';
import { useMainStore } from '@/store.js';
import { isValidIP } from '@/utils/valid-ip.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import StandalonePageHeader from '@/components/StandalonePageHeader.vue';
import Footer from '@/components/Footer.vue';
import DossierHero from '@/components/dossier/DossierHero.vue';
import TrustSignals from '@/components/dossier/TrustSignals.vue';
import GeoSources from '@/components/ip-infos/GeoSources.vue';
import BgpFan from '@/components/dossier/BgpFan.vue';
import MapPanel from '@/components/dossier/MapPanel.vue';
import HeatTrend from '@/components/dossier/HeatTrend.vue';
import BlocklistPanel from '@/components/dossier/BlocklistPanel.vue';
import LatencyMatrix from '@/components/dossier/LatencyMatrix.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import GaugeRing from '@/components/widgets/GaugeRing.vue';
import TrafficBar from '@/components/widgets/TrafficBar.vue';
import CellGrid from '@/components/widgets/CellGrid.vue';
import NeedsLine from '@/components/widgets/NeedsLine.vue';
import CapabilitySlot from '@/components/widgets/CapabilitySlot.vue';
import CopyButton from '@/components/widgets/CopyButton.vue';
import Button from '@/components/ui/button/Button.vue';
import Input from '@/components/ui/input/Input.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();

const target = ref(route.params.ip || route.query.q || '');

const store = useMainStore();
// Whether this deployment answers `/api/dossier`. A property of the server, not
// of the address: the hosted edge function serves fewer routes than Express, and a
// page that calls a route which is not there reports a failure to assemble the
// dossier when the truth is that no dossier is assembled here.
const served = computed(() => store.configs?.dossier !== false);
// The card is rendered by this server, so it needs the language as a query
// parameter rather than the app's runtime locale — and the address has to be in
// the URL, because `/ip` without one is the visitor's own, which the server
// cannot see.
const cardUrl = computed(() => `/api/ip-card?ip=${encodeURIComponent(target.value)}`
    + `&lang=${encodeURIComponent(store.lang || 'en')}`);
const canShareCard = computed(() => Boolean(store.configs?.ipCard) && isValidIP(target.value));
const draft = ref(target.value);
const dossier = ref(null);
const error = ref('');

const looksLikeIp = computed(() => isValidIP((draft.value || '').trim()));

const trust = computed(() => dossier.value?.trust || { signals: [], confidence: {}, gaps: [] });
const identity = computed(() => dossier.value?.identity || {});
const network = computed(() => dossier.value?.network || {});

const sources = computed(() => dossier.value?.geo?.sources || []);
const primarySource = computed(() => sources.value.find((s) => s.lat != null && s.lon != null) || sources.value[0] || null);
const countryCode = computed(() => String(identity.value.country_code || primarySource.value?.country_code || '').toLowerCase());
const placeLine = computed(() => {
    const c = dossier.value?.geo?.consensus || {};
    return [c.country, c.city, network.value.asOrg].filter(Boolean).join(' · ');
});

const CLASS_KEY = { datacenter: 'tags.datacenter', isp: 'tags.isp', mobile: 'tags.mobile', education: 'tags.education', government: 'tags.government', anycast: 'tags.anycast', unknown: null };
const CLASS_TONE = { datacenter: 'bad', isp: 'ok', mobile: 'ok', education: 'info', government: 'info', anycast: 'info', unknown: 'muted' };

const operatorType = computed(() => {
    const cls = trust.value.cls;
    if (!cls || cls === 'unknown') return t('trustip.value.unknown');
    return t(`trustip.value.${cls}`);
});
const classTextTone = computed(() => CLASS_TONE[trust.value.cls] === 'ok' ? 'text-success-soft-fg' : '');

// One chip per property a reader would want to filter on, not one per signal
// the score used: an anycast resolver is also a datacenter, and showing only
// the stronger of the two loses the fact that explains everything else on the
// page.
const tags = computed(() => {
    const out = [];
    const cls = trust.value.cls;
    if (cls && cls !== 'unknown') out.push({ tone: CLASS_TONE[cls], label: t(`trustip.value.${cls}`) });
    if (identity.value.anycast) out.push({ tone: 'info', label: t('dossier.tag.anycast') });
    if (['invalid', 'invalid_asn', 'invalid_length'].includes(network.value.rpki)) {
        out.push({ tone: 'bad', label: t('dossier.tag.rpkiProblem') });
    }
    return out;
});

// The three uses a visitor actually weighs an address against. Each is null
// until this build has a basis for it — none of the three can be inferred from
// a registry record, and a ring drawn from a guess would be the most
// authoritative-looking lie on the page.
const scenarios = computed(() => [
    { key: 'tiktok', label: t('dossier.scene.tiktok'), value: null, tone: 'muted' },
    { key: 'social', label: t('dossier.scene.social'), value: null, tone: 'muted' },
    { key: 'ai', label: t('dossier.scene.ai'), value: null, tone: 'muted' },
]);

const nativeness = computed(() => {
    const s = trust.value.signals?.find((x) => x.id === 'nativeness');
    if (!s || s.state === 'unknown') return { tone: 'muted', label: t('trustip.verdict.notMeasured') };
    return s.detail === 'native'
        ? { tone: 'ok', label: t('dossier.row.nativeYes') }
        : { tone: 'warn', label: t('dossier.row.nativeNo') };
});

const RPKI_TONE = { valid: 'ok', invalid: 'bad', invalid_asn: 'bad', invalid_length: 'warn', 'not-found': 'warn' };
const rpkiTone = computed(() => RPKI_TONE[network.value.rpki] || 'muted');
const rpkiLabel = computed(() => network.value.rpki && network.value.rpki !== 'unknown'
    ? t(`trustip.value.${network.value.rpki}`)
    : t('trustip.verdict.notMeasured'));

// The three answers a risk row can carry. `detected` and `clear` are claims
// about the address; `unknown` is a claim about this build. Collapsing the third
// into the second is how an unmeasured network is handed a clean bill, so all
// three stay on screen even when only one source can fill two of them.
const DEEP_STATES = {
    detected: { tone: 'bad', key: 'detected' },
    clear: { tone: 'ok', key: 'clear' },
    unknown: { tone: 'muted', key: 'nodata' },
};

const chipOf = (state) => {
    const s = DEEP_STATES[state];
    return { tone: s.tone, label: t(`dossier.deep.${s.key}`) };
};

// A row's verdict is read off the signal the server already scored, never
// re-derived here: a second threshold written in the frontend would be a second
// definition of "how bad is bad", and the two drift apart the first time a
// weight moves.
const stateOfSignal = (id) => (dossier.value?.trust?.signals || [])
    .find((s) => s.id === id)?.state;
const chipForSignal = (id) => chipOf(stateOfSignal(id) === 'negative' ? 'detected'
    : stateOfSignal(id) === 'unknown' ? 'unknown' : 'clear');

const riskFlagsChip = computed(() => chipForSignal('blocklists'));
const abuseLevelChip = computed(() => chipForSignal('historicalAbuseReports'));

// Three of the four rows are answerable by this build — the honeypot row needs
// traffic we never see — so a full house is 3 / 4, and the missing fourth is the
// panel saying so rather than a gap in the page.
const threatScore = computed(() => {
    const rpkiKnown = Boolean(network.value.rpki) && network.value.rpki !== 'unknown';
    const known = [riskFlagsChip.value, abuseLevelChip.value]
        .filter((chip) => chip.tone !== 'muted').length + (rpkiKnown ? 1 : 0);
    return `${known} / 4`;
});

// The scan archive's answer about what was listening here, when this deployment
// asks it at all. A `record` with an empty port list is still an observation, so it
// is not the same as an address nobody looked at, which is not the same as a build
// that never asks.
const scan = computed(() => network.value.scan || null);
const openPorts = computed(() => (scan.value?.status === 'record' && scan.value.ports?.length)
    ? scan.value.ports.join(' · ')
    : null);
const scanSeen = computed(() => scan.value?.status === 'record' && !openPorts.value);
const scanMissing = computed(() => scan.value?.status === 'no-record');

// The keyed lists report VPN, proxy and Tor as three separate postures, so each
// row answers for itself — and a row whose field no vendor carried answers about
// the build, not about the address. An object nobody answered is dropped here so
// every row falls through to "this build did not measure it" rather than a clear.
const privacyFlags = computed(() => {
    const pv = dossier.value?.privacy;
    return pv?.sources?.length ? pv : {};
});
const deepRows = computed(() => {
    const pv = privacyFlags.value;
    const row = (name, known, hit) => {
        const chip = known ? chipOf(hit ? 'detected' : 'clear') : chipOf('unknown');
        return { label: t(name), tone: chip.tone, label2: chip.label };
    };
    return [
        row('dossier.row.vpn', typeof pv.vpn === 'boolean', pv.vpn),
        row('dossier.row.proxy', typeof pv.proxy === 'boolean', pv.proxy),
        row('dossier.row.tor', typeof pv.tor === 'boolean', pv.tor),
        // Human-versus-bot traffic is the one capability no abuse feed
        // substitutes for: it needs observation, not a vendor's list.
        row('dossier.row.crawler', false, false),
    ];
});
const deepScore = computed(() => `${deepRows.value.filter((r) => r.tone !== 'muted').length} / 4`);

const asnRegisteredDate = computed(() => {
    const raw = network.value.asnRegistered;
    if (!raw) return '';
    const m = /^\d{4}-\d{2}-\d{2}/.exec(raw);
    return m ? formatIsoDate(m[0], locale.value) : raw;
});

// The three sections that need a source this build does not have. They are
// empty arrays rather than absent so the panels render their grid, their
// headers and their "nothing here" row — the layout the page promises.
const relatedDomains = computed(() => []);
const colocated = computed(() => []);
const locationHistory = computed(() => []);

// The block the registry already placed this address in names the two addresses
// beside it and its two edges, so these are links, not a measurement: opening
// one asks that address its own question, and nothing is contacted from here.
const NEIGHBOUR_ROLES = {
    previous: 'dossier.neighbours.role.previous',
    next: 'dossier.neighbours.role.next',
    blockFirst: 'dossier.neighbours.role.blockFirst',
    blockLast: 'dossier.neighbours.role.blockLast',
};
const neighbourSlot = computed(() => dossier.value?.slots?.neighbours || { status: 'placeholder', missing: [] });
const neighbourGaps = computed(() => (neighbourSlot.value.missing || []).map((key) => t(`dossier.neighbours.gap.${key}`)));
const neighbours = computed(() => (dossier.value?.neighbours?.entries || []).map((entry) => ({
    main: entry.ip,
    sub: t(NEIGHBOUR_ROLES[entry.role]),
    to: `/ip/${encodeURIComponent(entry.ip)}`,
})));
// Two different reasons for an empty grid, and one sentence cannot carry both:
// a registry that named no block leaves the neighbours unknown, while a block
// of one address means there genuinely is nothing beside it.
const neighboursEmpty = computed(() => t(
    dossier.value?.neighbours ? 'dossier.neighbours.single' : 'dossier.neighbours.noBlock',
));

const allocationDate = computed(() => {
    const raw = network.value.regDate;
    if (!raw) return '';
    const m = /^\d{4}-\d{2}-\d{2}/.exec(raw);
    return m ? formatIsoDate(m[0], locale.value) : raw;
});

const asnHistory = computed(() => dossier.value?.asnHistory?.entries || []);
const asnHistoryFailed = computed(() => dossier.value?.asnHistory?.failed === true);
// RIPEstat timestamps carry a time of day that means nothing at /24
// granularity, and rendering them verbatim would show an untranslated string.
const historyDate = (iso) => {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(iso || '');
    return m ? formatIsoDate(m[0], locale.value) : (iso || '—');
};
const actions = computed(() => [
    { to: { path: '/dns' }, icon: Activity, label: t('dossier.act.dnsleak') },
    { to: { path: '/webrtc' }, icon: Radar, label: t('dossier.act.webrtc') },
    { to: { path: '/ping', query: { q: target.value } }, icon: Globe2, label: t('dossier.act.ping') },
    { to: { path: '/whois', query: { q: target.value } }, icon: Gauge, label: t('dossier.act.whois') },
]);

const crossChecks = computed(() => {
    const ip = target.value;
    const asn = network.value.asn;
    return [
        { label: 'bgp.tools', url: asn ? `https://bgp.tools/as/${asn}` : 'https://bgp.tools' },
        { label: 'RIPEstat', url: `https://stat.ripe.net/${encodeURIComponent(ip)}` },
        { label: 'Cloudflare Radar', url: asn ? `https://radar.cloudflare.com/as/${asn}` : 'https://radar.cloudflare.com' },
        { label: 'Hurricane Electric', url: `https://bgp.he.net/ip/${encodeURIComponent(ip)}` },
        { label: 'Shodan', url: `https://www.shodan.io/host/${encodeURIComponent(ip)}` },
        { label: 'IP2Location', url: `https://www.ip2location.io/${encodeURIComponent(ip)}` },
        { label: 'Scamalytics', url: `https://scamalytics.com/ip/${encodeURIComponent(ip)}` },
    ];
});

async function load(ip) {
    if (!ip || !served.value) return;
    error.value = '';
    try {
        const res = await fetchWithTimeout(`/api/dossier?ip=${encodeURIComponent(ip)}`, { timeoutMs: 30000 });
        if (!res.ok) throw new Error(`dossier ${res.status}`);
        dossier.value = await res.json();
    } catch (err) {
        console.warn('dossier unavailable', err);
        error.value = t('dossier.failed');
    }
}

function lookup() {
    const ip = (draft.value || '').trim();
    if (!isValidIP(ip)) return;
    router.push(`/ip/${encodeURIComponent(ip)}`);
}

watch(() => [route.params.ip, route.query.q], ([param, query]) => {
    const next = param || query || '';
    if (!next || next === target.value) return;
    target.value = next;
    draft.value = next;
    dossier.value = null;
    load(next);
});

onMounted(() => { if (target.value) load(target.value); });

// `/api/configs` lands after mount, so `served` can flip once the boot request
// returns. Without this a visitor who opens the page before configs arrive keeps
// the declared gap even though the server does answer the route.
watch(served, (isServed) => {
    if (isServed && target.value && !dossier.value) load(target.value);
});
</script>
