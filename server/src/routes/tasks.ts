import { Hono } from 'hono'
import { z } from 'zod'
import { q, now } from '../db.js'
import { addAttachment, audit, body, fail, FILE_KINDS, filesOf, idParam, isDate, needProject, saveUpload, today, type Env, type User } from '../util.js'
import { PERMS, ROLE_SPECIALTY, SPECIALTIES, can, type Role } from '../rbac.js'
import { notify, notifyMany } from '../notify.js'
import { config } from '../config.js'

export const taskRoutes = new Hono<Env>()

const SELECT = `SELECT t.*, u.name as assignee_name, f.name as phase_name, p.name as project_name,
  (SELECT COUNT(*) FROM task_deps d JOIN tasks x ON x.id=d.depends_on WHERE d.task_id=t.id AND x.status NOT IN ('hecha','aprobada')) as pending_deps
  FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN phases f ON f.id=t.phase_id JOIN projects p ON p.id=t.project_id`
const shape = (t: any) => ({
  id: t.id, projectId: t.project_id, projectName: t.project_name, phaseId: t.phase_id, phaseName: t.phase_name, title: t.title, description: t.description,
  specialty: t.specialty, priority: t.priority, dueDate: t.due_date, status: t.status, assigneeId: t.assignee_id, assigneeName: t.assignee_name,
  reviewComment: t.review_comment, ncId: t.nc_id, blocked: t.pending_deps > 0 && t.status === 'pendiente',
  overdue: t.due_date < today() && !['hecha', 'aprobada'].includes(t.status),
})

/** Carga la tarea y verifica que el usuario pueda verla: roles técnicos ven todo el proyecto; el resto, solo lo asignado. */
export function loadTask(user: User, id: number, perm: Parameters<typeof needProject>[2] = 'project.view') {
  const t = q.get<any>(`${SELECT} WHERE t.id=?`, id)
  if (!t) return fail(404, 'Tarea no encontrada')
  const role = needProject(user, t.project_id, perm)
  if (!can(role, 'task.viewAll') && t.assignee_id !== user.id) return fail(403, 'Solo ves las tareas asignadas a ti')
  return { t, role }
}

export function assignable(projectId: number, userId: number, specialty: string): boolean {
  const m = q.get<{ role: Role }>('SELECT role FROM memberships WHERE project_id=? AND user_id=?', projectId, userId)
  if (!m) return false
  return specialty === 'gestion' || ROLE_SPECIALTY[m.role] === specialty
}

const taskBody = z.object({
  title: z.string().trim().min(3, 'El título es obligatorio'), description: z.string().max(4000).optional(),
  specialty: z.enum(SPECIALTIES), priority: z.enum(['baja', 'media', 'alta', 'critica']).optional(),
  dueDate: z.string().refine(isDate, 'Fecha límite inválida'), phaseId: z.number().int().nullable().optional(),
  assigneeId: z.number().int().nullable().optional(),
})

function checkPhase(projectId: number, phaseId?: number | null) {
  if (!phaseId) return
  const f = q.get<any>('SELECT * FROM phases WHERE id=? AND project_id=?', phaseId, projectId)
  if (!f) fail(422, 'La fase no pertenece al proyecto')
  else if (f.status === 'cerrada') fail(409, 'La fase está cerrada')
}

export function createTask(user: User, projectId: number, d: z.infer<typeof taskBody>, extra: { ncId?: number } = {}) {
  checkPhase(projectId, d.phaseId)
  if (d.assigneeId && !assignable(projectId, d.assigneeId, d.specialty)) fail(422, 'La persona no es del proyecto o no tiene la especialidad requerida')
  const id = q.run(`INSERT INTO tasks(project_id,phase_id,title,description,specialty,priority,due_date,status,assignee_id,created_by,nc_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'pendiente',?,?,?,?,?)`, projectId, d.phaseId ?? null, d.title, d.description ?? '', d.specialty, d.priority ?? 'media', d.dueDate,
    d.assigneeId ?? null, user.id, extra.ncId ?? null, now(), now()).id
  q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'creada','Tarea creada',?)", id, user.id, now())
  if (d.assigneeId) notify(d.assigneeId, { kind: 'task_assigned', ref: `task-${id}-assigned-${d.assigneeId}`, title: `Nueva tarea: ${d.title}`, body: `Vence ${d.dueDate}`, link: `/tareas/${id}` })
  audit(user.id, 'task_create', 'task', id, { title: d.title })
  return id
}

