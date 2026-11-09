import { AttemptLimiter, LIMITS } from './attemptLimiter'

describe('AttemptLimiter', () => {
  it('counts down the remaining attempts', () => {
    const l = new AttemptLimiter()
    expect(l.check('k', 0)).toEqual({ ok: true, remaining: 5 })
    expect(l.fail('k', 0)).toEqual({ ok: true, remaining: 4 })
  })

  it('locks for 15 minutes after 5 failures, then opens again', () => {
    const l = new AttemptLimiter()
    for (let i = 0; i < 4; i++) l.fail('k', 1000)
    const r = l.fail('k', 1000)
    expect(r).toEqual({ ok: false, reason: 'locked', until: 1000 + LIMITS.softLockMs })
    expect(l.check('k', 1000 + LIMITS.softLockMs - 1).ok).toBe(false)
    expect(l.check('k', 1000 + LIMITS.softLockMs).ok).toBe(true)
  })

  it('needs a parent after 10 failures, even when time passes', () => {
    const l = new AttemptLimiter()
    let now = 0
    for (let i = 0; i < 10; i++) { l.fail('k', now); now += LIMITS.softLockMs }
    expect(l.check('k', now + 10 * LIMITS.softLockMs)).toEqual({ ok: false, reason: 'needs_parent' })
    l.release('k')
    expect(l.check('k', now).ok).toBe(true)
  })

  it('a success clears the count, and keys are separate', () => {
    const l = new AttemptLimiter()
    for (let i = 0; i < 4; i++) l.fail('a', 0)
    l.fail('b', 0)
    l.succeed('a')
    expect(l.check('a', 0)).toEqual({ ok: true, remaining: 5 })
    expect(l.check('b', 0)).toEqual({ ok: true, remaining: 4 })
  })
})
