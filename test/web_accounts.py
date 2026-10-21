"""Prueba de las cuentas de la versión web (Supabase): registro, inicio de sesión en otro
dispositivo, sincronización, contraseñas, confirmación por correo, caducidad y borrado.

Run:  python3 test/web_accounts.py
Construye dist/ con SUPABASE_URL=http://sb.test y simula Supabase (Auth + la tabla
repaso_docs con sus reglas: cada usuaria solo ve y escribe sus filas), /api/claude y /api/account.
"""
import json, os, subprocess, sys, time, uuid, secrets
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANON = "sb_publishable_test"
subprocess.check_call(["node", os.path.join(ROOT, "scripts", "build-web.js")], stdout=subprocess.DEVNULL,
                      env={**os.environ, "SUPABASE_URL": "http://sb.test", "SUPABASE_ANON_KEY": ANON})
STUBS = json.loads(subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "test", "lib-stubs.js")]))
DIST = os.path.join(ROOT, "dist")
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("  ok  " if cond else "  FAIL") + f"  {name}" + (f"  — {detail}" if detail and not cond else ""))

# ── Supabase simulado ────────────────────────────────────────────────
class FakeSupabase:
    def __init__(self):
        self.autoconfirm = True
        self.users = {}      # email -> {id, email, password, confirmed, meta}
        self.access = {}     # token -> uid
        self.refresh = {}    # token -> uid
        self.rows = {}       # (uid, path) -> {data, deleted, updated_at}
        self.clock = 0
        self.log = []
    def by_id(self, uid): return next((u for u in self.users.values() if u["id"] == uid), None)
    def now(self):
        self.clock += 1
        return f"2026-10-21T19:{self.clock // 60000000 % 60:02d}:{self.clock // 1000000 % 60:02d}.{self.clock % 1000000:06d}+00:00"
    def user_json(self, u): return {"id": u["id"], "email": u["email"], "user_metadata": u["meta"], "identities": [{"id": u["id"]}]}
    def session(self, u):
        a, r = "at_" + secrets.token_hex(8), "rt_" + secrets.token_hex(8)
        self.access[a] = u["id"]; self.refresh[r] = u["id"]
        return {"access_token": a, "refresh_token": r, "expires_in": 3600, "expires_at": int(time.time()) + 3600, "token_type": "bearer", "user": self.user_json(u)}
    def revoke(self, uid):
        for d in (self.access, self.refresh):
            for k in [k for k, v in d.items() if v == uid]: del d[k]
    def uid_of(self, req):
        h = req.headers.get("authorization", "")
        return self.access.get(h[7:]) if h.startswith("Bearer ") else None

    def handle(self, route):
        req = route.request; u = urlparse(req.url); q = parse_qs(u.query); path = u.path
        body = json.loads(req.post_data) if req.post_data else {}
        J = lambda status, obj: route.fulfill(status=status, content_type="application/json", body=json.dumps(obj))
        self.log.append((req.method, path, dict((k, v[0]) for k, v in q.items())))
        if req.headers.get("apikey") != ANON: return J(401, {"message": "No API key found in request"})
        if path == "/auth/v1/signup":
            email = body["email"].lower()
            if len(body.get("password", "")) < 6: return J(422, {"code": 422, "error_code": "weak_password", "msg": "Password should be at least 6 characters."})
            if email in self.users:
                if self.autoconfirm: return J(422, {"code": 422, "error_code": "user_already_exists", "msg": "User already registered"})
                return J(200, {"id": str(uuid.uuid4()), "email": email, "identities": []})
            usr = {"id": str(uuid.uuid4()), "email": email, "password": body["password"], "confirmed": self.autoconfirm, "meta": body.get("data") or {}}
            self.users[email] = usr
            return J(200, self.session(usr) if self.autoconfirm else {**self.user_json(usr), "confirmation_sent_at": "now"})
        if path == "/auth/v1/token":
            if q["grant_type"][0] == "password":
                usr = self.users.get(body["email"].lower())
                if not usr or usr["password"] != body["password"]: return J(400, {"code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"})
                if not usr["confirmed"]: return J(400, {"code": 400, "error_code": "email_not_confirmed", "msg": "Email not confirmed"})
                return J(200, self.session(usr))
            uid = self.refresh.pop(body.get("refresh_token"), None)
            if not uid: return J(400, {"code": 400, "error_code": "refresh_token_not_found", "msg": "Invalid Refresh Token: Refresh Token Not Found"})
            return J(200, self.session(self.by_id(uid)))
        if path == "/auth/v1/user":
            usr = self.by_id(self.uid_of(req) or "")
            if not usr: return J(401, {"code": 401, "error_code": "bad_jwt", "msg": "invalid JWT"})
            if req.method == "PUT":
                if "password" in body:
                    if body["password"] == usr["password"]: return J(422, {"code": 422, "error_code": "same_password", "msg": "New password should be different from the old password."})
                    usr["password"] = body["password"]
                if "data" in body: usr["meta"] = {**usr["meta"], **body["data"]}
            return J(200, self.user_json(usr))
        if path == "/auth/v1/logout":
            uid = self.uid_of(req)
            if uid and q.get("scope") == ["local"]: self.access.pop(req.headers["authorization"][7:], None)
            elif uid: self.revoke(uid)                     # por defecto, Supabase cierra todas las sesiones
            return route.fulfill(status=204, body="")
        if path in ("/auth/v1/recover", "/auth/v1/resend"): return J(200, {})
        if path == "/rest/v1/repaso_docs":
            uid = self.uid_of(req)
            if not uid: return J(401, {"code": "PGRST301", "message": "JWT expired"})
            if req.method == "GET":
                rows = [{"path": p, **v} for (o, p), v in self.rows.items() if o == uid]   # RLS: solo sus filas
                if q.get("deleted") == ["is.false"]: rows = [r for r in rows if not r["deleted"]]
                if "updated_at" in q: since = unquote(q["updated_at"][0][3:]); rows = [r for r in rows if r["updated_at"] > since]
                key = q.get("order", ["path.asc"])[0].split(".")[0]; rows.sort(key=lambda r: r[key])
                off = int(q.get("offset", ["0"])[0]); lim = int(q.get("limit", ["1000"])[0])
                cols = q["select"][0].split(",")
                return J(200, [{c: r[c] for c in cols} for r in rows[off:off + lim]])
            if req.method == "POST":
                if body.get("user_id") != uid: return J(403, {"code": "42501", "message": "new row violates row-level security policy"})
                self.rows[(uid, body["path"])] = {"data": body["data"], "deleted": body["deleted"], "updated_at": self.now()}
                return route.fulfill(status=201, body="")
        return J(404, {"message": "not found " + path})

