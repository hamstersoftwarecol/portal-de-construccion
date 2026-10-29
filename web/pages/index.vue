<script setup lang="ts">
const s = useSession(); const toast = useToast()
const projects = ref<any[]>([]); const loading = ref(true); const showNew = ref(false)
const form = reactive({ name: '', location: '', startDate: todayStr(), endDate: addDaysStr(todayStr(), 180), status: 'planificacion' })
async function load() { loading.value = true; try { projects.value = await api('/projects') } catch (e) { toast.error(e) } loading.value = false }
async function create() {
  try { const r = await api('/projects', { body: form }); showNew.value = false; toast.push('Proyecto creado'); navigateTo(`/proyectos/${r.id}`) } catch (e) { toast.error(e) }
}
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="row between"><div><h1>Proyectos</h1><p class="muted">Tus obras y el rol que tienes en cada una.</p></div>
      <button v-if="s.user.value?.isAdmin" class="btn primary" @click="showNew = true">+ Nuevo proyecto</button></div>
    <div v-if="loading" class="muted">Cargando…</div>
    <div v-else-if="!projects.length" class="empty">Aún no perteneces a ningún proyecto. Pide a un administrador que te invite con un código o enlace.</div>
    <div class="grid g3">
      <NuxtLink v-for="p in projects" :key="p.id" :to="`/proyectos/${p.id}`" class="card stack-sm" style="text-decoration:none">
        <div class="row between"><h3 style="margin:0">{{ p.name }}</h3><StatusBadge :value="p.status" /></div>
        <div class="muted small">{{ p.location }}</div>
        <div class="row small"><StatusBadge :value="p.myRole" kind="role" /><span class="chip">👥 {{ p.teamCount }}</span><span class="chip">☐ {{ p.openTasks }} abiertas</span></div>
        <div class="small muted">{{ fmtDate(p.startDate) }} → {{ fmtDate(p.endDate) }}</div>
      </NuxtLink>
    </div>
    <AppModal v-if="showNew" title="Nuevo proyecto" @close="showNew = false">
      <form class="stack-sm" @submit.prevent="create">
        <div class="field"><label>Nombre</label><input v-model="form.name" required minlength="3" /></div>
        <div class="field"><label>Ubicación</label><input v-model="form.location" required minlength="3" /></div>
        <div class="grid g2"><div class="field"><label>Inicio</label><input v-model="form.startDate" type="date" required /></div><div class="field"><label>Fin</label><input v-model="form.endDate" type="date" required /></div></div>
        <button class="btn primary">Crear proyecto</button>
      </form>
    </AppModal>
  </div>
</template>
