import nodemailer from 'nodemailer'
import { q, now, getSetting } from './db.js'
import { config } from './config.js'

export type Notice = { kind: string; ref?: string; title: string; body?: string; link?: string }

/** Cada canal es un adaptador. El canal "inapp" siempre está activo. */
export interface Notifier { channel: string; send(userId: number, n: Notice): void }

const InApp: Notifier = {
  channel: 'inapp',
  send(userId, n) {
    if (n.ref && q.get('SELECT 1 FROM notifications WHERE user_id=? AND kind=? AND ref=?', userId, n.kind, n.ref)) return
    q.run('INSERT INTO notifications(user_id,kind,ref,title,body,link,created_at) VALUES(?,?,?,?,?,?,?)',
      userId, n.kind, n.ref ?? null, n.title, n.body ?? '', n.link ?? null, now())
  },
}
const Email: Notifier = {
  channel: 'email',
  send(userId, n) {
    const u = q.get<{ email: string }>('SELECT email FROM users WHERE id=?', userId)
    if (u) q.run("INSERT INTO outbox(channel,to_addr,subject,body,created_at) VALUES('email',?,?,?,?)", u.email, n.title, n.body || n.title, now())
  },
}
const WhatsApp: Notifier = {
  channel: 'whatsapp',
  send(userId, n) {
    const p = q.get<{ phone: string }>('SELECT phone FROM profiles WHERE user_id=?', userId)
    if (p?.phone) q.run("INSERT INTO outbox(channel,to_addr,subject,body,created_at) VALUES('whatsapp',?,?,?,?)", p.phone, n.title, `${n.title}\n${n.body ?? ''}`, now())
  },
}
const ADAPTERS: Record<string, Notifier> = { inapp: InApp, email: Email, whatsapp: WhatsApp }

export function activeChannels(): string[] {
  const s = getSetting('notify_channels') ?? process.env.NOTIFY_CHANNELS ?? 'inapp'
  return Array.from(new Set(['inapp', ...s.split(',').map((x) => x.trim()).filter((x) => ADAPTERS[x])]))
}
export function notify(userId: number | null | undefined, n: Notice) {
  if (!userId) return
  for (const ch of activeChannels()) ADAPTERS[ch].send(userId, n)
}
export function notifyMany(ids: Array<number | null | undefined>, n: Notice) {
  for (const id of new Set(ids.filter(Boolean))) notify(id, n)
}

/** Entrega los mensajes pendientes del outbox si hay credenciales; si no, quedan en cola (modo local). */
export async function flushOutbox() {
  const rows = q.all<any>("SELECT * FROM outbox WHERE status='pendiente' ORDER BY id LIMIT 20")
  for (const r of rows) {
    try {
      if (r.channel === 'email' && config.smtpUrl) {
        await nodemailer.createTransport(config.smtpUrl).sendMail({ from: config.mailFrom, to: r.to_addr, subject: r.subject, text: r.body })
      } else if (r.channel === 'whatsapp' && config.whatsapp.token) {
        const res = await fetch(`https://graph.facebook.com/v20.0/${config.whatsapp.phoneId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: r.to_addr, type: 'text', text: { body: r.body } }),
        })
        if (!res.ok) throw new Error(`WhatsApp ${res.status}`)
      } else continue
      q.run("UPDATE outbox SET status='enviado', sent_at=? WHERE id=?", now(), r.id)
    } catch (e: any) {
      q.run("UPDATE outbox SET status='error', error=? WHERE id=?", String(e.message ?? e), r.id)
    }
  }
}
