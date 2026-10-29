<script setup lang="ts">
const props = defineProps<{ project: any }>(); const emit = defineEmits<{ changed: [] }>()
const toast = useToast()
const comments = ref<any[]>([]); const text = ref(''); const editing = ref(false)
const form = reactive({ name: props.project.name, location: props.project.location, startDate: props.project.startDate, endDate: props.project.endDate, status: props.project.status })
async function load() { comments.value = await api('/comments', { query: { entity: 'project', id: props.project.id } }) }
async function send() { try { await api('/comments', { body: { entity: 'project', entityId: props.project.id, body: text.value } }); text.value = ''; load() } catch (e) { toast.error(e) } }
async function save() { try { await api(`/projects/${props.project.id}`, { method: 'PATCH', body: form }); editing.value = false; toast.push('Proyecto actualizado'); emit('changed') } catch (e) { toast.error(e) } }
const pct = computed(() => (props.project.tasks.total ? Math.round((props.project.tasks.done / props.project.tasks.total) * 100) : 0))
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="grid g4">
      <div class="card"><div class="kpi">{{ project.tasks.total }}</div><div class="kpi-l">Tareas</div></div>
      <div class="card"><div class="kpi">{{ project.tasks.approved }}</div><div class="kpi-l">Aprobadas</div></div>
      <div class="card"><div class="kpi">{{ project.team }}</div><div class="kpi-l">Personas</div></div>
      <div class="card"><div class="kpi">{{ pct }}%</div><div class="kpi-l">Avance (hechas o aprobadas)</div><div class="bar" style="margin-top:.4rem"><i :style="{ width: pct + '%' }" /></div></div>
    </div>
    <div v-if="can(project.myRole, 'members.manage')" class="row"><button class="btn" @click="editing = !editing">Editar proyecto</button></div>
    <form v-if="editing" class="card" @submit.prevent="save">
      <div class="grid g2"><div class="field"><label>Nombre</label><input v-model="form.name" required /></div><div class="field"><label>Ubicación</label><input v-model="form.location" required /></div>
        <div class="field"><label>Inicio</label><input v-model="form.startDate" type="date" /></div><div class="field"><label>Fin</label><input v-model="form.endDate" type="date" /></div>
        <div class="field"><label>Estado</label><select v-model="form.status"><option v-for="s in ['planificacion','en_ejecucion','pausado','terminado']" :key="s" :value="s">{{ label(STATUS_LABEL, s) }}</option></select></div></div>
      <button class="btn primary">Guardar</button>
    </form>
    <div class="card stack-sm"><h2>Conversación del proyecto</h2>
      <div v-if="!comments.length" class="empty">Sin mensajes. Usa @usuario (la parte del correo antes de la @) para mencionar a alguien.</div>
      <div v-for="c in comments" :key="c.id" class="list-item"><b>{{ c.author }}</b> <span class="small muted">{{ fmtDateTime(c.createdAt) }}</span><div>{{ c.body }}</div></div>
      <form class="row" @submit.prevent="send"><input v-model="text" class="grow" placeholder="Escribe un mensaje…" required /><button class="btn primary">Enviar</button></form></div>
  </div>
</template>
