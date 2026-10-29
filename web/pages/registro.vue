<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const s = useSession(); const route = useRoute()
const form = reactive({ name: '', email: '', password: '', code: String(route.query.codigo ?? '') })
const invite = ref<any>(null); const err = ref(''); const busy = ref(false)
async function check() {
  invite.value = null
  if (!form.code) return
  try { invite.value = await api(`/invites/${form.code}`); if (invite.value.email) form.email = invite.value.email } catch (e: any) { err.value = e.message }
}
onMounted(check)
async function submit() {
  busy.value = true; err.value = ''
  try { await api('/auth/register', { body: { ...form, code: form.code || undefined } }); await s.load(); navigateTo('/') } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
</script>
<template>
  <form class="stack" @submit.prevent="submit">
    <h1>Crear cuenta</h1>
    <div v-if="invite" class="alert ok">Te invitaron al proyecto <b>{{ invite.project }}</b> como <b>{{ label(ROLE_LABEL, invite.role) }}</b>.</div>
    <div v-if="err" class="alert error" role="alert">{{ err }}</div>
    <div class="field"><label for="n">Nombre completo</label><input id="n" v-model="form.name" required minlength="2" /></div>
    <div class="field"><label for="e">Correo</label><input id="e" v-model="form.email" type="email" required :readonly="!!invite?.email" /></div>
    <div class="field"><label for="p">Contraseña (mínimo 8)</label><input id="p" v-model="form.password" type="password" minlength="8" required autocomplete="new-password" /></div>
    <div class="field"><label for="c">Código de invitación (opcional)</label><input id="c" v-model="form.code" @change="check" /></div>
    <button class="btn primary" :disabled="busy">Registrarme</button>
    <NuxtLink to="/login" class="small">Ya tengo cuenta</NuxtLink>
  </form>
</template>
