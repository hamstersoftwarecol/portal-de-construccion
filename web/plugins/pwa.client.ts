export default defineNuxtPlugin(() => {
  const pending = usePendingSync()
  try { pending.value = JSON.parse(localStorage.getItem('portal-queue') ?? '[]').length } catch {}
  const online = useState('online', () => navigator.onLine)
  const sync = async () => {
    online.value = navigator.onLine
    if (navigator.onLine) { const r = await flushQueue(); if (r.sent) useToast().push(`${r.sent} cambio(s) sincronizado(s)`) }
  }
  window.addEventListener('online', sync)
  window.addEventListener('offline', () => { online.value = false })
  sync()
  // Solo en producción: en desarrollo los archivos cambian sin hash y la caché del service worker estorbaría.
  if ('serviceWorker' in navigator && !import.meta.dev && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {})
})
