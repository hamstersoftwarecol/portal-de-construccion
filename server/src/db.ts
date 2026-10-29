import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true })
fs.mkdirSync(config.uploadDir, { recursive: true })

export const raw = new DatabaseSync(config.dbFile)
raw.exec('PRAGMA busy_timeout = 5000;')
// WAL es más rápido y permite lecturas mientras se escribe; algunos sistemas de archivos (carpetas de red o
// sincronizadas) no lo soportan, así que se vuelve al modo clásico si falla.
try { raw.exec('PRAGMA journal_mode = WAL;') } catch { raw.exec('PRAGMA journal_mode = DELETE;') }
raw.exec('PRAGMA foreign_keys = ON;')

type P = unknown[]
const norm = (p: P) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as any[]

/** Capa mínima de acceso a datos. Un adaptador PostgreSQL implementaría estas mismas tres funciones. */
export const q = {
  all: <T = any>(sql: string, ...p: P): T[] => raw.prepare(sql).all(...norm(p)) as T[],
  get: <T = any>(sql: string, ...p: P): T | undefined => raw.prepare(sql).get(...norm(p)) as T | undefined,
  run: (sql: string, ...p: P) => {
    const r = raw.prepare(sql).run(...norm(p))
    return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }
  },
  tx: <T>(fn: () => T): T => {
    raw.exec('BEGIN')
    try { const r = fn(); raw.exec('COMMIT'); return r } catch (e) { raw.exec('ROLLBACK'); throw e }
  },
}

export const now = () => new Date().toISOString()

raw.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reset_codes (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planificacion', created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(project_id, user_id));
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, role TEXT NOT NULL,
  email TEXT, created_by INTEGER, expires_at TEXT NOT NULL, used_by INTEGER, used_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'abierta');
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, specialty TEXT, zone TEXT, phone TEXT, bio TEXT, photo_file_id INTEGER);
CREATE TABLE IF NOT EXISTS certifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, number TEXT NOT NULL,
  expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', specialty TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'media',
  due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', assignee_id INTEGER REFERENCES users(id),
  created_by INTEGER, review_comment TEXT, nc_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_deps (task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, depends_on INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY(task_id, depends_on));
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id INTEGER, kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY, project_id INTEGER, entity TEXT NOT NULL, entity_id INTEGER, kind TEXT NOT NULL DEFAULT 'archivo',
  filename TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appointment_types (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, specialty TEXT NOT NULL, duration_min INTEGER NOT NULL, calendly_uri TEXT);
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, weekday INTEGER NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date_from TEXT NOT NULL, date_to TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  type_id INTEGER REFERENCES appointment_types(id), professional_id INTEGER NOT NULL REFERENCES users(id), requested_by INTEGER NOT NULL,
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'visita', status TEXT NOT NULL DEFAULT 'confirmada',
  cancel_reason TEXT, result TEXT, result_notes TEXT, notes TEXT, provider TEXT NOT NULL DEFAULT 'local', external_id TEXT,
  reminded_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_appt_prof ON appointments(professional_id, start_at);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, specialty TEXT,
  status TEXT NOT NULL DEFAULT 'borrador', created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, version INTEGER NOT NULL,
  attachment_id INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', uploaded_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_comments (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, version INTEGER, user_id INTEGER, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS survey_records (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL,
  x REAL, y REAL, level REAL, notes TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nonconformities (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'media', status TEXT NOT NULL DEFAULT 'abierta', task_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT, title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', link TEXT, read_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, detail TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', error TEXT, created_at TEXT NOT NULL, sent_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

export function getSetting(key: string): string | undefined {
  return q.get<{ value: string }>('SELECT value FROM settings WHERE key=?', key)?.value
}
export function setSetting(key: string, value: string) {
  q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value)
}
