<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const s = useSession(); const toast = useToast()
const form = reactive({ email: '', password: '' }); const busy = ref(false); const err = ref('')
async function submit() {
  busy.value = true; err.value = ''
  try { await api('/auth/login', { body: form }); await s.load(); navigateTo('/') } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
void toast
</script>
<template>
  <form class="stack" @submit.prevent="submit">
    <h1>Iniciar sesión</h1>
    <div v-if="err" class="alert error" role="alert">{{ err }}</div>
    <div class="field"><label for="e">Correo</label><input id="e" v-model="form.email" type="email" autocomplete="username" required /></div>
    <div class="field"><label for="p">Contraseña</label><input id="p" v-model="form.password" type="password" autocomplete="current-password" required /></div>
    <button class="btn primary" :disabled="busy">Entrar</button>
    <div class="small muted row between"><NuxtLink to="/registro">Crear cuenta</NuxtLink><NuxtLink to="/restablecer">Restablecer contraseña</NuxtLink></div>
    <div class="small muted">Demo: <code>admin@demo.local</code> / <code>Demo1234!</code></div>
  </form>
</template>
