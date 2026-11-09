import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Role, Session } from '../data/types'

// DEMO session: kept in memory and in sessionStorage (this tab only) so a page reload keeps you signed in.
// It holds only the fictional demo user. A real session will come from Supabase Auth – and the server,
// not this object, will decide what each user may read or change.
const KEY = 'masa-portal-demo-session'

function load(): Session | null {
  try { const v = sessionStorage.getItem(KEY); return v ? JSON.parse(v) as Session : null } catch { return null }
}
function persist(s: Session | null) {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY) } catch { /* private mode */ }
}

interface AuthValue { session: Session | null; signIn(s: Session): void; signOut(): void }
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children, initial }: { children: ReactNode; initial?: Session | null }) {
  const [session, setSession] = useState<Session | null>(() => (initial !== undefined ? initial : load()))
  const signIn = useCallback((s: Session) => { setSession(s); persist(s) }, [])
  const signOut = useCallback(() => { setSession(null); persist(null) }, [])
  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('AuthProvider is missing')
  return v
}

/** the signed-in session; only call inside a route wrapped by RequireRole */
export function useSession(): Session {
  const { session } = useAuth()
  if (!session) throw new Error('no session')
  return session
}

export const HOME_OF: Record<Role, string> = { admin: '/admin', teacher: '/teacher', parent: '/parent', student: '/student' }
export const ROLE_NAME: Record<Role, string> = { admin: 'מנהל/ת מערכת', teacher: 'מורה', parent: 'הורה', student: 'תלמיד/ה' }
