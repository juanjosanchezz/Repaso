/* Repaso · borrar la cuenta (versión web con Supabase).
   DELETE /api/account con la sesión de la usuaria. Borra su usuario de Supabase Auth
   y, en cascada, todas sus filas de repaso_docs (ver supabase/schema.sql).
   Necesita SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEY), que nunca sale del servidor. */
const { config, verifyUser, bearer, keyHeaders } = require("../lib/supabase.js");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "DELETE") { res.setHeader("allow", "DELETE"); return send(res, 405, { error: "method_not_allowed" }); }
  const c = config();
  if (!c.enabled) return send(res, 404, { error: "accounts_disabled" });
  let user;
  try { user = await verifyUser(bearer(req)); } catch { return send(res, 502, { error: "supabase_unreachable" }); }
  if (!user) return send(res, 401, { error: "no_session" });
  if (!c.service) return send(res, 501, { error: "missing_service_key" });
  let r;
  try { r = await fetch(`${c.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers: keyHeaders(c.service) }); }
  catch { return send(res, 502, { error: "supabase_unreachable" }); }
  if (!r.ok) return send(res, 502, { error: "delete_failed", detail: (await r.text().catch(() => "")).slice(0, 300) });
  return send(res, 200, { ok: true });
};
