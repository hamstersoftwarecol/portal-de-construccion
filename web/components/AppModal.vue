<script setup lang="ts">
defineProps<{ title: string }>()
defineEmits<{ close: [] }>()
</script>
<template>
  <div class="modal-bg" @mousedown.self="$emit('close')">
    <div class="modal stack" role="dialog" :aria-label="title">
      <div class="row between"><h2 style="margin:0">{{ title }}</h2><button class="btn sm ghost" aria-label="Cerrar" @click="$emit('close')">✕</button></div>
      <slot />
    </div>
  </div>
</template>
