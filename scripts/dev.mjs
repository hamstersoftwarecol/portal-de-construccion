// Desarrollo: API (Hono) con recarga + Nuxt en modo dev. Crea la base y los datos demo la primera vez.
import { ensureSeed, run, npm } from './lib.mjs'
ensureSeed()
run('api', npm, ['run', 'dev', '-w', 'server'])
run('web', npm, ['run', 'dev', '-w', 'web'])
console.log('\nPortal en http://localhost:3000   (API en http://localhost:3001/api)\n')
