import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { bootstrap, call, ids } from './helper.ts'
import { q } from '../src/db.ts'
import { handleCalendlyEvent, verifyCalendlySignature, getProvider, activeProviderName } from '../src/providers/scheduling.ts'
import { runMaintenance } from '../src/maintenance.ts'
import { flushOutbox } from '../src/notify.ts'

before(bootstrap)

test('US-10 perfil y certificaciones; US-12 verificación y aviso de vencimiento', async () => {
  assert.equal((await call('plomero', 'PUT', '/profile', { json: { specialty: 'astronauta' } })).status, 400)
  const p = await call('plomero', 'PUT', '/profile', { json: { zone: 'Soacha y Bogotá sur', bio: '15 años de experiencia', phone: '3101112233' } })
  assert.equal(p.data.zone, 'Soacha y Bogotá sur')
  const c = await call('plomero', 'POST', '/certifications', { json: { name: 'Gas natural domiciliario', number: 'GN-77', expiresAt: new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10) } })
  assert.equal(c.status, 201)
  assert.equal((await call('plomero', 'POST', '/certifications', { json: { name: 'x', number: '1', expiresAt: 'ayer' } })).status, 400)
  assert.equal((await call('supervisor', 'PATCH', `/certifications/${c.data.id}/review`, { json: { status: 'verificada' } })).status, 403)
  assert.equal((await call('admin', 'PATCH', `/certifications/${c.data.id}/review`, { json: { status: 'verificada' } })).status, 200)
  assert.ok((await call('plomero', 'GET', '/notifications')).data.some((n: any) => n.title.includes('fue verificada')))
  runMaintenance()
  assert.ok((await call('plomero', 'GET', '/notifications')).data.some((n: any) => n.title.startsWith('Certificación por vencer')))
  assert.ok((await call('admin', 'GET', '/notifications')).data.some((n: any) => n.kind === 'cert_expiry_admin'))
  const before = (await call('plomero', 'GET', '/notifications')).data.length; runMaintenance()
  assert.equal((await call('plomero', 'GET', '/notifications')).data.length, before)
  // vencida: se informa como tal en el perfil
  q.run("UPDATE certifications SET expires_at='2020-01-01' WHERE id=?", c.data.id)
  assert.equal((await call('plomero', 'GET', '/profile')).data.certifications.find((x: any) => x.id === c.data.id).effectiveStatus, 'vencida')
  const pend = (await call('admin', 'GET', '/admin/certifications?status=pendiente')).data
  assert.ok(pend.every((x: any) => x.status === 'pendiente'))
  assert.equal((await call('plomero', 'GET', `/profile/${ids.arquitecto}`)).status, 200) // comparten proyecto
  assert.equal((await call('plomero', 'POST', '/profile/photo', { form: (() => { const f = new FormData(); f.append('file', new File([new Uint8Array(5)], 'a.png', { type: 'image/png' })); return f })() })).status, 200)
})

test('US-34/35/36 dashboard, carga de trabajo y reportes PDF/Excel', async () => {
  const d = (await call('admin', 'GET', '/projects/1/dashboard')).data
  assert.equal(d.total, 8); assert.equal(d.byPhase.length, 4)
  const cim = d.byPhase.find((p: any) => p.name === 'Cimentación'); assert.equal(cim.percent, 100)
  assert.ok(d.overdue.some((t: any) => t.title.includes('planos de fachada')))       // vencida y sin terminar
  assert.ok(d.bySpecialty.length >= 5 && typeof d.percent === 'number')
  const w = (await call('supervisor', 'GET', '/projects/1/workload')).data
  assert.equal(w.length, 9); assert.ok(w.every((r: any) => 'openTasks' in r && 'appointmentsThisWeek' in r))
  const x = await call('admin', 'GET', '/projects/1/report?format=xlsx&specialty=soldadura')
  assert.equal(x.status, 200); assert.equal(x.data.subarray(0, 2).toString(), 'PK'); assert.match(x.headers.get('content-disposition')!, /\.xlsx/)
  const pdf = await call('admin', 'GET', '/projects/1/report?format=pdf&status=pendiente')
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF'); assert.match(pdf.headers.get('content-type')!, /pdf/)
})

test('US-40 auditoría: roles, aprobaciones, borrados y reinicios quedan registrados', async () => {
  await call('admin', 'PATCH', `/projects/1/members/${ids.colaborador}`, { json: { role: 'supervisor' } })
  await call('admin', 'PATCH', `/projects/1/members/${ids.colaborador}`, { json: { role: 'colaborador' } })
  await call('supervisor', 'POST', '/tasks/3/review', { json: { approve: true } })      // 409: no cuenta
  await call('admin', 'POST', `/admin/users/${ids.plomero}/reset-code`)
  const log = (await call('admin', 'GET', '/admin/audit?limit=200')).data
  const actions = new Set(log.map((r: any) => r.action))
  for (const a of ['role_change', 'reset_code']) assert.ok(actions.has(a), a)
  const rc = log.find((r: any) => r.action === 'role_change'); assert.ok(rc.user && rc.createdAt && rc.detail)
  assert.equal((await call('supervisor', 'GET', '/admin/audit')).status, 403)
})

