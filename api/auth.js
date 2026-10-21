/* Repaso · cuentas de la versión web (Neon).
   GET  /api/auth                       → {user} de la sesión (Authorization: Bearer …)
   POST /api/auth {action:"signup", email, password, name}   → {token, user}
   POST /api/auth {action:"login", email, password}          → {token, user}
   POST /api/auth {action:"logout"}                          cierra esta sesión
   POST /api/auth {action:"password", password}              cambia la contraseña y cierra las demás sesiones
   POST /api/auth {action:"meta", data:{…}}                  datos pequeños de la cuenta (p. ej. el código de acceso)
   POST /api/auth {action:"delete"}                          borra la cuenta y todos sus datos */
const { query, enabled } = require("../lib/db.js");
const { send, readBody, bearer } = require("../lib/http.js");
const A = require("../lib/auth.js");

module.exports = async function handler(req, res) {
  if (!enabled()) return send(res, 404, { error: "accounts_disabled" });
  try {
    if (req.method === "GET") {
      const u = await A.userFromReq(req);
      return u ? send(res, 200, { user: A.publicUser(u) }) : send(res, 401, { error: "no_session" });
    }
    if (req.method !== "POST") { res.setHeader("allow", "GET, POST"); return send(res, 405, { error: "method_not_allowed" }); }
    let b; try { b = await readBody(req); } catch { return send(res, 400, { error: "bad_json" }); }
    const action = b?.action;

    if (action === "signup") {
      const email = A.normEmail(b.email), password = b.password, name = String(b.name || "").trim().slice(0, 60);
      if (!A.emailOK(email)) return send(res, 400, { error: "invalid_email" });
      if (!A.pwOK(password)) return send(res, 400, { error: "weak_password" });
      const hash = await A.hashPassword(password);
      let rows;
      try { rows = await query("insert into rp_users (email, pass_hash, name) values ($1, $2, $3) returning id, email, name, meta", [email, hash, name]); }
      catch (e) { if (e?.code === "23505") return send(res, 409, { error: "exists" }); throw e; }
      return send(res, 200, { token: await A.createSession(rows[0].id), user: A.publicUser(rows[0]) });
    }
    if (action === "login") {
      const email = A.normEmail(b.email), password = String(b.password || "");
      const rows = await query("select id, email, name, meta, pass_hash from rp_users where email = $1", [email]);
      const ok = rows[0] ? await A.verifyPassword(password, rows[0].pass_hash) : (await A.hashPassword(password), false); // mismo tiempo exista o no
      if (!ok) return send(res, 401, { error: "invalid_credentials" });
      if (A.isTemp(rows[0].pass_hash)) await query("update rp_users set pass_hash = $2 where id = $1", [rows[0].id, await A.hashPassword(password)]);
      return send(res, 200, { token: await A.createSession(rows[0].id), user: A.publicUser(rows[0]) });
    }

    const u = await A.userFromReq(req);
    if (!u) return send(res, 401, { error: "no_session" });
    if (action === "logout") {
      await query("delete from rp_sessions where token_hash = $1", [A.sha(bearer(req))]);
      return send(res, 200, { ok: true });
    }
    if (action === "password") {
      if (!A.pwOK(b.password)) return send(res, 400, { error: "weak_password" });
      const cur = await query("select pass_hash from rp_users where id = $1", [u.id]);
      if (cur[0] && await A.verifyPassword(b.password, cur[0].pass_hash)) return send(res, 400, { error: "same_password" });
      await query("update rp_users set pass_hash = $2 where id = $1", [u.id, await A.hashPassword(b.password)]);
      await query("delete from rp_sessions where user_id = $1 and token_hash <> $2", [u.id, A.sha(bearer(req))]);
      return send(res, 200, { ok: true });
    }
    if (action === "meta") {
      const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : null;
      if (!data || JSON.stringify(data).length > 2000) return send(res, 400, { error: "bad_meta" });
      const rows = await query("update rp_users set meta = meta || $2::jsonb where id = $1 returning id, email, name, meta", [u.id, JSON.stringify(data)]);
      return send(res, 200, { user: A.publicUser(rows[0]) });
    }
    if (action === "delete") {
      await query("delete from rp_users where id = $1", [u.id]);   // sesiones y documentos se borran en cascada
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "bad_action" });
  } catch (e) {
    if (e?.code === "42P01") return send(res, 503, { error: "no_table" });
    console.error("api/auth", e);
    return send(res, 500, { error: "server_error" });
  }
};
