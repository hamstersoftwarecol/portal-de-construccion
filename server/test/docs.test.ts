import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrap, call, form, png, pdfFile, ids } from './helper.ts'

before(bootstrap)
const due = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)

test('US-25 planos con versiones: cada subida crea versión y conserva la anterior; formatos permitidos', async () => {
  assert.equal((await call('arquitecto', 'POST', '/projects/1/documents', { form: form({ title: 'Plano estructural', specialty: 'ingenieria_civil', file: new File(['x'], 'malware.exe') }) })).status, 422)
  assert.equal((await call('arquitecto', 'POST', '/projects/1/documents', { form: form({ title: 'ab', file: pdfFile() }) })).status, 422)
  assert.equal((await call('arquitecto', 'POST', '/projects/1/documents', { form: form({ title: 'Plano sin archivo' }) })).status, 422)
  const dwg = new File([new Uint8Array(100)], 'planta.dwg')
  const d = await call('arquitecto', 'POST', '/projects/1/documents', { form: form({ title: 'Planta nivel 2', specialty: 'arquitectura', notes: 'Emisión inicial', file: dwg }) })
  assert.equal(d.status, 201)
  const v2 = await call('arquitecto', 'POST', `/documents/${d.data.id}/versions`, { form: form({ notes: 'Ajuste de escaleras', file: pdfFile('planta-v2.pdf') }) })
  assert.equal(v2.data.version, 2)
  const det = (await call('arquitecto', 'GET', `/documents/${d.data.id}`)).data
  assert.equal(det.versions.length, 2); assert.equal(det.versions[1].filename, 'planta.dwg'); assert.equal(det.versions[0].notes, 'Ajuste de escaleras')
  const dl = await call('ingeniero', 'GET', `/files/${det.versions[1].attachmentId}`)
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition')!, /attachment/)
  assert.equal((await call('colaborador', 'POST', `/documents/${d.data.id}/versions`, { form: form({ file: pdfFile() }) })).status, 403)
})

test('US-26 revisión: borrador → en revisión → aprobado/devuelto, con comentarios por versión', async () => {
  const d = (await call('arquitecto', 'POST', '/projects/1/documents', { form: form({ title: 'Memoria de cálculo', specialty: 'ingenieria_civil', file: pdfFile('memoria.pdf') }) })).data.id
  assert.equal((await call('ingeniero', 'POST', `/documents/${d}/status`, { json: { status: 'aprobado' } })).status, 409)  // debe pasar por revisión
  assert.equal((await call('supervisor', 'POST', `/documents/${d}/status`, { json: { status: 'en_revision' } })).status, 200)
  assert.ok((await call('ingeniero', 'GET', '/notifications')).data.some((n: any) => n.title.includes('Memoria de cálculo')))
  assert.equal((await call('supervisor', 'POST', `/documents/${d}/status`, { json: { status: 'aprobado' } })).status, 403) // supervisor no aprueba
  const c = await call('ingeniero', 'POST', `/documents/${d}/comments`, { json: { body: 'Revisar cuantías de viga V3', version: 1 } })
  assert.equal(c.status, 201)
  assert.ok((await call('arquitecto', 'GET', '/notifications')).data.some((n: any) => n.title.startsWith('Comentario en')))
  assert.equal((await call('ingeniero', 'POST', `/documents/${d}/status`, { json: { status: 'aprobado' } })).status, 200)
  assert.equal((await call('arquitecto', 'GET', `/documents/${d}`)).data.comments[0].body, 'Revisar cuantías de viga V3')
  // una nueva versión vuelve el documento a borrador
  await call('arquitecto', 'POST', `/documents/${d}/versions`, { form: form({ file: pdfFile('memoria-v2.pdf') }) })
  assert.equal((await call('arquitecto', 'GET', `/documents/${d}`)).data.status, 'borrador')
  assert.equal((await call('admin', 'DELETE', `/documents/${d}`)).status, 200)
})

test('US-27/US-28 el plomero no ve documentos ajenos; el resto sí lo general', async () => {
  const d = (await call('arquitecto', 'POST', '/projects/1/documents', { form: form({ title: 'Isométrico hidráulico', specialty: 'plomeria', file: pdfFile() }) })).data.id
  assert.equal((await call('plomero', 'GET', `/documents/${d}`)).status, 200)
  assert.equal((await call('electricista', 'GET', `/documents/${d}`)).status, 403)
  assert.equal((await call('ingeniero', 'GET', `/documents/${d}`)).status, 200)
})

