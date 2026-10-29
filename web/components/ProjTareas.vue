<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast()
const tasks = ref<any[]>([]); const phases = ref<any[]>([]); const members = ref<any[]>([])
const f = reactive({ status: '', specialty: '', phase: '', overdue: false })
const show = ref(false); const newPhase = ref('')
const form = reactive<any>({ title: '', description: '', specialty: 'gestion', priority: 'media', dueDate: addDaysStr(todayStr(), 7), phaseId: '', assigneeId: '' })
const mgr = computed(() => can(props.project.myRole, 'task.create'))
async function load() {
  tasks.value = await api(`/projects/${props.project.id}/tasks`, { query: { status: f.status, specialty: f.specialty, phase: f.phase, overdue: f.overdue ? 1 : undefined } })
  phases.value = await api(`/projects/${props.project.id}/phases`)
}
onMounted(async () => { members.value = await api(`/projects/${props.project.id}/members`); load() }); watch(f, load)
const assignable = computed(() => members.value.filter((m) => form.specialty === 'gestion' || roleSpecialty(m.role) === form.specialty))
watch(() => form.specialty, () => { form.assigneeId = '' })
async function create() {
  try {
    await api(`/projects/${props.project.id}/tasks`, { body: { title: form.title, description: form.description, specialty: form.specialty, priority: form.priority, dueDate: form.dueDate, phaseId: form.phaseId ? Number(form.phaseId) : null, assigneeId: form.assigneeId ? Number(form.assigneeId) : null } })
    show.value = false; Object.assign(form, { title: '', description: '', assigneeId: '' }); toast.push('Tarea creada'); load()
  } catch (e) { toast.error(e) }
}
async function addPhase() { try { await api(`/projects/${props.project.id}/phases`, { body: { name: newPhase.value } }); newPhase.value = ''; load() } catch (e) { toast.error(e) } }
async function togglePhase(p: any) { try { await api(`/phases/${p.id}`, { method: 'PATCH', body: { status: p.status === 'abierta' ? 'cerrada' : 'abierta' } }); load() } catch (e) { toast.error(e) } }
async function movePhase(p: any, d: number) { try { await api(`/phases/${p.id}`, { method: 'PATCH', body: { position: p.position + d } }); load() } catch (e) { toast.error(e) } }
async function delPhase(p: any) { if (confirm(`¿Eliminar la fase "${p.name}"? Sus tareas quedarán sin fase.`)) { await api(`/phases/${p.id}`, { method: 'DELETE' }); load() } }
</script>
<template>
  <div class="stack">
    <div class="card stack-sm">
      <div class="row between"><h2 style="margin:0">Fases</h2>
        <form v-if="can(project.myRole, 'phase.manage')" class="row" @submit.prevent="addPhase"><input v-model="newPhase" placeholder="Nueva fase" class="inline" required minlength="2" /><button class="btn sm">Agregar fase</button></form></div>
      <div v-if="!phases.length" class="muted small">Aún no hay fases.</div>
      <div v-for="p in phases" :key="p.id" class="row"><div style="width:180px"><b>{{ p.name }}</b> <StatusBadge :value="p.status" /></div>
        <div class="grow bar"><i :style="{ width: (p.tasks ? (p.approved / p.tasks) * 100 : 0) + '%' }" /></div><span class="small muted">{{ p.approved }}/{{ p.tasks }}</span>
        <template v-if="can(project.myRole, 'phase.manage')"><button class="btn sm ghost" title="Subir" @click="movePhase(p, -1)">↑</button><button class="btn sm ghost" title="Bajar" @click="movePhase(p, 1)">↓</button><button class="btn sm" @click="togglePhase(p)">{{ p.status === 'abierta' ? 'Cerrar' : 'Reabrir' }}</button><button class="btn sm danger" @click="delPhase(p)">✕</button></template></div>
    </div>
    <div class="row between">
      <div class="row"><select v-model="f.status" class="inline"><option value="">Todos los estados</option><option v-for="s in ['pendiente','en_curso','hecha','aprobada']" :key="s" :value="s">{{ label(STATUS_LABEL, s) }}</option></select>
        <select v-model="f.specialty" class="inline"><option value="">Todas las especialidades</option><option v-for="s in SPECIALTIES" :key="s" :value="s">{{ label(SPECIALTY_LABEL, s) }}</option></select>
        <select v-model="f.phase" class="inline"><option value="">Todas las fases</option><option v-for="p in phases" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        <label class="row" style="margin:0"><input v-model="f.overdue" type="checkbox" /> Solo vencidas</label></div>
      <button v-if="mgr" class="btn primary" @click="show = true">+ Nueva tarea</button></div>
    <div v-if="!tasks.length" class="empty">{{ can(project.myRole, 'task.viewAll') ? 'No hay tareas con estos filtros.' : 'No tienes tareas asignadas en este proyecto.' }}</div>
    <div v-else class="card scroll-x"><table class="table"><thead><tr><th>Tarea</th><th>Fase</th><th>Especialidad</th><th>Responsable</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
      <tr v-for="t in tasks" :key="t.id"><td><NuxtLink :to="`/tareas/${t.id}`" class="task-link">{{ t.title }}</NuxtLink> <StatusBadge :value="t.priority" kind="priority" /><div v-if="t.blocked" class="small" style="color:var(--warn)">Bloqueada</div></td>
        <td>{{ t.phaseName ?? '—' }}</td><td>{{ label(SPECIALTY_LABEL, t.specialty) }}</td><td>{{ t.assigneeName ?? 'Sin asignar' }}</td><td :style="{ color: t.overdue ? 'var(--bad)' : '' }">{{ fmtDate(t.dueDate) }}</td><td><StatusBadge :value="t.status" /></td></tr></tbody></table></div>
    <AppModal v-if="show" title="Nueva tarea" @close="show = false">
      <form class="stack-sm" @submit.prevent="create">
        <div class="field"><label>Título</label><input v-model="form.title" required minlength="3" /></div>
        <div class="field"><label>Descripción</label><textarea v-model="form.description" /></div>
        <div class="grid g2"><div class="field"><label>Especialidad requerida</label><select v-model="form.specialty"><option v-for="s in SPECIALTIES" :key="s" :value="s">{{ label(SPECIALTY_LABEL, s) }}</option></select></div>
          <div class="field"><label>Prioridad</label><select v-model="form.priority"><option v-for="s in ['baja','media','alta','critica']" :key="s" :value="s">{{ label(PRIORITY_LABEL, s) }}</option></select></div>
          <div class="field"><label>Fecha límite</label><input v-model="form.dueDate" type="date" required /></div>
          <div class="field"><label>Fase</label><select v-model="form.phaseId"><option value="">Sin fase</option><option v-for="p in phases.filter((x) => x.status === 'abierta')" :key="p.id" :value="p.id">{{ p.name }}</option></select></div></div>
        <div class="field"><label>Asignar a</label><select v-model="form.assigneeId"><option value="">Sin asignar</option><option v-for="m in assignable" :key="m.userId" :value="m.userId">{{ m.name }} — {{ label(ROLE_LABEL, m.role) }}</option></select></div>
        <button class="btn primary">Crear tarea</button>
      </form>
    </AppModal>
  </div>
</template>
