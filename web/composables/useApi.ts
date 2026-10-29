export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

type Opts = { method?: string; body?: unknown; form?: FormData; query?: Record<string, unknown> }

export async function api<T = any>(url: string, opts: Opts = {}): Promise<T> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))
    : ''
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} }
  if (opts.body !== undefined) { (init.headers as any)['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body) }
  if (opts.form) init.body = opts.form
  let res: Response
  try { res = await fetch('/api' + url + qs, init) } catch { throw new ApiError('Sin conexión con el servidor', 0) }
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const data = isJson ? await res.json() : null
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
      const s = useSession(); s.user.value = null
      if (useRoute().path !== '/login') navigateTo('/login')
    }
    throw new ApiError(data?.error ?? `Error ${res.status}`, res.status)
  }
  return data as T
}

// ---- Cola sin conexión (PWA): cambios de estado y comentarios se envían al reconectar ----
const KEY = 'portal-queue'
type Queued = { url: string; body: unknown; at: number; label: string }
const read = (): Queued[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const write = (q: Queued[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)) } catch {} }

export function usePendingSync() { return useState<number>('pending-sync', () => 0) }

export async function apiOrQueue(url: string, body: unknown, label: string) {
  try { return await api(url, { body }) } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      write([...read(), { url, body, at: Date.now(), label }])
      usePendingSync().value = read().length
      return { queued: true }
    }
    throw e
  }
}

let flushing = false
export async function flushQueue() {
  if (flushing) return { sent: 0, failed: 0 }
  const items = read()
  if (!items.length) return { sent: 0, failed: 0 }
  flushing = true
  try { return await flushItems(items) } finally { flushing = false }
}

async function flushItems(items: Queued[]) {
  const remaining: Queued[] = []; let sent = 0, failed = 0
  for (const it of items) {
    try { await api(it.url, { body: it.body }); sent++ } catch (e) {
      if (e instanceof ApiError && e.status === 0) remaining.push(it)   // sigue sin red
      else failed++                                                      // el servidor lo rechazó: se descarta
    }
  }
  write(remaining)
  usePendingSync().value = remaining.length
  return { sent, failed }
}
