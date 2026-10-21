"""Prueba de las cuentas de la versión web (Neon): registro, otro dispositivo, sincronización,
contraseñas, sesiones, borrado y el modo sin base de datos.

Run:  python3 test/web_accounts.py
Usa las funciones reales api/auth.js y api/docs.js (servidas por test/api_server.js) contra un
PostgreSQL real que la prueba arranca en una carpeta temporal (necesita PostgreSQL instalado:
initdb, pg_ctl y psql). /api/claude se simula.
"""
import json, os, shutil, subprocess, sys, tempfile, time, glob, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("  ok  " if cond else "  FAIL") + f"  {name}" + (f"  — {detail}" if detail and not cond else ""))

# ── PostgreSQL de verdad, en una carpeta temporal ────────────────────
def pg_bin(name):
    found = shutil.which(name) or next(iter(sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{name}"), reverse=True)), None)
    if not found: sys.exit(f"Esta prueba necesita PostgreSQL ({name}). Instálalo (p. ej. apt install postgresql).")
    return found
PGPORT = "55439"
PGDIR = tempfile.mkdtemp(prefix="repaso-pg-")
as_pg = (lambda cmd: ["su", "postgres", "-s", "/bin/sh", "-c", " ".join(cmd)]) if os.geteuid() == 0 else (lambda cmd: cmd)
if os.geteuid() == 0: shutil.chown(PGDIR, "postgres")
subprocess.check_call(as_pg([pg_bin("initdb"), "-D", PGDIR, "-A", "trust", "-U", "postgres"]), stdout=subprocess.DEVNULL)
subprocess.check_call(as_pg([pg_bin("pg_ctl"), "-D", PGDIR, "-o", f"'-p {PGPORT} -k /tmp'", "-l", PGDIR + "/log", "-w", "start"]), stdout=subprocess.DEVNULL)
PSQL = [pg_bin("psql"), "-h", "/tmp", "-p", PGPORT, "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
def sql(q): return subprocess.check_output(PSQL + ["-c", q], text=True).strip()
subprocess.check_call(PSQL + ["-f", os.path.join(ROOT, "db", "schema.sql")])

API_PORT = 8791
api_proc = subprocess.Popen(["node", os.path.join(ROOT, "test", "api_server.js")], env={**os.environ, "PORT": str(API_PORT), "PGPORT": PGPORT, "PGDB": "postgres"}, stdout=subprocess.PIPE, text=True)
api_proc.stdout.readline()
def stop():
    api_proc.kill()
    subprocess.call(as_pg([pg_bin("pg_ctl"), "-D", PGDIR, "-m", "fast", "stop"]), stdout=subprocess.DEVNULL)
    shutil.rmtree(PGDIR, ignore_errors=True)

def build(accounts):
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING")}
    if accounts: env["DATABASE_URL"] = "postgres://simulada@db.test/repaso"
    subprocess.check_call(["node", os.path.join(ROOT, "scripts", "build-web.js")], stdout=subprocess.DEVNULL, env=env)
    return open(os.path.join(ROOT, "dist", "index.html")).read()
HTML = build(True)
STUBS = json.loads(subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "test", "lib-stubs.js")]))

def forward(route):
    """Pasa /api/auth y /api/docs a las funciones reales."""
    req = route.request; path = req.url.split("repaso.test", 1)[1]
    hdr = {k: v for k, v in req.headers.items() if k in ("authorization", "content-type")}
    r = urllib.request.Request(f"http://127.0.0.1:{API_PORT}{path}", data=req.post_data.encode() if req.post_data else None, headers=hdr, method=req.method)
    try:
        with urllib.request.urlopen(r) as resp: return route.fulfill(status=resp.status, content_type="application/json", body=resp.read())
    except urllib.error.HTTPError as e: return route.fulfill(status=e.code, content_type="application/json", body=e.read())
def session_user(auth):
    r = urllib.request.Request(f"http://127.0.0.1:{API_PORT}/api/auth", headers={"authorization": auth or ""})
    try:
        with urllib.request.urlopen(r) as resp: return json.loads(resp.read())["user"]
    except urllib.error.HTTPError: return None

def sse(text):
    ev = [{"type": "message_start", "message": {"id": "m", "content": []}}, {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
          {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}, {"type": "content_block_stop", "index": 0},
          {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}, {"type": "message_stop"}]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev)

