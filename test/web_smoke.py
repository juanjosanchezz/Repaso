"""Prueba de la versión web (Vercel): dist/index.html con web/claude-web.js.

Run:  node scripts/build-web.js && python3 test/web_smoke.py
La función /api/claude se simula interceptando la petición y devolviendo un stream SSE
con el mismo formato que la API de Claude (texto, JSON y llamadas a herramientas).
"""
import json, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call(["node", os.path.join(ROOT, "scripts", "build-web.js")], stdout=subprocess.DEVNULL)
STUBS = json.loads(subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "test", "lib-stubs.js")]))
DIST = os.path.join(ROOT, "dist")
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("  ok  " if cond else "  FAIL") + f"  {name}" + (f"  — {detail}" if detail and not cond else ""))

def sse(blocks, stop="end_turn"):
    ev = [{"type": "message_start", "message": {"id": "m", "content": []}}]
    for i, b in enumerate(blocks):
        if b["type"] == "text":
            ev.append({"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            for k in range(0, len(b["text"]), 40): ev.append({"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": b["text"][k:k+40]}})
        else:
            ev.append({"type": "content_block_start", "index": i, "content_block": {"type": "tool_use", "id": b["id"], "name": b["name"], "input": {}}})
            j = json.dumps(b["input"]); ev.append({"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta", "partial_json": j[:10]}}); ev.append({"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta", "partial_json": j[10:]}})
        ev.append({"type": "content_block_stop", "index": i})
    ev.append({"type": "message_delta", "delta": {"stop_reason": stop}}); ev.append({"type": "message_stop"})
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev)

