# Repaso

App de estudio que funciona de dos formas: como **artifact de Claude** y como **web en Vercel**. En las dos, la alumna sube lo que le manda el profe, organiza asignaturas, temas, tareas y exámenes en un calendario, y Claude le prepara el material con los criterios de su curso (PAU de su comunidad, LOMLOE en ESO/1º Bachillerato o la guía docente de su carrera).

## Qué hace

- **Enfocada en la PAU**: en 2º de Bachillerato todo sigue el modelo de la PAU de su comunidad (estructura, tipos de pregunta, criterios de corrección). Página **PAU** con cuenta atrás, plan hasta la PAU, guía de la PAU por asignatura, simulacros y datos reales de cada asignatura. En ESO/1º usa los criterios LOMLOE; en universidad, la carrera y la guía docente.
- **Especializada en cada asignatura**: detecta el tipo (Filosofía, Historia, Arte, Geografía, Lengua, idiomas, Latín y Griego, Matemáticas, Física, Química, Biología, Economía, Dibujo) y ofrece su kit: ficha de autor, relacionar autores, comentario de texto, de fuente, de obra o de mapa, análisis sintáctico, writing, reading, traducción, problemas con corrección, preguntas de razonamiento, formulario, problemas resueltos, conceptos clave, línea del tiempo… El tipo se puede cambiar a mano.
- **Material**: apuntes completos (con el modelo más capaz), esquema, mapa mental, explicación paso a paso, chuleta, flashcards con repaso espaciado, tests **sin límite** (más preguntas sin repetir y modo sin fin), modelo de examen con simulacro cronometrado, examen global y plan de estudio. "Pedir cambios" y "Deshacer" en cualquier material.
- **Presentaciones para clase**: diapositivas con lo que decir en cada una, modo presentar a pantalla completa y exportación a **PowerPoint**. También desde una tarea de tipo Presentación.
- **Chats en carpetas que se acuerdan**: conversaciones guardadas y organizadas en carpetas, por asignatura o generales. El chat conoce sus exámenes, tareas y temas flojos, y cuando le cuenta algo **lo apunta**: examen en el calendario, tarea en la lista o un recuerdo que usa siempre (visible y borrable en Personalizar).
- **Realista y objetivo**: todas las instrucciones a Claude piden notas sin regalar, errores concretos, no inventar y avisar de lo que puede estar desactualizado.
- **Tareas** con pasos, adjuntos, ayuda de Claude y recordatorios en Google Calendar (a elegir: el día antes, 2 h antes…).
- **Cada asignatura a su manera**: la manera de estudiar (apuntes y ya, visual, practicando, memorizando…) se puede elegir por asignatura; por ejemplo, Geografía con mapas mentales y Filosofía con apuntes. Se usa al preparar material y en el chat.
- **Calendario** de exámenes y entregas con nota real; **Progreso** con racha y temas flojos; **compartir** material con un código; **Personalizar** (color, letra, inicio, modo ahorro).

### Límites que no dependen de la app

- **Buscar en Google**: un artifact no puede navegar por internet. Claude responde con lo que sabe y con los apuntes, y avisa cuando algo (fechas de la PAU, cambios de este curso) hay que comprobarlo en la web oficial.
- **Ilimitado y gratis**: cada persona usa su propia cuenta de Claude. Con el plan gratuito funciona dentro de sus límites; el modo ahorro hace que dure más. Una versión propia sin cuenta de Claude tendría que pagar la API.

## Estructura

```
src/repaso.html        La app completa (un único archivo, como exige el artifact)
web/claude-web.js      Versión web: la misma interfaz de Claude en el navegador (IndexedDB, /api/claude, descargas)
api/claude.js          Función de Vercel: puente con la API de Claude (tu clave nunca llega al navegador)
scripts/build-web.js   Genera dist/index.html para Vercel (sin dependencias)
vercel.json            Configuración de Vercel
test/mock-claude.js    Simulación del runtime de Claude: db, user, sample, downloads, mcp
test/lib-stubs.js      Sustitutos de las librerías CDN para probar sin red
test/e2e.py            Prueba end-to-end del artifact (Playwright)
test/web_smoke.py      Prueba de la versión web (código de acceso, streaming, herramientas, datos tras recargar)
test/api_test.js       Prueba de la función de Vercel
ARCHITECTURE.md      Módulos, modelo de datos y decisiones
CLAUDE.md            Instrucciones para trabajar en el repo con Claude Code
CHANGELOG.md         Historial de versiones
```

