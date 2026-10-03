<template>
    <DropdownMenu>
        <JnTooltip :text="t('nav.preferences.colorScheme')">
            <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8 cursor-pointer" :aria-label="triggerLabel">
                    <component :is="currentIcon" class="size-4" />
                </Button>
            </DropdownMenuTrigger>
        </JnTooltip>
        <DropdownMenuContent align="end" class="min-w-40">
            <DropdownMenuItem v-for="opt in options" :key="opt.value" class="cursor-pointer gap-2"
                @click="choose(opt.value)">
                <component :is="opt.icon" class="size-4" />
                {{ opt.label }}
                <Check v-if="theme === opt.value" class="ms-auto size-4" />
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
</template>

<script setup>
// Theme mode, one click from anywhere.
//
// The preference itself has always had three states; only its entry point was
// buried inside the preferences sheet. `use-theme.js` watches the stored
// preference, so writing it here is the whole mechanism — nothing to apply.
//
// The trigger carries the stored choice, not the rendered one: `auto` shows
// the system glyph even while the site is dark, so the menu always explains
// what the visitor actually set.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Sun, Moon, LaptopMinimal, Check } from '@lucide/vue';
import { useMainStore } from '@/store';
import { Button } from '@/components/ui/button';
import { JnTooltip } from '@/components/ui/tooltip';
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const { t } = useI18n();
const store = useMainStore();

const theme = computed(() => store.userPreferences.theme);

const options = computed(() => [
    { value: 'light', label: t('nav.preferences.colorLight'), icon: Sun },
    { value: 'dark', label: t('nav.preferences.colorDark'), icon: Moon },
    { value: 'auto', label: t('nav.preferences.systemAuto'), icon: LaptopMinimal },
]);

const currentIcon = computed(() =>
  ({ light: Sun, dark: Moon, auto: LaptopMinimal }[theme.value] || LaptopMinimal));

const triggerLabel = computed(() =>
    `${t('nav.preferences.colorScheme')}: ${options.value.find((o) => o.value === theme.value)?.label || ''}`);

const choose = (value) => store.updatePreference('theme', value);
</script>
