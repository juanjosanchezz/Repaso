/* Construye la versión web para Vercel: dist/index.html
   = documento HTML + web/claude-web.js (interfaz de Claude en el navegador) + src/repaso.html.
   Sin dependencias: `node scripts/build-web.js`. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "repaso.html"), "utf8");
const shim = fs.readFileSync(path.join(root, "web", "claude-web.js"), "utf8");
if (shim.includes("</script")) throw new Error("web/claude-web.js no puede contener </script");

// Cuentas de verdad: si hay base de datos (integración de Neon), la app usa /api/auth y /api/docs.
// Al navegador no va ningún dato de la conexión; solo se le dice que hay cuentas.
const { dbUrl } = require("../lib/db.js");
const cfg = dbUrl() ? { accounts: true } : {};
const cfgJs = "window.__REPASO_CONFIG__=" + JSON.stringify(cfg) + ";";

const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ffe45c"/><text x="32" y="44" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#17203a">Re</text></svg>');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Repaso: organiza tus asignaturas y prepara la PAU con apuntes, flashcards, tests y simulacros hechos con Claude.">
<meta name="theme-color" content="#f3f5fa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f121b" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${icon}">
<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>
<script>${cfgJs}</script>
<script>
${shim}
</script>
</head>
<body>
${app}
</body>
</html>
`;

const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`dist/index.html (${(html.length / 1024).toFixed(0)} KB) · cuentas: ${cfg.accounts ? "sí (base de datos)" : "no (datos en el navegador)"}`);
