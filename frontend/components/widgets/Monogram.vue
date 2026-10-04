<template>
    <!-- A letter tile instead of a favicon, deliberately. Fetching forty-four
         icons per page view would mean either hotlinking each brand's own
         asset server or routing the whole set through a third-party icon
         proxy — and an IP-diagnostic page that makes forty-four extra
         third-party requests before it has measured anything is contradicting
         its own subject. This costs nothing, works offline, and cannot leak. -->
    <span
        class="inline-flex shrink-0 items-center justify-center rounded-md font-semibold"
        :style="`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px;background:${tint};color:${ink}`"
        :aria-hidden="true">
        {{ letters }}
    </span>
</template>

<script setup>
// A stable, dependency-free stand-in for a site icon.

import { computed } from 'vue';

const props = defineProps({
    text: { type: String, required: true },
    size: { type: Number, default: 24 },
    // Hashed from this rather than from the display name, so a brand that
    // renames itself in one locale does not change its colour. `key` is
    // Vue's own reserved attribute and cannot be a prop name.
    seed: { type: String, default: '' },
});

const letters = computed(() => (props.text || '?').trim().slice(0, 1).toUpperCase());

// A hue per host, fixed by hashing. Random would repaint the whole table on
// every reload, which reads as the page being unstable rather than as styling.
const hue = computed(() => {
    const seed = props.seed || props.text || '';
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
});

// Both colours come from the same hue at different lightnesses so the tile
// stays legible in either theme without a `dark:` pair.
const tint = computed(() => `hsl(${hue.value} 55% 92%)`);
const ink = computed(() => `hsl(${hue.value} 60% 30%)`);
</script>
