import crypto from 'node:crypto'
import { q, now, getSetting } from '../db.js'
import { config } from '../config.js'
import { notifyMany } from '../notify.js'

export type Slot = { start: string; end: string }
export type BookArgs = { professionalId: number; typeId: number; startAt: string; inviteeName: string; inviteeEmail: string }
export type Booked = { start: string; end: string; externalId?: string }

/** Interfaz que aísla al resto del portal del proveedor de agenda (US-24). */
export interface SchedulingProvider {
  name: 'local' | 'calendly'
  listSlots(a: { professionalId: number; typeId: number; from: string; to: string; ignoreAppointmentId?: number }): Promise<Slot[]>
  book(a: BookArgs & { ignoreAppointmentId?: number }): Promise<Booked>
  cancel(a: { externalId?: string | null; reason: string }): Promise<void>
}

const tz = config.tzOffset
const toUtc = (date: string, time: string) => new Date(`${date}T${time}:00${tz}`)
const localDate = (d: Date) => new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 10)
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export function localSlots(professionalId: number, durationMin: number, from: string, to: string, ignoreAppointmentId?: number): Slot[] {
  const out: Slot[] = []
  const start = new Date(`${from}T12:00:00${tz}`)
  const days = Math.min(31, Math.max(1, Math.round((new Date(`${to}T12:00:00${tz}`).getTime() - start.getTime()) / 86400_000) + 1))
  const windows = q.all<{ weekday: number; start: string; end: string }>('SELECT weekday,start,"end" as end FROM availability WHERE user_id=?', professionalId)
  if (!windows.length) return out
  const blocks = q.all<{ date_from: string; date_to: string }>('SELECT date_from,date_to FROM time_blocks WHERE user_id=?', professionalId)
  const busy = q.all<{ start_at: string; end_at: string }>(
    "SELECT start_at,end_at FROM appointments WHERE professional_id=? AND status='confirmada' AND id<>?", professionalId, ignoreAppointmentId ?? 0)
    .map((b) => [Date.parse(b.start_at), Date.parse(b.end_at)] as const)
  const step = durationMin < 30 ? durationMin : 30
  const nowMs = Date.now()
  for (let i = 0; i < days; i++) {
    const date = localDate(new Date(start.getTime() + i * 86400_000))
    const weekday = new Date(`${date}T12:00:00${tz}`).getUTCDay()
    if (blocks.some((b) => date >= b.date_from && date <= b.date_to)) continue
    for (const w of windows.filter((x) => x.weekday === weekday)) {
      for (let m = minutes(w.start); m + durationMin <= minutes(w.end); m += step) {
        const s = toUtc(date, hhmm(m)).getTime()
        const e = s + durationMin * 60_000
        if (s < nowMs) continue
        if (busy.some(([bs, be]) => s < be && e > bs)) continue
        out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() })
      }
    }
  }
  return out
}

export class LocalSchedulingProvider implements SchedulingProvider {
  name = 'local' as const
  async listSlots(a: { professionalId: number; typeId: number; from: string; to: string; ignoreAppointmentId?: number }) {
    const t = q.get<{ duration_min: number }>('SELECT duration_min FROM appointment_types WHERE id=?', a.typeId)
    if (!t) return []
    return localSlots(a.professionalId, t.duration_min, a.from, a.to, a.ignoreAppointmentId)
  }
  async book(a: BookArgs & { ignoreAppointmentId?: number }): Promise<Booked> {
    const day = localDate(new Date(a.startAt))
    const slots = await this.listSlots({ professionalId: a.professionalId, typeId: a.typeId, from: day, to: day, ignoreAppointmentId: a.ignoreAppointmentId })
    const wanted = new Date(a.startAt).toISOString()
    const slot = slots.find((s) => s.start === wanted)
    if (!slot) throw Object.assign(new Error('El horario ya no está disponible'), { status: 409 })
    return { start: slot.start, end: slot.end }
  }
  async cancel() { /* nada que avisar fuera del portal */ }
}

// ---------------- Calendly (integración opcional, desactivada por defecto) ----------------
export const calendlyToken = () => getSetting('calendly_token') || config.calendly.token

