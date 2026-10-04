<template>
    <div class="min-h-screen">
        <!-- The rail rides in the header so the dossier is reachable from every
             page and every page is reachable from this one — the flat tool row
             is the shape the whole redesign is aligned to. -->
        <StandalonePageHeader :rail="true" :title="t('dossier.title')" />

        <main class="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-6">
            <h1 class="mb-1 text-2xl font-semibold tracking-tight md:text-3xl">
                🔍 {{ t('dossier.title') }}
            </h1>
            <p class="mb-4 text-sm text-muted-foreground md:text-base">{{ t('dossier.subtitle') }}</p>

            <!-- The query belongs to the page, not to a floating button: this
                 is a lookup tool, and the address being asked about should be
                 the second thing you see. -->
            <div class="mb-6 flex gap-2">
                <Input
                    v-model="draft"
                    :placeholder="t('dossier.placeholder')"
                    class="font-mono"
                    autocomplete="off" autocorrect="off" autocapitalize="off"
                    spellcheck="false" data-1p-ignore data-lpignore="true"
                    @keyup.enter="lookup" />
                <Button variant="action" :disabled="!looksLikeIp || busy" @click="lookup">
                    {{ t('dossier.go') }}
                </Button>
            </div>

            <div v-if="!target" class="jn-card rounded-[var(--radius)] p-6 text-sm text-muted-foreground">
                {{ t('dossier.hint') }}
            </div>

            <div v-else-if="error" class="rounded-lg border border-destructive-soft bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-fg">
                {{ error }}
                <Button variant="ghost" size="sm" class="ms-2" @click="load(target)">{{ t('dossier.retry') }}</Button>
            </div>

            <!-- Loading sits between "has an address" and "has an answer":
                 without this branch the content below renders while `dossier`
                 is still null, and Vue swallows the throw as a blank card
                 rather than telling anyone the page broke. -->
            <div v-else-if="!dossier" class="space-y-4">
                <div class="jn-card rounded-[var(--radius)] p-4">
                    <div class="jn-skeleton mb-3 h-4 w-40"></div>
                    <div class="space-y-2">
                        <div v-for="n in 5" :key="n" class="jn-skeleton h-4 w-full"></div>
                    </div>
                </div>
                <div class="grid gap-4 md:grid-cols-2">
                    <div v-for="n in 2" :key="n" class="jn-card rounded-[var(--radius)] p-4">
                        <div class="jn-skeleton mb-3 h-4 w-32"></div>
                        <div v-for="m in 4" :key="m" class="jn-skeleton mb-2 h-4 w-full"></div>
                    </div>
                </div>
            </div>

            <template v-else>
                <!-- 1 — hero: the address, its verdict, and the evidence that
                     produced it. -->
                <TrustScorePanel class="mb-4" :ip="target" :geo="heroGeo" />

                <!-- 2 — usage/type beside ASN/provider: the two questions every
                     lookup starts with. -->
                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.usage.title')" />
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.usage.class')" :nums="false">
                                <VerdictChip :tone="classTone" :label="t(`trustip.value.${network.cls || 'unknown'}`)" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.usage.anycast')">
                                <VerdictChip
                                    :tone="trust.anycast ? 'info' : 'ok'"
                                    :label="trust.anycast ? t('dossier.usage.anycastYes') : t('dossier.usage.anycastNo')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.usage.provider')" :value="network.asOrg || network.asName" wide />
                            <KeyRow :label="t('dossier.usage.allocation')" wide :nums="false">
                                <span class="font-mono text-xs">{{ network.cidr || '—' }}</span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.usage.rirStatus')" :value="network.status || network.netType" />
                            <KeyRow :label="t('dossier.usage.humanBot')">
                                <VerdictChip tone="muted" :label="t('dossier.slot.badge.placeholder')" />
                            </KeyRow>
                        </dl>
                    </div>

                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.asn.title')" />
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.asn.asn')" :nums="false">
                                <span v-if="network.asn" class="font-mono font-semibold">AS{{ network.asn }}</span>
                                <span v-else>—</span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.asn.org')" :value="network.asName || network.asOrg" wide />
                            <KeyRow :label="t('dossier.asn.country')">
                                <template v-if="network.country">
                                    <Icon :icon="'circle-flags:' + network.country.toLowerCase()" class="me-1 inline size-4 align-[-3px]" />
                                    {{ network.country }}
                                </template>
                                <span v-else>—</span>
                            </KeyRow>
                            <KeyRow :label="t('dossier.asn.registered')" :value="allocationDate" />
                            <KeyRow :label="t('dossier.asn.customers')" :nums="true">
                                {{ topology ? formatCount(topology.origin.customers) : '—' }}
                            </KeyRow>
                            <KeyRow :label="t('dossier.asn.tier1')">
                                <VerdictChip
                                    :tone="topology?.origin?.tier1 ? 'info' : 'muted'"
                                    :label="topology?.origin?.tier1 ? t('dossier.asn.tier1Yes') : t('dossier.asn.tier1No')" />
                            </KeyRow>
                        </dl>
                    </div>
                </div>

                <!-- 3 — three dense columns: what the address is technically,
                     what threatens it, and what we cannot see. -->
                <div class="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.technical.title')" />
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.technical.public')">
                                <VerdictChip tone="ok" :label="t('dossier.technical.publicYes')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.technical.rdns')" :value="network.rdns" wide />
                            <KeyRow :label="t('dossier.technical.ports')">
                                <VerdictChip tone="muted" :label="t('dossier.slot.badge.placeholder')" />
                            </KeyRow>
                            <KeyRow :label="t('dossier.technical.prefix')" :nums="true">
                                {{ network.announce ? `${network.announce.v4Count} · ${Math.round((network.announce.smallShare || 0) * 100)}% ≤/24` : '—' }}
                            </KeyRow>
                        </dl>
                    </div>

                    <CapabilitySlot
                        state="partial"
                        :title="t('dossier.threat.title')"
                        :missing="[t('dossier.threat.abuse'), t('dossier.threat.honeypot')]"
                        :needs="t('dossier.threat.needs')">
                        <dl class="divide-y divide-dashed divide-border">
                            <KeyRow :label="t('dossier.threat.rpki')">
                                <VerdictChip :tone="rpkiTone" :label="rpkiLabel" />
                            </KeyRow>
                        </dl>
                    </CapabilitySlot>

                    <CapabilitySlot
                        state="placeholder"
                        :title="t('dossier.deep.title')"
                        :note="t('dossier.deep.note')"
                        :needs="t('dossier.deep.needs')" />
                </div>

                <!-- 4 — latency and heat: one delegated to the page that owns
                     the capability, one genuinely absent. -->
                <div class="mb-4">
                    <CapabilitySlot
                        state="delegated"
                        :title="t('dossier.latency.title')"
                        :note="t('dossier.latency.note')"
                        :to="{ path: '/ping', query: { q: target } }"
                        :cta="t('dossier.latency.cta')" />
                </div>

                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <CapabilitySlot
                        state="placeholder"
                        :title="t('dossier.heat.title')"
                        :note="t('dossier.heat.note')"
                        :needs="t('dossier.heat.needs')" />
                    <div class="jn-card rounded-[var(--radius)] p-4">
                        <SectionTitle :title="t('dossier.map.title')" />
                        <p v-if="!hasCoords" class="text-sm text-muted-foreground">{{ t('dossier.map.none') }}</p>
                        <div v-else class="space-y-2">
                            <a
                                :href="`https://www.google.com/maps?q=${primarySource.lat},${primarySource.lon}`"
                                target="_blank" rel="nofollow noopener"
                                class="jn-nums block font-mono text-sm font-semibold text-success-soft-fg no-underline hover:underline">
                                {{ primarySource.lat.toFixed(3) }}, {{ primarySource.lon.toFixed(3) }}
                            </a>
                            <p class="text-xs text-muted-foreground">
                                {{ t('dossier.map.from', { source: primarySource.label }) }}
                            </p>
                        </div>
                    </div>
                </div>

                <!-- 5 — the multi-source comparison, our strongest section. -->
                <div class="mb-4">
                    <GeoSources :geo="dossier.geo" />
                </div>

                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <CapabilitySlot
                        state="placeholder"
                        :title="t('dossier.related.title')"
                        :note="t('dossier.related.note')"
                        :needs="t('dossier.related.needs')" />
                    <CapabilitySlot
                        state="placeholder"
                        :title="t('dossier.history.title')"
                        :note="t('dossier.history.note')"
                        :needs="t('dossier.history.needs')" />
                </div>

                <div class="mb-4">
                    <BgpTopology :topology="dossier.topology" />
                </div>

                <div class="mb-4 grid gap-4 md:grid-cols-2">
                    <CapabilitySlot
                        state="placeholder"
                        :title="t('dossier.blocklists.title')"
                        :note="t('dossier.blocklists.note')"
                        :needs="t('dossier.blocklists.needs')" />
                    <CapabilitySlot
                        state="placeholder"
                        :title="t('dossier.colocated.title')"
                        :note="t('dossier.colocated.note')"
                        :needs="t('dossier.colocated.needs')" />
                </div>

                <!-- 6 — cross-checks. Every link is a third-party view of the
                     same public facts, so a visitor can disagree with us. -->
                <div class="jn-card rounded-[var(--radius)] p-4">
                    <SectionTitle :title="t('dossier.cross.title')" />
                    <div class="flex flex-wrap gap-2">
                        <a
                            v-for="link in crossChecks"
                            :key="link.label"
                            :href="link.url"
                            target="_blank" rel="nofollow noopener"
                            class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-foreground-secondary no-underline transition-colors hover:bg-accent">
                            {{ link.label }}
                            <ArrowUpRight class="size-3" />
                        </a>
                    </div>
                </div>
            </template>
        </main>

        <Footer />
    </div>
