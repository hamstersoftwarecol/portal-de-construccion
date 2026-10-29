<script setup lang="ts">
const s = useSession(); const items = ref<any[]>([])
async function load() { items.value = await api('/notifications'); s.refreshUnread() }
async function open(n: any) { if (!n.readAt) { await api(`/notifications/${n.id}/read`, { method: 'POST' }); n.readAt = new Date().toISOString(); s.refreshUnread() } if (n.link) navigateTo(n.link) }
async function readAll() { await api('/notifications/read-all', { method: 'POST' }); await load() }
onMounted(load)
</script>
<template>
  <div class="stack">
    <div class="row between"><h1>Notificaciones</h1><button class="btn" @click="readAll">Marcar todas como leídas</button></div>
    <div v-if="!items.length" class="empty">No tienes notificaciones.</div>
    <div class="card" v-if="items.length">
      <div v-for="n in items" :key="n.id" class="list-item row" style="cursor:pointer" @click="open(n)">
        <span :style="{ width: '9px', height: '9px', borderRadius: '99px', background: n.readAt ? 'transparent' : 'var(--accent)' }" />
        <div class="grow"><div :style="{ fontWeight: n.readAt ? 400 : 700 }">{{ n.title }}</div><div v-if="n.body" class="small muted">{{ n.body }}</div></div>
        <div class="small muted">{{ fmtDateTime(n.createdAt) }}</div>
      </div>
    </div>
  </div>
</template>
