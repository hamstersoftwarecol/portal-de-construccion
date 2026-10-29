import fs from 'node:fs'
import path from 'node:path'
import { q, now, raw } from '../server/src/db.js'
import { config } from '../server/src/config.js'
import { hashPassword } from '../server/src/util.js'
import { ROLE_SPECIALTY, type Role } from '../server/src/rbac.js'
export async function runSeed() {

const DEMO_PASSWORD = 'Demo1234!'
const force = false

if (q.get('SELECT 1 FROM users LIMIT 1')) {
  if (!force) { console.log('La base ya tiene datos; no se cargó la demo. Usa "npm run seed -- --force" para reiniciarla.'); process.exit(0) }
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const t of q.all<any>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) raw.exec(`DELETE FROM ${t.name}`)
  raw.exec('PRAGMA foreign_keys=ON')
}

const hash = hashPassword(DEMO_PASSWORD)
const people: Array<[string, string, Role, string]> = [
  ['admin', 'Ana Administradora', 'administrador', 'Bogotá'],
  ['supervisor', 'Sergio Supervisor', 'supervisor', 'Bogotá'],
  ['colaborador', 'Carla Colaboradora', 'colaborador', 'Bogotá'],
  ['arquitecto', 'Andrés Arquitecto', 'arquitecto', 'Bogotá'],
  ['ingeniero', 'Isabel Ingeniera Civil', 'ingeniero_civil', 'Medellín'],
  ['topografo', 'Tomás Topógrafo', 'topografo', 'Bogotá'],
  ['plomero', 'Pedro Plomero', 'plomero', 'Soacha'],
  ['electricista', 'Elena Electricista', 'electricista', 'Bogotá'],
  ['soldador', 'Sofía Soldadora', 'soldador', 'Bogotá'],
]
const uid: Record<string, number> = {}
for (const [key, name, role, zone] of people) {
  const id = q.run('INSERT INTO users(email,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)', `${key}@demo.local`, name, hash, key === 'admin' ? 1 : 0, now()).id
  uid[key] = id
  q.run('INSERT INTO profiles(user_id,specialty,zone,phone,bio) VALUES(?,?,?,?,?)', id, ROLE_SPECIALTY[role], zone, '3000000000', `Perfil de demostración (${role}).`)
}

const day = (n: number) => new Date(Date.now() + n * 86400_000 - 5 * 3600_000).toISOString().slice(0, 10)
const pid = q.run('INSERT INTO projects(name,location,start_date,end_date,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
  'Edificio Alameda 45', 'Calle 45 # 12-30, Bogotá', day(-30), day(240), 'en_ejecucion', uid.admin, now()).id
for (const [key, , role] of people) q.run('INSERT INTO memberships(project_id,user_id,role,created_at) VALUES(?,?,?,?)', pid, uid[key], role, now())

const phases: Record<string, number> = {}
;['Cimentación', 'Estructura', 'Instalaciones', 'Acabados'].forEach((n, i) => { phases[n] = q.run('INSERT INTO phases(project_id,name,position) VALUES(?,?,?)', pid, n, i + 1).id })

