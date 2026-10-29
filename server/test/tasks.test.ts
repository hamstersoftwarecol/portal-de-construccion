import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrap, call, form, png, pdfFile, ids } from './helper.ts'

before(bootstrap)
const dueSoon = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10)

test('US-06 proyectos: validación de fechas y resumen por usuario (US-09)', async () => {
  assert.equal((await call('admin', 'POST', '/projects', { json: { name: 'Mal', location: 'Bogotá', startDate: '2026-05-10', endDate: '2026-05-01' } })).status, 422)
  assert.equal((await call('admin', 'POST', '/projects', { json: { name: 'M', location: 'B', startDate: '2026-05-10', endDate: '2026-05-20' } })).status, 400)
  const list = (await call('plomero', 'GET', '/projects')).data
  assert.equal(list.length, 1); assert.equal(list[0].myRole, 'plomero'); assert.ok(list[0].teamCount === 9 && list[0].openTasks > 0)
})

test('US-07 equipo: agregar sin duplicar y quitar libera tareas', async () => {
  const reg = await call('nuevo', 'POST', '/auth/register', { json: { name: 'Nuevo Plomero', email: 'nuevo@x.co', password: 'secreta123' } })
  const uid = reg.data.user.id
  assert.equal((await call('admin', 'POST', '/projects/1/members', { json: { userId: uid, role: 'plomero' } })).status, 201)
  assert.equal((await call('admin', 'POST', '/projects/1/members', { json: { userId: uid, role: 'plomero' } })).status, 409)
  // US-02 cambio de rol inmediato
  assert.equal((await call('admin', 'PATCH', `/projects/1/members/${uid}`, { json: { role: 'electricista' } })).status, 200)
  assert.equal((await call('nuevo', 'GET', '/auth/me')).data.memberships[0].role, 'electricista')
  assert.equal((await call('admin', 'DELETE', `/projects/1/members/${uid}`)).status, 200)
  assert.equal((await call('nuevo', 'GET', '/projects/1')).status, 403)
  const audit = (await call('admin', 'GET', '/admin/audit?action=role_change')).data
  assert.ok(audit.length >= 1)
})

test('US-08 fases: crear, ordenar y cerrar solo con tareas aprobadas', async () => {
  const f = await call('supervisor', 'POST', '/projects/1/phases', { json: { name: 'Fase extra' } }); assert.equal(f.status, 201)
  assert.equal((await call('supervisor', 'PATCH', `/phases/${f.data.id}`, { json: { status: 'cerrada' } })).status, 200) // vacía: se puede cerrar
  const t = await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'En fase cerrada', specialty: 'gestion', dueDate: dueSoon, phaseId: f.data.id } })
  assert.equal(t.status, 409)
  assert.equal((await call('supervisor', 'PATCH', '/phases/3', { json: { status: 'cerrada' } })).status, 409) // Instalaciones tiene tareas abiertas
  const phases = (await call('colaborador', 'GET', '/projects/1/phases')).data
  assert.equal(phases[0].name, 'Cimentación'); assert.equal(phases[0].approved, 2)
})

test('US-13/14 crear y asignar tareas con la especialidad correcta', async () => {
  assert.equal((await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'ab', specialty: 'soldadura', dueDate: dueSoon } })).status, 400)
  assert.equal((await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'Soldar barandas', specialty: 'soldadura', dueDate: '2026-13-45' } })).status, 400)
  const bad = await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'Soldar barandas', specialty: 'soldadura', dueDate: dueSoon, assigneeId: ids.plomero } })
  assert.equal(bad.status, 422)
  const ok = await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'Soldar barandas', specialty: 'soldadura', dueDate: dueSoon, assigneeId: ids.soldador, priority: 'alta' } })
  assert.equal(ok.status, 201)
  const d = (await call('soldador', 'GET', `/tasks/${ok.data.id}`)).data
  assert.equal(d.status, 'pendiente'); assert.equal(d.assigneeName, 'Sofía Soldadora')
  const notes = (await call('soldador', 'GET', '/notifications?unread=1')).data
  assert.ok(notes.some((n: any) => n.title.includes('Soldar barandas')))
  // reasignar a quien no corresponde
  assert.equal((await call('supervisor', 'POST', `/tasks/${ok.data.id}/assign`, { json: { assigneeId: ids.electricista } })).status, 422)
  assert.equal((await call('supervisor', 'POST', `/tasks/${ok.data.id}/assign`, { json: { assigneeId: null } })).status, 200)
  // una tarea de gestión puede ir a cualquier miembro
  const g = await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'Tarea general', specialty: 'gestion', dueDate: dueSoon, assigneeId: ids.plomero } })
  assert.equal(g.status, 201)
})

test('US-15 estado de tareas: transiciones válidas, bloqueo por dependencias y control de acceso', async () => {
  assert.equal((await call('plomero', 'POST', '/tasks/5/status', { json: { status: 'hecha' } })).status, 409)  // pendiente → hecha no existe
  const blocked = await call('plomero', 'POST', '/tasks/5/status', { json: { status: 'en_curso' } })
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /Soldadura de columnas/)
  assert.equal((await call('plomero', 'GET', '/tasks/5')).data.blocked, true)
  assert.equal((await call('soldador', 'POST', '/tasks/3/status', { json: { status: 'hecha' } })).status, 200)
  assert.equal((await call('plomero', 'POST', '/tasks/5/status', { json: { status: 'en_curso' } })).status, 200)
  const ev = (await call('plomero', 'GET', '/tasks/5')).data.events
  assert.ok(ev.some((e: any) => e.kind === 'estado' && e.body === 'pendiente → en_curso'))
  const mine = (await call('plomero', 'GET', '/tasks/mine')).data
  assert.ok(mine.every((t: any) => t.assigneeId === ids.plomero))
  // el supervisor recibió aviso de revisión
  assert.ok((await call('supervisor', 'GET', '/notifications?unread=1')).data.some((n: any) => n.title.startsWith('Lista para revisión')))
})

