// Failed-login limiter. The SAME rules will run on the server (student-login Edge Function) – in the browser
// it only drives the demo UI and can be bypassed, so it is NOT a security control on its own.
//   5 failures in a row  → locked for 15 minutes
//   10 failures in a row → locked until a parent releases the account
export const LIMITS = { softMax: 5, softLockMs: 15 * 60 * 1000, hardMax: 10 }

export interface AttemptState { failures: number; lockedUntil: number; hardLocked: boolean }
export type CheckResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'locked'; until: number }
  | { ok: false; reason: 'needs_parent' }

export class AttemptLimiter {
  private state = new Map<string, AttemptState>()
  constructor(private limits = LIMITS) {}

  private get(key: string): AttemptState {
    return this.state.get(key) ?? { failures: 0, lockedUntil: 0, hardLocked: false }
  }

  check(key: string, now = Date.now()): CheckResult {
    const st = this.get(key)
    if (st.hardLocked) return { ok: false, reason: 'needs_parent' }
    if (st.lockedUntil > now) return { ok: false, reason: 'locked', until: st.lockedUntil }
    return { ok: true, remaining: this.limits.softMax - (st.failures % this.limits.softMax) }
  }

  fail(key: string, now = Date.now()): CheckResult {
    const st = { ...this.get(key) }
    st.failures += 1
    if (st.failures >= this.limits.hardMax) st.hardLocked = true
    else if (st.failures % this.limits.softMax === 0) st.lockedUntil = now + this.limits.softLockMs
    this.state.set(key, st)
    return this.check(key, now)
  }

  succeed(key: string): void { this.state.delete(key) }

  /** what a verified parent does from the parents' corner */
  release(key: string): void { this.state.delete(key) }
}
