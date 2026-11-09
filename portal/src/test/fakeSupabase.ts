// A small fake of the supabase-js client for unit tests. It records every call and imitates the parts of the
// real database that matter to the portal: column grants (closed columns → "permission denied", as Postgres
// does) and basic eq/in filters. It does NOT imitate RLS – that is tested against PostgreSQL in supabase/tests.
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
interface Reply { data?: unknown; error?: { code?: string; message: string } | null }
interface FnReply { data?: unknown; status?: number; body?: Row }
export interface FakeUser { id: string; user_metadata?: Row }

export interface FakeOptions {
  tables?: Record<string, Row[]>
  /** columns the API may NOT read (mirrors the column grants in the migrations) */
  closed?: Record<string, string[]>
  rpc?: Record<string, (args: Row) => Reply>
  functions?: Record<string, (body: Row) => FnReply>
  signIn?: (email: string, password: string) => { user?: FakeUser; error?: string }
  /** access tokens accepted by setSession → the user they belong to */
  tokens?: Record<string, FakeUser>
  sessionUser?: FakeUser | null
}

export const CLOSED = { students: ['birth_date', 'username', 'created_by'], invitations: ['contact_hash'], student_devices: ['token_hash'] }

export function fakeSupabase(opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = structuredClone(opts.tables ?? {})
  const closed = { ...CLOSED, ...(opts.closed ?? {}) }
  const calls = { selects: [] as { table: string; cols: string }[], inserts: [] as { table: string; row: Row }[], rpc: [] as { fn: string; args: Row }[],
    invoke: [] as { name: string; body: Row }[], auth: [] as { op: string; args: unknown }[] }
  let user: FakeUser | null = opts.sessionUser ?? null
  let authCb: ((event: string, session: unknown) => void) | null = null

  function query(table: string) {
    const st: { cols: string; filters: ((r: Row) => boolean)[]; insert?: Row | Row[]; patch?: Row; del?: boolean; one?: 'single' | 'maybe' } = { cols: '', filters: [] }
    const run = (): Reply => {
      const banned = closed[table as keyof typeof closed] ?? []
      const cols = st.cols.split(',').map(c => c.trim()).filter(Boolean)
      if (cols.includes('*') && banned.length) return { error: { code: '42501', message: `permission denied for table ${table}` } }
      if (cols.some(c => banned.includes(c))) return { error: { code: '42501', message: `permission denied for table ${table}` } }
      let rows: Row[]
      if (st.insert) {
        rows = (Array.isArray(st.insert) ? st.insert : [st.insert]).map(x => {
          const row = { id: `new-${(tables[table] ?? []).length + 1}`, created_at: '2026-11-09', archived_at: null, ...x }
          ;(tables[table] ??= []).push(row); return row
        })
      } else if (st.patch) {
        rows = (tables[table] ?? []).filter(r => st.filters.every(f => f(r)))
        rows.forEach(r => Object.assign(r, st.patch))
      } else if (st.del) {
        rows = (tables[table] ?? []).filter(r => st.filters.every(f => f(r)))
        tables[table] = (tables[table] ?? []).filter(r => !rows.includes(r))
      } else rows = (tables[table] ?? []).filter(r => st.filters.every(f => f(r)))
      const pick = (r: Row) => (cols.length ? Object.fromEntries(cols.map(c => [c, r[c]])) : r)
      if (st.one === 'single') return rows.length === 1 ? { data: pick(rows[0]) } : { error: { code: 'PGRST116', message: 'not exactly one row' } }
      if (st.one === 'maybe') return { data: rows[0] ? pick(rows[0]) : null }
      return { data: rows.map(pick) }
    }
    const b = {
      select(cols = '*') { st.cols = cols; calls.selects.push({ table, cols }); return b },
      insert(row: Row | Row[]) { st.insert = row; calls.inserts.push({ table, row: row as Row }); return b },
      update(patch: Row) { st.patch = patch; calls.inserts.push({ table, row: { update: patch } }); return b },
      delete() { st.del = true; return b },
      limit() { return b },
      eq(c: string, v: unknown) { st.filters.push(r => r[c] === v); return b },
      in(c: string, vs: unknown[]) { st.filters.push(r => vs.includes(r[c])); return b },
      order() { return b },
      single() { st.one = 'single'; return b },
      maybeSingle() { st.one = 'maybe'; return b },
      then<A>(res: (v: { data: unknown; error: unknown }) => A, rej?: (e: unknown) => A) {
        const r = run()
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(res, rej)
      },
    }
    return b
  }

  const fnError = (status: number, body: Row) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) } })
  const sessionOf = (u: FakeUser | null) => (u ? { user: u, access_token: 'at', refresh_token: 'rt' } : null)

  const client = {
    from: query,
    async rpc(fn: string, args: Row = {}) {
      calls.rpc.push({ fn, args })
      const h = opts.rpc?.[fn]
      const r = h ? h(args) : { data: null }
      return { data: r.data ?? null, error: r.error ?? null }
    },
    functions: {
      async invoke(name: string, { body }: { body: Row }) {
        calls.invoke.push({ name, body })
        const h = opts.functions?.[name]
        if (!h) return fnError(404, { error: 'missing' })
        const r = h(body)
        return r.status && r.status >= 400 ? fnError(r.status, r.body ?? {}) : { data: r.data ?? r.body ?? null, error: null }
      },
    },
    storage: { from: () => ({ async createSignedUrl(path: string) { return { data: { signedUrl: `https://signed.test/${path}` }, error: null } } }) },
    auth: {
      async getSession() { return { data: { session: sessionOf(user) }, error: null } },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        calls.auth.push({ op: 'signInWithPassword', args: { email } })
        const r = opts.signIn?.(email, password) ?? { error: 'Invalid login credentials' }
        if (r.error) return { data: { user: null, session: null }, error: { message: r.error } }
        user = r.user!
        return { data: { user, session: sessionOf(user) }, error: null }
      },
      async signUp(args: Row) { calls.auth.push({ op: 'signUp', args }); return { data: { user: { id: 'new' }, session: null }, error: null } },
      async resetPasswordForEmail(email: string, o: Row) { calls.auth.push({ op: 'resetPasswordForEmail', args: { email, ...o } }); return { data: {}, error: { message: 'User not found' } } },
      async updateUser(args: Row) { calls.auth.push({ op: 'updateUser', args }); return { data: { user }, error: null } },
      async setSession(t: { access_token: string; refresh_token: string }) {
        calls.auth.push({ op: 'setSession', args: t })
        const u = opts.tokens?.[t.access_token]
        if (!u) return { data: { user: null, session: null }, error: { message: 'Invalid token' } }
        user = u
        return { data: { user: u, session: sessionOf(u) }, error: null }
      },
      async signOut() { calls.auth.push({ op: 'signOut', args: null }); user = null; authCb?.('SIGNED_OUT', null); return { error: null } },
      onAuthStateChange(cb: (event: string, session: unknown) => void) {
        authCb = cb
        return { data: { subscription: { unsubscribe() { authCb = null } } } }
      },
    },
  }
  return {
    client: client as unknown as SupabaseClient,
    calls,
    tables,
    /** simulate an auth event coming from Supabase (e.g. a password-reset link was opened) */
    emit(event: string, u: FakeUser | null) { user = u; authCb?.(event, sessionOf(u)) },
  }
}
