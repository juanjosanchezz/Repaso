/* Repaso · Gemini (Google) como IA de la versión web, en su nivel gratuito.
   La app y web/claude-web.js hablan el formato de la API de Claude (mensajes, imágenes,
   herramientas y stream SSE). Esto traduce la petición a Gemini y su respuesta de vuelta
   a eventos SSE con el formato de Claude, así nada más tiene que cambiar.

   Variables: GEMINI_API_KEY (aistudio.google.com, gratis y sin tarjeta)
              REPASO_GEMINI_MODELS opcional, lista separada por comas (se prueban en orden
              si uno no existe o ha llegado a su límite del día). */
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
// Último recurso cuando los Flash no tienen cupo: Gemma (gratis, con mucho más cupo diario).
// No admite herramientas, así que solo se usa en peticiones sin ellas (todo menos el chat que apunta cosas).
const BACKUP_MODELS = ["gemma-3-27b-it", "gemma-3-12b-it"];
const isGemma = m => /^gemma/i.test(m);
/** Orden de modelos según la tarea: lo rápido (chat, tests, flashcards) empieza por Flash-Lite;
    lo largo y exigente (apuntes, exámenes, comentarios) por Flash. Cada modelo tiene su propio cupo. */
const LITE_FIRST = ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"];
const flashFor = tier => (tier === "quick" ? models().sort((a, b) => (LITE_FIRST.indexOf(a) + 1 || 99) - (LITE_FIRST.indexOf(b) + 1 || 99)) : models());
/** Modo (REPASO_GEMINI_MODE): "volumen" (por defecto) usa primero Gemma, con mucho más cupo diario;
    "calidad" usa primero Flash y deja Gemma de respaldo. Con herramientas (chat que apunta) siempre Flash. */
const mode = () => (String(process.env.REPASO_GEMINI_MODE || "volumen").toLowerCase().startsWith("cal") ? "calidad" : "volumen");
// Gemma gratis admite poco texto por minuto: una petición más grande que esto no le cabe aunque espere.
const GEMMA_MAX_TOKENS = 12000;
/** Tokens aproximados de una petición (≈ 3,5 caracteres por token; una imagen cuenta como ~1.300). */
function estimateTokens(messages) {
  let chars = 0, imgs = 0;
  for (const m of messages || []) for (const b of (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [])) {
    if (b.type === "image") imgs++; else chars += String(b.text || b.content || "").length + (b.input ? JSON.stringify(b.input).length : 0);
  }
  return Math.ceil(chars / 3.5) + imgs * 1300;
}
function modelsFor(tier, withTools = false, tokens = 0) {
  // Con herramientas (chat que apunta exámenes): Flash; si no hay cupo, Gemma sin herramientas para que el chat siga.
  if (withTools) return flashFor(tier).concat(BACKUP_MODELS);
  // Mucho material (modelo de examen, apuntes de varios PDFs…): primero los Flash, empezando por Flash-Lite,
  // que tiene más cupo; Gemma solo al final. Así no se queda sin hacer por falta de cupo de Gemma.
  if (tokens > GEMMA_MAX_TOKENS) return flashFor("quick").concat(BACKUP_MODELS);
  return mode() === "volumen" ? BACKUP_MODELS.concat(flashFor(tier)) : flashFor(tier).concat(BACKUP_MODELS);
}
const models = () => (process.env.REPASO_GEMINI_MODELS || "").split(",").map(s => s.trim()).filter(Boolean).concat(DEFAULT_MODELS).filter((m, i, a) => a.indexOf(m) === i);
// Firma de pensamiento de Gemini 3 en las llamadas a herramientas: viaja dentro del id de tool_use.
const SIG = "~sig~";
const DUMMY_SIG = "skip_thought_signature_validator";

