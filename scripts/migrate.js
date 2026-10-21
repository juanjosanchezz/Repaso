/* Prepara la base de datos de Supabase en cada despliegue: aplica supabase/schema.sql
   (se puede ejecutar las veces que haga falta). Usa la conexión que añade la integración
   de Supabase en Vercel (POSTGRES_URL_NON_POOLING o POSTGRES_URL).

   Nunca rompe el despliegue: si no hay base de datos, no hace nada; si falla, lo explica
   en el registro del build y la app avisa de que falta preparar la base de datos. */
const fs = require("fs");
const path = require("path");

const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "schema.sql"), "utf8");

/** Quita sslmode de la URL: Supabase usa un certificado propio y `pg` lo rechazaría con sslmode=require. */
function cleanUrl(u) {
  try { const x = new URL(u); ["sslmode", "sslrootcert", "sslcert", "sslkey", "supa"].forEach(k => x.searchParams.delete(k)); return x.toString(); }
  catch { return u; }
}

async function migrate(env = process.env, pg) {
  const urls = [env.POSTGRES_URL_NON_POOLING, env.POSTGRES_URL, env.DATABASE_URL].filter(Boolean);
  if (!urls.length) { console.log("Base de datos: no hay POSTGRES_URL; me lo salto."); return "skipped"; }
  try { pg = pg || require("pg"); }
  catch { console.warn("Base de datos: falta la librería pg (npm install). Aplica supabase/schema.sql a mano."); return "no_pg"; }
  let last;
  for (const url of urls) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const client = new pg.Client({ connectionString: cleanUrl(url), ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      await client.query(SQL);
      console.log("Base de datos: tabla repaso_docs lista.");
      return "ok";
    } catch (e) { last = e; }
    finally { await client.end().catch(() => {}); }
  }
  console.warn("Base de datos: no se pudo preparar (" + (last?.message || last) + "). La app avisará; puedes pegar supabase/schema.sql en Supabase → SQL Editor.");
  return "failed";
}

module.exports = { migrate, cleanUrl };
if (require.main === module) migrate().then(() => process.exit(0), e => { console.warn(e); process.exit(0); });
