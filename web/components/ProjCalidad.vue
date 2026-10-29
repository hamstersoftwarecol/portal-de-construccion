<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast()
const ncs = ref<any[]>([]); const insp = ref<any[]>([]); const members = ref<any[]>([]); const show = ref(false); const files = ref<File[]>([])
const f = reactive({ title: '', description: '', severity: 'media', createTask: true, specialty: 'ingenieria_civil', assigneeId: '', dueDate: addDaysStr(todayStr(), 7) })
const write = computed(() => can(props.project.myRole, 'nc.write'))
async function load() {
  ncs.value = await api(`/projects/${props.project.id}/nonconformities`)
  const all = await api(`/projects/${props.project.id}/appointments`, { query: { from: addDaysStr(todayStr(), -120), to: addDaysStr(todayStr(), 120) } })
  insp.value = all.filter((a: any) => a.kind === 'inspeccion')
}
onMounted(async () => { members.value = await api(`/projects/${props.project.id}/members`); load() })
const assignable = computed(() => members.value.filter((m) => f.specialty === 'gestion' || roleSpecialty(m.role) === f.specialty))
async function create() {
  const fd = new FormData(); fd.append('title', f.title); fd.append('description', f.description); fd.append('severity', f.severity); fd.append('createTask', String(f.createTask))
  if (f.createTask) { fd.append('specialty', f.specialty); fd.append('assigneeId', f.assigneeId); fd.append('dueDate', f.dueDate) }
  files.value.forEach((x) => fd.append('files', x))
  try { const r = await api(`/projects/${props.project.id}/nonconformities`, { form: fd }); show.value = false; files.value = []; f.title = ''; f.description = ''; toast.push(r.taskId ? 'No conformidad registrada y tarea correctiva creada' : 'No conformidad registrada'); load() } catch (e) { toast.error(e) }
}
async function close(n: any) { try { await api(`/nonconformities/${n.id}/close`, { method: 'POST' }); toast.push('No conformidad cerrada'); load() } catch (e) { toast.error(e) } }
</script>
<template>
  <div class="stack">
    <div class="row between"><h2 style="margin:0">No conformidades</h2><button v-if="write" class="btn primary" @click="show = true">+ Registrar no conformidad</button></div>
    <div v-if="!ncs.length" class="empty">Sin no conformidades registradas.</div>
    <div class="grid g2"><div v-for="n in ncs" :key="n.id" class="card stack-sm">
      <div class="row between"><b>{{ n.title }}</b><div class="row"><StatusBadge :value="n.severity" kind="priority" /><StatusBadge :value="n.status" /></div></div>
      <div class="small muted">{{ n.description }}</div>
      <div class="photos"><a v-for="a in n.files" :key="a.id" :href="`/api/files/${a.id}`" target="_blank"><img :src="`/api/files/${a.id}`" :alt="a.filename" /></a></div>
      <div class="row small"><span class="muted">{{ n.author }} · {{ fmtDate(n.createdAt) }}</span><NuxtLink v-if="n.taskId" :to="`/tareas/${n.taskId}`" class="chip">Tarea correctiva #{{ n.taskId }} · {{ label(STATUS_LABEL, n.taskStatus) }}</NuxtLink></div>
      <button v-if="write && n.status === 'abierta'" class="btn sm" :disabled="n.taskId && n.taskStatus !== 'aprobada'" :title="n.taskId && n.taskStatus !== 'aprobada' ? 'La tarea correctiva debe estar aprobada' : ''" @click="close(n)">Cerrar no conformidad</button></div></div>
    <h2 style="margin-top:1rem">Inspecciones de cierre</h2>
    <div v-if="!insp.length" class="empty">No hay inspecciones. Un supervisor las programa desde la pestaña Agenda.</div>
    <div v-else class="card"><div v-for="a in insp" :key="a.id" class="list-item row"><div class="grow"><b>{{ a.typeName }}</b> · {{ a.professionalName }}<div class="small muted">{{ fmtDateTime(a.startAt) }}</div></div>
      <StatusBadge v-if="a.result" :value="a.result === 'aprobada' ? 'aprobada' : 'con_observaciones'" /><StatusBadge v-else :value="a.status" /><span class="small muted">{{ a.resultNotes }}</span></div></div>
    <AppModal v-if="show" title="Registrar no conformidad" @close="show = false">
      <form class="stack-sm" @submit.prevent="create">
        <div class="field"><label>Título</label><input v-model="f.title" required minlength="3" /></div><div class="field"><label>Descripción</label><textarea v-model="f.description" /></div>
        <div class="field"><label>Severidad</label><select v-model="f.severity"><option v-for="s in ['baja','media','alta','critica']" :key="s" :value="s">{{ label(PRIORITY_LABEL, s) }}</option></select></div>
        <div class="field"><label>Fotos (obligatorio)</label><input type="file" accept="image/*,.pdf" multiple required @change="files = Array.from(($event.target as HTMLInputElement).files ?? [])" /></div>
        <label class="row"><input v-model="f.createTask" type="checkbox" /> Crear tarea correctiva</label>
        <template v-if="f.createTask"><div class="grid g2"><div class="field"><label>Especialidad</label><select v-model="f.specialty"><option v-for="s in SPECIALTIES" :key="s" :value="s">{{ label(SPECIALTY_LABEL, s) }}</option></select></div><div class="field"><label>Vence</label><input v-model="f.dueDate" type="date" /></div></div>
          <div class="field"><label>Asignar a</label><select v-model="f.assigneeId"><option value="">Sin asignar</option><option v-for="m in assignable" :key="m.userId" :value="m.userId">{{ m.name }} — {{ label(ROLE_LABEL, m.role) }}</option></select></div></template>
        <button class="btn primary">Registrar</button>
      </form>
    </AppModal>
  </div>
</template>
