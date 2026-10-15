<script setup>
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <div
    data-slot="card"
    :class="cn('rounded-lg border bg-card text-card-foreground shadow-card', $props.class)"
  >
    <slot />
  </div>
</template>
