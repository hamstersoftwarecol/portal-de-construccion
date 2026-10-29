import { Hono } from 'hono'
import { z } from 'zod'
import { q, now } from '../db.js'
import { audit, body, fail, idParam, isDate, needAdmin, needProject, randomCode, projectRole, type Env } from '../util.js'
import { ROLES, ROLE_SPECIALTY, can } from '../rbac.js'
import { notify } from '../notify.js'

export const projectRoutes = new Hono<Env>()
const dateStr = z.string().refine(isDate, 'Fecha inválida (AAAA-MM-DD)')

projectRoutes.get('/projects', (c) => {
  const u = c.get('user')
  const rows = q.all<any>(
    u.is_admin
      ? 'SELECT p.*, NULL as my_role FROM projects p ORDER BY p.created_at DESC'
      : 'SELECT p.*, m.role as my_role FROM projects p JOIN memberships m ON m.project_id=p.id AND m.user_id=? ORDER BY p.created_at DESC', ...(u.is_admin ? [] : [u.id]))
  return c.json(rows.map((p) => ({
    id: p.id, name: p.name, location: p.location, startDate: p.start_date, endDate: p.end_date, status: p.status,
    myRole: p.my_role ?? 'administrador',
    teamCount: q.get<any>('SELECT COUNT(*) n FROM memberships WHERE project_id=?', p.id).n,
    openTasks: q.get<any>("SELECT COUNT(*) n FROM tasks WHERE project_id=? AND status NOT IN ('aprobada')", p.id).n,
  })))
})

projectRoutes.post('/projects', async (c) => {
  const u = c.get('user'); needAdmin(u)
  const d = await body(c, z.object({ name: z.string().trim().min(3), location: z.string().trim().min(3), startDate: dateStr, endDate: dateStr, status: z.enum(['planificacion', 'en_ejecucion', 'pausado', 'terminado']).optional() }))
  if (d.endDate <= d.startDate) return fail(422, 'La fecha de fin debe ser posterior a la de inicio')
  const id = q.run('INSERT INTO projects(name,location,start_date,end_date,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
    d.name, d.location, d.startDate, d.endDate, d.status ?? 'planificacion', u.id, now()).id
  audit(u.id, 'project_create', 'project', id, d)
  return c.json({ id }, 201)
})

projectRoutes.get('/projects/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const role = needProject(u, id)
  const p = q.get<any>('SELECT * FROM projects WHERE id=?', id)
  const stats = q.get<any>(`SELECT COUNT(*) total, SUM(status='aprobada') approved, SUM(status IN ('hecha','aprobada')) done FROM tasks WHERE project_id=?`, id)
  return c.json({
    id, name: p.name, location: p.location, startDate: p.start_date, endDate: p.end_date, status: p.status, myRole: role,
    team: q.get<any>('SELECT COUNT(*) n FROM memberships WHERE project_id=?', id).n,
    tasks: { total: stats.total, done: stats.done ?? 0, approved: stats.approved ?? 0 },
  })
})

projectRoutes.patch('/projects/:id', async (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'project.edit')
  const d = await body(c, z.object({ name: z.string().trim().min(3).optional(), location: z.string().trim().min(3).optional(), startDate: dateStr.optional(), endDate: dateStr.optional(), status: z.enum(['planificacion', 'en_ejecucion', 'pausado', 'terminado']).optional() }))
  const p = q.get<any>('SELECT * FROM projects WHERE id=?', id)
  const next = { name: d.name ?? p.name, location: d.location ?? p.location, start: d.startDate ?? p.start_date, end: d.endDate ?? p.end_date, status: d.status ?? p.status }
  if (next.end <= next.start) return fail(422, 'La fecha de fin debe ser posterior a la de inicio')
  q.run('UPDATE projects SET name=?,location=?,start_date=?,end_date=?,status=? WHERE id=?', next.name, next.location, next.start, next.end, next.status, id)
  audit(u.id, 'project_update', 'project', id, d)
  return c.json({ ok: true })
})

// ---------- equipo (US-02, US-07) ----------
projectRoutes.get('/projects/:id/members', (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'members.view')
  return c.json(q.all(`SELECT m.user_id as userId, u.name, u.email, m.role, p.specialty, p.zone, p.phone
    FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN profiles p ON p.user_id=u.id WHERE m.project_id=? ORDER BY u.name`, id))
})
projectRoutes.post('/projects/:id/members', async (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'members.manage')
  const d = await body(c, z.object({ userId: z.number().int(), role: z.enum(ROLES) }))
  if (!q.get('SELECT 1 FROM users WHERE id=? AND active=1', d.userId)) return fail(404, 'Usuario no encontrado')
  if (q.get('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?', id, d.userId)) return fail(409, 'El usuario ya está en el proyecto')
  q.run('INSERT INTO memberships(project_id,user_id,role,created_at) VALUES(?,?,?,?)', id, d.userId, d.role, now())
  audit(u.id, 'member_add', 'project', id, d)
  notify(d.userId, { kind: 'member_add', ref: `member-${id}`, title: `Te agregaron a un proyecto como ${d.role}`, link: `/proyectos/${id}` })
  return c.json({ ok: true }, 201)
})
projectRoutes.patch('/projects/:id/members/:userId', async (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'members.manage')
  const userId = idParam(c, 'userId')
  const d = await body(c, z.object({ role: z.enum(ROLES) }))
  const cur = q.get<any>('SELECT role FROM memberships WHERE project_id=? AND user_id=?', id, userId)
  if (!cur) return fail(404, 'No es miembro del proyecto')
  q.run('UPDATE memberships SET role=? WHERE project_id=? AND user_id=?', d.role, id, userId)
  audit(u.id, 'role_change', 'project', id, { userId, from: cur.role, to: d.role })
  notify(userId, { kind: 'role_change', ref: `role-${id}-${d.role}-${Date.now()}`, title: `Tu rol cambió a ${d.role}`, link: `/proyectos/${id}` })
  return c.json({ ok: true })
})
projectRoutes.delete('/projects/:id/members/:userId', (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'members.manage')
  const userId = idParam(c, 'userId')
  q.tx(() => {
    q.run('UPDATE tasks SET assignee_id=NULL, status=CASE WHEN status IN (\'aprobada\',\'hecha\') THEN status ELSE \'pendiente\' END WHERE project_id=? AND assignee_id=?', id, userId)
    q.run('DELETE FROM memberships WHERE project_id=? AND user_id=?', id, userId)
  })
  audit(u.id, 'member_remove', 'project', id, { userId })
  return c.json({ ok: true })
})

