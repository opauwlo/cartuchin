// Ponte para o RetroAchievements: o navegador não pode chamar o servidor do RA direto
// (sem CORS) e o RA pede que cada emulador se identifique pelo User-Agent.
// POST /api/ra  (corpo = o mesmo que o rcheevos mandaria para dorequest.php)
// A senha só passa por aqui no login (vai para o RA e volta um token); nada é guardado.
const UA = "Cartuchin/1.0 (web) rcheevos/12.5";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ Success: false, Error: "method" });
  const origin = req.headers.origin;
  if (req.headers["x-cartuchin"] !== "1" || (origin && new URL(origin).host !== req.headers.host)) return res.status(403).json({ Success: false, Error: "origin" });
  const body = typeof req.body === "string" ? req.body : req.body ? new URLSearchParams(req.body).toString() : "";
  if (!/^r=[a-z0-9]+/i.test(body) || body.length > 65536) return res.status(400).json({ Success: false, Error: "request" });
  try {
    const r = await fetch("https://retroachievements.org/dorequest.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body,
    });
    const text = await r.text();
    res.status(r.status).setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ Success: false, Error: "upstream" });
  }
}
