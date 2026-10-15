<script setup>
import { cn } from '@/lib/utils';

defineProps({
  class: { type: [String, Array, Object], default: undefined },
});
</script>

<template>
  <div data-slot="card-footer" :class="cn('flex items-center gap-2 p-6 pt-0', $props.class)">
    <slot />
  </div>
</template>
