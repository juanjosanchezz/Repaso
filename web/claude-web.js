/* Repaso · versión web (Vercel)
   ─────────────────────────────────────────────────────────────────────
   Implementa en el navegador la misma interfaz `window.claude.use(name)` que
   Repaso usa dentro de Claude, para que src/repaso.html funcione sin cambios
   en una web normal:

   - db         Base de datos de documentos guardada en IndexedDB (este navegador).
   - user       Identidad local de este navegador.
   - sample     Claude a través de /api/claude (función de Vercel con tu API key),
                con streaming, imágenes, JSON y herramientas.
   - downloads  Descarga normal de archivos.
   - mcp        No disponible en la web (Google Calendar solo funciona dentro de Claude).

   Se inserta antes de la app en dist/index.html (scripts/build-web.js). */
(() => {
  "use strict";
  window.__REPASO_WEB__ = true;

  /* ── db ─────────────────────────────────────────────────────────── */
  const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  const segs = p => p.split("/");
  const clone = o => JSON.parse(JSON.stringify(o));
  const tick = v => new Promise(r => setTimeout(() => r(v), 0));
  const store = new Map();
  const listeners = new Set();
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
  const ready = idbLoad();

  const err = (code, message) => ({ code, message });
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
  function write(path, doc) { if (doc === undefined) store.delete(path); else store.set(path, doc); idbPut(path, doc); notify(); }

  function docRef(path) {
    checkPath(path, true);
    return {
      id: segs(path).at(-1), path,
      get: () => tick(snapDoc(path)),
      set: async d => { if (!d || typeof d !== "object" || Array.isArray(d)) throw err("invalid_argument", "El documento tiene que ser un objeto"); const c = clone(d); if (tooBig(c)) throw err("invalid_argument", "Documento de más de 256 KiB"); write(path, c); await tick(); },
      update: async d => { if (!store.has(path)) throw err("invalid_argument", "No existe el documento " + path); const m = deepMerge(store.get(path), clone(d)); if (tooBig(m)) throw err("invalid_argument", "Documento de más de 256 KiB"); write(path, m); await tick(); },
      delete: async () => { write(path, undefined); await tick(); },
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
  const rid = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");
  function colRef(path) { checkPath(path, false); return { ...query(path), path, doc: id => docRef(path + "/" + (id || rid())), add: async d => { const r = docRef(path + "/" + rid()); await r.set(d); return r; } }; }
  const db = { doc: docRef, collection: colRef };

  /* ── user ───────────────────────────────────────────────────────── */
  function localId() {
    try { let id = localStorage.getItem("repaso.web.uid"); if (!id) { id = "u_" + rid(22); localStorage.setItem("repaso.web.uid", id); } return id; }
    catch { return window.__repasoTmpId ||= "u_" + rid(22); }
  }
  const uid = localId();
  const user = {
    id: async () => uid, me: async () => ({ id: uid, name: "", email: null, isMe: true }), name: async () => "",
    can: async () => true, canEdit: async () => true, isOwner: async () => true, profiles: async () => ({}), search: async () => [],
  };

  /* ── sample: Claude vía /api/claude ─────────────────────────────── */
  const ENDPOINT = "/api/claude";
  const getCode = () => { try { return localStorage.getItem("repaso.web.code") || ""; } catch { return ""; } };
  const setCode = c => { try { localStorage.setItem("repaso.web.code", c); } catch {} };

  let codePrompt = null;
  function askCode(wrong) {
    if (codePrompt) return codePrompt;
    codePrompt = new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.className = "sheet-wrap";
      wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="code-h"><div class="sheet-head"><div><h2 id="code-h">Código de acceso</h2><p class="small muted" style="margin-top:4px">${wrong ? "Ese código no es correcto." : "Para usar Claude en esta versión de Repaso necesitas el código que te dio quien te pasó la app."}</p></div></div>
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
    let r;
    try { r = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-repaso-code": getCode() }, body: JSON.stringify(body), signal }); }
    catch (e) { if (e?.name === "AbortError") throw err("cancelled", "Cancelado"); throw err("upstream_error", "Sin conexión con el servidor"); }
    if (r.status === 401) { if (!retried && await askCode(!!getCode())) return round(body, signal, onDelta, true); throw err("not_granted", "Falta el código de acceso"); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw httpError(r.status, j); }
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
  const caps = { db, user, sample, downloads };
  window.claude = { use: async name => { if (name === "db") await ready; return caps[name] ?? null; } };
})();
