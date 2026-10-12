// Automated speed test for Cartuchin.
//
// Serves the site, opens it in headless Chromium as a phone (touch, 3x screen) with
// the CPU slowed down, runs the in-app speed diagnostic (#diagnostico) and checks
// that nothing the console mode adds (controller, touches, video stream) costs more
// than the allowed share of the plain emulator's speed, and that the emulator does
// not get slower over the course of the test (something left running).
//
// Shared CI machines are noisy, so a step that fails is measured once more in a
// fresh page and only fails the test if it is slow both times.
//
//   npm install && npx playwright install chromium && npm run test:speed
//
// Options (environment variables):
//   CPU_SLOWDOWN   how much to slow the CPU, default 4 (roughly a mid-range phone)
//   MAX_COST       largest allowed drop for any single feature, default 0.15 (15%)
//   CHROMIUM_PATH  use this Chromium binary instead of Playwright's
//   SUMMARY_FILE   also write the markdown summary to this file
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

async function runDiagnostic(only) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));   // no fonts, GitHub or ntfy in the test
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("erro na página:", e.message));
  await page.goto(`http://127.0.0.1:${port}/cartuchin/#diagnostico${only ? ":" + only.join(",") : ""}`);
  await page.waitForFunction(() => window.__diag && window.__diag.running, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowdown });
  await page.waitForFunction(() => window.__diag.done, null, { timeout: 300000, polling: 1000 });
  const out = await page.evaluate(() => ({ results: window.__diag.results, bases: window.__diag.bases }));
  await ctx.close();
  return out;
}
const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
const drift = (bases) => avg(bases.slice(-2)) / avg(bases.slice(0, Math.ceil(bases.length / 2)));

const first = await runDiagnostic(null);
const rows = first.results.map((r) => ({ ...r, tries: r.rel == null ? [] : [r.rel] }));
let driftValues = [drift(first.bases)];
const slowIds = rows.filter((r) => r.rel != null && r.rel < 1 - maxCost).map((r) => r.id);
if (slowIds.length || driftValues[0] < 1 - maxCost) {
  console.log(`Medindo de novo: ${slowIds.join(", ") || "tudo (o emulador caiu ao longo do teste)"}`);
  const again = await runDiagnostic(driftValues[0] < 1 - maxCost ? null : slowIds);
  for (const r of again.results) {
    const row = rows.find((x) => x.id === r.id);
    if (row && r.rel != null) { row.tries.push(r.rel); row.rel = Math.max(...row.tries); row.fps = Math.max(row.fps, r.fps); }
  }
  if (driftValues[0] < 1 - maxCost) driftValues.push(drift(again.bases));
}
await browser.close();
server.close();

const driftOk = Math.max(...driftValues) >= 1 - maxCost;
const table = [
  `| Situação | Capacidade | Relativo ao normal | |`,
  `|---|---:|---:|---|`,
  ...rows.map((r) => {
    const ok = r.rel == null || r.rel >= 1 - maxCost;
    const rel = r.rel == null ? "referência" : r.tries.map((t) => (t * 100).toFixed(0) + "%").join(" → ");
    return `| ${r.label} | ${((r.fps / 59.7275) * 100).toFixed(0)}% | ${rel} | ${ok ? "ok" : "**lento demais**"} |`;
  }),
  `| O emulador sozinho manteve a velocidade até o fim | | ${driftValues.map((d) => (d * 100).toFixed(0) + "%").join(" → ")} | ${driftOk ? "ok" : "**caiu: algo ficou rodando**"} |`,
].join("\n");
const summary = `## Teste de velocidade (CPU ${slowdown}x mais lenta, custo máximo ${Math.round(maxCost * 100)}%)\n\n${table}\n\nEmulador sozinho ao longo do teste: ${first.bases.map((b) => ((b / 59.7275) * 100).toFixed(0) + "%").join(" → ")}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (process.env.SUMMARY_FILE) fs.writeFileSync(process.env.SUMMARY_FILE, summary);
const failed = rows.filter((r) => r.rel != null && r.rel < 1 - maxCost).map((r) => r.label);
if (!driftOk) failed.push("o emulador ficou mais lento ao longo do teste");
if (failed.length) {
  console.error(`Falhou (lento nas duas medições): ${failed.join(", ")}.`);
  process.exit(1);
}
