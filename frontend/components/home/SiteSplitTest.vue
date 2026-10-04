<template>
    <section class="mb-6">
        <header class="mb-3">
            <h2 class="text-xl font-bold tracking-tight md:text-2xl">{{ t('home.split.title') }}</h2>
            <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{{ t('home.split.desc') }}</p>
        </header>

        <div class="jn-card overflow-hidden rounded-[10px]">
            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2.5">
                <div class="flex items-center gap-3 text-xs text-muted-foreground">
                    <span class="jn-nums">{{ answered }} / {{ rows.length }}</span>
                    <span v-if="distinct.length > 1" class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-soft-fg">
                        {{ t('home.split.split', { n: distinct.length }) }}
                    </span>
                    <span v-else-if="answered" class="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success-soft-fg">
                        {{ t('home.split.single') }}
                    </span>
                </div>
                <Button variant="outline" size="sm" :disabled="running" @click="$emit('run')">
                    <Spinner v-if="running" class="me-1.5" />
                    <RefreshCw v-else class="me-1.5 size-3.5" />
                    {{ t('home.split.rerun') }}
                </Button>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full table-fixed border-collapse text-sm">
                    <thead>
                        <tr class="border-b text-left text-xs text-muted-foreground">
                            <th class="w-[38%] px-4 py-2.5 font-medium">{{ t('home.split.colSite') }}</th>
                            <th class="w-9 px-1 py-2.5" aria-hidden="true"></th>
                            <th class="w-[22%] px-3 py-2.5 font-medium">{{ t('home.split.colIp') }}</th>
                            <th class="px-4 py-2.5 font-medium">{{ t('home.split.colGeo') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :key="row.host" class="border-b border-dashed last:border-b-0">
                            <td class="px-4 py-2.5">
                                <div class="flex min-w-0 items-center gap-2">
                                    <Monogram :text="row.name" :seed="row.host" :size="22" />
                                    <span class="truncate font-medium">{{ row.name }}</span>
                                    <span
                                        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                        :class="row.region === 'domestic' ? REGION_CLASS.domestic : REGION_CLASS.international">
                                        {{ row.region === 'domestic' ? t('home.split.domestic') : t('home.split.international') }}
                                    </span>
                                    <span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                        {{ row.group }}
                                    </span>
                                </div>
                            </td>
                            <td class="px-1 py-2.5 text-center">
                                <Icon
                                    v-if="geoOf(row)?.country_code"
                                    :icon="'circle-flags:' + geoOf(row).country_code.toLowerCase()"
                                    class="inline-block h-3.5 w-5 rounded-[2px] object-contain align-middle" />
                            </td>
                            <td class="px-3 py-2.5">
                                <RouterLink
                                    v-if="row.ip"
                                    :to="`/ip/${row.ip}`"
                                    data-mask="ip"
                                    class="jn-nums truncate font-mono text-[13px] text-foreground no-underline hover:underline"
                                    :title="row.host">{{ row.ip }}</RouterLink>
                                <span v-else-if="row.state === 'pending'" class="jn-queued text-[13px] text-muted-foreground">
                                    {{ t('home.split.waiting') }}
                                </span>
                                <span v-else class="text-[13px] text-muted-foreground">{{ t('home.split.unknown') }}</span>
                            </td>
                            <td class="px-4 py-2.5">
                                <span class="block truncate text-[13px] text-muted-foreground" :title="geoLine(row)">
                                    {{ geoLine(row) || (row.state === 'pending' ? '…' : t('home.split.unknown')) }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </section>
</template>

<script setup>
// The routing table: one row per destination, showing the address that
// destination actually saw.
//
// `table-fixed` with percentage columns is what makes this a table rather than
// a list of cards — the four columns line up down the whole page, so a scan
// down the IP column is a scan down "which exit did this use", which is the
// only question worth asking forty-four times.

import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { RefreshCw } from '@lucide/vue';
import Button from '@/components/ui/button/Button.vue';
import { Spinner } from '@/components/ui/spinner';
import Monogram from '@/components/widgets/Monogram.vue';

const props = defineProps({
    rows: { type: Array, required: true },
    geolocations: { type: Object, default: () => ({}) },
    running: { type: Boolean, default: false },
});

defineEmits(['run']);

const { t } = useI18n();

const REGION_CLASS = {
    domestic: 'bg-info-soft text-info-soft-fg',
    international: 'bg-action-soft text-action-soft-fg',
};

const geoOf = (row) => (row.ip ? props.geolocations[row.ip] : null);

const geoLine = (row) => {
    const g = geoOf(row);
    if (!g) return null;
    // `country_name` and `org` are the geo handler's canonical field names —
    // ipinfo itself answers `country` with a code and `org` with "AS15169
    // Google LLC", both of which the handler has already unpacked.
    return [g.city, g.region, g.country_name, g.org].filter(Boolean).join(' ');
};

const answered = computed(() => props.rows.filter((r) => r.state === 'ok').length);
// The number that matters is how many distinct exits appeared. One means the
// network routes everything the same way; more means it splits by destination,
// which is the whole reason this table exists.
const distinct = computed(() => [...new Set(props.rows.filter((r) => r.ip).map((r) => r.ip))]);
</script>
