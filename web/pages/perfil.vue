<script setup lang="ts">
const toast = useToast()
const p = ref<any>(null); const cert = reactive({ name: '', number: '', expiresAt: '' })
async function load() { p.value = await api('/profile') }
async function save() {
  try { p.value = await api('/profile', { method: 'PUT', body: { name: p.value.name, specialty: p.value.specialty || null, zone: p.value.zone, phone: p.value.phone, bio: p.value.bio } }); toast.push('Perfil guardado') } catch (e) { toast.error(e) }
}
async function photo(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return
  const fd = new FormData(); fd.append('file', f)
  try { await api('/profile/photo', { form: fd }); toast.push('Foto actualizada'); load() } catch (er) { toast.error(er) }
}
async function addCert() {
  try { await api('/certifications', { body: cert }); Object.assign(cert, { name: '', number: '', expiresAt: '' }); toast.push('Certificación registrada: queda pendiente de verificación'); load() } catch (e) { toast.error(e) }
}
async function delCert(id: number) { if (confirm('¿Eliminar esta certificación?')) { await api(`/certifications/${id}`, { method: 'DELETE' }); load() } }
onMounted(load)
</script>
<template>
  <div v-if="p" class="stack">
    <h1>Mi perfil</h1>
    <div class="grid g2">
      <form class="card" @submit.prevent="save">
        <div class="row" style="margin-bottom:.8rem">
          <img v-if="p.photoFileId" :src="`/api/files/${p.photoFileId}`" alt="Foto de perfil" style="width:64px;height:64px;border-radius:99px;object-fit:cover" />
          <div v-else class="brand-mark" style="width:64px;height:64px;border-radius:99px;font-size:1.4rem">{{ p.name[0] }}</div>
          <div><label class="btn sm" for="ph">Cambiar foto</label><input id="ph" type="file" accept="image/*" style="display:none" @change="photo" /></div>
        </div>
        <div class="field"><label>Nombre</label><input v-model="p.name" required /></div>
        <div class="field"><label>Correo</label><input :value="p.email" disabled /></div>
        <div class="field"><label>Especialidad</label>
          <select v-model="p.specialty"><option :value="null">—</option><option v-for="sp in SPECIALTIES" :key="sp" :value="sp">{{ label(SPECIALTY_LABEL, sp) }}</option></select></div>
        <div class="grid g2"><div class="field"><label>Zona de trabajo</label><input v-model="p.zone" /></div><div class="field"><label>Teléfono / WhatsApp</label><input v-model="p.phone" /></div></div>
        <div class="field"><label>Presentación</label><textarea v-model="p.bio" maxlength="500" /></div>
        <button class="btn primary">Guardar</button>
      </form>
      <div class="card stack">
        <h2>Certificaciones</h2>
        <div v-if="!p.certifications.length" class="empty">Sin certificaciones registradas.</div>
        <div v-for="c in p.certifications" :key="c.id" class="list-item row">
          <div class="grow"><b>{{ c.name }}</b><div class="small muted">N.º {{ c.number }} · vence {{ fmtDate(c.expiresAt) }}</div></div>
          <StatusBadge :value="c.effectiveStatus" /><button class="btn sm danger" @click="delCert(c.id)">Quitar</button>
        </div>
        <form class="stack-sm" @submit.prevent="addCert">
          <h3>Agregar certificación</h3>
          <div class="field"><label>Nombre</label><input v-model="cert.name" required /></div>
          <div class="grid g2"><div class="field"><label>Número</label><input v-model="cert.number" required /></div><div class="field"><label>Vence</label><input v-model="cert.expiresAt" type="date" required /></div></div>
          <button class="btn">Agregar</button>
        </form>
      </div>
    </div>
  </div>
</template>
