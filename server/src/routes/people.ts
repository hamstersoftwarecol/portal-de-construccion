import { Hono } from 'hono'
import { z } from 'zod'
import { q, now } from '../db.js'
import { addAttachment, audit, body, fail, FILE_KINDS, idParam, isDate, isManagerAnywhere, saveUpload, today, type Env } from '../util.js'
import { SPECIALTIES } from '../rbac.js'
import { localSlots } from '../providers/scheduling.js'
import { config } from '../config.js'

export const peopleRoutes = new Hono<Env>()

const certStatus = (c: any) => (c.expires_at < today() ? 'vencida' : c.status)

function profileOf(userId: number) {
  const u = q.get<any>('SELECT id,name,email FROM users WHERE id=?', userId)
  if (!u) return null
  const p = q.get<any>('SELECT * FROM profiles WHERE user_id=?', userId) ?? {}
  const certs = q.all<any>('SELECT id,name,number,expires_at as expiresAt,status FROM certifications WHERE user_id=? ORDER BY expires_at', userId)
    .map((c) => ({ ...c, effectiveStatus: certStatus({ expires_at: c.expiresAt, status: c.status }) }))
  return { id: u.id, name: u.name, email: u.email, specialty: p.specialty ?? null, zone: p.zone ?? '', phone: p.phone ?? '', bio: p.bio ?? '',
    photoFileId: p.photo_file_id ?? null, certifications: certs }
}

peopleRoutes.get('/profile', (c) => c.json(profileOf(c.get('user').id)))
peopleRoutes.get('/profile/:userId', (c) => {
  const me = c.get('user'); const id = idParam(c, 'userId')
  const shared = id === me.id || me.is_admin || q.get('SELECT 1 FROM memberships a JOIN memberships b ON a.project_id=b.project_id WHERE a.user_id=? AND b.user_id=?', me.id, id)
  if (!shared) return fail(403, 'No compartes proyecto con esta persona')
  const p = profileOf(id)
  return p ? c.json(p) : fail(404, 'Usuario no encontrado')
})
peopleRoutes.put('/profile', async (c) => {
  const me = c.get('user')
  const d = await body(c, z.object({ name: z.string().trim().min(2).optional(), specialty: z.enum(SPECIALTIES).nullable().optional(), zone: z.string().max(120).optional(), phone: z.string().max(30).optional(), bio: z.string().max(500).optional() }))
  const cur = q.get<any>('SELECT * FROM profiles WHERE user_id=?', me.id)
  if (cur) q.run('UPDATE profiles SET specialty=?,zone=?,phone=?,bio=? WHERE user_id=?',
    d.specialty === undefined ? cur.specialty : d.specialty, d.zone ?? cur.zone, d.phone ?? cur.phone, d.bio ?? cur.bio, me.id)
  else q.run('INSERT INTO profiles(user_id,specialty,zone,phone,bio) VALUES(?,?,?,?,?)', me.id, d.specialty ?? null, d.zone ?? '', d.phone ?? '', d.bio ?? '')
  if (d.name) q.run('UPDATE users SET name=? WHERE id=?', d.name, me.id)
  return c.json(profileOf(me.id))
})
peopleRoutes.post('/profile/photo', async (c) => {
  const me = c.get('user')
  const form = await c.req.parseBody()
  const file = await saveUpload(form.file, FILE_KINDS.image, 5)
  const id = addAttachment({ entity: 'profile', entityId: me.id, kind: 'foto', file, by: me.id })
  if (!q.get('SELECT 1 FROM profiles WHERE user_id=?', me.id)) q.run('INSERT INTO profiles(user_id) VALUES(?)', me.id)
  q.run('UPDATE profiles SET photo_file_id=? WHERE user_id=?', id, me.id)
  return c.json({ photoFileId: id })
})

