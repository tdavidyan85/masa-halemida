// מסע הלמידה – photo → content pack (phase 1). Supabase Edge Function named `ingest`.
//   POST ?a=new            body = the photo (jpeg/png/webp), header x-device = the parent's device token
//                          → { id, token, pack, flags }   (the photo is only ever held in memory: never stored, never logged)
//   GET  ?a=get&id=&t=     the draft (edit token required)
//   POST ?a=save           { id, t, pack, approve }  → saves the reviewed pack; approve=true publishes it for play
//   GET  ?a=pack&id=       an approved pack, for the child's page (public by id; the id is long and random)
//   POST ?a=delete         { id, t }
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL, INGEST_PER_OWNER (default 20/month), INGEST_MONTHLY_CAP (default 300 pages).
// Nothing here ever receives a child's name or answers: only a photo the parent chose, and the pack the parent approved.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const PER_OWNER = Number(Deno.env.get("INGEST_PER_OWNER") || "20");
const CAP = Number(Deno.env.get("INGEST_MONTHLY_CAP") || "300");
const MAX_BYTES = 4_500_000;
const ALLOWED = [/^https:\/\/tdavidyan85\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "*" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const rand = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const month = () => new Date().toISOString().slice(0, 7);
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const rest = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const rpc = (fn: string, body: unknown) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });

/* ---------- what the model is told ---------- */
const GENERIC_NAMES = ["דנה", "יוסי", "נועה", "אבי", "מיה", "רן"];
const SYSTEM = `You turn a photo of a class worksheet or homework page (Hebrew, an Israeli school) into a practice unit for a game for children with reading and writing difficulties.
Reply ONLY by calling the tool submit_pack. The pack is JSON in the format "masa-pack/1":

{ "schema":"masa-pack/1",
  "subject":{"id":"unit","name":"<subject in Hebrew>","grade":"<Hebrew letter ה/ו/...>","unit":"<short unit name>"},
  "cfg":{"examInfo":"<one short Hebrew sentence>","testSay":"<one short Hebrew sentence>"},
  "topics":[{"id":"t1","name":"<topic>","glyph":"<one emoji or letter>","bg":"#cfe3ff",
     "lessons":[{"title":"<short>","text":"<2-4 short sentences teaching the idea, taken from the page>"}],
     "skills":[{"id":"s1","name":"<name>","pool":"p1","examQ":1}]}],
  "pools":{"p1":{"defaults":{"type":"choice"},"items":[
     {"id":"a1","text":"<question>","options":["x","y","z"],"answer":"x","hint":"<short hint>","steps":["<step>"],"shuffle":true}]}},
  "exams":[{"name":"מבחן לדוגמה","sections":[{"skill":"s1","n":5,"label":"שאלה {n}"}]}]
}

Rules:
- Item types: "choice" (answer must be exactly one of options), "number" (answer is a number), "fraction", "spell" (English word, letters only). Prefer "choice": children answer with taps, almost no typing.
- Any subject is allowed (maths, languages, science, geography, history...). Match the worksheet's TASK to the interaction, whatever the topic:
  "draw a line between" -> "match": {"type":"match","text":"...","pairs":[{"l":"..","r":".."},...]} (2-6 pairs, no repeated side);
  "sort / put in the table" -> "sort": {"type":"sort","text":"...","bins":["A","B"],"items":[{"t":"..","bin":0},...]} (bin = index into bins; 2-8 items);
  "put in order / number the steps" -> "order": {"type":"order","text":"...","items":["first","second",...]} (items listed in the CORRECT order, 3-6 items; the game shuffles them);
  "circle / underline the ..." -> "tap": {"type":"tap","text":"...","tokens":["word",{"t":"word","ok":true},...]} (ok:true = the child must tap it; at least one);
  "colour in the parts" -> "cells": {"type":"cells","text":"...","shape":"pie","parts":4,"wholes":1,"count":3} (parts 2-12; count 1..parts*wholes).
  These items need no "options"/"answer". Use them only when the page really asks for that kind of task; otherwise use "choice".
- Each topic: 1-3 skills; each skill's pool needs at least 6 items (write new, similar questions in the same style as the page; the page's own questions come first). 2-4 distinct wrong options, no duplicates.
- Write every Hebrew sentence short and simple. English words go inside <en>...</en>. Math expressions inside <m>...</m>.
- Every item gets a "hint". Add "steps" (step-by-step explanation) when the idea needs it.
- PRIVACY: ignore header fields (child name, class, date, school, teacher, phone). Replace EVERY personal name that appears anywhere in the content with one of these generic names (use the same replacement consistently): ${GENERIC_NAMES.join(", ")}. Never copy a phone number, an email or an address. Set namesReplaced to the number of different real-looking names you replaced.
- If the photo is not a study page, or is unreadable, call the tool with pack = null and a Hebrew explanation in notes.`;

