import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { authRoutes, requireAuth } from './routes/auth.js'
import { adminRoutes } from './routes/admin.js'
import { projectRoutes } from './routes/projects.js'
import { peopleRoutes } from './routes/people.js'
import { taskRoutes } from './routes/tasks.js'
import { scheduleRoutes, webhookRoutes } from './routes/schedule.js'
import { docRoutes } from './routes/docs.js'
import { miscRoutes } from './routes/misc.js'
import type { Env } from './util.js'

export function buildApp() {
  const app = new Hono<Env>()
  const api = new Hono<Env>()

  api.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }))
  api.route('/', webhookRoutes as any)          // público, firmado
  api.route('/', authRoutes)                     // register / login / reset públicos; /auth/me protegido dentro

  // Todo lo demás exige sesión
  const protectedApi = new Hono<Env>()
  protectedApi.use('*', requireAuth)
  for (const r of [adminRoutes, projectRoutes, peopleRoutes, taskRoutes, scheduleRoutes, docRoutes, miscRoutes]) protectedApi.route('/', r)
  api.route('/', protectedApi)

  app.route('/api', api)

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    if (err instanceof ZodError) {
      const msg = err.issues.map((i) => i.message).join('; ')
      return c.json({ error: msg, issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400)
    }
    console.error(err)
    return c.json({ error: 'Error interno del servidor' }, 500)
  })
  app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404))
  return app
}
