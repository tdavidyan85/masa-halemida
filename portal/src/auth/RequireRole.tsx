import { Navigate, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { HOME_OF, useAuth } from './AuthContext'
import type { Role } from '../data/types'
import { ErrorState, Loading } from '../components/States'

// Routing guard: keeps each environment's screens out of reach of other roles IN THE UI.
// It is a convenience, not a security boundary – the data rules live in the data source / on the server.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <main className="page-narrow"><Loading label="בודקים את ההתחברות…" /></main>
  if (!session) return <Navigate to={role === 'student' ? '/login/student' : '/login'} replace state={{ from: loc.pathname }} />
  if (session.role !== role) {
    return (
      <main className="page-narrow">
        <ErrorState title="אין גישה לאזור הזה" message="האזור הזה מיועד לתפקיד אחר."
          action={{ label: 'חזרה לאזור שלי', to: HOME_OF[session.role] }} />
      </main>
    )
  }
  return <>{children}</>
}
