<script setup>
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <p data-slot="card-description" :class="cn('m-0 text-sm leading-normal text-muted-foreground', $props.class)">
    <slot />
  </p>
</template>
