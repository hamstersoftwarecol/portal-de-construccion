import { makeBackup } from './routes/admin.js'
const r = makeBackup()
console.log(`Copia de seguridad creada: ${r.file} (${r.bytes} bytes)`)
