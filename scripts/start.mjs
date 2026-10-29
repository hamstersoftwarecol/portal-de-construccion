// Producción local: compila el frontend una vez y sirve todo (Nuxt en :3000, API en :3001).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureSeed, run, npm, root } from './lib.mjs'
ensureSeed()
if (!fs.existsSync(path.join(root, 'web', '.output', 'server', 'index.mjs'))) {
  console.log('Compilando el frontend (solo la primera vez)…')
  const r = spawnSync(npm, ['run', 'build', '-w', 'web'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
run('api', npm, ['run', 'start', '-w', 'server'])
run('web', process.execPath, [path.join('web', '.output', 'server', 'index.mjs')], { PORT: '3000', NITRO_PORT: '3000', NITRO_HOST: '0.0.0.0' })
console.log('\nPortal en http://localhost:3000\n')
