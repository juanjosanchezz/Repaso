# Repaso

App de estudio que vive como **artifact de Claude**: la alumna sube lo que le manda el profe, organiza asignaturas, temas, tareas y exámenes en un calendario, y Claude le prepara el material con los criterios de su curso (PAU de su comunidad, LOMLOE en ESO/1º Bachillerato o la guía docente de su carrera).

## Qué hace

- **Enfocada en la PAU**: en 2º de Bachillerato todo sigue el modelo de la PAU de su comunidad (estructura, tipos de pregunta, criterios de corrección). Página **PAU** con cuenta atrás, plan hasta la PAU, guía de la PAU por asignatura, simulacros y datos reales de cada asignatura. En ESO/1º usa los criterios LOMLOE; en universidad, la carrera y la guía docente.
- **Especializada en cada asignatura**: detecta el tipo (Filosofía, Historia, Arte, Geografía, Lengua, idiomas, Latín y Griego, Matemáticas, Física, Química, Biología, Economía, Dibujo) y ofrece su kit: ficha de autor, relacionar autores, comentario de texto, de fuente, de obra o de mapa, análisis sintáctico, writing, reading, traducción, problemas con corrección, preguntas de razonamiento, formulario, problemas resueltos, conceptos clave, línea del tiempo… El tipo se puede cambiar a mano.
- **Material**: apuntes completos (con el modelo más capaz), esquema, mapa mental, explicación paso a paso, chuleta, flashcards con repaso espaciado, tests **sin límite** (más preguntas sin repetir y modo sin fin), modelo de examen con simulacro cronometrado, examen global y plan de estudio. "Pedir cambios" y "Deshacer" en cualquier material.
- **Presentaciones para clase**: diapositivas con lo que decir en cada una, modo presentar a pantalla completa y exportación a **PowerPoint**. También desde una tarea de tipo Presentación.
- **Chats en carpetas que se acuerdan**: conversaciones guardadas y organizadas en carpetas, por asignatura o generales. El chat conoce sus exámenes, tareas y temas flojos, y cuando le cuenta algo **lo apunta**: examen en el calendario, tarea en la lista o un recuerdo que usa siempre (visible y borrable en Personalizar).
- **Realista y objetivo**: todas las instrucciones a Claude piden notas sin regalar, errores concretos, no inventar y avisar de lo que puede estar desactualizado.
- **Tareas** con pasos, adjuntos, ayuda de Claude y recordatorios en Google Calendar (a elegir: el día antes, 2 h antes…).
- **Calendario** de exámenes y entregas con nota real; **Progreso** con racha y temas flojos; **compartir** material con un código; **Personalizar** (color, letra, inicio, modo ahorro).

### Límites que no dependen de la app

- **Buscar en Google**: un artifact no puede navegar por internet. Claude responde con lo que sabe y con los apuntes, y avisa cuando algo (fechas de la PAU, cambios de este curso) hay que comprobarlo en la web oficial.
- **Ilimitado y gratis**: cada persona usa su propia cuenta de Claude. Con el plan gratuito funciona dentro de sus límites; el modo ahorro hace que dure más. Una versión propia sin cuenta de Claude tendría que pagar la API.

## Estructura

```
src/repaso.html      La app completa (un único archivo, como exige el artifact)
test/mock-claude.js  Simulación del runtime de Claude: db, user, sample, downloads, mcp
test/lib-stubs.js    Sustitutos de las librerías CDN para probar sin red
test/e2e.py          Prueba end-to-end de todos los flujos (Playwright)
ARCHITECTURE.md      Módulos, modelo de datos y decisiones
CLAUDE.md            Instrucciones para trabajar en el repo con Claude Code
CHANGELOG.md         Historial de versiones
```

## Publicar

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
python3 test/e2e.py          # 165 comprobaciones; capturas en una carpeta temporal (E2E_OUT para elegirla)
```

La prueba no usa red: el runtime de Claude (incluidas las herramientas del chat) y las librerías (pdf.js, mammoth, JSZip, html2pdf, PptxGenJS, marked, DOMPurify) se sustituyen por imitaciones con la misma interfaz. La lectura real de PDF/Word, la generación real de PDF y PowerPoint y Google Calendar se comprueban a mano en Claude.

## Lanzamiento fuera de Claude

La identidad la da hoy la sesión de Claude. Todo el acceso pasa por el objeto `Auth` (`src/repaso.html`, módulo 4), y los datos por `Repo` (módulo 5). Para una versión independiente:

1. Sustituye `Auth` por Supabase o Firebase (email y contraseña, Google…).
2. Implementa `Repo` sobre esa base de datos con la misma forma de documentos.
3. Cambia `AI.call` por una llamada a la API de Claude desde tu backend.
