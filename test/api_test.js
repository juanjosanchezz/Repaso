/* Prueba de api/claude.js sin red: simula req/res de Vercel y la API de Claude. */
const assert = require("assert");
const { Readable } = require("stream");
const handler = require("../api/claude.js");
let ok = 0;
function req(body, headers = {}) { const r = Readable.from([JSON.stringify(body)]); r.method = "POST"; r.headers = headers; return r; }
function res() {
  const r = { statusCode: 200, headers: {}, chunks: [], writableEnded: false, listeners: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.writeHead = (s, h) => { r.statusCode = s; Object.entries(h || {}).forEach(([k, v]) => r.setHeader(k, v)); };
  r.write = c => r.chunks.push(Buffer.from(c).toString());
  r.end = c => { if (c) r.chunks.push(String(c)); r.writableEnded = true; };
  r.on = (e, f) => { r.listeners[e] = f; };
  return r;
}
const msgs = [{ role: "user", content: [{ type: "text", text: "hola" }] }];
(async () => {
  process.env.REPASO_ACCESS_CODE = "secreto"; delete process.env.ANTHROPIC_API_KEY;
  let r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "mal" }), r); assert.equal(r.statusCode, 401); ok++;
  r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "secreto" }), r); assert.equal(r.statusCode, 500); assert.match(r.chunks.join(""), /missing_key/); ok++;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  r = res(); await handler(req({ messages: [] }, { "x-repaso-code": "secreto" }), r); assert.equal(r.statusCode, 400); ok++;
  let sent;
  global.fetch = async (url, init) => { sent = { url, init }; const enc = new TextEncoder(); return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode("event: x\ndata: {\"type\":\"message_stop\"}\n\n")); c.close(); } }) }; };
  r = res(); await handler(req({ tier: "complex", messages: msgs, tools: [{ name: "t", input_schema: { type: "object" } }], max_tokens: 999999 }, { "x-repaso-code": "secreto" }), r);
  const b = JSON.parse(sent.init.body);
  assert.equal(r.statusCode, 200); assert.equal(r.headers["content-type"], "text/event-stream; charset=utf-8"); assert.match(r.chunks.join(""), /message_stop/); ok++;
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages"); assert.equal(sent.init.headers["x-api-key"], "sk-test"); assert.equal(b.model, "claude-opus-5-5"); assert.equal(b.stream, true); assert.equal(b.max_tokens, 16000); assert.equal(b.tools.length, 1); ok++;
  global.fetch = async () => ({ ok: false, status: 529, text: async () => "overloaded" });
  r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "secreto" }), r); assert.equal(r.statusCode, 429); ok++;
  r = res(); const g = req({}); g.method = "GET"; await handler(g, r); assert.equal(r.statusCode, 405); ok++;
  console.log(`${ok}/7 comprobaciones correctas (api)`);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
