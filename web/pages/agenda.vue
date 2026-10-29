<script setup lang="ts">
const toast = useToast()
const windows = ref<{ weekday: number; start: string; end: string }[]>([]); const blocks = ref<any[]>([]); const appts = ref<any[]>([])
const block = reactive({ dateFrom: todayStr(), dateTo: todayStr(), reason: '' })
async function load() {
  const a = await api('/availability'); windows.value = a.windows; blocks.value = a.blocks
  appts.value = await api('/appointments/mine')
}
const order = [1, 2, 3, 4, 5, 6, 0]
const byDay = (d: number) => windows.value.map((w, i) => ({ w, i })).filter((x) => x.w.weekday === d)
const add = (d: number) => windows.value.push({ weekday: d, start: '08:00', end: '12:00' })
const remove = (i: number) => windows.value.splice(i, 1)
async function save() { try { await api('/availability', { method: 'PUT', body: { windows: windows.value } }); toast.push('Disponibilidad guardada') } catch (e) { toast.error(e) } }
async function addBlock() { try { await api('/availability/blocks', { body: block }); block.reason = ''; toast.push('Bloqueo agregado'); load() } catch (e) { toast.error(e) } }
async function delBlock(id: number) { await api(`/availability/blocks/${id}`, { method: 'DELETE' }); load() }
onMounted(load)
</script>
<template>
  <div class="stack">
    <div><h1>Mi agenda</h1><p class="muted">Define cuándo puedes recibir visitas e inspecciones (hora de Colombia). Los supervisores reservan solo en estos horarios.</p></div>
    <div class="grid g2">
      <div class="card stack-sm">
        <h2>Disponibilidad semanal</h2>
        <div v-for="d in order" :key="d" class="row" style="align-items:flex-start">
          <div style="width:90px;padding-top:.5rem"><b>{{ WEEKDAYS[d] }}</b></div>
          <div class="grow stack-sm">
            <div v-for="x in byDay(d)" :key="x.i" class="row"><input v-model="x.w.start" type="time" class="inline" /><span>a</span><input v-model="x.w.end" type="time" class="inline" /><button class="btn sm danger" aria-label="Quitar franja" @click="remove(x.i)">✕</button></div>
            <button class="btn sm ghost" @click="add(d)">+ franja</button>
          </div>
        </div>
        <button class="btn primary" @click="save">Guardar disponibilidad</button>
      </div>
      <div class="stack">
        <div class="card stack-sm">
          <h2>Próximas citas</h2>
          <div v-if="!appts.length" class="empty">No tienes citas próximas.</div>
          <div v-for="a in appts" :key="a.id" class="list-item row">
            <div class="grow"><b>{{ a.typeName }}</b> <StatusBadge v-if="a.kind === 'inspeccion'" value="media" /><div class="small muted">{{ fmtDateTime(a.startAt) }} – {{ fmtTime(a.endAt) }} · {{ a.taskTitle ?? 'Sin tarea' }}</div></div>
            <NuxtLink :to="`/proyectos/${a.projectId}?tab=agenda`" class="btn sm">Ver</NuxtLink>
          </div>
        </div>
        <form class="card stack-sm" @submit.prevent="addBlock">
          <h2>Bloquear fechas</h2>
          <div class="grid g2"><div class="field"><label>Desde</label><input v-model="block.dateFrom" type="date" required /></div><div class="field"><label>Hasta</label><input v-model="block.dateTo" type="date" required /></div></div>
          <div class="field"><label>Motivo</label><input v-model="block.reason" placeholder="Vacaciones, otra obra…" /></div>
          <button class="btn">Bloquear</button>
          <div v-for="b in blocks" :key="b.id" class="list-item row"><div class="grow">{{ fmtDate(b.dateFrom) }} – {{ fmtDate(b.dateTo) }} <span class="muted">{{ b.reason }}</span></div><button type="button" class="btn sm danger" @click="delBlock(b.id)">Quitar</button></div>
        </form>
      </div>
    </div>
  </div>
</template>