const mkTask = (title: string, phase: string, specialty: string, status: string, due: number, assignee: string | null, priority = 'media') =>
  q.run(`INSERT INTO tasks(project_id,phase_id,title,description,specialty,priority,due_date,status,assignee_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    pid, phases[phase], title, `Descripción de: ${title}`, specialty, priority, day(due), status, assignee ? uid[assignee] : null, uid.supervisor, now(), now()).id
mkTask('Replanteo de ejes y niveles de cimentación', 'Cimentación', 'topografia', 'aprobada', -20, 'topografo', 'alta')
mkTask('Excavación y vaciado de zapatas', 'Cimentación', 'ingenieria_civil', 'aprobada', -10, 'ingeniero')
const t3 = mkTask('Soldadura de columnas metálicas del nivel 1', 'Estructura', 'soldadura', 'en_curso', 5, 'soldador', 'alta')
const t4 = mkTask('Revisión estructural de vigas del nivel 1', 'Estructura', 'ingenieria_civil', 'hecha', 2, 'ingeniero')
const t5 = mkTask('Red hidrosanitaria del sótano', 'Instalaciones', 'plomeria', 'pendiente', 12, 'plomero')
const t6 = mkTask('Tablero eléctrico principal y acometida', 'Instalaciones', 'electricidad', 'pendiente', 15, 'electricista', 'alta')
mkTask('Actualizar planos de fachada v2', 'Acabados', 'arquitectura', 'en_curso', -3, 'arquitecto')
mkTask('Reunión de seguimiento semanal', 'Estructura', 'gestion', 'pendiente', 3, 'colaborador', 'baja')
q.run('INSERT INTO task_deps(task_id,depends_on) VALUES(?,?)', t5, t3)
q.run('INSERT INTO task_deps(task_id,depends_on) VALUES(?,?)', t6, t4)
q.run("INSERT INTO task_events(task_id,user_id,kind,body,created_at) VALUES(?,?,'avance','Columnas C1 a C4 soldadas, falta prueba de líquidos penetrantes.',?)", t3, uid.soldador, now())

const types: Record<string, number> = {}
for (const [name, spec, min] of [['Visita topográfica', 'topografia', 60], ['Inspección eléctrica', 'electricidad', 60], ['Inspección hidrosanitaria', 'plomeria', 60],
  ['Inspección de soldadura', 'soldadura', 90], ['Revisión estructural', 'ingenieria_civil', 60], ['Revisión de diseño', 'arquitectura', 45]] as const)
  types[name] = q.run('INSERT INTO appointment_types(name,specialty,duration_min) VALUES(?,?,?)', name, spec, min).id

for (const key of ['topografo', 'plomero', 'electricista', 'soldador', 'ingeniero', 'arquitecto'])
  for (let wd = 1; wd <= 5; wd++) for (const [s, e] of [['08:00', '12:00'], ['14:00', '17:00']]) q.run('INSERT INTO availability(user_id,weekday,start,"end") VALUES(?,?,?,?)', uid[key], wd, s, e)

q.run("INSERT INTO certifications(user_id,name,number,expires_at,status,created_at) VALUES(?,?,?,?,'verificada',?)", uid.electricista, 'RETIE – Técnico electricista', 'CT-2291', day(300), now())
q.run("INSERT INTO certifications(user_id,name,number,expires_at,status,created_at) VALUES(?,?,?,?,'verificada',?)", uid.soldador, 'AWS D1.1 Soldador estructural', 'W-5510', day(20), now())
q.run("INSERT INTO certifications(user_id,name,number,expires_at,status,created_at) VALUES(?,?,?,?,'pendiente',?)", uid.plomero, 'Certificación en instalaciones hidrosanitarias', 'HS-884', day(500), now())

let d = new Date(Date.now() + 86400_000)
while ([0, 6].includes(new Date(d.getTime() - 5 * 3600_000).getUTCDay())) d = new Date(d.getTime() + 86400_000)
const dateStr = new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 10)
const start = new Date(`${dateStr}T09:00:00-05:00`)
q.run(`INSERT INTO appointments(project_id,task_id,type_id,professional_id,requested_by,start_at,end_at,kind,status,provider,created_at) VALUES(?,?,?,?,?,?,?,'visita','confirmada','local',?)`,
  pid, t6, types['Inspección eléctrica'], uid.electricista, uid.supervisor, start.toISOString(), new Date(start.getTime() + 3600_000).toISOString(), now())

const stored = 'demo-plano-fachada.pdf'
const pdfTxt = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 78>>stream\nBT /F1 20 Tf 60 780 Td (Plano de fachada - Edificio Alameda 45) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
fs.writeFileSync(path.join(config.uploadDir, stored), Buffer.from(pdfTxt))
const size = pdfTxt.length
const addDoc = (title: string, spec: string | null, status: string, by: string, fname: string) => {
  const doc = q.run('INSERT INTO documents(project_id,title,specialty,status,created_by,created_at) VALUES(?,?,?,?,?,?)', pid, title, spec, status, uid[by], now()).id
  const att = q.run("INSERT INTO attachments(project_id,entity,entity_id,kind,filename,stored_name,mime,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", pid, 'document_version', doc, 'documento', fname, stored, 'application/pdf', size, uid[by], now()).id
  q.run('INSERT INTO document_versions(document_id,version,attachment_id,notes,uploaded_by,created_at) VALUES(?,?,?,?,?,?)', doc, 1, att, 'Primera emisión', uid[by], now())
}
addDoc('Plano de fachada', 'arquitectura', 'en_revision', 'arquitecto', 'plano-fachada-v1.pdf')
addDoc('Cronograma general de obra', null, 'aprobado', 'supervisor', 'cronograma.pdf')

q.run("INSERT INTO survey_records(project_id,kind,title,x,y,level,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)", pid, 'replanteo', 'Eje A-1 / B-1', 1004512.25, 1101230.5, 2560.12, 'Replanteo de ejes de cimentación.', uid.topografo, now())
q.run("INSERT INTO nonconformities(project_id,title,description,severity,created_by,created_at) VALUES(?,?,?,?,?,?)", pid, 'Recubrimiento insuficiente en zapata Z3', 'Se mide 3 cm; el diseño pide 7 cm.', 'alta', uid.ingeniero, now())
q.run("INSERT INTO comments(entity,entity_id,project_id,user_id,body,created_at) VALUES('project',?,?,?,?,?)", pid, pid, uid.supervisor, '@ingeniero revisa por favor las vigas del nivel 1 antes del viernes.', now())

console.log('Datos de demostración cargados. Proyecto: "Edificio Alameda 45".')
console.log(`Usuarios: ${people.map((p) => `${p[0]}@demo.local`).join(', ')}`)
console.log(`Contraseña de todos: ${DEMO_PASSWORD}`)

}
