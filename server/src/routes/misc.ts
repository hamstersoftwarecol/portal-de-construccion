import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { q, now } from '../db.js'
import { config } from '../config.js'
import { body, fail, idParam, needProject, today, type Env } from '../util.js'
import { can } from '../rbac.js'
import { notifyMany } from '../notify.js'
import { loadTask } from './tasks.js'
import { canSeeDoc } from './docs.js'

export const miscRoutes = new Hono<Env>()

// ---------- archivos con control de acceso ----------
miscRoutes.get('/files/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const a = q.get<any>('SELECT * FROM attachments WHERE id=?', id)
  if (!a) return fail(404, 'Archivo no encontrado')
  if (a.entity === 'task') loadTask(u, a.entity_id)
  else if (a.entity === 'document_version') {
    const doc = q.get<any>('SELECT * FROM documents WHERE id=?', a.entity_id)
    const role = needProject(u, a.project_id)
    if (!doc || !canSeeDoc(role, doc)) return fail(403, 'Este documento no es de tu especialidad')
  } else if (a.project_id) needProject(u, a.project_id)
  const file = path.join(config.uploadDir, a.stored_name)
  if (!fs.existsSync(file)) return fail(404, 'El archivo ya no existe en el disco')
  const inline = /^(image\/|application\/pdf)/.test(a.mime)
  return new Response(fs.readFileSync(file), {
    headers: { 'Content-Type': a.mime, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`, 'Cache-Control': 'private, max-age=300' },
  })
})

// ---------- notificaciones in-app (US-32) ----------
miscRoutes.get('/notifications', (c) => {
  const u = c.get('user')
  const unread = c.req.query('unread') === '1'
  return c.json(q.all(`SELECT id,kind,title,body,link,read_at as readAt,created_at as createdAt FROM notifications WHERE user_id=? ${unread ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ${Math.min(200, Number(c.req.query('limit') ?? 50))}`, u.id))
})
miscRoutes.get('/notifications/count', (c) => c.json({ unread: q.get<any>('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL', c.get('user').id).n }))
miscRoutes.post('/notifications/read-all', (c) => {
  q.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), c.get('user').id)
  return c.json({ ok: true })
})
miscRoutes.post('/notifications/:id/read', (c) => {
  q.run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', now(), idParam(c), c.get('user').id)
  return c.json({ ok: true })
})

// ---------- comentarios y menciones (US-33) ----------
const commentTarget = (u: any, entity: string, entityId: number) => {
  if (entity === 'task') { const { t } = loadTask(u, entityId); return { projectId: t.project_id as number, link: `/tareas/${entityId}`, label: t.title as string } }
  const role = needProject(u, entityId); void role
  return { projectId: entityId, link: `/proyectos/${entityId}`, label: 'el proyecto' }
}
miscRoutes.get('/comments', (c) => {
  const u = c.get('user'); const entity = c.req.query('entity') ?? ''; const id = Number(c.req.query('id'))
  if (!['task', 'project'].includes(entity) || !id) return fail(400, 'Indica entity (task|project) e id')
  commentTarget(u, entity, id)
  return c.json(q.all('SELECT c.id,c.body,c.created_at as createdAt,u.name as author,u.id as authorId FROM comments c JOIN users u ON u.id=c.user_id WHERE c.entity=? AND c.entity_id=? ORDER BY c.id', entity, id))
})
miscRoutes.post('/comments', async (c) => {
  const u = c.get('user')
  const d = await body(c, z.object({ entity: z.enum(['task', 'project']), entityId: z.number().int(), body: z.string().trim().min(1).max(2000) }))
  const target = commentTarget(u, d.entity, d.entityId)
  needProject(u, target.projectId, 'comment.write')
  const r = q.run('INSERT INTO comments(entity,entity_id,project_id,user_id,body,created_at) VALUES(?,?,?,?,?,?)', d.entity, d.entityId, target.projectId, u.id, d.body, now())
  const handles = Array.from(new Set(Array.from(d.body.matchAll(/@([\w.\-]+)/g)).map((m) => m[1].toLowerCase())))
  if (handles.length) {
    const members = q.all<any>('SELECT u.id,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=?', target.projectId)
    const ids = members.filter((m) => handles.includes(m.email.split('@')[0].toLowerCase()) && m.id !== u.id).map((m) => m.id)
    notifyMany(ids, { kind: 'mention', ref: `mention-${r.id}`, title: `${u.name} te mencionó en ${target.label}`, body: d.body, link: target.link })
  }
  return c.json({ id: r.id }, 201)
})

// ---------- dashboard y carga de trabajo (US-34, US-35) ----------
miscRoutes.get('/projects/:id/dashboard', (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'dashboard.view')
  const done = "status IN ('hecha','aprobada')"
  const pct = (d: number, t: number) => (t ? Math.round((d / t) * 100) : 0)
  const phases = q.all<any>(`SELECT f.id as phaseId, f.name, COUNT(t.id) total, COALESCE(SUM(t.${done}),0) done FROM phases f LEFT JOIN tasks t ON t.phase_id=f.id WHERE f.project_id=? GROUP BY f.id ORDER BY f.position`, pid)
  const loose = q.get<any>(`SELECT COUNT(*) total, COALESCE(SUM(${done}),0) done FROM tasks WHERE project_id=? AND phase_id IS NULL`, pid)
  const byPhase = [...phases, ...(loose.total ? [{ phaseId: null, name: 'Sin fase', total: loose.total, done: loose.done }] : [])].map((p) => ({ ...p, percent: pct(p.done, p.total) }))
  const bySpecialty = q.all<any>(`SELECT specialty, COUNT(*) total, COALESCE(SUM(${done}),0) done FROM tasks WHERE project_id=? GROUP BY specialty ORDER BY specialty`, pid).map((p) => ({ ...p, percent: pct(p.done, p.total) }))
  const overdue = q.all(`SELECT t.id,t.title,t.due_date as dueDate,t.status,t.specialty,u.name as assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? AND t.due_date<? AND t.status NOT IN ('hecha','aprobada') ORDER BY t.due_date`, pid, today())
  const statusCounts = q.all<any>('SELECT status, COUNT(*) n FROM tasks WHERE project_id=? GROUP BY status', pid)
  const total = statusCounts.reduce((s, r) => s + r.n, 0)
  const doneN = statusCounts.filter((r) => ['hecha', 'aprobada'].includes(r.status)).reduce((s, r) => s + r.n, 0)
  return c.json({ total, done: doneN, percent: pct(doneN, total), statusCounts, byPhase, bySpecialty, overdue })
})
miscRoutes.get('/projects/:id/workload', (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'dashboard.view')
  const weekEnd = new Date(Date.now() + 7 * 86400_000).toISOString()
  const rows = q.all<any>(`SELECT m.user_id as userId, u.name, m.role,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=m.project_id AND t.assignee_id=m.user_id AND t.status IN ('pendiente','en_curso')) as openTasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=m.project_id AND t.assignee_id=m.user_id AND t.status='hecha') as awaitingReview,
      (SELECT COUNT(*) FROM appointments a WHERE a.project_id=m.project_id AND a.professional_id=m.user_id AND a.status='confirmada' AND a.start_at>=? AND a.start_at<=?) as appointmentsThisWeek
    FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY openTasks DESC, u.name`, now(), weekEnd, pid)
  return c.json(rows)
})

// ---------- reportes (US-36) ----------
miscRoutes.get('/projects/:id/report', async (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'report.export')
  const format = c.req.query('format') === 'pdf' ? 'pdf' : 'xlsx'
  const where = ['t.project_id=?']; const p: any[] = [pid]
  for (const [k, col] of [['phase', 't.phase_id'], ['specialty', 't.specialty'], ['status', 't.status']] as const) { const v = c.req.query(k); if (v) { where.push(`${col}=?`); p.push(v) } }
  const tasks = q.all<any>(`SELECT t.id,t.title,t.specialty,t.priority,t.due_date,t.status,u.name as assignee,f.name as phase
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN phases f ON f.id=t.phase_id WHERE ${where.join(' AND ')} ORDER BY f.position, t.due_date`, ...p)
  const proj = q.get<any>('SELECT * FROM projects WHERE id=?', pid)
  const doneN = tasks.filter((t) => ['hecha', 'aprobada'].includes(t.status)).length
  const percent = tasks.length ? Math.round((doneN / tasks.length) * 100) : 0
  const base = `reporte-${proj.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${today()}`
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook()
    const s1 = wb.addWorksheet('Resumen')
    s1.addRows([['Proyecto', proj.name], ['Ubicación', proj.location], ['Fecha del reporte', today()], ['Tareas', tasks.length], ['Hechas o aprobadas', doneN], ['Avance %', percent]])
    s1.getColumn(1).font = { bold: true }; s1.getColumn(1).width = 22; s1.getColumn(2).width = 40
    const s2 = wb.addWorksheet('Tareas')
    s2.columns = [{ header: 'ID', key: 'id', width: 6 }, { header: 'Tarea', key: 'title', width: 44 }, { header: 'Fase', key: 'phase', width: 18 }, { header: 'Especialidad', key: 'specialty', width: 18 },
      { header: 'Prioridad', key: 'priority', width: 12 }, { header: 'Vence', key: 'due_date', width: 12 }, { header: 'Estado', key: 'status', width: 12 }, { header: 'Responsable', key: 'assignee', width: 24 }]
    s2.getRow(1).font = { bold: true }
    tasks.forEach((t) => s2.addRow(t))
    const buf = Buffer.from(await wb.xlsx.writeBuffer())
    return new Response(buf, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"` } })
  }
  const doc = new PDFDocument({ margin: 40, size: 'A4' })
  const chunks: Buffer[] = []
  doc.on('data', (d) => chunks.push(d))
  const finished = new Promise<void>((r) => doc.on('end', () => r()))
  doc.fontSize(18).text(`Reporte de avance: ${proj.name}`).moveDown(0.3)
  doc.fontSize(10).fillColor('#555').text(`${proj.location} · ${today()} · ${tasks.length} tareas · ${percent}% hechas o aprobadas`).fillColor('#000').moveDown()
  for (const t of tasks) {
    if (doc.y > 760) doc.addPage()
    doc.fontSize(10).text(`#${t.id} ${t.title}`, { continued: false })
    doc.fontSize(8).fillColor('#555').text(`${t.phase ?? 'Sin fase'} · ${t.specialty} · ${t.priority} · vence ${t.due_date} · ${t.status} · ${t.assignee ?? 'sin asignar'}`).fillColor('#000').moveDown(0.4)
  }
  doc.end(); await finished
  return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${base}.pdf"` } })
})
void can
