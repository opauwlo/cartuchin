// Teste do login que não cai (api/google.js), com o Google simulado.  node tests/google-api.mjs
process.env.GOOGLE_CLIENT_SECRET = "segredo-teste";
let calls = [];
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : {};
  calls.push({ url, body });
  if (String(url).includes("/revoke")) return new Response("{}");
  if (body.grant_type === "authorization_code") return new Response(JSON.stringify({ access_token: "AT1", expires_in: 3599, refresh_token: "RT-xyz" }));
  if (body.grant_type === "refresh_token") return body.refresh_token === "RT-xyz" ? new Response(JSON.stringify({ access_token: "AT2", expires_in: 3599 })) : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  return new Response("{}", { status: 500 });
};
const { default: h } = await import(new URL("../api/google.js", import.meta.url).href);
function call(action, { body, cookie, hdr = true, origin = "https://cartuchin.vercel.app" } = {}) {
  return new Promise((resolve) => {
    const req = { method: "POST", query: { action }, body, headers: { host: "cartuchin.vercel.app", origin, cookie, ...(hdr ? { "x-cartuchin": "1" } : {}) } };
    const res = { h: {}, code: 200, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, j, cookie: this.h["Set-Cookie"] }); } };
    h(req, res);
  });
}
const ok = (c, m) => { console.log((c ? "OK   " : "FALHA") + " " + m); if (!c) process.exitCode = 1; };
let r = await call("status"); ok(r.j.configured === true, "status configurado");
r = await call("token", { hdr: false }); ok(r.code === 403, "sem cabeçalho: 403");
r = await call("token", { origin: "https://malicioso.com" }); ok(r.code === 403, "outra origem: 403");
r = await call("login", { body: { code: "C1" } }); ok(r.j.access_token === "AT1" && /HttpOnly/.test(r.cookie) && /Secure/.test(r.cookie), "login troca code e grava cookie");
ok(!r.cookie.includes("RT-xyz"), "refresh token não aparece em texto no cookie");
ok(calls.at(-1).body.redirect_uri === "postmessage" && calls.at(-1).body.client_secret === "segredo-teste", "troca com redirect postmessage e segredo");
const cookie = r.cookie.split(";")[0];
r = await call("token", { cookie }); ok(r.j.access_token === "AT2", "token novo pelo cookie");
r = await call("token", { cookie: "cartuchin_g=lixo" }); ok(r.code === 401, "cookie inválido: 401");
r = await call("logout", { cookie }); ok(/Max-Age=0/.test(r.cookie) && calls.some((c) => String(c.url).includes("revoke")), "logout revoga e apaga cookie");
