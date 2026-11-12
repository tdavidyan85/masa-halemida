// AI provider adapter for generating learning content (lessons, explanations, exercises, quizzes) as masa-pack/1.
// Only the material's TOPICS (text the adult uploaded and reviewed) are sent – never a child's name, profile,
// answers or any id. Server-side only. Nothing runs without explicit configuration:
//   AI_PROVIDER=anthropic, ANTHROPIC_API_KEY, AI_MONTHLY_TOKEN_BUDGET (> 0) – otherwise "not configured".
// Spending safeguards: model allow-list, output-token cap, timeout, per-user daily limit and a monthly token budget
// (reserved BEFORE each call; failed calls count too – see srv_ai_reserve in the database).
import { checkSafeContent } from './content.ts'
import type { PackMeta, Topic } from './content.ts'

export interface GenerateRequest { topics: Topic[]; meta: PackMeta; want: ('lessons' | 'explanations' | 'exercises' | 'quiz')[] }
export interface Usage { tokensIn: number; tokensOut: number }
export interface AiProvider { readonly name: string; generatePack(req: GenerateRequest, signal?: AbortSignal): Promise<{ pack: unknown; usage: Usage }> }

class HttpError extends Error {
  status: number; code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; this.name = 'AiError' }
}
export class AiUnavailableError extends HttpError { constructor() { super(503, 'ai_unavailable', 'יצירה עם בינה מלאכותית לא מוגדרת בשרת הזה. אפשר להשתמש בתבנית האוטומטית.') } }
export class AiQuotaError extends HttpError {
  constructor(reason: string) { super(429, reason, reason === 'monthly_budget' ? 'תקציב ה-AI החודשי נוצל. אפשר להשתמש בתבנית האוטומטית.' : 'הגעת למכסת היצירה היומית. אפשר לנסות שוב מחר.') }
}
export class AiTimeoutError extends HttpError { constructor() { super(504, 'ai_timeout', 'היצירה לקחה יותר מדי זמן. נסו שוב עם פחות נושאים.') } }
export class AiProviderError extends HttpError { constructor() { super(502, 'ai_provider', 'שירות ה-AI לא ענה כמו שצריך. נסו שוב מאוחר יותר.') } }
export class AiOutputError extends HttpError {
  problems: string[]
  constructor(problems: string[]) { super(502, 'ai_invalid_output', 'התוכן שנוצר לא עבר בדיקה, ולא נשמר.'); this.problems = problems }
}

export const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']
export interface AiConfig { provider: 'none' | 'anthropic'; key?: string; model: string; maxOutputTokens: number; timeoutMs: number; dailyLimit: number; monthlyBudget: number }

export function readAiConfig(env: (k: string) => string | undefined): AiConfig {
  const num = (k: string, d: number, min: number, max: number) => { const v = Number(env(k) ?? d); return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : d }
  const model = env('AI_MODEL') ?? 'claude-sonnet-5-5'
  const cfg: AiConfig = {
    provider: 'none', model: ALLOWED_MODELS.includes(model) ? model : 'claude-sonnet-5-5',
    maxOutputTokens: num('AI_MAX_OUTPUT_TOKENS', 6000, 500, 8000), timeoutMs: num('AI_TIMEOUT_MS', 60000, 5000, 120000),
    dailyLimit: num('AI_DAILY_LIMIT_PER_USER', 5, 0, 50), monthlyBudget: num('AI_MONTHLY_TOKEN_BUDGET', 0, 0, 50_000_000),
  }
  const key = env('ANTHROPIC_API_KEY')
  if (env('AI_PROVIDER') === 'anthropic' && key && /^sk-ant-/.test(key) && cfg.monthlyBudget > 0 && cfg.dailyLimit > 0) { cfg.provider = 'anthropic'; cfg.key = key }
  return cfg
}

