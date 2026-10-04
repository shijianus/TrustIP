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
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.scene')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.company')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.provider')" :value="network.asOrg || network.asName" wide />
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
                            <KeyRow :label="t('dossier.row.asnSize')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.bandwidth')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
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
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
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
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.abuseLevel')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.row.honeypot')">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
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
                                <span class="jn-nums text-xs text-muted-foreground">0 / 4</span>
                            </template>
                        </SectionTitle>
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow v-for="row in deepRows" :key="row" :label="row">
                                <VerdictChip tone="muted" :label="t('trustip.verdict.notMeasured')" />
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
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.heat')"
                        :note="t('dossier.heat.note')" :needs="t('dossier.heat.needs')" />
                    <MapPanel :geo="dossier.geo" />
                </div>

                <!-- 7 — multi-source geolocation -->
                <div class="mb-4">
                    <GeoSources :geo="dossier.geo" />
                </div>

                <!-- 8 — related domains -->
                <div class="mb-4">
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.related')"
                        :note="t('dossier.related.note')" :needs="t('dossier.related.needs')" />
                </div>

                <!-- 9 — location history | same-facility activity -->
                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.locationHistory')"
                        :note="t('dossier.history.note')" :needs="t('dossier.history.needs')" />
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.neighbours')"
                        :note="t('dossier.related.note')" :needs="t('dossier.related.needs')" />
                </div>

                <!-- 10 — BGP graph -->
                <div class="mb-4">
                    <BgpFan :topology="dossier.topology" />
                </div>

                <!-- 11 — DNSBL -->
                <div class="mb-4">
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.blocklists')"
                        :note="t('dossier.blocklists.note')" :needs="t('dossier.blocklists.needs')" />
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
                    <CapabilitySlot
                        state="placeholder" :title="t('dossier.sec.colocated')"
                        :note="t('dossier.colocated.note')" :needs="t('dossier.colocated.needs')" />
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
import { ArrowUpRight, Globe2, Activity, Radar, Gauge } from '@lucide/vue';
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
import LatencyMatrix from '@/components/dossier/LatencyMatrix.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import CapabilitySlot from '@/components/widgets/CapabilitySlot.vue';
import CopyButton from '@/components/widgets/CopyButton.vue';
import Button from '@/components/ui/button/Button.vue';
import Input from '@/components/ui/input/Input.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();

const target = ref(route.params.ip || route.query.q || '');
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

const tags = computed(() => {
    const cls = trust.value.cls;
    if (!cls || cls === 'unknown') return [];
    return [{ tone: CLASS_TONE[cls], label: t(`trustip.value.${cls}`) }];
});

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

const threatScore = computed(() => {
    const measured = network.value.rpki && network.value.rpki !== 'unknown' ? 1 : 0;
    return `${measured} / 4`;
});

const deepRows = computed(() => [
    t('dossier.row.vpn'), t('dossier.row.proxy'), t('dossier.row.tor'), t('dossier.row.crawler'),
]);

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
    if (!ip) return;
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
</script>
