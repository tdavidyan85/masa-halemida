import { ProgressQueue, attachTelemetry, prepareEngineStorage, stashEngineStorage, toPracticeEvent } from './bridge'
import type { PracticeEvent } from '../data/types'

let n = 0
const id = () => `e${++n}`

describe('engine telemetry → practice events', () => {
  it('maps questions and finished rounds; ignores everything else', () => {
    expect(toPracticeEvent('q', { mode: 'gen', gen: 'pk_add', topic: 'frac', ok: true, ms: 4321.6 }, id)).toEqual({ id: expect.any(String), kind: 'question', skill: 'pk_add', topic: 'frac', ok: true, ms: 4322 })
    expect(toPracticeEvent('done', { topic: 'exam-2', n: 10, score: 9 }, id)).toEqual({ id: expect.any(String), kind: 'round_done', topic: 'exam-2' })
    for (const k of ['open', 'print', 'unknown']) expect(toPracticeEvent(k, {}, id)).toBeNull()
  })
  it('the engine\'s own score is never taken as a result (no score field reaches the server)', () => {
    const e = toPracticeEvent('done', { topic: 't', n: 10, score: 10 }, id)!
    expect(Object.keys(e)).not.toContain('score')
  })
  it('clamps odd values from the page', () => {
    expect(toPracticeEvent('q', { gen: 'x'.repeat(200), ok: 'yes', ms: -5 }, id)).toMatchObject({ skill: 'x'.repeat(60), ok: false, ms: 0 })
  })
  it('wraps track(), keeps the engine working, and can be undone', () => {
    const calls: unknown[] = []
    const win: { track?: (k: string, d?: Record<string, unknown>) => unknown } = { track: (k, d) => { calls.push([k, d]); return 'orig' } }
    const original = win.track
    const got: PracticeEvent[] = []
    const detach = attachTelemetry(win, e => got.push(e), id)
    expect(win.track!('q', { gen: 'g', ok: true })).toBe('orig')
    win.track!('open')
    expect(calls).toHaveLength(2)
    expect(got.map(e => e.kind)).toEqual(['question'])
    detach()
    expect(win.track).toBe(original)
  })
  it('a failing reporter never breaks the lesson', () => {
    const win = { track: () => 'ok' }
    attachTelemetry(win, () => { throw new Error('boom') }, id)
    expect(win.track()).toBe('ok')
  })
})

describe('ProgressQueue', () => {
  it('sends in batches and re-sends the SAME event ids after a failure', async () => {
    const sent: string[][] = []
    let fail = true
    const q = new ProgressQueue(async b => { sent.push(b.map(e => e.id)); if (fail) throw new Error('offline') }, { max: 10, delayMs: 10_000 })
    q.push({ id: 'a', kind: 'question' }); q.push({ id: 'b', kind: 'question' })
    await q.flush()
    expect(q.failed).toBe(true); expect(q.waiting).toBe(2)
    fail = false
    await q.flush()
    expect(sent).toEqual([['a', 'b'], ['a', 'b']])
    expect(q.sent).toBe(2); expect(q.waiting).toBe(0)
  })
})

describe('engine storage per student on a shared device', () => {
  it('each child gets their own engine progress; sign-out puts it away', () => {
    localStorage.clear()
    prepareEngineStorage('kid-a')
    localStorage.setItem('mj-state', JSON.stringify({ stars: 7, settings: {} }))
    prepareEngineStorage('kid-b')
    expect(JSON.parse(localStorage.getItem('mj-state')!).stars).toBe(0)        // B never sees A's stars
    prepareEngineStorage('kid-a')
    expect(JSON.parse(localStorage.getItem('mj-state')!).stars).toBe(7)
    expect(JSON.parse(localStorage.getItem('mj-state')!).settings.noStats).toBe(true)
    stashEngineStorage()
    expect(localStorage.getItem('mj-state')).toBeNull()
    prepareEngineStorage('kid-a')
    expect(JSON.parse(localStorage.getItem('mj-state')!).stars).toBe(7)
  })
})
