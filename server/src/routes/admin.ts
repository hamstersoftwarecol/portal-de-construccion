import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { q, now, raw, getSetting, setSetting } from '../db.js'
import { config } from '../config.js'
import { audit, body, fail, idParam, needAdmin, randomCode, type Env } from '../util.js'
import { SPECIALTIES } from '../rbac.js'
import { notify, activeChannels } from '../notify.js'
import { activeProviderName, calendlyToken } from '../providers/scheduling.js'

export const adminRoutes = new Hono<Env>()

adminRoutes.get('/admin/users', (c) => {
  needAdmin(c.get('user'))
  const users = q.all<any>(`SELECT u.id,u.email,u.name,u.is_admin as isAdmin,u.active,u.created_at as createdAt, p.specialty
    FROM users u LEFT JOIN profiles p ON p.user_id=u.id ORDER BY u.name`)
  const ms = q.all<any>('SELECT m.user_id as userId, m.project_id as projectId, m.role, p.name as project FROM memberships m JOIN projects p ON p.id=m.project_id')
  return c.json(users.map((u) => ({ ...u, isAdmin: !!u.isAdmin, active: !!u.active, memberships: ms.filter((m) => m.userId === u.id) })))
})

adminRoutes.patch('/admin/users/:id', async (c) => {
  const me = c.get('user'); needAdmin(me)
  const id = idParam(c)
  const data = await body(c, z.object({ active: z.boolean().optional(), isAdmin: z.boolean().optional() }))
  if (id === me.id && (data.active === false || data.isAdmin === false)) return fail(409, 'No puedes quitarte tus propios permisos')
  if (data.active !== undefined) q.run('UPDATE users SET active=? WHERE id=?', data.active, id)
  if (data.isAdmin !== undefined) q.run('UPDATE users SET is_admin=? WHERE id=?', data.isAdmin, id)
  if (data.active === false) q.run('DELETE FROM sessions WHERE user_id=?', id)
  audit(me.id, 'user_update', 'user', id, data)
  return c.json({ ok: true })
})

adminRoutes.post('/admin/users/:id/reset-code', (c) => {
  const me = c.get('user'); needAdmin(me)
  const id = idParam(c)
  if (!q.get('SELECT 1 FROM users WHERE id=?', id)) return fail(404, 'Usuario no encontrado')
  const code = randomCode(9)
  q.run('INSERT INTO reset_codes(code,user_id,expires_at) VALUES(?,?,?)', code, id, new Date(Date.now() + 24 * 3600_000).toISOString())
  audit(me.id, 'reset_code', 'user', id)
  return c.json({ code, link: `/restablecer?codigo=${code}`, expiresInHours: 24 })
})

adminRoutes.get('/admin/audit', (c) => {
  needAdmin(c.get('user'))
  const limit = Math.min(500, Number(c.req.query('limit') ?? 100))
  const action = c.req.query('action')
  const rows = q.all(`SELECT a.id,a.action,a.entity,a.entity_id as entityId,a.detail,a.created_at as createdAt,u.name as user
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${action ? 'WHERE a.action=?' : ''} ORDER BY a.id DESC LIMIT ${limit}`, ...(action ? [action] : []))
  return c.json(rows)
})

