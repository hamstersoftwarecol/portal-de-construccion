<script setup lang="ts">
const p = defineProps<{ value?: string | null; kind?: 'status' | 'role' | 'specialty' | 'priority' }>()
const text = computed(() => label(p.kind === 'role' ? ROLE_LABEL : p.kind === 'specialty' ? SPECIALTY_LABEL : p.kind === 'priority' ? PRIORITY_LABEL : STATUS_LABEL, p.value))
</script>
<template><span v-if="value" class="badge" :class="`b-${value}`">{{ text }}</span></template>
