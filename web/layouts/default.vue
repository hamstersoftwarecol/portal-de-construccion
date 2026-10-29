<script setup lang="ts">
const s = useSession()
const toast = useToast()
const pending = usePendingSync()
const online = useState('online', () => true)
const open = ref(false)
const route = useRoute()
watch(() => route.fullPath, () => { open.value = false })
let timer: any
onMounted(() => { s.refreshUnread(); timer = setInterval(() => s.refreshUnread(), 30000) })
onBeforeUnmount(() => clearInterval(timer))
const firstProject = computed(() => s.memberships.value[0]?.projectId)
</script>
<template>
  <div>
    <div v-if="!online" class="offline">Sin conexión: puedes ver tus tareas guardadas; los cambios de estado se enviarán al reconectar.</div>
    <div v-else-if="pending > 0" class="offline">Sincronizando {{ pending }} cambio(s) pendiente(s)…</div>
    <div class="shell">
      <aside class="side" :class="{ open }">
        <div class="brand"><span class="brand-mark">PC</span> Portal de Obra</div>
        <nav class="nav">
          <NuxtLink to="/">▦ Proyectos</NuxtLink>
          <NuxtLink to="/mis-tareas">✓ Mis tareas</NuxtLink>
          <NuxtLink to="/agenda">◷ Mi agenda</NuxtLink>
          <NuxtLink v-if="s.isManager.value" to="/profesionales">☰ Profesionales</NuxtLink>
          <NuxtLink to="/notificaciones">◉ Notificaciones <span v-if="s.unread.value" class="badge b-critica">{{ s.unread.value }}</span></NuxtLink>
          <NuxtLink to="/perfil">☺ Mi perfil</NuxtLink>
          <template v-if="s.user.value?.isAdmin">
            <div class="sep">Administración</div>
            <NuxtLink to="/admin">⚙ Administración</NuxtLink>
          </template>
        </nav>
        <div class="small muted" style="padding:1rem .7rem">{{ s.user.value?.name }}<br />{{ s.user.value?.email }}</div>
        <button class="btn sm" style="margin-left:.7rem" @click="s.logout()">Cerrar sesión</button>
      </aside>
      <div v-if="open" class="scrim" @click="open = false" />
      <main class="main">
        <div class="topbar">
          <button class="btn hamb" aria-label="Menú" @click="open = !open">☰</button>
          <span class="grow" />
          <NuxtLink to="/notificaciones" class="btn bell" aria-label="Notificaciones">🔔<span v-if="s.unread.value" class="dot">{{ s.unread.value }}</span></NuxtLink>
        </div>
        <slot />
      </main>
    </div>
    <div class="toasts"><div v-for="t in toast.items.value" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div></div>
  </div>
</template>
