/* Prepara la base de datos en cada despliegue: aplica db/schema.sql (se puede ejecutar
   las veces que haga falta). Usa la conexión que añade la integración de Neon en Vercel
   (DATABASE_URL_UNPOOLED, DATABASE_URL, POSTGRES_URL…).

   Nunca rompe el despliegue: si no hay base de datos, no hace nada; si falla, lo explica
   en el registro del build y la app avisa de que falta preparar la base de datos. */
const fs = require("fs");
const path = require("path");
const { cleanUrl, isLocal } = require("../lib/db.js");

const SQL = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");

async function migrate(env = process.env, pg) {
  // Para cambios de tablas, mejor la conexión directa (sin pooler) si existe.
  const urls = [...new Set([env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL, env.POSTGRES_URL].filter(Boolean))];
  if (!urls.length) { console.log("Base de datos: no hay DATABASE_URL; las cuentas quedan desactivadas."); return "skipped"; }
  try { pg = pg || require("pg"); }
  catch { console.warn("Base de datos: falta la librería pg (npm install). Aplica db/schema.sql a mano."); return "no_pg"; }
  let last;
  for (const url of urls) {
    const client = new pg.Client({ connectionString: cleanUrl(url), ssl: isLocal(url) ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      await client.query(SQL);
      console.log("Base de datos: tablas de Repaso listas.");
      return "ok";
    } catch (e) { last = e; }
    finally { await client.end().catch(() => {}); }
  }
  console.warn("Base de datos: no se pudo preparar (" + (last?.message || last) + "). Las cuentas no funcionarán hasta que se arregle.");
  return "failed";
}

module.exports = { migrate };
if (require.main === module) migrate().then(() => process.exit(0), e => { console.warn(e); process.exit(0); });
