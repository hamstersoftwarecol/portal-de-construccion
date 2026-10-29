<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast()
const members = ref<any[]>([]); const users = ref<any[]>([]); const invites = ref<any[]>([]); const newInvite = ref<any>(null)
const add = reactive({ userId: '', role: 'colaborador' }); const inv = reactive({ role: 'colaborador', email: '' })
const admin = computed(() => can(props.project.myRole, 'members.manage'))
async function load() {
  members.value = await api(`/projects/${props.project.id}/members`)
  if (admin.value) {
    invites.value = await api(`/projects/${props.project.id}/invites`)
    try { users.value = await api('/admin/users') } catch { users.value = [] }
  }
}
const candidates = computed(() => users.value.filter((u) => u.active && !members.value.some((m) => m.userId === u.id)))
async function run(fn: () => Promise<any>, ok: string) { try { await fn(); toast.push(ok); await load() } catch (e) { toast.error(e) } }
const addMember = () => run(() => api(`/projects/${props.project.id}/members`, { body: { userId: Number(add.userId), role: add.role } }).then(() => { add.userId = '' }), 'Miembro agregado')
const changeRole = (m: any, role: string) => run(() => api(`/projects/${props.project.id}/members/${m.userId}`, { method: 'PATCH', body: { role } }), 'Rol actualizado')
const remove = (m: any) => confirm(`¿Quitar a ${m.name} del proyecto? Sus tareas pendientes quedarán sin asignar.`) && run(() => api(`/projects/${props.project.id}/members/${m.userId}`, { method: 'DELETE' }), 'Miembro retirado')
const invite = () => run(async () => { newInvite.value = await api(`/projects/${props.project.id}/invites`, { body: { role: inv.role, email: inv.email || undefined } }) }, 'Invitación creada')
const full = (link: string) => location.origin + link
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="card scroll-x"><table class="table"><thead><tr><th>Persona</th><th>Rol en el proyecto</th><th>Especialidad</th><th>Contacto</th><th /></tr></thead><tbody>
      <tr v-for="m in members" :key="m.userId"><td><b>{{ m.name }}</b><div class="small muted">{{ m.email }}</div></td>
        <td><select v-if="admin" :value="m.role" class="inline" @change="changeRole(m, ($event.target as HTMLSelectElement).value)"><option v-for="r in ROLES" :key="r" :value="r">{{ label(ROLE_LABEL, r) }}</option></select><StatusBadge v-else :value="m.role" kind="role" /></td>
        <td>{{ label(SPECIALTY_LABEL, m.specialty) }}</td><td class="small">{{ m.zone }} {{ m.phone }}</td><td><button v-if="admin" class="btn sm danger" @click="remove(m)">Quitar</button></td></tr></tbody></table></div>
    <div v-if="admin" class="grid g2">
      <form class="card stack-sm" @submit.prevent="addMember"><h2>Agregar usuario existente</h2>
        <div class="field"><label>Usuario</label><select v-model="add.userId" required><option value="" disabled>Selecciona…</option><option v-for="u in candidates" :key="u.id" :value="u.id">{{ u.name }} ({{ u.email }})</option></select></div>
        <div class="field"><label>Rol</label><select v-model="add.role"><option v-for="r in ROLES" :key="r" :value="r">{{ label(ROLE_LABEL, r) }}</option></select></div><button class="btn primary">Agregar</button></form>
      <form class="card stack-sm" @submit.prevent="invite"><h2>Invitar con enlace</h2>
        <div class="grid g2"><div class="field"><label>Rol</label><select v-model="inv.role"><option v-for="r in ROLES" :key="r" :value="r">{{ label(ROLE_LABEL, r) }}</option></select></div><div class="field"><label>Correo (opcional)</label><input v-model="inv.email" type="email" /></div></div>
        <button class="btn primary">Generar invitación</button>
        <div v-if="newInvite" class="alert ok">Comparte este enlace (vence en {{ newInvite.expiresInDays }} días, un solo uso):<br /><code>{{ full(newInvite.link) }}</code></div>
        <div v-for="i in invites" :key="i.code" class="small list-item">{{ label(ROLE_LABEL, i.role) }} {{ i.email }} · <span v-if="i.usedAt">usada</span><span v-else>pendiente hasta {{ fmtDate(i.expiresAt) }}</span></div></form>
    </div>
  </div>
</template>