taskRoutes.get('/projects/:id/tasks', (c) => {
  const u = c.get('user'); const pid = idParam(c); const role = needProject(u, pid)
  const where = ['t.project_id=?']; const p: any[] = [pid]
  if (!can(role, 'task.viewAll')) { where.push('t.assignee_id=?'); p.push(u.id) }
  for (const [qs, col] of [['status', 't.status'], ['specialty', 't.specialty'], ['assignee', 't.assignee_id'], ['phase', 't.phase_id']] as const) {
    const v = c.req.query(qs); if (v) { where.push(`${col}=?`); p.push(v) }
  }
  if (c.req.query('overdue') === '1') { where.push("t.due_date<? AND t.status NOT IN ('hecha','aprobada')"); p.push(today()) }
  return c.json(q.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE t.status WHEN 'hecha' THEN 0 WHEN 'en_curso' THEN 1 WHEN 'pendiente' THEN 2 ELSE 3 END, t.due_date`, ...p).map(shape))
})

taskRoutes.get('/tasks/mine', (c) => {
  const u = c.get('user')
  return c.json(q.all(`${SELECT} WHERE t.assignee_id=? ORDER BY CASE t.status WHEN 'aprobada' THEN 1 ELSE 0 END, t.due_date`, u.id).map(shape))
})

taskRoutes.post('/projects/:id/tasks', async (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'task.create')
  const d = await body(c, taskBody)
  const id = createTask(u, pid, d)
  return c.json({ id }, 201)
})

taskRoutes.get('/tasks/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t, role } = loadTask(u, id)
  const deps = q.all(`SELECT x.id,x.title,x.status FROM task_deps d JOIN tasks x ON x.id=d.depends_on WHERE d.task_id=?`, id)
  const dependents = q.all(`SELECT x.id,x.title,x.status FROM task_deps d JOIN tasks x ON x.id=d.task_id WHERE d.depends_on=?`, id)
  const events = q.all(`SELECT e.id,e.kind,e.body,e.created_at as createdAt,u.name as user FROM task_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.task_id=? ORDER BY e.id`, id)
  const attachments = q.all(`SELECT id,kind,filename,mime,size,entity_id as taskId,created_at as createdAt FROM attachments WHERE entity='task' AND entity_id=? ORDER BY id`, id)
  const appointments = q.all(`SELECT a.id,a.start_at as startAt,a.end_at as endAt,a.status,a.kind,u.name as professional FROM appointments a JOIN users u ON u.id=a.professional_id WHERE a.task_id=? ORDER BY a.start_at`, id)
  return c.json({ ...shape(t), deps, dependents, events, attachments, appointments, myRole: role })
})

taskRoutes.patch('/tasks/:id', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t } = loadTask(u, id, 'task.create')
  const d = await body(c, taskBody.partial())
  const next = { ...t, title: d.title ?? t.title, description: d.description ?? t.description, specialty: d.specialty ?? t.specialty, priority: d.priority ?? t.priority,
    due_date: d.dueDate ?? t.due_date, phase_id: d.phaseId === undefined ? t.phase_id : d.phaseId }
  checkPhase(t.project_id, d.phaseId)
  if (t.assignee_id && d.specialty && !assignable(t.project_id, t.assignee_id, d.specialty)) return fail(422, 'El responsable actual no tiene la nueva especialidad; reasigna primero')
  q.run('UPDATE tasks SET title=?,description=?,specialty=?,priority=?,due_date=?,phase_id=?,updated_at=? WHERE id=?',
    next.title, next.description, next.specialty, next.priority, next.due_date, next.phase_id, now(), id)
  audit(u.id, 'task_update', 'task', id, d)
  return c.json({ ok: true })
})

taskRoutes.delete('/tasks/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  loadTask(u, id, 'task.create')
  q.run('DELETE FROM tasks WHERE id=?', id)
  audit(u.id, 'delete', 'task', id)
  return c.json({ ok: true })
})

taskRoutes.post('/tasks/:id/assign', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t } = loadTask(u, id, 'task.assign')
  const d = await body(c, z.object({ assigneeId: z.number().int().nullable() }))
  if (t.status === 'aprobada') return fail(409, 'La tarea ya fue aprobada')
  if (d.assigneeId && !assignable(t.project_id, d.assigneeId, t.specialty)) return fail(422, 'La persona no es del proyecto o no tiene la especialidad requerida')
  q.run('UPDATE tasks SET assignee_id=?, updated_at=? WHERE id=?', d.assigneeId, now(), id)
  const name = d.assigneeId ? q.get<any>('SELECT name FROM users WHERE id=?', d.assigneeId).name : 'sin asignar'
  q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'asignada',?,?)", id, u.id, `Asignada a ${name}`, now())
  if (d.assigneeId) notify(d.assigneeId, { kind: 'task_assigned', ref: `task-${id}-assigned-${d.assigneeId}`, title: `Te asignaron: ${t.title}`, body: `Vence ${t.due_date}`, link: `/tareas/${id}` })
  audit(u.id, 'task_assign', 'task', id, d)
  return c.json({ ok: true })
})

const NEXT: Record<string, string[]> = { pendiente: ['en_curso'], en_curso: ['hecha', 'pendiente'], hecha: ['en_curso'], aprobada: [] }

taskRoutes.post('/tasks/:id/status', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t, role } = loadTask(u, id)
  const d = await body(c, z.object({ status: z.enum(['pendiente', 'en_curso', 'hecha']) }))
  const isOwner = t.assignee_id === u.id
  if (!isOwner && !can(role, 'task.review')) return fail(403, 'Solo el responsable o un supervisor cambia el estado')
  if (!NEXT[t.status].includes(d.status)) return fail(409, `Transición no válida: ${t.status} → ${d.status}`)
  if (d.status === 'hecha' && !isOwner && role !== 'administrador' && role !== 'supervisor') return fail(403, 'No puedes marcarla como hecha')
  if (d.status === 'en_curso') {
    const pending = q.all<any>(`SELECT x.title FROM task_deps d JOIN tasks x ON x.id=d.depends_on WHERE d.task_id=? AND x.status NOT IN ('hecha','aprobada')`, id)
    if (pending.length) return fail(409, `Bloqueada por: ${pending.map((p) => p.title).join(', ')}`)
  }
  q.run('UPDATE tasks SET status=?, updated_at=? WHERE id=?', d.status, now(), id)
  q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'estado',?,?)", id, u.id, `${t.status} → ${d.status}`, now())
  if (d.status === 'hecha') {
    const reviewers = q.all<any>("SELECT user_id FROM memberships WHERE project_id=? AND role IN ('administrador','supervisor')", t.project_id).map((r) => r.user_id)
    notifyMany([...reviewers, t.created_by].filter((x) => x !== u.id), { kind: 'task_done', ref: `task-${id}-done-${Date.now()}`, title: `Lista para revisión: ${t.title}`, link: `/tareas/${id}` })
  }
  return c.json({ ok: true, status: d.status })
})

taskRoutes.post('/tasks/:id/review', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t } = loadTask(u, id, 'task.review')
  const d = await body(c, z.object({ approve: z.boolean(), comment: z.string().trim().optional() }))
  if (t.status !== 'hecha') return fail(409, 'Solo se revisan tareas marcadas como hechas')
  if (!d.approve && !d.comment) return fail(422, 'El rechazo exige un comentario')
  const status = d.approve ? 'aprobada' : 'en_curso'
  q.run('UPDATE tasks SET status=?, review_comment=?, updated_at=? WHERE id=?', status, d.comment ?? null, now(), id)
  q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,?,?,?)", id, u.id, d.approve ? 'aprobada' : 'rechazada', d.comment ?? '', now())
  audit(u.id, d.approve ? 'task_approve' : 'task_reject', 'task', id, { comment: d.comment })
  notify(t.assignee_id, { kind: 'task_review', ref: `task-${id}-review-${Date.now()}`, title: d.approve ? `Aprobada: ${t.title}` : `Rechazada: ${t.title}`, body: d.comment, link: `/tareas/${id}` })
  if (d.approve && t.nc_id) {
    const nc = q.get<any>('SELECT * FROM nonconformities WHERE id=?', t.nc_id)
    if (nc) notify(nc.created_by, { kind: 'nc_ready', ref: `nc-${nc.id}-ready`, title: `Ya puedes cerrar la no conformidad: ${nc.title}`, link: `/proyectos/${t.project_id}?tab=calidad` })
  }
  return c.json({ ok: true, status })
})

taskRoutes.post('/tasks/:id/progress', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t } = loadTask(u, id, 'task.progress')
  const { form, files } = await filesOf(c)
  const text = String(form.body ?? '').trim()
  if (!text && !files.length) return fail(422, 'Escribe un comentario o adjunta una foto')
  if (files.length > 5) return fail(422, 'Máximo 5 fotos por registro')
  const saved: Awaited<ReturnType<typeof saveUpload>>[] = []
  for (const f of files) saved.push(await saveUpload(f, FILE_KINDS.image, config.maxUploadMb))
  q.tx(() => {
    for (const f of saved) addAttachment({ projectId: t.project_id, entity: 'task', entityId: id, kind: 'avance', file: f, by: u.id })
    q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'avance',?,?)", id, u.id, text || `${saved.length} foto(s)`, now())
  })
  return c.json({ ok: true, photos: saved.length }, 201)
})

// US-28: certificados y pruebas adjuntas a la tarea
taskRoutes.post('/tasks/:id/attachments', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t, role } = loadTask(u, id, 'task.progress')
  if (t.assignee_id !== u.id && !can(role, 'task.review') && !can(role, 'task.viewAll')) return fail(403, 'Solo el responsable o un supervisor adjunta certificados')
  const { files } = await filesOf(c)
  if (!files.length) return fail(422, 'Adjunta al menos un archivo PDF o imagen')
  const ids: number[] = []
  for (const f of files.slice(0, 5)) {
    const s = await saveUpload(f, FILE_KINDS.evidence, config.maxUploadMb)
    ids.push(addAttachment({ projectId: t.project_id, entity: 'task', entityId: id, kind: 'certificado', file: s, by: u.id }))
  }
  q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'certificado',?,?)", id, u.id, `${ids.length} certificado(s) adjunto(s)`, now())
  return c.json({ ids }, 201)
})

// ---------- dependencias (US-18) ----------
function reaches(from: number, target: number, seen = new Set<number>()): boolean {
  if (from === target) return true
  if (seen.has(from)) return false
  seen.add(from)
  return q.all<any>('SELECT depends_on FROM task_deps WHERE task_id=?', from).some((r) => reaches(r.depends_on, target, seen))
}
taskRoutes.post('/tasks/:id/deps', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { t, role } = loadTask(u, id)
  if (!can(role, 'dep.manage')) return fail(403, 'Tu rol no puede declarar dependencias')
  if (t.assignee_id !== u.id && !can(role, 'task.viewAll')) return fail(403, 'Solo el responsable o un rol técnico declara dependencias')
  const d = await body(c, z.object({ dependsOn: z.number().int() }))
  const other = q.get<any>('SELECT * FROM tasks WHERE id=?', d.dependsOn)
  if (!other || other.project_id !== t.project_id) return fail(422, 'La tarea de la que depende debe ser del mismo proyecto')
  if (d.dependsOn === id) return fail(422, 'Una tarea no puede depender de sí misma')
  if (reaches(d.dependsOn, id)) return fail(409, 'Esa dependencia crearía un ciclo')
  q.run('INSERT OR IGNORE INTO task_deps(task_id,depends_on) VALUES(?,?)', id, d.dependsOn)
  q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'dependencia',?,?)", id, u.id, `Depende de #${d.dependsOn} ${other.title}`, now())
  return c.json({ ok: true }, 201)
})
taskRoutes.delete('/tasks/:id/deps/:dep', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { role, t } = loadTask(u, id)
  if (!can(role, 'dep.manage') || (t.assignee_id !== u.id && !can(role, 'task.viewAll'))) return fail(403, 'Sin permiso para quitar dependencias')
  q.run('DELETE FROM task_deps WHERE task_id=? AND depends_on=?', id, idParam(c, 'dep'))
  return c.json({ ok: true })
})
void PERMS
