// Automated speed test for Cartuchin.
//
// Serves the site, opens it in headless Chromium as a phone (touch, 3x screen) with
// the CPU slowed down, runs the in-app speed diagnostic (#diagnostico) and checks
// that nothing the console mode adds (controller, touches, vibration, video stream)
// costs more than the allowed share of the plain emulator's speed.
//
//   npm install && npx playwright install chromium && npm run test:speed
//
// Options (environment variables):
//   CPU_SLOWDOWN   how much to slow the CPU, default 4 (roughly a mid-range phone)
//   MAX_COST       largest allowed drop for any single feature, default 0.15 (15%)
//   CHROMIUM_PATH  use this Chromium binary instead of Playwright's
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slowdown = Number(process.env.CPU_SLOWDOWN || 4);
const maxCost = Number(process.env.MAX_COST || 0.15);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]).replace(/^\/cartuchin/, "");
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--allow-loopback-in-peer-connection"],
});
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));   // no fonts, GitHub or ntfy in the test
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("erro na página:", e.message));
await page.goto(`http://127.0.0.1:${port}/cartuchin/#diagnostico`);
await page.waitForFunction(() => window.__diag && window.__diag.running, null, { timeout: 30000 });
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowdown });
await page.waitForFunction(() => window.__diag.done, null, { timeout: 240000, polling: 1000 });
const results = await page.evaluate(() => window.__diag.results);
await browser.close();
server.close();

const plain = results.filter((r) => r.id.startsWith("base"));
const base = plain.reduce((a, r) => a + r.fps, 0) / plain.length;
const rows = results.map((r) => ({ ...r, pct: (r.fps / 59.7275) * 100, rel: r.fps / base, ok: r.id.startsWith("base") || r.fps / base >= 1 - maxCost }));
const table = [
  `| Situação | Capacidade | Relativo ao normal | |`,
  `|---|---:|---:|---|`,
  ...rows.map((r) => `| ${r.label} | ${r.pct.toFixed(0)}% | ${(r.rel * 100).toFixed(0)}% | ${r.ok ? "ok" : "**lento demais**"} |`),
].join("\n");
const summary = `## Teste de velocidade (CPU ${slowdown}x mais lenta, custo máximo ${Math.round(maxCost * 100)}%)\n\n${table}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
const b1 = results.find((r) => r.id === "base"), b2 = results.find((r) => r.id === "base2");
if (b1 && b2 && b2.fps < b1.fps * (1 - maxCost)) {
  rows.push({ label: "O app ficou mais lento com o tempo (2ª medida do emulador sozinho caiu)", ok: false });
  console.error(`A segunda medida do emulador sozinho caiu de ${b1.fps.toFixed(1)} para ${b2.fps.toFixed(1)} quadros/s.`);
}
const failed = rows.filter((r) => !r.ok);
if (failed.length) {
  console.error(`Falhou: ${failed.map((r) => r.label).join(", ")} custa(m) mais de ${Math.round(maxCost * 100)}% da velocidade.`);
  process.exit(1);
}
