/* Repaso · utilidades comunes de las funciones de api/. */
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8") || "{}");
  const chunks = []; for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
const bearer = req => { const h = req.headers["authorization"] || ""; return /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() || ""; };
module.exports = { send, readBody, bearer };
