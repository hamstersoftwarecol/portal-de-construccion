import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrap, call, ids, nextWeekdays } from './helper.ts'
import { runMaintenance } from '../src/maintenance.ts'
import { q } from '../src/db.ts'

before(bootstrap)
const [d1, d2, d3] = nextWeekdays()
const slots = async (prof: number, type: number, from = d1, to = d3) => (await call('supervisor', 'GET', `/slots?professionalId=${prof}&typeId=${type}&from=${from}&to=${to}`)).data.slots as { start: string; end: string }[]
const book = (who: string, startAt: string, extra: object = {}) =>
  call(who, 'POST', '/appointments', { json: { projectId: 1, typeId: 2, professionalId: ids.electricista, startAt, ...extra } })

test('US-19 catálogo de tipos de cita por especialidad', async () => {
  const types = (await call('supervisor', 'GET', '/appointment-types')).data
  assert.ok(types.length >= 6 && types.every((t: any) => t.specialty && t.durationMin))
  assert.equal((await call('supervisor', 'GET', '/appointment-types?specialty=electricidad')).data.length, 1)
  assert.equal((await call('supervisor', 'POST', '/appointment-types', { json: { name: 'x', specialty: 'soldadura', durationMin: 30 } })).status, 403)
  assert.equal((await call('admin', 'POST', '/appointment-types', { json: { name: 'Prueba de presión', specialty: 'plomeria', durationMin: 5 } })).status, 400)
  const c = await call('admin', 'POST', '/appointment-types', { json: { name: 'Prueba de presión', specialty: 'plomeria', durationMin: 120 } })
  assert.equal(c.status, 201)
  assert.equal((await call('admin', 'PUT', `/appointment-types/${c.data.id}`, { json: { name: 'Prueba de presión 2', specialty: 'plomeria', durationMin: 90 } })).status, 200)
  assert.equal((await call('admin', 'DELETE', `/appointment-types/${c.data.id}`)).status, 200)
})

