import initSqlJs from 'sql.js/dist/sql-wasm.js'
import wasm from 'sql.js/dist/sql-wasm.wasm'
import { store } from './shim-fs.js'
import { registerStdFonts } from 'pdfkit'
import Helvetica from '../node_modules/pdfkit/js/standard-fonts/Helvetica.mjs'
import HelveticaBold from '../node_modules/pdfkit/js/standard-fonts/HelveticaBold.mjs'
import HelveticaOblique from '../node_modules/pdfkit/js/standard-fonts/HelveticaOblique.mjs'
registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique)

// ---------- almacenamiento persistente (IndexedDB con respaldo en memoria) ----------
const IDB = 'portal-construccion'
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const idbGet = async (k) => { try { const d = await idb(); return await new Promise((res, rej) => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) } catch { return undefined } }
const idbSet = async (k, v) => { try { const d = await idb(); await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error) }) } catch (e) { console.warn('No se pudo guardar:', e) } }

// ---------- cookies de sesión simuladas ----------
let sid = ''
try { sid = localStorage.getItem('portal-sid') || '' } catch {}
let lastSetCookie = null
const origAppend = Headers.prototype.append, origSet = Headers.prototype.set
Headers.prototype.append = function (n, v) { if (String(n).toLowerCase() === 'set-cookie') lastSetCookie = v; return origAppend.call(this, n, v) }
Headers.prototype.set = function (n, v) { if (String(n).toLowerCase() === 'set-cookie') lastSetCookie = v; return origSet.call(this, n, v) }

let appFetch
const ready = (async () => {
  const SQL = await initSqlJs({ wasmBinary: wasm })
  globalThis.__SQL = SQL
  const saved = await idbGet('state')
  if (saved) { globalThis.__DBBYTES = saved.db; for (const [k, v] of Object.entries(saved.files || {})) store.set(k, v) }
  const { buildApp } = await import('../server/src/app.js')
  const { startMaintenance } = await import('../server/src/maintenance.js')
  if (!saved) { const { runSeed } = await import('./seed-browser.js'); await runSeed() }
  appFetch = buildApp().fetch
  startMaintenance()
  const save = () => { if (!globalThis.__dirty) return; globalThis.__dirty = false; idbSet('state', { db: globalThis.__rawdb.export(), files: Object.fromEntries(store) }) }
  setInterval(save, 800); addEventListener('pagehide', save)
  globalThis.__portalReset = async () => { await idbSet('state', undefined); try { localStorage.removeItem('portal-sid') } catch {}; location.reload() }
})()
ready.catch((e) => { console.error(e); document.title = 'Error: ' + e.message })

// ---------- fetch: las llamadas a /api se resuelven dentro del navegador ----------
const realFetch = window.fetch.bind(window)
async function apiFetch(path, init = {}) {
  await ready
  const headers = new Headers(init.headers || {})
  const req = new Request('http://portal.local' + path, { method: init.method || 'GET', headers, body: init.body })
  const h2 = new Headers(req.headers); if (sid) h2.set('cookie', 'sid=' + sid)
  Object.defineProperty(req, 'headers', { value: h2 })
  lastSetCookie = null
  const res = await appFetch(req)
  if (lastSetCookie) {
    const m = /^sid=([^;]*)/.exec(lastSetCookie)
    if (m) { sid = /max-age=0|expires=thu, 01 jan 1970/i.test(lastSetCookie) ? '' : m[1]; try { localStorage.setItem('portal-sid', sid) } catch {} }
  }
  return res
}
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const m = /^(?:file:\/\/)?(\/api\/.*)$/.exec(url) || (() => { try { const u = new URL(url, location.href); return u.pathname.startsWith('/api/') && u.protocol === 'file:' ? [0, u.pathname + u.search] : null } catch { return null } })()
  if (!m) return realFetch(input, init)
  return apiFetch(m[1], init)
}

// ---------- descargas e imágenes (enlaces directos a /api/files/..., /report) ----------
const blobCache = new Map()
const apiPath = (v) => { if (!v) return null; const x = /^(?:file:\/\/)?(\/api\/[^#]*)$/.exec(v); return x ? x[1] : null }
async function blobFor(p) {
  if (!blobCache.has(p)) blobCache.set(p, apiFetch(p).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); const cd = r.headers.get('content-disposition') || ''; return { url: URL.createObjectURL(await r.blob()), cd } }))
  return blobCache.get(p)
}
const fixImg = (img) => { const p = apiPath(img.getAttribute('src')); if (p) blobFor(p).then((b) => { img.setAttribute('src', b.url) }).catch(() => {}) }
new MutationObserver((muts) => { for (const m of muts) { if (m.type === 'attributes') fixImg(m.target); m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === 'IMG') fixImg(n); n.querySelectorAll?.('img').forEach(fixImg) } }) } })
  .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
document.addEventListener('click', async (e) => {
  const a = e.target.closest?.('a[href]'); const p = a && apiPath(a.getAttribute('href')); if (!p) return
  e.preventDefault()
  const win = /inline/i.test('') ? null : null
  try {
    blobCache.delete(p)
    const b = await blobFor(p)
    const name = decodeURIComponent((/filename\*=UTF-8''([^;]+)/i.exec(b.cd) || /filename="?([^";]+)"?/i.exec(b.cd) || [])[1] || 'archivo')
    if (/^inline/i.test(b.cd)) window.open(b.url, '_blank')
    else { const t = document.createElement('a'); t.href = b.url; t.download = name; document.body.appendChild(t); t.click(); t.remove() }
  } catch (err) { alert('No se pudo abrir el archivo (' + err.message + ')') }
}, true)
