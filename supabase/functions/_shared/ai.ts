// AI provider adapter for generating learning content (lessons, explanations, exercises, quizzes) as masa-pack/1.
// Only the material's TOPICS (text the adult uploaded and reviewed) are sent – never a child's name, profile,
// answers or any id. Providers are optional: with no credentials, `createProvider` returns null and the caller
// answers "AI is not configured" – it never pretends that something was generated.
import { checkPack } from './content.ts'
import type { PackMeta, Topic } from './content.ts'

export interface GenerateRequest { topics: Topic[]; meta: PackMeta; want: ('lessons' | 'explanations' | 'exercises' | 'quiz')[] }
export interface AiProvider { readonly name: string; generatePack(req: GenerateRequest): Promise<unknown> }

export class AiUnavailableError extends Error { status = 503; constructor() { super('יצירה עם בינה מלאכותית לא מוגדרת בשרת הזה'); this.name = 'AiUnavailableError' } }
export class AiOutputError extends Error {
  status = 502
  problems: string[]
  constructor(problems: string[]) { super('התוכן שנוצר לא עבר בדיקה, ולא נשמר'); this.name = 'AiOutputError'; this.problems = problems }
}

/** the exact text a provider receives: topics + subject/grade/unit, nothing else */
export function buildPrompt(req: GenerateRequest): string {
  const topics = req.topics.slice(0, 12).map((t, i) => `### ${i + 1}. ${t.title.slice(0, 200)}\n${t.body.slice(0, 4000)}`).join('\n\n')
  return [
    `Create a practice unit in the "masa-pack/1" JSON format for an Israeli ${req.meta.grade} grade class, subject "${req.meta.subjectName}", unit "${req.meta.unit}".`,
    `Include: ${req.want.join(', ')}. The audience are children with reading difficulties: short, simple Hebrew sentences; prefer multiple-choice items ("choice") whose answer is exactly one of the options; every item gets a short hint.`,
    'Use ONLY the material below. Do not invent personal names; never include names, phone numbers or other personal details.',
    'Reply only by calling the tool submit_pack.',
    '', '## Material', topics,
  ].join('\n')
}

/** Anthropic Messages API (server-side only). Not used unless ANTHROPIC_API_KEY is configured. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  private key: string
  private model: string
  private fetchImpl: typeof fetch
  constructor(key: string, model: string, fetchImpl: typeof fetch = fetch) { this.key = key; this.model = model; this.fetchImpl = fetchImpl }
  async generatePack(req: GenerateRequest): Promise<unknown> {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model, max_tokens: 8000,
        tools: [{ name: 'submit_pack', description: 'Return the masa-pack/1 unit.', input_schema: { type: 'object', properties: { pack: { type: 'object' } }, required: ['pack'] } }],
        tool_choice: { type: 'tool', name: 'submit_pack' },
        messages: [{ role: 'user', content: buildPrompt(req) }],
      }),
    })
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`)
    const body = await res.json() as { content?: { type: string; name?: string; input?: { pack?: unknown } }[] }
    return body.content?.find(c => c.type === 'tool_use' && c.name === 'submit_pack')?.input?.pack ?? null
  }
}

export function createProvider(env: (k: string) => string | undefined): AiProvider | null {
  const key = env('ANTHROPIC_API_KEY')
  if (!key) return null
  return new AnthropicProvider(key, env('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5')
}

/** generate → validate → (only then) return; invalid output is never saved */
export async function generateChecked(provider: AiProvider | null, req: GenerateRequest): Promise<Record<string, unknown>> {
  if (!provider) throw new AiUnavailableError()
  if (!req.topics.length) throw Object.assign(new Error('אין נושאים ליצירת תוכן'), { status: 400 })
  const pack = await provider.generatePack(req)
  const problems = checkPack(pack)
  if (problems.length) throw new AiOutputError(problems)
  return { ...(pack as Record<string, unknown>), generator: { kind: 'ai', provider: provider.name } }
}
