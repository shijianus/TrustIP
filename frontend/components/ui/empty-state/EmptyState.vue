<script setup>
// EmptyState — what a region shows when it has nothing to show, or when
// loading it failed. Always says what happened and offers the next step
// (Apple HIG "provide a way forward", Material 3 empty states, Stripe/Vercel
// dashboards): an icon in a soft well, a one-line title, an optional
// explanation, and — for errors — a Retry button that emits `retry`.
//   <EmptyState title="No records" description="…" />
//   <EmptyState tone="error" :title="t('uikit.loadFailedTitle')" @retry="load" />
import { computed, useSlots } from 'vue';
import { useI18n } from 'vue-i18n';
import { Inbox, CloudOff, RotateCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const props = defineProps({
  // empty | error
  tone: { type: String, default: 'empty' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  // a lucide component to replace the default glyph
  icon: { type: [Object, Function], default: null },
  // show the Retry button (defaults on for tone="error")
  retry: { type: Boolean, default: undefined },
  retryLabel: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  class: { type: [String, Array, Object], default: undefined },
});
const emit = defineEmits(['retry']);
const slots = useSlots();
const { t } = useI18n();

const isError = computed(() => props.tone === 'error');
const glyph = computed(() => props.icon || (isError.value ? CloudOff : Inbox));
const showRetry = computed(() => (props.retry ?? isError.value));
const heading = computed(() => props.title || t(isError.value ? 'uikit.loadFailedTitle' : 'uikit.emptyTitle'));
</script>

<template>
  <div data-slot="empty-state" :data-tone="tone" :role="isError ? 'alert' : 'status'"
    :class="cn('flex flex-col items-center justify-center text-center',
      compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12', props.class)">
    <span :class="['inline-flex items-center justify-center rounded-full',
      compact ? 'size-10' : 'size-12',
      isError ? 'bg-destructive-soft text-destructive-soft-fg' : 'bg-muted text-muted-foreground']" aria-hidden="true">
      <component :is="glyph" :class="compact ? 'size-5' : 'size-6'" />
    </span>
    <div class="flex max-w-sm flex-col gap-1">
      <p class="jn-text-headline m-0 text-foreground">{{ heading }}</p>
      <p v-if="description" class="m-0 text-sm leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="showRetry || slots.default" class="mt-1 flex flex-wrap items-center justify-center gap-2">
      <Button v-if="showRetry" variant="outline" size="sm" class="cursor-pointer" @click="emit('retry')">
        <RotateCw aria-hidden="true" />
        {{ retryLabel || t('uikit.retry') }}
      </Button>
      <slot />
    </div>
  </div>
</template>
