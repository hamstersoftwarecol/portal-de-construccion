import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { config } from './config.js'
import { startMaintenance } from './maintenance.js'
import { q } from './db.js'

// Si la base existe pero está vacía (primer arranque fallido, datos borrados), se cargan los usuarios demo.
if (!q.get('SELECT 1 FROM users LIMIT 1')) await import('./seed.js')

const app = buildApp()
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API del portal lista en http://localhost:${info.port}/api`)
})
startMaintenance()
