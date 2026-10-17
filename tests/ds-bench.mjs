// Compara todas as opções do DS (core, resolução, 3D na GPU, GPU sem espera, desempenho)
// no mesmo jogo: velocidade (quadros/s) e falhas de som, com a CPU mais lenta (celular).
//   ROM=jogo.nds CPU_SLOWDOWN=4 node tests/ds-bench.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROM = process.env.ROM || path.join(root, "ds/core/tools/roms/scene3d-arm.nds");
const SLOW = Number(process.env.CPU_SLOWDOWN || 4), WARM = 8000, MEASURE = Number(process.env.SECS || 12) * 1000;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    const h = { "content-type": types[path.extname(p)] || "application/octet-stream" };
    if (/[?&]ds=/.test(req.url)) Object.assign(h, { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "credentialless" });
    if (p.startsWith("/ds/")) Object.assign(h, { "cross-origin-embedder-policy": "credentialless", "cross-origin-resource-policy": "same-origin" });
    res.writeHead(200, h); res.end(d);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));
await ctx.addInitScript(() => { localStorage.setItem("cartucho.localOnly", "1"); localStorage.setItem("cartucho.ds.gpuforce", "1"); });
const page = await ctx.newPage();
await page.goto(base);
await page.setInputFiles("#romInput", ROM);
await page.waitForSelector("#games .tile:not(.add-tile)", { timeout: 240000 });

const CONFIGS = [
  { core: "estavel" },
  { core: "estavel", perf: "60" },
  { core: "teste" },
  { core: "teste", scale: 2 },
  { core: "teste", gpu: "on" },
  { core: "teste", gpu: "on", scale: 2 },
  { core: "teste", gpu: "on", lag: "off" },
  { core: "jit" },
  { core: "jit", gpu: "on" },
  { core: "jit", scale: 2 },
  { core: "mt" },
  { core: "mt", scale: 2 },
];
const rows = [];
for (const c of CONFIGS) {
  const cfg = { perf: "auto", scale: 1, gpu: "off", lag: "on", ...c };
  await page.goto(base);
  await page.evaluate((cfg) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("cartucho.cfg.")) localStorage.removeItem(k);
    localStorage.setItem("cartucho.ds.coreForce", cfg.core); localStorage.setItem("cartucho.ds.scale", String(cfg.scale));
    localStorage.setItem("cartucho.ds.gpu", cfg.gpu); localStorage.setItem("cartucho.ds.lag", cfg.lag); localStorage.setItem("cartucho.ds.perf", cfg.perf);
    localStorage.setItem("cartucho.ds.level", "1");
  }, cfg);
  await page.reload();
  await page.waitForSelector("#games .tile:not(.add-tile)");
  await page.click("#games .tile:not(.add-tile)");
  await page.click("#gameSheet .btn.primary");
  if (cfg.core === "mt") { await page.waitForURL(/[?&]ds=/, { timeout: 30000 }); await page.waitForLoadState("load"); }
  const ok = await page.waitForFunction(() => { const e = window.__cartucho && window.__cartucho.emu; if (e && e.started && e.frames > 60) return true; const b = document.querySelector(".dialog .btn.primary"); if (b) b.click(); return false; }, null, { timeout: 120000, polling: 250 }).then(() => true, () => false);
  if (!ok) { rows.push({ ...cfg, err: "não abriu" }); console.log(JSON.stringify(rows.at(-1))); continue; }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
  await page.waitForTimeout(WARM);
  const a = await page.evaluate(() => { const e = window.__cartucho.emu; return { f: e.frames, t: performance.now(), u: e.audioStats ? e.audioStats().underruns : null }; });
  await page.waitForTimeout(MEASURE);
  const b = await page.evaluate(() => { const e = window.__cartucho.emu; return { f: e.frames, t: performance.now(), u: e.audioStats ? e.audioStats().underruns : null, gpu: !!e.gpu3d, jit: !!e.jitOn, level: window.__ds && window.__ds.level, real: window.__ds && window.__ds.core }; });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const fps = (b.f - a.f) / ((b.t - a.t) / 1000);
  rows.push({ ...cfg, fps: Math.round(fps * 10) / 10, speed: Math.round(fps / 59.83 * 100), under: a.u == null ? "?" : b.u - a.u, gpuReal: b.gpu, jitReal: b.jit, level: b.level, coreReal: b.real });
  console.log(JSON.stringify(rows.at(-1)));
  await page.evaluate(() => { window.__cartucho.leaving = true; });
}
console.log("\n| core | resolução | 3D GPU | GPU sem espera | desempenho | quadros/s | velocidade | falhas de som (12 s) | nível auto |");
console.log("|---|---|---|---|---|---:|---:|---:|---|");
for (const r of rows) console.log(`| ${r.coreReal || r.core} | ${r.scale}x | ${r.gpu}${r.gpuReal ? "" : r.gpu === "on" ? " (não ligou)" : ""} | ${r.lag} | ${r.perf} | ${r.fps ?? "-"} | ${r.speed ?? "-"}% | ${r.under ?? "-"} | ${r.level ?? ""} |`);
await browser.close(); server.close();
