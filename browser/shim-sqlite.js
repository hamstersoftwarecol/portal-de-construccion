// DatabaseSync (node:sqlite) implementado sobre sql.js (SQLite compilado a WebAssembly).
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql }
  all(...p) {
    const s = this.db.db.prepare(this.sql); const rows = []
    try { s.bind(p); while (s.step()) rows.push(s.getAsObject()) } finally { s.free() }
    return rows
  }
  get(...p) { return this.all(...p)[0] }
  run(...p) {
    const s = this.db.db.prepare(this.sql)
    try { s.bind(p); s.step() } finally { s.free() }
    globalThis.__dirty = true
    const id = this.db.db.exec('SELECT last_insert_rowid()')[0].values[0][0]
    return { lastInsertRowid: id, changes: this.db.db.getRowsModified() }
  }
}
export class DatabaseSync {
  constructor() { this.db = new globalThis.__SQL.Database(globalThis.__DBBYTES || undefined); globalThis.__rawdb = this.db }
  exec(sql) { this.db.exec(sql); globalThis.__dirty = true }
  prepare(sql) { return new Stmt(this, sql) }
}