/** Esquema JSON de Claude → subconjunto que acepta Gemini. */
function schema(s) {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(schema);
  const out = {};
  for (const k of ["type", "description", "enum", "required", "nullable", "format", "minimum", "maximum", "minItems", "maxItems"]) if (s[k] !== undefined) out[k] = s[k];
  if (s.properties) { out.properties = {}; for (const [k, v] of Object.entries(s.properties)) out.properties[k] = schema(v); }
  if (s.items) out.items = schema(s.items);
  if (out.type === "object" && !out.properties) out.properties = {};
  return out;
}

/** Mensajes con formato de Claude → contents de Gemini. */
function toGemini(messages, plain = false) {
  const names = {};
  return messages.map(m => {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const parts = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) parts.push({ text: b.text });
      else if (b.type === "image" && b.source?.data) parts.push({ inlineData: { mimeType: b.source.media_type || "image/jpeg", data: b.source.data } });
      else if (plain && b.type === "tool_use") parts.push({ text: `[Usé la herramienta ${b.name}: ${JSON.stringify(b.input || {})}]` });
      else if (plain && b.type === "tool_result") parts.push({ text: `[Resultado: ${typeof b.content === "string" ? b.content : JSON.stringify(b.content)}]` });
      else if (b.type === "tool_use") {
        names[b.id] = b.name;
        const sig = String(b.id).includes(SIG) ? String(b.id).split(SIG)[1] : DUMMY_SIG;
        parts.push({ functionCall: { name: b.name, args: b.input || {} }, thoughtSignature: sig });
      } else if (b.type === "tool_result") {
        const content = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        parts.push({ functionResponse: { name: names[b.tool_use_id] || "herramienta", response: b.is_error ? { error: content } : { result: content } } });
      }
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: parts.length ? parts : [{ text: " " }] };
  });
}

function body({ messages, tools, maxTokens, model = "" }) {
  const b = { contents: toGemini(messages, isGemma(model)), generationConfig: { maxOutputTokens: isGemma(model) ? Math.min(maxTokens || 8192, 8192) : maxTokens } };
  if (isGemma(model)) return b;
  if (Array.isArray(tools) && tools.length) b.tools = [{ functionDeclarations: tools.slice(0, 16).map(t => ({ name: t.name, description: t.description || "", parameters: schema(t.input_schema || { type: "object", properties: {} }) })) }];
  return b;
}

/** Segundos que Google pide esperar en un 429 (RetryInfo.retryDelay, "17s"), o null. */
function retryDelay(detail) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(detail) || /retry in (\d+(?:\.\d+)?)\s*s/i.exec(detail);
  return m ? Number(m[1]) : null;
}
/** El 429 es de cupo gratuito a 0 o del día (no sirve esperar unos segundos). */
/** La petición es más grande que lo que el modelo admite por minuto: esperar no sirve, se pasa al siguiente. */
const tooBigPerMinute = d => /TokensPerMinute|input_token_count|tokens per minute/i.test(d) && /limit:\s*(\d+)/.test(d);
const dailyOrZero = d => /limit:\s*0\b|PerDay|per day|free_tier_requests.*limit:\s*0/i.test(d);
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener?.("abort", () => { clearTimeout(t); rej(new Error("aborted")); }, { once: true }); });

/** Último recurso para Gemma: si el material no le cabe, se manda un extracto repartido por todo el texto
    (no solo el principio), para que haga la tarea igualmente en vez de fallar. */
