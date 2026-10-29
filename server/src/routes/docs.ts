import { Hono } from 'hono'
import { z } from 'zod'
import { q, now } from '../db.js'
import { addAttachment, audit, body, fail, FILE_KINDS, filesOf, idParam, needProject, saveUpload, type Env, type User } from '../util.js'
import { ROLE_SPECIALTY, SPECIALTIES, can, type Role } from '../rbac.js'
import { notify, notifyMany } from '../notify.js'
import { createTask } from './tasks.js'
import { config } from '../config.js'

export const docRoutes = new Hono<Env>()

/** US-27: visibilidad por especialidad. Los roles técnicos ven todo; el resto, lo general y lo de su especialidad. */
export function canSeeDoc(role: Role, doc: { specialty: string | null }) {
  return can(role, 'doc.viewAll') || !doc.specialty || doc.specialty === ROLE_SPECIALTY[role]
}
function loadDoc(user: User, id: number, perm: Parameters<typeof needProject>[2] = 'project.view') {
  const doc = q.get<any>('SELECT * FROM documents WHERE id=?', id)
  if (!doc) return fail(404, 'Documento no encontrado')
  const role = needProject(user, doc.project_id, perm)
  if (!canSeeDoc(role, doc)) return fail(403, 'Este documento no es de tu especialidad')
  return { doc, role }
}
const docShape = (d: any) => ({
  id: d.id, projectId: d.project_id, title: d.title, specialty: d.specialty, status: d.status, createdAt: d.created_at,
  author: d.author, latestVersion: d.latest_version, latestAttachmentId: d.latest_attachment_id,
})
const LIST = `SELECT d.*, u.name as author,
  (SELECT MAX(version) FROM document_versions v WHERE v.document_id=d.id) as latest_version,
  (SELECT attachment_id FROM document_versions v WHERE v.document_id=d.id ORDER BY version DESC LIMIT 1) as latest_attachment_id
  FROM documents d LEFT JOIN users u ON u.id=d.created_by`

docRoutes.get('/projects/:id/documents', (c) => {
  const u = c.get('user'); const pid = idParam(c); const role = needProject(u, pid)
  return c.json(q.all<any>(`${LIST} WHERE d.project_id=? ORDER BY d.created_at DESC`, pid).filter((d) => canSeeDoc(role, d)).map(docShape))
})

docRoutes.post('/projects/:id/documents', async (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'doc.upload')
  const { form, files } = await filesOf(c, 'file')
  const title = String(form.title ?? '').trim()
  const spec = String(form.specialty ?? '').trim() || null
  if (title.length < 3) return fail(422, 'El título es obligatorio')
  if (spec && !(SPECIALTIES as readonly string[]).includes(spec)) return fail(422, 'Especialidad inválida')
  if (!files[0]) return fail(422, 'Adjunta el archivo (PDF, DWG, DXF o imagen)')
  const f = await saveUpload(files[0], FILE_KINDS.document, config.maxDocMb)
  const id = q.tx(() => {
    const docId = q.run('INSERT INTO documents(project_id,title,specialty,status,created_by,created_at) VALUES(?,?,?,?,?,?)', pid, title, spec, 'borrador', u.id, now()).id
    const att = addAttachment({ projectId: pid, entity: 'document_version', entityId: docId, kind: 'documento', file: f, by: u.id })
    q.run('INSERT INTO document_versions(document_id,version,attachment_id,notes,uploaded_by,created_at) VALUES(?,?,?,?,?,?)', docId, 1, att, String(form.notes ?? ''), u.id, now())
    return docId
  })
  audit(u.id, 'doc_create', 'document', id, { title })
  return c.json({ id }, 201)
})

docRoutes.get('/documents/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { doc } = loadDoc(u, id)
  const full = q.get<any>(`${LIST} WHERE d.id=?`, id)
  const versions = q.all(`SELECT v.version,v.notes,v.created_at as createdAt,u.name as author,a.id as attachmentId,a.filename,a.size,a.mime
    FROM document_versions v JOIN attachments a ON a.id=v.attachment_id LEFT JOIN users u ON u.id=v.uploaded_by WHERE v.document_id=? ORDER BY v.version DESC`, id)
  const comments = q.all(`SELECT c.id,c.version,c.body,c.created_at as createdAt,u.name as author FROM document_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.document_id=? ORDER BY c.id`, id)
  void doc
  return c.json({ ...docShape(full), versions, comments })
})