/** the exact text a provider receives: topics + subject/grade/unit, nothing else (and bounded in size) */
export function buildPrompt(req: GenerateRequest): string {
  const topics = req.topics.slice(0, 12).map((t, i) => `### ${i + 1}. ${t.title.slice(0, 200)}\n${t.body.slice(0, 4000)}`).join('\n\n')
  return [
    `Create a practice unit in the "masa-pack/1" JSON format for an Israeli ${req.meta.grade} grade class, subject "${req.meta.subjectName}", unit "${req.meta.unit}".`,
    `Include: ${req.want.join(', ')}. The audience are children with reading difficulties: short, simple Hebrew sentences; prefer multiple-choice items ("choice") whose answer is exactly one of the options; every item gets a short hint.`,
    'Use ONLY the material below. Never include personal names, phone numbers, e-mail addresses, links or HTML.',
    'Reply only by calling the tool submit_pack.',
    '', '## Material', topics.slice(0, 40000),
  ].join('\n')
}
/** rough upper bound used for the budget reservation */
export const estimateTokens = (req: GenerateRequest, maxOut: number) => Math.ceil(buildPrompt(req).length / 3) + maxOut

/** Anthropic Messages API (server-side only). */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  private cfg: AiConfig
  private fetchImpl: typeof fetch
  constructor(cfg: AiConfig, fetchImpl: typeof fetch = fetch) { this.cfg = cfg; this.fetchImpl = fetchImpl }
  async generatePack(req: GenerateRequest, signal?: AbortSignal) {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': this.cfg.key ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model, max_tokens: this.cfg.maxOutputTokens,
        tools: [{ name: 'submit_pack', description: 'Return the masa-pack/1 unit.', input_schema: { type: 'object', properties: { pack: { type: 'object' } }, required: ['pack'] } }],
        tool_choice: { type: 'tool', name: 'submit_pack' },
        messages: [{ role: 'user', content: buildPrompt(req) }],
      }),
    })
    if (!res.ok) throw new AiProviderError()
    const body = await res.json() as { content?: { type: string; name?: string; input?: { pack?: unknown } }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    return { pack: body.content?.find(c => c.type === 'tool_use' && c.name === 'submit_pack')?.input?.pack ?? null,
      usage: { tokensIn: body.usage?.input_tokens ?? 0, tokensOut: body.usage?.output_tokens ?? 0 } }
  }
}

export function createProvider(cfg: AiConfig): AiProvider | null {
  return cfg.provider === 'anthropic' ? new AnthropicProvider(cfg) : null
}

export interface Ledger {
  reserve(tokens: number): Promise<{ ok: true; id: string } | { ok: false; reason: string }>
  finish(id: string, ok: boolean, usage: Usage): Promise<void>
}

/** reserve budget → call with a timeout → validate strictly → record usage. Invalid output is never returned. */
export async function generateChecked(provider: AiProvider | null, req: GenerateRequest, opts: { cfg: AiConfig; ledger: Ledger }): Promise<Record<string, unknown>> {
  if (!provider) throw new AiUnavailableError()
  if (!req.topics.length) throw Object.assign(new Error('אין נושאים ליצירת תוכן'), { status: 400 })
  const r = await opts.ledger.reserve(estimateTokens(req, opts.cfg.maxOutputTokens))
  if (!r.ok) throw r.reason === 'no_budget' ? new AiUnavailableError() : new AiQuotaError(r.reason)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.cfg.timeoutMs)
  let usage: Usage = { tokensIn: 0, tokensOut: 0 }
  try {
    const out = await provider.generatePack(req, ctl.signal).catch(e => { throw ctl.signal.aborted ? new AiTimeoutError() : e instanceof HttpError ? e : new AiProviderError() })
    usage = out.usage
    const problems = checkSafeContent(out.pack)
    if (problems.length) throw new AiOutputError(problems)
    await opts.ledger.finish(r.id, true, usage)
    return { ...(out.pack as Record<string, unknown>), generator: { kind: 'ai', provider: provider.name } }
  } catch (e) {
    await opts.ledger.finish(r.id, false, usage).catch(() => {})
    throw e
  } finally {
    clearTimeout(timer)
  }
}
