// Placeholder for the real backend. NOT connected: no Supabase client is installed or created, and nothing
// here makes a network call. When the backend is built, this class implements DataSource with supabase-js:
//   - adults:   supabase.auth.signInWithPassword (verified e-mail), roles from the `user_roles` table
//   - students: the `student-login` Edge Function (PIN / password checked against salted hashes on the server,
//               attempt limits and lockouts enforced there, enrolled devices only for PIN)
//   - every read/write: plain table queries, with Row Level Security deciding what each role may see
// Until then, choosing it fails loudly instead of silently falling back.
import type { DataSource } from './source'

export class NotConnectedError extends Error {
  constructor() {
    super('החיבור לשרת עוד לא נבנה. הפורטל רץ כרגע רק עם נתוני הדגמה מקומיים.')
    this.name = 'NotConnectedError'
  }
}

export function createSupabaseSource(_config: { url: string; anonKey: string }): DataSource {
  throw new NotConnectedError()
}
