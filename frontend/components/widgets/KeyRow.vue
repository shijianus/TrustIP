<template>
    <div class="flex items-baseline justify-between gap-4 py-1.5" :class="wide ? 'min-w-0' : ''">
        <dt class="shrink-0 font-normal text-muted-foreground">
            <slot name="label">{{ label }}</slot>
        </dt>
        <dd
            class="min-w-0 text-right font-semibold text-foreground"
            :class="[
                nums ? 'jn-nums' : '',
                wide ? 'flex-1 basis-0 truncate font-normal' : 'break-words max-w-[65%]',
                empty ? 'font-normal text-muted-foreground' : '',
                tone ? toneText : '',
            ]">
            <slot>{{ display }}</slot>
        </dd>
    </div>
</template>

<script setup>
// One key/value row — the shared shape behind every data panel on the site.
//
// The two halves are deliberately weighted apart: the label is quiet and
// normal, the value is semibold and right-aligned. That contrast is what lets
// a twelve-row panel be scanned rather than read, and it is the reason callers
// should reach for this instead of hand-rolling another `dl`.
//
// Dividers belong to the group, not the row: put these inside
// `<dl class="divide-y divide-dashed divide-border">` and the last row loses
// its rule automatically.
//
// `wide` trades weight for room — a value that can be arbitrarily long (an
// ISP name, a PTR, a CIDR list) ellipsises instead of pushing the row open, and
// drops to normal weight because a truncated bold string reads as shouting.

import { computed } from 'vue';
import { useStatusTone } from '@/composables/use-status-tone.js';

const props = defineProps({
    label: { type: String, default: '' },
    value: { type: [String, Number], default: '' },
    // Long, unbounded values: truncate rather than wrap.
    wide: { type: Boolean, default: false },
    // Numeric values hold their column so rows do not shift as data arrives.
    nums: { type: Boolean, default: false },
    // A tone maps the value's business state to colour through the single
    // definition site rather than a local switch.
    tone: { type: String, default: null },
});

const { textClass } = useStatusTone();
const toneText = computed(() => (props.tone ? textClass(props.tone) : ''));

const empty = computed(() => props.value === '' || props.value === null || props.value === undefined);

// A value that is simply absent reads as an em dash: present enough that the
// row was evaluated, quiet enough not to look like an answer.
const display = computed(() => (empty.value ? '—' : props.value));
</script>
