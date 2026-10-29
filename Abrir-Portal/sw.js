// Service worker del portal: la aplicación abre sin conexión y las listas de tareas se leen de la caché.
const STATIC = 'portal-static-v1'
const API = 'portal-api'
const API_CACHEABLE = [/^\/api\/tasks\/mine$/, /^\/api\/tasks\/\d+$/, /^\/api\/auth\/me$/, /^\/api\/projects(\/\d+)?$/, /^\/api\/projects\/\d+\/tasks$/, /^\/api\/notifications/]

self.addEventListener('install', (e) => { e.waitUntil(caches.open(STATIC).then((c) => c.addAll(['/', '/icon.svg'])).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![STATIC, API].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) {
    if (!API_CACHEABLE.some((r) => r.test(url.pathname))) return
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(API).then((c) => c.put(url.pathname, copy)) } return res })
      .catch(() => caches.open(API).then((c) => c.match(url.pathname)).then((hit) => hit || new Response(JSON.stringify({ error: 'Sin conexión' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))))
    return
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(STATIC).then((c) => c.put('/', copy)); return res }).catch(() => caches.match('/')))
    return
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)) } return res })))
})
