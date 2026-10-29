<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast(); const route = useRoute(); const s = useSession()
const month = ref(todayStr().slice(0, 7)); const appts = ref<any[]>([]); const types = ref<any[]>([]); const members = ref<any[]>([]); const tasks = ref<any[]>([])
const filt = reactive({ specialty: '', professionalId: '' })
const canBook = computed(() => can(props.project.myRole, 'appt.book'))
const canInsp = computed(() => can(props.project.myRole, 'inspection.manage'))
const book = reactive<any>({ typeId: '', professionalId: '', date: addDaysStr(todayStr(), 1), startAt: '', taskId: route.query.task ? String(route.query.task) : '', kind: 'visita', notes: '' })
const slots = ref<any[]>([]); const slotInfo = ref(''); const sel = ref<any>(null); const reason = ref(''); const moveAt = ref(''); const moveSlots = ref<any[]>([]); const resultForm = reactive({ result: 'aprobada', notes: '' })
async function load() {
  appts.value = await api(`/projects/${props.project.id}/appointments`, { query: { month: month.value, specialty: filt.specialty, professionalId: filt.professionalId } })
}
onMounted(async () => {
  types.value = await api('/appointment-types'); members.value = await api(`/projects/${props.project.id}/members`)
  if (canBook.value) tasks.value = await api(`/projects/${props.project.id}/tasks`)
  load()
})
watch([month, filt], load)
const typeObj = computed(() => types.value.find((t) => t.id === Number(book.typeId)))
const profs = computed(() => members.value.filter((m) => typeObj.value && (typeObj.value.specialty === 'gestion' || roleSpecialty(m.role) === typeObj.value.specialty)))
watch(() => book.typeId, () => { book.professionalId = ''; slots.value = [] })
async function findSlots() {
  slots.value = []; book.startAt = ''; slotInfo.value = ''
  if (!book.typeId || !book.professionalId) return
  try { const r = await api('/slots', { query: { professionalId: book.professionalId, typeId: book.typeId, from: book.date, to: book.date } }); slots.value = r.slots; slotInfo.value = r.slots.length ? '' : 'Sin horarios libres ese día. Prueba otra fecha.' } catch (e: any) { slotInfo.value = e.message }
}
watch(() => [book.professionalId, book.date, book.typeId], findSlots)
async function reserve() {
  try {
    await api('/appointments', { body: { projectId: props.project.id, typeId: Number(book.typeId), professionalId: Number(book.professionalId), startAt: book.startAt, taskId: book.taskId ? Number(book.taskId) : null, kind: book.kind, notes: book.notes || undefined } })
    toast.push('Cita agendada'); book.startAt = ''; book.notes = ''; findSlots(); load()
  } catch (e) { toast.error(e) }
}
// calendario mensual
const days = computed(() => {
  const first = new Date(`${month.value}-01T12:00:00-05:00`); const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(first.getTime() - lead * 86400_000); const out = []
  for (let i = 0; i < 42; i++) { const d = new Date(start.getTime() + i * 86400_000); const key = localDay(d); out.push({ key, n: Number(key.slice(8)), out: key.slice(0, 7) !== month.value, today: key === todayStr() }) }
  return out
})
const byDay = (k: string) => appts.value.filter((a) => localDay(a.startAt) === k)
const shift = (n: number) => { const d = new Date(`${month.value}-15T12:00:00-05:00`); d.setUTCMonth(d.getUTCMonth() + n); month.value = localDay(d).slice(0, 7) }
const monthLabel = computed(() => { const l = new Date(`${month.value}-15T12:00:00-05:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).replace(' de ', ' '); return l[0].toUpperCase() + l.slice(1) })
const mayManage = (a: any) => a.status === 'confirmada' && (a.professionalId === s.user.value?.id || a.requestedBy === s.user.value?.id || ['administrador', 'supervisor'].includes(props.project.myRole))
async function cancel() { try { await api(`/appointments/${sel.value.id}/cancel`, { body: { reason: reason.value } }); toast.push('Cita cancelada'); sel.value = null; reason.value = ''; load() } catch (e) { toast.error(e) } }
async function loadMoveSlots() {
  moveSlots.value = []; if (!moveAt.value) return
  try { moveSlots.value = (await api('/slots', { query: { professionalId: sel.value.professionalId, typeId: sel.value.typeId, from: moveAt.value, to: moveAt.value } })).slots } catch (e) { toast.error(e) }
}
async function move(startAt: string) { try { await api(`/appointments/${sel.value.id}/reschedule`, { body: { startAt } }); toast.push('Cita reprogramada'); sel.value = null; load() } catch (e) { toast.error(e) } }
async function saveResult() { try { await api(`/appointments/${sel.value.id}/result`, { body: resultForm }); toast.push('Resultado registrado'); sel.value = null; load() } catch (e) { toast.error(e) } }
</script>
<template>
  <div class="stack">
    <div class="grid g2" style="align-items:start">
      <div class="card stack-sm">
        <div class="row between"><div class="row"><button class="btn sm" aria-label="Mes anterior" @click="shift(-1)">‹</button><b style="min-width:130px;text-align:center">{{ monthLabel }}</b><button class="btn sm" aria-label="Mes siguiente" @click="shift(1)">›</button></div>
          <div class="row"><select v-model="filt.specialty" class="inline"><option value="">Todas</option><option v-for="sp in SPECIALTIES" :key="sp" :value="sp">{{ label(SPECIALTY_LABEL, sp) }}</option></select>
            <select v-if="can(project.myRole, 'task.viewAll') || canBook" v-model="filt.professionalId" class="inline"><option value="">Todos</option><option v-for="m in members" :key="m.userId" :value="m.userId">{{ m.name }}</option></select></div></div>
        <div class="cal"><div v-for="d in ['L','M','X','J','V','S','D']" :key="d" class="dow">{{ d }}</div>
          <div v-for="d in days" :key="d.key" class="cell" :class="{ out: d.out, today: d.today }"><b>{{ d.n }}</b>
            <button v-for="a in byDay(d.key)" :key="a.id" class="ev" :class="{ insp: a.kind === 'inspeccion', cancelada: a.status === 'cancelada' }" :title="`${a.typeName} · ${a.professionalName}`" @click="sel = a; moveAt = ''; moveSlots = []">{{ fmtTime(a.startAt) }} {{ a.professionalName.split(' ')[0] }}</button></div></div>
        <div v-if="!appts.length" class="muted small">Sin citas este mes{{ filt.specialty || filt.professionalId ? ' con estos filtros' : '' }}.</div>
      </div>
      <form v-if="canBook" class="card stack-sm" @submit.prevent="reserve">
        <h2>Agendar visita o inspección</h2>
        <div class="field"><label>Tipo de cita</label><select v-model="book.typeId" required><option value="" disabled>Selecciona…</option><option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }} ({{ t.durationMin }} min)</option></select></div>
        <div class="grid g2"><div class="field"><label>Profesional</label><select v-model="book.professionalId" required :disabled="!book.typeId"><option value="" disabled>Selecciona…</option><option v-for="m in profs" :key="m.userId" :value="m.userId">{{ m.name }}</option></select></div>
          <div class="field"><label>Fecha</label><input v-model="book.date" type="date" :min="todayStr()" required /></div></div>
        <div class="field"><label>Horarios libres (hora de Colombia)</label>
          <div class="slots"><button v-for="sl in slots" :key="sl.start" type="button" class="slot" :class="{ on: book.startAt === sl.start }" @click="book.startAt = sl.start">{{ fmtTime(sl.start) }}</button></div>
          <div v-if="slotInfo" class="small muted">{{ slotInfo }}</div><div v-else-if="!slots.length" class="small muted">Elige tipo, profesional y fecha.</div></div>
        <div class="grid g2"><div class="field"><label>Tarea relacionada (opcional)</label><select v-model="book.taskId"><option value="">Ninguna</option><option v-for="t in tasks" :key="t.id" :value="t.id">#{{ t.id }} {{ t.title }}</option></select></div>
          <div class="field"><label>Tipo</label><select v-model="book.kind"><option value="visita">Visita técnica</option><option v-if="canInsp" value="inspeccion">Inspección de cierre</option></select></div></div>
        <div class="field"><label>Notas</label><input v-model="book.notes" /></div>
        <button class="btn primary" :disabled="!book.startAt">Reservar</button>
      </form>
      <div v-else class="card muted">Ves las citas en las que participas. Las reservas las hacen supervisores, colaboradores y roles técnicos.</div>
    </div>
    <AppModal v-if="sel" :title="sel.typeName ?? 'Cita'" @close="sel = null">
      <div class="stack-sm">
        <div><b>{{ fmtDateTime(sel.startAt) }} – {{ fmtTime(sel.endAt) }}</b> <StatusBadge :value="sel.status" /> <span v-if="sel.kind === 'inspeccion'" class="badge b-alta">Inspección</span></div>
        <div>Profesional: {{ sel.professionalName }} · Solicitó: {{ sel.requesterName }}</div>
        <div v-if="sel.taskTitle">Tarea: <NuxtLink :to="`/tareas/${sel.taskId}`">{{ sel.taskTitle }}</NuxtLink></div>
        <div v-if="sel.notes" class="muted">{{ sel.notes }}</div>
        <div v-if="sel.cancelReason" class="alert error">Cancelada: {{ sel.cancelReason }}</div>
        <div v-if="sel.result" class="alert" :class="sel.result === 'aprobada' ? 'ok' : ''">Resultado: {{ sel.result === 'aprobada' ? 'Aprobada' : 'Con observaciones' }} {{ sel.resultNotes }}</div>
        <template v-if="mayManage(sel)">
          <hr /><h3>Reprogramar</h3>
          <div class="row"><input v-model="moveAt" type="date" class="inline" :min="todayStr()" @change="loadMoveSlots" /><div class="slots"><button v-for="sl in moveSlots" :key="sl.start" class="slot" @click="move(sl.start)">{{ fmtTime(sl.start) }}</button></div></div>
          <h3>Cancelar</h3><div class="row"><input v-model="reason" class="grow" placeholder="Motivo (obligatorio)" /><button class="btn danger" :disabled="reason.trim().length < 3" @click="cancel">Cancelar cita</button></div>
        </template>
        <template v-if="sel.kind === 'inspeccion' && sel.status === 'confirmada' && can(project.myRole, 'inspection.result')">
          <hr /><h3>Resultado de la inspección</h3>
          <select v-model="resultForm.result"><option value="aprobada">Aprobada</option><option value="con_observaciones">Con observaciones</option></select>
          <textarea v-model="resultForm.notes" placeholder="Observaciones (obligatorio si hay observaciones)" /><button class="btn primary" @click="saveResult">Registrar resultado</button>
        </template>
      </div>
    </AppModal>
  </div>
</template>
