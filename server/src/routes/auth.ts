import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { z } from 'zod'
import { q, now } from '../db.js'
import { config } from '../config.js'
import { audit, body, fail, hashPassword, randomCode, verifyPassword, type Env, type User } from '../util.js'
import { ROLES } from '../rbac.js'

export const authRoutes = new Hono<Env>()

const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin })

export function createSession(c: any, userId: number) {
  const token = randomCode(32)
  const expires = new Date(Date.now() + config.sessionDays * 86400_000)
  q.run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', token, userId, expires.toISOString())
  setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', path: '/', expires })
}

/** Middleware: exige sesión válida. */
export const requireAuth = async (c: any, next: any) => {
  const token = getCookie(c, 'sid')
  if (!token) return fail(401, 'Inicia sesión para continuar')
  const row = q.get<any>(
    'SELECT u.id,u.email,u.name,u.is_admin,u.active,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', token)
  if (!row || row.expires_at < now()) return fail(401, 'Tu sesión expiró')
  if (!row.active) return fail(403, 'Usuario desactivado')
  c.set('user', row as User)
  await next()
}

const pw = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres')

authRoutes.post('/auth/register', async (c) => {
  const data = await body(c, z.object({ name: z.string().trim().min(2), email: z.string().trim().toLowerCase().email(), password: pw, code: z.string().optional() }))
  if (q.get('SELECT 1 FROM users WHERE email=?', data.email)) return fail(409, 'Ya existe un usuario con ese correo')
  const first = !q.get('SELECT 1 FROM users LIMIT 1')
  let invite: any
  if (data.code) {
    invite = q.get('SELECT * FROM invites WHERE code=?', data.code)
    if (!invite || invite.used_at || invite.expires_at < now()) return fail(422, 'Invitación inválida, usada o vencida')
    if (invite.email && invite.email.toLowerCase() !== data.email) return fail(422, 'La invitación es para otro correo')
  } else if (!first && !config.allowOpenRegistration) return fail(403, 'El registro requiere una invitación')
  const userId = q.tx(() => {
    const id = q.run('INSERT INTO users(email,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)', data.email, data.name, hashPassword(data.password), first ? 1 : 0, now()).id
    if (invite) {
      q.run('INSERT INTO memberships(project_id,user_id,role,created_at) VALUES(?,?,?,?)', invite.project_id, id, invite.role, now())
      q.run('UPDATE invites SET used_by=?, used_at=? WHERE code=?', id, now(), invite.code)
    }
    return id
  })
  audit(userId, 'register', 'user', userId, { invite: data.code ? invite.role : null })
  createSession(c, userId)
  return c.json({ user: publicUser(q.get('SELECT * FROM users WHERE id=?', userId)) }, 201)
})

authRoutes.post('/auth/login', async (c) => {
  const data = await body(c, z.object({ email: z.string().trim().toLowerCase(), password: z.string() }))
  const u = q.get<any>('SELECT * FROM users WHERE email=?', data.email)
  if (!u || !verifyPassword(data.password, u.password_hash)) return fail(401, 'Correo o contraseña incorrectos')
  if (!u.active) return fail(403, 'Usuario desactivado')
  createSession(c, u.id)
  return c.json({ user: publicUser(u) })
})

authRoutes.post('/auth/logout', async (c) => {
  const token = getCookie(c, 'sid')
  if (token) q.run('DELETE FROM sessions WHERE token=?', token)
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

authRoutes.get('/auth/me', requireAuth, (c) => {
  const u = c.get('user')
  const memberships = q.all(
    'SELECT m.project_id as projectId, m.role, p.name FROM memberships m JOIN projects p ON p.id=m.project_id WHERE m.user_id=?', u.id)
  return c.json({ user: publicUser(u), memberships })
})

// US-04: el administrador genera un código temporal de un solo uso (24 h)
authRoutes.post('/auth/reset', async (c) => {
  const data = await body(c, z.object({ code: z.string(), password: pw }))
  const r = q.get<any>('SELECT * FROM reset_codes WHERE code=?', data.code)
  if (!r || r.used_at || r.expires_at < now()) return fail(422, 'Código inválido, usado o vencido')
  q.tx(() => {
    q.run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(data.password), r.user_id)
    q.run('UPDATE reset_codes SET used_at=? WHERE code=?', now(), data.code)
    q.run('DELETE FROM sessions WHERE user_id=?', r.user_id)
  })
  audit(r.user_id, 'password_reset', 'user', r.user_id)
  return c.json({ ok: true })
})

authRoutes.get('/invites/:code', (c) => {
  const i = q.get<any>('SELECT i.role,i.email,i.expires_at,i.used_at,p.name project FROM invites i JOIN projects p ON p.id=i.project_id WHERE i.code=?', c.req.param('code'))
  if (!i || i.used_at || i.expires_at < now()) return fail(404, 'Invitación inválida, usada o vencida')
  return c.json({ role: i.role, project: i.project, email: i.email })
})

export const ROLE_LIST = ROLES