SB = FakeSupabase()

def sse(text):
    ev = [{"type": "message_start", "message": {"id": "m", "content": []}}, {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
          {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}, {"type": "content_block_stop", "index": 0},
          {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}, {"type": "message_stop"}]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev)

calls = []
def api_claude(route):
    req = route.request
    calls.append({"auth": req.headers.get("authorization"), "code": req.headers.get("x-repaso-code")})
    if not SB.uid_of(req): return route.fulfill(status=401, content_type="application/json", body='{"error":"no_session"}')
    if req.headers.get("x-repaso-code") != "julia2026": return route.fulfill(status=401, content_type="application/json", body='{"error":"bad_code"}')
    return route.fulfill(status=200, content_type="text/event-stream", body=sse("El turnismo fue la alternancia pactada."))

def api_account(route):
    uid = SB.uid_of(route.request)
    if not uid: return route.fulfill(status=401, content_type="application/json", body='{"error":"no_session"}')
    usr = SB.by_id(uid); del SB.users[usr["email"]]; SB.revoke(uid)
    for k in [k for k in SB.rows if k[0] == uid]: del SB.rows[k]           # on delete cascade
    return route.fulfill(status=200, content_type="application/json", body='{"ok":true}')

def router(r):
    u = r.request.url
    if u.startswith("http://sb.test/"): return SB.handle(r)
    if u.endswith("/api/claude"): return api_claude(r)
    if u.endswith("/api/account"): return api_account(r)
    for k, f in [("pdf.worker", "pdfWorker"), ("pdf.min", "pdf"), ("marked", "marked"), ("purify", "purify"), ("mammoth", "mammoth"), ("jszip", "jszip"), ("html2pdf", "html2pdf"), ("pptxgen", "pptx")]:
        if k in u: return r.fulfill(status=200, content_type="application/javascript", body=STUBS[f])
    if u.startswith("http://repaso.test/"):
        return r.fulfill(status=200, content_type="text/html", body=open(os.path.join(DIST, "index.html")).read())
    if "fonts.g" in u: return r.fulfill(status=200, content_type="text/css", body="")
    return r.abort()

