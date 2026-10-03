<template>
    <!-- The beacon mark, inline so it inherits the surrounding text colour
        through the root `fill`. Filled geometry only (no strokes) — that is
        what lets every host paint it by setting `fill` alone. Same numbers as
        public/favicon.svg; keep the two in step. -->
    <svg :style="{ fill: isDarkMode ? '#fff' : '#212529' }" class="me-1" width="23" height="23"
        xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision"
        image-rendering="optimizeQuality" fill-rule="evenodd" clip-rule="evenodd" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="2.3" />
        <path d="M 16.879 7.121 A 6.9 6.9 0 1 1 7.121 7.121 L 8.818 8.818 A 4.5 4.5 0 1 0 15.182 8.818 Z" />
        <path d="M 20.061 3.939 A 11.4 11.4 0 1 1 3.939 3.939 L 5.495 5.495 A 9.2 9.2 0 1 0 18.505 5.495 Z" />
    </svg>
</template>

<script setup>
import { computed } from 'vue';
import { useMainStore } from '@/store';

const store = useMainStore();
const isDarkMode = computed(() => store.isDarkMode);
</script>