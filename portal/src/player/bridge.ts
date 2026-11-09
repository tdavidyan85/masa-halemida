// Bridge between the existing learning engine (unchanged) and a signed-in student.
//
// The engine runs in a SAME-ORIGIN iframe served by the portal (/play/<subject>/, first-party code). The portal
// watches the engine's own `track(kind, data)` calls – the same calls it already makes for anonymous counts –
// and turns them into practice events. Nothing is passed INTO the engine: no token, no session, no name, and the
// URL carries no secret. Outside the portal the engine works exactly as before.
//
// What this reports is UNVERIFIED practice (the browser could be manipulated). Results only come from the
// server-graded quiz.
import type { PracticeEvent } from '../data/types'

type TrackFn = (kind: string, data?: Record<string, unknown>) => unknown
interface EngineWindow { track?: TrackFn }

/** engine `track` call → practice event (or null for things that are not learning: open, print…) */
export function toPracticeEvent(kind: string, data: Record<string, unknown> | undefined, newId: () => string): PracticeEvent | null {
  const d = data ?? {}
  if (kind === 'q') {
    return { id: newId(), kind: 'question', skill: String(d.gen ?? '').slice(0, 60) || undefined, topic: String(d.topic ?? '').slice(0, 60) || undefined,
      ok: d.ok === true, ms: typeof d.ms === 'number' ? Math.max(0, Math.min(86_400_000, Math.round(d.ms))) : undefined }
  }
  if (kind === 'done') return { id: newId(), kind: 'round_done', topic: String(d.topic ?? '').slice(0, 60) || undefined }
  return null
}

/** wrap the engine's track(); the engine keeps working exactly as before. Returns a function that undoes it. */
export function attachTelemetry(win: EngineWindow, onEvent: (e: PracticeEvent) => void, newId: () => string = () => crypto.randomUUID()): () => void {
  const original = win.track
  if (typeof original !== 'function') return () => {}
  const wrapped: TrackFn = (kind, data) => {
    try { const e = toPracticeEvent(kind, data, newId); if (e) onEvent(e) } catch { /* reporting must never break the lesson */ }
    return original(kind, data)
  }
  win.track = wrapped
  return () => { if (win.track === wrapped) win.track = original }
}

/**
 * Sends events in small batches. Every event keeps its id, so a batch that is re-sent after a failure is
 * ignored by the server (idempotent). Failed batches stay queued and are retried.
 */
export class ProgressQueue {
  private pending: PracticeEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private sending: Promise<void> | null = null
  sent = 0
  failed = false
  constructor(private send: (events: PracticeEvent[]) => Promise<unknown>, private opts: { max?: number; delayMs?: number; onChange?: () => void } = {}) {}

  push(e: PracticeEvent) {
    this.pending.push(e)
    if (this.pending.length >= (this.opts.max ?? 10)) void this.flush()
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.opts.delayMs ?? 3000)
  }
  get waiting() { return this.pending.length }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.sending) await this.sending
    if (!this.pending.length) return
    const batch = this.pending.slice(0, 50)
    this.sending = this.send(batch).then(
      () => { this.pending = this.pending.slice(batch.length); this.sent += batch.length; this.failed = false },
      () => { this.failed = true },
    ).finally(() => { this.sending = null; this.opts.onChange?.() })
    await this.sending
    if (!this.failed && this.pending.length) await this.flush()
  }
}

/**
 * The engine keeps its own progress (stars, owl, levels) in localStorage 'mj-state'. In the portal several children
 * may share a device, so each signed-in student gets their own copy, swapped in before the engine starts.
 * Also turns off the engine's anonymous counts while embedded (the portal reports instead).
 */
const KEY = 'mj-state', OWNER = 'mj-portal-owner'
export function prepareEngineStorage(studentId: string, storage: Storage = localStorage) {
  const owner = storage.getItem(OWNER)
  if (owner !== studentId) {
    const current = storage.getItem(KEY)
    if (owner && current !== null) storage.setItem(`${KEY}@${owner}`, current)
    const mine = storage.getItem(`${KEY}@${studentId}`)
    if (mine !== null) storage.setItem(KEY, mine); else storage.removeItem(KEY)
    storage.setItem(OWNER, studentId)
  }
  try {
    const st = JSON.parse(storage.getItem(KEY) ?? 'null') as { settings?: Record<string, unknown> } | null
    if (st?.settings) { st.settings.noStats = true; storage.setItem(KEY, JSON.stringify(st)) }
    else storage.setItem(KEY, JSON.stringify({ stars: 0, streak: 0, best: 0, stats: {}, mistakes: [], days: {}, copied: 0,
      settings: { auto: true, rate: 0.8, voice: '', sound: true, rate2: 1, noStats: true } }))
  } catch { /* unreadable state: leave it to the engine */ }
}
/** on sign-out: put the child's engine progress away so the next child on this device does not see it */
export function stashEngineStorage(storage: Storage = localStorage) {
  const owner = storage.getItem(OWNER)
  const current = storage.getItem(KEY)
  if (owner && current !== null) storage.setItem(`${KEY}@${owner}`, current)
  storage.removeItem(KEY)
  storage.removeItem(OWNER)
}