// ---------- invitaciones (US-05) ----------
projectRoutes.post('/projects/:id/invites', async (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'invite.manage')
  const d = await body(c, z.object({ role: z.enum(ROLES), email: z.string().email().optional() }))
  const code = randomCode(12)
  q.run('INSERT INTO invites(code,project_id,role,email,created_by,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
    code, id, d.role, d.email?.toLowerCase() ?? null, u.id, new Date(Date.now() + 7 * 86400_000).toISOString(), now())
  audit(u.id, 'invite_create', 'project', id, { role: d.role })
  return c.json({ code, link: `/registro?codigo=${code}`, role: d.role, expiresInDays: 7 }, 201)
})
projectRoutes.get('/projects/:id/invites', (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'invite.manage')
  return c.json(q.all('SELECT code,role,email,expires_at as expiresAt,used_at as usedAt FROM invites WHERE project_id=? ORDER BY created_at DESC', id))
})
projectRoutes.post('/invites/:code/accept', (c) => {
  const u = c.get('user')
  const i = q.get<any>('SELECT * FROM invites WHERE code=?', c.req.param('code'))
  if (!i || i.used_at || i.expires_at < now()) return fail(404, 'Invitación inválida, usada o vencida')
  if (i.email && i.email !== u.email.toLowerCase()) return fail(403, 'La invitación es para otro correo')
  if (q.get('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?', i.project_id, u.id)) return fail(409, 'Ya perteneces al proyecto')
  q.tx(() => {
    q.run('INSERT INTO memberships(project_id,user_id,role,created_at) VALUES(?,?,?,?)', i.project_id, u.id, i.role, now())
    q.run('UPDATE invites SET used_by=?, used_at=? WHERE code=?', u.id, now(), i.code)
  })
  audit(u.id, 'invite_accept', 'project', i.project_id, { role: i.role })
  return c.json({ projectId: i.project_id })
})

// ---------- fases (US-08) ----------
projectRoutes.get('/projects/:id/phases', (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id)
  return c.json(q.all(`SELECT f.id,f.name,f.position,f.status,
      (SELECT COUNT(*) FROM tasks t WHERE t.phase_id=f.id) as tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.phase_id=f.id AND t.status='aprobada') as approved
    FROM phases f WHERE f.project_id=? ORDER BY f.position,f.id`, id))
})
projectRoutes.post('/projects/:id/phases', async (c) => {
  const u = c.get('user'); const id = idParam(c); needProject(u, id, 'phase.manage')
  const d = await body(c, z.object({ name: z.string().trim().min(2) }))
  const pos = (q.get<any>('SELECT COALESCE(MAX(position),0)+1 n FROM phases WHERE project_id=?', id)).n
  const r = q.run('INSERT INTO phases(project_id,name,position) VALUES(?,?,?)', id, d.name, pos)
  return c.json({ id: r.id }, 201)
})
projectRoutes.patch('/phases/:id', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const ph = q.get<any>('SELECT * FROM phases WHERE id=?', id)
  if (!ph) return fail(404, 'Fase no encontrada')
  needProject(u, ph.project_id, 'phase.manage')
  const d = await body(c, z.object({ name: z.string().trim().min(2).optional(), position: z.number().int().optional(), status: z.enum(['abierta', 'cerrada']).optional() }))
  if (d.status === 'cerrada') {
    const open = q.get<any>("SELECT COUNT(*) n FROM tasks WHERE phase_id=? AND status<>'aprobada'", id).n
    if (open) return fail(409, `La fase tiene ${open} tarea(s) sin aprobar`)
  }
  q.run('UPDATE phases SET name=?, position=?, status=? WHERE id=?', d.name ?? ph.name, d.position ?? ph.position, d.status ?? ph.status, id)
  return c.json({ ok: true })
})
projectRoutes.delete('/phases/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const ph = q.get<any>('SELECT * FROM phases WHERE id=?', id)
  if (!ph) return fail(404, 'Fase no encontrada')
  needProject(u, ph.project_id, 'phase.manage')
  q.run('DELETE FROM phases WHERE id=?', id)
  audit(u.id, 'delete', 'phase', id)
  return c.json({ ok: true })
})
void ROLE_SPECIALTY; void can; void projectRole
