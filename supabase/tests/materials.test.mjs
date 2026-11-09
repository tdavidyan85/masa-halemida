// Phase 4: materials, extraction, topics, content drafts (template + AI adapter), sharing – logic and RLS.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkPack, splitIntoTopics, templatePack } from '../functions/_shared/content.ts'
import { AiOutputError, AiUnavailableError, AnthropicProvider, buildPrompt, createProvider, generateChecked } from '../functions/_shared/ai.ts'
import { startDb, tx, U } from './db.mjs'

const TEXT = `פרק 1: מחזור המים
המים בים מתחממים בשמש והופכים לאדים. האדים עולים למעלה ויוצרים עננים גבוהים בשמיים.
כשהעננים מתקררים, טיפות המים נופלות בחזרה כגשם. הגשם זורם בנחלים ומגיע שוב אל הים.

פרק 2: צמחים
הצמחים זקוקים לאור השמש כדי לייצר מזון. השורשים סופגים מים ומינרלים מהאדמה.
העלים הירוקים קולטים פחמן דו-חמצני מהאוויר ומשחררים חמצן לסביבה.`

describe('topics from text', () => {
  it('finds headed sections', () => {
    const t = splitIntoTopics(TEXT)
    assert.deepEqual(t.map(x => x.title), ['מחזור המים', 'צמחים'])
    assert.match(t[0].body, /^המים בים/)
  })
  it('without headings: even chunks at sentence ends', () => {
    const plain = Array.from({ length: 30 }, (_, i) => `זה המשפט מספר ${i + 1} בתוך טקסט ארוך בלי כותרות כלל.`).join(' ')
    const t = splitIntoTopics(plain)
    assert.ok(t.length >= 2 && t.length <= 4, String(t.length))
    assert.ok(t.every(x => x.title && x.body.endsWith('.')))
  })
  it('empty text → no topics', () => { assert.deepEqual(splitIntoTopics('   \n '), []) })
})

describe('template content (rules, not AI)', () => {
  const pack = templatePack(splitIntoTopics(TEXT), { subjectName: 'מדעים', grade: 'ה', unit: 'מים וצמחים' })
  it('is a valid masa-pack/1 marked as template', () => {
    assert.deepEqual(checkPack(pack), [])
    assert.equal(pack.generator.kind, 'template')
  })
  it('every question is a missing word from the material, with the answer among distinct options', () => {
    const items = Object.values(pack.pools).flatMap(p => p.items)
    assert.ok(items.length >= 4)
    for (const it of items) {
      assert.ok(it.options.includes(it.answer)); assert.equal(new Set(it.options).size, it.options.length)
      assert.ok(TEXT.includes(it.text.split('\n')[1].replace('___', it.answer)), it.text)
    }
  })
  it('is deterministic (the same material gives the same draft)', () => {
    assert.deepEqual(templatePack(splitIntoTopics(TEXT), { subjectName: 'מדעים', grade: 'ה', unit: 'x' }).pools, pack.pools)
  })
  it('checkPack catches broken content', () => {
    assert.ok(checkPack({ schema: 'other' }).length)
    const bad = structuredClone(pack); Object.values(bad.pools)[0].items[0].answer = 'לא קיים'
    assert.match(checkPack(bad).join(), /answer not among options/)
  })
})