test('US-17 aprobar/rechazar: el rechazo exige comentario y devuelve a en curso', async () => {
  assert.equal((await call('supervisor', 'POST', '/tasks/4/review', { json: { approve: false } })).status, 422)
  assert.equal((await call('supervisor', 'POST', '/tasks/2/review', { json: { approve: true } })).status, 409) // ya aprobada, no está "hecha"
  const r = await call('supervisor', 'POST', '/tasks/4/review', { json: { approve: false, comment: 'Falta cuadro de cargas' } })
  assert.equal(r.data.status, 'en_curso')
  assert.equal((await call('ingeniero', 'GET', '/tasks/4')).data.reviewComment, 'Falta cuadro de cargas')
  assert.ok((await call('ingeniero', 'GET', '/notifications')).data.some((n: any) => n.title.startsWith('Rechazada')))
  assert.equal((await call('ingeniero', 'POST', '/tasks/4/status', { json: { status: 'hecha' } })).status, 200)
  assert.equal((await call('supervisor', 'POST', '/tasks/4/review', { json: { approve: true } })).data.status, 'aprobada')
  assert.equal((await call('supervisor', 'POST', '/tasks/4/status', { json: { status: 'en_curso' } })).status, 409) // aprobada es final
  assert.equal((await call('ingeniero', 'POST', '/tasks/4/review', { json: { approve: true } })).status, 403)
})

test('US-16 avances con fotos: límites, visibilidad del archivo', async () => {
  assert.equal((await call('colaborador', 'POST', '/tasks/8/progress', { form: form({ body: '' }) })).status, 422)
  const r = await call('colaborador', 'POST', '/tasks/8/progress', { form: form({ body: 'Acta firmada', files: [png(), png()] }) })
  assert.equal(r.status, 201); assert.equal(r.data.photos, 2)
  const d = (await call('colaborador', 'GET', '/tasks/8')).data
  assert.equal(d.attachments.length, 2)
  const file = await call('colaborador', 'GET', `/files/${d.attachments[0].id}`)
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/png')
  assert.equal((await call('plomero', 'GET', `/files/${d.attachments[0].id}`)).status, 403)
  const bad = await call('colaborador', 'POST', '/tasks/8/progress', { form: form({ body: 'x', files: [new File([new Uint8Array(10)], 'virus.exe')] }) })
  assert.equal(bad.status, 422)
  const big = await call('colaborador', 'POST', '/tasks/8/progress', { form: form({ files: [new File([new Uint8Array(11 * 1024 * 1024)], 'grande.png', { type: 'image/png' })] }) })
  assert.equal(big.status, 422)
  assert.equal((await call('colaborador', 'POST', '/tasks/8/progress', { form: form({ body: 'ok', files: Array.from({ length: 6 }, png) }) })).status, 422)
})

test('US-28 certificados y pruebas adjuntos a la tarea', async () => {
  const r = await call('soldador', 'POST', '/tasks/3/attachments', { form: form({ files: [pdfFile('prueba-liquidos.pdf')] }) })
  assert.equal(r.status, 201)
  const d = (await call('supervisor', 'GET', '/tasks/3')).data
  const cert = d.attachments.find((a: any) => a.kind === 'certificado')
  assert.ok(cert); assert.equal((await call('ingeniero', 'GET', `/files/${cert.id}`)).status, 200)
  assert.equal((await call('plomero', 'POST', '/tasks/3/attachments', { form: form({ files: [pdfFile()] }) })).status, 403)
})

test('US-18 dependencias: sin ciclos ni autodependencia', async () => {
  const t = await call('supervisor', 'POST', '/projects/1/tasks', { json: { title: 'Pintura general', specialty: 'gestion', dueDate: dueSoon, assigneeId: ids.colaborador } })
  const a = t.data.id
  assert.equal((await call('supervisor', 'POST', `/tasks/${a}/deps`, { json: { dependsOn: a } })).status, 422)
  assert.equal((await call('supervisor', 'POST', `/tasks/${a}/deps`, { json: { dependsOn: 7 } })).status, 201)
  assert.equal((await call('supervisor', 'POST', '/tasks/7/deps', { json: { dependsOn: a } })).status, 409) // ciclo
  assert.equal((await call('colaborador', 'POST', `/tasks/${a}/deps`, { json: { dependsOn: 7 } })).status, 403) // colaborador no declara dependencias
  assert.equal((await call('colaborador', 'POST', `/tasks/${a}/status`, { json: { status: 'en_curso' } })).status, 409) // 7 sigue en curso
  assert.equal((await call('supervisor', 'DELETE', `/tasks/${a}/deps/7`)).status, 200)
  assert.equal((await call('colaborador', 'POST', `/tasks/${a}/status`, { json: { status: 'en_curso' } })).status, 200)
})
