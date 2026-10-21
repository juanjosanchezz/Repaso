/* Solo para pruebas: sirve las funciones de api/ (auth y docs) con Node, contra PostgreSQL vía psql.
   Uso: PGDB=nombre PORT=8787 node test/api_server.js */
const http = require("http");
const { psqlQuery } = require("./pg-psql.js");
global.__REPASO_DB__ = psqlQuery({ db: process.env.PGDB || "postgres", port: process.env.PGPORT || "55432" });
const routes = { "/api/auth": require("../api/auth.js"), "/api/docs": require("../api/docs.js") };
http.createServer((req, res) => {
  const h = routes[req.url.split("?")[0]];
  if (!h) { res.statusCode = 404; return res.end("{}"); }
  h(req, res).catch(e => { console.error(e); res.statusCode = 500; res.end("{}"); });
}).listen(Number(process.env.PORT || 8787), () => console.log("listo"));
