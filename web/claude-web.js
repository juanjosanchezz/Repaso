/* Repaso · versión web (Vercel)
   ─────────────────────────────────────────────────────────────────────
   Implementa en el navegador la misma interfaz `window.claude.use(name)` que
   Repaso usa dentro de Claude, para que src/repaso.html funcione en una web normal:

   - account    Cuentas de verdad (email y contraseña) con Supabase Auth.
                Solo existe si hay Supabase configurado (window.__REPASO_CONFIG__).
   - db         Base de datos de documentos. Con Supabase: tabla `repaso_docs`
                (una fila por documento, solo visible para su dueña) con copia en
                memoria y sincronización entre dispositivos. Sin Supabase: IndexedDB
                de este navegador.
   - user       Identidad: la cuenta de Supabase o, sin Supabase, este navegador.
   - sample     Claude a través de /api/claude (función de Vercel con tu API key),
                con streaming, imágenes, JSON y herramientas.
   - downloads  Descarga normal de archivos.
   - mcp        No disponible en la web (Google Calendar solo funciona dentro de Claude).

   Se inserta antes de la app en dist/index.html (scripts/build-web.js), que
   también escribe window.__REPASO_CONFIG__ con la URL y la clave pública de Supabase. */
(() => {
  "use strict";
  window.__REPASO_WEB__ = true;
  const CFG = window.__REPASO_CONFIG__ || {};
  const SB = CFG.supabaseUrl && CFG.supabaseKey ? { url: String(CFG.supabaseUrl).replace(/\/+$/, ""), key: String(CFG.supabaseKey) } : null;
  const TABLE = "repaso_docs";

  const err = (code, message) => ({ code, message });
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const rid = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");

  /* ── db: núcleo en memoria (consultas y avisos) ─────────────────── */
  const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  const segs = p => p.split("/");
  const clone = o => JSON.parse(JSON.stringify(o));
  const tick = v => new Promise(r => setTimeout(() => r(v), 0));
  const store = new Map();
  const listeners = new Set();

  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
  }
  function checkPath(p, wantDoc) {
    const s = segs(p);
    if (!s.every(x => SEG.test(x) && x !== "." && x !== "..")) throw new TypeError("Ruta no válida: " + p);
    if ((s.length % 2 === 0) !== wantDoc) throw new TypeError(`Ruta con ${s.length} segmentos: ${p}`);
  }
  const snapDoc = path => { const d = store.get(path); return { id: segs(path).at(-1), exists: d !== undefined, data: () => (d === undefined ? undefined : clone(d)), metadata: { fromCache: false, hasPendingWrites: false } }; };
  function runQuery(q) {
    const depth = segs(q.path).length + 1, pre = q.path + "/";
    let docs = [...store.keys()].filter(k => k.startsWith(pre) && segs(k).length === depth).map(k => ({ k, d: store.get(k) }));
    for (const [f, op, v] of q.filters) docs = docs.filter(({ d }) => {
      const x = d[f];
      switch (op) {
        case "==": return x === v; case "!=": return x !== v; case "<": return x < v; case "<=": return x <= v; case ">": return x > v; case ">=": return x >= v;
        case "in": return v.includes(x); case "not-in": return !v.includes(x); case "array-contains": return Array.isArray(x) && x.includes(v);
        default: throw err("invalid_argument", "Operador no válido: " + op);
      }
    });
    if (q.order) { const [f, dir] = q.order; docs.sort((a, b) => { const x = a.d[f], y = b.d[f]; if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); }); }
    else docs.sort((a, b) => (a.k < b.k ? -1 : 1));
    if (q.lim) docs = docs.slice(0, q.lim);
    const ds = docs.map(({ k }) => snapDoc(k));
    return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  let notifyT = null;
  const notify = () => { clearTimeout(notifyT); notifyT = setTimeout(() => { for (const l of [...listeners]) { try { l.next(l.kind === "doc" ? snapDoc(l.path) : runQuery(l)); } catch (e) { console.error(e); } } }, 0); };
  const tooBig = o => new Blob([JSON.stringify(o)]).size > 262144;
  function deepMerge(a, b) { const o = { ...a }; for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) o[k] = deepMerge(o[k], v); else o[k] = v; } return o; }

  /* ── db: guardado local (sin Supabase) ──────────────────────────── */
  const IDB = { name: "repaso-web", store: "docs", db: null };
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB.store);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbLoad() {
    try {
      IDB.db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = IDB.db.transaction(IDB.store, "readonly"), os = tx.objectStore(IDB.store);
        const keys = os.getAllKeys(), vals = os.getAll();
        tx.oncomplete = () => { keys.result.forEach((k, i) => store.set(k, vals.result[i])); res(); };
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { console.warn("Repaso: no se puede usar IndexedDB; los datos solo durarán esta sesión.", e); IDB.db = null; }
  }
  function idbPut(path, doc) {
    if (!IDB.db) return;
    try { const tx = IDB.db.transaction(IDB.store, "readwrite"); doc === undefined ? tx.objectStore(IDB.store).delete(path) : tx.objectStore(IDB.store).put(doc, path); }
    catch (e) { console.warn("Repaso: no se pudo guardar", e); }
  }

  /* ── Supabase: sesión y peticiones ──────────────────────────────── */
  const SKEY = "repaso.sb.session";
  const Cloud = { session: null, since: null, pulling: false, timer: null };
  const changeCbs = new Set();
  const isJwt = k => /^eyJ/.test(k);

  const AUTH_CODES = {
    invalid_credentials: "invalid_credentials", invalid_grant: "invalid_credentials",
    email_not_confirmed: "not_confirmed", user_already_exists: "exists", email_exists: "exists",
    weak_password: "weak_password", same_password: "same_password",
    email_address_invalid: "invalid_email", validation_failed: "invalid_email", email_address_not_authorized: "invalid_email",
    over_email_send_rate_limit: "rate_limited", over_request_rate_limit: "rate_limited", over_sms_send_rate_limit: "rate_limited",
    signup_disabled: "signup_disabled", email_provider_disabled: "signup_disabled",
    refresh_token_not_found: "unauthorized", refresh_token_already_used: "unauthorized", session_not_found: "unauthorized", bad_jwt: "unauthorized", user_not_found: "unauthorized",
  };
  function sbError(status, j) {
    const raw = j?.error_code || (typeof j?.code === "string" ? j.code : "") || j?.error || "";
    const msg = j?.msg || j?.message || j?.error_description || "";
    let code = AUTH_CODES[raw];
    if (!code && /already (been )?registered|already exists/i.test(msg)) code = "exists";
    if (!code && /invalid login/i.test(msg)) code = "invalid_credentials";
    if (!code && /not confirmed/i.test(msg)) code = "not_confirmed";
    if (!code && /password/i.test(msg) && (status === 400 || status === 422)) code = "weak_password";
    if (!code && /email/i.test(msg) && (status === 400 || status === 422)) code = "invalid_email";
    if (!code && status === 429) code = "rate_limited";
    if (!code && (status === 401 || status === 403 || raw === "PGRST301" || raw === "PGRST303")) code = "unauthorized";
    if (!code && raw === "42P01") code = "no_table";
    if (!code && status === 404 && /relation|table|schema cache/i.test(msg)) code = "no_table";
    return { code: code || "unavailable", message: msg || "Error " + status, status };
  }
  async function sbFetch(path, { method = "GET", body, token, headers = {} } = {}) {
    const h = { apikey: SB.key, ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    if (token) h.authorization = "Bearer " + token; else if (isJwt(SB.key)) h.authorization = "Bearer " + SB.key;
    let r;
    try { r = await fetch(SB.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw err("unavailable", "Sin conexión con la base de datos"); }
    const text = await r.text().catch(() => "");
    let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) throw sbError(r.status, j);
    return j;
  }
  function setSession(j, user) {
    const u = user || j.user;
    if (!j?.access_token || !u?.id) throw err("unavailable", "Respuesta de sesión incompleta");
    Cloud.session = {
      access_token: j.access_token, refresh_token: j.refresh_token || Cloud.session?.refresh_token || "",
      expires_at: Number(j.expires_at) || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
      user: { id: u.id, email: u.email || "", meta: u.user_metadata || {} },
    };
    ls.set(SKEY, JSON.stringify(Cloud.session));
  }
  function readSession() {
    try { const s = JSON.parse(ls.get(SKEY) || "null"); return s?.access_token && s?.user?.id ? s : null; } catch { return null; }
  }
  function dropSession() {
    Cloud.session = null; Cloud.since = null; ls.del(SKEY); ls.del("repaso.web.code");
    clearInterval(Cloud.timer); Cloud.timer = null;
    store.clear(); notify();
  }
  /** La sesión ya no vale (contraseña cambiada en otro sitio, cuenta borrada…). */
  function expire() { if (!Cloud.session) return; dropSession(); for (const f of [...changeCbs]) { try { f(null); } catch (e) { console.error(e); } } }

  let refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const j = await sbFetch("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: Cloud.session?.refresh_token || "" } });
        setSession(j); return Cloud.session;
      } catch (e) {
        if (e.code !== "unavailable" && e.code !== "rate_limited") expire();
        throw e.code === "unavailable" || e.code === "rate_limited" ? e : err("unauthorized", "Tu sesión ha caducado");
      } finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function accessToken() {
    if (!Cloud.session) throw err("unauthorized", "No hay sesión");
    if (Cloud.session.expires_at * 1000 - Date.now() > 60000) return Cloud.session.access_token;
    return (await refresh()).access_token;
  }
  async function rest(path, opts = {}, retry = true) {
    try { return await sbFetch("/rest/v1/" + path, { ...opts, token: await accessToken() }); }
    catch (e) { if (e.code === "unauthorized" && retry && Cloud.session) { await refresh(); return rest(path, opts, false); } throw e; }
  }

  /* ── db: guardado en Supabase ───────────────────────────────────── */
  const prefix = () => `data/users/${Cloud.session.user.id}/`;
  async function loadAll() {
    const pre = prefix(), rows = [];
    for (let off = 0; ; off += 1000) {
      const page = await rest(`${TABLE}?select=path,data,updated_at&deleted=is.false&order=path.asc&limit=1000&offset=${off}`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    store.clear(); Cloud.since = null;
    for (const r of rows) { store.set(pre + r.path, r.data); if (!Cloud.since || r.updated_at > Cloud.since) Cloud.since = r.updated_at; }
    notify();
  }
  /** Trae lo que ha cambiado en otros dispositivos desde la última vez. */
  async function pull() {
    if (!Cloud.session || Cloud.pulling) return;
    Cloud.pulling = true;
    try {
      const pre = prefix(); let changed = false;
      for (let n = 0; n < 20; n++) {
        const rows = await rest(`${TABLE}?select=path,data,deleted,updated_at&order=updated_at.asc&limit=1000` + (Cloud.since ? `&updated_at=gt.${encodeURIComponent(Cloud.since)}` : ""));
        for (const r of rows) {
          Cloud.since = r.updated_at;
          const k = pre + r.path; if (pending.has(k)) continue;
          if (r.deleted) { if (store.has(k)) { store.delete(k); changed = true; } }
          else if (!same(store.get(k), r.data)) { store.set(k, r.data); changed = true; }
        }
        if (rows.length < 1000) break;
      }
      if (changed) notify();
    } catch { /* sin conexión: se vuelve a intentar en la próxima vuelta */ }
    finally { Cloud.pulling = false; }
  }
  function startSync() {
    clearInterval(Cloud.timer);
    Cloud.timer = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 20000);
  }
  if (SB) {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
    window.addEventListener("online", () => pull());
  }
  async function cloudPut(path, doc) {
    if (!Cloud.session) throw err("unauthorized", "No hay sesión");
    const pre = prefix();
    if (!path.startsWith(pre)) throw err("invalid_argument", "Ruta fuera de tu cuenta: " + path);
    await rest(`${TABLE}?on_conflict=user_id,path`, {
      method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: { user_id: Cloud.session.user.id, path: path.slice(pre.length), data: doc === undefined ? null : doc, deleted: doc === undefined },
    });
  }

  /* ── db: escritura (local o en la nube) ─────────────────────────── */
  const pending = new Map();
  function persist(path, doc) {
    if (!SB) { idbPut(path, doc); return Promise.resolve(); }
    const prev = pending.get(path) || Promise.resolve();
    const p = prev.catch(() => {}).then(() => cloudPut(path, doc));
    pending.set(path, p);
    p.then(() => {}, () => {}).then(() => { if (pending.get(path) === p) pending.delete(path); });
    return p;
  }
  async function write(path, doc) {
    const had = store.has(path), before = store.get(path);
    if (doc === undefined) store.delete(path); else store.set(path, doc);
    notify();
    try { await persist(path, doc); }
    catch (e) {
      if (store.get(path) === doc) { if (had) store.set(path, before); else store.delete(path); notify(); }
      if (e?.code === "unauthorized") throw err("unauthorized", "Tu sesión ha caducado. Vuelve a entrar.");
      throw e?.code === "invalid_argument" ? e : err("unavailable", "No se pudo guardar en tu cuenta");
    }
  }

  function docRef(path) {
    checkPath(path, true);
    return {
      id: segs(path).at(-1), path,
      get: () => tick(snapDoc(path)),
      set: async d => { if (!d || typeof d !== "object" || Array.isArray(d)) throw err("invalid_argument", "El documento tiene que ser un objeto"); const c = clone(d); if (tooBig(c)) throw err("invalid_argument", "Documento de más de 256 KiB"); await write(path, c); await tick(); },
      update: async d => { if (!store.has(path)) throw err("invalid_argument", "No existe el documento " + path); const m = deepMerge(store.get(path), clone(d)); if (tooBig(m)) throw err("invalid_argument", "Documento de más de 256 KiB"); await write(path, m); await tick(); },
      delete: async () => { if (SB && !store.has(path)) return; await write(path, undefined); await tick(); },
      acquire: async () => ({ acquired: true }),
      onSnapshot: next => { const l = { kind: "doc", path, next }; listeners.add(l); setTimeout(() => listeners.has(l) && next(snapDoc(path)), 0); return () => listeners.delete(l); },
      collection: sub => colRef(path + "/" + sub),
    };
  }
  function query(path, filters = [], order = null, lim = null) {
    const q = { path, filters, order, lim };
    return {
      where: (f, op, v) => query(path, [...filters, [f, op, v]], order, lim),
      orderBy: (f, d = "asc") => query(path, filters, [f, d], lim),
      limit: n => query(path, filters, order, n),
      get: async () => { await tick(); return runQuery(q); },
      onSnapshot: next => { const l = { kind: "query", ...q, next }; listeners.add(l); setTimeout(() => listeners.has(l) && next(runQuery(q)), 0); return () => listeners.delete(l); },
    };
  }
  function colRef(path) { checkPath(path, false); return { ...query(path), path, doc: id => docRef(path + "/" + (id || rid())), add: async d => { const r = docRef(path + "/" + rid()); await r.set(d); return r; } }; }
  const db = { doc: docRef, collection: colRef };

  /* ── account: cuentas con Supabase Auth ─────────────────────────── */
  const backTo = () => location.origin + location.pathname;
  async function afterLogin() {
    const c = Cloud.session.user.meta?.repaso_code;
    if (c) ls.set("repaso.web.code", c);
    await loadAll();
    startSync();
  }
  const account = SB && {
    /** Se resuelve cuando ya se sabe si hay sesión y, si la hay, con sus datos cargados. */
    ready: null,
    /** true si se ha entrado con un enlace de "cambiar contraseña". */
    recovery: false,
    /** Aviso para la pantalla de acceso (enlace caducado, sin conexión…). */
    notice: null,
    session: () => (Cloud.session ? { id: Cloud.session.user.id, email: Cloud.session.user.email } : null),
    async signUp({ email, password, name }) {
      const j = await sbFetch(`/auth/v1/signup?redirect_to=${encodeURIComponent(backTo())}`, { method: "POST", body: { email, password, data: { name: name || "" } } });
      if (j?.access_token) { setSession(j); await afterLogin(); return { status: "signed_in" }; }
      // Con confirmación por correo no hay sesión todavía. Si el email ya tenía cuenta, Supabase
      // devuelve un usuario sin identidades (para no revelar qué correos están registrados).
      if (j && Array.isArray(j.identities) && j.identities.length === 0) throw err("exists", "Ya hay una cuenta con ese email");
      return { status: "confirm" };
    },
    async signIn({ email, password }) {
      const j = await sbFetch("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
      setSession(j); await afterLogin(); return account.session();
    },
    async signOut() {
      const t = Cloud.session?.access_token;
      dropSession();
      // scope=local: cierra solo este dispositivo (por defecto Supabase cerraría todos).
      if (t) await sbFetch("/auth/v1/logout?scope=local", { method: "POST", token: t }).catch(() => {});
    },
    async resend(email) {
      await sbFetch(`/auth/v1/resend?redirect_to=${encodeURIComponent(backTo())}`, { method: "POST", body: { type: "signup", email } });
    },
    async resetPassword(email) {
      await sbFetch(`/auth/v1/recover?redirect_to=${encodeURIComponent(backTo())}`, { method: "POST", body: { email } });
    },
    async updatePassword(password) {
      const j = await sbFetch("/auth/v1/user", { method: "PUT", token: await accessToken(), body: { password } });
      account.recovery = false;
      return !!j;
    },
    /** Borra la cuenta (y, en cascada, todos sus datos) con /api/account. */
    async deleteAccount() {
      let r;
      try { r = await fetch("/api/account", { method: "DELETE", headers: { authorization: "Bearer " + await accessToken() } }); }
      catch { throw err("unavailable", "Sin conexión con el servidor"); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err(j?.error === "missing_service_key" ? "not_configured" : "unavailable", j?.error || "Error " + r.status);
      dropSession();
    },
    onChange(f) { changeCbs.add(f); return () => changeCbs.delete(f); },
  };
  async function initCloud() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const clean = () => { try { history.replaceState(null, "", location.pathname + location.search); } catch {} };
    if (h.get("access_token")) {
      // Vuelve de un enlace del correo (confirmar cuenta o cambiar contraseña).
      try { const u = await sbFetch("/auth/v1/user", { token: h.get("access_token") }); setSession({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_at: h.get("expires_at"), expires_in: h.get("expires_in") }, u); account.recovery = h.get("type") === "recovery"; }
      catch { account.notice = "El enlace no es válido o ha caducado. Inicia sesión o pide otro."; }
      clean();
    } else if (h.get("error") || h.get("error_code") || h.get("error_description")) {
      account.notice = h.get("error_code") === "otp_expired" ? "El enlace ha caducado. Inicia sesión o pide otro." : "El enlace no es válido o ha caducado. Inicia sesión o pide otro.";
      clean();
    } else Cloud.session = readSession();
    if (!Cloud.session) return;
    try { await accessToken(); await afterLogin(); }
    catch (e) {
      if (!Cloud.session) account.notice = "Tu sesión ha caducado. Vuelve a entrar.";
      else { account.notice = e?.code === "no_table" ? "Falta preparar la base de datos (supabase/schema.sql). Avisa a quien publica Repaso." : "No se pudo conectar con tu cuenta. Revisa la conexión y recarga la página."; account.offline = true; }
    }
  }
  if (account) {
    account.ready = initCloud();
    // Un enlace del correo abierto en una pestaña donde Repaso ya estaba abierto solo cambia el #…
    window.addEventListener("hashchange", () => { if (/(^|[#&])(access_token|error_code|error)=/.test(location.hash)) location.reload(); });
  }
  const ready = SB ? account.ready : idbLoad();

  /* ── user ───────────────────────────────────────────────────────── */
  function localId() {
    try { let id = localStorage.getItem("repaso.web.uid"); if (!id) { id = "u_" + rid(22); localStorage.setItem("repaso.web.uid", id); } return id; }
    catch { return window.__repasoTmpId ||= "u_" + rid(22); }
  }
  const user = SB ? {
    id: async () => (account.offline ? null : Cloud.session?.user.id || null),
    me: async () => (Cloud.session ? { id: Cloud.session.user.id, name: Cloud.session.user.meta?.name || "", email: Cloud.session.user.email, isMe: true } : null),
    name: async () => Cloud.session?.user.meta?.name || "",
    can: async () => true, canEdit: async () => true, isOwner: async () => true, profiles: async () => ({}), search: async () => [],
  } : (() => {
    const uid = localId();
    return {
      id: async () => uid, me: async () => ({ id: uid, name: "", email: null, isMe: true }), name: async () => "",
      can: async () => true, canEdit: async () => true, isOwner: async () => true, profiles: async () => ({}), search: async () => [],
    };
  })();

  /* ── sample: Claude vía /api/claude ─────────────────────────────── */
  const ENDPOINT = "/api/claude";
  const getCode = () => ls.get("repaso.web.code") || "";
  let codeToSave = null;
  const setCode = c => { ls.set("repaso.web.code", c); codeToSave = c; };

  let codePrompt = null;
  function askCode(wrong) {
    if (codePrompt) return codePrompt;
    codePrompt = new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.className = "sheet-wrap";
      wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="code-h"><div class="sheet-head"><div><h2 id="code-h">Código de acceso</h2><p class="small muted" style="margin-top:4px">${wrong ? "Ese código no es correcto." : "Para usar Claude en esta versión de Repaso necesitas el código que te dio quien te pasó la app. Solo te lo pedirá una vez."}</p></div></div>
        <form style="display:flex;flex-direction:column;gap:14px"><div class="field"><label for="web-code">Código</label><input class="input" id="web-code" autocomplete="off" required></div>
        <div class="sheet-foot"><button class="btn" type="button" data-x="cancel">Ahora no</button><button class="btn primary" type="submit">Guardar</button></div></form></div>`;
      const done = v => { wrap.remove(); codePrompt = null; resolve(v); };
      wrap.querySelector("form").addEventListener("submit", e => { e.preventDefault(); e.stopPropagation(); const v = wrap.querySelector("#web-code").value.trim(); if (v) { setCode(v); done(true); } });
      wrap.querySelector("[data-x=cancel]").addEventListener("click", e => { e.stopPropagation(); done(false); });
      wrap.addEventListener("click", e => e.stopPropagation());
      document.body.appendChild(wrap);
      setTimeout(() => wrap.querySelector("#web-code")?.focus(), 30);
    });
    return codePrompt;
  }
  /** Guarda el código en la cuenta para no volver a pedirlo en otro dispositivo. */
  function rememberCode() {
    const c = codeToSave; codeToSave = null;
    if (!c || !Cloud.session || Cloud.session.user.meta?.repaso_code === c) return;
    accessToken().then(t => sbFetch("/auth/v1/user", { method: "PUT", token: t, body: { data: { repaso_code: c } } }))
      .then(u => { if (Cloud.session && u?.user_metadata) { Cloud.session.user.meta = u.user_metadata; ls.set(SKEY, JSON.stringify(Cloud.session)); } })
      .catch(() => {});
  }

  async function imageBlock(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { throw err("image_rejected", "No se pudo leer la imagen"); }
    const max = 1568, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] } };
  }
  async function toMessages(input, images) {
    let turns = typeof input === "string" ? [{ role: "user", content: input }] : input.map(t => ({ role: t.role, content: String(t.content) }));
    if (!turns.length || turns[0].role !== "user" || turns.at(-1).role !== "user") throw err("invalid_request", "La conversación tiene que empezar y acabar con un turno de la usuaria");
    const merged = [];
    for (const t of turns) { const last = merged.at(-1); if (last && last.role === t.role) last.content += "\n\n" + t.content; else merged.push({ ...t }); }
    const msgs = merged.map(t => ({ role: t.role, content: [{ type: "text", text: t.content }] }));
    const imgs = images ? (images instanceof Blob ? [images] : [...images]) : [];
    if (imgs.length) msgs.at(-1).content.unshift(...await Promise.all(imgs.slice(0, 5).map(imageBlock)));
    return msgs;
  }
  function httpError(status, body) {
    if (status === 413) return err("prompt_too_large", "Demasiado contenido");
    if (status === 429) return err("rate_limited", "Demasiadas peticiones");
    if (status === 500 && body?.error === "missing_key") return err("sampling_disabled", "Falta ANTHROPIC_API_KEY en el servidor");
    return err("upstream_error", body?.detail || body?.error || "Error " + status);
  }
  /** Una ronda: POST a /api/claude y lectura del stream SSE de la API de Claude. */
  async function round(body, signal, onDelta, retried) {
    const headers = { "content-type": "application/json", "x-repaso-code": getCode() };
    if (Cloud.session) { try { headers.authorization = "Bearer " + await accessToken(); } catch (e) { throw e.code === "unavailable" ? err("upstream_error", "Sin conexión con el servidor") : err("not_granted", "Tu sesión ha caducado. Vuelve a entrar."); } }
    let r;
    try { r = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), signal }); }
    catch (e) { if (e?.name === "AbortError") throw err("cancelled", "Cancelado"); throw err("upstream_error", "Sin conexión con el servidor"); }
    if (r.status === 401) {
      const j = await r.json().catch(() => ({}));
      if (j?.error === "no_session") {
        if (!retried && Cloud.session) { try { await refresh(); return round(body, signal, onDelta, true); } catch {} }
        throw err("not_granted", "Tu sesión ha caducado. Vuelve a entrar.");
      }
      if (!retried && await askCode(!!getCode())) return round(body, signal, onDelta, true);
      throw err("not_granted", "Falta el código de acceso");
    }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw httpError(r.status, j); }
    rememberCode();
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", stop = null; const blocks = [];
    const handle = ev => {
      if (ev.type === "content_block_start") blocks[ev.index] = ev.content_block.type === "tool_use" ? { type: "tool_use", id: ev.content_block.id, name: ev.content_block.name, json: "" } : { type: ev.content_block.type, text: "" };
      else if (ev.type === "content_block_delta") {
        const b = blocks[ev.index]; if (!b) return;
        if (ev.delta.type === "text_delta") { b.text += ev.delta.text; onDelta(ev.delta.text); }
        else if (ev.delta.type === "input_json_delta") b.json += ev.delta.partial_json;
      }
      else if (ev.type === "message_delta") stop = ev.delta?.stop_reason || stop;
      else if (ev.type === "error") throw err(ev.error?.type === "overloaded_error" ? "rate_limited" : "upstream_error", ev.error?.message || "Error de Claude");
    };
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = raw.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
          if (data) handle(JSON.parse(data));
        }
      }
    } catch (e) { if (e?.name === "AbortError") throw err("cancelled", "Cancelado"); throw e?.code ? e : err("upstream_error", "Se cortó la conexión"); }
    const content = blocks.filter(Boolean).map(b => b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: (() => { try { return JSON.parse(b.json || "{}"); } catch { return {}; } })() } : b.type === "text" ? { type: "text", text: b.text } : null).filter(Boolean);
    return { content, stop };
  }
  async function sample(input, opts = {}) {
    if (opts.signal?.aborted) throw err("cancelled", "Cancelado");
    const tier = ["quick", "default", "complex"].includes(opts.modelTier) ? opts.modelTier : "default";
    const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
    const messages = await toMessages(input, opts.images);
    let text = "", truncated = false, newRound = false;
    const emit = d => { if (!d) return; if (newRound && text) { text += "\n\n"; d = "\n\n" + d; } newRound = false; text += d; try { opts.onText?.({ text, delta: d }); } catch (e) { console.error(e); } };
    try {
      for (let n = 0; n < 6; n++) {
        const body = { tier, messages, max_tokens: opts.maxTokens };
        if (tools) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: "object", properties: {} } }));
        const { content, stop } = await round(body, opts.signal, emit);
        truncated = stop === "max_tokens";
        if (stop === "tool_use" && tools) {
          messages.push({ role: "assistant", content });
          const results = [];
          for (const b of content.filter(c => c.type === "tool_use")) {
            const tool = tools.find(t => t.name === b.name);
            try { const out = tool ? await tool.execute(b.input || {}, { signal: opts.signal || new AbortController().signal }) : (() => { throw new Error("Herramienta desconocida"); })(); results.push({ type: "tool_result", tool_use_id: b.id, content: typeof out === "string" ? out : JSON.stringify(out ?? "") }); }
            catch (e) { results.push({ type: "tool_result", tool_use_id: b.id, content: "Error: " + (e?.message || e), is_error: true }); }
          }
          messages.push({ role: "user", content: results });
          newRound = true;
          continue;
        }
        break;
      }
    } catch (e) { if (text && e && typeof e === "object") e.text = text; throw e; }
    if (!text.trim()) throw err("empty_completion", "Claude no ha escrito nada");
    return { text, truncated, modelTierApplied: tier };
  }
  function parseJsonLoose(t) {
    try { return JSON.parse(t); } catch {}
    const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
    const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    return undefined;
  }
  sample.json = async (input, opts = {}) => {
    const note = "\n\n(Tu respuesta se leerá automáticamente como JSON: escribe solo el JSON, sin texto antes ni después.)";
    const inp = typeof input === "string" ? input + note : input.map((t, i, a) => i === a.length - 1 ? { ...t, content: t.content + note } : t);
    const r = await sample(inp, opts);
    const v = r.truncated ? undefined : parseJsonLoose(r.text);
    if (v === undefined) throw { code: "invalid_json", message: r.truncated ? "Respuesta cortada" : "La respuesta no era JSON", text: r.text };
    return v;
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] }, tools: { maxCount: 8 } });

  /* ── downloads ──────────────────────────────────────────────────── */
  const downloads = {
    save: async ({ filename, data }) => {
      if (!filename || data == null) throw err("bad_request", "Falta el archivo");
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    },
  };

  /* ── window.claude ──────────────────────────────────────────────── */
  const caps = { db, user, sample, downloads, account: account || null };
  window.claude = { use: async name => { if (name === "db" || name === "account" || name === "user") await ready; return caps[name] ?? null; } };
})();
