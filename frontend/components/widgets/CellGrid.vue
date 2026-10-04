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
                    v-for="(item, i) in visible" :key="item.main + i"
                    class="min-w-0 rounded-lg border px-2.5 py-2">
                    <component
                        :is="item.href ? 'a' : 'div'"
                        v-bind="item.href ? { href: item.href } : {}"
                        class="jn-nums block truncate text-[13px] leading-tight font-semibold text-foreground no-underline"
                        :class="item.href ? 'hover:text-action hover:underline' : ''"
                        :title="item.main">
                        {{ item.main }}
                    </component>
                    <span v-if="item.sub" class="mt-0.5 block truncate text-[11px] text-muted-foreground" :title="item.sub">
                        {{ item.sub }}
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
// The shared body of the two "what else lives here" panels.

import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    // [{ main, sub?, href? }]
    items: { type: Array, default: () => [] },
    empty: { type: String, default: '' },
});

const { t } = useI18n();
const COLLAPSED = 6;

const open = ref(false);
const visible = computed(() => (open.value ? props.items : props.items.slice(0, COLLAPSED)));
</script>
