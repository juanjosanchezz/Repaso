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
  r = res(); const g = req({}); g.method = "PUT"; await handler(g, r); assert.equal(r.statusCode, 405); ok++;

  // Con cuentas (Neon): solo se atiende a quien tiene sesión.
  const crypto = require("crypto");
  const good = crypto.createHash("sha256").update("buena").digest("hex");
  global.__REPASO_DB__ = async (text, params) => (/rp_sessions/.test(text) && params[0] === good ? [{ id: "u1", email: "j@test.es", name: "J", meta: {} }] : []);
  global.fetch = async () => { const enc = new TextEncoder(); return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode("data: {\"type\":\"message_stop\"}\n\n")); c.close(); } }) }; };
  r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "secreto" }), r); assert.equal(r.statusCode, 401); assert.match(r.chunks.join(""), /no_session/); ok++;
  r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "secreto", authorization: "Bearer mala" }), r); assert.equal(r.statusCode, 401); assert.match(r.chunks.join(""), /no_session/); ok++;
  r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "mal", authorization: "Bearer buena" }), r); assert.equal(r.statusCode, 401); assert.match(r.chunks.join(""), /bad_code/); ok++;
  r = res(); await handler(req({ messages: msgs }, { "x-repaso-code": "secreto", authorization: "Bearer buena" }), r); assert.equal(r.statusCode, 200); ok++;

  const A = require("../lib/auth.js");
  const h = await A.hashPassword("julia1234");
  assert.match(h, /^scrypt\$/); assert.ok(!h.includes("julia1234")); assert.ok(await A.verifyPassword("julia1234", h)); assert.ok(!await A.verifyPassword("julia1235", h)); ok++;
  assert.ok(await A.verifyPassword("Provisional9", "temp$Provisional9")); assert.ok(!await A.verifyPassword("otra", "temp$Provisional9")); assert.ok(!await A.verifyPassword("abc", "temp$abc")); ok++;
  const auth = require("../api/auth.js"), docs = require("../api/docs.js");
  r = res(); await auth(req({ action: "signup", email: "mal", password: "julia1234" }), r); assert.equal(r.statusCode, 400); assert.match(r.chunks.join(""), /invalid_email/); ok++;
  r = res(); await auth(req({ action: "signup", email: "a@b.es", password: "corta" }), r); assert.equal(r.statusCode, 400); assert.match(r.chunks.join(""), /weak_password/); ok++;
  const gd = req({}); gd.method = "GET"; gd.url = "/api/docs"; r = res(); await docs(gd, r); assert.equal(r.statusCode, 401); ok++;
  const pb = req({ path: "../x", data: {} }, { authorization: "Bearer buena" }); pb.url = "/api/docs"; r = res(); await docs(pb, r); assert.equal(r.statusCode, 400); assert.match(r.chunks.join(""), /bad_path/); ok++;
  global.__REPASO_DB__ = async () => { const e = new Error("no existe"); e.code = "42P01"; throw e; };
  r = res(); await auth(req({ action: "login", email: "a@b.es", password: "x" }), r); assert.equal(r.statusCode, 503); assert.match(r.chunks.join(""), /no_table/); ok++;
  delete global.__REPASO_DB__;

  console.log(`${ok}/18 comprobaciones correctas (api)`);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
