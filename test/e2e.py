"""End-to-end test of Repaso against a mocked Claude runtime.

Run:  python3 test/e2e.py            (from the repo root)
Needs: playwright for Python with Chromium, and node (to read lib-stubs.js).

It loads src/repaso.html exactly as the artifact skeleton would wrap it, injects
test/mock-claude.js before the page runs, serves stand-ins for the CDN libraries and
walks every user flow. Any page error, console error or failed assertion fails the run.
"""
import json, os, subprocess, sys, tempfile, time, datetime as dt
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "repaso.html") if os.path.exists(os.path.join(ROOT, "src", "repaso.html")) else os.path.join(ROOT, "repaso.html")
MOCK = open(os.path.join(ROOT, "test", "mock-claude.js")).read()
STUBS = json.loads(subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "test", "lib-stubs.js")]))
OUT = os.environ.get("E2E_OUT") or tempfile.mkdtemp(prefix="repaso-e2e-")
os.makedirs(OUT, exist_ok=True)
TODAY = dt.date.today()
iso = lambda d: d.isoformat()

SKELETON = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}'
            '[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>')

def stub_for(url):
    for key, frag in [("pdf.worker", "pdfWorker"), ("pdf.min", "pdf"), ("marked", "marked"), ("purify", "purify"), ("mammoth", "mammoth"), ("jszip", "jszip"), ("html2pdf", "html2pdf")]:
        if key in url: return STUBS[frag]
    return None

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("  ok  " if cond else "  FAIL") + f"  {name}" + (f"  — {detail}" if detail and not cond else ""))

