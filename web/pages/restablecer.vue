<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const route = useRoute()
const form = reactive({ code: String(route.query.codigo ?? ''), password: '' }); const msg = ref(''); const err = ref('')
async function submit() {
  err.value = ''
  try { await api('/auth/reset', { body: form }); msg.value = 'Contraseña actualizada. Ya puedes iniciar sesión.' } catch (e: any) { err.value = e.message }
}
</script>
<template>
  <form class="stack" @submit.prevent="submit">
    <h1>Restablecer contraseña</h1>
    <p class="muted small">En modo local, el administrador genera un código temporal (válido 24 horas, un solo uso) desde Administración → Usuarios.</p>
    <div v-if="err" class="alert error" role="alert">{{ err }}</div><div v-if="msg" class="alert ok">{{ msg }}</div>
    <div class="field"><label for="c">Código</label><input id="c" v-model="form.code" required /></div>
    <div class="field"><label for="p">Nueva contraseña</label><input id="p" v-model="form.password" type="password" minlength="8" required /></div>
    <button class="btn primary">Cambiar contraseña</button><NuxtLink to="/login" class="small">Volver</NuxtLink>
  </form>
</template>
