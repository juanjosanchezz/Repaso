/* Repaso · documentos de la cuenta (versión web con Neon). Solo los de la usuaria de la sesión.
   GET  /api/docs?offset=&limit=           → {rows:[{path,data,updated_at}]} documentos vivos, por ruta
   GET  /api/docs?since=ISO&limit=         → {rows:[{path,data,deleted,updated_at}]} cambios desde esa hora
   POST /api/docs {path, data, deleted}     → guarda (o marca como borrado) un documento */
const { query, enabled } = require("../lib/db.js");
const { send, readBody } = require("../lib/http.js");
const { userFromReq } = require("../lib/auth.js");

const PATH = /^[A-Za-z0-9_\-.~:@+]{1,200}(\/[A-Za-z0-9_\-.~:@+]{1,200}){0,8}$/;
const TS = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const MAX_DOC = 300 * 1024;

module.exports = async function handler(req, res) {
  if (!enabled()) return send(res, 404, { error: "accounts_disabled" });
  try {
    const u = await userFromReq(req);
    if (!u) return send(res, 401, { error: "no_session" });
    if (req.method === "GET") {
      const url = new URL(req.url, "http://x");
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 1000, 1), 1000);
      const offset = Math.max(parseInt(url.searchParams.get("offset"), 10) || 0, 0);
      const since = url.searchParams.get("since");
      if (since) {
        if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(since)) return send(res, 400, { error: "bad_since" });
        const rows = await query(`select path, data, deleted, ${TS} as updated_at from rp_docs where user_id = $1 and updated_at > $2::timestamptz order by updated_at, path limit $3 offset $4`, [u.id, since, limit, offset]);
        return send(res, 200, { rows });
      }
      const rows = await query(`select path, data, ${TS} as updated_at from rp_docs where user_id = $1 and not deleted order by path limit $2 offset $3`, [u.id, limit, offset]);
      return send(res, 200, { rows });
    }
    if (req.method === "POST") {
      let b; try { b = await readBody(req); } catch { return send(res, 400, { error: "bad_json" }); }
      const path = String(b?.path || ""), deleted = b?.deleted === true;
      if (!PATH.test(path) || path.length > 600 || path.split("/").some(x => x === "." || x === "..")) return send(res, 400, { error: "bad_path" });
      const data = deleted ? null : b?.data;
      if (!deleted && (!data || typeof data !== "object" || Array.isArray(data))) return send(res, 400, { error: "bad_data" });
      const json = data === null ? null : JSON.stringify(data);
      if (json && Buffer.byteLength(json) > MAX_DOC) return send(res, 413, { error: "too_big" });
      await query(`insert into rp_docs (user_id, path, data, deleted) values ($1, $2, $3::jsonb, $4)
                   on conflict (user_id, path) do update set data = excluded.data, deleted = excluded.deleted`, [u.id, path, json, deleted]);
      return send(res, 200, { ok: true });
    }
    res.setHeader("allow", "GET, POST");
    return send(res, 405, { error: "method_not_allowed" });
  } catch (e) {
    if (e?.code === "42P01") return send(res, 503, { error: "no_table" });
    console.error("api/docs", e);
    return send(res, 500, { error: "server_error" });
  }
};