calls = []
MODE = {"fail": None}
def api(route):
    req = route.request
    body = json.loads(req.post_data or "{}")
    calls.append({"code": req.headers.get("x-repaso-code"), "body": body})
    if req.headers.get("x-repaso-code") != "julia2026": return route.fulfill(status=401, content_type="application/json", body='{"error":"bad_code"}')
    if MODE["fail"] == "minute":
        MODE["fail"] = None
        return route.fulfill(status=429, content_type="application/json", body='{"error":"rate_limited","daily":false,"retry_after":5}')
    if MODE["fail"] == "daily": return route.fulfill(status=429, content_type="application/json", body='{"error":"rate_limited","daily":true}')
    if MODE["fail"] == "missing_key": return route.fulfill(status=500, content_type="application/json", body='{"error":"missing_key"}')
    if MODE["fail"] == "no_credit": return route.fulfill(status=400, content_type="application/json", body='{"error":"upstream","detail":"Your credit balance is too low to access the Anthropic API."}')
    msgs = body["messages"]; last = msgs[-1]
    text = " ".join(c.get("text", "") for c in last["content"] if isinstance(c, dict))
    if any(c.get("type") == "tool_result" for c in last["content"]):
        return route.fulfill(status=200, content_type="text/event-stream", body=sse([{"type": "text", "text": "Hecho: lo he apuntado en tu calendario."}]))
    if body.get("tools") and "Apunta que" in text:
        return route.fulfill(status=200, content_type="text/event-stream", body=sse([{"type": "text", "text": "Vale, lo apunto."}, {"type": "tool_use", "id": "tu_1", "name": "recordar", "input": {"dato": "Le cuesta Kant"}}], "tool_use"))
    if '"cards":[' in text:
        return route.fulfill(status=200, content_type="text/event-stream", body=sse([{"type": "text", "text": 'Aquí está: ```json\n{"cards":[{"q":"¿Qué es el turnismo?","a":"Alternancia pactada.","tag":"Tema 1"}]}\n```'}]))
    return route.fulfill(status=200, content_type="text/event-stream", body=sse([{"type": "text", "text": "# Apuntes\n\n## Restauración\n**Turnismo**: alternancia pactada entre partidos."}]))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        def route(r):
            u = r.request.url
            if u.endswith("/api/claude"): return api(r)
            for k, f in [("pdf.worker", "pdfWorker"), ("pdf.min", "pdf"), ("marked", "marked"), ("purify", "purify"), ("mammoth", "mammoth"), ("jszip", "jszip"), ("html2pdf", "html2pdf"), ("pptxgen", "pptx")]:
                if k in u: return r.fulfill(status=200, content_type="application/javascript", body=STUBS[f])
            if u.startswith("http://repaso.test/"):
                path = u.split("http://repaso.test/")[1].split("?")[0] or "index.html"
                fp = os.path.join(DIST, path)
                if os.path.isfile(fp): return r.fulfill(status=200, content_type="text/html", body=open(fp).read())
            if "fonts.g" in u: return r.fulfill(status=200, content_type="text/css", body="")
            return r.abort()
        ctx.route("**/*", route)
        pg = ctx.new_page(); errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and not any(c in m.text for c in ("401", "400", "429", "500")) else None)  # el 401 antes del código es esperado
        W = lambda ms=250: pg.wait_for_timeout(ms)
        def click(sel, i=0): pg.locator(sel).nth(i).click(); W(150)
        def wait_for(fn, t=6000):
            s = time.time()
            while time.time() - s < t / 1000:
                try:
                    if fn(): return True
                except Exception: pass
                W(100)
            return False
        pg.goto("http://repaso.test/")
        print("\n[web] Arranque y registro")
        check("modo web activo", wait_for(lambda: pg.evaluate("window.__REPASO_WEB__ === true && typeof WEB !== 'undefined' && WEB")))
        check("bienvenida", wait_for(lambda: "Te damos la bienvenida" in pg.inner_text("body")))
        check("texto de privacidad de la web", "se guardan en este navegador" in pg.inner_text("body"))
        click('[data-action=auth-tab][data-tab=signup]'); pg.fill("#pf-name", "Julia"); pg.check("#pf-ok"); click('#signup button[type=submit]')
        pg.select_option("#pf-region", "Canarias"); click('#signup button[type=submit]'); click('#signup button[type=submit]'); click('#signup button[type=submit]')
        check("crea la cuenta", wait_for(lambda: "Hola, Julia" in pg.inner_text("body")))
        print("\n[web] Los datos sobreviven a recargar (IndexedDB)")
        pg.reload(); check("sigue dentro tras recargar", wait_for(lambda: "Hola, Julia" in pg.inner_text("body"), 8000))
        check("asignaturas guardadas", pg.locator(".subj:not(.add)").count() == 3)
        print("\n[web] Lo que solo existe dentro de Claude no aparece")
        click('[data-action=open-subject]', 0)
        check("sin importar de un compañero", pg.locator('[data-action=import]').count() == 0)
        print("\n[web] Claude vía /api/claude: código de acceso, streaming y JSON")
        click('[data-action=subj-tab][data-tab=chat]'); click('#r-tab [data-action=chat-new]')
        pg.fill("#chat-input", "¿Qué es el turnismo?"); pg.press("#chat-input", "Enter")
        check("pide el código de acceso", wait_for(lambda: pg.locator("#web-code").count() == 1))
        pg.fill("#web-code", "julia2026"); pg.locator("#web-code").press("Enter")
        check("responde en streaming tras el código", wait_for(lambda: "alternancia pactada" in pg.inner_text("#r-chat-log")))
        check("envía el código y el nivel", calls[-1]["code"] == "julia2026" and calls[-1]["body"]["tier"] in ("default", "quick", "complex"))
        check("manda las herramientas del chat", {t["name"] for t in calls[-1]["body"].get("tools", [])} >= {"recordar", "apuntar_examen", "apuntar_tarea"})
        print("\n[web] Herramientas: Claude pide una, la app la ejecuta y responde")
        pg.fill("#chat-input", "Apunta que me cuesta Kant"); pg.press("#chat-input", "Enter")
        check("ejecuta la herramienta y sigue", wait_for(lambda: "Recordado: Le cuesta Kant" in pg.inner_text("#r-chat-log") and "Hecho: lo he apuntado" in pg.inner_text("#r-chat-log")))
        tr = [c for c in calls if any(x.get("type") == "tool_result" for x in c["body"]["messages"][-1]["content"])]
        check("devuelve el resultado a Claude", tr and tr[-1]["body"]["messages"][-1]["content"][0]["content"] == "guardado")
        print("\n[web] Si falla el servidor, no habla de la cuenta de Claude de la alumna")
        for mode, want in [("missing_key", "falta GEMINI_API_KEY"), ("no_credit", "sin saldo de Claude")]:
            MODE["fail"] = mode; n = pg.locator(".msg").count()
            pg.fill("#chat-input", "Hola"); pg.press("#chat-input", "Enter")
            ok = wait_for(lambda: want in pg.inner_text("#r-chat-log"))
            check(f"{mode}: explica la causa real", ok and "tu cuenta" not in pg.inner_text("#r-chat-log").lower() and "permiso" not in pg.inner_text("#r-chat-log").lower(), pg.inner_text("#r-chat-log")[-300:])
        MODE["fail"] = None
        print("\n[web] Límite de la IA gratuita: espera y sigue, sin error")
        MODE["fail"] = "minute"; before = len(calls)
        pg.fill("#chat-input", "¿Qué es el turnismo?"); pg.press("#chat-input", "Enter")
        check("avisa de que espera unos segundos", wait_for(lambda: "necesita 5 segundos" in pg.inner_text("body"), 4000))
        check("y responde sola, sin error", wait_for(lambda: pg.inner_text("#r-chat-log").count("alternancia pactada") >= 2, 12000) and len(calls) == before + 2)
        MODE["fail"] = "daily"
        pg.fill("#chat-input", "Otra"); pg.press("#chat-input", "Enter")
        check("límite del día: lo explica y no reintenta", wait_for(lambda: "cupo gratuito de la IA de hoy" in pg.inner_text("#r-chat-log")))
        MODE["fail"] = None
        print("\n[web] Copia de seguridad (descarga real)")
        click('[data-action=settings]')
        with pg.expect_download() as d: click('[data-action=backup-export]')
        path = d.value.path(); data = json.load(open(path))
        check("descarga la copia", d.value.suggested_filename.startswith("repaso-copia-") and data["docs"]["profile"]["name"] == "Julia" and any(k.startswith("subjects/") for k in data["docs"]))
        check("sin errores de JavaScript", not errors, "\n".join(errors)[:600])
        b.close()
    print(f"\n{sum(results)}/{len(results)} comprobaciones correctas (web)")
    sys.exit(0 if all(results) else 1)

if __name__ == "__main__":
    main()
