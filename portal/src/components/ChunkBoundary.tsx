import { Component } from 'react'
import type { ReactNode } from 'react'
import { ErrorState } from './States'

/** if a page's code fails to download (e.g. a new version was published meanwhile, or the network dropped) */
export class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <ErrorState title="לא הצלחנו לטעון את העמוד" message="אולי החיבור נקטע, או שיצאה גרסה חדשה." onRetry={() => window.location.reload()} />
  }
}
