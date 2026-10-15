<template>
  <!-- Which Cloudflare edge answered this browser, over which protocol, and what
       that edge's own risk controls can be told about the address it saw.
       Everything here is a trace: a Cloudflare edge echoes the client address, the
       PoP it terminated at, and the TLS/HTTP stack it negotiated, in plain text with
       a wildcard CORS header. Nothing needs a key, and nothing is inferred. -->
  <div class="cf-check-section my-4 space-y-4">
    <p class="text-sm text-muted-foreground leading-relaxed">{{ t('cfchk.Note') }}</p>

    <div class="flex flex-wrap items-center gap-3">
      <Button variant="action" :disabled="running" @click="run">
        <Spinner v-if="running" class="size-4" />
        {{ running ? t('cfchk.Checking') : t('cfchk.Run') }}
      </Button>
      <VerdictChip
        v-if="!running && primary?.colo"
        tone="info"
        :label="t('cfchk.NodeChip', { colo: primary.colo })"
      />
      <span v-else-if="!running" class="text-sm text-muted-foreground">{{ t('cfchk.Idle') }}</span>
    </div>

    <!-- ── The connection this browser actually made ─────────────────── -->
    <div class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('cfchk.DetailTitle', { host: PRIMARY_HOST })">
        <template #aside>
          <VerdictChip
            v-if="primary && primaryState === 'answered'"
            :tone="warpTone"
            :label="warpLabel"
          />
        </template>
      </SectionTitle>

      <dl v-if="primaryState === 'answered'" class="divide-y divide-dashed divide-border">
        <KeyRow :label="t('cfchk.FieldIp')" wide :nums="true">
          <span class="break-all font-mono text-xs font-normal">{{ primary.ip }}</span>
        </KeyRow>
        <KeyRow :label="t('cfchk.FieldNode')" :value="primary.colo || null" :nums="true" />
        <KeyRow :label="t('cfchk.FieldCountry')">
          <span class="flex items-center justify-end gap-1.5 min-w-0">
            <Icon
              v-if="showFlag"
              :icon="`circle-flags:${String(primary.loc).toLowerCase()}`"
              class="size-4 shrink-0"
            />
            <span class="truncate text-xs font-normal">{{ countryText }}</span>
          </span>
        </KeyRow>
        <KeyRow :label="t('cfchk.FieldHttp')" :value="primary.http || null" />
        <KeyRow :label="t('cfchk.FieldTls')" :value="primary.tls || null" />
        <KeyRow :label="t('cfchk.FieldSni')" :value="sniLabel" />
        <KeyRow :label="t('cfchk.FieldKeyex')" :value="primary.kex || null" wide />
        <KeyRow :label="t('cfchk.FieldGateway')" :value="onOff(primary.gateway)" />
        <KeyRow :label="t('cfchk.FieldTime')" :value="traceTime" :nums="true" />
      </dl>
      <p v-else-if="primaryState === 'loading'" class="text-xs text-muted-foreground">{{ t('cfchk.Checking') }}</p>
      <p v-else class="text-xs leading-relaxed text-muted-foreground">{{ t('cfchk.DetailFailed') }}</p>
    </div>

    <!-- ── Every edge, side by side ──────────────────────────────────── -->
    <div class="jn-card rounded-[var(--radius)] p-4">
      <SectionTitle :title="t('cfchk.TableTitle')">
        <template #aside>
          <span class="text-xs text-muted-foreground">{{ answeredCount }}/{{ rows.length }}</span>
        </template>
      </SectionTitle>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b text-start">
              <th class="py-2 pe-3 text-start font-medium text-muted-foreground">{{ t('cfchk.ColSite') }}</th>
              <th class="py-2 pe-3 text-start font-medium text-muted-foreground">{{ t('cfchk.ColGrade') }}</th>
              <th class="py-2 pe-3 text-start font-medium text-muted-foreground">{{ t('cfchk.ColNode') }}</th>
              <th class="py-2 pe-3 text-start font-medium text-muted-foreground">{{ t('cfchk.ColLatency') }}</th>
              <th class="py-2 text-start font-medium text-muted-foreground">{{ t('cfchk.ColProtocol') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.host" class="border-b last:border-0">
              <td class="py-2 pe-3 min-w-0">
                <div class="truncate font-medium">{{ t(row.labelKey) }}</div>
                <div class="truncate text-xs font-normal text-muted-foreground">{{ row.host }}</div>
              </td>
              <td class="py-2 pe-3">
                <VerdictChip
                  v-if="row.state === 'answered'"
                  :tone="probeTone(row.ms)"
                  :label="t('cfchk.Grade', { ms: row.ms })"
                />
                <VerdictChip v-else-if="row.state === 'pending'" tone="info" :label="t('cfchk.Checking')" />
                <span v-else class="text-xs font-normal text-muted-foreground">{{ reasonOf(row.state) }}</span>
              </td>
              <td class="py-2 pe-3 jn-nums">{{ row.colo || '—' }}</td>
              <td class="py-2 pe-3 jn-nums">{{ row.ms == null ? '—' : `${row.ms} ms` }}</td>
              <td class="py-2 text-xs font-normal text-muted-foreground">
                <span class="break-all">{{ [row.http, row.tls].filter(Boolean).join(' · ') || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{{ t('cfchk.TableNote') }}</p>
    </div>

    <!-- ── What this build does not measure, said in the same voice ──── -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <CapabilitySlot
        :title="t('cfchk.RiskTitle')"
        state="partial"
        :missing="[t('cfchk.RiskMissing')]"
      >
        <dl class="divide-y divide-dashed divide-border">
          <KeyRow v-if="trust" :label="t('cfchk.RiskScore')" :nums="true">
            <span class="inline-flex items-center gap-2 justify-end">
              <ScoreMeter :band="trust.band" :score="trust.score" />
              <span class="jn-nums text-sm font-semibold">{{ trust.score }}</span>
              <span class="text-xs font-normal text-muted-foreground">{{ bandLabel }}</span>
            </span>
          </KeyRow>
          <KeyRow v-else :label="t('cfchk.RiskScore')">
            <span class="text-xs font-normal text-muted-foreground">
              {{ trustState === 'loading' ? t('cfchk.Checking') : t('cfchk.RiskUnavailable') }}
            </span>
          </KeyRow>
        </dl>
      </CapabilitySlot>

      <CapabilitySlot
        :title="t('cfchk.TurnstileTitle')"
        state="placeholder"
        :note="t('cfchk.TurnstileNote')"
        :needs="t('cfchk.TurnstileNeeds')"
      />

      <CapabilitySlot
        :title="t('cfchk.WarpTitle')"
        state="placeholder"
        :note="t('cfchk.WarpNote')"
        :needs="t('cfchk.WarpNeeds')"
      />

      <CapabilitySlot
        :title="t('cfchk.MapTitle')"
        state="delegated"
        :note="t('cfchk.MapNote')"
        :to="{ path: '/ipinfo' }"
        :cta="t('cfchk.MapCta')"
      />
    </div>

    <p class="text-xs font-normal text-muted-foreground leading-relaxed">{{ t('cfchk.Caveat') }}</p>

    <TestRunLog :log="testLog" />
  </div>
</template>

<script setup>
// The Cloudflare edge page.
//
// `readTrace` is imported rather than re-implemented: it is the same six-second
// Cloudflare echo the AI-egress page and the homepage's routing table run, so a PoP
// code on this page is the same observation as the one beside it on `/`, and an
// address that failed to echo there fails here for the same named reason.
//
// Deliberately absent: any "risk index" that looks like Cloudflare's own score. The
// edge does not publish one for a visitor's address; what this build can honestly
// attach to that address is its own registry evidence, and that is what the partial
// slot shows. The rest is declared as a gap instead of being guessed at.

import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';

import { readTrace, readTrust } from '@/composables/use-ai-egress.js';
import { probeTone } from '@/utils/latency-probes.js';
import { parseTrace } from '@/utils/parse-trace.js';
import { isValidIP } from '@/utils/valid-ip.js';
import { nonCountryLoc } from '@/utils/ai-service-regions.js';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout.js';
import { CF_DESTINATIONS, CF_PRIMARY_HOST } from '@/data/cf-destinations.js';
import { formatIsoDate } from '@/utils/time-utils.js';
import getCountryName from '@/data/country-name.js';

import Button from '@/components/ui/button/Button.vue';
import Spinner from '@/components/ui/spinner/Spinner.vue';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import KeyRow from '@/components/widgets/KeyRow.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import ScoreMeter from '@/components/widgets/ScoreMeter.vue';
import CapabilitySlot from '@/components/widgets/CapabilitySlot.vue';
import TestRunLog from '@/components/widgets/TestRunLog.vue';
import { useTestLog, summarizeSteps, traceOutcome } from '@/composables/use-test-log.js';

const { t, locale } = useI18n();

// The row the detail panel reads. `www.cloudflare.com` is the one destination here
// that is Cloudflare's own site answering about itself, which is why it carries the
// protocol fields rather than only an echo.
// The destination list (and why each host is on it) lives in data/cf-destinations.js.
const PRIMARY_HOST = CF_PRIMARY_HOST;

const TRACE_TIMEOUT_MS = 6000;
const rows = ref(CF_DESTINATIONS.map((item) => ({ ...item, state: 'pending', ms: null, colo: null, http: null, tls: null })));
const running = ref(false);
const primary = ref(null);
const primaryState = ref('idle');
const trustState = ref('idle');
const trust = ref(null);

const REASONS = {
  noEndpoint: 'aiCheck.reason.noEndpoint',
  timeout: 'aiCheck.reason.timeout',
  blocked: 'aiCheck.reason.blocked',
  pending: 'cfchk.Checking',
};

const reasonOf = (state) => t(REASONS[state] || 'aiCheck.reason.blocked');

// One echo, with the round trip and the protocol fields attached. `readTrace`
// validates the address and owns the four failure states; the remaining fields the
// page shows (`http`, `tls`, `sni`, `warp`, `kex`, `ts`) come from parsing the same
// body again rather than from a second request to the same edge.
const echoOnce = async (host) => {
  const base = await readTrace(host);
  if (base.state !== 'answered') return base;
  const started = performance.now();
  try {
    const res = await fetchWithTimeout(`https://${host}/cdn-cgi/trace`, {
      cache: 'no-store',
      timeoutMs: TRACE_TIMEOUT_MS,
    });
    const fields = res.ok ? parseTrace(await res.text()) : {};
    return {
      ...base,
      ms: Math.round(performance.now() - started),
      http: fields.http || null,
      tls: fields.tls || null,
      sni: fields.sni || null,
      warp: fields.warp || null,
      gateway: fields.gateway || null,
      kex: fields.kex || null,
      ts: fields.ts || null,
    };
  } catch {
    // The address already answered — a lost protocol detail is not a lost row, and
    // calling this `blocked` would throw away the one finding the visitor came for.
    return { ...base };
  }
};

const traceTime = computed(() => {
  const seconds = Number(primary.value?.ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // The edge reports a Unix second; the shared formatter owns how that reads in the
  // visitor's calendar, exactly as it does everywhere else on the site.
  return formatIsoDate(new Date(seconds * 1000).toISOString(), locale.value);
});

// Test-process log: each destination's trace echo (endpoint, round trip, the
// address / country / PoP it named) and the trust lookup of the primary address.
const testLog = useTestLog('cloudflare');

const measure = async () => {
  running.value = true;
  primaryState.value = 'loading';
  trustState.value = 'idle';
  trust.value = null;
  testLog.begin({ destinations: CF_DESTINATIONS.length });
  try {
    const settled = await Promise.allSettled(CF_DESTINATIONS.map((item) => testLog.timed(
      { kind: 'trace', target: item.host, endpoint: `https://${item.host}/cdn-cgi/trace`, protocol: 'HTTPS GET' },
      () => echoOnce(item.host),
      (answer) => {
        const outcome = traceOutcome(answer);
        if (outcome.result === 'ok') outcome.value = [outcome.value, answer.http, answer.tls].filter(Boolean).join(' · ');
        return outcome;
      },
    )));
    const answers = CF_DESTINATIONS.map((item, i) => (
      settled[i].status === 'fulfilled' ? settled[i].value : { state: 'blocked' }
    ));
    rows.value = CF_DESTINATIONS.map((item, i) => ({ ...item, ...answers[i] }));

    const own = answers[CF_DESTINATIONS.findIndex((item) => item.host === PRIMARY_HOST)];
    primary.value = own?.state === 'answered' ? own : null;
    primaryState.value = primary.value ? 'answered' : 'failed';

    if (primary.value && isValidIP(primary.value.ip)) {
      trustState.value = 'loading';
      const score = await testLog.timed(
        { kind: 'trust', target: primary.value.ip, endpoint: `/api/trustscore?ip=${primary.value.ip}`, protocol: 'HTTPS GET' },
        () => readTrust(primary.value.ip),
        (body) => (body ? { result: 'ok', value: `score ${body.score ?? '—'} · band ${body.band ?? '—'}` } : { result: 'fail', error: 'no score' }),
      );
      trust.value = score;
      trustState.value = score ? 'ready' : 'failed';
    }
  } finally {
    running.value = false;
    // Verdict on the echoes alone; distinct PoPs are named so a split edge shows.
    const colos = [...new Set(rows.value.filter((row) => row.state === 'answered').map((row) => row.colo).filter(Boolean))];
    const verdict = summarizeSteps(testLog.record.value?.steps || [], { kinds: ['trace'] });
    testLog.setMeta({ colos: colos.join(', ') || '—' });
    testLog.finish(verdict);
  }
};

const run = async () => {
  if (running.value) return;
  await measure();
};

onMounted(run);

// ── Labels ───────────────────────────────────────────────────────────────────

const answeredCount = computed(() => rows.value.filter((row) => row.state === 'answered').length);

const showFlag = computed(() => {
  const code = String(primary.value?.loc || '');
  return /^[A-Z]{2}$/.test(code) && !nonCountryLoc(code);
});

const countryText = computed(() => {
  const code = primary.value?.loc;
  if (!code) return '—';
  if (nonCountryLoc(code)) return t(`aiCheck.locNote.${nonCountryLoc(code)}`);
  return getCountryName(code, locale.value) || code;
});

// `warp=` is the edge telling you whether it saw a WARP tunnel: `on` and `off` are
// facts about this connection, `maybe` is the edge declining to say, and an absent
// field is a destination that answered something other than a trace.
const warpTone = computed(() => ({
  on: 'ok',
  off: 'muted',
}[primary.value?.warp] || 'info'));

const warpLabel = computed(() => t(`cfchk.warp.${primary.value?.warp || 'other'}`));

const onOff = (value) => (value ? t(`cfchk.state.${value === 'on' ? 'on' : 'off'}`) : null);

const sniLabel = computed(() => {
  const sni = primary.value?.sni;
  if (!sni) return null;
  return sni === 'encrypted' ? t('cfchk.sni.encrypted') : t('cfchk.sni.plaintext');
});

const bandLabel = computed(() => (trust.value?.band == null ? '' : t(`trustip.band.${trust.value.band}`)));
</script>
