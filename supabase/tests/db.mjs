// Test database: a throwaway LOCAL PostgreSQL (embedded-postgres, real server binaries) in a temp folder.
// Never connects to any cloud project. Applies: Supabase shim (test-only) → migrations → fictional fixtures.
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PASSWORD = 'local-test-only'          // throwaway local server, deleted after the run

export async function startDb() {
  const dir = mkdtempSync(join(tmpdir(), 'masa-pg-'))
  const port = 55000 + Math.floor(Math.random() * 5000)
  const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: PASSWORD, persistent: false, onLog: () => {} })
  await server.initialise()
  await server.start()
  const client = new pg.Client({ host: 'localhost', port, user: 'postgres', password: PASSWORD, database: 'postgres' })
  await client.connect()
  const files = [
    join(ROOT, 'tests/shim/supabase_shim.sql'),
    ...readdirSync(join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort().map(f => join(ROOT, 'migrations', f)),
    join(ROOT, 'tests/fixtures.sql'),
  ]
  const stop = async () => { await client.end().catch(() => {}); await server.stop().catch(() => {}); rmSync(dir, { recursive: true, force: true }) }
  for (const f of files) {
    try { await client.query(readFileSync(f, 'utf8')) }
    catch (e) {
      await stop()            // a broken migration must not leave a server running (the test run would hang)
      process.exitCode = 1    // node:test does not count a failed before() hook as a failed test – make the run fail anyway
      throw new Error(`failed applying ${f.replace(ROOT + '/', '')}: ${e.message}`)
    }
  }
  return { client, stop, applied: files.map(f => f.replace(ROOT + '/', '')) }
}

/** run fn inside a transaction that is always rolled back, so every test starts from the fixtures */
export async function tx(client, fn) {
  await client.query('begin')
  try { await fn(session(client)) } finally { await client.query('rollback') }
}

function session(client) {
  let n = 0
  const s = {
    /** act as a signed-in user (role "authenticated" + JWT claims), as PostgREST does on Supabase */
    async as(userId) {
      await client.query('reset role')
      if (userId === 'anon') {
        await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`)
        await client.query('set local role anon')
      } else {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
        await client.query('set local role authenticated')
      }
      return s
    },
    /** act as the server (Edge Functions use the service role, which bypasses RLS) */
    async asService() {
      await client.query('reset role')
      await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
      await client.query('set local role service_role')
      return s
    },
    /** act as the database owner (setup inside a test) */
    async asOwner() { await client.query('reset role'); return s },
    async rows(sql, params = []) { return (await client.query(sql, params)).rows },
    async count(sql, params = []) { return (await client.query(sql, params)).rowCount },
    async one(sql, params = []) { const r = (await client.query(sql, params)).rows; return r[0] },
    /** the statement must fail; returns the error. Uses a savepoint so the transaction stays usable. */
    async fails(sql, params = []) {
      const sp = `sp${++n}`
      await client.query(`savepoint ${sp}`)
      try { await client.query(sql, params) } catch (e) { await client.query(`rollback to savepoint ${sp}`); return e }
      await client.query(`release savepoint ${sp}`)
      throw new Error(`expected this to fail, but it succeeded: ${sql}`)
    },
  }
  return s
}

export const U = {
  A: '00000000-0000-4000-a000-000000000001',
  T1: '00000000-0000-4000-a000-000000000011', T2: '00000000-0000-4000-a000-000000000012', T3: '00000000-0000-4000-a000-000000000013',
  P1: '00000000-0000-4000-a000-000000000021', P2: '00000000-0000-4000-a000-000000000022', P3: '00000000-0000-4000-a000-000000000023',
  S1: '00000000-0000-4000-a000-000000000031', S2: '00000000-0000-4000-a000-000000000032', S3: '00000000-0000-4000-a000-000000000033', S4: '00000000-0000-4000-a000-000000000034',
  G1: '00000000-0000-4000-b000-000000000101', G2: '00000000-0000-4000-b000-000000000102',
  C_S1_G1: '00000000-0000-4000-c000-000000000201', C_S3_G2: '00000000-0000-4000-c000-000000000202',
  INV_P2: '00000000-0000-4000-d000-000000000301', INV_P2_EXPIRED: '00000000-0000-4000-d000-000000000302', INV_P3: '00000000-0000-4000-d000-000000000303',
}
