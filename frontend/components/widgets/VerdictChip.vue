<template>
    <span
        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
        :class="toneClass">
        <Icon v-if="icon" :icon="icon" class="size-3.5 shrink-0" />
        <slot>{{ label }}</slot>
    </span>
</template>

<script setup>
// A verdict, not a button.
//
// Solid fills read as something to press; a verdict has to read as data. Every
// pair here is a pale well of its own hue with text mixed toward the theme
// foreground — derived in one place from the semantic tokens, so a chip in dark
// mode is a dark green, not a light green pasted onto a dark background.
//
// Three states are the whole design: `detected`, `not detected`, and
// `not measured`. Collapsing the third into the second is how a panel starts
// lying, so callers must pass tone `muted` explicitly when a source did not
// answer.

import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useStatusTone } from '@/composables/use-status-tone.js';

const props = defineProps({
    // ok / warn / bad / info / action / muted — the same tones the rest of the
    // app uses, so a verdict means the same colour everywhere.
    tone: { type: String, default: 'muted' },
    label: { type: String, default: '' },
    icon: { type: String, default: null },
});

const TONES = {
    ok: 'bg-success-soft text-success-soft-fg',
    warn: 'bg-warning-soft text-warning-soft-fg',
    bad: 'bg-destructive-soft text-destructive-soft-fg',
    info: 'bg-info-soft text-info-soft-fg',
    action: 'bg-action-soft text-action-soft-fg',
    muted: 'bg-muted text-muted-foreground',
};

const { chipClass } = useStatusTone();

// `chipClass` covers the four business tones; the two extras keep this
// component honest when a caller names a tint the tone map does not carry.
const toneClass = computed(() => TONES[props.tone] || chipClass(props.tone));
</script>
