import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// Cada archivo de prueba corre en su propio proceso con su propia base temporal.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'))
process.env.CALENDLY_WEBHOOK_KEY = 'clave-de-prueba'
