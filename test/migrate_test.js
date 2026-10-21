/* Prueba de scripts/migrate.js sin red: un `pg` simulado. (El SQL se prueba de verdad en test/web_accounts.py.) */
const assert = require("assert");
const { migrate } = require("../scripts/migrate.js");
const { cleanUrl } = require("../lib/db.js");
let ok = 0;
const fakePg = (failHosts = []) => { const log = []; return { log, Client: class { constructor(o) { this.o = o; log.push(o); } async connect() { if (failHosts.some(h => this.o.connectionString.includes(h))) throw new Error("ECONNREFUSED"); } async query(sql) { this.sql = sql; log.sql = sql; } async end() {} } }; };
(async () => {
  console.log = console.warn = () => {};
  let pg;
  assert.equal(await migrate({}, fakePg()), "skipped"); ok++;
  const SBE = {};
  pg = fakePg();
  assert.equal(await migrate({ DATABASE_URL: "postgres://u:p@ep-x-pooler.neon.tech/db?sslmode=require&channel_binding=require", DATABASE_URL_UNPOOLED: "postgres://u:p@ep-x.neon.tech/db?sslmode=require" }, pg), "ok");
  assert.equal(pg.log[0].connectionString, "postgres://u:p@ep-x.neon.tech/db"); assert.equal(pg.log.length, 1); ok++;
  pg = fakePg();
  assert.equal(await migrate({ ...SBE, POSTGRES_URL: "postgres://u:p@h.supabase.com:6543/postgres?sslmode=require" }, pg), "ok");
  assert.equal(pg.log[0].connectionString, "postgres://u:p@h.supabase.com:6543/postgres"); assert.deepEqual(pg.log[0].ssl, { rejectUnauthorized: false });
  assert.match(pg.log.sql, /create table if not exists rp_docs/); assert.match(pg.log.sql, /create table if not exists rp_users/); ok++;
  pg = fakePg(["primero"]);
  assert.equal(await migrate({ ...SBE, POSTGRES_URL_NON_POOLING: "postgres://u:p@primero:5432/db", POSTGRES_URL: "postgres://u:p@segundo:6543/db" }, pg), "ok");
  assert.equal(pg.log.length, 2); ok++;
  assert.equal(await migrate({ ...SBE, POSTGRES_URL: "postgres://u:p@primero:5432/db" }, fakePg(["primero"])), "failed"); ok++;
  pg = fakePg(); await migrate({ ...SBE, POSTGRES_URL: "postgres://u:p@localhost:5432/db" }, pg); assert.equal(pg.log[0].ssl, false); ok++;
  assert.equal(cleanUrl("no es url"), "no es url"); ok++;
  process.stdout.write(`${ok}/7 comprobaciones correctas (migración)\n`);
})().catch(e => { process.stderr.write("FAIL " + (e.stack || e) + "\n"); process.exit(1); });