def main():
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        def device(name):
            ctx = b.new_context(viewport={"width": 1280, "height": 900}); ctx.route("**/*", router)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
            # Los 400/401 de Supabase y /api/claude son respuestas esperadas en estas pruebas.
            pg.on("console", lambda m: errors.append(f"{name}: {m.text}") if m.type == "error" and not any(s in m.text for s in ("400", "401", "403", "422")) else None)
            return pg
        def W(pg, ms=250): pg.wait_for_timeout(ms)
        def click(pg, sel, i=0): pg.locator(sel).nth(i).click(); W(pg, 150)
        def wait_for(pg, fn, t=6000):
            s = time.time()
            while time.time() - s < t / 1000:
                try:
                    if fn(): return True
                except Exception: pass
                W(pg, 100)
            return False
        text = lambda pg: pg.inner_text("body")
        def signup(pg, email, pw, name):
            click(pg, '[data-action=auth-tab][data-tab=signup]')
            pg.fill("#pf-email", email); pg.fill("#pf-pass", pw); pg.fill("#pf-name", name); pg.check("#pf-ok"); click(pg, '#signup button[type=submit]')
            pg.select_option("#pf-region", "Canarias"); click(pg, '#signup button[type=submit]'); click(pg, '#signup button[type=submit]'); click(pg, '#signup button[type=submit]')
        def login(pg, email, pw):
            if pg.locator("#li-email").count() == 0: click(pg, '[data-action=auth-tab][data-tab=login]')
            pg.fill("#li-email", email); pg.fill("#li-pass", pw); click(pg, '#login-form button[type=submit]')
        julia_id = lambda: SB.users["julia@test.es"]["id"]

        print("\n[cuentas] Registro con email y contraseña")
        d1 = device("móvil"); d1.goto("http://repaso.test/")
        check("bienvenida con crear cuenta y entrar", wait_for(d1, lambda: d1.locator('[data-action=auth-tab][data-tab=signup]').count() == 1 and d1.locator('[data-action=auth-tab][data-tab=login]').count() == 1))
        check("texto de privacidad de cuentas", "ninguna otra usuaria puede verlos" in text(d1))
        click(d1, '[data-action=auth-tab][data-tab=signup]')
        check("el primer paso pide email, contraseña y nombre", all(d1.locator(s).count() == 1 for s in ("#pf-email", "#pf-pass", "#pf-name")))
        h = [d1.evaluate(f"document.querySelector('{s}').getBoundingClientRect().height") for s in ("#pf-email", "#pf-pass", "#pf-name")]
        check("los tres campos miden lo mismo", len(set(round(x) for x in h)) == 1, str(h))
        d1.fill("#pf-email", "julia@"); d1.fill("#pf-pass", "julia1234"); d1.fill("#pf-name", "Julia"); d1.check("#pf-ok"); click(d1, '#signup button[type=submit]')
        check("rechaza un email mal escrito", d1.locator("#pf-email").count() == 1 and "email válido" in text(d1))
        d1.fill("#pf-email", "julia@test.es"); d1.fill("#pf-pass", "corta"); click(d1, '#signup button[type=submit]')
        check("rechaza una contraseña corta", d1.locator("#pf-pass").count() == 1 and "al menos 8" in text(d1))
        click(d1, '[data-action=pw-toggle][data-for=pf-pass]')
        check("se puede ver la contraseña", d1.get_attribute("#pf-pass", "type") == "text")
        d1.fill("#pf-pass", "julia1234"); click(d1, '#signup button[type=submit]')
        d1.select_option("#pf-region", "Canarias"); click(d1, '#signup button[type=submit]'); click(d1, '#signup button[type=submit]'); click(d1, '#signup button[type=submit]')
        check("crea la cuenta y entra", wait_for(d1, lambda: "Hola, Julia" in text(d1)))
        check("la cuenta existe en Supabase", "julia@test.es" in SB.users and SB.users["julia@test.es"]["meta"].get("name") == "Julia")
        mine = [p for (o, p) in SB.rows if o == julia_id()]
        check("perfil y asignaturas guardados en su cuenta", "profile" in mine and sum(p.startswith("profile/subjects/") for p in mine) == 3, str(mine))
        d1.reload(); check("sigue dentro al recargar", wait_for(d1, lambda: "Hola, Julia" in text(d1), 8000))

        print("\n[cuentas] Otro dispositivo")
        d2 = device("ordenador"); d2.goto("http://repaso.test/")
        wait_for(d2, lambda: d2.locator('[data-action=auth-tab][data-tab=login]').count() == 1)
        login(d2, "julia@test.es", "mala-clave")
        check("contraseña incorrecta: lo dice claro", wait_for(d2, lambda: "El email o la contraseña no son correctos." in text(d2)))
        check("conserva el email escrito", d2.input_value("#li-email") == "julia@test.es")
        login(d2, "julia@test.es", "julia1234")
        check("entra con su cuenta en otro dispositivo", wait_for(d2, lambda: "Hola, Julia" in text(d2)))
        check("ve sus asignaturas", d2.locator(".subj:not(.add)").count() == 3)

        print("\n[cuentas] Sincronización entre dispositivos")
        click(d1, '[data-action=go-tasks]'); d1.fill("#qt-title", "Comentario de Kant"); click(d1, '#quick-task button[type=submit]'); W(d1, 400)
        check("la tarea se guarda en la cuenta", any(v["data"] and v["data"].get("title") == "Comentario de Kant" for (o, _), v in SB.rows.items() if o == julia_id()))
        click(d2, '[data-action=go-tasks]')
        d2.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        check("aparece en el otro dispositivo al volver a la app", wait_for(d2, lambda: "Comentario de Kant" in text(d2)))

        print("\n[cuentas] Claude con sesión y código de acceso")
        click(d1, '[data-action=go-chats]'); click(d1, '[data-action=chat-new]')
        d1.fill("#chat-input", "¿Qué es el turnismo?"); d1.press("#chat-input", "Enter")
        check("pide el código una vez", wait_for(d1, lambda: d1.locator("#web-code").count() == 1))
        d1.fill("#web-code", "julia2026"); d1.locator("#web-code").press("Enter")
        check("responde", wait_for(d1, lambda: "alternancia pactada" in d1.inner_text("#r-chat-log")))
        check("manda la sesión a /api/claude", calls and (calls[-1]["auth"] or "").startswith("Bearer at_"))
        check("guarda el código en la cuenta", wait_for(d1, lambda: SB.users["julia@test.es"]["meta"].get("repaso_code") == "julia2026"))

        print("\n[cuentas] Cerrar sesión y volver a entrar")
        click(d2, '[data-action=settings]')
        check("Personalizar muestra el email", "julia@test.es" in text(d2))
        click(d2, '.sheet [data-action=logout]')
        check("vuelve a la bienvenida", wait_for(d2, lambda: d2.locator('[data-action=auth-tab][data-tab=login]').count() == 1, 8000))
        check("borra la sesión del navegador", d2.evaluate("localStorage.getItem('repaso.sb.session')") is None)
        check("y la cierra en Supabase (solo este dispositivo)", any(x[1] == "/auth/v1/logout" and x[2].get("scope") == "local" for x in SB.log))
        d2.reload(); check("al recargar sigue fuera", wait_for(d2, lambda: d2.locator('[data-action=auth-tab][data-tab=login]').count() == 1, 8000))
        login(d2, "julia@test.es", "julia1234"); wait_for(d2, lambda: "Hola, Julia" in text(d2))
        n = len(calls); click(d2, '[data-action=go-chats]'); click(d2, '[data-action=chat-new]')
        d2.fill("#chat-input", "Otra pregunta"); d2.press("#chat-input", "Enter")
        check("en otro dispositivo no vuelve a pedir el código", wait_for(d2, lambda: "alternancia pactada" in d2.inner_text("#r-chat-log")) and d2.locator("#web-code").count() == 0 and calls[-1]["code"] == "julia2026")

        print("\n[cuentas] Cambiar la contraseña")
        click(d2, '[data-action=settings]'); d2.fill("#pw-new", "nueva-clave-1"); click(d2, '[data-action=pw-change]')
        check("cambia la contraseña", wait_for(d2, lambda: SB.users["julia@test.es"]["password"] == "nueva-clave-1"))
        click(d2, '[data-action=close-sheet]')
        d3 = device("tablet"); d3.goto("http://repaso.test/"); wait_for(d3, lambda: d3.locator('[data-action=auth-tab][data-tab=login]').count() == 1)
        login(d3, "julia@test.es", "julia1234"); check("la antigua ya no vale", wait_for(d3, lambda: "no son correctos" in text(d3)))
        login(d3, "julia@test.es", "nueva-clave-1"); check("la nueva sí", wait_for(d3, lambda: "Hola, Julia" in text(d3)))

        print("\n[cuentas] Sesión caducada")
        s3 = json.loads(d3.evaluate("localStorage.getItem('repaso.sb.session')"))
        SB.access.pop(s3["access_token"], None); SB.refresh.pop(s3["refresh_token"], None)   # solo la sesión de la tablet
        d3.evaluate("(()=>{const s=JSON.parse(localStorage.getItem('repaso.sb.session'));s.expires_at=1;localStorage.setItem('repaso.sb.session',JSON.stringify(s));})()")
        d3.reload()
        check("si la sesión ya no vale, vuelve al acceso y lo explica", wait_for(d3, lambda: "Tu sesión ha caducado" in text(d3) and d3.locator('[data-action=auth-tab][data-tab=login]').count() == 1, 8000))

        print("\n[cuentas] Cada una ve solo lo suyo")
        check("cerrar sesión en un dispositivo no cierra los demás", "Hola, Julia" in text(d1) or d1.locator("#r-chat-log").count() == 1)
        click(d1, '[data-action=settings]'); click(d1, '.sheet [data-action=logout]')
        wait_for(d1, lambda: d1.locator('[data-action=auth-tab][data-tab=signup]').count() == 1, 8000)
        signup(d1, "ana@test.es", "ana12345", "Ana")
        check("otra amiga crea su cuenta en el mismo móvil", wait_for(d1, lambda: "Hola, Ana" in text(d1)))
        click(d1, '[data-action=go-tasks]')
        check("no ve las tareas de Julia", "Comentario de Kant" not in text(d1))
        check("sus filas van con su usuario", all(o in (julia_id(), SB.users["ana@test.es"]["id"]) for (o, _) in SB.rows) and any(o == SB.users["ana@test.es"]["id"] for (o, _) in SB.rows))
        click(d1, '[data-action=settings]'); click(d1, '[data-action=delete-account]'); click(d1, '[data-action=confirm][data-v="1"]')
        check("borrar cuenta: borra usuaria y datos", wait_for(d1, lambda: "ana@test.es" not in SB.users and not any(o not in (julia_id(),) for (o, _) in SB.rows), 8000))
        check("y vuelve al acceso con aviso", wait_for(d1, lambda: "Cuenta borrada." in text(d1), 8000))
        check("Julia no ha perdido nada", sum(1 for (o, p) in SB.rows if o == julia_id() and p.startswith("profile/subjects/")) == 3)

        print("\n[cuentas] Registro con confirmación por correo")
        SB.autoconfirm = False
        d4 = device("móvil de Marta"); d4.goto("http://repaso.test/")
        wait_for(d4, lambda: d4.locator('[data-action=auth-tab][data-tab=signup]').count() == 1)
        signup(d4, "marta@test.es", "marta1234", "Marta")
        check("pide confirmar el email", wait_for(d4, lambda: "Confirma tu email" in text(d4) and "marta@test.es" in text(d4)))
        click(d4, '[data-action=resend-confirm]'); check("puede reenviar el correo", any(x[1] == "/auth/v1/resend" for x in SB.log))
        click(d4, '[data-action=auth-tab][data-tab=login]')
        check("el login trae el email puesto", d4.input_value("#li-email") == "marta@test.es")
        login(d4, "marta@test.es", "marta1234")
        check("sin confirmar: lo explica", wait_for(d4, lambda: "Todavía no has confirmado tu email" in text(d4)))
        redirect = [x for x in SB.log if x[1] == "/auth/v1/signup"][-1][2].get("redirect_to", "")
        check("el correo vuelve a la app", redirect.startswith("http://repaso.test/"), redirect)
        marta = SB.users["marta@test.es"]; marta["confirmed"] = True; s = SB.session(marta)
        d4.goto(f"http://repaso.test/#access_token={s['access_token']}&refresh_token={s['refresh_token']}&expires_in=3600&token_type=bearer&type=signup")
        check("al abrir el enlace termina de crear la cuenta", wait_for(d4, lambda: "Hola, Marta" in text(d4), 8000))
        check("con sus asignaturas", sum(1 for (o, p) in SB.rows if o == marta["id"] and p.startswith("profile/subjects/")) == 3)
        check("limpia el enlace de la barra", "#access_token" not in d4.url)

        print("\n[cuentas] Email ya registrado")
        d5 = device("otro"); d5.goto("http://repaso.test/"); wait_for(d5, lambda: d5.locator('[data-action=auth-tab][data-tab=signup]').count() == 1)
        signup(d5, "marta@test.es", "otra12345", "Marta")
        check("avisa y vuelve al primer paso", wait_for(d5, lambda: "Ya hay una cuenta con ese email" in text(d5) and d5.locator("#pf-email").count() == 1))

        print("\n[cuentas] He olvidado la contraseña")
        click(d5, '[data-action=auth-tab][data-tab=welcome]'); click(d5, '[data-action=auth-tab][data-tab=login]'); click(d5, '[data-action=auth-tab][data-tab=forgot]')
        d5.fill("#fg-email", "marta@test.es"); click(d5, '#forgot-form button[type=submit]')
        check("manda el enlace", wait_for(d5, lambda: "Mira tu correo" in text(d5)) and any(x[1] == "/auth/v1/recover" for x in SB.log))
        s = SB.session(marta)
        d5.goto(f"http://repaso.test/#access_token={s['access_token']}&refresh_token={s['refresh_token']}&expires_in=3600&type=recovery")
        check("el enlace abre la pantalla de contraseña nueva", wait_for(d5, lambda: d5.locator("#rs-pass").count() == 1, 8000))
        d5.fill("#rs-pass", "marta-nueva-9"); click(d5, '#reset-form button[type=submit]')
        check("guarda la nueva y entra", wait_for(d5, lambda: "Hola, Marta" in text(d5), 8000) and marta["password"] == "marta-nueva-9")
        d6 = device("caducado"); d6.goto("http://repaso.test/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
        check("enlace caducado: lo explica", wait_for(d6, lambda: "El enlace ha caducado" in text(d6), 8000))

        print("\n[cuentas] Cuenta confirmada en otro dispositivo, sin perfil")
        SB.users["lia@test.es"] = {"id": str(uuid.uuid4()), "email": "lia@test.es", "password": "lia123456", "confirmed": True, "meta": {}}
        login(d6, "lia@test.es", "lia123456")
        check("la manda a terminar el registro", wait_for(d6, lambda: "Has entrado como" in text(d6) and d6.locator("#pf-email").count() == 0))
        d6.fill("#pf-name", "Lía"); d6.check("#pf-ok"); click(d6, '#signup button[type=submit]')
        d6.select_option("#pf-region", "Canarias"); click(d6, '#signup button[type=submit]'); click(d6, '#signup button[type=submit]'); click(d6, '#signup button[type=submit]')
        check("y entra", wait_for(d6, lambda: "Hola, Lía" in text(d6)))

        check("sin errores de JavaScript", not errors, "\n".join(errors)[:800])
        b.close()
    print(f"\n{sum(results)}/{len(results)} comprobaciones correctas (cuentas)")
    sys.exit(0 if all(results) else 1)

if __name__ == "__main__":
    main()