test('US-29 topografía: formulario con coordenadas y nivel, archivos e historial', async () => {
  const base = { kind: 'levantamiento', title: 'Levantamiento lote norte', x: '1004500.50', y: '1101200.25', level: '2559.80', notes: 'Estación total' }
  assert.equal((await call('topografo', 'POST', '/projects/1/survey', { form: form({ ...base, level: 'abc' }) })).status, 400)
  assert.equal((await call('topografo', 'POST', '/projects/1/survey', { form: form({ ...base, kind: 'otro' }) })).status, 400)
  assert.equal((await call('topografo', 'POST', '/projects/1/survey', { form: form({ ...base, title: 'x' }) })).status, 400)
  const ok = await call('topografo', 'POST', '/projects/1/survey', { form: form({ ...base, files: [new File(['id,x,y\n1,2,3'], 'puntos.csv', { type: 'text/csv' }), png()] }) })
  assert.equal(ok.status, 201)
  assert.equal((await call('plomero', 'POST', '/projects/1/survey', { form: form(base) })).status, 403)
  const hist = (await call('plomero', 'GET', '/projects/1/survey')).data
  assert.equal(hist[0].title, 'Levantamiento lote norte'); assert.equal(hist[0].x, 1004500.5); assert.equal(hist[0].files.length, 2)
  assert.equal((await call('plomero', 'GET', `/files/${hist[0].files[0].id}`)).status, 200)
  assert.equal(hist.length, 2) // incluye el replanteo sembrado
})

test('US-30 no conformidad crea tarea correctiva y se cierra solo cuando la tarea fue aprobada', async () => {
  assert.equal((await call('ingeniero', 'POST', '/projects/1/nonconformities', { form: form({ title: 'Fisuras en losa', createTask: 'false' }) })).status, 422) // sin foto
  assert.equal((await call('ingeniero', 'POST', '/projects/1/nonconformities', { form: form({ title: 'Fisuras en losa', createTask: 'true', files: [png()] }) })).status, 422) // falta especialidad
  const nc = await call('ingeniero', 'POST', '/projects/1/nonconformities', { form: form({ title: 'Cordón de soldadura con porosidad', description: 'Viga V2, eje B', severity: 'alta', createTask: 'true', specialty: 'soldadura', assigneeId: String(ids.soldador), dueDate: due, files: [png()] }) })
  assert.equal(nc.status, 201); assert.ok(nc.data.taskId)
  const list = (await call('plomero', 'GET', '/projects/1/nonconformities')).data
  const row = list.find((n: any) => n.id === nc.data.id)
  assert.equal(row.taskId, nc.data.taskId); assert.equal(row.files.length, 1); assert.equal(row.status, 'abierta')
  assert.equal((await call('ingeniero', 'POST', `/nonconformities/${nc.data.id}/close`)).status, 409)
  const t = nc.data.taskId
  assert.equal((await call('soldador', 'POST', `/tasks/${t}/status`, { json: { status: 'en_curso' } })).status, 200)
  assert.equal((await call('soldador', 'POST', `/tasks/${t}/status`, { json: { status: 'hecha' } })).status, 200)
  assert.equal((await call('supervisor', 'POST', `/tasks/${t}/review`, { json: { approve: true } })).status, 200)
  assert.ok((await call('ingeniero', 'GET', '/notifications')).data.some((n: any) => n.title.startsWith('Ya puedes cerrar')))
  assert.equal((await call('plomero', 'POST', `/nonconformities/${nc.data.id}/close`)).status, 403)
  assert.equal((await call('ingeniero', 'POST', `/nonconformities/${nc.data.id}/close`)).status, 200)
  assert.equal((await call('ingeniero', 'POST', `/nonconformities/${nc.data.id}/close`)).status, 409)
  // una no conformidad sin tarea puede cerrarse directamente
  const solo = await call('supervisor', 'POST', '/projects/1/nonconformities', { form: form({ title: 'Limpieza deficiente', files: [png()] }) })
  assert.equal((await call('supervisor', 'POST', `/nonconformities/${solo.data.id}/close`)).status, 200)
})

test('US-33 comentarios con menciones @usuario generan notificación', async () => {
  const c = await call('supervisor', 'POST', '/comments', { json: { entity: 'project', entityId: 1, body: 'Hola @plomero y @electricista, @noexiste revisen el cronograma' } })
  assert.equal(c.status, 201)
  assert.ok((await call('plomero', 'GET', '/notifications')).data.some((n: any) => n.kind === 'mention'))
  assert.ok((await call('electricista', 'GET', '/notifications')).data.some((n: any) => n.kind === 'mention'))
  assert.ok(!(await call('soldador', 'GET', '/notifications')).data.some((n: any) => n.kind === 'mention'))
  await call('plomero', 'POST', '/comments', { json: { entity: 'task', entityId: 5, body: 'Listo @supervisor, ya empecé' } })
  assert.ok((await call('supervisor', 'GET', '/notifications')).data.some((n: any) => n.kind === 'mention'))
  const list = (await call('electricista', 'GET', '/comments?entity=project&id=1')).data
  assert.ok(list.length >= 2 && list[0].createdAt <= list[list.length - 1].createdAt)
  assert.equal((await call('soldador', 'POST', '/comments', { json: { entity: 'task', entityId: 5, body: 'intruso' } })).status, 403)
  assert.equal((await call('plomero', 'POST', '/comments', { json: { entity: 'task', entityId: 5, body: '' } })).status, 400)
})
