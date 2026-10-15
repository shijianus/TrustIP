<template>
  <!-- The full test process, under a test's own result UI: verdict and why, then
       every step with its endpoint / protocol / duration / answer, then the raw
       record. Rendered from a `useTestLog()` handle; renders nothing until a run
       has begun, so a page that never ran a test carries no empty box. -->
  <div v-if="rec" class="mt-4 jn-card rounded-[var(--radius)] p-4 min-w-0" :data-testlog="rec.test"
    :data-testlog-verdict="rec.verdict?.verdict || 'running'">
    <SectionTitle :title="title || t('testlog.Title')">
      <template #aside>
        <VerdictChip v-if="rec.verdict" :tone="verdictTone(rec.verdict.verdict)"
          :label="t(`testlog.verdict.${verdictKey(rec.verdict.verdict)}`)" />
        <span v-else class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner class="size-3" />{{ t('testlog.Running') }}
        </span>
      </template>
    </SectionTitle>

    <!-- Verdict in words: what was concluded, and why. -->
    <p v-if="rec.verdict" class="text-sm leading-relaxed" data-testlog-summary>
      {{ t(`testlog.reason.${rec.verdict.reason}`, rec.verdict.params || {}) }}
    </p>

    <dl class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <div class="flex gap-1"><dt>{{ t('testlog.StartedAt') }}:</dt><dd class="font-mono">{{ startedLabel }}</dd></div>
      <div v-if="rec.durationMs != null" class="flex gap-1"><dt>{{ t('testlog.Duration') }}:</dt><dd class="font-mono tabular-nums">{{ rec.durationMs }} ms</dd></div>
      <div class="flex gap-1"><dt>{{ t('testlog.Steps') }}:</dt><dd class="font-mono tabular-nums">{{ rec.steps.length }}<template v-if="rec.truncated"> (+{{ rec.truncated }})</template></dd></div>
      <div v-for="(value, key) in rec.meta" :key="key" class="flex gap-1 min-w-0">
        <dt>{{ metaLabel(key) }}:</dt><dd class="font-mono break-all">{{ metaValue(value) }}</dd>
      </div>
    </dl>

    <!-- Export row -->
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" class="cursor-pointer" :aria-expanded="open" data-testlog-toggle
        @click="open = !open">
        <ListTree />
        {{ open ? t('testlog.HideSteps') : t('testlog.ShowSteps', { n: rec.steps.length }) }}
        <ChevronDown class="transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
      </Button>
      <Button variant="outline" size="sm" class="cursor-pointer" data-testlog-export="json" @click="download('json')">
        <FileJson />JSON
      </Button>
      <Button variant="outline" size="sm" class="cursor-pointer" data-testlog-export="text" @click="download('text')">
        <FileText />TXT
      </Button>
      <span class="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <CopyButton :value="jsonText" :tooltip="t('testlog.CopyJson')" :aria-label="t('testlog.CopyJson')" />
        <CopyButton :value="plainText" :tooltip="t('testlog.CopyText')" :aria-label="t('testlog.CopyText')" />
      </span>
    </div>

    <!-- Steps: a bordered list rather than a table so a 390px screen reads every
         field without a horizontal scroll. -->
    <ol v-if="open" class="mt-3 rounded-md border divide-y text-sm" data-testlog-steps>
      <li v-for="step in rec.steps" :key="step.seq" class="p-2.5 min-w-0">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-mono text-xs text-muted-foreground tabular-nums">#{{ step.seq }}</span>
          <span class="font-mono text-xs text-muted-foreground tabular-nums">+{{ step.at ?? '?' }}ms</span>
          <span class="font-medium">{{ kindLabel(step.kind) }}</span>
          <span v-if="step.target" class="font-mono text-xs break-all">{{ step.target }}</span>
          <span class="ms-auto inline-flex items-center gap-2">
            <span v-if="step.durationMs != null" class="font-mono text-xs tabular-nums text-muted-foreground">{{ step.durationMs }} ms</span>
            <VerdictChip :tone="stepTone(step.result)" :label="t(`testlog.result.${step.result}`)" />
          </span>
        </div>
        <div v-if="step.endpoint || step.protocol" class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span v-if="step.protocol" class="font-mono">{{ step.protocol }}</span>
          <span v-if="step.endpoint" class="font-mono break-all">{{ step.endpoint }}</span>
        </div>
        <p v-if="step.value" class="mt-1 font-mono text-xs break-all">→ {{ step.value }}</p>
        <p v-if="step.error" class="mt-1 font-mono text-xs break-all text-destructive">✗ {{ step.error }}</p>
        <p v-if="step.note" class="mt-1 text-xs text-muted-foreground">{{ step.note }}</p>
      </li>
      <li v-if="!rec.steps.length" class="p-2.5 text-xs text-muted-foreground">{{ t('testlog.NoSteps') }}</li>
    </ol>

    <!-- The record as exported, verbatim. -->
    <Collapsible v-if="open" v-model:open="rawOpen" class="mt-3 flex flex-col">
      <CollapsibleTrigger as-child>
        <Button variant="ghost" size="sm" class="self-start text-xs text-muted-foreground cursor-pointer"
          :aria-expanded="rawOpen" data-testlog-raw-toggle>
          <Braces />{{ t('testlog.RawJson') }}
          <ChevronDown class="transition-transform duration-200" :class="rawOpen ? 'rotate-180' : ''" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre class="mt-2 p-3 rounded-md bg-muted/50 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all max-h-96 overflow-auto"
          data-testlog-raw>{{ jsonText() }}</pre>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>

