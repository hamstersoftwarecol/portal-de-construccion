import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, login } from './helper.ts'

test('US-01 registro: el primer usuario es administrador y la sesión funciona', async () => {
  const r = await call('ana', 'POST', '/auth/register', { json: { name: 'Ana Admin', email: 'ana@x.co', password: 'secreta123' } })
  assert.equal(r.status, 201); assert.equal(r.data.user.isAdmin, true)
  const me = await call('ana', 'GET', '/auth/me'); assert.equal(me.status, 200); assert.equal(me.data.user.email, 'ana@x.co')
  const out = await call('ana', 'POST', '/auth/logout'); assert.equal(out.status, 200)
})
test('US-01 validaciones: contraseña corta, correo duplicado, credenciales malas, sin sesión', async () => {
  assert.equal((await call('x', 'POST', '/auth/register', { json: { name: 'Bob', email: 'bob@x.co', password: '123' } })).status, 400)
  assert.equal((await call('x', 'POST', '/auth/register', { json: { name: 'Ana 2', email: 'ana@x.co', password: 'secreta123' } })).status, 409)
  assert.equal((await call('ana', 'POST', '/auth/login', { json: { email: 'ana@x.co', password: 'mala-clave' } })).status, 401)
  assert.equal((await call(null, 'GET', '/projects')).status, 401)
  assert.equal((await call('ana', 'POST', '/auth/login', { json: { email: 'ana@x.co', password: 'secreta123' } })).status, 200)
})
test('US-05 invitaciones y US-04 restablecimiento con código de un solo uso', async () => {
  await call('ana', 'POST', '/auth/login', { json: { email: 'ana@x.co', password: 'secreta123' } })
  const p = await call('ana', 'POST', '/projects', { json: { name: 'Obra Uno', location: 'Cali, Valle', startDate: '2026-01-01', endDate: '2026-12-31' } })
  assert.equal(p.status, 201)
  const inv = await call('ana', 'POST', `/projects/${p.data.id}/invites`, { json: { role: 'plomero', email: 'pedro@x.co' } })
  assert.equal(inv.status, 201); assert.match(inv.data.link, /codigo=/)
  assert.equal((await call(null, 'GET', `/invites/${inv.data.code}`)).data.role, 'plomero')
  // correo equivocado
  assert.equal((await call('zz', 'POST', '/auth/register', { json: { name: 'Zed', email: 'zed@x.co', password: 'secreta123', code: inv.data.code } })).status, 422)
  const reg = await call('pedro', 'POST', '/auth/register', { json: { name: 'Pedro', email: 'pedro@x.co', password: 'secreta123', code: inv.data.code } })
  assert.equal(reg.status, 201)
  const me = await call('pedro', 'GET', '/auth/me'); assert.equal(me.data.memberships[0].role, 'plomero')
  // la invitación es de un solo uso
  assert.equal((await call('zz', 'POST', '/auth/register', { json: { name: 'Pedro 2', email: 'pedro@x.co', password: 'secreta123', code: inv.data.code } })).status, 409)
  assert.equal((await call(null, 'GET', `/invites/${inv.data.code}`)).status, 404)
  // reset
  const users = (await call('ana', 'GET', '/admin/users')).data
  const pedro = users.find((u: any) => u.email === 'pedro@x.co')
  assert.equal((await call('pedro', 'POST', `/admin/users/${pedro.id}/reset-code`)).status, 403)
  const rc = await call('ana', 'POST', `/admin/users/${pedro.id}/reset-code`)
  assert.equal(rc.data.expiresInHours, 24)
  assert.equal((await call(null, 'POST', '/auth/reset', { json: { code: rc.data.code, password: 'nuevaClave99' } })).status, 200)
  assert.equal((await call(null, 'POST', '/auth/reset', { json: { code: rc.data.code, password: 'otraClave99' } })).status, 422)
  assert.equal((await call('pedro', 'POST', '/auth/login', { json: { email: 'pedro@x.co', password: 'nuevaClave99' } })).status, 200)
  // desactivar usuario cierra sesión
  await call('ana', 'PATCH', `/admin/users/${pedro.id}`, { json: { active: false } })
  assert.equal((await call('pedro', 'GET', '/auth/me')).status, 401)
  void login
})
