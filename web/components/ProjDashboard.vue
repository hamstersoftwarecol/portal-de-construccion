<script setup lang="ts">
const props = defineProps<{ project: any }>(); const toast = useToast()
const d = ref<any>(null); const w = ref<any[]>([]); const rep = reactive({ specialty: '', status: '' })
async function load() { try { d.value = await api(`/projects/${props.project.id}/dashboard`); w.value = await api(`/projects/${props.project.id}/workload`) } catch (e) { toast.error(e) } }
onMounted(load)
const exportable = computed(() => can(props.project.myRole, 'report.export'))
const href = (fmt: string) => `/api/projects/${props.project.id}/report?format=${fmt}${rep.specialty ? `&specialty=${rep.specialty}` : ''}${rep.status ? `&status=${rep.status}` : ''}`
</script>
<template>
  <div v-if="d" class="stack">
    <div class="grid g4">
      <div class="card"><div class="kpi">{{ d.percent }}%</div><div class="kpi-l">Avance general</div><div class="bar" style="margin-top:.4rem"><i :style="{ width: d.percent + '%' }" /></div></div>
      <div v-for="s in d.statusCounts" :key="s.status" class="card"><div class="kpi">{{ s.n }}</div><div class="kpi-l">{{ label(STATUS_LABEL, s.status) }}</div></div>
      <div class="card"><div class="kpi" :style="{ color: d.overdue.length ? 'var(--bad)' : '' }">{{ d.overdue.length }}</div><div class="kpi-l">Atrasadas</div></div>
    </div>
    <div class="grid g2">
      <div class="card stack-sm"><h2>Avance por fase</h2><div v-for="p in d.byPhase" :key="p.name" class="stack-sm"><div class="row between small"><b>{{ p.name }}</b><span>{{ p.done }}/{{ p.total }} · {{ p.percent }}%</span></div><div class="bar"><i :style="{ width: p.percent + '%' }" /></div></div></div>
      <div class="card stack-sm"><h2>Avance por especialidad</h2><div v-for="p in d.bySpecialty" :key="p.specialty" class="stack-sm"><div class="row between small"><b>{{ label(SPECIALTY_LABEL, p.specialty) }}</b><span>{{ p.done }}/{{ p.total }} · {{ p.percent }}%</span></div><div class="bar warn"><i :style="{ width: p.percent + '%' }" /></div></div></div>
    </div>
    <div class="card scroll-x"><h2>Tareas atrasadas</h2><div v-if="!d.overdue.length" class="empty">Nada atrasado.</div>
      <table v-else class="table"><thead><tr><th>Tarea</th><th>Responsable</th><th>Venció</th><th>Estado</th></tr></thead><tbody><tr v-for="t in d.overdue" :key="t.id"><td><NuxtLink :to="`/tareas/${t.id}`">{{ t.title }}</NuxtLink></td><td>{{ t.assignee ?? 'Sin asignar' }}</td><td style="color:var(--bad)">{{ fmtDate(t.dueDate) }}</td><td><StatusBadge :value="t.status" /></td></tr></tbody></table></div>
    <div class="card scroll-x"><h2>Carga de trabajo del equipo</h2>
      <table class="table"><thead><tr><th>Persona</th><th>Rol</th><th>Tareas abiertas</th><th>Por revisar</th><th>Citas (7 días)</th></tr></thead><tbody><tr v-for="m in w" :key="m.userId"><td>{{ m.name }}</td><td>{{ label(ROLE_LABEL, m.role) }}</td><td>{{ m.openTasks }}</td><td>{{ m.awaitingReview }}</td><td>{{ m.appointmentsThisWeek }}</td></tr></tbody></table></div>
    <div v-if="exportable" class="card stack-sm"><h2>Exportar reporte de avance</h2>
      <div class="row"><select v-model="rep.specialty" class="inline"><option value="">Todas las especialidades</option><option v-for="s in SPECIALTIES" :key="s" :value="s">{{ label(SPECIALTY_LABEL, s) }}</option></select>
        <select v-model="rep.status" class="inline"><option value="">Todos los estados</option><option v-for="s in ['pendiente','en_curso','hecha','aprobada']" :key="s" :value="s">{{ label(STATUS_LABEL, s) }}</option></select>
        <a class="btn" :href="href('xlsx')">Descargar Excel</a><a class="btn" :href="href('pdf')">Descargar PDF</a></div></div>
  </div>
</template>
