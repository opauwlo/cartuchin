// Perfil de CPU do GBA jogando (celular médio simulado: CPU 4x mais lenta).
// Mostra a velocidade e onde o tempo da thread principal vai (core wasm, EmulatorJS, app).
//   node tests/gba-profile.mjs [rom.gba]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROM = process.argv[2] || path.join(root, "bench.gba");
const SLOW = Number(process.env.CPU_SLOWDOWN || 4), SECS = Number(process.env.SECS || 8);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));
await ctx.addInitScript((ff) => { localStorage.setItem("cartucho.localOnly", "1"); if (ff) localStorage.setItem("cartucho.gbaGov", "off"); }, process.env.FF || "");
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.setInputFiles("#romInput", ROM);
await page.waitForSelector("#games .tile:not(.add-tile)");
await page.click("#games .tile:not(.add-tile)");
await page.click("#gameSheet .btn.primary");
await page.waitForFunction(() => { const e = window.__cartucho && window.__cartucho.emu; return e && e.started && e.gameManager; }, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
await page.waitForTimeout(2000);
if (process.env.FF && process.env.FF !== "none") await page.evaluate((r) => { const gm = window.__cartucho.emu.gameManager; gm.setFastForwardRatio(Number(r)); gm.toggleFastForward(1); }, process.env.FF);
await page.waitForTimeout(Number(process.env.SETTLE || 1000));   // o ajuste automático de velocidade assenta
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
const f0 = await page.evaluate(() => [window.__cartucho.emu.gameManager.getFrameNum(), performance.now()]);
await cdp.send("Profiler.start");
await page.waitForTimeout(SECS * 1000);
const { profile } = await cdp.send("Profiler.stop");
const f1 = await page.evaluate(() => [window.__cartucho.emu.gameManager.getFrameNum(), performance.now()]);
const fps = (f1[0] - f0[0]) / ((f1[1] - f0[1]) / 1000);
// tempo próprio por função
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
const byFn = new Map(), byGroup = new Map();
let total = 0;
for (const n of profile.nodes) {
  const t = dt.get(n.id) || 0;
  if (!t) continue;
  total += t;
  const cf = n.callFrame, url = cf.url || "";
  const group = cf.functionName === "(idle)" ? "ocioso" : cf.functionName === "(program)" || cf.functionName === "(garbage collector)" ? cf.functionName : /wasm/.test(url) || /^\$?func\d|wasm-function/.test(cf.functionName) ? "core (wasm)" : /emulator\.min|mgba_libretro\.js/.test(url) ? "EmulatorJS" : /app\.js/.test(url) ? "app" : url ? path.basename(url) : "nativo/outro";
  byGroup.set(group, (byGroup.get(group) || 0) + t);
  const key = `${cf.functionName || "(anônima)"} ${path.basename(url)}:${cf.lineNumber}`;
  byFn.set(key, (byFn.get(key) || 0) + t);
}
const g = await page.evaluate(() => window.__gov && window.__gov.ratio);
console.log(`velocidade: ${fps.toFixed(1)} quadros/s (CPU ${SLOW}x mais lenta${g ? `, ajuste automático ${g.toFixed(2)}x` : ""})`);
for (const [g, t] of [...byGroup].sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(22)} ${(100 * t / total).toFixed(1)}%`);
console.log("funções:");
for (const [k, t] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(100 * t / total).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
server.close();