docRoutes.post('/documents/:id/versions', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { doc } = loadDoc(u, id, 'doc.upload')
  const { form, files } = await filesOf(c, 'file')
  if (!files[0]) return fail(422, 'Adjunta el archivo')
  const f = await saveUpload(files[0], FILE_KINDS.document, config.maxDocMb)
  const next = (q.get<any>('SELECT MAX(version) v FROM document_versions WHERE document_id=?', id).v ?? 0) + 1
  q.tx(() => {
    const att = addAttachment({ projectId: doc.project_id, entity: 'document_version', entityId: id, kind: 'documento', file: f, by: u.id })
    q.run('INSERT INTO document_versions(document_id,version,attachment_id,notes,uploaded_by,created_at) VALUES(?,?,?,?,?,?)', id, next, att, String(form.notes ?? ''), u.id, now())
    q.run("UPDATE documents SET status='borrador' WHERE id=?", id)
  })
  audit(u.id, 'doc_version', 'document', id, { version: next })
  return c.json({ version: next }, 201)
})

docRoutes.post('/documents/:id/status', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { doc, role } = loadDoc(u, id)
  const d = await body(c, z.object({ status: z.enum(['borrador', 'en_revision', 'aprobado']) }))
  const allowed: Record<string, string[]> = { borrador: ['en_revision'], en_revision: ['aprobado', 'borrador'], aprobado: ['borrador'] }
  if (!allowed[doc.status].includes(d.status)) return fail(409, `Transición no válida: ${doc.status} → ${d.status}`)
  if (d.status === 'en_revision' && !can(role, 'doc.upload')) return fail(403, 'Tu rol no puede enviar a revisión')
  if (d.status !== 'en_revision' && !can(role, 'doc.review')) return fail(403, 'Solo el arquitecto, el ingeniero civil o el administrador aprueban o devuelven documentos')
  q.run('UPDATE documents SET status=? WHERE id=?', d.status, id)
  audit(u.id, `doc_${d.status}`, 'document', id, { from: doc.status })
  if (d.status === 'en_revision') {
    const reviewers = q.all<any>("SELECT user_id FROM memberships WHERE project_id=? AND role IN ('arquitecto','ingeniero_civil','administrador')", doc.project_id).map((r) => r.user_id)
    notifyMany(reviewers.filter((x) => x !== u.id), { kind: 'doc_review', ref: `doc-${id}-review-${Date.now()}`, title: `Documento por revisar: ${doc.title}`, link: `/proyectos/${doc.project_id}?tab=documentos` })
  } else notify(doc.created_by, { kind: 'doc_status', ref: `doc-${id}-${d.status}-${Date.now()}`, title: `Documento ${d.status === 'aprobado' ? 'aprobado' : 'devuelto a borrador'}: ${doc.title}`, link: `/proyectos/${doc.project_id}?tab=documentos` })
  return c.json({ ok: true })
})

docRoutes.post('/documents/:id/comments', async (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { doc } = loadDoc(u, id)
  const d = await body(c, z.object({ body: z.string().trim().min(1), version: z.number().int().optional() }))
  const r = q.run('INSERT INTO document_comments(document_id,version,user_id,body,created_at) VALUES(?,?,?,?,?)', id, d.version ?? null, u.id, d.body, now())
  if (doc.created_by !== u.id) notify(doc.created_by, { kind: 'doc_comment', ref: `doc-comment-${r.id}`, title: `Comentario en "${doc.title}"`, body: d.body, link: `/proyectos/${doc.project_id}?tab=documentos` })
  return c.json({ id: r.id }, 201)
})

docRoutes.delete('/documents/:id', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const { doc } = loadDoc(u, id, 'project.edit')
  q.run('DELETE FROM documents WHERE id=?', id)
  audit(u.id, 'delete', 'document', id, { title: doc.title })
  return c.json({ ok: true })
})

// ---------- topografía (US-29) ----------
const surveySchema = z.object({
  kind: z.enum(['levantamiento', 'replanteo', 'nivel']), title: z.string().trim().min(3, 'El título es obligatorio'),
  x: z.coerce.number({ message: 'Coordenada X inválida' }), y: z.coerce.number({ message: 'Coordenada Y inválida' }), level: z.coerce.number({ message: 'Nivel inválido' }),
  notes: z.string().max(2000).optional(),
})
docRoutes.post('/projects/:id/survey', async (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'survey.write')
  const { form, files } = await filesOf(c)
  const d = surveySchema.parse({ kind: form.kind, title: form.title, x: form.x, y: form.y, level: form.level, notes: form.notes })
  const saved: Awaited<ReturnType<typeof saveUpload>>[] = []
  for (const f of files.slice(0, 5)) saved.push(await saveUpload(f, FILE_KINDS.survey, config.maxUploadMb))
  const id = q.tx(() => {
    const sid = q.run('INSERT INTO survey_records(project_id,kind,title,x,y,level,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', pid, d.kind, d.title, d.x, d.y, d.level, d.notes ?? '', u.id, now()).id
    for (const f of saved) addAttachment({ projectId: pid, entity: 'survey', entityId: sid, kind: 'topografia', file: f, by: u.id })
    return sid
  })
  audit(u.id, 'survey_create', 'survey', id, { kind: d.kind })
  return c.json({ id }, 201)
})
docRoutes.get('/projects/:id/survey', (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'survey.view')
  const rows = q.all<any>(`SELECT s.id,s.kind,s.title,s.x,s.y,s.level,s.notes,s.created_at as createdAt,u.name as author FROM survey_records s LEFT JOIN users u ON u.id=s.created_by WHERE s.project_id=? ORDER BY s.created_at DESC`, pid)
  const atts = q.all<any>("SELECT id,entity_id as entityId,filename FROM attachments WHERE entity='survey' AND project_id=?", pid)
  return c.json(rows.map((r) => ({ ...r, files: atts.filter((a) => a.entityId === r.id) })))
})

