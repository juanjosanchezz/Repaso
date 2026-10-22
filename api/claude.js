/* Repaso · función de Vercel que hace de puente con la IA (Gemini gratis o Claude).
   La app (versión web) llama aquí; tu clave nunca llega al navegador. Responde siempre
   con el formato de la API de Claude (lib/gemini.js traduce lo de Gemini).

   Variables de entorno (Vercel → Settings → Environment Variables):
     GEMINI_API_KEY         clave gratuita de Google (aistudio.google.com). Si está, se usa Gemini.
     ANTHROPIC_API_KEY      clave de la API de Claude (de pago). Se usa si no hay GEMINI_API_KEY
                            o si REPASO_AI=claude.
     REPASO_ACCESS_CODE     muy recomendable. Código que piden la app y este endpoint;
                            sin él, cualquiera con el enlace (o que se cree una cuenta)
                            gastaría de tu clave. Con cuentas, se pide una vez por cuenta.
     DATABASE_URL           (la pone la integración de Neon) cuentas de verdad: si está,
                            solo se atiende a quien tenga sesión.
     REPASO_MODEL_COMPLEX   opcional (por defecto claude-opus-5-5)
     REPASO_MODEL_DEFAULT   opcional (por defecto claude-sonnet-5-5)
     REPASO_MODEL_QUICK     opcional (por defecto claude-haiku-5-5)
     REPASO_MAX_TOKENS      opcional (por defecto 16000)
*/
const { enabled: accounts } = require("../lib/db.js");
const { userFromReq } = require("../lib/auth.js");
const gemini = require("../lib/gemini.js");

/** Qué IA usar: Gemini si hay su clave (salvo REPASO_AI=claude); si no, Claude. */
// Nombres que se aceptan para la clave de Google (por si se escribió de otra forma).
const GEMINI_VARS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API"];
const ANTHROPIC_VARS = ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"];
const pick = (env, names) => { for (const n of names) { const v = String(env[n] || "").trim(); if (v) return { name: n, value: v }; } return null; };
function provider(env = process.env) {
  const g = pick(env, GEMINI_VARS), a = pick(env, ANTHROPIC_VARS);
  if (String(env.REPASO_AI || "").trim().toLowerCase() === "claude" && a) return { name: "claude", key: a.value, from: a.name };
  if (g) return { name: "gemini", key: g.value, from: g.name };
  if (a) return { name: "claude", key: a.value, from: a.name };
  return null;
}

const MODELS = {
  complex: process.env.REPASO_MODEL_COMPLEX || "claude-opus-5-5",
  default: process.env.REPASO_MODEL_DEFAULT || "claude-sonnet-5-5",
  quick: process.env.REPASO_MODEL_QUICK || "claude-haiku-5-5",
};
const MAX_TOKENS = Number(process.env.REPASO_MAX_TOKENS) || 16000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = []; for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function validMessages(m) {
  return Array.isArray(m) && m.length > 0 && m.length <= 200 && m.every(x => x && (x.role === "user" || x.role === "assistant") && (typeof x.content === "string" || Array.isArray(x.content)));
}

async function handler(req, res) {
  // Diagnóstico sin secretos: abre /api/claude en el navegador para ver qué IA encuentra el servidor.
  if (req.method === "GET") {
    const ai = provider();
    // ?probar=1 → pregunta a cada modelo de Gemini con una petición mínima y dice cuál funciona.
    if (ai?.name === "gemini" && /[?&]probar=1\b/.test(req.url || "")) return send(res, 200, { ia: "gemini", modelos: await gemini.probe({ key: ai.key }) });
    return send(res, 200, ai
      ? { ok: true, ia: ai.name, variable: ai.from, clave: ai.key.slice(0, 4) + "…" + ` (${ai.key.length} caracteres)`, codigo_de_acceso: !!process.env.REPASO_ACCESS_CODE }
      : { ok: false, ia: null, problema: "El servidor no ve ninguna clave. En Vercel → Settings → Environment Variables añade GEMINI_API_KEY marcando Production, guarda y haz Redeploy.", codigo_de_acceso: !!process.env.REPASO_ACCESS_CODE });
  }
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "method_not_allowed" }); }
  if (accounts()) {
    let user;
    try { user = await userFromReq(req); } catch { return send(res, 502, { error: "db_unreachable" }); }
    if (!user) return send(res, 401, { error: "no_session" });
  }
  const code = process.env.REPASO_ACCESS_CODE;
  if (code && req.headers["x-repaso-code"] !== code) return send(res, 401, { error: "bad_code" });
  const ai = provider();
  if (!ai) return send(res, 500, { error: "missing_key" });
  const key = ai.key;

  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_json" }); }
  const { tier = "default", messages, tools } = body || {};
  if (!validMessages(messages)) return send(res, 400, { error: "bad_messages" });

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });

  if (ai.name === "gemini") {
    let r;
    try { r = await gemini.call({ key, messages, tools, maxTokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS), signal: ac.signal }); }
    catch { if (ac.signal.aborted) return; return send(res, 502, { error: "upstream_unreachable" }); }
    if (!r.res) return send(res, r.status, { error: r.error, detail: r.detail });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "x-repaso-model": r.model });
    try { await gemini.pipe(r.res, chunk => res.write(chunk)); } catch { /* la usuaria canceló o se cortó la conexión */ }
    return res.end();
  }

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ac.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELS[tier] || MODELS.default,
        max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS),
        messages,
        ...(Array.isArray(tools) && tools.length ? { tools: tools.slice(0, 16) } : {}),
        stream: true,
      }),
    });
  } catch (e) {
    if (ac.signal.aborted) return;
    return send(res, 502, { error: "upstream_unreachable" });
  }
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 600);
    return send(res, upstream.status === 529 ? 429 : upstream.status, { error: "upstream", detail });
  }

  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
  try {
    const reader = upstream.body.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
  } catch { /* la usuaria canceló o se cortó la conexión */ }
  res.end();
}
module.exports = handler;
module.exports.provider = provider;
