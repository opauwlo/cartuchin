// Teste da ponte /api/ra (sem rede: o fetch do RA é simulado).
import handler from "../api/ra.js";
let failed = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FALHA") + " " + m); if (!c) failed++; };
let sent = null;
globalThis.fetch = async (url, opts) => { sent = { url, ...opts }; return new Response('{"Success":true,"Token":"x"}', { status: 200, headers: { "content-type": "application/json" } }); };
function call(req) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
      send(b) { this.body = b; resolve(this); return this; } };
    handler({ method: "POST", headers: { host: "cartuchin.vercel.app", origin: "https://cartuchin.vercel.app", "x-cartuchin": "1" }, ...req }, res);
  });
}
let r = await call({ body: "r=login2&u=a&p=b" });
ok(r.code === 200 && sent && sent.url === "https://retroachievements.org/dorequest.php" && sent.body === "r=login2&u=a&p=b", "repassa o pedido para o RA");
ok(/^Cartuchin\//.test(sent.headers["User-Agent"]), "identifica o emulador (User-Agent)");
r = await call({ body: { r: "login2", u: "a" } });
ok(sent.body === "r=login2&u=a", "aceita corpo já interpretado pela Vercel");
sent = null;
r = await call({ headers: { host: "cartuchin.vercel.app", origin: "https://mal.example", "x-cartuchin": "1" }, body: "r=login2" });
ok(r.code === 403 && !sent, "recusa outro site");
r = await call({ headers: { host: "cartuchin.vercel.app" }, body: "r=login2" });
ok(r.code === 403 && !sent, "recusa sem o cabeçalho do app");
r = await call({ body: "x=1" });
ok(r.code === 400 && !sent, "recusa pedido que não é do RA");
r = await call({ method: "GET" });
ok(r.code === 405, "só POST");
console.log(failed ? `${failed} falha(s)` : "tudo certo");
process.exit(failed ? 1 : 0);
