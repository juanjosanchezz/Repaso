/* Repaso · conexión a la base de datos (Neon u otro PostgreSQL) para las funciones de api/.
   Usa las variables que añade la integración de Neon en Vercel. */
const URL_VARS = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];
const dbUrl = (env = process.env) => URL_VARS.map(k => env[k]).find(Boolean) || "";

/** Quita parámetros que `pg` no entiende o que harían fallar el certificado (sslmode, channel_binding…). */
function cleanUrl(u) {
  try { const x = new URL(u); ["sslmode", "sslrootcert", "sslcert", "sslkey", "channel_binding", "supa", "pgbouncer"].forEach(k => x.searchParams.delete(k)); return x.toString(); }
  catch { return u; }
}
const isLocal = u => /@(localhost|127\.0\.0\.1)[:/]/.test(u);

let pool = null;
/** Ejecuta una consulta con parámetros ($1, $2…) y devuelve las filas. */
async function query(text, params = []) {
  if (global.__REPASO_DB__) return global.__REPASO_DB__(text, params);   // pruebas
  if (!pool) {
    const { Pool } = require("pg");
    const url = dbUrl();
    pool = new Pool({ connectionString: cleanUrl(url), ssl: isLocal(url) ? false : { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  }
  return (await pool.query(text, params)).rows;
}
const enabled = () => !!(global.__REPASO_DB__ || dbUrl());

module.exports = { query, enabled, dbUrl, cleanUrl, isLocal, URL_VARS };
