<script setup>
// The header's trailing action (a button, a link, a menu). CardHeader switches
// to a two-column grid when one is present, so title + subtitle stay left and
// the action pins to the top-right without each card hand-rolling a flex row.
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <div data-slot="card-action" :class="cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', $props.class)">
    <slot />
  </div>
</template>
