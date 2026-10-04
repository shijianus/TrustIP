<template>
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
        <span class="font-semibold text-foreground-secondary">{{ t('dossier.slot.needs') }}</span>
        {{ text }}
    </p>
</template>

<script setup>
// "To fill this in: …" — the one line that turns a declared gap into a task.
// Shared so every panel words it the same way, and so the prefix never drifts
// from the label CapabilitySlot puts on it.

import { useI18n } from 'vue-i18n';

defineProps({
    text: { type: String, required: true },
});

const { t } = useI18n();
</script>
