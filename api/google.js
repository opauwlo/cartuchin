// Login do Google que não cai: o navegador recebe um "code", este servidor (função da
// Vercel) troca pelo refresh token e guarda ele num cookie HttpOnly e criptografado.
// Depois, cada vez que o token de acesso (1 hora) vence, o app pede outro aqui, sem popup.
//
// Precisa, nas variáveis de ambiente da Vercel:
//   GOOGLE_CLIENT_SECRET  segredo do mesmo cliente OAuth do googleClientId (config.js)
//   GOOGLE_CLIENT_ID      opcional (padrão: o do config.js)
//
// POST /api/google?action=status | login {code} | token | logout
import crypto from "node:crypto";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "393294746829-vf6c0st5fls7n4ar9kujkkj3lp1cf3p7.apps.googleusercontent.com";
const SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const COOKIE = "cartuchin_g";
const MAX_AGE = 400 * 24 * 3600;   // o máximo que os navegadores aceitam

const key = () => crypto.createHash("sha256").update("cartuchin-cookie:" + SECRET).digest();
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function open(sealed) {
  try {
    const b = Buffer.from(sealed, "base64url"), d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch (e) { return null; }
}
function readCookie(req) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  return m ? open(m[1]) : null;
}
const setCookie = (res, value, age) => res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);

async function google(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  // só o próprio app: cabeçalho próprio (outro site não manda sem CORS) e mesma origem
  const origin = req.headers.origin;
  if (req.headers["x-cartuchin"] !== "1" || (origin && new URL(origin).host !== req.headers.host)) return res.status(403).json({ error: "origin" });
  const action = req.query.action;
  if (action === "status") return res.json({ configured: !!SECRET });
  if (!SECRET) return res.status(501).json({ error: "not-configured" });

  if (action === "login") {
    const code = req.body && req.body.code;
    if (!code) return res.status(400).json({ error: "code" });
    const { ok, j } = await google({ code, grant_type: "authorization_code", redirect_uri: "postmessage" });
    if (!ok) return res.status(400).json({ error: j.error || "exchange" });
    if (j.refresh_token) setCookie(res, seal(j.refresh_token), MAX_AGE);
    return res.json({ access_token: j.access_token, expires_in: j.expires_in, kept: !!j.refresh_token || !!readCookie(req) });
  }
  if (action === "token") {
    const rt = readCookie(req);
    if (!rt) return res.status(401).json({ error: "no-session" });
    const { ok, j } = await google({ refresh_token: rt, grant_type: "refresh_token" });
    if (!ok) {
      if (j.error === "invalid_grant") setCookie(res, "", 0);   // revogado ou vencido: entra de novo
      return res.status(401).json({ error: j.error || "refresh" });
    }
    return res.json({ access_token: j.access_token, expires_in: j.expires_in });
  }
  if (action === "logout") {
    const rt = readCookie(req);
    if (rt) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(rt), { method: "POST" }).catch(() => {});
    setCookie(res, "", 0);
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: "action" });
}