export class CalendlyProvider implements SchedulingProvider {
  name = 'calendly' as const
  private async api(path: string, init?: RequestInit) {
    const res = await fetch(`https://api.calendly.com${path}`, {
      ...init, headers: { Authorization: `Bearer ${calendlyToken()}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw Object.assign(new Error(`Calendly respondió ${res.status}`), { status: 502 })
    return res.json() as Promise<any>
  }
  private uri(typeId: number) {
    const t = q.get<{ calendly_uri: string | null }>('SELECT calendly_uri FROM appointment_types WHERE id=?', typeId)
    if (!t?.calendly_uri) throw Object.assign(new Error('El tipo de cita no tiene evento de Calendly asociado'), { status: 422 })
    return t.calendly_uri
  }
  async listSlots(a: { professionalId: number; typeId: number; from: string; to: string }) {
    const start = new Date(Math.max(Date.now() + 60_000, toUtc(a.from, '00:00').getTime()))
    const end = new Date(Math.min(start.getTime() + 7 * 86400_000, toUtc(a.to, '23:59').getTime()))
    const qs = new URLSearchParams({ event_type: this.uri(a.typeId), start_time: start.toISOString(), end_time: end.toISOString() })
    const data = await this.api(`/event_type_available_times?${qs}`)
    const dur = q.get<{ duration_min: number }>('SELECT duration_min FROM appointment_types WHERE id=?', a.typeId)?.duration_min ?? 30
    return (data.collection ?? []).filter((s: any) => s.status === 'available').map((s: any) => ({
      start: new Date(s.start_time).toISOString(), end: new Date(Date.parse(s.start_time) + dur * 60_000).toISOString(),
    }))
  }
  async book(a: BookArgs): Promise<Booked> {
    const data = await this.api('/invitees', {
      method: 'POST',
      body: JSON.stringify({ event_type: this.uri(a.typeId), start_time: a.startAt, invitee: { name: a.inviteeName, email: a.inviteeEmail, timezone: 'America/Bogota' } }),
    })
    const dur = q.get<{ duration_min: number }>('SELECT duration_min FROM appointment_types WHERE id=?', a.typeId)?.duration_min ?? 30
    return { start: new Date(a.startAt).toISOString(), end: new Date(Date.parse(a.startAt) + dur * 60_000).toISOString(), externalId: data.resource?.event }
  }
  async cancel(a: { externalId?: string | null; reason: string }) {
    if (!a.externalId) return
    const uuid = a.externalId.split('/').pop()
    await this.api(`/scheduled_events/${uuid}/cancellation`, { method: 'POST', body: JSON.stringify({ reason: a.reason }) })
  }
}

const local = new LocalSchedulingProvider()
export function activeProviderName(): 'local' | 'calendly' {
  const wanted = getSetting('scheduling_provider') ?? config.schedulingProvider
  return wanted === 'calendly' && calendlyToken() ? 'calendly' : 'local'
}
export const getProvider = (name?: string): SchedulingProvider => ((name ?? activeProviderName()) === 'calendly' ? new CalendlyProvider() : local)

// ---------------- Webhooks de Calendly (US-42) ----------------
export function verifyCalendlySignature(raw: string, header: string | undefined, key: string, toleranceSec = 300): boolean {
  if (!header || !key) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]))
  if (!parts.t || !parts.v1) return false
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false
  const expected = crypto.createHmac('sha256', key).update(`${parts.t}.${raw}`).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(parts.v1)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Aplica un evento de Calendly a las citas del portal. Devuelve qué hizo, para pruebas y registro. */
export function handleCalendlyEvent(payload: any): { handled: boolean; action?: string; appointmentId?: number } {
  const event = payload?.event as string | undefined
  const p = payload?.payload ?? {}
  const eventUri: string | undefined = p.scheduled_event?.uri ?? p.event
  if (!event || !eventUri) return { handled: false }
  const appt = q.get<any>("SELECT * FROM appointments WHERE external_id=? AND provider='calendly'", eventUri)
  if (!appt) return { handled: false, action: 'sin_cita_asociada' }
  const people = [appt.professional_id, appt.requested_by]
  if (event === 'invitee.canceled' && appt.status !== 'cancelada') {
    q.run("UPDATE appointments SET status='cancelada', cancel_reason=? WHERE id=?", p.cancellation?.reason ?? 'Cancelada desde Calendly', appt.id)
    notifyMany(people, { kind: 'appt_cancel', ref: `ext-cancel-${appt.id}`, title: 'Cita cancelada desde Calendly', link: `/proyectos/${appt.project_id}?tab=agenda` })
    return { handled: true, action: 'cancelada', appointmentId: appt.id }
  }
  if (event === 'invitee.canceled') return { handled: true, action: 'ya_cancelada', appointmentId: appt.id }
  if (event === 'invitee.created') {
    const start = p.scheduled_event?.start_time
    if (start && new Date(start).toISOString() !== appt.start_at) {
      const end = p.scheduled_event?.end_time ?? start
      q.run("UPDATE appointments SET start_at=?, end_at=?, status='confirmada' WHERE id=?", new Date(start).toISOString(), new Date(end).toISOString(), appt.id)
      notifyMany(people, { kind: 'appt_move', ref: `ext-move-${appt.id}-${start}`, title: 'Cita reprogramada desde Calendly', link: `/proyectos/${appt.project_id}?tab=agenda` })
      return { handled: true, action: 'reprogramada', appointmentId: appt.id }
    }
    return { handled: true, action: 'confirmada', appointmentId: appt.id }
  }
  void now
  return { handled: false }
}
