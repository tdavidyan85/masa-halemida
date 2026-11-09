// npm run test:local – run the RLS, function and end-to-end tests against the RUNNING local Supabase
// (`npm run local:start`). Reads the endpoints from `supabase status`; refuses anything that is not this machine.
//   node tests/run-local.mjs [--workdir <folder that contains supabase/>]   (default: the repository root)
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SUPA = join(HERE, '..')
const wi = process.argv.indexOf('--workdir')
const workdir = wi > 0 ? process.argv[wi + 1] : join(SUPA, '..')

const st = spawnSync(join(SUPA, 'node_modules/.bin/supabase'), ['status', '--workdir', workdir, '--experimental'],
  { encoding: 'utf8', env: { ...process.env, SUPABASE_EXPERIMENTAL_STACK: '1' } })
const line = (st.stdout ?? '').split('\n').filter(l => l.startsWith('{')).pop()
if (!line) { console.error('✗ no running local Supabase found – start it with `npm run local:start`'); process.exit(1) }
const env = JSON.parse(line).env ?? {}
for (const k of ['API_URL', 'DB_URL', 'MAILPIT_URL']) {
  if (!env[k] || !['127.0.0.1', 'localhost'].includes(new URL(env[k]).hostname)) { console.error(`✗ ${k} is not local – refusing`); process.exit(1) }
}
const testEnv = { ...process.env, TEST_DB_URL: env.DB_URL, E2E_API_URL: env.API_URL, E2E_ANON_KEY: env.ANON_KEY,
  E2E_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY, E2E_MAILPIT_URL: env.MAILPIT_URL }
console.log(`local Supabase: ${env.API_URL} (database ${new URL(env.DB_URL).host})`)
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/rls.test.mjs', 'tests/functions.test.mjs', 'tests/e2e.test.mjs'],
  { cwd: SUPA, stdio: 'inherit', env: testEnv })
process.exit(r.status ?? 1)
