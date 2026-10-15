<script setup>
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <!-- jn-text-headline: 16px / 600 / tight — the card-title role of the
       type ramp (style.css). It was text-2xl, which out-shouted the page's
       own section headings. -->
  <h3 data-slot="card-title" :class="cn('jn-text-headline m-0', $props.class)">
    <slot />
  </h3>
</template>