calls = []
def api_claude(route):
    req = route.request
    calls.append({"auth": req.headers.get("authorization"), "code": req.headers.get("x-repaso-code")})
    if not session_user(req.headers.get("authorization")): return route.fulfill(status=401, content_type="application/json", body='{"error":"no_session"}')
    if req.headers.get("x-repaso-code") != "julia2026": return route.fulfill(status=401, content_type="application/json", body='{"error":"bad_code"}')
    return route.fulfill(status=200, content_type="text/event-stream", body=sse("El turnismo fue la alternancia pactada."))

def router(r):
    u = r.request.url
    if u.endswith("/api/claude"): return api_claude(r)
    if "/api/auth" in u or "/api/docs" in u: return forward(r)
    for k, f in [("pdf.worker", "pdfWorker"), ("pdf.min", "pdf"), ("marked", "marked"), ("purify", "purify"), ("mammoth", "mammoth"), ("jszip", "jszip"), ("html2pdf", "html2pdf"), ("pptxgen", "pptx")]:
        if k in u: return r.fulfill(status=200, content_type="application/javascript", body=STUBS[f])
    if u.startswith("http://repaso.test/"):
        return r.fulfill(status=200, content_type="text/html", body=HTML)
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
            # Los 400/401/409 de /api/auth y /api/claude son respuestas esperadas en estas pruebas.
            pg.on("console", lambda m: errors.append(f"{name}: {m.text}") if m.type == "error" and not any(s in m.text for s in ("400", "401", "403", "409", "422")) else None)
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
        uid = lambda email: sql(f"select id from rp_users where email = '{email}'")
        paths = lambda email: sql(f"select string_agg(path, ',' order by path) from rp_docs d join rp_users u on u.id = d.user_id where u.email = '{email}' and not d.deleted").split(",")
        n_subj = lambda email: sum(1 for x in paths(email) if x.startswith("profile/subjects/"))

        print("\n[cuentas] Registro con email y contraseña")
        d1 = device("móvil"); d1.goto("http://repaso.test/")
        check("bienvenida con crear cuenta y entrar", wait_for(d1, lambda: d1.locator('[data-action=auth-tab][data-tab=signup]').count() == 1 and d1.locator('[data-action=auth-tab][data-tab=login]').count() == 1))
        check("texto de privacidad de cuentas", "ninguna otra usuaria puede verlos" in text(d1))
        click(d1, '[data-action=auth-tab][data-tab=signup]')
        check("el primer paso pide email, contraseña y nombre", all(d1.locator(x).count() == 1 for x in ("#pf-email", "#pf-pass", "#pf-name")))
        h = [d1.evaluate(f"document.querySelector('{x}').getBoundingClientRect().height") for x in ("#pf-email", "#pf-pass", "#pf-name")]
        check("los tres campos miden lo mismo", len(set(round(x) for x in h)) == 1, str(h))
        d1.fill("#pf-email", "julia@"); d1.fill("#pf-pass", "julia1234"); d1.fill("#pf-name", "Julia"); d1.check("#pf-ok"); click(d1, '#signup button[type=submit]')
        check("rechaza un email mal escrito", d1.locator("#pf-email").count() == 1 and "email válido" in text(d1))
        d1.fill("#pf-email", "Julia@Test.es"); d1.fill("#pf-pass", "corta"); click(d1, '#signup button[type=submit]')
        check("rechaza una contraseña corta", d1.locator("#pf-pass").count() == 1 and "al menos 8" in text(d1))
        click(d1, '[data-action=pw-toggle][data-for=pf-pass]')
        check("se puede ver la contraseña", d1.get_attribute("#pf-pass", "type") == "text")
        d1.fill("#pf-pass", "julia1234"); click(d1, '#signup button[type=submit]')
        d1.select_option("#pf-region", "Canarias"); click(d1, '#signup button[type=submit]'); click(d1, '#signup button[type=submit]'); click(d1, '#signup button[type=submit]')
        check("crea la cuenta y entra directamente (sin correos)", wait_for(d1, lambda: "Hola, Julia" in text(d1)))
        check("la cuenta está en la base de datos (email en minúsculas)", uid("julia@test.es") != "" and sql("select name from rp_users where email='julia@test.es'") == "Julia")
        check("la contraseña se guarda cifrada", sql("select pass_hash like 'scrypt$%' and pass_hash not like '%julia1234%' from rp_users where email='julia@test.es'") == "t")
        check("perfil y asignaturas guardados en su cuenta", "profile" in paths("julia@test.es") and n_subj("julia@test.es") == 3, str(paths("julia@test.es")))
        d1.reload(); check("sigue dentro al recargar", wait_for(d1, lambda: "Hola, Julia" in text(d1), 8000))

        print("\n[cuentas] Otro dispositivo")
        d2 = device("ordenador"); d2.goto("http://repaso.test/")
        wait_for(d2, lambda: d2.locator('[data-action=auth-tab][data-tab=login]').count() == 1)
        login(d2, "julia@test.es", "mala-clave")
        check("contraseña incorrecta: lo dice claro", wait_for(d2, lambda: "El email o la contraseña no son correctos." in text(d2)))
        check("conserva el email escrito", d2.input_value("#li-email") == "julia@test.es")
        login(d2, "JULIA@test.es ", "julia1234")
        check("entra con su cuenta en otro dispositivo (da igual mayúsculas)", wait_for(d2, lambda: "Hola, Julia" in text(d2)))
        check("ve sus asignaturas", d2.locator(".subj:not(.add)").count() == 3)

        print("\n[cuentas] Sincronización entre dispositivos")
        click(d1, '[data-action=go-tasks]'); d1.fill("#qt-title", "Comentario de Kant"); click(d1, '#quick-task button[type=submit]'); W(d1, 500)
        check("la tarea se guarda en la cuenta", "Comentario de Kant" in sql(f"select string_agg(data::text, ' ') from rp_docs where user_id = '{uid('julia@test.es')}'"))
        click(d2, '[data-action=go-tasks]')
        d2.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        check("aparece en el otro dispositivo al volver a la app", wait_for(d2, lambda: "Comentario de Kant" in text(d2)))

        print("\n[cuentas] Claude con sesión y código de acceso")
        click(d1, '[data-action=go-chats]'); click(d1, '[data-action=chat-new]')
        d1.fill("#chat-input", "¿Qué es el turnismo?"); d1.press("#chat-input", "Enter")
        check("pide el código una vez", wait_for(d1, lambda: d1.locator("#web-code").count() == 1))
        d1.fill("#web-code", "julia2026"); d1.locator("#web-code").press("Enter")
        check("responde", wait_for(d1, lambda: "alternancia pactada" in d1.inner_text("#r-chat-log")))
        check("manda la sesión a /api/claude", calls and (calls[-1]["auth"] or "").startswith("Bearer "))
        check("guarda el código en la cuenta", wait_for(d1, lambda: sql("select meta->>'repaso_code' from rp_users where email='julia@test.es'") == "julia2026"))

        print("\n[cuentas] Cerrar sesión y volver a entrar")
        click(d2, '[data-action=settings]')
        check("Personalizar muestra el email", "julia@test.es" in text(d2))
        n_sessions = int(sql("select count(*) from rp_sessions"))
        click(d2, '.sheet [data-action=logout]')
        check("vuelve a la bienvenida", wait_for(d2, lambda: d2.locator('[data-action=auth-tab][data-tab=login]').count() == 1, 8000))
        check("borra la sesión del navegador", d2.evaluate("localStorage.getItem('repaso.session.v2')") is None)
        check("y la cierra en el servidor (solo esa)", int(sql("select count(*) from rp_sessions")) == n_sessions - 1)
        check("cerrar en un dispositivo no cierra los demás", "Hola, Julia" in text(d1) or d1.locator("#r-chat-log").count() == 1)
        d2.reload(); check("al recargar sigue fuera", wait_for(d2, lambda: d2.locator('[data-action=auth-tab][data-tab=login]').count() == 1, 8000))
        login(d2, "julia@test.es", "julia1234"); wait_for(d2, lambda: "Hola, Julia" in text(d2))
        click(d2, '[data-action=go-chats]'); click(d2, '[data-action=chat-new]')
        d2.fill("#chat-input", "Otra pregunta"); d2.press("#chat-input", "Enter")
        check("en otro dispositivo no vuelve a pedir el código", wait_for(d2, lambda: "alternancia pactada" in d2.inner_text("#r-chat-log")) and d2.locator("#web-code").count() == 0 and calls[-1]["code"] == "julia2026")

        print("\n[cuentas] Cambiar la contraseña")
        click(d2, '[data-action=settings]'); d2.fill("#pw-new", "nueva-clave-1"); click(d2, '[data-action=pw-change]')
        check("cambia la contraseña", wait_for(d2, lambda: "Contraseña cambiada" in text(d2)))
        click(d2, '[data-action=close-sheet]')
        check("cierra las demás sesiones", sql(f"select count(*) from rp_sessions where user_id = '{uid('julia@test.es')}'") == "1")
        d1.reload()
        check("el otro dispositivo tiene que volver a entrar", wait_for(d1, lambda: "Tu sesión ha caducado" in text(d1) and d1.locator('[data-action=auth-tab][data-tab=login]').count() == 1, 8000))
        login(d1, "julia@test.es", "julia1234"); check("la antigua ya no vale", wait_for(d1, lambda: "no son correctos" in text(d1)))
        login(d1, "julia@test.es", "nueva-clave-1"); check("la nueva sí", wait_for(d1, lambda: "Hola, Julia" in text(d1)))

        print("\n[cuentas] He olvidado la contraseña")
        d3 = device("tablet"); d3.goto("http://repaso.test/"); wait_for(d3, lambda: d3.locator('[data-action=auth-tab][data-tab=login]').count() == 1)
        click(d3, '[data-action=auth-tab][data-tab=login]'); click(d3, '[data-action=auth-tab][data-tab=forgot]')
        check("explica qué hacer", "Pide ayuda a quien te pasó la app" in text(d3))
        sql("update rp_users set pass_hash = 'temp$Provisional9' where email = 'julia@test.es'")
        login(d3, "julia@test.es", "Provisional9")
        check("entra con la contraseña provisional puesta desde Neon", wait_for(d3, lambda: "Hola, Julia" in text(d3)))
        check("y queda guardada cifrada", sql("select pass_hash like 'scrypt$%' from rp_users where email='julia@test.es'") == "t")

        print("\n[cuentas] Cada una ve solo lo suyo")
        click(d1, '[data-action=settings]'); click(d1, '.sheet [data-action=logout]')
        wait_for(d1, lambda: d1.locator('[data-action=auth-tab][data-tab=signup]').count() == 1, 8000)
        signup(d1, "ana@test.es", "ana12345", "Ana")
        check("otra amiga crea su cuenta en el mismo móvil", wait_for(d1, lambda: "Hola, Ana" in text(d1)))
        click(d1, '[data-action=go-tasks]')
        check("no ve las tareas de Julia", "Comentario de Kant" not in text(d1))
        check("sus documentos van con su usuaria", n_subj("ana@test.es") == 3 and n_subj("julia@test.es") == 3)
        tok = json.loads(d1.evaluate("localStorage.getItem('repaso.session.v2')"))["token"]
        r = urllib.request.Request(f"http://127.0.0.1:{API_PORT}/api/docs?offset=0&limit=1000", headers={"authorization": "Bearer " + tok})
        rows = json.loads(urllib.request.urlopen(r).read())["rows"]
        check("la API solo le devuelve lo suyo", rows and not any("Kant" in json.dumps(x) for x in rows))
        click(d1, '[data-action=settings]'); click(d1, '[data-action=delete-account]'); click(d1, '[data-action=confirm][data-v="1"]')
        check("borrar cuenta: borra usuaria, sesiones y datos", wait_for(d1, lambda: uid("ana@test.es") == "" and paths("ana@test.es") == [""], 8000))
        check("y vuelve al acceso con aviso", wait_for(d1, lambda: "Cuenta borrada." in text(d1), 8000))
        check("Julia no ha perdido nada", n_subj("julia@test.es") == 3)

        print("\n[cuentas] Email ya registrado")
        d5 = device("otro"); d5.goto("http://repaso.test/"); wait_for(d5, lambda: d5.locator('[data-action=auth-tab][data-tab=signup]').count() == 1)
        signup(d5, "julia@test.es", "otra12345", "Julia")
        check("avisa y vuelve al primer paso", wait_for(d5, lambda: "Ya hay una cuenta con ese email" in text(d5) and d5.locator("#pf-email").count() == 1))

        print("\n[cuentas] Cuenta sin perfil")
        sql("delete from rp_docs where user_id = (select id from rp_users where email='julia@test.es') and path = 'profile'")
        d6 = device("nuevo"); d6.goto("http://repaso.test/"); wait_for(d6, lambda: d6.locator('[data-action=auth-tab][data-tab=login]').count() == 1)
        login(d6, "julia@test.es", "Provisional9")
        check("la manda a terminar el registro", wait_for(d6, lambda: "Has entrado como" in text(d6) and d6.locator("#pf-email").count() == 0))
        d6.fill("#pf-name", "Julia"); d6.check("#pf-ok"); click(d6, '#signup button[type=submit]')
        d6.select_option("#pf-region", "Canarias"); click(d6, '#signup button[type=submit]'); click(d6, '#signup button[type=submit]'); click(d6, '#signup button[type=submit]')
        check("y entra", wait_for(d6, lambda: "Hola, Julia" in text(d6)))

        check("sin errores de JavaScript", not errors, "\n".join(errors)[:800])
        b.close()
    print(f"\n{sum(results)}/{len(results)} comprobaciones correctas (cuentas)")
    sys.exit(0 if all(results) else 1)

if __name__ == "__main__":
    try: main()
    finally: stop()
