import { Link } from 'react-router'
import type { ReactNode } from 'react'
import type { AsyncState } from '../hooks/useAsync'
import { ForbiddenError } from '../data/source'

export function Loading({ label = 'טוען…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  )
}

export function EmptyState({ emoji = '🌱', title, message, children }: { emoji?: string; title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <div className="state-emoji" aria-hidden>{emoji}</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {children}
    </div>
  )
}

export function ErrorState({ title = 'משהו השתבש', message, onRetry, action }:
  { title?: string; message?: string; onRetry?: () => void; action?: { label: string; to: string } }) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-emoji" aria-hidden>🙈</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      <div className="row center">
        {onRetry && <button className="btn" onClick={onRetry}>לנסות שוב</button>}
        {action && <Link className="btn btn-secondary" to={action.to}>{action.label}</Link>}
      </div>
    </div>
  )
}

/** standard loading / error / empty handling for a screen section */
export function AsyncView<T>({ state, children, isEmpty, empty, loadingRows }: {
  state: AsyncState<T>
  children: (data: T) => ReactNode
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  loadingRows?: number
}) {
  if (state.loading && !state.data) return <Loading rows={loadingRows} />
  if (state.error) {
    const forbidden = state.error instanceof ForbiddenError
    return <ErrorState title={forbidden ? 'אין הרשאה' : 'לא הצלחנו לטעון'} message={state.error.message} onRetry={forbidden ? undefined : state.reload} />
  }
  if (state.data === null) return null
  if (isEmpty?.(state.data)) return <>{empty ?? <EmptyState title="אין כאן עדיין כלום" />}</>
  return <>{children(state.data)}</>
}
