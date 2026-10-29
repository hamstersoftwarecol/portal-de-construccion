<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast()
const rows = ref<any[]>([]); const show = ref(false); const files = ref<File[]>([])
const f = reactive({ kind: 'replanteo', title: '', x: '', y: '', level: '', notes: '' })
const write = computed(() => can(props.project.myRole, 'survey.write'))
async function load() { rows.value = await api(`/projects/${props.project.id}/survey`) }
async function save() {
  const fd = new FormData(); Object.entries(f).forEach(([k, v]) => fd.append(k, String(v))); files.value.forEach((x) => fd.append('files', x))
  try { await api(`/projects/${props.project.id}/survey`, { form: fd }); show.value = false; Object.assign(f, { title: '', x: '', y: '', level: '', notes: '' }); files.value = []; toast.push('Registro guardado'); load() } catch (e) { toast.error(e) }
}
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="row between"><p class="muted" style="margin:0">Levantamientos, replanteos y niveles con coordenadas y archivos adjuntos.</p><button v-if="write" class="btn primary" @click="show = true">+ Nuevo registro</button></div>
    <div v-if="!rows.length" class="empty">Aún no hay registros topográficos.</div>
    <div v-else class="card scroll-x"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Título</th><th>X</th><th>Y</th><th>Nivel (m)</th><th>Archivos</th><th>Autor</th></tr></thead><tbody>
      <tr v-for="r in rows" :key="r.id"><td class="small">{{ fmtDate(r.createdAt) }}</td><td><span class="chip">{{ r.kind }}</span></td><td><b>{{ r.title }}</b><div class="small muted">{{ r.notes }}</div></td><td>{{ r.x }}</td><td>{{ r.y }}</td><td>{{ r.level }}</td>
        <td><div v-for="a in r.files" :key="a.id"><a :href="`/api/files/${a.id}`" target="_blank">📎 {{ a.filename }}</a></div></td><td>{{ r.author }}</td></tr></tbody></table></div>
    <AppModal v-if="show" title="Nuevo registro topográfico" @close="show = false">
      <form class="stack-sm" @submit.prevent="save">
        <div class="grid g2"><div class="field"><label>Tipo</label><select v-model="f.kind"><option value="levantamiento">Levantamiento</option><option value="replanteo">Replanteo</option><option value="nivel">Nivel</option></select></div><div class="field"><label>Título</label><input v-model="f.title" required minlength="3" /></div>
          <div class="field"><label>Coordenada X (este)</label><input v-model="f.x" type="number" step="any" required /></div><div class="field"><label>Coordenada Y (norte)</label><input v-model="f.y" type="number" step="any" required /></div>
          <div class="field"><label>Nivel / cota (m)</label><input v-model="f.level" type="number" step="any" required /></div></div>
        <div class="field"><label>Notas</label><textarea v-model="f.notes" /></div>
        <div class="field"><label>Archivos (CSV, PDF, DWG, DXF, imágenes)</label><input type="file" multiple @change="files = Array.from(($event.target as HTMLInputElement).files ?? [])" /></div>
        <button class="btn primary">Guardar</button>
      </form>
    </AppModal>
  </div>
</template>
