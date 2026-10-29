// Sistema de archivos en memoria (se guarda junto con la base de datos en el navegador).
import { Buffer } from 'buffer'
export const store = new Map()
export const mkdirSync = () => {}
export const existsSync = (p) => store.has(p)
export const writeFileSync = (p, d) => { store.set(p, new Uint8Array(d)); globalThis.__dirty = true }
export const readFileSync = (p) => { const d = store.get(p); if (!d) throw new Error('ENOENT ' + p); return Buffer.from(d) }
export const statSync = (p) => ({ size: (store.get(p) || []).length })
export const copyFileSync = (a, b) => store.set(b, store.get(a))
export default { store, mkdirSync, existsSync, writeFileSync, readFileSync, statSync, copyFileSync }