adminRoutes.post('/admin/backup', (c) => {
  needAdmin(c.get('user'))
  return c.json(makeBackup())
})
export function makeBackup() {
  fs.mkdirSync(config.backupDir, { recursive: true })
  const file = path.join(config.backupDir, `portal-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  return { file, bytes: fs.statSync(file).size }
}

// ---------- tipos de cita (US-19) ----------
adminRoutes.get('/appointment-types', (c) => {
  const specialty = c.req.query('specialty')
  return c.json(q.all(`SELECT id,name,specialty,duration_min as durationMin, calendly_uri as calendlyUri FROM appointment_types ${specialty ? 'WHERE specialty=?' : ''} ORDER BY specialty,name`, ...(specialty ? [specialty] : [])))
})
const typeSchema = z.object({ name: z.string().trim().min(2), specialty: z.enum(SPECIALTIES), durationMin: z.number().int().min(15).max(480), calendlyUri: z.string().url().nullable().optional() })
adminRoutes.post('/appointment-types', async (c) => {
  const me = c.get('user'); needAdmin(me)
  const d = await body(c, typeSchema)
  const r = q.run('INSERT INTO appointment_types(name,specialty,duration_min,calendly_uri) VALUES(?,?,?,?)', d.name, d.specialty, d.durationMin, d.calendlyUri ?? null)
  audit(me.id, 'appt_type_create', 'appointment_type', r.id, d)
  return c.json({ id: r.id }, 201)
})
adminRoutes.put('/appointment-types/:id', async (c) => {
  const me = c.get('user'); needAdmin(me)
  const id = idParam(c)
  const d = await body(c, typeSchema)
  q.run('UPDATE appointment_types SET name=?,specialty=?,duration_min=?,calendly_uri=? WHERE id=?', d.name, d.specialty, d.durationMin, d.calendlyUri ?? null, id)
  audit(me.id, 'appt_type_update', 'appointment_type', id, d)
  return c.json({ ok: true })
})
adminRoutes.delete('/appointment-types/:id', (c) => {
  const me = c.get('user'); needAdmin(me)
  const id = idParam(c)
  if (q.get("SELECT 1 FROM appointments WHERE type_id=? AND status='confirmada'", id)) return fail(409, 'Hay citas confirmadas con este tipo')
  q.run('DELETE FROM appointment_types WHERE id=?', id)
  audit(me.id, 'delete', 'appointment_type', id)
  return c.json({ ok: true })
})

// ---------- verificación de certificaciones (US-12) ----------
adminRoutes.get('/admin/certifications', (c) => {
  needAdmin(c.get('user'))
  const status = c.req.query('status')
  return c.json(q.all(`SELECT c.id,c.name,c.number,c.expires_at as expiresAt,c.status,u.name as user,u.id as userId, p.specialty
    FROM certifications c JOIN users u ON u.id=c.user_id LEFT JOIN profiles p ON p.user_id=u.id ${status ? 'WHERE c.status=?' : ''} ORDER BY c.status, c.expires_at`, ...(status ? [status] : [])))
})
adminRoutes.patch('/certifications/:id/review', async (c) => {
  const me = c.get('user'); needAdmin(me)
  const id = idParam(c)
  const d = await body(c, z.object({ status: z.enum(['verificada', 'rechazada']) }))
  const cert = q.get<any>('SELECT * FROM certifications WHERE id=?', id)
  if (!cert) return fail(404, 'Certificación no encontrada')
  q.run('UPDATE certifications SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?', d.status, me.id, now(), id)
  audit(me.id, 'cert_review', 'certification', id, d)
  notify(cert.user_id, { kind: 'cert_review', ref: `cert-${id}-${d.status}`, title: `Tu certificación "${cert.name}" fue ${d.status}`, link: '/perfil' })
  return c.json({ ok: true })
})

// ---------- configuración e integraciones (US-41, US-43) ----------
adminRoutes.get('/admin/settings', (c) => {
  needAdmin(c.get('user'))
  return c.json({
    schedulingProvider: activeProviderName(),
    requestedProvider: getSetting('scheduling_provider') ?? config.schedulingProvider,
    calendlyConnected: !!calendlyToken(),
    calendlyOAuthAvailable: !!config.calendly.clientId,
    notifyChannels: activeChannels(),
    database: 'sqlite',
  })
})
adminRoutes.put('/admin/settings', async (c) => {
  const me = c.get('user'); needAdmin(me)
  const d = await body(c, z.object({ schedulingProvider: z.enum(['local', 'calendly']).optional(), notifyChannels: z.array(z.enum(['inapp', 'email', 'whatsapp'])).optional() }))
  if (d.schedulingProvider === 'calendly' && !calendlyToken()) return fail(422, 'Conecta Calendly antes de activarlo')
  if (d.schedulingProvider) setSetting('scheduling_provider', d.schedulingProvider)
  if (d.notifyChannels) setSetting('notify_channels', d.notifyChannels.join(','))
  audit(me.id, 'settings_update', 'settings', null, d)
  return c.json({ ok: true })
})
adminRoutes.get('/admin/outbox', (c) => {
  needAdmin(c.get('user'))
  return c.json(q.all('SELECT id,channel,to_addr as toAddr,subject,status,error,created_at as createdAt FROM outbox ORDER BY id DESC LIMIT 100'))
})
