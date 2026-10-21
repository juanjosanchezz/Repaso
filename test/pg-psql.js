/* Solo para pruebas: ejecuta las consultas de lib/db.js en un PostgreSQL real con `psql`
   (sin la librería pg, que no siempre se puede instalar). Mete los parámetros como literales
   escapados y devuelve las filas como JSON. Uso: global.__REPASO_DB__ = psqlQuery(opciones). */
const { execFileSync } = require("child_process");

const lit = v => v === null || v === undefined ? "NULL" : typeof v === "boolean" ? String(v) : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

function psqlQuery({ host = "/tmp", port = "55432", user = "postgres", db = "postgres" } = {}) {
  return async (text, params = []) => {
    const sql = text.replace(/\$(\d+)/g, (_, i) => lit(params[i - 1])).trim().replace(/;$/, "");
    const lower = sql.toLowerCase();
    const wrapped = lower.startsWith("select") ? `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`
      : /\breturning\b/.test(lower) ? `with t as (${sql}) select coalesce(json_agg(t), '[]'::json) from t`
      : sql;
    let out;
    try { out = execFileSync("psql", ["-h", host, "-p", port, "-U", user, "-d", db, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", wrapped], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { const m = /ERROR:\s+([0-9A-Z]{5}):\s*(.*)/.exec(e.stderr || ""); const x = new Error(m ? m[2] : e.stderr); x.code = m?.[1]; throw x; }
    return wrapped === sql ? [] : JSON.parse(out.trim() || "[]");
  };
}
module.exports = { psqlQuery };