const TOOL = {
  name: "submit_pack",
  description: "Return the finished practice unit.",
  input_schema: {
    type: "object",
    properties: {
      pack: { type: ["object", "null"], description: "the masa-pack/1 object, or null if the photo is unusable" },
      namesReplaced: { type: "integer" },
      notes: { type: "string", description: "Hebrew: short note for the parent (what was read, what to check)" },
    },
    required: ["pack"],
  },
};

/* ---------- safety net on the model's output ---------- */
const PHONE = /(?:\+972[-\s]?|\b0)\d{1,2}[-\s]?\d{3}[-\s]?\d{4}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
function scrub(v: unknown, stat: { n: number }): unknown {
  if (typeof v === "string") {
    const s = v.replace(EMAIL, "").replace(PHONE, "");
    if (s !== v) stat.n++;
    return s;
  }
  if (Array.isArray(v)) return v.map((x) => scrub(x, stat));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrub(x, stat)]));
  return v;
}
// light structure check. The full engine check runs in the review page, where the real engine is loaded.
function check(p: any): string[] {
  const e: string[] = [];
  if (!p || p.schema !== "masa-pack/1") return ["schema"];
  if (!Array.isArray(p.topics) || !p.topics.length) e.push("no topics");
  const pools = p.pools || {};
  for (const t of p.topics || []) for (const s of t.skills || []) {
    const pool = pools[s.pool]; const items = Array.isArray(pool) ? pool : pool?.items;
    if (!items?.length) e.push(`skill ${s.id}: empty pool`);
  }
  for (const [pn, pool] of Object.entries<any>(pools)) for (const it of (Array.isArray(pool) ? pool : pool.items) || []) {
    const t = it.type || pool.defaults?.type;
    if (t === "choice") {
      const vals = (it.options || []).map((o: any) => String(typeof o === "string" ? o : o.v));
      if (!vals.includes(String(it.answer))) e.push(`${pn}/${it.id}: answer not in options`);
      if (new Set(vals).size !== vals.length) e.push(`${pn}/${it.id}: duplicate options`);
    }
    // the subject-independent interaction types: a light structure check (the game validates fully)
    const n = (a: unknown) => (Array.isArray(a) ? a.length : 0);
    if (t === "sort" && (n(it.bins) < 2 || n(it.items) < 2)) e.push(`${pn}/${it.id}: sort needs 2+ bins and items`);
    if (t === "match" && n(it.pairs) < 2) e.push(`${pn}/${it.id}: match needs 2+ pairs`);
    if (t === "order" && n(it.items) < 2) e.push(`${pn}/${it.id}: order needs 2+ items`);
    if (t === "tap" && !(it.tokens || []).some((x: any) => x && x.ok)) e.push(`${pn}/${it.id}: tap needs an ok token`);
    if (t === "cells" && !(Number(it.count) >= 1 && Number(it.count) <= Number(it.parts) * Number(it.wholes ?? 1))) e.push(`${pn}/${it.id}: cells count out of range`);
  }
  if (JSON.stringify(p).length > 400_000) e.push("too big");
  return e;
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function getRow(id: string) {
  const r = await rest(`packs?id=eq.${encodeURIComponent(id)}&select=*`);
  const a = await r.json().catch(() => []);
  return Array.isArray(a) ? a[0] : null;
}
const ownerOK = async (row: any, t: string) => !!row && !!t && (await sha(t)) === row.edit_hash;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const a = u.searchParams.get("a") || "";
  if (u.searchParams.get("status") === "1") return json(200, { configured: !!AKEY, model: MODEL });
  const from = req.headers.get("origin") || (req.headers.get("referer") || "").replace(/^(https?:\/\/[^/]+).*$/, "$1");
  if (from && !ALLOWED.some((re) => re.test(from))) return json(403, { error: "origin" });

  try {
    /* ---- the child's page: an approved pack ---- */
    if (a === "pack" && req.method === "GET") {
      const row = await getRow(u.searchParams.get("id") || "");
      if (!row || row.status !== "approved" || !row.json) return json(404, { error: "not_found" });
      return json(200, { pack: row.json, title: row.title });
    }

    /* ---- owner: read the draft ---- */
    if (a === "get" && req.method === "GET") {
      const row = await getRow(u.searchParams.get("id") || "");
      if (!(await ownerOK(row, u.searchParams.get("t") || ""))) return json(403, { error: "token" });
      return json(200, { pack: row.json, status: row.status, title: row.title, flags: row.flags });
    }

    /* ---- owner: save / approve / delete ---- */
    if (a === "save" && req.method === "POST") {
      const b = await req.json().catch(() => null);
      const row = await getRow(String(b?.id || ""));
      if (!(await ownerOK(row, String(b?.t || "")))) return json(403, { error: "token" });
      const stat = { n: 0 };
      const pack: any = scrub(b.pack, stat);
      const errs = check(pack);
      if (errs.length) return json(422, { error: "invalid", problems: errs.slice(0, 20) });
      const title = String(pack.subject?.unit || pack.subject?.name || "").slice(0, 80);
      const r = await rest(`packs?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ json: pack, title, status: b.approve ? "approved" : "draft", updated_at: new Date().toISOString() }),
      });
      return r.ok ? json(200, { ok: true, status: b.approve ? "approved" : "draft" }) : json(502, { error: "db" });
    }
    if (a === "delete" && req.method === "POST") {
      const b = await req.json().catch(() => null);
      const row = await getRow(String(b?.id || ""));
      if (!(await ownerOK(row, String(b?.t || "")))) return json(403, { error: "token" });
      await rest(`packs?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
      return json(200, { ok: true });
    }

    /* ---- owner: a new photo ---- */
    if (a === "new" && req.method === "POST") {
      if (!AKEY) return json(503, { error: "not_configured" });
      const device = (req.headers.get("x-device") || "").slice(0, 80);
      if (device.length < 16) return json(400, { error: "device" });
      const type = (req.headers.get("content-type") || "").split(";")[0];
      if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return json(415, { error: "type" });
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES) return json(413, { error: "size" });

      const m = month(), owner = await sha("o|" + device);
      const total = Number(await (await rpc("ingest_month_pages", { p_month: m })).json().catch(() => 0));
      if (total >= CAP) return json(429, { error: "monthly_cap" });
      const taken = Number(await (await rpc("ingest_take", { p_owner: owner, p_month: m, p_limit: PER_OWNER })).json().catch(() => -1));
      if (taken < 0) return json(429, { error: "owner_cap", limit: PER_OWNER });

      const ai = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: MODEL, max_tokens: 12000, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "submit_pack" },
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: type, data: b64(bytes) } },
            { type: "text", text: "Build the practice unit from this page." },
          ] }],
        }),
      });
      if (!ai.ok) return json(502, { error: "model", status: ai.status });
      const res = await ai.json();
      rpc("ingest_add_tokens", { p_owner: owner, p_month: m, p_in: res.usage?.input_tokens || 0, p_out: res.usage?.output_tokens || 0 }).catch(() => null);
      const out = (res.content || []).find((c: any) => c.type === "tool_use")?.input;
      if (!out?.pack) return json(422, { error: "unreadable", notes: String(out?.notes || "").slice(0, 300) });

      const stat = { n: 0 };
      const pack: any = scrub(out.pack, stat);
      const problems = check(pack);
      const id = rand(18), token = rand(24);
      const flags = { namesReplaced: Number(out.namesReplaced) || 0, contactsRemoved: stat.n, problems: problems.slice(0, 20), notes: String(out.notes || "").slice(0, 400) };
      const r = await rest("packs", {
        method: "POST",
        body: JSON.stringify({ id, edit_hash: await sha(token), owner_hash: owner, status: "draft", title: String(pack.subject?.unit || pack.subject?.name || "").slice(0, 80), json: pack, flags }),
      });
      if (!r.ok) return json(502, { error: "db" });
      return json(200, { id, token, pack, flags });
    }
    return json(404, { error: "route" });
  } catch (e) {
    return json(500, { error: "server" });
  }
});
