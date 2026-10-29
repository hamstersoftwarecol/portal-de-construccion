<script setup lang="ts">
const toast = useToast(); const route = useRoute()
const tab = ref(String(route.query.tab ?? 'usuarios'))
const users = ref<any[]>([]); const types = ref<any[]>([]); const certs = ref<any[]>([]); const audit = ref<any[]>([]); const settings = ref<any>(null); const outbox = ref<any[]>([])
const auditAction = ref(''); const resetInfo = ref<any>(null)
const tForm = reactive({ id: 0, name: '', specialty: 'electricidad', durationMin: 60, calendlyUri: '' })
async function load() {
  try {
    if (tab.value === 'usuarios') users.value = await api('/admin/users')
    if (tab.value === 'citas') types.value = await api('/appointment-types')
    if (tab.value === 'certificaciones') certs.value = await api('/admin/certifications')
    if (tab.value === 'auditoria') audit.value = await api('/admin/audit', { query: { limit: 200, action: auditAction.value } })
    if (tab.value === 'integraciones') { settings.value = await api('/admin/settings'); outbox.value = await api('/admin/outbox') }
  } catch (e) { toast.error(e) }
}
watch([tab, auditAction], load); onMounted(load)
async function patchUser(u: any, body: any) { try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); load() } catch (e) { toast.error(e) } }
async function reset(u: any) { try { resetInfo.value = { user: u.name, ...(await api(`/admin/users/${u.id}/reset-code`, { method: 'POST' })) } } catch (e) { toast.error(e) } }
async function saveType() {
  const body = { name: tForm.name, specialty: tForm.specialty, durationMin: Number(tForm.durationMin), calendlyUri: tForm.calendlyUri || null }
  try { tForm.id ? await api(`/appointment-types/${tForm.id}`, { method: 'PUT', body }) : await api('/appointment-types', { body }); Object.assign(tForm, { id: 0, name: '', calendlyUri: '' }); toast.push('Tipo de cita guardado'); load() } catch (e) { toast.error(e) }
}
const editType = (t: any) => Object.assign(tForm, { id: t.id, name: t.name, specialty: t.specialty, durationMin: t.durationMin, calendlyUri: t.calendlyUri ?? '' })
async function delType(t: any) { if (confirm(`¿Eliminar "${t.name}"?`)) try { await api(`/appointment-types/${t.id}`, { method: 'DELETE' }); load() } catch (e) { toast.error(e) } }
async function review(c: any, status: string) { try { await api(`/certifications/${c.id}/review`, { method: 'PATCH', body: { status } }); load() } catch (e) { toast.error(e) } }
async function saveSettings(body: any) { try { await api('/admin/settings', { method: 'PUT', body }); toast.push('Ajustes guardados'); load() } catch (e) { toast.error(e) } }
const channels = computed({ get: () => settings.value?.notifyChannels ?? [], set: (v: string[]) => saveSettings({ notifyChannels: v }) })
function toggleChannel(ch: string) { const cur = new Set<string>(channels.value); cur.has(ch) ? cur.delete(ch) : cur.add(ch); channels.value = [...cur] }
async function connectCalendly() { try { const r = await api('/integrations/calendly/connect'); location.href = r.url } catch (e) { toast.error(e) } }
async function backup() { try { const r = await api('/admin/backup', { method: 'POST' }); toast.push(`Copia creada (${Math.round(r.bytes / 1024)} KB): ${r.file}`) } catch (e) { toast.error(e) } }
const tabs = [['usuarios', 'Usuarios'], ['citas', 'Tipos de cita'], ['certificaciones', 'Certificaciones'], ['auditoria', 'Auditoría'], ['integraciones', 'Integraciones y respaldo']]
</script>
<template>
  <div class="stack">
    <h1>Administración</h1>
    <div class="tabs"><button v-for="t in tabs" :key="t[0]" :class="{ on: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button></div>

    <div v-if="tab === 'usuarios'" class="card scroll-x">
      <div v-if="resetInfo" class="alert ok" style="margin-bottom:1rem">Código para <b>{{ resetInfo.user }}</b>: <code>{{ resetInfo.code }}</code> (válido {{ resetInfo.expiresInHours }} h, un solo uso). Enlace: <code>{{ resetInfo.link }}</code></div>
      <table class="table"><thead><tr><th>Nombre</th><th>Correo</th><th>Proyectos / rol</th><th>Estado</th><th /></tr></thead><tbody>
        <tr v-for="u in users" :key="u.id"><td><b>{{ u.name }}</b> <span v-if="u.isAdmin" class="badge b-alta">Admin del portal</span></td><td>{{ u.email }}</td>
          <td><div v-for="m in u.memberships" :key="m.projectId" class="small">{{ m.project }}: {{ label(ROLE_LABEL, m.role) }}</div></td>
          <td><StatusBadge :value="u.active ? 'confirmada' : 'cancelada'" /> {{ u.active ? 'Activo' : 'Desactivado' }}</td>
          <td class="row"><button class="btn sm" @click="reset(u)">Código de acceso</button><button class="btn sm" @click="patchUser(u, { active: !u.active })">{{ u.active ? 'Desactivar' : 'Activar' }}</button><button class="btn sm" @click="patchUser(u, { isAdmin: !u.isAdmin })">{{ u.isAdmin ? 'Quitar admin' : 'Hacer admin' }}</button></td></tr>
      </tbody></table>
    </div>

    <div v-if="tab === 'citas'" class="grid g2">
      <div class="card"><table class="table"><thead><tr><th>Tipo</th><th>Especialidad</th><th>Duración</th><th /></tr></thead><tbody>
        <tr v-for="t in types" :key="t.id"><td>{{ t.name }}</td><td>{{ label(SPECIALTY_LABEL, t.specialty) }}</td><td>{{ t.durationMin }} min</td><td class="row"><button class="btn sm" @click="editType(t)">Editar</button><button class="btn sm danger" @click="delType(t)">Eliminar</button></td></tr></tbody></table></div>
      <form class="card" @submit.prevent="saveType"><h2>{{ tForm.id ? 'Editar tipo' : 'Nuevo tipo de cita' }}</h2>
        <div class="field"><label>Nombre</label><input v-model="tForm.name" required /></div>
        <div class="grid g2"><div class="field"><label>Especialidad</label><select v-model="tForm.specialty"><option v-for="s in SPECIALTIES" :key="s" :value="s">{{ label(SPECIALTY_LABEL, s) }}</option></select></div><div class="field"><label>Duración (min)</label><input v-model="tForm.durationMin" type="number" min="15" max="480" step="15" required /></div></div>
        <div class="field"><label>Evento de Calendly (opcional, para uso futuro)</label><input v-model="tForm.calendlyUri" placeholder="https://api.calendly.com/event_types/…" /></div>
        <div class="row"><button class="btn primary">Guardar</button><button v-if="tForm.id" type="button" class="btn" @click="Object.assign(tForm, { id: 0, name: '' })">Cancelar</button></div></form>
    </div>

    <div v-if="tab === 'certificaciones'" class="card scroll-x"><div v-if="!certs.length" class="empty">Sin certificaciones registradas.</div>
      <table v-else class="table"><thead><tr><th>Profesional</th><th>Certificación</th><th>N.º</th><th>Vence</th><th>Estado</th><th /></tr></thead><tbody>
        <tr v-for="c in certs" :key="c.id"><td>{{ c.user }}<div class="small muted">{{ label(SPECIALTY_LABEL, c.specialty) }}</div></td><td>{{ c.name }}</td><td>{{ c.number }}</td><td>{{ fmtDate(c.expiresAt) }}</td><td><StatusBadge :value="c.status" /></td>
          <td class="row"><button class="btn sm" @click="review(c, 'verificada')">Verificar</button><button class="btn sm danger" @click="review(c, 'rechazada')">Rechazar</button></td></tr></tbody></table></div>

    <div v-if="tab === 'auditoria'" class="stack-sm"><select v-model="auditAction" class="inline"><option value="">Todas las acciones</option><option v-for="a in ['role_change','member_add','member_remove','task_approve','task_reject','doc_aprobado','delete','reset_code','invite_create','appt_cancel','inspection_result','cert_review','user_update']" :key="a" :value="a">{{ a }}</option></select>
      <div class="card scroll-x"><table class="table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>
        <tr v-for="r in audit" :key="r.id"><td class="small">{{ fmtDateTime(r.createdAt) }}</td><td>{{ r.user ?? '—' }}</td><td><code>{{ r.action }}</code></td><td>{{ r.entity }} #{{ r.entityId }}</td><td class="small muted">{{ r.detail }}</td></tr></tbody></table></div></div>

    <div v-if="tab === 'integraciones' && settings" class="grid g2">
      <div class="card stack">
        <h2>Agendamiento</h2>
        <p>Proveedor activo: <b>{{ settings.schedulingProvider === 'local' ? 'Agenda propia (local)' : 'Calendly' }}</b></p>
        <p class="small muted">La agenda propia no necesita cuentas externas. Calendly se activa solo cuando está conectado; si se desconecta, el portal vuelve a la agenda local.</p>
        <div class="row">
          <button class="btn" :disabled="settings.schedulingProvider === 'local'" @click="saveSettings({ schedulingProvider: 'local' })">Usar agenda propia</button>
          <button class="btn" :disabled="!settings.calendlyConnected || settings.schedulingProvider === 'calendly'" @click="saveSettings({ schedulingProvider: 'calendly' })">Usar Calendly</button>
          <button v-if="settings.calendlyOAuthAvailable" class="btn" @click="connectCalendly">Conectar Calendly (OAuth)</button>
        </div>
        <div class="small muted">Calendly: {{ settings.calendlyConnected ? 'conectado' : 'no conectado (define CALENDLY_TOKEN o CALENDLY_CLIENT_ID/SECRET en el entorno)' }}</div>
      </div>
      <div class="card stack">
        <h2>Canales de notificación</h2>
        <label class="row"><input type="checkbox" checked disabled /> En el portal (siempre)</label>
        <label class="row"><input type="checkbox" :checked="channels.includes('email')" @change="toggleChannel('email')" /> Correo (SMTP_URL)</label>
        <label class="row"><input type="checkbox" :checked="channels.includes('whatsapp')" @change="toggleChannel('whatsapp')" /> WhatsApp (WHATSAPP_TOKEN)</label>
        <p class="small muted">Sin credenciales los mensajes quedan en la bandeja de salida local.</p>
      </div>
      <div class="card stack"><h2>Respaldo</h2><p class="small muted">Base de datos: {{ settings.database }}. Crea una copia consistente en <code>data/backups</code>.</p><button class="btn primary" @click="backup">Crear copia de seguridad</button></div>
      <div class="card scroll-x"><h2>Bandeja de salida</h2><div v-if="!outbox.length" class="empty">Vacía</div>
        <table v-else class="table"><thead><tr><th>Canal</th><th>Para</th><th>Asunto</th><th>Estado</th></tr></thead><tbody><tr v-for="o in outbox" :key="o.id"><td>{{ o.channel }}</td><td>{{ o.toAddr }}</td><td>{{ o.subject }}</td><td>{{ o.status }}</td></tr></tbody></table></div>
    </div>
  </div>
</template>
