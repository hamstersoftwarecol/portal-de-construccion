<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast()
const docs = ref<any[]>([]); const show = ref(false); const sel = ref<any>(null)
const form = reactive({ title: '', specialty: '', notes: '' }); const file = ref<File | null>(null); const verFile = ref<File | null>(null); const verNotes = ref(''); const comment = ref('')
const upload = computed(() => can(props.project.myRole, 'doc.upload')); const review = computed(() => can(props.project.myRole, 'doc.review'))
async function load() { docs.value = await api(`/projects/${props.project.id}/documents`) }
async function open(d: any) { try { sel.value = await api(`/documents/${d.id}`) } catch (e) { toast.error(e) } }
async function create() {
  const fd = new FormData(); fd.append('title', form.title); fd.append('specialty', form.specialty); fd.append('notes', form.notes); if (file.value) fd.append('file', file.value)
  try { await api(`/projects/${props.project.id}/documents`, { form: fd }); show.value = false; Object.assign(form, { title: '', notes: '' }); file.value = null; toast.push('Documento subido (versión 1)'); load() } catch (e) { toast.error(e) }
}
async function newVersion() {
  const fd = new FormData(); fd.append('notes', verNotes.value); if (verFile.value) fd.append('file', verFile.value)
  try { const r = await api(`/documents/${sel.value.id}/versions`, { form: fd }); toast.push(`Versión ${r.version} subida`); verNotes.value = ''; verFile.value = null; await open(sel.value); load() } catch (e) { toast.error(e) }
}
async function status(s: string) { try { await api(`/documents/${sel.value.id}/status`, { body: { status: s } }); toast.push('Estado actualizado'); await open(sel.value); load() } catch (e) { toast.error(e) } }
async function sendComment() { try { await api(`/documents/${sel.value.id}/comments`, { body: { body: comment.value, version: sel.value.latestVersion } }); comment.value = ''; open(sel.value) } catch (e) { toast.error(e) } }
async function del() { if (confirm('¿Eliminar el documento y todas sus versiones?')) { await api(`/documents/${sel.value.id}`, { method: 'DELETE' }); sel.value = null; load() } }
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="row between"><p class="muted" style="margin:0">Planos y documentos con versiones. Cada rol ve lo general y lo de su especialidad.</p><button v-if="upload" class="btn primary" @click="show = true">+ Subir documento</button></div>
    <div v-if="!docs.length" class="empty">No hay documentos visibles para tu rol.</div>
    <div v-else class="card scroll-x"><table class="table"><thead><tr><th>Documento</th><th>Especialidad</th><th>Versión</th><th>Estado</th><th>Autor</th></tr></thead><tbody>
      <tr v-for="d in docs" :key="d.id"><td><a href="#" class="task-link" @click.prevent="open(d)">{{ d.title }}</a></td><td>{{ d.specialty ? label(SPECIALTY_LABEL, d.specialty) : 'General' }}</td><td>v{{ d.latestVersion }}</td><td><StatusBadge :value="d.status" /></td><td>{{ d.author }}</td></tr></tbody></table></div>
    <AppModal v-if="show" title="Subir documento" @close="show = false">
      <form class="stack-sm" @submit.prevent="create">
        <div class="field"><label>Título</label><input v-model="form.title" required minlength="3" /></div>
        <div class="field"><label>Visible para</label><select v-model="form.specialty"><option value="">Todo el proyecto</option><option v-for="s in SPECIALTIES" :key="s" :value="s">Solo {{ label(SPECIALTY_LABEL, s) }} (y roles técnicos)</option></select></div>
        <div class="field"><label>Archivo (PDF, DWG, DXF, imagen; máx. 50 MB)</label><input type="file" accept=".pdf,.dwg,.dxf,image/*" required @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></div>
        <div class="field"><label>Notas de la versión</label><input v-model="form.notes" /></div><button class="btn primary">Subir</button>
      </form>
    </AppModal>
    <AppModal v-if="sel" :title="sel.title" @close="sel = null">
      <div class="stack-sm">
        <div class="row"><StatusBadge :value="sel.status" /><span class="muted small">{{ sel.specialty ? label(SPECIALTY_LABEL, sel.specialty) : 'General' }} · {{ sel.author }}</span></div>
        <h3>Versiones</h3>
        <div v-for="v in sel.versions" :key="v.version" class="list-item row"><div class="grow"><b>v{{ v.version }}</b> · {{ v.filename }} <span class="small muted">({{ fmtSize(v.size) }})</span><div class="small muted">{{ v.author }} · {{ fmtDateTime(v.createdAt) }} {{ v.notes }}</div></div><a class="btn sm" :href="`/api/files/${v.attachmentId}`" target="_blank">Abrir</a></div>
        <div class="row">
          <button v-if="sel.status === 'borrador' && upload" class="btn" @click="status('en_revision')">Enviar a revisión</button>
          <button v-if="sel.status === 'en_revision' && review" class="btn primary" @click="status('aprobado')">Aprobar</button>
          <button v-if="['en_revision', 'aprobado'].includes(sel.status) && review" class="btn" @click="status('borrador')">Devolver a borrador</button>
          <button v-if="can(project.myRole, 'members.manage')" class="btn danger" @click="del">Eliminar</button></div>
        <form v-if="upload" class="stack-sm" @submit.prevent="newVersion"><h3>Subir nueva versión</h3><input type="file" accept=".pdf,.dwg,.dxf,image/*" required @change="verFile = ($event.target as HTMLInputElement).files?.[0] ?? null" /><input v-model="verNotes" placeholder="¿Qué cambió?" /><button class="btn">Subir versión</button></form>
        <h3>Comentarios</h3>
        <div v-for="c in sel.comments" :key="c.id" class="small list-item"><b>{{ c.author }}</b> <span class="muted">{{ c.version ? `v${c.version} · ` : '' }}{{ fmtDateTime(c.createdAt) }}</span><div>{{ c.body }}</div></div>
        <form class="row" @submit.prevent="sendComment"><input v-model="comment" class="grow" placeholder="Comentar la versión actual" required /><button class="btn">Enviar</button></form>
      </div>
    </AppModal>
  </div>
</template>
