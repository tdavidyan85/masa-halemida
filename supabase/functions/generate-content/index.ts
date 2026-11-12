// Edge Function `generate-content` (Deno): an adult asks for an AI draft from the topics of THEIR material.
//   POST { materialId, want?: [...] }  →  201 { draftId }  ·  503 when no AI provider is configured
// Without AI_PROVIDER + ANTHROPIC_API_KEY + a monthly budget this always answers 503 – nothing is generated or pretended. The draft is saved only
// after it passed the masa-pack/1 checks, and stays a draft until the owner approves it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createProvider, generateChecked, readAiConfig } from '../_shared/ai.ts'
import { corsHeaders, errorResponse, json } from '../_shared/http.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const ALLOWED = Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173'
const CFG = readAiConfig(k => Deno.env.get(k))

Deno.serve(async req => {
  const headers = corsHeaders(req.headers.get('origin'), ALLOWED)
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return json(405, { error: 'method' }, headers)
  try {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: u, error } = await admin.auth.getUser(jwt)
    if (error || !u.user) return json(401, { error: 'auth', message: 'צריך להתחבר מחדש' }, headers)
    const body = await req.json().catch(() => ({}))
    const { data: m } = await admin.from('learning_materials').select('id, title').eq('id', String(body.materialId ?? '')).eq('owner_id', u.user.id).maybeSingle()
    if (!m) return json(403, { error: 'forbidden', message: 'החומר לא נמצא או שאינו שלך' }, headers)
    const provider = createProvider(CFG)
    if (!provider) return json(503, { error: 'ai_unavailable', message: 'יצירה עם בינה מלאכותית לא מוגדרת בשרת הזה. אפשר להשתמש בתבנית האוטומטית.' }, headers)
    const { data: topics } = await admin.from('material_topics').select('title, body').eq('material_id', m.id).order('position')
    const ledger = {
      async reserve(tokens: number) {
        const { data, error } = await admin.rpc('srv_ai_reserve', { p_user: u.user!.id, p_material: m.id, p_tokens: tokens, p_daily_limit: CFG.dailyLimit, p_monthly_budget: CFG.monthlyBudget })
        if (error) throw new Error(error.message)
        return data
      },
      async finish(id: string, ok: boolean, usage: { tokensIn: number; tokensOut: number }) {
        await admin.rpc('srv_ai_finish', { p_request: id, p_ok: ok, p_in: usage.tokensIn, p_out: usage.tokensOut })
      },
    }
    const pack = await generateChecked(provider, { topics: topics ?? [], meta: { subjectName: String(body.subjectName ?? 'כללי').slice(0, 40), grade: String(body.grade ?? 'ה').slice(0, 4), unit: String(m.title) },
      want: ['lessons', 'explanations', 'exercises', 'quiz'] }, { cfg: CFG, ledger })
    const { data: draftId, error: e2 } = await admin.rpc('srv_save_ai_draft', { p_user: u.user.id, p_material: m.id, p_pack: pack })
    if (e2) throw new Error(e2.message)
    return json(201, { draftId }, headers)
  } catch (e) {
    return errorResponse(e, headers)
  }
})
