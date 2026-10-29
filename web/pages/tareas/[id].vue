<script setup lang="ts">
const route = useRoute(); const toast = useToast(); const s = useSession()
const id = computed(() => Number(route.params.id))
const t = ref<any>(null); const members = ref<any[]>([]); const comments = ref<any[]>([]); const projectTasks = ref<any[]>([]); const err = ref('')
const progress = reactive({ body: '' }); const progressFiles = ref<File[]>([]); const certFiles = ref<File[]>([])
const comment = ref(''); const reviewComment = ref(''); const depId = ref('')
const isManager = computed(() => ['administrador', 'supervisor'].includes(t.value?.myRole))
const canDeps = computed(() => ['administrador', 'supervisor', 'ingeniero_civil', 'arquitecto', 'plomero', 'electricista', 'soldador', 'topografo'].includes(t.value?.myRole))
const mine = computed(() => t.value?.assigneeId === s.user.value?.id)
async function load() {
  try {
    t.value = await api(`/tasks/${id.value}`)
    comments.value = await api('/comments', { query: { entity: 'task', id: id.value } })
    members.value = await api(`/projects/${t.value.projectId}/members`)
    if (canDeps.value) projectTasks.value = (await api(`/projects/${t.value.projectId}/tasks`)).filter((x: any) => x.id !== id.value)
  } catch (e: any) { err.value = e.message }
}
const assignable = computed(() => members.value.filter((m) => t.value.specialty === 'gestion' || m.specialtyRole === t.value.specialty || roleSpec(m.role) === t.value.specialty))
function roleSpec(role: string) { return ({ arquitecto: 'arquitectura', ingeniero_civil: 'ingenieria_civil', topografo: 'topografia', plomero: 'plomeria', electricista: 'electricidad', soldador: 'soldadura' } as any)[role] ?? 'gestion' }
async function act(fn: () => Promise<any>, ok: string) { try { await fn(); toast.push(ok); await load() } catch (e) { toast.error(e) } }
const setStatus = (status: string) => act(async () => {
  const r: any = await apiOrQueue(`/tasks/${id.value}/status`, { status }, `${t.value.title} → ${status}`)
  if (r.queued) { t.value.status = status; throw new Error('Sin conexión: el cambio se enviará al reconectar') }
}, 'Estado actualizado')
const review = (approve: boolean) => act(() => api(`/tasks/${id.value}/review`, { body: { approve, comment: reviewComment.value } }).then(() => { reviewComment.value = '' }), approve ? 'Tarea aprobada' : 'Tarea devuelta')
const assign = (v: string) => act(() => api(`/tasks/${id.value}/assign`, { body: { assigneeId: v ? Number(v) : null } }), 'Responsable actualizado')
const pick = (e: Event, which: 'progress' | 'cert') => { const files = Array.from((e.target as HTMLInputElement).files ?? []); if (which === 'progress') progressFiles.value = files; else certFiles.value = files }
const sendProgress = () => act(async () => {
  const fd = new FormData(); fd.append('body', progress.body); progressFiles.value.forEach((f) => fd.append('files', f))
  await api(`/tasks/${id.value}/progress`, { form: fd }); progress.body = ''; progressFiles.value = []
}, 'Avance registrado')
const sendCerts = () => act(async () => {
  const fd = new FormData(); certFiles.value.forEach((f) => fd.append('files', f)); await api(`/tasks/${id.value}/attachments`, { form: fd }); certFiles.value = []
}, 'Certificados adjuntos')
const addComment = () => act(async () => { await api('/comments', { body: { entity: 'task', entityId: id.value, body: comment.value } }); comment.value = '' }, 'Comentario enviado')
const addDep = () => act(async () => { await api(`/tasks/${id.value}/deps`, { body: { dependsOn: Number(depId.value) } }); depId.value = '' }, 'Dependencia agregada')
const delDep = (d: number) => act(() => api(`/tasks/${id.value}/deps/${d}`, { method: 'DELETE' }), 'Dependencia quitada')
onMounted(load)
</script>
<template>
  <div v-if="err" class="alert error">{{ err }} <NuxtLink to="/mis-tareas">Volver</NuxtLink></div>
  <div v-else-if="t" class="stack">
    <div class="small"><NuxtLink :to="`/proyectos/${t.projectId}?tab=tareas`">← {{ t.projectName }}</NuxtLink></div>
    <div class="row between"><div><h1>{{ t.title }}</h1><div class="row"><StatusBadge :value="t.status" /><StatusBadge :value="t.priority" kind="priority" /><StatusBadge :value="t.specialty" kind="specialty" />
      <span class="chip">Vence {{ fmtDate(t.dueDate) }}</span><span v-if="t.overdue" class="badge b-critica">Vencida</span><span v-if="t.phaseName" class="chip">{{ t.phaseName }}</span></div></div>
      <div class="row">
        <button v-if="t.status === 'pendiente' && (mine || isManager)" class="btn" :disabled="t.blocked" @click="setStatus('en_curso')">Iniciar</button>
        <button v-if="t.status === 'en_curso' && (mine || isManager)" class="btn primary" @click="setStatus('hecha')">Marcar hecha</button>
        <button v-if="t.status === 'en_curso' && (mine || isManager)" class="btn" @click="setStatus('pendiente')">Volver a pendiente</button>
      </div></div>
    <div v-if="t.blocked" class="alert">Bloqueada: espera a que terminen sus dependencias.</div>
    <div v-if="t.reviewComment && t.status !== 'aprobada'" class="alert">Comentario del supervisor: {{ t.reviewComment }}</div>
    <p v-if="t.description" class="card">{{ t.description }}</p>

    <div v-if="isManager && t.status === 'hecha'" class="card stack-sm">
      <h2>Revisión</h2><textarea v-model="reviewComment" placeholder="Comentario (obligatorio para rechazar)" />
      <div class="row"><button class="btn primary" @click="review(true)">Aprobar</button><button class="btn danger" @click="review(false)">Rechazar</button></div>
    </div>

    <div class="grid g2">
      <div class="card stack-sm">
        <h2>Responsable</h2>
        <div v-if="isManager && t.status !== 'aprobada'"><select :value="t.assigneeId ?? ''" @change="assign(($event.target as HTMLSelectElement).value)"><option value="">Sin asignar</option><option v-for="m in assignable" :key="m.userId" :value="m.userId">{{ m.name }} — {{ label(ROLE_LABEL, m.role) }}</option></select>
          <p class="small muted">Solo aparecen miembros con la especialidad {{ label(SPECIALTY_LABEL, t.specialty) }}.</p></div>
        <div v-else>{{ t.assigneeName ?? 'Sin asignar' }}</div>
        <h2 style="margin-top:1rem">Dependencias</h2>
        <div v-if="!t.deps.length" class="muted small">No depende de otras tareas.</div>
        <div v-for="d in t.deps" :key="d.id" class="row"><NuxtLink :to="`/tareas/${d.id}`" class="grow">{{ d.title }}</NuxtLink><StatusBadge :value="d.status" /><button v-if="canDeps" class="btn sm danger" @click="delDep(d.id)">Quitar</button></div>
        <form v-if="canDeps" class="row" @submit.prevent="addDep"><select v-model="depId" class="grow" required><option value="" disabled>Depende de…</option><option v-for="x in projectTasks" :key="x.id" :value="x.id">#{{ x.id }} {{ x.title }}</option></select><button class="btn">Agregar</button></form>
        <div v-if="t.dependents.length" class="small muted">Bloquea a: {{ t.dependents.map((d: any) => d.title).join(', ') }}</div>
      </div>
      <div class="card stack-sm">
        <h2>Citas</h2>
        <div v-if="!t.appointments.length" class="muted small">Sin citas ligadas. Agéndalas desde la pestaña Agenda del proyecto.</div>
        <div v-for="a in t.appointments" :key="a.id" class="row"><span class="grow">{{ fmtDateTime(a.startAt) }} · {{ a.professional }}</span><StatusBadge :value="a.status" /></div>
        <NuxtLink v-if="['administrador','supervisor','colaborador','arquitecto','ingeniero_civil'].includes(t.myRole)" class="btn sm" :to="`/proyectos/${t.projectId}?tab=agenda&task=${t.id}`">Agendar visita</NuxtLink>
        <h2 style="margin-top:1rem">Certificados y pruebas</h2>
        <div v-for="a in t.attachments.filter((x: any) => x.kind === 'certificado')" :key="a.id"><a :href="`/api/files/${a.id}`" target="_blank">📎 {{ a.filename }}</a> <span class="small muted">{{ fmtSize(a.size) }}</span></div>
        <form v-if="mine || isManager || ['ingeniero_civil','arquitecto'].includes(t.myRole)" class="row" @submit.prevent="sendCerts"><input type="file" multiple accept=".pdf,image/*" @change="pick($event, 'cert')" /><button class="btn sm" :disabled="!certFiles.length">Adjuntar</button></form>
      </div>
    </div>

    <div class="card stack-sm">
      <h2>Registrar avance</h2>
      <form class="stack-sm" @submit.prevent="sendProgress"><textarea v-model="progress.body" placeholder="¿Qué se hizo hoy?" /><input type="file" multiple accept="image/*" @change="pick($event, 'progress')" />
        <div class="small muted">Hasta 5 fotos de 10 MB.</div><button class="btn primary" :disabled="!progress.body && !progressFiles.length">Registrar avance</button></form>
      <div class="photos"><a v-for="a in t.attachments.filter((x: any) => x.kind === 'avance')" :key="a.id" :href="`/api/files/${a.id}`" target="_blank"><img :src="`/api/files/${a.id}`" :alt="a.filename" /></a></div>
    </div>

    <div class="grid g2">
      <div class="card"><h2>Historial</h2><div v-for="e in t.events" :key="e.id" class="list-item small"><b>{{ e.kind }}</b> · {{ e.user ?? 'Sistema' }} · <span class="muted">{{ fmtDateTime(e.createdAt) }}</span><div>{{ e.body }}</div></div></div>
      <div class="card stack-sm"><h2>Comentarios</h2>
        <div v-for="c in comments" :key="c.id" class="list-item small"><b>{{ c.author }}</b> <span class="muted">{{ fmtDateTime(c.createdAt) }}</span><div>{{ c.body }}</div></div>
        <form class="row" @submit.prevent="addComment"><input v-model="comment" class="grow" placeholder="Escribe un comentario. Usa @usuario para mencionar" required /><button class="btn">Enviar</button></form></div>
    </div>
  </div>
</template>
