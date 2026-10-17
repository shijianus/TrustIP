<template>
  <!-- AI-egress check: which address each AI service sees this browser coming
       from, and whether that exit is in a region the service says it serves.
       An advanced tool, so the drawer / standalone page renders the title and
       this template starts at the note row. -->
  <div class="ai-check-section my-4 space-y-4">
    <p class="text-sm text-muted-foreground leading-relaxed">{{ t('aiCheck.Note') }}</p>

    <!-- Trigger + the one-line verdict. The verdict is only ever stated when the
         control answered; four uncomparable addresses say nothing about a tunnel. -->
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="action" :disabled="running" @click="run">
        <Spinner v-if="running" class="size-4" />
        {{ running ? t('aiCheck.Checking') : t('aiCheck.Run') }}
      </Button>
      <VerdictChip
        v-if="!running && controlIp"
        :tone="splitSeen ? 'warn' : 'ok'"
        :label="splitSeen ? t('aiCheck.SplitYes') : t('aiCheck.SplitNo')"
      />
      <span v-else-if="!running" class="text-sm text-muted-foreground">{{ t('aiCheck.SplitUnknown') }}</span>
    </div>

    <!-- What was measured, in the visitor's own numbers. Kept separate from the
         cards because it is about the method, not about any one service. -->
    <div class="rounded-lg border border-dashed bg-muted/30 px-4 py-3">
      <dl class="divide-y divide-dashed divide-border">
        <KeyRow :label="t('aiCheck.Control')" :value="controlIp || '—'" :wide="true" :nums="true" />
        <KeyRow :label="t('aiCheck.Ruler')">
          <span class="text-xs font-normal text-muted-foreground leading-relaxed">{{ t('aiCheck.RulerNote') }}</span>
        </KeyRow>
      </dl>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card v-for="row in rows" :key="row.id" class="jn-card">
        <CardContent class="p-4 min-w-0 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-base font-medium truncate min-w-0 flex-1">{{ row.name }}</span>
            <span class="text-xs font-normal text-muted-foreground truncate min-w-0">{{ row.host }}</span>
          </div>

          <!-- Control row is a measurement, not a service: no availability verdict
               and no split chip of its own. -->
          <p v-if="isControl(row)" class="text-xs font-normal text-muted-foreground leading-relaxed">
            {{ t('aiCheck.RulerNote') }}
          </p>

          <!-- The exit, or the reason there is no exit to report. -->
          <dl v-if="row.state === EGRESS_STATE.answered" class="divide-y divide-dashed divide-border">
            <KeyRow :label="t('aiCheck.Egress')" wide :nums="true">
              <span class="break-all font-mono text-xs font-normal">{{ row.ip }}</span>
            </KeyRow>
            <KeyRow :label="t('aiCheck.Country')">
              <span class="flex items-center justify-end gap-1.5 min-w-0">
                <Icon
                  v-if="showFlag(row)"
                  :icon="`circle-flags:${String(row.loc).toLowerCase()}`"
                  class="size-4 shrink-0"
                />
                <span class="truncate text-xs font-normal">{{ countryText(row) }}</span>
              </span>
            </KeyRow>
            <KeyRow v-if="!isControl(row)" :label="t('aiCheck.Regions')">
              <VerdictChip :tone="verdictTone(row)" :label="verdictLabel(row)" />
            </KeyRow>
            <KeyRow :label="t('aiCheck.RoundTrip')" :nums="true">
              {{ row.ms == null ? '—' : `${row.ms} ms` }}
              <span v-if="row.colo" class="font-normal text-muted-foreground"> · {{ row.colo }}</span>
            </KeyRow>
            <KeyRow v-if="!isControl(row)" :label="t('aiCheck.Split')">
              <VerdictChip
                v-if="row.split !== null"
                :tone="row.split ? 'warn' : 'ok'"
                :label="row.split ? t('aiCheck.SplitYes') : t('aiCheck.SplitNo')"
              />
              <span v-else class="text-xs font-normal text-muted-foreground">{{ t('aiCheck.SplitUnknown') }}</span>
            </KeyRow>
          </dl>

          <!-- No address, no verdict: the four ways this row can fail name the
               failure, because "unavailable" alone would not tell a visitor
               whether the site has no trace endpoint or their network killed it. -->
          <div v-else class="space-y-1.5">
            <!-- A run that ended without an address is stated as unmeasurable,
                 so it never reads as "still checking" or as a pass. -->
            <VerdictChip
              v-if="row.state !== EGRESS_STATE.pending"
              tone="muted"
              :label="t('aiCheck.Unmeasurable')"
            />
            <p class="text-xs font-normal text-muted-foreground leading-relaxed">
              {{ reasonText(row) }}
            </p>
          </div>

          <!-- The trust score for this exit. `—` while loading, and a stated
               failure: an absent score is a missing measurement, never a zero. -->
          <dl v-if="!isControl(row) && row.state === EGRESS_STATE.answered" class="divide-y divide-dashed divide-border">
            <KeyRow :label="t('aiCheck.Trust')">
              <span v-if="row.trustState === TRUST_STATE.loading" class="jn-nums text-xs font-normal">—</span>
              <span v-else-if="row.trustState === TRUST_STATE.failed" class="text-xs font-normal text-muted-foreground">
                {{ t('aiCheck.TrustFailed') }}
              </span>
              <span v-else-if="row.trust?.score != null" class="flex items-center justify-end gap-1.5 min-w-0">
                <span class="jn-nums text-sm font-semibold">{{ row.trust.score }}</span>
                <span class="truncate text-xs font-normal text-muted-foreground">
                  {{ bandLabel(row.trust.band) }}<template v-if="classLabel(row.trust.cls)"> · {{ classLabel(row.trust.cls) }}</template>
                </span>
              </span>
              <span v-else class="jn-nums text-xs font-normal">—</span>
            </KeyRow>
          </dl>

          <!-- Where the availability answer comes from, and how old it is. -->
          <p v-if="!isControl(row) && row.regions?.source" class="text-xs font-normal text-muted-foreground">
            <a
              :href="row.regions.source"
              target="_blank"
              rel="noopener noreferrer"
              class="underline underline-offset-2"
            >{{ t('aiCheck.Source') }}</a>
            <template v-if="row.regions.asOf"> · {{ formatIsoDate(row.regions.asOf, locale) }}</template>
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- The limit of the whole page, stated once rather than buried in six
         tooltips: an availability list is a vendor's policy about accounts, and
         every one of them also refuses traffic from datacenter addresses in a
         country it serves. -->
    <p class="text-xs font-normal text-muted-foreground leading-relaxed">{{ t('aiCheck.Caveat') }}</p>

    <TestRunLog :log="testLog" />
  </div>
