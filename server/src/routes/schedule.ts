import { Hono } from 'hono'
import { z } from 'zod'
import { q, now, setSetting } from '../db.js'
import { audit, body, fail, idParam, needAdmin, needProject, projectRole, isDate, type Env } from '../util.js'
import { ROLE_SPECIALTY, can, type Role } from '../rbac.js'
import { notifyMany } from '../notify.js'
import { getProvider, handleCalendlyEvent, verifyCalendlySignature } from '../providers/scheduling.js'
import { config } from '../config.js'

export const scheduleRoutes = new Hono<Env>()
export const webhookRoutes = new Hono()

const SELECT = `SELECT a.*, t.name as type_name, pu.name as professional_name, ru.name as requester_name, k.title as task_title, pp.specialty as professional_specialty
  FROM appointments a LEFT JOIN appointment_types t ON t.id=a.type_id JOIN users pu ON pu.id=a.professional_id JOIN users ru ON ru.id=a.requested_by
  LEFT JOIN tasks k ON k.id=a.task_id LEFT JOIN profiles pp ON pp.user_id=a.professional_id`
const shape = (a: any) => ({
  id: a.id, projectId: a.project_id, taskId: a.task_id, taskTitle: a.task_title, typeId: a.type_id, typeName: a.type_name, kind: a.kind,
  professionalId: a.professional_id, professionalName: a.professional_name, specialty: a.professional_specialty,
  requestedBy: a.requested_by, requesterName: a.requester_name, startAt: a.start_at, endAt: a.end_at, status: a.status,
  cancelReason: a.cancel_reason, result: a.result, resultNotes: a.result_notes, notes: a.notes, provider: a.provider,
})

scheduleRoutes.get('/slots', async (c) => {
  const professionalId = Number(c.req.query('professionalId')); const typeId = Number(c.req.query('typeId'))
  const from = c.req.query('from') ?? ''; const to = c.req.query('to') ?? from
  if (!professionalId || !typeId || !isDate(from) || !isDate(to)) return fail(400, 'Indica professionalId, typeId, from y to (AAAA-MM-DD)')
  if (to < from) return fail(400, 'El rango de fechas es inválido')
  const slots = await getProvider().listSlots({ professionalId, typeId, from, to })
  return c.json({ provider: getProvider().name, slots })
})

const apptBody = z.object({
  projectId: z.number().int(), taskId: z.number().int().nullable().optional(), typeId: z.number().int(), professionalId: z.number().int(),
  startAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha y hora inválidas'), kind: z.enum(['visita', 'inspeccion']).optional(), notes: z.string().max(1000).optional(),
})

scheduleRoutes.post('/appointments', async (c) => {
  const u = c.get('user')
  const d = await body(c, apptBody)
  const kind = d.kind ?? 'visita'
  const role = needProject(u, d.projectId, kind === 'inspeccion' ? 'inspection.manage' : 'appt.book')
  const type = q.get<any>('SELECT * FROM appointment_types WHERE id=?', d.typeId)
  if (!type) return fail(404, 'Tipo de cita no encontrado')
  const pm = q.get<{ role: Role }>('SELECT role FROM memberships WHERE project_id=? AND user_id=?', d.projectId, d.professionalId)
  if (!pm) return fail(422, 'El profesional no pertenece al proyecto')
  if (type.specialty !== 'gestion' && ROLE_SPECIALTY[pm.role] !== type.specialty) return fail(422, 'El profesional no es de la especialidad del tipo de cita')
  if (d.taskId) {
    const t = q.get<any>('SELECT project_id FROM tasks WHERE id=?', d.taskId)
    if (!t || t.project_id !== d.projectId) return fail(422, 'La tarea no pertenece al proyecto')
  }
  const provider = getProvider()
  const me = q.get<any>('SELECT name,email FROM users WHERE id=?', u.id)
  let booked
  try { booked = await provider.book({ professionalId: d.professionalId, typeId: d.typeId, startAt: d.startAt, inviteeName: me.name, inviteeEmail: me.email }) }
  catch (e: any) { return fail(e.status ?? 409, e.message) }
  const id = q.run(`INSERT INTO appointments(project_id,task_id,type_id,professional_id,requested_by,start_at,end_at,kind,status,notes,provider,external_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,'confirmada',?,?,?,?)`, d.projectId, d.taskId ?? null, d.typeId, d.professionalId, u.id, booked.start, booked.end, kind, d.notes ?? null, provider.name, booked.externalId ?? null, now()).id
  if (d.taskId) q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'cita',?,?)", d.taskId, u.id, `Cita agendada: ${type.name} el ${booked.start}`, now())
  notifyMany([d.professionalId, u.id].filter((x) => x !== u.id || true), { kind: 'appt_new', ref: `appt-${id}-new`, title: `Cita agendada: ${type.name}`, body: `${booked.start}`, link: `/proyectos/${d.projectId}?tab=agenda` })
  audit(u.id, 'appt_create', 'appointment', id, { kind, professionalId: d.professionalId, start: booked.start })
  void role
  return c.json({ id, startAt: booked.start, endAt: booked.end, provider: provider.name }, 201)
})