def main():
    page_file = os.path.join(OUT, "index.html")
    open(page_file, "w").write(SKELETON + open(SRC).read() + "</body></html>")
    files = {}
    def mk(name, data): p = os.path.join(OUT, name); open(p, "wb").write(data); files[name] = p
    mk("tema1-restauracion.txt", ("Tema 1. La Restauración (1874-1931). El turnismo fue la alternancia pactada entre conservadores y liberales. " * 40).encode())
    mk("tema2.pdf", b"%PDF-1.4 fake")
    mk("tema2-word.docx", b"PK\x03\x04 fake docx")
    mk("diapos.pptx", b"PK\x03\x04 fake pptx")
    mk("foto-apuntes.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    mk("enunciado.txt", "Presentación de 10 minutos sobre la Segunda República, en grupo.".encode())
    mk("viejo.doc", b"old")

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=False)
        ctx.add_init_script(MOCK)
        def route(r):
            body = stub_for(r.request.url)
            if body is not None: return r.fulfill(status=200, content_type="application/javascript", body=body)
            if "fonts.g" in r.request.url: return r.fulfill(status=200, content_type="text/css", body="")
            return r.abort()
        ctx.route("http*://**/*", route)
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errors.append("console.error: " + m.text) if m.type == "error" else None)
        pg.goto("file://" + page_file)
        W = lambda ms=250: pg.wait_for_timeout(ms)
        def click(sel, idx=0): pg.locator(sel).nth(idx).click(); W(150)
        def text(): return pg.inner_text("body")
        def ltext(): return text().lower()
        def store(): return pg.evaluate("Object.fromEntries([...window.__mock.store.entries()])")
        def coll(name): return {k: v for k, v in store().items() if f"/profile/{name}/" in k and k.count("/") == 5}
        def shot(n): pg.screenshot(path=os.path.join(OUT, n + ".png"), full_page=True)
        def sheet_open(): return pg.locator("#sheet-root .sheet").count() > 0
        def wait_for(fn, timeout=6000, step=100):
            t = time.time()
            while time.time() - t < timeout / 1000:
                try:
                    if fn(): return True
                except Exception: pass
                W(step)
            return False

        print("\n[1] Acceso: bienvenida → registro en 4 pasos")
        check("muestra bienvenida antes de la app", wait_for(lambda: "Te damos la bienvenida" in text()))
        shot("01-welcome")
        click('[data-action=auth-tab][data-tab=signup]')
        check("paso 1 visible", "paso 1 de 4" in text().lower())
        pg.fill("#pf-name", "")
        click('#signup button[type=submit]')
        check("no avanza sin nombre", "paso 1 de 4" in text().lower())
        pg.fill("#pf-name", "Julia")
        click('#signup button[type=submit]')
        check("no avanza sin aceptar", "paso 1 de 4" in text().lower())
        pg.check("#pf-ok"); click('#signup button[type=submit]')
        check("paso 2 visible", "paso 2 de 4" in text().lower())
        click('#signup button[type=submit]')
        check("pide comunidad", "paso 2 de 4" in text().lower())
        pg.select_option("#pf-region", "Canarias"); W()
        click('[data-action=su-back]')
        check("atrás conserva el nombre", pg.input_value("#pf-name") == "Julia")
        click('#signup button[type=submit]'); click('#signup button[type=submit]')
        check("paso 3 visible", "paso 3 de 4" in text().lower())
        click('[data-action=pf-pick][data-name="Inglés II"]')
        pg.fill("#pf-custom", "Tutoría"); pg.press("#pf-custom", "Enter"); W()
        check("añade asignatura propia con Enter", pg.locator('[data-action=pf-pick][data-name="Tutoría"][aria-pressed=true]').count() == 1)
        click('#signup button[type=submit]')
        check("paso 4 visible", "paso 4 de 4" in text().lower())
        click('[data-action=pf-style][data-k=visual]'); click('[data-action=pf-accent][data-k=pink]')
        check("vista previa del color", pg.evaluate("document.documentElement.dataset.accent") == "pink")
        shot("02-signup-step4")
        click('#signup button[type=submit]')
        check("entra en la app", wait_for(lambda: "Hola, Julia" in text()))
        prof = store().get("data/users/u_testuser00000000000aa/profile", {})
        check("perfil guardado con comunidad y prefs", prof.get("region") == "Canarias" and prof.get("prefs", {}).get("accent") == "pink" and prof.get("style") == "visual", json.dumps(prof)[:200])
        subs = coll("subjects")
        check("crea 5 asignaturas", len(subs) == 5, str([v["name"] for v in subs.values()]))
        shot("03-home-empty")

        print("\n[2] Subir apuntes con organización automática")
        click('[data-action=open-subject]', 0); W(300)
        check("abre asignatura", "Temas" in text() and "Pregúntale" in text())
        click('[data-action=upload][data-subject]')
        pg.set_input_files("#up-files", [files[n] for n in ["tema1-restauracion.txt", "tema2.pdf", "tema2-word.docx", "diapos.pptx", "foto-apuntes.png", "viejo.doc"]]); W()
        pg.fill("#up-date", iso(TODAY + dt.timedelta(days=3))); W(100)
        click('[data-action=up-start]')
        check("llega a revisión", wait_for(lambda: pg.locator('[data-action=up-save]').count() > 0, 8000))
        t = text()
        check("formato antiguo rechazado con mensaje claro", "formato antiguo" in t)
        check("propone temas", "Nuevo: Tema 1 · La Restauración" in pg.inner_html("#sheet-root"))
        shot("04-upload-review")
        click('[data-action=up-save]')
        check("guarda y cierra", wait_for(lambda: not sheet_open() and "Tema 1 · La Restauración" in text(), 8000))
        fl = coll("files"); tp = coll("topics"); ex = coll("exams")
        check("5 archivos guardados", len(fl) == 5, str(len(fl)))
        check("2 temas creados", len(tp) == 2, str([v["name"] for v in tp.values()]))
        check("fecha de examen crea un examen", len(ex) == 1 and len(list(ex.values())[0]["topicIds"]) == 2, json.dumps(ex)[:300])
        check("OCR de la foto pidió imagen", any(c["images"] for c in pg.evaluate("window.__mock.calls.sample")))
        check("texto troceado guardado", any("/texts/" in k for k in store()))
        shot("05-topics")

        print("\n[3] Preparar material (las 10 clases)")
        click('[data-action=generate]', 0)
        check("muestra fase y PAU", "Con criterios de la PAU de Canarias" in text() and "Modo examen" in text())
        check("manera por defecto = visual", pg.locator('[data-action=gen-approach][data-k=visual][aria-pressed=true]').count() == 1)
        for k in ["notes", "explain", "flashcards", "quiz", "exam", "global", "plan"]:
            click(f'[data-action=gen-type][data-t={k}]')
        check("10 tipos elegidos", "Preparar 10" in pg.inner_text("[data-action=gen-start]"))
        click('[data-action=gen-start]')
        check("todo listo", wait_for(lambda: "Material listo" in text(), 15000))
        mats = coll("materials")
        check("10 materiales guardados", len(mats) == 10, str(sorted(v["type"] for v in mats.values())))
        check("srs creado para flashcards", len(coll("srs")) == 1)
        prompts = [c["p"] for c in pg.evaluate("window.__mock.calls.sample.concat(window.__mock.calls.json)")]
        gen = [x for x in prompts if "TAREA:" in x]
        check("prompts con nivel PAU + comunidad + fase + estilo + info del examen", gen and all("PAU" in x and "Canarias" in x and "FASE:" in x and "visual" in x and "Sobre el examen que prepara" in x for x in gen))
        glob = [x for x in gen if "EXAMEN GLOBAL" in x]
        check("examen global usa todos los temas", glob and "Tema 1" in glob[0] and "Tema 2" in glob[0])
        shot("06-generated")
        click('[data-action=close-sheet]')

        print("\n[4] Visores de material")
        click('[data-action=subj-tab][data-tab=materials]'); W(300)
        types = {v["type"]: k.split("/")[-1] for k, v in coll("materials").items()}
        for ty in ["notes", "outline", "mindmap", "explain", "cheat", "plan"]:
            pg.locator(f'[data-action=open-material][data-id="{types[ty]}"]').click(); W(200)
            ok = pg.locator(".viewer").count() == 1 and (pg.locator(".viewer .md").count() > 0 or pg.locator(".mm").count() > 0)
            check(f"abre {ty}", ok)
            if ty == "mindmap": shot("07-mindmap")
            click('[data-action=close-viewer]')
        # PDF
        pg.locator(f'[data-action=open-material][data-id="{types["notes"]}"]').click(); W(200)
        click('.viewer [data-action=pdf]'); W(500)
        check("descarga PDF", len(pg.evaluate("window.__mock.calls.downloads")) == 1)
        # share + import
        click('[data-action=share]')
        check("genera código para compartir", wait_for(lambda: pg.locator("#share-code").count() == 1))
        code = pg.input_value("#share-code")
        check("doc compartido en shared/<uid>/items", any(k.startswith("shared/u_testuser00000000000aa/items/") for k in store()))
        click('[data-action=close-sheet]'); click('[data-action=close-viewer]')
        click('[data-action=import]'); pg.fill("#imp-code", "basura"); click('#import-form button[type=submit]')
        check("código inválido avisa", "no es válido" in text())
        pg.fill("#imp-code", code); click('#import-form button[type=submit]')
        check("encuentra el material compartido", wait_for(lambda: pg.locator('[data-action=imp-save]').count() == 1))
        click('[data-action=imp-save]')
        check("importa una copia", wait_for(lambda: len(coll("materials")) == 11))

        # flashcards
        pg.locator(f'[data-action=open-material][data-id="{types["flashcards"]}"]').click(); W(200)
        check("flashcards: repaso de hoy", "Repaso de hoy" in text())
        click('[data-action=fc-flip]'); check("gira la tarjeta", pg.locator(".fc.back").count() == 1)
        pg.locator('[data-action=fc-flip]').focus(); pg.keyboard.press("Space"); W(150)
        check("espacio sobre el botón gira una sola vez", pg.locator(".fc.back").count() == 0)
        for i in range(6):
            click('[data-action=fc-mark][data-v="%d"]' % (1 if i % 2 == 0 else 0))
        for i in range(3):
            if pg.locator('[data-action=fc-mark]').count(): click('[data-action=fc-mark][data-v="1"]')
        check("termina la ronda", "terminado" in ltext())
        click('.viewer [data-action=close-viewer]'); W(1800)
        srs = list(coll("srs").values())[0]
        check("progreso SRS guardado", len(srs.get("cards", {})) == 6 and all("due" in c and "f" in c for c in srs["cards"].values()), json.dumps(srs)[:200])

        # quiz
        pg.locator(f'[data-action=open-material][data-id="{types["quiz"]}"]').click(); W(200)
        for i in range(4):
            click('[data-action=q-pick]', 0); click('[data-action=q-next]')
        check("resultado del test", wait_for(lambda: "resultado" in ltext()))
        W(500); click('[data-action=close-viewer]')
        stats = store().get("data/users/u_testuser00000000000aa/profile/meta/stats", {})
        check("resultado en estadísticas", len(stats.get("results", [])) == 1 and stats["days"].get(iso(TODAY), 0) > 0, json.dumps(stats)[:200])

        # exam + sim
        pg.locator(f'[data-action=open-material][data-id="{types["exam"]}"]').click(); W(200)
        for tab in ["exam", "sol", "fix", "sim"]:
            click(f'[data-action=ex-tab][data-tab={tab}]')
        click('[data-action=sim-start]')
        check("cronómetro en marcha", pg.locator("#sim-timer").count() == 1)
        check("soluciones bloqueadas", pg.locator('[data-action=ex-tab][data-tab=sol][disabled]').count() == 1)
        pg.fill("#sim-ans", "1. El turnismo era... 2. La fuente..."); W(600)
        click('[data-action=sim-finish]')
        click('[data-action=sim-grade]')
        check("nota del simulacro", wait_for(lambda: "nota del simulacro" in ltext()))
        check("soluciones desbloqueadas", pg.locator('[data-action=ex-tab][data-tab=sol][disabled]').count() == 0)
        shot("08-sim-result")
        click('[data-action=ex-tab][data-tab=fix]'); pg.fill("#fix-q", "Pregunta 1"); pg.fill("#fix-a", "Respuesta"); click('#fix-form button[type=submit]')
        check("corrígeme responde", wait_for(lambda: "Apuntes" in pg.inner_text("#fix-out")))
        click('[data-action=close-viewer]')
        # timer expiry path
        pg.locator(f'[data-action=open-material][data-id="{types["global"]}"]').click(); W(200)
        click('[data-action=ex-tab][data-tab=sim]'); click('[data-action=sim-start]')
        pg.evaluate(f"(()=>{{const k='repaso.sim.{types['global']}';const s=JSON.parse(localStorage.getItem(k));s.endsAt=Date.now()+1200;localStorage.setItem(k,JSON.stringify(s));}})()")
        click('[data-action=ex-tab][data-tab=sim]')
        check("se acaba el tiempo solo", wait_for(lambda: "Se acabó el tiempo" in text(), 4000))
        click('[data-action=close-viewer]')

        print("\n[5] Tareas")
        click('[data-action=go-tasks]')
        check("página de tareas", "Lo que tienes que hacer" in text())
        pg.fill("#qt-title", "Ejercicios pág. 45"); pg.fill("#qt-due", iso(TODAY - dt.timedelta(days=1))); click('#quick-task button[type=submit]')
        check("alta rápida", wait_for(lambda: "Ejercicios pág. 45" in text()) and "atrasadas" in ltext())
        click('[data-action=task-new]')
        pg.fill("#tk-title", "Presentación Segunda República")
        pg.select_option("#tk-type", "Presentación"); W(150)
        pg.fill("#tk-due", iso(TODAY + dt.timedelta(days=5))); pg.dispatch_event("#tk-due", "change"); W(150)
        pg.select_option("#tk-subject", index=1); W(100)
        pg.fill("#tk-notes", "10 minutos, en grupo")
        pg.fill("#tk-item", "Elegir el tema"); pg.press("#tk-item", "Enter"); W(150)
        check("conserva lo escrito al añadir paso", pg.input_value("#tk-title") == "Presentación Segunda República" and "Elegir el tema" in pg.inner_text("#sheet-root"))
        click('#task-form button[type=submit]')
        check("guarda y deja adjuntar", wait_for(lambda: pg.locator("#tk-files").count() == 1))
        pg.set_input_files("#tk-files", [files["enunciado.txt"]])
        check("adjunta archivo", wait_for(lambda: "enunciado.txt" in pg.inner_text("#sheet-root") and pg.locator("#tk-files").count() == 1, 5000))
        click('[data-action=tk-help][data-mode=guide]')
        check("guion de presentación", wait_for(lambda: "Quitar" in pg.inner_text("#sheet-root"), 5000))
        guide_prompt = [c["p"] for c in pg.evaluate("window.__mock.calls.sample") if "GUION" in c["p"]]
        check("prompt usa adjunto y notas", guide_prompt and "Segunda República, en grupo" in guide_prompt[-1] and "10 minutos" in guide_prompt[-1])
        click('[data-action=tk-help][data-mode=steps]')
        check("divide en pasos", wait_for(lambda: pg.locator(".check-list li").count() == 4, 5000))
        click('[data-action=tk-check]', 0)
        click('[data-action=tk-help-pdf]'); W(400)
        check("PDF de la ayuda", len(pg.evaluate("window.__mock.calls.downloads")) == 2)
        click('[data-action=task-calendar]'); W(300)
        mc = pg.evaluate("window.__mock.calls.mcp")
        check("aviso de entrega en Google Calendar", mc and mc[-1]["input"]["summary"].startswith("Entregar:") and mc[-1]["input"]["startTime"].endswith("17:00:00"), json.dumps(mc)[:200])
        shot("09-task-sheet")
        click('#task-form button[type=submit]'); W(300)
        tks = coll("tasks"); pres = [v for v in tks.values() if v["title"].startswith("Presentación")][0]
        check("tarea con pasos, adjunto y ayuda", len(pres["checklist"]) == 4 and pres["fileCount"] == 1 and pres["help"] and pres["checklist"][0]["done"], json.dumps(pres)[:300])
        click('[data-action=task-toggle]', 0)
        check("marcar como hecha", wait_for(lambda: any(v.get("status") == "done" for v in coll("tasks").values())))
        click('[data-action=task-showdone]'); check("muestra hechas", pg.locator(".task.done").count() >= 1)
        shot("10-tasks")

        print("\n[6] Calendario y notas")
        click('[data-action=go-calendar]')
        check("calendario con examen y entrega", pg.locator(".cal-x").count() >= 2 and pg.locator(".cal-x.task").count() >= 1)
        click('[data-action=cal-move][data-n="1"]'); click('[data-action=cal-move][data-n="-1"]')
        yday = iso(TODAY - dt.timedelta(days=2))
        if pg.locator(f'[data-action=exam-new][data-date="{yday}"]').count() == 0: click('[data-action=cal-move][data-n="-1"]')
        click(f'[data-action=exam-new][data-date="{yday}"]')
        pg.select_option("#ex-kind", "Parcial"); W(100); pg.fill("#ex-title", "Parcial de prueba")
        click('#exam-form button[type=submit]')
        check("examen pasado → pendiente de nota", wait_for(lambda: "pendientes de nota" in ltext()))
        click('[data-action=exam-grade]')
        pg.fill("#gr-grade", "11"); click('#grade-form button[type=submit]')
        check("rechaza nota > máximo", sheet_open())
        pg.fill("#gr-grade", "7.5"); click('#grade-form button[type=submit]')
        check("guarda nota", wait_for(lambda: any(v.get("grade") == 7.5 for v in coll("exams").values())))
        check("nota en la lista", "7,5" in text())
        fut = [k.split("/")[-1] for k, v in coll("exams").items() if v["date"] >= iso(TODAY)][0]
        click(f'[data-action=exam-open][data-id="{fut}"]')
        click('#sheet-root [data-action=calendar]'); W(400)
        mc = pg.evaluate("window.__mock.calls.mcp")
        check("avisos de examen (víspera + día)", len([c for c in mc if c["input"]["summary"].startswith(("Repaso final", "Examen", "Parcial"))]) >= 2)
        if sheet_open(): click('[data-action=close-sheet]')
        shot("11-calendar")

        print("\n[7] Progreso, chat, repaso diario")
        click('[data-action=go-stats]')
        check("progreso con notas reales", "Notas de tus exámenes" in text() and "Examen real" in text())
        shot("12-stats")
        click('[data-action=open-subject]', 0); click('[data-action=subj-tab][data-tab=chat]')
        pg.fill("#chat-input", "¿Qué es el turnismo?"); pg.press("#chat-input", "Enter")
        check("chat responde", wait_for(lambda: pg.locator(".msg.ai .md h2").count() > 0 or "Apuntes" in pg.inner_text("#r-chat-log")))
        click('[data-action=subj-tab][data-tab=tasks]')
        check("pestaña tareas de la asignatura", pg.locator("#quick-task").count() == 1)
        click('[data-action=go-home]')
        check("inicio con tareas, examen y repaso", "tareas" in ltext() and "próximos exámenes" in ltext() and "repaso de hoy" in ltext())
        shot("13-home-full")
        if pg.locator('[data-action=daily-review]').count():
            click('[data-action=daily-review]')
            check("repaso diario abre tarjetas", wait_for(lambda: pg.locator('[data-action=fc-mark]').count() > 0 or "terminado" in ltext()))
            click('.viewer [data-action=close-viewer]')

        print("\n[8] Personalizar")
        click('[data-action=settings]')
        click('[data-action=pf-accent][data-k=green]'); click('[data-action=pf-size][data-k=lg]')
        pg.uncheck("#pf-home-review"); pg.select_option("#pf-new", "10"); pg.select_option("#pf-hour", "21")
        click('#settings-form button[type=submit]'); W(300)
        prof = store()["data/users/u_testuser00000000000aa/profile"]
        check("preferencias guardadas", prof["prefs"]["accent"] == "green" and prof["prefs"]["size"] == "lg" and prof["prefs"]["home"]["review"] is False and prof["prefs"]["newPerDay"] == 10 and prof["prefs"]["remindHour"] == 21, json.dumps(prof["prefs"]))
        check("aplicadas en la página", pg.evaluate("document.documentElement.dataset.accent+','+document.documentElement.dataset.size") == "green,lg")
        check("inicio sin repaso de hoy", "repaso de hoy" not in pg.inner_text("#r-home").lower() and "próximos exámenes" in pg.inner_text("#r-home").lower())
        click('[data-action=settings]'); click('[data-action=pf-accent][data-k=orange]'); click('[data-action=close-sheet]')
        check("cancelar revierte el color", pg.evaluate("document.documentElement.dataset.accent") == "green")
        click('[data-action=settings]'); pg.select_option("#pf-course", "Universidad"); W(200)
        pg.fill("#pf-uni", "Universidad de La Laguna"); pg.fill("#pf-degree", "Grado en Psicología"); pg.select_option("#pf-year", "2º")
        click('#settings-form button[type=submit]'); W(300)
        prof = store()["data/users/u_testuser00000000000aa/profile"]
        check("cambio a universidad limpia comunidad/PAU", prof["course"] == "Universidad" and prof.get("region") is None and prof.get("pau") is None and prof["uni"]["degree"] == "Grado en Psicología")
        lvl = pg.evaluate("AI.level()")
        check("criterios de la carrera", "Psicología" in lvl and "guía docente" in lvl)

        print("\n[9] Móvil y tema oscuro")
        mob = ctx.new_page(); mob.set_viewport_size({"width": 390, "height": 844})
        mob.emulate_media(color_scheme="dark")
        mob.on("pageerror", lambda e: errors.append("pageerror(mobile): " + str(e)))
        mob.goto("file://" + page_file)  # same origin → same localStorage session; fresh mock store
        mob.wait_for_timeout(600)
        check("móvil: bienvenida sin scroll horizontal", mob.evaluate("document.documentElement.scrollWidth") <= 390)
        mob.screenshot(path=os.path.join(OUT, "14-mobile-welcome-dark.png"), full_page=True)
        mob.close()
        pg.set_viewport_size({"width": 390, "height": 844}); pg.emulate_media(color_scheme="dark"); W(300)
        for v in ["go-home", "go-tasks", "go-calendar", "go-stats"]:
            click(f'[data-action={v}]'); W(200)
            sw = pg.evaluate("document.documentElement.scrollWidth")
            check(f"móvil {v}: sin scroll horizontal", sw <= 390, str(sw)); shot(f"15-mobile-{v}")
        click('[data-action=open-subject]', 0); W(200)
        check("móvil asignatura: sin scroll horizontal", pg.evaluate("document.documentElement.scrollWidth") <= 390)
        click('[data-action=subj-tab][data-tab=materials]'); click('[data-action=open-material]', 0)
        check("móvil visor: sin scroll horizontal", pg.evaluate("document.documentElement.scrollWidth") <= 390)
        click('[data-action=close-viewer]')
        pg.set_viewport_size({"width": 1280, "height": 900}); pg.emulate_media(color_scheme="light")

        print("\n[10] Errores de guardado, cerrar sesión y borrar")
        click('[data-action=go-tasks]')
        pg.evaluate("window.__mock.failNext='quota_exceeded'")
        pg.fill("#qt-title", "Fallará"); click('#quick-task button[type=submit]'); W(300)
        check("aviso de espacio lleno", "Se ha llenado el espacio" in pg.inner_text("#toast"))
        click('[data-action=settings]'); click('[data-action=logout]')
        check("cerrar sesión vuelve al acceso", wait_for(lambda: "Te damos la bienvenida" in text()) and pg.evaluate("document.documentElement.dataset.accent") == "blue")
        click('[data-action=auth-tab][data-tab=login]')
        check("login muestra la cuenta", "Entrar como Julia" in text())
        click('[data-action=login]')
        check("vuelve a entrar", wait_for(lambda: "Hola, Julia" in text() or "Temas" in text()))
        click('[data-action=open-subject]', 0); click('[data-action=subject-menu]'); click('[data-action=subject-delete]'); click('[data-action=confirm][data-v="1"]')
        check("borrar asignatura limpia sus datos", wait_for(lambda: not any(v.get("subjectId") == list(subs.keys())[0].split("/")[-1] for v in list(coll("files").values()) + list(coll("materials").values()) + list(coll("exams").values())), 8000))
        click('[data-action=settings]'); click('[data-action=delete-account]'); click('[data-action=confirm][data-v="1"]')
        check("borrar cuenta deja el almacén vacío", wait_for(lambda: not [k for k in store() if k.startswith("data/users/u_testuser") or k.startswith("shared/u_testuser")], 10000), str([k for k in store()][:5]))
        check("vuelve a la bienvenida", wait_for(lambda: "Te damos la bienvenida" in text()))

        mock_errors = pg.evaluate("window.__mock.errors")
        check("sin errores en listeners", not mock_errors, "; ".join(mock_errors)[:300])
        check("sin errores de JavaScript ni de consola", not errors, "\n".join(errors)[:800])
        b.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results)-len(failed)}/{len(results)} comprobaciones correctas · capturas en {OUT}")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
