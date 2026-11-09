import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> { data: T | null; error: Error | null; loading: boolean; reload(): void }

/** load data for a screen; re-runs when deps change; ignores results of a superseded call */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  const run = useRef(0)
  useEffect(() => {
    const id = ++run.current
    setState(s => ({ ...s, loading: true, error: null }))
    fn().then(
      data => { if (id === run.current) setState({ data, error: null, loading: false }) },
      error => { if (id === run.current) setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false }) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick(t => t + 1), [])
  return { ...state, reload }
}
