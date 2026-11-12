// npm run test:local – run the RLS, function and end-to-end tests against the RUNNING local Supabase
// (`npm run local:start`). Reads the endpoints from `supabase status`; refuses anything that is not this machine.
//   node tests/run-local.mjs [--workdir <folder that contains supabase/>]   (default: the repository root)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// on GitHub Actions, failures are also published as annotations (readable without the raw logs); never secrets
const GH = process.env.GITHUB_ACTIONS === 'true'
const esc = (t) => String(t).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
function fail(msg, detail = '') {
  console.error(msg)
  if (GH) console.log(`::error title=test:local::${esc((msg + '\n' + detail).slice(0, 4000))}`)
  process.exit(1)
}
const HERE = dirname(fileURLToPath(import.meta.url))
const SUPA = join(HERE, '..')
const wi = process.argv.indexOf('--workdir')
const workdir = wi > 0 ? process.argv[wi + 1] : join(SUPA, '..')

const st = spawnSync(join(SUPA, 'node_modules/.bin/supabase'), ['status', '--workdir', workdir, '--experimental'],
  { encoding: 'utf8', env: { ...process.env, SUPABASE_EXPERIMENTAL_STACK: '1' } })
const line = (st.stdout ?? '').split('\n').filter(l => l.startsWith('{')).pop()
if (!line) fail('✗ no running local Supabase found – start it with `npm run local:start`', `status exit ${st.status}\n${(st.stderr ?? '').slice(-1500)}\n${(st.stdout ?? '').slice(-1500)}`)
const env = JSON.parse(line).env ?? {}
for (const k of ['API_URL', 'DB_URL', 'MAILPIT_URL']) {
  if (!env[k] || !['127.0.0.1', 'localhost'].includes(new URL(env[k]).hostname)) fail(`✗ ${k} is not local – refusing`, `${k} host: ${env[k] ? new URL(env[k]).hostname : 'missing'}; keys: ${Object.keys(env).join(',')}`)
}
const testEnv = { ...process.env, TEST_DB_URL: env.DB_URL, E2E_API_URL: env.API_URL, E2E_ANON_KEY: env.ANON_KEY,
  E2E_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY, E2E_MAILPIT_URL: env.MAILPIT_URL }
console.log(`local Supabase: ${env.API_URL} (database ${new URL(env.DB_URL).host})`)
// every test file – a new one can never be forgotten here
const files = readdirSync(HERE).filter(f => f.endsWith('.test.mjs')).sort().map(f => `tests/${f}`)
const tap = join(mkdtempSync(join(tmpdir(), 'masa-tap-')), 'out.tap')
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
  '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${tap}`, ...files],
  { cwd: SUPA, stdio: 'inherit', env: testEnv })
if (r.status !== 0 && GH) {
  // each failing test: its name and the first lines of its error (TAP keeps them together)
  const lines = (() => { try { return readFileSync(tap, 'utf8').split('\n') } catch { return [] } })()
  const out = []
  lines.forEach((l, i) => {
    if (/^\s*not ok /.test(l)) out.push(l.trim() + '\n' + lines.slice(i + 1, i + 14).filter(x => /error|message|expected|actual|code|status|location/i.test(x)).map(x => '   ' + x.trim()).join('\n'))
  })
  console.log(`::error title=test:local failures::${esc(out.join('\n').slice(0, 6000) || 'no TAP output')}`)
}
process.exit(r.status ?? 1)
