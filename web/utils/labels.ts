export const ROLE_LABEL: Record<string, string> = {
  administrador: 'Administrador', supervisor: 'Supervisor', colaborador: 'Colaborador', arquitecto: 'Arquitecto',
  ingeniero_civil: 'Ingeniero civil', topografo: 'Topógrafo', plomero: 'Plomero', electricista: 'Electricista', soldador: 'Soldador',
}
export const SPECIALTY_LABEL: Record<string, string> = {
  gestion: 'Gestión', arquitectura: 'Arquitectura', ingenieria_civil: 'Ingeniería civil', topografia: 'Topografía',
  plomeria: 'Plomería', electricidad: 'Electricidad', soldadura: 'Soldadura',
}
export const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', aprobada: 'Aprobada',
  borrador: 'Borrador', en_revision: 'En revisión', aprobado: 'Aprobado',
  planificacion: 'Planificación', en_ejecucion: 'En ejecución', pausado: 'Pausado', terminado: 'Terminado',
  confirmada: 'Confirmada', cancelada: 'Cancelada', abierta: 'Abierta', cerrada: 'Cerrada',
  verificada: 'Verificada', rechazada: 'Rechazada', vencida: 'Vencida', aprobada_ins: 'Aprobada', con_observaciones: 'Con observaciones',
}
export const PRIORITY_LABEL: Record<string, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' }
export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const ROLES = Object.keys(ROLE_LABEL)
export const SPECIALTIES = Object.keys(SPECIALTY_LABEL)

export const label = (map: Record<string, string>, key?: string | null) => (key ? map[key] ?? key : '')
const TZ = 'America/Bogota'
export const fmtDate = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00-05:00` : d).toLocaleDateString('es-CO', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '')
export const fmtTime = (d: string) => new Date(d).toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
export const fmtDateTime = (d: string) => `${new Date(d).toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short' })} ${fmtTime(d)}`
export const localDay = (d: string | Date) => new Date(new Date(d).getTime() - 5 * 3600_000).toISOString().slice(0, 10)
export const todayStr = () => localDay(new Date())
export const addDaysStr = (day: string, n: number) => localDay(new Date(new Date(`${day}T12:00:00-05:00`).getTime() + n * 86400_000))
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
