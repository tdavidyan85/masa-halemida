// Hashing of student PINs/passwords with PBKDF2-SHA256 from the platform's WebCrypto (Deno and Node alike).
// Format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>. 600k iterations (OWASP guidance for PBKDF2-SHA256).
// A 6-digit PIN is weak by nature: the real protection is the attempt limit + the approved-device rule.

export const DEFAULT_ITERATIONS = 600_000
const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(b, c => c.charCodeAt(0))
}

async function derive(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashSecret(secret: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await derive(secret, salt, iterations))}`
}

/** constant-time comparison; a malformed stored value simply fails */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const m = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored)
  if (!m) return false
  const iterations = Number(m[1])
  if (!Number.isSafeInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false
  const expected = fromB64url(m[3])
  const actual = await derive(secret, fromB64url(m[2]), iterations)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}

/** used when the account does not exist, so a miss takes as long as a wrong secret */
export const DUMMY_HASH = 'pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('')
}

/** a long random value that is never stored or shown (e.g. the unused Auth password of a student) */
export function randomSecret(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** the session_id claim of an access token Supabase Auth JUST gave us (read only, not a verification) */
export function sessionIdOf(accessToken: string): string | null {
  try {
    const part = accessToken.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)
    const id = JSON.parse(atob(b64)).session_id
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null
  } catch { return null }
}
