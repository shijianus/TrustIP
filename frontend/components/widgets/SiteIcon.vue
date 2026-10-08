<template>
    <img
        v-if="src && !broken"
        :src="src"
        :width="size"
        :height="size"
        :alt="name"
        loading="lazy"
        decoding="async"
        class="shrink-0 rounded-[3px] object-contain"
        :style="`width:${size}px;height:${size}px`"
        @error="broken = true">
    <Monogram v-else :text="name" :seed="seed" :size="size" />
</template>

<script setup>
// A destination's own icon, from the committed same-origin set.
//
// The routing table used to draw a letter tile per row. The tiles were chosen
// over hot-linked favicons for a reason that still holds — a page that asks a
// third party for forty-four logos before it has measured anything is
// contradicting its own subject — but the reason only applies to *hot-linking*.
// The icons now live under `public/favicons/`, fetched at build time by
// `pnpm fetch-favicons` and committed, so they cost no third-party request,
// work offline, and — unlike a favicon loaded from the site itself — still draw
// for a visitor whose network is blocking that site, which is exactly the row
// worth reading.
//
// The fallback is not decoration. Three destinations in the catalog have no
// icon the services will hand over as a decodable image, and a row is not
// allowed to show a broken-image glyph for them; a letter tile says "this row
// has no logo" without pretending the row failed.

import { computed, ref, watch } from 'vue';
import Monogram from './Monogram.vue';
import { faviconPath } from '@/data/connectivity-import-lists.js';

const props = defineProps({
    // The committed file's name, without extension. Absent → straight to the
    // monogram, so a caller that has no icon for a row says so rather than
    // requesting `/favicons/undefined.png`.
    icon: { type: String, default: '' },
    name: { type: String, required: true },
    // Colour seed for the fallback tile — the host, so a brand that renames
    // itself in one locale keeps its tint.
    seed: { type: String, default: '' },
    size: { type: Number, default: 22 },
});

const broken = ref(false);
const src = computed(() => (props.icon ? faviconPath(props.icon) : ''));

// A re-run replaces the row list, and Vue reuses the component for the same
// key — so an icon that resolved for the previous occupant of this slot has to
// be allowed to fail (or succeed) again on its own terms.
watch(src, () => { broken.value = false; });
</script>