// ---------- certificaciones (US-10) ----------
peopleRoutes.post('/certifications', async (c) => {
  const me = c.get('user')
  const d = await body(c, z.object({ name: z.string().trim().min(2), number: z.string().trim().min(1), expiresAt: z.string().refine(isDate, 'Fecha inválida') }))
  const r = q.run('INSERT INTO certifications(user_id,name,number,expires_at,created_at) VALUES(?,?,?,?,?)', me.id, d.name, d.number, d.expiresAt, now())
  return c.json({ id: r.id }, 201)
})
peopleRoutes.delete('/certifications/:id', (c) => {
  const me = c.get('user'); const id = idParam(c)
  const cert = q.get<any>('SELECT * FROM certifications WHERE id=?', id)
  if (!cert || (cert.user_id !== me.id && !me.is_admin)) return fail(404, 'Certificación no encontrada')
  q.run('DELETE FROM certifications WHERE id=?', id)
  audit(me.id, 'delete', 'certification', id)
  return c.json({ ok: true })
})

// ---------- directorio de profesionales (US-11) ----------
peopleRoutes.get('/professionals', (c) => {
  const me = c.get('user')
  if (!isManagerAnywhere(me)) return fail(403, 'Solo administradores y supervisores consultan el directorio')
  const specialty = c.req.query('specialty')
  const onlyAvailable = c.req.query('available') === '1'
  const projectId = Number(c.req.query('projectId') ?? 0) || null
  const rows = q.all<any>(`SELECT u.id,u.name,u.email,p.specialty,p.zone,p.phone,p.photo_file_id as photoFileId
    FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.active=1 AND p.specialty IS NOT NULL ${specialty ? 'AND p.specialty=?' : ''} ORDER BY u.name`, ...(specialty ? [specialty] : []))
  const from = today()
  const to = new Date(Date.now() + 7 * 86400_000 - 5 * 3600_000).toISOString().slice(0, 10)
  const out = rows.map((r) => {
    const certs = q.all<any>("SELECT name,number,expires_at as expiresAt FROM certifications WHERE user_id=? AND status='verificada' AND expires_at>=? ORDER BY expires_at", r.id, today())
    const nextSlot = localSlots(r.id, 30, from, to)[0]?.start ?? null
    const inProject = projectId ? !!q.get('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?', projectId, r.id) : null
    return { ...r, certifications: certs, nextAvailable: nextSlot, inProject }
  })
  return c.json(onlyAvailable ? out.filter((r) => r.nextAvailable) : out)
})

// ---------- disponibilidad semanal y bloqueos (US-20) ----------
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
peopleRoutes.get('/availability', (c) => {
  const uid = Number(c.req.query('userId') ?? c.get('user').id)
  return c.json({
    windows: q.all('SELECT weekday,start,"end" as end FROM availability WHERE user_id=? ORDER BY weekday,start', uid),
    blocks: q.all('SELECT id,date_from as dateFrom,date_to as dateTo,reason FROM time_blocks WHERE user_id=? ORDER BY date_from', uid),
    timezone: 'America/Bogota',
  })
})
peopleRoutes.put('/availability', async (c) => {
  const me = c.get('user')
  const d = await body(c, z.object({ windows: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(timeRe), end: z.string().regex(timeRe) })) }))
  for (const w of d.windows) if (w.end <= w.start) return fail(422, 'La hora final debe ser posterior a la inicial')
  for (const a of d.windows) for (const b of d.windows)
    if (a !== b && a.weekday === b.weekday && a.start < b.end && b.start < a.end) return fail(422, 'Hay franjas que se solapan el mismo día')
  q.tx(() => {
    q.run('DELETE FROM availability WHERE user_id=?', me.id)
    for (const w of d.windows) q.run('INSERT INTO availability(user_id,weekday,start,"end") VALUES(?,?,?,?)', me.id, w.weekday, w.start, w.end)
  })
  return c.json({ ok: true })
})
peopleRoutes.post('/availability/blocks', async (c) => {
  const me = c.get('user')
  const d = await body(c, z.object({ dateFrom: z.string().refine(isDate), dateTo: z.string().refine(isDate), reason: z.string().max(200).optional() }))
  if (d.dateTo < d.dateFrom) return fail(422, 'La fecha final debe ser igual o posterior a la inicial')
  const r = q.run('INSERT INTO time_blocks(user_id,date_from,date_to,reason) VALUES(?,?,?,?)', me.id, d.dateFrom, d.dateTo, d.reason ?? '')
  return c.json({ id: r.id }, 201)
})
peopleRoutes.delete('/availability/blocks/:id', (c) => {
  const me = c.get('user')
  q.run('DELETE FROM time_blocks WHERE id=? AND user_id=?', idParam(c), me.id)
  return c.json({ ok: true })
})
void config
