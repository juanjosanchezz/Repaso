/* Repaso · ayudas de servidor para Supabase (las usan las funciones de api/).
   Lee la configuración de las variables que crea la integración de Supabase en
   Vercel (o las que pongas a mano). */
const env = (...names) => names.map(n => process.env[n]).find(Boolean) || "";

function config() {
  const url = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const anon = env("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const service = env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
  return { url, anon, service, enabled: !!(url && anon) };
}
const keyHeaders = key => (/^eyJ/.test(key) ? { apikey: key, authorization: "Bearer " + key } : { apikey: key });

const cache = new Map();
/** Comprueba el token de sesión con Supabase. Devuelve {id, email} o null. */
async function verifyUser(token) {
  const c = config();
  if (!c.enabled || !token) return null;
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  let r;
  try { r = await fetch(c.url + "/auth/v1/user", { headers: { apikey: c.anon, authorization: "Bearer " + token } }); }
  catch { throw new Error("supabase_unreachable"); }
  if (!r.ok) { cache.delete(token); return null; }
  const u = await r.json().catch(() => null);
  if (!u?.id) return null;
  const user = { id: u.id, email: u.email || "" };
  if (cache.size > 500) cache.clear();
  cache.set(token, { user, until: Date.now() + 120000 });
  return user;
}
const bearer = req => { const h = req.headers["authorization"] || ""; return /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() || ""; };

module.exports = { config, verifyUser, bearer, keyHeaders };