test('US-20 disponibilidad semanal: validación, solapes y bloqueos por fecha', async () => {
  assert.equal((await call('plomero', 'PUT', '/availability', { json: { windows: [{ weekday: 1, start: '10:00', end: '09:00' }] } })).status, 422)
  assert.equal((await call('plomero', 'PUT', '/availability', { json: { windows: [{ weekday: 1, start: '08:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }] } })).status, 422)
  assert.equal((await call('plomero', 'PUT', '/availability', { json: { windows: [{ weekday: 1, start: '25:00', end: '26:00' }] } })).status, 400)
  assert.equal((await call('plomero', 'PUT', '/availability', { json: { windows: [{ weekday: 2, start: '07:00', end: '09:00' }] } })).status, 200)
  const av = (await call('plomero', 'GET', '/availability')).data
  assert.equal(av.windows.length, 1); assert.equal(av.timezone, 'America/Bogota')
  assert.equal((await call('plomero', 'POST', '/availability/blocks', { json: { dateFrom: '2026-12-10', dateTo: '2026-12-01' } })).status, 422)
})

test('US-21 reservar sin doble reserva, con tipo/especialidad correctos y permisos', async () => {
  const s = await slots(ids.electricista, 2)
  assert.ok(s.length > 0)
  assert.ok(s.every((x) => (Date.parse(x.end) - Date.parse(x.start)) === 3600_000))
  // el slot de la cita sembrada (09:00 del primer día hábil) y los que se solapan no están
  const seeded = q.get<any>("SELECT start_at FROM appointments WHERE status='confirmada' LIMIT 1")
  assert.ok(!s.some((x) => Date.parse(x.start) > Date.parse(seeded.start_at) - 3600_000 && Date.parse(x.start) < Date.parse(seeded.start_at) + 3600_000))
  const first = s[0]
  assert.equal((await book('plomero', first.start)).status, 403)                         // oficios no reservan
  assert.equal((await book('supervisor', first.start, { professionalId: ids.plomero })).status, 422) // tipo ≠ especialidad
  assert.equal((await book('supervisor', first.start, { taskId: 999 })).status, 422)
  const ok = await book('supervisor', first.start, { taskId: 6, notes: 'Revisar tablero' })
  assert.equal(ok.status, 201)
  assert.equal((await book('colaborador', first.start)).status, 409)                      // mismo hueco
  const overlapping = new Date(Date.parse(first.start) + 30 * 60_000).toISOString()
  assert.equal((await book('colaborador', overlapping)).status, 409)                      // solape parcial
  assert.equal((await book('colaborador', new Date(Date.now() - 86400_000).toISOString())).status, 409) // pasado
  assert.ok(!(await slots(ids.electricista, 2)).some((x) => x.start === first.start))
  const t6 = (await call('electricista', 'GET', '/tasks/6')).data
  assert.ok(t6.appointments.length >= 2)                                                  // ligada a la tarea
  assert.ok((await call('electricista', 'GET', '/notifications')).data.some((n: any) => n.title.startsWith('Cita agendada')))
})

test('US-22 cancelar (motivo obligatorio, libera el hueco) y reprogramar con notificación', async () => {
  const s = await slots(ids.electricista, 2)
  const a = await book('supervisor', s[0].start); assert.equal(a.status, 201)
  assert.equal((await call('supervisor', 'POST', `/appointments/${a.data.id}/cancel`, { json: { reason: '' } })).status, 400)
  assert.equal((await call('plomero', 'POST', `/appointments/${a.data.id}/cancel`, { json: { reason: 'no puedo' } })).status, 403)
  const mv = await call('supervisor', 'POST', `/appointments/${a.data.id}/reschedule`, { json: { startAt: s[5].start } })
  assert.equal(mv.status, 200); assert.equal(mv.data.startAt, s[5].start)
  assert.ok((await slots(ids.electricista, 2)).some((x) => x.start === s[0].start))      // el hueco original quedó libre
  assert.equal((await call('supervisor', 'POST', `/appointments/${a.data.id}/reschedule`, { json: { startAt: s[5].start } })).status, 200) // mismo horario propio es válido
  const other = await book('colaborador', s[8].start)
  assert.equal((await call('supervisor', 'POST', `/appointments/${a.data.id}/reschedule`, { json: { startAt: s[8].start } })).status, 409)
  assert.equal(other.status, 201)
  const c = await call('electricista', 'POST', `/appointments/${a.data.id}/cancel`, { json: { reason: 'Estoy en otra obra' } })
  assert.equal(c.status, 200)
  assert.equal((await call('electricista', 'POST', `/appointments/${a.data.id}/cancel`, { json: { reason: 'otra vez' } })).status, 409)
  assert.ok((await slots(ids.electricista, 2)).some((x) => x.start === s[5].start))
  assert.ok((await call('supervisor', 'GET', '/notifications')).data.some((n: any) => n.title === 'Cita cancelada' && n.body === 'Estoy en otra obra'))
})

test('US-20 bloqueos: un día bloqueado no ofrece huecos', async () => {
  assert.ok((await slots(ids.soldador, 4, d1, d1)).length > 0)
  const b = await call('soldador', 'POST', '/availability/blocks', { json: { dateFrom: d1, dateTo: d1, reason: 'Vacaciones' } })
  assert.equal(b.status, 201)
  assert.equal((await slots(ids.soldador, 4, d1, d1)).length, 0)
  assert.ok((await slots(ids.soldador, 4, d2, d2)).length > 0)
  await call('soldador', 'DELETE', `/availability/blocks/${b.data.id}`)
  assert.ok((await slots(ids.soldador, 4, d1, d1)).length > 0)
})

test('US-23 calendario unificado con filtros por profesional y especialidad; visibilidad por rol', async () => {
  const month = d1.slice(0, 7)
  const all = (await call('supervisor', 'GET', `/projects/1/appointments?month=${month}`)).data
  assert.ok(all.length >= 2)
  assert.ok((await call('supervisor', 'GET', `/projects/1/appointments?month=${month}&specialty=electricidad`)).data.every((a: any) => a.specialty === 'electricidad'))
  assert.equal((await call('supervisor', 'GET', `/projects/1/appointments?month=${month}&professionalId=${ids.soldador}`)).data.length, 0)
  const mine = (await call('electricista', 'GET', `/projects/1/appointments?month=${month}`)).data
  assert.ok(mine.length >= 1 && mine.every((a: any) => a.professionalId === ids.electricista || a.requestedBy === ids.electricista))
  assert.equal((await call('soldador', 'GET', `/projects/1/appointments?month=${month}`)).data.length, 0)
  assert.ok((await call('electricista', 'GET', '/appointments/mine')).data.length >= 1)
})

test('US-31 inspección de cierre: solo gestión programa; resultado con observaciones obligatorias', async () => {
  const s = await slots(ids.ingeniero, 5)
  assert.equal((await call('colaborador', 'POST', '/appointments', { json: { projectId: 1, typeId: 5, professionalId: ids.ingeniero, startAt: s[0].start, kind: 'inspeccion' } })).status, 403)
  const i = await call('supervisor', 'POST', '/appointments', { json: { projectId: 1, typeId: 5, professionalId: ids.ingeniero, startAt: s[0].start, kind: 'inspeccion' } })
  assert.equal(i.status, 201)
  assert.equal((await call('arquitecto', 'POST', `/appointments/${i.data.id}/result`, { json: { result: 'aprobada' } })).status, 403)
  assert.equal((await call('ingeniero', 'POST', `/appointments/${i.data.id}/result`, { json: { result: 'con_observaciones' } })).status, 422)
  assert.equal((await call('ingeniero', 'POST', `/appointments/${i.data.id}/result`, { json: { result: 'con_observaciones', notes: 'Falta sellar juntas' } })).status, 200)
  const list = (await call('supervisor', 'GET', `/projects/1/appointments?month=${d1.slice(0, 7)}`)).data
  assert.equal(list.find((a: any) => a.id === i.data.id).result, 'con_observaciones')
  const visita = await book('supervisor', (await slots(ids.electricista, 2))[3].start)
  assert.equal((await call('supervisor', 'POST', `/appointments/${visita.data.id}/result`, { json: { result: 'aprobada' } })).status, 409)
})

test('US-32 notificaciones: contador, leer una/todas y recordatorio 24 h antes', async () => {
  // cita dentro de 5 horas, creada directamente para probar el recordatorio
  const start = new Date(Date.now() + 5 * 3600_000)
  const id = q.run(`INSERT INTO appointments(project_id,type_id,professional_id,requested_by,start_at,end_at,kind,status,provider,created_at) VALUES(1,2,?,?,?,?, 'visita','confirmada','local',?)`,
    ids.electricista, ids.supervisor, start.toISOString(), new Date(start.getTime() + 3600_000).toISOString(), new Date().toISOString()).id
  const r1 = runMaintenance(); assert.ok(r1.reminders >= 1)
  const r2 = runMaintenance(); assert.equal(r2.reminders, 0)                              // no se repite
  const notes = (await call('electricista', 'GET', '/notifications?unread=1')).data
  assert.ok(notes.some((n: any) => n.title.startsWith('Recordatorio')))
  const count = (await call('electricista', 'GET', '/notifications/count')).data.unread
  assert.equal(count, notes.length)
  await call('electricista', 'POST', `/notifications/${notes[0].id}/read`)
  assert.equal((await call('electricista', 'GET', '/notifications/count')).data.unread, count - 1)
  await call('electricista', 'POST', '/notifications/read-all')
  assert.equal((await call('electricista', 'GET', '/notifications/count')).data.unread, 0)
  assert.equal((await call('plomero', 'POST', `/notifications/${notes[0].id}/read`)).status, 200) // no afecta a otros: filtrado por dueño
  assert.ok(id > 0)
})

test('US-11 directorio de profesionales por especialidad y disponibilidad', async () => {
  const el = (await call('supervisor', 'GET', '/professionals?specialty=electricidad')).data
  assert.equal(el.length, 1); assert.ok(el[0].nextAvailable); assert.equal(el[0].certifications.length, 1)
  const free = (await call('supervisor', 'GET', '/professionals?available=1')).data
  assert.ok(free.every((p: any) => p.nextAvailable) && !free.some((p: any) => p.id === ids.colaborador))
  await call('plomero', 'PUT', '/availability', { json: { windows: [] } })
  assert.equal((await call('supervisor', 'GET', '/professionals?specialty=plomeria&available=1')).data.length, 0) // sin franjas no aparece como disponible
})
