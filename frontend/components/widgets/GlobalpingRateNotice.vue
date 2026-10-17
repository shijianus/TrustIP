<template>
    <p v-if="remaining > 0" role="status" class="text-xs leading-relaxed text-warning-soft-fg">
        {{ t('globalping.RateLimited', { s: remaining }) }}
    </p>
</template>

<script setup>
// The one line every Globalping tool shows while the shared 429 back-off holds
// (frontend/composables/use-globalping-measurement.js): how long until a run
// can be sent again, counting down, then gone. Renders nothing otherwise.

import { ref, computed, watch, onScopeDispose } from 'vue';
import { useI18n } from 'vue-i18n';
import { globalpingRateLimit } from '@/composables/use-globalping-measurement.js';

const { t } = useI18n();
const now = ref(Date.now());
let timer = null;

const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
};

const remaining = computed(() => {
    const until = globalpingRateLimit.value?.until || 0;
    return Math.max(0, Math.ceil((until - now.value) / 1000));
});

watch(globalpingRateLimit, (limit) => {
    now.value = Date.now();
    stop();
    if (limit && limit.until > now.value) {
        timer = setInterval(() => {
            now.value = Date.now();
            if (now.value >= limit.until) stop();
        }, 1000);
    }
}, { immediate: true });

onScopeDispose(stop);
</script>