</template>

<script setup>
// The IP dossier: one address, everything this build can establish about it,
// laid out in the order a lookup actually reads — identity, then network, then
// technical facts, then the things we cannot see, then cross-checks.
//
// Sections with no backing data are rendered as declared gaps rather than
// omitted. A page that silently lacks a section teaches the visitor nothing;
// a page that says "not measured, and here is what it would take" is honest
// and gives the next contributor a contract to fill.

import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { ArrowUpRight } from '@lucide/vue';
import { isValidIP } from '@/utils/valid-ip.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import StandalonePageHeader from '@/components/StandalonePageHeader.vue';
import Footer from '@/components/Footer.vue';
import TrustScorePanel from '@/components/ip-infos/TrustScorePanel.vue';
import GeoSources from '@/components/ip-infos/GeoSources.vue';
import BgpTopology from '@/components/ip-infos/BgpTopology.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import CapabilitySlot from '@/components/widgets/CapabilitySlot.vue';
import Button from '@/components/ui/button/Button.vue';
import Input from '@/components/ui/input/Input.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();

// RIRs disagree on the shape of a registration date — ARIN answers `1999-03-02`,
// RIPE `2020-06-24T14:02:28Z`. Both are dates to the visitor, and neither is
// shown as the registry's raw string.
const allocationDate = computed(() => {
    const raw = network.value.regDate;
    if (!raw) return '';
    const match = /^\d{4}-\d{2}-\d{2}/.exec(raw);
    return match ? formatIsoDate(match[0], locale.value) : raw;
});

