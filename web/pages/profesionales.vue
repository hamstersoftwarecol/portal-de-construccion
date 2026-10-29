<script setup lang="ts">
const filters = reactive({ specialty: '', available: false }); const list = ref<any[]>([]); const loading = ref(true); const err = ref('')
async function load() {
  loading.value = true; err.value = ''
  try { list.value = await api('/professionals', { query: { specialty: filters.specialty, available: filters.available ? 1 : undefined } }) } catch (e: any) { err.value = e.message }
  loading.value = false
}
watch(filters, load); onMounted(load)
</script>
<template>
  <div class="stack">
    <div><h1>Profesionales</h1><p class="muted">Directorio por especialidad con certificaciones vigentes y próxima disponibilidad.</p></div>
    <div class="row"><select v-model="filters.specialty" class="inline"><option value="">Todas las especialidades</option><option v-for="s in SPECIALTIES" :key="s" :value="s">{{ label(SPECIALTY_LABEL, s) }}</option></select>
      <label class="row" style="margin:0"><input v-model="filters.available" type="checkbox" /> Solo con disponibilidad en 7 días</label></div>
    <div v-if="err" class="alert error">{{ err }}</div>
    <div v-else-if="!loading && !list.length" class="empty">No hay profesionales con esos filtros.</div>
    <div class="grid g3">
      <div v-for="p in list" :key="p.id" class="card stack-sm">
        <div class="row"><img v-if="p.photoFileId" :src="`/api/files/${p.photoFileId}`" alt="" style="width:44px;height:44px;border-radius:99px;object-fit:cover" /><div class="brand-mark" v-else style="width:44px;height:44px;border-radius:99px">{{ p.name[0] }}</div>
          <div><b>{{ p.name }}</b><div class="small muted">{{ label(SPECIALTY_LABEL, p.specialty) }} · {{ p.zone || 'Sin zona' }}</div></div></div>
        <div class="small"><span v-if="p.nextAvailable" class="chip">◷ Próximo hueco: {{ fmtDateTime(p.nextAvailable) }}</span><span v-else class="chip">Sin disponibilidad en 7 días</span></div>
        <div v-if="p.certifications.length" class="small"><div v-for="c in p.certifications" :key="c.number" class="chip" style="margin:0 .3rem .3rem 0">✔ {{ c.name }} (hasta {{ fmtDate(c.expiresAt) }})</div></div>
        <div v-else class="small muted">Sin certificaciones verificadas vigentes</div>
        <div class="small muted">{{ p.email }} <span v-if="p.phone">· {{ p.phone }}</span></div>
      </div>
    </div>
  </div>
</template>