function spread(t, n) {
  if (t.length <= n) return t;
  const parts = Math.max(1, Math.min(16, Math.floor(n / 1200))), size = Math.floor(n / parts), step = (t.length - size) / Math.max(1, parts - 1);
  const out = []; for (let i = 0; i < parts; i++) { const a = Math.floor(i * step); out.push(t.slice(a, a + size)); }
  return out.join("\n[…]\n");
}
function shrinkForGemma(messages, maxTok = GEMMA_MAX_TOKENS * 0.85) {
  const est = estimateTokens(messages);
  if (est <= maxTok) return messages;
  const copy = JSON.parse(JSON.stringify(messages));
  let biggest = null;
  for (const m of copy) for (const b of (typeof m.content === "string" ? [] : m.content)) if (b.type === "text" && (!biggest || b.text.length > biggest.text.length)) biggest = b;
  if (!biggest) return messages;
  const keepChars = Math.max(4000, biggest.text.length - Math.ceil((est - maxTok) * 3.5));
  const t = biggest.text, headLen = Math.min(3000, Math.floor(keepChars * 0.15));   // las instrucciones suelen ir al principio y al final
  const tailLen = Math.min(3000, Math.floor(keepChars * 0.15));
  biggest.text = t.slice(0, headLen) + "\n[Material resumido: el original era muy largo; trabaja con lo que hay]\n" + spread(t.slice(headLen, t.length - tailLen), keepChars - headLen - tailLen) + "\n" + t.slice(t.length - tailLen);
  return copy;
}

/** Modelos que han dicho "sin cupo": se apartan un rato para no perder tiempo (vive mientras la función esté caliente). */
const cooldown = new Map();
const cooling = m => (cooldown.get(m) || 0) > Date.now();
const cool = (m, sec) => cooldown.set(m, Date.now() + sec * 1000);

/** Llama a Gemini probando modelos en orden. Devuelve {res} con el stream o {status, error, detail}.
    Si un modelo pide esperar pocos segundos (límite por minuto), espera y lo reintenta una vez. */
