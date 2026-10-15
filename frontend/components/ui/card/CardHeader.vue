<script setup>
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <!-- Card anatomy: title, optional subtitle, optional trailing action.
       A grid rather than a column so a CardAction child takes the top-right
       cell (two columns appear only when one is present). gap-1 = 4px between
       title and subtitle; p-6 = 24px, the card padding on the 8px rhythm. -->
  <div data-slot="card-header"
    :class="cn('grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 p-6 has-[[data-slot=card-action]]:grid-cols-[1fr_auto] has-[[data-slot=card-action]]:gap-x-4', $props.class)">
    <slot />
  </div>
</template>