## Desplegar en Vercel

1. En Vercel: **Add New → Project** e importa este repositorio de GitHub. No hace falta tocar nada: `vercel.json` ya dice cómo construirlo (`node scripts/build-web.js` → `dist/`) y dónde está la función (`api/claude.js`).
2. Antes de desplegar, en **Settings → Environment Variables** añade:
   - `ANTHROPIC_API_KEY`: tu clave de la API de Claude (console.anthropic.com). **Obligatoria.**
   - `REPASO_ACCESS_CODE`: un código que inventes y que solo darás a Julia y a sus amigas. **Muy recomendable**: sin él, cualquiera con el enlace gastaría de tu clave.
   - Opcionales: `REPASO_MODEL_COMPLEX`, `REPASO_MODEL_DEFAULT`, `REPASO_MODEL_QUICK` (por defecto `claude-opus-5-5`, `claude-sonnet-5-5` y `claude-haiku-5-5`) y `REPASO_MAX_TOKENS` (16000).
3. Pulsa **Deploy**. La primera vez que alguien use Claude, la app le pide el código de acceso.

Diferencias de la versión web:
- Los datos se guardan **en el navegador** de cada persona (IndexedDB). Si cambia de móvil, usa *Personalizar → Copia de seguridad*. Para cuentas que se sincronicen entre dispositivos hace falta una base de datos (ver "Lanzamiento fuera de Claude").
- El uso de Claude se cobra en **tu** cuenta de la API. Pon un límite de gasto mensual en console.anthropic.com.
- No hay avisos de Google Calendar ni compartir con código (eso necesita estar dentro de Claude).
- Las respuestas largas (apuntes completos) pueden tardar; la función admite hasta 300 s (`vercel.json`). Si tu plan de Vercel permite menos, baja `REPASO_MAX_TOKENS` o usa `REPASO_MODEL_COMPLEX=claude-sonnet-5-5`.

## Publicar como artifact de Claude

`src/repaso.html` se publica tal cual como artifact (la plataforma añade `<!doctype html>…<body>`). Capacidades que declara:

```json
{
  "db": {"rules": [{"path": "shared", "read": "view", "write": "owner"}, {"path": "shared/{self}", "write": "interact"}]},
  "user": {"scopes": ["profile"]},
  "sample": {"images": true},
  "downloads": true,
  "mcp": {"servers": [{"server": "Google Calendar", "tools": ["create_event"]}]}
}
```

**Cómo compartirla** (cuenta personal de Claude): invita a cada persona **por email con permiso de Editor** y no actives el enlace público. Quien entra desde fuera de tu organización con un enlace público o como Lector solo puede leer, así que no podría guardar nada. Cada usuaria ve solo sus datos (`data/users/<id>/`); el material compartido va a `shared/<id>/items/<código>`. La base de datos de un artifact admite 25.000 documentos en total: da para un grupo de amigas, no para un lanzamiento abierto.

## Probar

```bash
pip install playwright && playwright install chromium
python3 test/e2e.py          # artifact: 171 comprobaciones (E2E_OUT=carpeta para guardar las capturas)
python3 test/web_smoke.py    # versión web: 15 comprobaciones
node test/api_test.js        # función de Vercel: 7 comprobaciones
```

La prueba no usa red: el runtime de Claude (incluidas las herramientas del chat) y las librerías (pdf.js, mammoth, JSZip, html2pdf, PptxGenJS, marked, DOMPurify) se sustituyen por imitaciones con la misma interfaz. La lectura real de PDF/Word, la generación real de PDF y PowerPoint y Google Calendar se comprueban a mano en Claude.

## Lanzamiento fuera de Claude

La versión de Vercel ya funciona sin Claude.ai. El siguiente paso para un lanzamiento abierto son **cuentas reales que se sincronicen entre dispositivos**:

1. Crea un proyecto en Supabase o Firebase (email y contraseña, Google…).
2. En `web/claude-web.js`, cambia `db` (hoy IndexedDB) por esa base de datos con la misma interfaz (`doc`, `collection`, `where`, `onSnapshot`…) y `user.id()` por el id de la cuenta. La app no cambia.
3. En `api/claude.js`, valida la sesión del usuario en vez del código de acceso y pon límites de uso por persona.