scheduleRoutes.get('/projects/:id/appointments', (c) => {
  const u = c.get('user'); const pid = idParam(c); const role = needProject(u, pid)
  const where = ['a.project_id=?']; const p: any[] = [pid]
  if (!can(role, 'appt.viewAll')) { where.push('(a.professional_id=? OR a.requested_by=?)'); p.push(u.id, u.id) }
  let from = c.req.query('from'); let to = c.req.query('to')
  const month = c.req.query('month')
  if (month && /^\d{4}-\d{2}$/.test(month)) { from = `${month}-01`; to = `${month}-31` }
  if (from && isDate(from)) { where.push('a.start_at>=?'); p.push(new Date(`${from}T00:00:00${config.tzOffset}`).toISOString()) }
  if (to && isDate(to)) { where.push('a.start_at<=?'); p.push(new Date(`${to}T23:59:59${config.tzOffset}`).toISOString()) }
  const prof = c.req.query('professionalId'); if (prof) { where.push('a.professional_id=?'); p.push(prof) }
  const spec = c.req.query('specialty'); if (spec) { where.push('pp.specialty=?'); p.push(spec) }
  if (c.req.query('status')) { where.push('a.status=?'); p.push(c.req.query('status')) }
  return c.json(q.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.start_at`, ...p).map(shape))
})

scheduleRoutes.get('/appointments/mine', (c) => {
  const u = c.get('user')
  return c.json(q.all(`${SELECT} WHERE (a.professional_id=? OR a.requested_by=?) AND a.status='confirmada' AND a.end_at>=? ORDER BY a.start_at`, u.id, u.id, now()).map(shape))
})

function loadAppt(c: any, perm: 'project.view' = 'project.view') {
  const u = c.get('user'); const id = idParam(c)
  const a = q.get<any>('SELECT * FROM appointments WHERE id=?', id)
  if (!a) return fail(404, 'Cita no encontrada')
  const role = needProject(u, a.project_id, perm)
  return { u, a, role }
}
const canManageAppt = (u: any, a: any, role: Role | null) => a.professional_id === u.id || a.requested_by === u.id || role === 'administrador' || role === 'supervisor'

scheduleRoutes.post('/appointments/:id/cancel', async (c) => {
  const { u, a, role } = loadAppt(c)
  if (!canManageAppt(u, a, role)) return fail(403, 'No puedes cancelar esta cita')
  const d = await body(c, z.object({ reason: z.string().trim().min(3, 'Indica el motivo de la cancelación') }))
  if (a.status !== 'confirmada') return fail(409, 'La cita ya estaba cancelada')
  try { await getProvider(a.provider).cancel({ externalId: a.external_id, reason: d.reason }) } catch (e: any) { return fail(e.status ?? 502, e.message) }
  q.run("UPDATE appointments SET status='cancelada', cancel_reason=? WHERE id=?", d.reason, a.id)
  notifyMany([a.professional_id, a.requested_by].filter((x) => x !== u.id), { kind: 'appt_cancel', ref: `appt-${a.id}-cancel`, title: 'Cita cancelada', body: d.reason, link: `/proyectos/${a.project_id}?tab=agenda` })
  audit(u.id, 'appt_cancel', 'appointment', a.id, d)
  return c.json({ ok: true })
})

scheduleRoutes.post('/appointments/:id/reschedule', async (c) => {
  const { u, a, role } = loadAppt(c)
  if (!canManageAppt(u, a, role)) return fail(403, 'No puedes reprogramar esta cita')
  const d = await body(c, z.object({ startAt: z.string().refine((s) => !Number.isNaN(Date.parse(s))) }))
  if (a.status !== 'confirmada') return fail(409, 'Solo se reprograman citas confirmadas')
  const provider = getProvider(a.provider)
  const me = q.get<any>('SELECT name,email FROM users WHERE id=?', a.requested_by)
  let booked
  try {
    booked = await provider.book({ professionalId: a.professional_id, typeId: a.type_id, startAt: d.startAt, inviteeName: me.name, inviteeEmail: me.email, ignoreAppointmentId: a.id })
    if (provider.name === 'calendly') await provider.cancel({ externalId: a.external_id, reason: 'Reprogramada desde el portal' })
  } catch (e: any) { return fail(e.status ?? 409, e.message) }
  q.run("UPDATE appointments SET start_at=?, end_at=?, external_id=COALESCE(?,external_id), reminded_at=NULL WHERE id=?", booked.start, booked.end, booked.externalId ?? null, a.id)
  notifyMany([a.professional_id, a.requested_by].filter((x) => x !== u.id), { kind: 'appt_move', ref: `appt-${a.id}-move-${booked.start}`, title: 'Cita reprogramada', body: booked.start, link: `/proyectos/${a.project_id}?tab=agenda` })
  audit(u.id, 'appt_reschedule', 'appointment', a.id, { from: a.start_at, to: booked.start })
  return c.json({ ok: true, startAt: booked.start, endAt: booked.end })
})

// US-31: resultado de una inspección
scheduleRoutes.post('/appointments/:id/result', async (c) => {
  const { u, a } = loadAppt(c)
  needProject(u, a.project_id, 'inspection.result')
  if (a.kind !== 'inspeccion') return fail(409, 'Solo las inspecciones tienen resultado')
  if (a.status !== 'confirmada') return fail(409, 'La inspección está cancelada')
  const d = await body(c, z.object({ result: z.enum(['aprobada', 'con_observaciones']), notes: z.string().trim().optional() }))
  if (d.result === 'con_observaciones' && !d.notes) return fail(422, 'Describe las observaciones')
  q.run('UPDATE appointments SET result=?, result_notes=? WHERE id=?', d.result, d.notes ?? null, a.id)
  notifyMany([a.requested_by, a.professional_id].filter((x) => x !== u.id), { kind: 'inspection_result', ref: `appt-${a.id}-result-${d.result}`, title: `Inspección ${d.result === 'aprobada' ? 'aprobada' : 'con observaciones'}`, body: d.notes, link: `/proyectos/${a.project_id}?tab=calidad` })
  audit(u.id, 'inspection_result', 'appointment', a.id, d)
  return c.json({ ok: true })
})

// ---------- Calendly: OAuth (US-41) y webhooks (US-42) ----------
scheduleRoutes.get('/integrations/calendly/connect', (c) => {
  needAdmin(c.get('user'))
  if (!config.calendly.clientId) return fail(422, 'Define CALENDLY_CLIENT_ID y CALENDLY_CLIENT_SECRET para usar OAuth, o CALENDLY_TOKEN con un token personal')
  const qs = new URLSearchParams({ client_id: config.calendly.clientId, response_type: 'code', redirect_uri: config.calendly.redirectUri })
  return c.json({ url: `https://auth.calendly.com/oauth/authorize?${qs}` })
})
scheduleRoutes.get('/integrations/calendly/callback', async (c) => {
  needAdmin(c.get('user'))
  const code = c.req.query('code'); if (!code) return fail(400, 'Falta el código de autorización')
  const res = await fetch('https://auth.calendly.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.calendly.redirectUri, client_id: config.calendly.clientId, client_secret: config.calendly.clientSecret }),
  })
  if (!res.ok) return fail(422, 'Calendly rechazó el código de autorización')
  const data: any = await res.json()
  setSetting('calendly_token', data.access_token)
  audit(c.get('user').id, 'calendly_connect', 'settings', null)
  return c.redirect('/admin?calendly=ok')
})

webhookRoutes.post('/webhooks/calendly', async (c) => {
  const raw = await c.req.text()
  if (!verifyCalendlySignature(raw, c.req.header('Calendly-Webhook-Signature'), config.calendly.webhookSigningKey)) return c.json({ error: 'Firma inválida' }, 401)
  let payload: any
  try { payload = JSON.parse(raw) } catch { return c.json({ error: 'JSON inválido' }, 400) }
  return c.json(handleCalendlyEvent(payload))
})
void projectRole
