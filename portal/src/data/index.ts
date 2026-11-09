import { createContext, useContext } from 'react'
import { MockSource } from './mockSource'
import { createSupabaseSource } from './supabaseSource'
import type { DataSource } from './source'

/** VITE_DATA_SOURCE=mock (default). "supabase" is reserved for later and is not connected yet. */
export function createDataSource(env: Record<string, string | undefined> = import.meta.env): DataSource {
  if (env.VITE_DATA_SOURCE === 'supabase') {
    return createSupabaseSource({ url: env.VITE_SUPABASE_URL ?? '', anonKey: env.VITE_SUPABASE_ANON_KEY ?? '' })
  }
  return new MockSource({ delayMs: Number(env.VITE_MOCK_DELAY_MS ?? 350) })
}

export const DataContext = createContext<DataSource | null>(null)
export function useData(): DataSource {
  const d = useContext(DataContext)
  if (!d) throw new Error('DataContext is missing')
  return d
}
