// מסע הלמידה – natural cloud voice. GET ?t=<text>&l=he|en&v=hila|avri&r=0.8 → audio/mpeg
// Every sentence is synthesised once (Azure neural voices) and kept in a private storage bucket, so a repeat costs nothing.
// The Azure key lives only in this function's secrets. A monthly character cap protects the bill.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY = Deno.env.get("AZURE_SPEECH_KEY") || "";
const REGION = (Deno.env.get("AZURE_SPEECH_REGION") || "westeurope").toLowerCase().replace(/\s+/g, "");
const CAP = Number(Deno.env.get("TTS_MONTHLY_CAP") || "450000"); // the free tier is 500,000 characters a month
const VOICES: Record<string, string> = {
  hila: "he-IL-HilaNeural", avri: "he-IL-AvriNeural",
  jenny: "en-US-JennyNeural", guy: "en-US-GuyNeural",
};
const ALLOWED = [/^https:\/\/tdavidyan85\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const audio = (buf: ArrayBuffer, hit: boolean) =>
  new Response(buf, { status: 200, headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Cache": hit ? "hit" : "miss" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const rpc = (fn: string, body: unknown) =>
  fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json(405, { error: "method" });
  const u = new URL(req.url);
  if (u.searchParams.get("status") === "1") return json(200, { configured: !!KEY, region: REGION });
  const t = (u.searchParams.get("t") || "").replace(/\s+/g, " ").trim();
  const l = u.searchParams.get("l") === "en" ? "en" : "he";
  let v = u.searchParams.get("v") || (l === "en" ? "jenny" : "hila");
  if (!VOICES[v] || (l === "en") !== /^(jenny|guy)$/.test(v)) v = l === "en" ? "jenny" : "hila";
  let r = Math.round(Number(u.searchParams.get("r") || "0.8") * 20) / 20;
  if (!(r >= 0.5 && r <= 1.3)) r = 0.8;
  if (!t || t.length > 400) return json(400, { error: "text" });

  // packs made from photos (n=p) use their own cache folder, so text from a family's worksheet never mixes with the shared one
  const ns = u.searchParams.get("n") === "p" ? "p1" : "v1";
  const path = `${ns}/${v}/${await sha(`${v}|${r}|${t}`)}.mp3`;
  const obj = `${SB}/storage/v1/object/tts/${path}`;
  const auth = { apikey: SR, Authorization: `Bearer ${SR}` };
  const cached = await fetch(obj, { headers: auth });
  if (cached.ok) return audio(await cached.arrayBuffer(), true);

  // a new sentence costs money: only from our own site, only with a key, only under the monthly cap
  const from = req.headers.get("origin") || (req.headers.get("referer") || "").replace(/^(https?:\/\/[^/]+).*$/, "$1");
  if (from && !ALLOWED.some((re) => re.test(from))) return json(403, { error: "origin" });
  if (!KEY) return json(503, { error: "not_configured" });
  const used = await (await rpc("tts_month_chars", {})).json().catch(() => 0);
  if (Number(used) + t.length > CAP) return json(429, { error: "monthly_cap" });

  const pct = Math.round((r * (l === "en" ? 0.92 : 1) - 1) * 100);
  const lang = l === "en" ? "en-US" : "he-IL";
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${VOICES[v]}"><prosody rate="${pct}%">${esc(t)}</prosody></voice></speak>`;
  const az = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "masa-halemida" },
    body: ssml,
  });
  if (!az.ok) return json(502, { error: "azure", status: az.status });
  const buf = await az.arrayBuffer();
  await Promise.all([
    fetch(obj, { method: "POST", headers: { ...auth, "Content-Type": "audio/mpeg", "x-upsert": "true" }, body: buf }).catch(() => null),
    rpc("tts_add", { p_chars: t.length }).catch(() => null),
  ]);
  return audio(buf, false);
});
