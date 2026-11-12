import { createContext, useContext } from 'react'
import { readConfig } from './config'
import type { DataSource } from './source'

/**
 * Demo (default): local fictional data, nothing leaves the browser.
 * Server: only with complete, valid settings (see config.ts) – otherwise a ConfigError stops the app.
 * Each source is loaded on demand, so the demo never downloads supabase-js and the server mode never the demo data.
 */
export async function loadDataSource(env: Record<string, string | undefined> = import.meta.env): Promise<DataSource> {
  const cfg = readConfig(env)
  if (cfg.mode === 'server') return (await import('./supabaseSource')).createSupabaseSource(cfg)
  const { MockSource } = await import('./mockSource')
  return new MockSource({ delayMs: Number(env.VITE_MOCK_DELAY_MS ?? 350) })
}

export const DataContext = createContext<DataSource | null>(null)
export function useData(): DataSource {
  const d = useContext(DataContext)
  if (!d) throw new Error('DataContext is missing')
  return d
}
