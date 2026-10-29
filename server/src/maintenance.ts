import { q, now } from './db.js'
import { notify, notifyMany, flushOutbox } from './notify.js'
import { today } from './util.js'

/** Tareas periódicas: recordatorios de citas (24 h antes) y alertas de vencimiento de certificaciones (30 días). */
export function runMaintenance() {
  const upcoming = q.all<any>("SELECT * FROM appointments WHERE status='confirmada' AND reminded_at IS NULL AND start_at>? AND start_at<=?",
    now(), new Date(Date.now() + 24 * 3600_000).toISOString())
  for (const a of upcoming) {
    notifyMany([a.professional_id, a.requested_by], { kind: 'appt_reminder', ref: `appt-${a.id}-reminder-${a.start_at}`, title: 'Recordatorio: tienes una cita en las próximas 24 horas', body: a.start_at, link: `/proyectos/${a.project_id}?tab=agenda` })
    q.run('UPDATE appointments SET reminded_at=? WHERE id=?', now(), a.id)
  }
  const limit = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
  const certs = q.all<any>("SELECT c.*, u.name FROM certifications c JOIN users u ON u.id=c.user_id WHERE c.status<>'rechazada' AND c.expires_at<=?", limit)
  const admins = q.all<any>('SELECT id FROM users WHERE is_admin=1 AND active=1').map((a) => a.id)
  for (const c of certs) {
    const expired = c.expires_at < today()
    const title = expired ? `Certificación vencida: ${c.name}` : `Certificación por vencer: ${c.name} (${c.expires_at})`
    notify(c.user_id, { kind: 'cert_expiry', ref: `cert-${c.id}-${expired ? 'expired' : 'soon'}`, title, link: '/perfil' })
    notifyMany(admins, { kind: 'cert_expiry_admin', ref: `cert-${c.id}-${expired ? 'expired' : 'soon'}-admin`, title: `${c.name}: ${title}`, link: '/admin' })
  }
  return { reminders: upcoming.length, certs: certs.length }
}

export function startMaintenance() {
  const tick = () => { try { runMaintenance() } catch (e) { console.error('mantenimiento:', e) } flushOutbox().catch(() => {}) }
  tick()
  return setInterval(tick, 10 * 60_000)
}
