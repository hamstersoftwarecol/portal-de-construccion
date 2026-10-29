import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Se necesita Node.js 22.13 o superior (tienes ${process.versions.node}). Descárgalo en https://nodejs.org`)
  process.exit(1)
}
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'

export function ensureSeed() {
  const db = process.env.DB_FILE ?? path.join(process.env.DATA_DIR ?? path.join(root, 'data'), 'portal.db')
  if (fs.existsSync(db)) return
  console.log('Primera ejecución: creando la base de datos con datos de demostración…')
  const r = spawnSync(npm, ['run', 'seed', '-w', 'server'], { cwd: root, stdio: 'inherit', shell: isWin })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

export function run(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: isWin })
  p.on('exit', (code) => { if (code) { console.error(`[${name}] terminó con código ${code}`); shutdown(code) } })
  children.push(p)
  return p
}
const children = []
export function shutdown(code = 0) { for (const c of children) try { c.kill() } catch {} ; process.exit(code) }
process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0))
export { npm }
