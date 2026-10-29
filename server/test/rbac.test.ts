import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrap, call, form, ROLE_KEYS, ids } from './helper.ts'

before(bootstrap)

type Row = [string, string, string, unknown, string[]]
const A = 'admin', S = 'supervisor'
const MATRIX: Row[] = [
  ['US-02 gestionar miembros', 'POST', '/projects/1/members', {}, [A]],
  ['US-05 crear invitaciones', 'POST', '/projects/1/invites', {}, [A]],
  ['US-08 crear fases', 'POST', '/projects/1/phases', {}, [A, S]],
  ['US-13 crear tareas', 'POST', '/projects/1/tasks', {}, [A, S]],
  ['US-34 dashboard', 'GET', '/projects/1/dashboard', undefined, [A, S]],
  ['US-35 carga de trabajo', 'GET', '/projects/1/workload', undefined, [A, S]],
  ['US-36 reporte', 'GET', '/projects/1/report?format=xlsx', undefined, [A]],
  ['US-25 subir documentos', 'POST', '/projects/1/documents', undefined, [A, S, 'arquitecto', 'ingeniero']],
  ['US-29 registrar topografía', 'POST', '/projects/1/survey', undefined, [A, S, 'ingeniero', 'topografo']],
  ['US-30 no conformidades', 'POST', '/projects/1/nonconformities', undefined, [A, S, 'ingeniero']],
  ['US-17 revisar tareas', 'POST', '/tasks/4/review', {}, [A, S]],
  ['US-11 directorio de profesionales', 'GET', '/professionals', undefined, [A, S]],
  ['auditoría', 'GET', '/admin/audit', undefined, [A]],
  ['usuarios', 'GET', '/admin/users', undefined, [A]],
  ['US-19 crear tipos de cita', 'POST', '/appointment-types', {}, [A]],
  ['US-12 revisar certificaciones', 'GET', '/admin/certifications', undefined, [A]],
  ['respaldo', 'POST', '/admin/backup', undefined, [A]],
  ['ajustes', 'GET', '/admin/settings', undefined, [A]],
]

for (const [name, method, url, json, allowed] of MATRIX) {
  test(`US-03 RBAC: ${name} (${method} ${url})`, async () => {
    for (const who of ROLE_KEYS) {
      const f = json === undefined && method === 'POST' ? form({}) : undefined
      const r = await call(who, method, url, { json: f ? undefined : json, form: f })
      if (allowed.includes(who)) assert.notEqual(r.status, 403, `${who} debería tener acceso (obtuvo ${r.status} ${JSON.stringify(r.data).slice(0, 80)})`)
      else assert.equal(r.status, 403, `${who} debería recibir 403 (obtuvo ${r.status})`)
    }
    assert.equal((await call(null, method, url, { json })).status, 401)
  })
}

test('US-03 aislamiento: un proyecto ajeno es invisible para quien no es miembro', async () => {
  const p = await call(A, 'POST', '/projects', { json: { name: 'Obra Secreta', location: 'Medellín', startDate: '2026-02-01', endDate: '2026-09-01' } })
  const pid = p.data.id
  for (const who of ROLE_KEYS.filter((k) => k !== A)) {
    for (const url of [`/projects/${pid}`, `/projects/${pid}/tasks`, `/projects/${pid}/members`, `/projects/${pid}/documents`, `/projects/${pid}/appointments`, `/projects/${pid}/survey`]) {
      assert.equal((await call(who, 'GET', url)).status, 403, `${who} ${url}`)
    }
    const list = await call(who, 'GET', '/projects')
    assert.ok(!list.data.some((x: any) => x.id === pid), `${who} no debe listar el proyecto ajeno`)
  }
  assert.equal((await call(A, 'GET', `/projects/${pid}`)).status, 200)
  assert.equal((await call(A, 'GET', '/projects/9999')).status, 404)
})

test('US-03 visibilidad de tareas: oficios y colaborador solo ven las asignadas; roles técnicos ven todo', async () => {
  const sold = (await call('soldador', 'GET', '/projects/1/tasks')).data
  assert.ok(sold.length >= 1 && sold.every((t: any) => t.assigneeId === ids.soldador))
  assert.equal((await call('soldador', 'GET', '/tasks/6')).status, 403)
  assert.equal((await call('soldador', 'POST', '/tasks/6/status', { json: { status: 'en_curso' } })).status, 403)
  for (const who of ['admin', 'supervisor', 'arquitecto', 'ingeniero']) assert.equal((await call(who, 'GET', '/projects/1/tasks')).data.length, 8, who)
  assert.equal((await call('colaborador', 'GET', '/projects/1/tasks')).data.length, 1)
})

test('US-27 visibilidad de documentos por especialidad (lista, detalle y archivo)', async () => {
  const visible = async (who: string) => (await call(who, 'GET', '/projects/1/documents')).data.map((d: any) => d.title)
  for (const who of ['admin', 'supervisor', 'arquitecto', 'ingeniero']) assert.ok((await visible(who)).includes('Plano de fachada'), who)
  for (const who of ['plomero', 'electricista', 'soldador', 'topografo', 'colaborador']) {
    const titles = await visible(who)
    assert.ok(!titles.includes('Plano de fachada'), `${who} no debería ver el plano de arquitectura`)
    assert.ok(titles.includes('Cronograma general de obra'), `${who} sí ve lo general`)
    assert.equal((await call(who, 'GET', '/documents/1')).status, 403)
  }
  const att = (await call('arquitecto', 'GET', '/documents/1')).data.versions[0].attachmentId
  assert.equal((await call('plomero', 'GET', `/files/${att}`)).status, 403)
  assert.equal((await call('ingeniero', 'GET', `/files/${att}`)).status, 200)
})
