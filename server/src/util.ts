import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { Context } from 'hono'
import type { ZodType } from 'zod'
import { q, now } from './db.js'
import { config } from './config.js'
import { can, ROLE_SPECIALTY, type Perm, type Role } from './rbac.js'

export type User = { id: number; email: string; name: string; is_admin: number; active: number }
export type Env = { Variables: { user: User } }

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 422, message: string): never => {
  throw new HTTPException(status, { message })
}

// ---------- contraseñas ----------
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [s, h] = stored.split(':')
  if (!s || !h) return false
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64)
  const expected = Buffer.from(h, 'hex')
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
}
export const randomCode = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url')

// ---------- validación ----------
export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let data: unknown
  try { data = await c.req.json() } catch { data = {} }
  return schema.parse(data)
}
export const idParam = (c: Context, name = 'id') => {
  const n = Number(c.req.param(name))
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Identificador inválido')
  return n
}

// ---------- permisos ----------
export function projectRole(user: User, projectId: number): Role | null {
  if (user.is_admin) return 'administrador'
  const m = q.get<{ role: Role }>('SELECT role FROM memberships WHERE project_id=? AND user_id=?', projectId, user.id)
  return m?.role ?? null
}
export function needProject(user: User, projectId: number, perm: Perm = 'project.view'): Role {
  const exists = q.get('SELECT id FROM projects WHERE id=?', projectId)
  if (!exists) return fail(404, 'Proyecto no encontrado')
  const r = projectRole(user, projectId)
  if (!r) return fail(403, 'No perteneces a este proyecto')
  if (!can(r, perm)) return fail(403, `Tu rol (${r}) no tiene permiso para esta acción`)
  return r
}
export function needAdmin(user: User) {
  if (!user.is_admin) fail(403, 'Solo el administrador del portal puede hacer esto')
}
/** ¿Tiene el usuario rol de gestión (administrador o supervisor) en algún proyecto? */
export function isManagerAnywhere(user: User): boolean {
  if (user.is_admin) return true
  return !!q.get("SELECT 1 FROM memberships WHERE user_id=? AND role IN ('administrador','supervisor')", user.id)
}
export const specialtyOf = (role: Role) => ROLE_SPECIALTY[role]

// ---------- auditoría ----------
export function audit(userId: number | null, action: string, entity: string, entityId: string | number | null, detail?: unknown) {
  q.run('INSERT INTO audit_log(user_id,action,entity,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)',
    userId, action, entity, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail) : null, now())
}

// ---------- archivos ----------
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']
export const FILE_KINDS = {
  image: IMAGE_EXT,
  evidence: [...IMAGE_EXT, 'pdf'],
  document: [...IMAGE_EXT, 'pdf', 'dwg', 'dxf'],
  survey: [...IMAGE_EXT, 'pdf', 'dwg', 'dxf', 'csv', 'txt', 'xlsx'],
} as const

export async function saveUpload(file: unknown, allowed: readonly string[], maxMb: number): Promise<{ filename: string; stored: string; mime: string; size: number }> {
  if (!(file instanceof File)) return fail(400, 'Falta el archivo')
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!allowed.includes(ext)) return fail(422, `Formato no permitido (.${ext}). Permitidos: ${allowed.join(', ')}`)
  if (file.size > maxMb * 1024 * 1024) return fail(422, `El archivo supera ${maxMb} MB`)
  const stored = `${crypto.randomUUID()}.${ext}`
  fs.mkdirSync(config.uploadDir, { recursive: true })
  fs.writeFileSync(path.join(config.uploadDir, stored), Buffer.from(await file.arrayBuffer()))
  return { filename: file.name.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_'), stored, mime: file.type || 'application/octet-stream', size: file.size }
}
export function addAttachment(a: { projectId?: number | null; entity: string; entityId?: number | null; kind?: string; file: { filename: string; stored: string; mime: string; size: number }; by: number }) {
  return q.run('INSERT INTO attachments(project_id,entity,entity_id,kind,filename,stored_name,mime,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    a.projectId ?? null, a.entity, a.entityId ?? null, a.kind ?? 'archivo', a.file.filename, a.file.stored, a.file.mime, a.file.size, a.by, now()).id
}
export function filesOf(c: Context, name = 'files') {
  return c.req.parseBody({ all: true }).then((form) => {
    const v = form[name]
    const list = Array.isArray(v) ? v : v ? [v] : []
    return { form, files: list.filter((x) => x instanceof File) as File[] }
  })
}

// ---------- fechas ----------
export const today = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10)
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