// ---------- no conformidades (US-30) ----------
docRoutes.post('/projects/:id/nonconformities', async (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'nc.write')
  const { form, files } = await filesOf(c)
  const d = z.object({
    title: z.string().trim().min(3, 'El título es obligatorio'), description: z.string().max(4000).optional(),
    severity: z.enum(['baja', 'media', 'alta', 'critica']).default('media'),
    createTask: z.preprocess((v) => v === 'true' || v === true || v === '1', z.boolean()),
    specialty: z.enum(SPECIALTIES).optional(), assigneeId: z.coerce.number().int().optional(), dueDate: z.string().optional(),
  }).parse({ title: form.title, description: form.description, severity: form.severity || undefined, createTask: form.createTask, specialty: form.specialty || undefined, assigneeId: form.assigneeId || undefined, dueDate: form.dueDate || undefined })
  if (!files.length) return fail(422, 'Adjunta una foto de la no conformidad')
  const saved: Awaited<ReturnType<typeof saveUpload>>[] = []
  for (const f of files.slice(0, 5)) saved.push(await saveUpload(f, FILE_KINDS.evidence, config.maxUploadMb))
  const out = q.tx(() => {
    const ncId = q.run('INSERT INTO nonconformities(project_id,title,description,severity,created_by,created_at) VALUES(?,?,?,?,?,?)', pid, d.title, d.description ?? '', d.severity, u.id, now()).id
    for (const f of saved) addAttachment({ projectId: pid, entity: 'nc', entityId: ncId, kind: 'foto', file: f, by: u.id })
    let taskId: number | null = null
    if (d.createTask) {
      if (!d.specialty) return fail(422, 'Indica la especialidad de la tarea correctiva')
      const due = d.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) ? d.dueDate : new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
      taskId = createTask(u, pid, { title: `Corregir: ${d.title}`, description: d.description ?? '', specialty: d.specialty, priority: d.severity, dueDate: due, assigneeId: d.assigneeId ?? null }, { ncId })
      q.run('UPDATE nonconformities SET task_id=? WHERE id=?', taskId, ncId)
    }
    return { ncId, taskId }
  })
  audit(u.id, 'nc_create', 'nonconformity', out.ncId, { taskId: out.taskId })
  return c.json({ id: out.ncId, taskId: out.taskId }, 201)
})
docRoutes.get('/projects/:id/nonconformities', (c) => {
  const u = c.get('user'); const pid = idParam(c); needProject(u, pid, 'nc.view')
  const rows = q.all<any>(`SELECT n.id,n.title,n.description,n.severity,n.status,n.task_id as taskId,n.created_at as createdAt,n.closed_at as closedAt,t.status as taskStatus,u.name as author
    FROM nonconformities n LEFT JOIN tasks t ON t.id=n.task_id LEFT JOIN users u ON u.id=n.created_by WHERE n.project_id=? ORDER BY n.created_at DESC`, pid)
  const atts = q.all<any>("SELECT id,entity_id as entityId,filename FROM attachments WHERE entity='nc' AND project_id=?", pid)
  return c.json(rows.map((r) => ({ ...r, files: atts.filter((a) => a.entityId === r.id) })))
})
docRoutes.post('/nonconformities/:id/close', (c) => {
  const u = c.get('user'); const id = idParam(c)
  const nc = q.get<any>('SELECT * FROM nonconformities WHERE id=?', id)
  if (!nc) return fail(404, 'No conformidad no encontrada')
  needProject(u, nc.project_id, 'nc.write')
  if (nc.status === 'cerrada') return fail(409, 'Ya está cerrada')
  if (nc.task_id) {
    const t = q.get<any>('SELECT status FROM tasks WHERE id=?', nc.task_id)
    if (t && t.status !== 'aprobada') return fail(409, 'La tarea correctiva aún no está aprobada')
  }
  q.run("UPDATE nonconformities SET status='cerrada', closed_at=? WHERE id=?", now(), id)
  audit(u.id, 'nc_close', 'nonconformity', id)
  return c.json({ ok: true })
})
