/* Mock of the claude.ai artifact runtime (db, user, sample, downloads, mcp) for local testing.
   Loaded as an init script before the page, so window.claude exists when the app boots.
   Implements the documented contract closely enough to exercise every code path:
   path parity checks, 256 KiB doc limit, update-requires-exists, recursive merge, live snapshots. */
(() => {
  const store = new Map();
  const listeners = new Set();
  const clone = o => JSON.parse(JSON.stringify(o));
  const segs = p => p.split("/");
  const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  const later = v => new Promise(r => setTimeout(() => r(v), 3));
  const M = (window.__mock = { store, calls: { sample: [], json: [], mcp: [], downloads: [] }, errors: [], failNext: null });

  function checkPath(p, wantDoc) {
    const s = segs(p);
    if (!s.every(x => SEG.test(x) && x !== "." && x !== "..")) throw new TypeError("bad path segment: " + p);
    if ((s.length % 2 === 0) !== wantDoc) throw new TypeError(`path parity (${s.length} segments): ${p}`);
  }
  const snapDoc = path => { const d = store.get(path); return { id: segs(path).at(-1), exists: !!d, data: () => (d ? Object.freeze(clone(d)) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
  function runQuery(q) {
    const depth = segs(q.path).length + 1, pre = q.path + "/";
    let docs = [...store.keys()].filter(k => k.startsWith(pre) && segs(k).length === depth).map(k => ({ k, d: store.get(k) }));
    for (const [f, op, v] of q.filters) docs = docs.filter(({ d }) => { const x = d[f]; switch (op) {
      case "==": return x === v; case "!=": return x !== v; case "<": return x < v; case "<=": return x <= v; case ">": return x > v; case ">=": return x >= v;
      case "in": return v.includes(x); case "not-in": return !v.includes(x); case "array-contains": return Array.isArray(x) && x.includes(v);
      default: throw { code: "invalid_argument", message: "bad op " + op }; } });
    if (q.order) { const [f, dir] = q.order; docs.sort((a, b) => { const x = a.d[f], y = b.d[f]; if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); }); }
    else docs.sort((a, b) => (a.k < b.k ? -1 : 1));
    if (q.lim) docs = docs.slice(0, q.lim);
    const ds = docs.map(({ k }) => snapDoc(k));
    return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  const notify = () => setTimeout(() => { for (const l of [...listeners]) { try { l.next(l.kind === "doc" ? snapDoc(l.path) : runQuery(l)); } catch (e) { M.errors.push("listener: " + (e && e.stack || e)); console.error("listener error", e); } } }, 2);
  const tooBig = o => new Blob([JSON.stringify(o)]).size > 262144;
  function deepMerge(a, b) { const o = { ...a }; for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) o[k] = deepMerge(o[k], v); else o[k] = v; } return o; }
  function maybeFail() { if (M.failNext) { const c = M.failNext; M.failNext = null; throw { code: c, message: "forced " + c }; } }
  function docRef(path) {
    checkPath(path, true);
    return { id: segs(path).at(-1), path,
      get: () => later(snapDoc(path)),
      set: async d => { maybeFail(); if (!d || typeof d !== "object" || Array.isArray(d)) throw { code: "invalid_argument", message: "body must be object" }; const c = clone(d); if (tooBig(c)) throw { code: "invalid_argument", message: "doc over 256KiB: " + path }; store.set(path, c); notify(); await later(); },
      update: async d => { maybeFail(); if (!store.has(path)) throw { code: "invalid_argument", message: "update on missing doc " + path }; const m = deepMerge(store.get(path), clone(d)); if (tooBig(m)) throw { code: "invalid_argument", message: "doc over 256KiB" }; store.set(path, m); notify(); await later(); },
      delete: async () => { store.delete(path); notify(); await later(); },
      onSnapshot: (next) => { const l = { kind: "doc", path, next }; listeners.add(l); setTimeout(() => next(snapDoc(path)), 1); return () => listeners.delete(l); },
      collection: sub => colRef(path + "/" + sub) };
  }
  function query(path, filters = [], order = null, lim = null) {
    const q = { path, filters, order, lim };
    return { where: (f, op, v) => query(path, [...filters, [f, op, v]], order, lim), orderBy: (f, d = "asc") => query(path, filters, [f, d], lim), limit: n => query(path, filters, order, n),
      get: async () => { await later(); return runQuery(q); },
      onSnapshot: (next) => { const l = { kind: "query", ...q, next }; listeners.add(l); setTimeout(() => next(runQuery(q)), 1); return () => listeners.delete(l); } };
  }
  const rid = () => Math.random().toString(36).slice(2, 12);
  function colRef(path) { checkPath(path, false); return { ...query(path), path, doc: id => docRef(path + "/" + (id || rid())), add: async d => { const r = docRef(path + "/" + rid()); await r.set(d); return r; } }; }
  const db = { doc: docRef, collection: colRef };
  M.listenerCount = () => listeners.size;

  const user = { id: async () => "u_testuser00000000000aa", can: async () => true, me: async () => ({ id: "u_testuser00000000000aa", name: "Julia Pérez", isMe: true, email: null }), isOwner: async () => false, canEdit: async () => false, name: async () => "Julia Pérez" };

  const text = input => (typeof input === "string" ? input : input.map(t => t.content).join("\n"));
  function fakeJson(p) {
    if (p.includes('"cards":[')) return { cards: Array.from({ length: 6 }, (_, i) => ({ q: `Pregunta ${i + 1}: ¿qué fue el turnismo?`, a: `Respuesta ${i + 1}: alternancia pactada.`, tag: "Tema 1" })) };
    if (p.includes('"questions":[{"q"')) return { questions: Array.from({ length: 4 }, (_, i) => ({ q: `Test ${i + 1}`, options: ["A1", "B1", "C1", "D1"], answer: i % 4, explain: "Porque sí.", tag: "Tema 1" })) };
    if (p.includes('"exam_md"')) return { title: "Modelo PAU · Historia", minutes: 1, exam_md: "1. Explica el turnismo (2 puntos)\n2. Comenta la fuente (8 puntos)", solutions_md: "1. Alternancia...\n2. Comentario..." };
    if (p.includes('"center"')) return { center: "La Restauración", branches: [{ title: "Sistema", children: [{ title: "Turnismo", children: [{ title: "Cánovas" }] }] }, { title: "Crisis", children: [{ title: "1898" }] }] };
    if (p.includes('"items":[{"i"')) { const n = (p.match(/\[\d+\] Archivo/g) || []).length; return { items: Array.from({ length: n }, (_, i) => ({ i, topic: i % 2 ? "Tema 2 · La Segunda República" : "Tema 1 · La Restauración" })) }; }
    if (p.includes('"subjects":[')) return { subjects: ["Psicología del Desarrollo", "Psicobiología", "Estadística"] };
    if (p.includes('"score":7.25')) return { score: 6.5, questions: [{ n: "1", score: 1.5, max: 2, feedback: "Bien." }, { n: "2", score: 5, max: 8, feedback: "Falta contexto." }], summary: "Buen trabajo.", next: ["Contexto histórico", "Más fechas"] };
    if (p.includes('"steps":[')) return { steps: [{ t: "Buscar información", when: "" }, { t: "Hacer el guion", when: "" }, { t: "Ensayar", when: "" }] };
    return undefined;
  }
  function fakeText(p) {
    if (p.startsWith("Transcribe")) return "# Apuntes escaneados\nTexto transcrito de la imagen.";
    return "# Apuntes\n\n## Apartado\n**Turnismo**: alternancia pactada.\n\n> **Clave:** el pacto de El Pardo.\n\n<details><summary>Comprueba</summary>respuesta</details>";
  }
  const sample = async (input, opts = {}) => {
    const p = text(input); M.calls.sample.push({ p, images: !!opts.images, tier: opts.modelTier, cache: opts.cache });
    if (new Blob([p]).size > 262144) throw { code: "prompt_too_large", message: "too large" };
    if (opts.signal?.aborted) throw { code: "cancelled" };
    await later(); const t = fakeText(p); opts.onText?.({ text: t, delta: t }); return { text: t, truncated: false, modelTierApplied: opts.modelTier || "default" };
  };
  sample.json = async (input, opts = {}) => {
    const p = text(input); M.calls.json.push({ p, images: !!opts.images, tier: opts.modelTier });
    if (new Blob([p]).size > 262144) throw { code: "prompt_too_large", message: "too large" };
    await later(); const v = fakeJson(p); if (v === undefined) throw { code: "invalid_json", message: "no json for prompt", text: p.slice(0, 200) };
    const t = JSON.stringify(v); opts.onText?.({ text: t, delta: t }); return v;
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 2e7, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] }, tools: { maxCount: 8 } });

  const downloads = { save: async r => { M.calls.downloads.push({ filename: r.filename, size: r.data?.size ?? r.data?.length }); return { status: "saved" }; } };
  const mcp = { callTool: async (server, tool, input) => { M.calls.mcp.push({ server, tool, input }); for (const k of ["summary", "startTime", "endTime"]) if (!input[k]) throw { code: "tool_error", message: "missing " + k }; return { payload: { id: "evt_" + rid() } }; } };
  const caps = { db, user, sample, downloads, mcp };
  window.claude = { use: n => new Promise(r => setTimeout(() => r(caps[n] ?? null), 2)) };
})();
