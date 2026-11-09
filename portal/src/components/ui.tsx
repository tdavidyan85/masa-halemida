import type { ReactNode } from 'react'
import { useSpeech } from '../hooks/useSpeech'
import type { AssignmentKind, ProgressState } from '../data/types'

export function Avatar({ src, name, size = 44 }: { src: string; name: string; size?: number }) {
  return <img className="avatar" src={src} alt={`תמונת פרופיל לדוגמה של ${name}`} width={size} height={size} />
}

export function PersonChip({ avatar, name, sub }: { avatar: string; name: string; sub?: string }) {
  return (
    <span className="person">
      <Avatar src={avatar} name={name} size={40} />
      <span className="person-text"><b>{name}</b>{sub && <small>{sub}</small>}</span>
    </span>
  )
}

export function PageHeader({ title, subtitle, actions, emoji }: { title: string; subtitle?: string; actions?: ReactNode; emoji?: string }) {
  return (
    <header className="page-header">
      <div>
        <h1>{emoji && <span aria-hidden className="h-emoji">{emoji}</span>}{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

export function Card({ title, children, className = '', actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions}</div>}
      {children}
    </section>
  )
}

export function Stat({ label, value, tone = 'sky', emoji }: { label: string; value: ReactNode; tone?: string; emoji?: string }) {
  return (
    <div className={`stat tone-${tone}`}>
      {emoji && <span className="stat-emoji" aria-hidden>{emoji}</span>}
      <b>{value}</b><span>{label}</span>
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${v}%` }} />
    </div>
  )
}

const STATE_TEXT: Record<ProgressState, [string, 'neutral' | 'info' | 'good']> = {
  not_started: ['עוד לא התחיל', 'neutral'], in_progress: ['בתהליך', 'info'], done: ['הושלם', 'good'],
}
export function ProgressBadge({ state = 'not_started', score }: { state?: ProgressState; score?: number }) {
  const [text, tone] = STATE_TEXT[state]
  return <Badge tone={tone}>{text}{state === 'done' && score !== undefined ? ` · ${score}` : ''}</Badge>
}

export const KIND_TEXT: Record<AssignmentKind, { name: string; emoji: string }> = {
  practice: { name: 'תרגול', emoji: '✏️' }, exam: { name: 'מבחן', emoji: '📝' }, reading: { name: 'קריאה', emoji: '📖' },
}

/** read a text aloud with the device's voice (big, friendly button for young children) */
export function SpeakButton({ text, label = 'להקריא' }: { text: string; label?: string }) {
  const { supported, speaking, speak, stop } = useSpeech()
  if (!supported) return null
  return (
    <button type="button" className={`btn btn-speak ${speaking ? 'is-on' : ''}`} onClick={() => (speaking ? stop() : speak(text))}
      aria-label={speaking ? 'לעצור את ההקראה' : `${label}: ${text}`}>
      <span aria-hidden>{speaking ? '⏹' : '🔊'}</span> {speaking ? 'לעצור' : label}
    </button>
  )
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })
}
