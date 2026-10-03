<template>
    <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 class="text-xs leading-none">
            <!-- Uppercase and tracking live on the leaf span, never on the
                 container: a title bar that also hosts counts and toggles would
                 shout all of them, and every child then needs its own reset. -->
            <span class="font-semibold uppercase tracking-wide text-muted-foreground">{{ title }}</span>
            <slot name="suffix" />
        </h3>
        <div class="ms-auto flex items-center gap-2">
            <slot name="aside" />
        </div>
    </div>
</template>

<script setup>
// The quiet header above a panel of data: small, uppercase, letter-spaced, in
// the tertiary text colour. Deliberately the least prominent thing in its own
// card — the values underneath are the answer, and a header that competes with
// them inverts the reading order.
defineProps({
    title: { type: String, required: true },
});
</script>
