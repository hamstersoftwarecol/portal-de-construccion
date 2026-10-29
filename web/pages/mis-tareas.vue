<script setup lang="ts">
const toast = useToast(); const tasks = ref<any[]>([]); const loading = ref(true); const offlineData = ref(false); const filter = ref('abiertas')
async function load() {
  loading.value = true
  try { tasks.value = await api('/tasks/mine'); offlineData.value = false } catch (e: any) { toast.error(e) } loading.value = false
}
async function setStatus(t: any, status: string) {
  try {
    const r: any = await apiOrQueue(`/tasks/${t.id}/status`, { status }, `${t.title} → ${status}`)
    if (r.queued) { t.status = status; toast.push('Sin conexión: el cambio se enviará al reconectar') } else { toast.push('Estado actualizado'); load() }
  } catch (e) { toast.error(e) }
}
const shown = computed(() => tasks.value.filter((t) => filter.value === 'todas' || (filter.value === 'abiertas' ? t.status !== 'aprobada' : t.status === filter.value)))
const pending = usePendingSync()
watch(pending, (n) => { if (n === 0) load() })
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="row between"><div><h1>Mis tareas</h1><p class="muted">Todo lo que tienes asignado, en todos los proyectos.</p></div>
      <select v-model="filter" class="inline"><option value="abiertas">Abiertas</option><option value="todas">Todas</option><option value="pendiente">Pendientes</option><option value="en_curso">En curso</option><option value="hecha">En revisión</option><option value="aprobada">Aprobadas</option></select></div>
    <div v-if="loading" class="muted">Cargando…</div>
    <div v-else-if="!shown.length" class="empty">No tienes tareas en esta vista.</div>
    <div class="card" v-else>
      <div v-for="t in shown" :key="t.id" class="list-item row">
        <div class="grow">
          <NuxtLink :to="`/tareas/${t.id}`" class="task-link">{{ t.title }}</NuxtLink>
          <div class="small muted">{{ t.projectName }} · {{ t.phaseName ?? 'Sin fase' }} · vence {{ fmtDate(t.dueDate) }}<span v-if="t.overdue" style="color:var(--bad)"> · vencida</span></div>
          <div v-if="t.blocked" class="small" style="color:var(--warn)">Bloqueada por una dependencia</div>
        </div>
        <StatusBadge :value="t.priority" kind="priority" /><StatusBadge :value="t.status" />
        <button v-if="t.status === 'pendiente'" class="btn sm" :disabled="t.blocked" @click="setStatus(t, 'en_curso')">Iniciar</button>
        <button v-if="t.status === 'en_curso'" class="btn sm primary" @click="setStatus(t, 'hecha')">Marcar hecha</button>
      </div>
    </div>
  </div>
</template>