<script setup>
// Renders one `useTestLog()` record (composables/use-test-log.js) beneath a test's
// result UI: the verdict and its plain-language reason, every timestamped step,
// the raw JSON, and copy / download in JSON and text. Built only from existing
// primitives (Button, Collapsible, Spinner) and widgets (SectionTitle,
// VerdictChip, CopyButton) so it inherits the site's styling rather than adding
// its own.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Braces, ChevronDown, FileJson, FileText, ListTree } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import SectionTitle from '@/components/widgets/SectionTitle.vue';
import VerdictChip from '@/components/widgets/VerdictChip.vue';
import CopyButton from '@/components/widgets/CopyButton.vue';
import { verdictTone, verdictKey, stepTone, formatLogText, exportRecord } from '@/composables/use-test-log.js';

const props = defineProps({
  // The handle `useTestLog()` returns.
  log: { type: Object, required: true },
  title: { type: String, default: '' },
  // Start with the step list open (the WebRTC probe table is the point of its page).
  defaultOpen: { type: Boolean, default: false },
});

const { t, te, locale } = useI18n();
const open = ref(props.defaultOpen);
const rawOpen = ref(false);

// A fresh top-level object per change: the record is mutated in place and its ref
// re-triggered, and a computed that returned the same object would be judged
// unchanged and never re-render the list.
const rec = computed(() => {
  const record = props.log.record.value;
  return record ? { ...record } : null;
});

// An unknown step kind or meta key reads as its code rather than a missing-key path.
const kindLabel = (kind) => (te(`testlog.kind.${kind}`) ? t(`testlog.kind.${kind}`) : kind);
const metaLabel = (key) => (te(`testlog.meta.${key}`) ? t(`testlog.meta.${key}`) : key);
const metaValue = (value) => (value && typeof value === 'object' ? JSON.stringify(value) : String(value));

// The record's ISO stamp, shown as wall-clock in the viewer's locale. A log is
// evidence, so seconds matter and the zone offset is spelled out.
const startedLabel = computed(() => {
  const iso = rec.value?.startedAt;
  if (!iso) return '';
  // Intl directly (not time-utils): the shared helpers render dates, not a
  // second-resolution timestamp with its offset.
  try {
    return new Intl.DateTimeFormat(locale.value, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
});

const tr = (key, params) => t(key, params || {});
const jsonText = () => JSON.stringify(exportRecord(rec.value), null, 2);
const plainText = () => formatLogText(rec.value, tr);

const download = (kind) => {
  const record = rec.value;
  if (!record) return;
  const stamp = record.startedAt.replace(/[:.]/g, '-');
  const name = `trustip-${record.test}-${stamp}.${kind === 'json' ? 'json' : 'txt'}`;
  const body = kind === 'json' ? `${jsonText()}\n` : `${plainText()}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: kind === 'json' ? 'application/json' : 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
</script>
