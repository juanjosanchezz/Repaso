/* Prueba de lib/gemini.js y de /api/claude con Gemini, sin red (fetch simulado). */
const assert = require("assert");
const { Readable } = require("stream");
const G = require("../lib/gemini.js");
let ok = 0;
const enc = new TextEncoder();
const sseBody = chunks => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode("data: " + JSON.stringify(x) + "\r\n\r\n")); c.close(); } });
function req(body, headers = {}) { const r = Readable.from([JSON.stringify(body)]); r.method = "POST"; r.headers = headers; return r; }
function res() { const r = { statusCode: 200, headers: {}, chunks: [], writableEnded: false }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; r.writeHead = (s, h) => { r.statusCode = s; Object.entries(h || {}).forEach(([k, v]) => r.setHeader(k, v)); }; r.write = c => r.chunks.push(String(c)); r.end = c => { if (c) r.chunks.push(String(c)); r.writableEnded = true; }; r.on = () => {}; return r; }
const events = r => r.chunks.join("").split("\n\n").filter(Boolean).map(b => JSON.parse(b.split("\n").find(l => l.startsWith("data:")).slice(5)));

(async () => {
  // Petición: texto, imagen, herramientas (con esquema limpiado) y vuelta de herramienta con su firma.
  const msgs = [
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } }, { type: "text", text: "Hola" }] },
    { role: "assistant", content: [{ type: "text", text: "Lo apunto" }, { type: "tool_use", id: "toolu_1_x" + G.SIG + "FIRMA", name: "recordar", input: { dato: "Kant" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1_x" + G.SIG + "FIRMA", content: "guardado" }] },
  ];
  const b = G.body({ messages: msgs, tools: [{ name: "recordar", description: "d", input_schema: { type: "object", additionalProperties: false, $schema: "x", properties: { dato: { type: "string" } }, required: ["dato"] } }], maxTokens: 999 });
  assert.equal(b.contents[0].role, "user"); assert.deepEqual(b.contents[0].parts[0], { inlineData: { mimeType: "image/jpeg", data: "AAA" } }); assert.equal(b.contents[0].parts[1].text, "Hola"); ok++;
  assert.equal(b.contents[1].role, "model"); assert.deepEqual(b.contents[1].parts[1], { functionCall: { name: "recordar", args: { dato: "Kant" } }, thoughtSignature: "FIRMA" }); ok++;
  assert.deepEqual(b.contents[2].parts[0], { functionResponse: { name: "recordar", response: { result: "guardado" } } }); ok++;
  assert.deepEqual(b.tools[0].functionDeclarations[0].parameters, { type: "object", required: ["dato"], properties: { dato: { type: "string" } } }); assert.equal(b.generationConfig.maxOutputTokens, 999); ok++;

  // Respuesta: texto en trozos, pensamiento oculto y llamada a herramienta → eventos con formato de Claude.
  process.env.GEMINI_API_KEY = "g-key"; delete process.env.ANTHROPIC_API_KEY; delete process.env.REPASO_ACCESS_CODE; delete process.env.DATABASE_URL;
  const handler = require("../api/claude.js");
  const seen = [];
  global.fetch = async (url, init) => {
    seen.push({ url, init });
    if (url.includes("gemini-flash-latest")) return { ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 0"}}' };
    return { ok: true, status: 200, body: sseBody([
      { candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text: "El turnismo " }] } }] },
      { candidates: [{ content: { parts: [{ text: "fue pactado." }, { functionCall: { name: "recordar", args: { dato: "Kant" } }, thoughtSignature: "S1" }] }, finishReason: "STOP" }] },
    ]) };
  };
  let r = res(); await handler(req({ tier: "complex", messages: [{ role: "user", content: [{ type: "text", text: "hola" }] }], tools: [{ name: "recordar", input_schema: { type: "object" } }] }), r);
  assert.equal(r.statusCode, 200); assert.equal(seen.length, 2); assert.match(seen[1].url, /gemini-flash-lite-latest:streamGenerateContent\?alt=sse$/); assert.equal(seen[1].init.headers["x-goog-api-key"], "g-key"); ok++;
  const ev = events(r);
  const text = ev.filter(e => e.delta?.type === "text_delta").map(e => e.delta.text).join("");
  assert.equal(text, "El turnismo fue pactado."); ok++;
  const tu = ev.find(e => e.content_block?.type === "tool_use");
  assert.equal(tu.content_block.name, "recordar"); assert.ok(tu.content_block.id.endsWith(G.SIG + "S1")); assert.deepEqual(JSON.parse(ev.find(e => e.delta?.type === "input_json_delta").delta.partial_json), { dato: "Kant" }); ok++;
  assert.equal(ev.find(e => e.type === "message_delta").delta.stop_reason, "tool_use"); assert.equal(ev.at(-1).type, "message_stop"); ok++;

  // Todos los modelos sin cupo → 429; clave mala → error que la app reconoce; bloqueo → "refused".
  global.fetch = async () => ({ ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded ... PerDay ... limit: 0"}}' });
  r = res(); await handler(req({ messages: [{ role: "user", content: "hola" }] }), r); assert.equal(r.statusCode, 429); assert.match(r.chunks.join(""), /rate_limited/); ok++;
  // Límite por minuto: espera lo que pide Google y reintenta el mismo modelo.
  let n = 0; const t0 = Date.now();
  const okBody = () => ({ ok: true, status: 200, body: sseBody([{ candidates: [{ content: { parts: [{ text: "ya" }] }, finishReason: "STOP" }] }]) });
  const g2 = await G.call({ key: "k", messages: [{ role: "user", content: "x" }], maxTokens: 10, fetchImpl: async () => (++n === 1 ? { ok: false, status: 429, text: async () => '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"1s"}]}}' } : okBody()) });
  assert.ok(g2.res); assert.equal(n, 2); assert.ok(Date.now() - t0 >= 1000); assert.equal(g2.model, "gemini-flash-latest"); ok++;
  const pr = await G.probe({ key: "k", fetchImpl: async u => (u.includes("flash-latest") ? { ok: false, status: 429, text: async () => '{"error":{"message":"limit: 0"}}' } : { ok: true, status: 200, text: async () => "{}" }) });
  assert.equal(pr[0].estado, "sin cupo gratuito (o agotado hoy)"); assert.equal(pr[1].estado, "funciona"); ok++;
  global.fetch = async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}' });
  r = res(); await handler(req({ messages: [{ role: "user", content: "hola" }] }), r); assert.equal(r.statusCode, 502); assert.match(r.chunks.join(""), /authentication_error/); ok++;
  global.fetch = async () => ({ ok: true, status: 200, body: sseBody([{ promptFeedback: { blockReason: "SAFETY" } }]) });
  r = res(); await handler(req({ messages: [{ role: "user", content: "hola" }] }), r); assert.equal(events(r).at(-1).error.type, "refused"); ok++;
  global.fetch = async () => ({ ok: true, status: 200, body: sseBody([{ candidates: [{ content: { parts: [{ text: "corta" }] }, finishReason: "MAX_TOKENS" }] }]) });
  r = res(); await handler(req({ messages: [{ role: "user", content: "hola" }] }), r); assert.equal(events(r).find(e => e.type === "message_delta").delta.stop_reason, "max_tokens"); ok++;

  assert.equal(G.modelsFor("quick")[0], "gemini-flash-lite-latest"); assert.equal(G.modelsFor("complex")[0], "gemini-flash-latest"); ok++;
  // REPASO_AI=claude con las dos claves → Claude.
  process.env.ANTHROPIC_API_KEY = "sk-ant"; process.env.REPASO_AI = "claude";
  assert.equal(handler.provider().name, "claude"); delete process.env.REPASO_AI; assert.equal(handler.provider().name, "gemini"); ok++;
  console.log(`${ok}/16 comprobaciones correctas (gemini)`);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