describe('AI adapter', () => {
  const req = { topics: splitIntoTopics(TEXT), meta: { subjectName: 'מדעים', grade: 'ה', unit: 'מים' }, want: ['lessons', 'quiz'] }
  it('no credentials → no provider → "not configured" (never pretends)', async () => {
    assert.equal(createProvider(() => undefined), null)
    await assert.rejects(generateChecked(null, req), AiUnavailableError)
  })
  it('the prompt carries only the material and class info', () => {
    const p = buildPrompt(req)
    assert.match(p, /מחזור המים/)
    for (const forbidden of [U.S1, U.P1, 'student', 'full_name', 'email']) assert.ok(!p.includes(forbidden), forbidden)
  })
  it('a provider\'s output is validated; invalid output is refused, valid output is marked as AI', async () => {
    const good = templatePack(req.topics, req.meta)
    const out = await generateChecked({ name: 'fake', generatePack: async () => good }, req)
    assert.equal(out.generator.kind, 'ai')
    await assert.rejects(generateChecked({ name: 'fake', generatePack: async () => ({ schema: 'masa-pack/1' }) }, req), AiOutputError)
  })
  it('the Anthropic adapter sends the prompt server-side and reads the tool result (fake fetch, no real call)', async () => {
    let sent
    const fake = async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_pack', input: { pack: { schema: 'masa-pack/1' } } }] })) }
    const out = await new AnthropicProvider('test-key', 'claude-sonnet-5-5', fake).generatePack(req)
    assert.deepEqual(out, { schema: 'masa-pack/1' })
    assert.equal(sent.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(sent.init.headers['x-api-key'], 'test-key')
  })
})

describe('materials in the database', () => {
  let db
  before(async () => { db = await startDb() })
  after(async () => { await db?.stop() })
  const t = fn => () => tx(db.client, fn)
  const create = async (s, who, mime = 'application/pdf', size = 1000) => { await s.as(who); return (await s.one(`select public.create_material('דף עבודה', $1, $2) as r`, [mime, size])).r }

  it('teachers and parents add materials; the SERVER picks the path; students never', t(async s => {
    const r = await create(s, U.T1)
    assert.equal(r.path, `${U.T1}/${r.id}/source.pdf`)
    await create(s, U.P1, 'image/png')
    await s.as(U.S1)
    assert.match((await s.fails(`select public.create_material('x', 'application/pdf', 10)`)).message, /only teachers and parents/)
    assert.match((await s.fails(`insert into public.learning_materials (title) values ('x')`)).message, /permission denied/)
  }))
  it('only PDF/JPEG/PNG/WebP up to 20 MB', t(async s => {
    await s.as(U.T1)
    assert.match((await s.fails(`select public.create_material('x', 'text/html', 10)`)).message, /only PDF/)
    assert.match((await s.fails(`select public.create_material('x', 'application/pdf', 30000000)`)).message, /20 MB/)
  }))
  it('upload: only to the exact server-chosen path of one\'s own material', t(async s => {
    const r = await create(s, U.T1)
    const up = `insert into storage.objects (bucket_id, name) values ('materials', $1)`
    await s.rows(up, [r.path])
    for (const bad of [`${U.T1}/${r.id}/other.pdf`, `${U.T1}/${r.id}/../x.pdf`, `${U.T2}/${r.id}/source.pdf`, `${U.T1}/00000000-0000-4000-a000-000000000999/source.pdf`]) {
      assert.match((await s.fails(up, [bad])).message, /row-level security/, bad)
    }
    await s.as(U.T2)
    assert.match((await s.fails(up, [r.path])).message, /row-level security/)
    await s.as(U.S1)
    assert.match((await s.fails(up, [r.path])).message, /row-level security/)
  }))
  it('extraction, topics and drafts are the owner\'s only; the extracted text is not a readable column', t(async s => {
    const r = await create(s, U.T1)
    await s.rows(`select public.save_extraction($1, $2, 2)`, [r.id, TEXT])
    assert.match((await s.one(`select public.material_text($1) as x`, [r.id])).x, /מחזור המים/)
    assert.match((await s.fails(`select extracted_text from public.learning_materials`)).message, /permission denied/)
    await s.rows(`insert into public.material_topics (material_id, position, title, body) values ($1, 1, 'מחזור המים', 'גוף')`, [r.id])
    const d = (await s.one(`select public.save_content_draft($1, $2, 'template') as id`, [r.id, JSON.stringify(templatePack(splitIntoTopics(TEXT), { subjectName: 'מדעים', grade: 'ה', unit: 'x' }))])).id
    await s.as(U.T2)
    assert.equal((await s.one(`select public.material_text($1) as x`, [r.id])).x, null)
    assert.equal((await s.rows(`select * from public.material_topics`)).length, 0)
    assert.equal((await s.rows(`select * from public.content_drafts`)).length, 0)
    assert.match((await s.fails(`select public.save_extraction($1, 'x', 1)`, [r.id])).message, /not your material/)
    assert.match((await s.fails(`select public.review_content_draft($1, true)`, [d])).message, /not your draft/)
  }))
  it('only the server may save an AI draft; a user cannot label a draft as AI', t(async s => {
    const r = await create(s, U.T1)
    assert.match((await s.fails(`select public.save_content_draft($1, '{"schema":"masa-pack/1","topics":[],"pools":{}}', 'ai')`, [r.id])).message, /server only/)
    assert.match((await s.fails(`select public.srv_save_ai_draft($1, $2, '{"schema":"masa-pack/1"}')`, [U.T1, r.id])).message, /permission denied/)
    await s.asService()
    assert.ok((await s.one(`select public.srv_save_ai_draft($1, $2, '{"schema":"masa-pack/1","topics":[],"pools":{}}') as id`, [U.T1, r.id])).id)
    assert.match((await s.fails(`select public.srv_save_ai_draft($1, $2, '{"schema":"masa-pack/1"}')`, [U.T2, r.id])).message, /not your material/)
  }))
  it('review first: an unapproved draft cannot become a quiz; approved → a DRAFT quiz with server-side keys', t(async s => {
    const r = await create(s, U.T1)
    const pack = templatePack(splitIntoTopics(TEXT), { subjectName: 'מדעים', grade: 'ה', unit: 'x' })
    const d = (await s.one(`select public.save_content_draft($1, $2, 'template') as id`, [r.id, JSON.stringify(pack)])).id
    assert.match((await s.fails(`select public.quiz_from_draft($1, $2, 'בוחן')`, [d, U.G1])).message, /approve the content first/)
    await s.rows(`select public.review_content_draft($1, true)`, [d])
    assert.match((await s.fails(`select public.quiz_from_draft($1, $2, 'בוחן')`, [d, U.G2])).message, /not your group/)
    const aid = (await s.one(`select public.quiz_from_draft($1, $2, 'בוחן מהחומר') as id`, [d, U.G1])).id
    const a = await s.one(`select status, kind from public.assignments where id = $1`, [aid])
    assert.deepEqual(a, { status: 'draft', kind: 'quiz' })
    const n = Object.values(pack.pools).flatMap(p => p.items).length
    assert.equal((await s.one(`select count(*)::int n from public.assignment_answer_keys k join public.assignment_items i on i.id = k.item_id where i.assignment_id = $1`, [aid])).n, Math.min(n, 20))
    await s.as(U.S1)
    assert.equal((await s.rows(`select id from public.assignments where id = $1`, [aid])).length, 0)      // still a draft: invisible
  }))
  it('sharing: teachers only with their groups, parents only with their own children; readers see title + file', t(async s => {
    const r = await create(s, U.T1)
    assert.match((await s.fails(`select public.share_material($1, $2, null)`, [r.id, U.G2])).message, /not your group/)
    await s.rows(`select public.share_material($1, $2, null)`, [r.id, U.G1])
    await s.rows(`insert into storage.objects (bucket_id, name) values ('materials', $1)`, [r.path])
    for (const who of [U.S1, U.P1]) {
      await s.as(who)
      assert.equal((await s.rows(`select id, title from public.learning_materials`)).length, 1, who)
      assert.equal((await s.rows(`select name from storage.objects where bucket_id = 'materials'`)).length, 1, who)
    }
    for (const who of [U.S3, U.P2, U.T2]) {
      await s.as(who)
      assert.equal((await s.rows(`select id from public.learning_materials`)).length, 0, who)
      assert.equal((await s.rows(`select name from storage.objects where bucket_id = 'materials'`)).length, 0, who)
    }
    const pm = await create(s, U.P1, 'image/jpeg')
    assert.match((await s.fails(`select public.share_material($1, null, $2)`, [pm.id, U.S3])).message, /not your child/)
    await s.rows(`select public.share_material($1, null, $2)`, [pm.id, U.S1])
    await s.as(U.S1)
    assert.equal((await s.rows(`select id from public.learning_materials where id = $1`, [pm.id])).length, 1)
  }))
  it('students cannot change materials, topics, drafts or shares', t(async s => {
    const r = await create(s, U.T1)
    await s.rows(`select public.share_material($1, $2, null)`, [r.id, U.G1])
    await s.rows(`insert into storage.objects (bucket_id, name) values ('materials', $1)`, [r.path])
    await s.as(U.S1)
    assert.equal(await s.count(`delete from public.learning_materials where id = $1`, [r.id]), 0)
    assert.match((await s.fails(`insert into public.material_topics (material_id, position, title) values ($1, 1, 'x')`, [r.id])).message, /row-level security/)
    assert.match((await s.fails(`select public.share_material($1, $2, null)`, [r.id, U.G1])).message, /not your material/)
    // shim: RLS leaves nothing to delete · real Supabase: direct SQL deletes on storage are refused outright
    const del = await s.fails(`delete from storage.objects where bucket_id = 'materials' returning 1/(length(name)*0)`).catch(() => null)
    if (del) assert.match(del.message, /Direct deletion from storage tables is not allowed/)     // 1/0 would mean a row WAS deleted → fail
    await s.asOwner()
    assert.equal((await s.rows(`select 1 from storage.objects where name = $1`, [r.path])).length, 1)  // the file is still there
  }))
})
