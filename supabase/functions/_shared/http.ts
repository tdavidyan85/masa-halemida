// Small HTTP helpers for the Edge Functions (no Deno-only APIs, so they are testable on Node too).

/** comma-separated origins allowed to call the functions, e.g. "http://localhost:5173,https://portal.example" */
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean)
  const ok = origin !== null && list.includes(origin)
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

/** the error a client may see: our own messages for known errors, a generic one for anything else */
export function errorResponse(e: unknown, headers: Record<string, string>): Response {
  const err = e as { status?: number; message?: string; name?: string; code?: string }
  // our own errors carry a status (and AI errors a code): their Hebrew message is safe to show
  if (err && typeof err.status === 'number' && err.status >= 400 && (err.status < 500 || typeof err.code === 'string')) {
    return json(err.status, { error: err.code ?? err.name ?? 'error', message: err.message }, headers)
  }
  console.error('internal error', err?.name, err?.message)            // never logs request bodies (PINs, names)
  return json(500, { error: 'internal', message: 'משהו השתבש בשרת. נסו שוב בעוד רגע' }, headers)
}

export function clientIp(req: Request): string | null {
  const xf = req.headers.get('x-forwarded-for')
  return xf ? xf.split(',')[0].trim() : null
}
