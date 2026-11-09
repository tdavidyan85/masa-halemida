// Which data source the portal may use. Demo is the default; a server connection needs complete,
// explicit settings, and anything doubtful stops the app with a clear message instead of guessing.

/** the Supabase project behind the live public site – this development portal must never talk to it */
export const PRODUCTION_REFS = ['gwfacvvmlrkmfkstqpkb']

export type DataConfig =
  | { mode: 'demo' }
  | { mode: 'server'; env: 'local' | 'dev'; url: string; anonKey: string }

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError' }
}

function jwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch { return null }
}

export function readConfig(env: Record<string, string | undefined>): DataConfig {
  const source = env.VITE_DATA_SOURCE ?? 'mock'
  if (source === 'mock') return { mode: 'demo' }
  if (source !== 'supabase') throw new ConfigError(`VITE_DATA_SOURCE לא מוכר: "${source}" (mock או supabase)`)

  const stage = env.VITE_SUPABASE_ENV
  if (stage !== 'local' && stage !== 'dev') throw new ConfigError('חסר VITE_SUPABASE_ENV=local או dev. חיבור לשרת אמיתי לא נפתח בלי הגדרה מפורשת.')

  const rawUrl = env.VITE_SUPABASE_URL ?? ''
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new ConfigError('VITE_SUPABASE_URL חסר או לא תקין') }
  const isLocal = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  const isCloud = url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')
  if (stage === 'local' && !isLocal) throw new ConfigError('במצב local הכתובת חייבת להיות http://127.0.0.1 או http://localhost')
  if (stage === 'dev' && !isCloud) throw new ConfigError('במצב dev הכתובת חייבת להיות https://<project>.supabase.co')
  if (PRODUCTION_REFS.some(ref => url.hostname.startsWith(ref + '.'))) {
    throw new ConfigError('זה פרויקט ה-Supabase של האתר החי. הפורטל בפיתוח לא מתחבר אליו.')
  }

  const key = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!key) throw new ConfigError('VITE_SUPABASE_ANON_KEY חסר')
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    throw new ConfigError('זה מפתח סודי (service role). מפתח כזה אסור בדפדפן: מה שמתחיל ב-VITE_ נחשף לכל משתמש.')
  }
  if (!key.startsWith('sb_publishable_') && jwtRole(key) !== 'anon') {
    throw new ConfigError('VITE_SUPABASE_ANON_KEY צריך להיות המפתח הציבורי (publishable / anon)')
  }
  return { mode: 'server', env: stage, url: url.origin, anonKey: key }
}