async function call({ key, messages, tools, maxTokens, signal, tier = "default", fetchImpl = fetch, maxWait = 25 }) {
  let last = { status: 502, error: "upstream", detail: "" }, waits = [], allDaily = true, any429 = false;
  const est = estimateTokens(messages);
  const all = modelsFor(tier, Array.isArray(tools) && tools.length > 0, est);
  const fresh = all.filter(m => !cooling(m));
  const list = fresh.length ? fresh.concat(all.filter(cooling)) : all;   // los apartados, al final (por si ya tienen cupo)
  for (const model of list) {
   const msgs = isGemma(model) && est > GEMMA_MAX_TOKENS ? shrinkForGemma(messages) : messages;
   const payload = JSON.stringify(body({ messages: msgs, tools, maxTokens, model }));
   for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try { r = await fetchImpl(`${BASE}${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: "POST", signal, headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: payload }); }
    catch (e) { if (signal?.aborted) throw e; last = { status: 502, error: "upstream_unreachable", detail: "" }; break; }
    if (r.ok) return { res: r, model };
    const detail = (await r.text().catch(() => "")).slice(0, 1500);
    if (r.status === 429) {
      any429 = true;
      if (dailyOrZero(detail)) cool(model, 3600);
      else { allDaily = false; waits.push(retryDelay(detail) ?? 15); if (attempt === 1 || tooBigPerMinute(detail)) cool(model, Math.min(60, retryDelay(detail) ?? 30)); }
    }
    if (r.status === 404) cool(model, 6 * 3600);
    if (r.status === 429 && attempt === 0 && !dailyOrZero(detail) && !tooBigPerMinute(detail)) {
      const wait = retryDelay(detail) ?? 8;
      if (wait <= maxWait) { await sleep(wait * 1000 + 500, signal); continue; }
    }
    if (r.status === 404 || r.status === 429 || r.status === 503 || (r.status === 400 && /not found|not supported|unsupported model/i.test(detail))) { last = { status: r.status === 429 || r.status === 503 ? 429 : 502, error: r.status === 429 || r.status === 503 ? "rate_limited" : "upstream", detail }; break; }
    if ((r.status === 400 || r.status === 403) && /api key|API_KEY|permission|PERMISSION_DENIED/i.test(detail)) return { status: 502, error: "upstream", detail: "authentication_error: " + detail };
    // Cualquier otro fallo de Google (500, 400 de un modelo concreto…): se prueba el siguiente modelo.
    if (r.status >= 500 && attempt === 0) { await sleep(1500, signal); continue; }
    last = { status: 502, error: "upstream", detail }; cool(model, 120); break;
   }
  }
  // Sin cupo en ninguno: dice si basta con esperar (límite por minuto) o es el del día.
  if (any429 && last.error === "rate_limited") return { ...last, daily: allDaily, retry_after: allDaily ? null : Math.max(5, Math.min(60, Math.min(...waits))) };
  return last;
}

/** Diagnóstico: prueba cada modelo con una petición mínima y devuelve lo que contesta Google. */
async function probe({ key, fetchImpl = fetch }) {
  const out = [];
  for (const model of models().concat(BACKUP_MODELS)) {
    try {
      const r = await fetchImpl(`${BASE}${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Responde solo: ok" }] }], generationConfig: { maxOutputTokens: 20 } }) });
      const t = await r.text().catch(() => "");
      let msg = ""; try { msg = JSON.parse(t)?.error?.message || ""; } catch {}
      out.push({ modelo: model, estado: r.ok ? "funciona" : r.status === 429 ? (dailyOrZero(t) ? "sin cupo gratuito (o agotado hoy)" : "límite por minuto, espera un poco") : r.status === 404 ? "no existe" : "error " + r.status, detalle: r.ok ? "" : msg.slice(0, 300) });
    } catch (e) { out.push({ modelo: model, estado: "sin conexión", detalle: String(e?.message || e).slice(0, 200) }); }
  }
  return out;
}

/** Lee el SSE de Gemini y escribe eventos SSE con el formato de Claude en `write`. */
async function pipe(res, write) {
  const ev = e => write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  ev({ type: "message_start", message: { id: "gemini", type: "message", role: "assistant", content: [] } });
  let idx = -1, textOpen = false, calls = 0, finish = null, blocked = null, any = false;
  const closeText = () => { if (textOpen) { ev({ type: "content_block_stop", index: idx }); textOpen = false; } };
  const handle = chunk => {
    if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
    const c = chunk.candidates?.[0];
    if (!c) return;
    for (const p of c.content?.parts || []) {
      if (p.thought) continue;
      if (typeof p.text === "string" && p.text) {
        if (!textOpen) { idx++; ev({ type: "content_block_start", index: idx, content_block: { type: "text", text: "" } }); textOpen = true; }
        ev({ type: "content_block_delta", index: idx, delta: { type: "text_delta", text: p.text } }); any = true;
      } else if (p.functionCall) {
        closeText(); idx++; calls++; any = true;
        const id = `toolu_${calls}_${Date.now().toString(36)}` + (p.thoughtSignature ? SIG + p.thoughtSignature : "");
        ev({ type: "content_block_start", index: idx, content_block: { type: "tool_use", id, name: p.functionCall.name, input: {} } });
        ev({ type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: JSON.stringify(p.functionCall.args || {}) } });
        ev({ type: "content_block_stop", index: idx });
      }
    }
    if (c.finishReason) finish = c.finishReason;
  };
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = raw.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if (data) { try { handle(JSON.parse(data)); } catch { /* trozo incompleto */ } }
    }
  }
  closeText();
  if (!any && (blocked || /SAFETY|PROHIBITED|BLOCKLIST|RECITATION/.test(finish || ""))) {
    ev({ type: "error", error: { type: "refused", message: "Gemini no ha querido responder a esto (" + (blocked || finish) + ")" } });
    return;
  }
  ev({ type: "message_delta", delta: { stop_reason: calls ? "tool_use" : finish === "MAX_TOKENS" ? "max_tokens" : "end_turn" } });
  ev({ type: "message_stop" });
}

module.exports = { shrinkForGemma, cooldown, estimateTokens, modelsFor, call, pipe, probe, toGemini, schema, body, models, retryDelay, SIG };