const target = ref(route.params.ip || route.query.q || '');
const draft = ref(target.value);
const dossier = ref(null);
const error = ref('');
const busy = ref(false);

const looksLikeIp = computed(() => isValidIP((draft.value || '').trim()));

const network = computed(() => dossier.value?.network || {});
const trust = computed(() => dossier.value?.trust || {});
const topology = computed(() => dossier.value?.topology || null);

const sources = computed(() => dossier.value?.geo?.sources || []);
const primarySource = computed(() => sources.value.find((s) => s.lat != null && s.lon != null) || sources.value[0] || null);
const hasCoords = computed(() => primarySource.value?.lat != null && primarySource.value?.lon != null);

const heroGeo = computed(() => {
    const c = dossier.value?.geo?.consensus || {};
    const primary = primarySource.value || {};
    return {
        country_code: c.country_code || primary.country_code || '',
        country_name: c.country || primary.country || '',
        region: primary.region || '',
        city: c.city || primary.city || '',
        isp: network.value.asOrg || network.value.asName || '',
        org: network.value.asOrg || '',
        asn: network.value.asn || '',
    };
});

const CLASS_TONE = { datacenter: 'bad', isp: 'ok', mobile: 'ok', education: 'info', government: 'info', anycast: 'info', unknown: 'muted' };
const classTone = computed(() => CLASS_TONE[trust.value.cls] || 'muted');

const RPKI_TONE = { valid: 'ok', invalid: 'bad', invalid_asn: 'bad', invalid_length: 'warn', 'not-found': 'warn' };
const rpkiTone = computed(() => RPKI_TONE[network.value.rpki] || 'muted');
const rpkiLabel = computed(() => {
    const r = network.value.rpki;
    return r ? t(`trustip.value.${r}`) : t('trustip.verdict.notMeasured');
});

const crossChecks = computed(() => {
    const ip = target.value;
    const asn = network.value.asn;
    return [
        { label: 'bgp.tools', url: asn ? `https://bgp.tools/as/${asn}` : 'https://bgp.tools' },
        { label: 'RIPEstat', url: `https://stat.ripe.net/${encodeURIComponent(ip)}` },
        { label: 'Cloudflare Radar', url: asn ? `https://radar.cloudflare.com/as/${asn}` : 'https://radar.cloudflare.com' },
        { label: 'Hurricane Electric', url: `https://bgp.he.net/ip/${encodeURIComponent(ip)}` },
        { label: 'Shodan', url: `https://www.shodan.io/host/${encodeURIComponent(ip)}` },
    ];
});

const formatCount = (n) => (typeof n === 'number' ? new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n) : '—');

async function load(ip) {
    if (!ip) return;
    busy.value = true;
    error.value = '';
    try {
        const res = await fetchWithTimeout(`/api/dossier?ip=${encodeURIComponent(ip)}`, { timeoutMs: 25000 });
        if (!res.ok) throw new Error(`dossier ${res.status}`);
        dossier.value = await res.json();
    } catch (err) {
        console.warn('dossier unavailable', err);
        error.value = t('dossier.failed');
    } finally {
        busy.value = false;
    }
}

function lookup() {
    const ip = (draft.value || '').trim();
    if (!isValidIP(ip)) return;
    router.push(`/ip/${encodeURIComponent(ip)}`);
}

// The address lives in the URL, so a dossier view is linkable and a back
// gesture lands where the visitor expects. `/ip` with no parameter asks about
// the visitor's own address, which the trust panel resolves on its own; a
// parameter is taken verbatim and re-loads the whole dossier.
//
// One watcher, not two: an earlier draft watched the params and the
// params-plus-query pair, and every navigation fetched the dossier twice.
watch(
  () => [route.params.ip, route.query.q],
  ([param, query]) => {
    const next = param || query || '';
    if (!next || next === target.value) return;
    target.value = next;
    draft.value = next;
    load(next);
  },
);

onMounted(() => { if (target.value) load(target.value); });
</script>
