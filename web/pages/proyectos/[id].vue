<script setup lang="ts">
const route = useRoute(); const toast = useToast()
const id = computed(() => Number(route.params.id))
const p = ref<any>(null); const err = ref('')
const tab = ref(String(route.query.tab ?? 'resumen'))
watch(() => route.query.tab, (v) => { if (v) tab.value = String(v) })
watch(tab, (v) => navigateTo({ query: { ...route.query, tab: v } }, { replace: true }))
async function load() { try { p.value = await api(`/projects/${id.value}`) } catch (e: any) { err.value = e.message } }
onMounted(load)
const tabs = computed(() => {
  const t = [['resumen', 'Resumen'], ['tareas', 'Tareas'], ['agenda', 'Agenda'], ['documentos', 'Documentos'], ['topografia', 'Topografía'], ['calidad', 'Calidad'], ['equipo', 'Equipo']]
  if (can(p.value?.myRole, 'dashboard.view')) t.splice(1, 0, ['dashboard', 'Avance'])
  return t
})
void toast
</script>
<template>
  <div v-if="err" class="alert error">{{ err }} <NuxtLink to="/">Volver</NuxtLink></div>
  <div v-else-if="p" class="stack">
    <div class="row between"><div><h1>{{ p.name }}</h1><div class="muted">{{ p.location }} · {{ fmtDate(p.startDate) }} → {{ fmtDate(p.endDate) }}</div></div>
      <div class="row"><StatusBadge :value="p.status" /><StatusBadge :value="p.myRole" kind="role" /></div></div>
    <div class="tabs" role="tablist"><button v-for="t in tabs" :key="t[0]" role="tab" :class="{ on: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button></div>
    <ProjResumen v-if="tab === 'resumen'" :project="p" @changed="load" />
    <ProjDashboard v-else-if="tab === 'dashboard'" :project="p" />
    <ProjTareas v-else-if="tab === 'tareas'" :project="p" />
    <ProjAgenda v-else-if="tab === 'agenda'" :project="p" />
    <ProjDocumentos v-else-if="tab === 'documentos'" :project="p" />
    <ProjTopografia v-else-if="tab === 'topografia'" :project="p" />
    <ProjCalidad v-else-if="tab === 'calidad'" :project="p" />
    <ProjEquipo v-else-if="tab === 'equipo'" :project="p" />
  </div>
</template>
