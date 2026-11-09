import { ConfigError, readConfig } from './config'

const anonJwt = (role: string) => ['x', btoa(JSON.stringify({ role })).replace(/=+$/, ''), 'y'].join('.')
const local = { VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_ENV: 'local', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: anonJwt('anon') }

describe('readConfig: no real connection without valid settings', () => {
  it('demo is the default', () => {
    expect(readConfig({})).toEqual({ mode: 'demo' })
    expect(readConfig({ VITE_DATA_SOURCE: 'mock' })).toEqual({ mode: 'demo' })
  })
  it('accepts a complete local configuration', () => {
    expect(readConfig(local)).toEqual({ mode: 'server', env: 'local', url: 'http://127.0.0.1:54321', anonKey: local.VITE_SUPABASE_ANON_KEY })
    expect(readConfig({ ...local, VITE_SUPABASE_ENV: 'dev', VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_xyz' }).mode).toBe('server')
  })
  it.each([
    ['an unknown source', { VITE_DATA_SOURCE: 'firebase' }, /לא מוכר/],
    ['no environment stated', { ...local, VITE_SUPABASE_ENV: undefined }, /VITE_SUPABASE_ENV/],
    ['no URL', { ...local, VITE_SUPABASE_URL: '' }, /VITE_SUPABASE_URL/],
    ['a cloud URL in local mode', { ...local, VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co' }, /local/],
    ['plain http to the cloud', { ...local, VITE_SUPABASE_ENV: 'dev', VITE_SUPABASE_URL: 'http://abcdefgh.supabase.co' }, /dev/],
    ['some other host', { ...local, VITE_SUPABASE_ENV: 'dev', VITE_SUPABASE_URL: 'https://evil.example.com' }, /dev/],
    ['the live site\'s project', { ...local, VITE_SUPABASE_ENV: 'dev', VITE_SUPABASE_URL: 'https://gwfacvvmlrkmfkstqpkb.supabase.co' }, /האתר החי/],
    ['no key', { ...local, VITE_SUPABASE_ANON_KEY: '' }, /ANON_KEY חסר/],
    ['a new-style secret key', { ...local, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' }, /מפתח סודי/],
    ['a service_role JWT', { ...local, VITE_SUPABASE_ANON_KEY: anonJwt('service_role') }, /מפתח סודי/],
    ['some random string', { ...local, VITE_SUPABASE_ANON_KEY: 'hello' }, /publishable/],
  ])('refuses %s', (_name, env, msg) => {
    expect(() => readConfig(env as Record<string, string | undefined>)).toThrow(ConfigError)
    expect(() => readConfig(env as Record<string, string | undefined>)).toThrow(msg)
  })
})