test('Respaldo con un comando y restauración posible', async () => {
  const b = (await call('admin', 'POST', '/admin/backup')).data
  assert.ok(fs.existsSync(b.file) && b.bytes > 10_000)
})

test('US-24/41/43 proveedores intercambiables: local por defecto; Calendly exige conexión', async () => {
  assert.equal(activeProviderName(), 'local'); assert.equal(getProvider().name, 'local')
  assert.equal((await call('admin', 'PUT', '/admin/settings', { json: { schedulingProvider: 'calendly' } })).status, 422)
  const s = (await call('admin', 'GET', '/admin/settings')).data
  assert.equal(s.schedulingProvider, 'local'); assert.equal(s.calendlyConnected, false); assert.deepEqual(s.notifyChannels, ['inapp'])
  assert.equal((await call('admin', 'GET', '/integrations/calendly/connect')).status, 422) // sin credenciales OAuth
  assert.equal((await call('supervisor', 'PUT', '/admin/settings', { json: { notifyChannels: ['email'] } })).status, 403)
})

test('US-43 canales de notificación: email y WhatsApp usan el outbox y se entregan si hay credenciales', async () => {
  assert.equal((await call('admin', 'PUT', '/admin/settings', { json: { notifyChannels: ['email', 'whatsapp'] } })).status, 200)
  assert.deepEqual((await call('admin', 'GET', '/admin/settings')).data.notifyChannels, ['inapp', 'email', 'whatsapp'])
  await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'Tarea con aviso', specialty: 'plomeria', dueDate: '2030-01-01', assigneeId: ids.plomero } })
  const out = (await call('admin', 'GET', '/admin/outbox')).data
  assert.ok(out.some((o: any) => o.channel === 'email' && o.toAddr === 'plomero@demo.local'))
  assert.ok(out.some((o: any) => o.channel === 'whatsapp' && o.toAddr === '3101112233'))
  await flushOutbox()  // sin SMTP ni token de WhatsApp: se queda en cola, sin error
  assert.ok((await call('admin', 'GET', '/admin/outbox')).data.every((o: any) => o.status === 'pendiente'))
  await call('admin', 'PUT', '/admin/settings', { json: { notifyChannels: ['inapp'] } })
})

test('US-42 webhooks de Calendly: firma HMAC válida, cancelaciones y reprogramaciones', async () => {
  const key = 'clave-de-prueba'
  const sign = (raw: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`
  const ev = 'https://api.calendly.com/scheduled_events/ABC123'
  const start = new Date(Date.now() + 2 * 86400_000)
  const id = q.run(`INSERT INTO appointments(project_id,type_id,professional_id,requested_by,start_at,end_at,kind,status,provider,external_id,created_at) VALUES(1,2,?,?,?,?, 'visita','confirmada','calendly',?,?)`,
    ids.electricista, ids.supervisor, start.toISOString(), new Date(start.getTime() + 3600_000).toISOString(), ev, new Date().toISOString()).id
  const post = (payload: object, header?: string) => { const raw = JSON.stringify(payload); return call(null, 'POST', '/webhooks/calendly', { raw, headers: { 'content-type': 'application/json', 'Calendly-Webhook-Signature': header ?? sign(raw) } }) }
  // firma inválida o vencida
  assert.equal((await post({ event: 'invitee.canceled' }, 't=1,v1=abc')).status, 401)
  assert.equal((await call(null, 'POST', '/webhooks/calendly', { raw: '{}' })).status, 401)
  const stale = JSON.stringify({ event: 'invitee.canceled' })
  assert.equal(verifyCalendlySignature(stale, sign(stale, Math.floor(Date.now() / 1000) - 3600), key), false)
  assert.equal(verifyCalendlySignature(stale, sign(stale), key), true)
  // evento de una cita desconocida: se ignora sin error
  assert.equal((await post({ event: 'invitee.canceled', payload: { event: 'https://api.calendly.com/scheduled_events/NOPE' } })).data.handled, false)
  // reprogramación
  const newStart = new Date(start.getTime() + 86400_000).toISOString()
  const mv = await post({ event: 'invitee.created', payload: { scheduled_event: { uri: ev, start_time: newStart, end_time: new Date(Date.parse(newStart) + 3600_000).toISOString() } } })
  assert.equal(mv.data.action, 'reprogramada'); assert.equal(q.get<any>('SELECT start_at FROM appointments WHERE id=?', id).start_at, newStart)
  // cancelación
  const cn = await post({ event: 'invitee.canceled', payload: { scheduled_event: { uri: ev }, cancellation: { reason: 'Surgió un imprevisto' } } })
  assert.equal(cn.data.action, 'cancelada')
  const row = q.get<any>('SELECT status,cancel_reason FROM appointments WHERE id=?', id)
  assert.equal(row.status, 'cancelada'); assert.equal(row.cancel_reason, 'Surgió un imprevisto')
  assert.ok((await call('supervisor', 'GET', '/notifications')).data.some((n: any) => n.title === 'Cita cancelada desde Calendly'))
  assert.equal(handleCalendlyEvent({ event: 'invitee.canceled', payload: { scheduled_event: { uri: ev } } }).handled, true) // idempotente
})
