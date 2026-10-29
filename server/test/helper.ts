import './setup.ts'
import { buildApp } from '../src/app.ts'

export const app = buildApp()
const jars = new Map<string, string>()

export async function call(who: string | null, method: string, url: string, opts: { json?: unknown; form?: FormData; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (who && jars.has(who)) headers.cookie = jars.get(who)!
  let body: any
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  else if (opts.form) body = opts.form
  else if (opts.raw !== undefined) body = opts.raw
  const res = await app.request(`/api${url}`, { method, headers, body })
  const set = res.headers.get('set-cookie')
  if (who && set && /sid=/.test(set)) jars.set(who, set.split(';')[0])
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data: data as any, headers: res.headers }
}
export const login = async (key: string, password = 'Demo1234!') => (await call(key, 'POST', '/auth/login', { json: { email: `${key}@demo.local`, password } }))

export const png = () => new File([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))], 'foto.png', { type: 'image/png' })
export const pdfFile = (name = 'plano.pdf') => new File([Buffer.from('%PDF-1.4 prueba')], name, { type: 'application/pdf' })
export const form = (fields: Record<string, string | File | File[]>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) { if (Array.isArray(v)) v.forEach((x) => f.append(k, x)); else f.append(k, v as any) }
  return f
}
export const ROLE_KEYS = ['admin', 'supervisor', 'colaborador', 'arquitecto', 'ingeniero', 'topografo', 'plomero', 'electricista', 'soldador'] as const
export async function loginAll() { for (const k of ROLE_KEYS) { const r = await login(k); if (r.status !== 200) throw new Error(`login ${k}: ${r.status}`) } }
export const nextWeekdays = () => {
  const out: string[] = []
  for (let i = 1; out.length < 3 && i < 14; i++) {
    const d = new Date(Date.now() + i * 86400_000 - 5 * 3600_000)
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export async function bootstrap() {
  await import('../src/seed.ts')
  await loginAll()
}
export const ids = { admin: 1, supervisor: 2, colaborador: 3, arquitecto: 4, ingeniero: 5, topografo: 6, plomero: 7, electricista: 8, soldador: 9 }
