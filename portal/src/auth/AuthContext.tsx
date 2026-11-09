import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useData } from '../data'
import type { Role, Session } from '../data/types'

// The signed-in user, as the data source reports it.
//   demo:   a fictional session kept in this tab by MockSource
//   server: Supabase Auth (restored on load, refreshed automatically, shared between tabs)
// What a user may read or change is decided by the server (RLS / Edge Functions), never by this object.

interface AuthValue {
  session: Session | null
  /** false until the stored session has been checked – screens wait instead of bouncing to sign-in */
  ready: boolean
  /** the user arrived from a password-reset e-mail and must now choose a new password */
  recovery: boolean
  signIn(s: Session): void
  signOut(): Promise<void>
  clearRecovery(): void
}
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children, initial }: { children: ReactNode; initial?: Session | null }) {
  const source = useData()
  const [session, setSession] = useState<Session | null>(initial ?? null)
  const [ready, setReady] = useState(initial !== undefined)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    let alive = true
    if (initial === undefined) {
      source.currentSession().then(
        s => { if (alive) { setSession(s); setReady(true) } },
        () => { if (alive) { setSession(null); setReady(true) } },
      )
    }
    const off = source.onSessionChange((s, event) => {
      if (!alive) return
      setSession(s); setReady(true)
      if (event === 'password_recovery') setRecovery(true)
    })
    return () => { alive = false; off() }
  }, [source, initial])

  const signIn = useCallback((s: Session) => { setSession(s); setReady(true) }, [])
  const signOut = useCallback(async () => { try { await source.signOut() } finally { setSession(null) } }, [source])
  const clearRecovery = useCallback(() => setRecovery(false), [])
  const value = useMemo(() => ({ session, ready, recovery, signIn, signOut, clearRecovery }), [session, ready, recovery, signIn, signOut, clearRecovery])
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
