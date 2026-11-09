import { createContext, useContext } from 'react'
import { MockSource } from './mockSource'
import { createSupabaseSource } from './supabaseSource'
import { readConfig } from './config'
import type { DataSource } from './source'

/**
 * Demo (default): local fictional data, nothing leaves the browser.
 * Server: only with complete, valid settings (see config.ts) – otherwise a ConfigError stops the app.
 */
export function createDataSource(env: Record<string, string | undefined> = import.meta.env): DataSource {
  const cfg = readConfig(env)
  if (cfg.mode === 'server') return createSupabaseSource(cfg)
  return new MockSource({ delayMs: Number(env.VITE_MOCK_DELAY_MS ?? 350) })
}

export const DataContext = createContext<DataSource | null>(null)
export function useData(): DataSource {
  const d = useContext(DataContext)
  if (!d) throw new Error('DataContext is missing')
  return d
}
