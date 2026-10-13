<template>
    <!-- A grid of short strings, collapsed to one screenful. Six cells is what
         fits without the panel dominating the page; past that the row count
         matters more than the contents, so the rest is behind a toggle that
         says how much it is hiding. -->
    <div class="min-w-0">
        <p v-if="!items.length" class="text-sm text-muted-foreground">{{ empty }}</p>

        <template v-else>
            <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <li
                    v-for="(cell, i) in cells" :key="cell.main + i"
                    class="min-w-0 rounded-lg border px-2.5 py-2">
                    <component
                        :is="cell.link.is"
                        v-bind="cell.link.props"
                        class="jn-nums block truncate text-[13px] leading-tight font-semibold text-foreground no-underline"
                        :class="cell.link.props.href || cell.link.props.to ? 'hover:text-action hover:underline' : ''"
                        :title="cell.main">
                        {{ cell.main }}
                    </component>
                    <span v-if="cell.sub" class="mt-0.5 block truncate text-[11px] text-muted-foreground" :title="cell.sub">
                        {{ cell.sub }}
                    </span>
                </li>
            </ul>

            <button
                v-if="items.length > COLLAPSED" type="button"
                class="mt-2 w-full rounded-lg border border-dashed py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                @click="open = !open">
                {{ open ? t('dossier.grid.less') : t('dossier.grid.more', { n: items.length - COLLAPSED }) }}
            </button>
        </template>
    </div>
</template>

<script setup>
// The shared body of the "what else lives here" panels.

import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

const props = defineProps({
    // [{ main, sub?, to? | href? }] — `to` is a route in this app, `href` a URL
    // that is not.
    items: { type: Array, default: () => [] },
    empty: { type: String, default: '' },
});

const { t } = useI18n();
const COLLAPSED = 6;

// An address inside this app is a navigation, not a document request: a bare
// `<a href="/ip/…">` tears down the running page — and its measurements — to
// load a route the router already knows, and depends on the host rewriting deep
// paths. An outside URL keeps the anchor it needs. A cell with neither stays
// plain text, which is what most of these rows are.
const linkOf = (item) => {
    if (item.to) return { is: RouterLink, props: { to: item.to } };
    if (item.href) return { is: 'a', props: { href: item.href } };
    return { is: 'div', props: {} };
};

const open = ref(false);
const visible = computed(() => (open.value ? props.items : props.items.slice(0, COLLAPSED)));
const cells = computed(() => visible.value.map((item) => ({ ...item, link: linkOf(item) })));
</script>
