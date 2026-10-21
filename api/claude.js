/* Repaso · función de Vercel que hace de puente con la API de Claude.
   La app (versión web) llama aquí; tu API key nunca llega al navegador.

   Variables de entorno (Vercel → Settings → Environment Variables):
     ANTHROPIC_API_KEY      obligatoria. Tu clave de la API de Claude.
     REPASO_ACCESS_CODE     muy recomendable. Código que piden la app y este endpoint;
                            sin él, cualquiera con el enlace gastaría de tu clave.
     REPASO_MODEL_COMPLEX   opcional (por defecto claude-opus-5-5)
     REPASO_MODEL_DEFAULT   opcional (por defecto claude-sonnet-5-5)
     REPASO_MODEL_QUICK     opcional (por defecto claude-haiku-5-5)
     REPASO_MAX_TOKENS      opcional (por defecto 16000)
*/
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "method_not_allowed" }); }
  const code = process.env.REPASO_ACCESS_CODE;
  if (code && req.headers["x-repaso-code"] !== code) return send(res, 401, { error: "bad_code" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 500, { error: "missing_key" });

  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_json" }); }
  const { tier = "default", messages, tools } = body || {};
  if (!validMessages(messages)) return send(res, 400, { error: "bad_messages" });

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });

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
};