</template>

<script setup>
// AI-egress tool. The measurement, its failure states and the comparison against
// the control all live in `composables/use-ai-egress.js`; this file only renders
// what that decided, and formats the labels.
//
// Nothing here explains *why* an exit was refused — the page has no evidence about
// that, and inventing an explanation is the failure this section's copy exists to
// prevent.

import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';

import { EGRESS_STATE, TRUST_STATE, useAiEgress } from '@/composables/use-ai-egress.js';
import { EGRESS_CONTROL, REGION_VERDICT } from '@/utils/ai-service-regions.js';
import getCountryName from '@/data/country-name.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import { useMainStore } from '@/store.js';
import Button from '@/components/ui/button/Button.vue';
import { Card, CardContent } from '@/components/ui/card';
import Spinner from '@/components/ui/spinner/Spinner.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import TestRunLog from '@/components/widgets/TestRunLog.vue';
import { useTestLog } from '@/composables/use-test-log.js';

const { t } = useI18n();
const store = useMainStore();
// The run's test-process log: every echo and trust lookup, then the verdict.
const testLog = useTestLog('aicheck');
const { rows, running, controlIp, splitSeen, run } = useAiEgress({ log: testLog });

const locale = computed(() => store.lang || 'en');

onMounted(run);

const isControl = (row) => row.host === EGRESS_CONTROL.host;

// A flag only for a code that names a country. `A1` / `XX` are geo annotations on
// the address, and drawing a flag for one would invent a place.
const showFlag = (row) => Boolean(row.loc) && !row.locNote && /^[A-Z]{2}$/.test(row.loc);

const countryText = (row) => {
  if (!row.loc) return '—';
  if (row.locNote) return t(`aiCheck.locNote.${row.locNote}`);
  return getCountryName(row.loc, locale.value) || row.loc;
};

const VERDICT_TONES = {
  [REGION_VERDICT.supported]: 'ok',
  [REGION_VERDICT.unsupported]: 'bad',
  [REGION_VERDICT.unknown]: 'muted',
};

const verdictTone = (row) => VERDICT_TONES[row.verdict] || 'muted';

const verdictLabel = (row) => {
  // Two different reasons for the same quiet answer, kept apart because they lead
  // a visitor to different actions: this service publishes no list we could read,
  // versus this address names no country to look up in one.
  if (row.locNote) return t('aiCheck.RegionNoCountry');
  if (row.verdict === REGION_VERDICT.unknown) return t('aiCheck.RegionNoList');
  if (row.verdict === REGION_VERDICT.supported) return t('aiCheck.RegionSupported');
  return t('aiCheck.RegionUnsupported');
};

const REASONS = {
  [EGRESS_STATE.noEndpoint]: 'aiCheck.reason.noEndpoint',
  [EGRESS_STATE.timeout]: 'aiCheck.reason.timeout',
  [EGRESS_STATE.blocked]: 'aiCheck.reason.blocked',
  [EGRESS_STATE.pending]: 'aiCheck.Checking',
};

const reasonText = (row) => t(REASONS[row.state] || 'aiCheck.reason.blocked');

const bandLabel = (band) => (band == null ? '' : t(`trustip.band.${band}`));
const classLabel = (cls) => (cls ? t(`trustip.value.${cls}`) : '');
</script>
