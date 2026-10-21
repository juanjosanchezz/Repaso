/* Repaso · cuentas: contraseñas con scrypt y sesiones con token opaco (en la base de datos
   solo se guarda su hash). Lo usan api/auth.js, api/docs.js y api/claude.js. */
const crypto = require("crypto");
const { query } = require("./db.js");
const { bearer } = require("./http.js");

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PW_MIN = 8, PW_MAX = 200, SESSION_DAYS = 180;

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await scrypt(pw, salt)).toString("base64")}`;
}
/** Contraseña provisional puesta a mano desde el editor SQL de Neon (ver README):
    pass_hash = 'temp$<contraseña>'. Vale una vez y se guarda cifrada al entrar. */
const isTemp = stored => String(stored || "").startsWith("temp$");
function verifyTemp(pw, stored) {
  const want = Buffer.from(String(stored).slice(5)), got = Buffer.from(String(pw));
  return want.length >= 6 && want.length === got.length && crypto.timingSafeEqual(want, got);
}
async function verifyPassword(pw, stored) {
  if (isTemp(stored)) return verifyTemp(pw, stored);
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64"), got = await scrypt(pw, Buffer.from(salt, "base64"));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const normEmail = e => String(e || "").trim().toLowerCase();
const emailOK = e => e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const pwOK = p => typeof p === "string" && p.length >= PW_MIN && p.length <= PW_MAX;

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await query("insert into rp_sessions (token_hash, user_id) values ($1, $2)", [sha(token), userId]);
  return token;
}
/** Usuaria de la sesión de la petición (Authorization: Bearer …) o null. */
async function userFromReq(req) {
  const t = bearer(req);
  if (!t || t.length > 200) return null;
  const rows = await query(
    `update rp_sessions s set last_used = now() from rp_users u
      where s.token_hash = $1 and u.id = s.user_id and s.last_used > now() - interval '${SESSION_DAYS} days'
      returning u.id, u.email, u.name, u.meta`, [sha(t)]);
  return rows[0] || null;
}
const publicUser = u => ({ id: u.id, email: u.email, name: u.name || "", meta: u.meta || {} });

module.exports = { hashPassword, verifyPassword, isTemp, createSession, userFromReq, publicUser, sha, normEmail, emailOK, pwOK, PW_MIN };
