# CLAUDE.md — cómo trabajar en Repaso

## Reglas del proyecto

- La app es **un único archivo**: `src/repaso.html`. No lo partas en varios ni añadas `<!doctype>`, `<html>`, `<head>` ni `<body>`: la plataforma de artifacts los pone al publicar.
- Respeta los módulos numerados del `<script>` (ver `ARCHITECTURE.md`). Código nuevo en el módulo que corresponda, con el mismo estilo.
- Librerías externas solo desde cdnjs, con versión exacta, cargadas con `loadLib()` en el momento de usarlas.
- Colores siempre con tokens CSS (`var(--…)`), definidos en `:root` y redefinidos en los dos bloques oscuros. Los acentos personalizables van en los bloques `[data-accent=…]`.
- Todo texto dinámico pasa por `esc()`; todo Markdown, por `md()`.
- Botones con `data-action` y su manejador en `ACTIONS`. Campos enlazados con `data-pf` / `data-exf` / `data-tkf`.
- Escrituras en la base de datos solo tras una acción de la usuaria, una a la vez por documento. Nunca desde el render ni desde un snapshot.
- Textos de la interfaz en español de España, en segunda persona, frases cortas. Los errores dicen qué pasó y qué hacer.
- `window.print()`, `alert()`, `confirm()` y `prompt()` no funcionan en el visor: usa `confirmBox()`, `promptBox()` y PDF con `downloads`.

## Antes de dar algo por terminado

```bash
python3 test/e2e.py && python3 test/web_smoke.py && node test/api_test.js
```

Tiene que acabar en `N/N comprobaciones correctas` y sin errores de JavaScript. Si añades una función, añade su recorrido a `test/e2e.py`. Si llamas a una capacidad nueva de Claude, impleméntala también en `test/mock-claude.js`.

## Versión web

`web/claude-web.js` imita la interfaz `window.claude.use()` del artifact; si la app usa una capacidad nueva, añádela ahí también (o comprueba `WEB` en la app y escóndela). `dist/` se genera con `node scripts/build-web.js`: no se edita a mano ni se sube a git.

## Publicar

Publica `src/repaso.html` en el artifact existente (mismo `url`) con las capacidades del README. No cambies el icono. Anota el cambio en `CHANGELOG.md`.
