import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(ROOT, 'data')

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir,
  dbFile: process.env.DB_FILE ?? path.join(dataDir, 'portal.db'),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(dataDir, 'uploads'),
  backupDir: path.join(dataDir, 'backups'),
  allowOpenRegistration: (process.env.ALLOW_OPEN_REGISTRATION ?? 'true') === 'true',
  sessionDays: 7,
  // Zona horaria fija: Colombia no usa horario de verano.
  tzOffset: '-05:00',
  // Proveedores intercambiables (el valor guardado en "settings" tiene prioridad)
  schedulingProvider: process.env.SCHEDULING_PROVIDER ?? 'local',
  calendly: {
    token: process.env.CALENDLY_TOKEN ?? '',
    clientId: process.env.CALENDLY_CLIENT_ID ?? '',
    clientSecret: process.env.CALENDLY_CLIENT_SECRET ?? '',
    redirectUri: process.env.CALENDLY_REDIRECT_URI ?? 'http://localhost:3000/api/integrations/calendly/callback',
    webhookSigningKey: process.env.CALENDLY_WEBHOOK_KEY ?? '',
  },
  smtpUrl: process.env.SMTP_URL ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'portal@localhost',
  whatsapp: { token: process.env.WHATSAPP_TOKEN ?? '', phoneId: process.env.WHATSAPP_PHONE_ID ?? '' },
  maxUploadMb: 10,
  maxDocMb: 50,
}
