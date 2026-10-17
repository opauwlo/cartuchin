// Procura coisas saindo da tela: em vários tamanhos de celular (em pé e deitado), em cada
// tela principal, lista os elementos visíveis que passam da borda da janela.
//   node tests/layout-check.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const AUDIT = () => {
  const W = innerWidth, H = innerHeight, out = [];
  if (document.documentElement.scrollWidth > W + 1) out.push(`página rola de lado (${document.documentElement.scrollWidth} > ${W})`);
  for (const e of document.querySelectorAll("body *")) {
    if (e.closest("[hidden]") || e.closest(".ejs_parent") || e.closest("svg")) continue;
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed" && e.id === "pad") continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // de lado: nada pode passar do recipiente que recorta ou rola (rolar de lado dentro de uma
    // folha também é defeito), só da barra do jogo, que rola de lado de propósito
    let p = e.parentElement, box = null;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== "visible") { box = p; break; }
      p = p.parentElement;
    }
    if (box && box.matches(".pbar")) continue;
    const br = box ? box.getBoundingClientRect() : null;
    const left = br ? Math.max(0, br.left) : 0, right = br ? Math.min(W, br.right) : W;
    // de cima a baixo: só nas telas fixas (jogo, controle, folhas, avisos), que não rolam a página
    const fixedUi = e.closest("#pad, #player, .scrim, #screen");
    let rolls = false;   // dentro de algo que rola de cima a baixo: dá para chegar lá
    for (let q = e.parentElement; q && q !== document.body; q = q.parentElement) if (/(auto|scroll)/.test(getComputedStyle(q).overflowY) && q.scrollHeight > q.clientHeight) { rolls = true; break; }
    const bottom = fixedUi && !rolls ? H : 1e9;
    if (r.right > right + 3 || r.left < left - 3 || r.bottom > bottom + 3)
      out.push(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)},${Math.round(r.bottom)}] passa de ${box ? (box.id ? "#" + box.id : box.className || box.tagName) : "a janela"}`);
    // texto cortado no próprio elemento (sem reticências)
    if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 2 && cs.overflow !== "visible" && cs.textOverflow !== "ellipsis" && e.textContent.trim()) out.push(`texto cortado: ${e.tagName.toLowerCase()}.${String(e.className)} "${e.textContent.trim().slice(0, 30)}"`);
  }
  return [...new Set(out)].slice(0, 12);
};
const sizes = [[320, 640], [360, 740], [412, 860], [740, 360], [915, 412], [1280, 720]];
let problems = 0;
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 1000, hasTouch: w < 1000 });
  await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.addInitScript(() => localStorage.setItem("cartucho.localOnly", "1"));
  const page = await ctx.newPage();
  const check = async (name) => { const r = await page.evaluate(AUDIT); if (r.length) { problems += r.length; console.log(`[${w}x${h}] ${name}:\n  ` + r.join("\n  ")); } };
  await page.goto(base);
  await page.waitForTimeout(500);
  await check("biblioteca vazia");
  await page.setInputFiles("#romInput", process.env.ROM1 || path.join(root, "tests/gba-test.gba"));
  await page.waitForSelector("#games .tile:not(.add-tile)");
  await page.setInputFiles("#romInput", process.env.ROM2 || path.join(root, "ds/core/tools/roms/scene3d-arm.nds"));
  await page.waitForFunction(() => document.querySelectorAll("#games .tile:not(.add-tile)").length >= 2);
  await page.waitForTimeout(3200);   // os avisos somem
  await check("biblioteca");
  await page.click("#accountBtn"); await page.waitForTimeout(400); await check("conta e ajustes");
  await page.evaluate(() => { const s = document.querySelector("#settingsSheet"); s.scrollTop = 9999; }); await page.waitForTimeout(200); await check("conta e ajustes (fim)");
  await page.evaluate(() => document.querySelector("#raBtn").click()); await page.waitForTimeout(300); await check("entrar no RetroAchievements");
  await page.goto(base); await page.waitForSelector("#games .tile:not(.add-tile)");
  await page.click("#games .tile:not(.add-tile)"); await page.waitForTimeout(400); await check("página do jogo");
  await page.click("#gsDetails"); await page.waitForTimeout(400); await check("detalhes do jogo");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/det-${w}x${h}.png`, fullPage: false });
  await page.evaluate(() => { const b = [...document.querySelectorAll("#gameDetails .gs-action")].find((x) => /Apagar jogo/.test(x.textContent)); b && b.click(); }); await page.waitForTimeout(300); await check("confirmar apagar");
  await page.evaluate(() => { const b = [...document.querySelectorAll(".dialog .btn")].find((x) => /Cancelar/.test(x.textContent)); b && b.click(); });
  for (const [i, sys] of [[0, "GBA"], [1, "DS"]]) {
    await page.goto(base); await page.waitForSelector("#games .tile:not(.add-tile)");
    await page.click(`#games .tile:not(.add-tile) >> nth=${i}`);
    await page.click("#gameSheet .btn.primary");
    await page.waitForFunction(() => { const e = window.__cartucho && window.__cartucho.emu; if (e && e.started) return true; const b = document.querySelector(".dialog .btn.primary"); if (b) b.click(); return false; }, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    await check(`jogo ${sys}`);
    if (sys === "GBA") { await page.evaluate(() => document.querySelector("#castBtn").click()); await page.waitForTimeout(300); await check("código da segunda tela"); await page.evaluate(() => document.querySelector("#dialogRoot").replaceChildren()); }
    await page.evaluate(() => { const b = document.querySelector("#padMenu:not([hidden])") || document.querySelector("#menuBtn"); b && b.click(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#gmActions .gs-action")].find((x) => /Ajustes/.test(x.textContent)); b && b.click(); });
    await page.waitForTimeout(300);
    await check(`menu ${sys}`);
    await page.evaluate(() => window.__states && window.__states.openGallery("save")); await page.waitForTimeout(700); await check(`estados ${sys}`);
    if (sys === "GBA") { await page.evaluate(() => window.__states.saveState({ quiet: true })); await page.evaluate(() => window.__states.openGallery("load")); await page.waitForTimeout(400); await check("estados com item"); }
  }
  await page.goto(base); await page.waitForTimeout(800); await check("biblioteca com continuar");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/lib-${w}x${h}.png` });
  await page.goto(base); await page.click("#screenBtn"); await page.waitForTimeout(600); await check("tela de espera (TV)");
  await ctx.close();
}
await browser.close(); server.close();
console.log(problems ? `${problems} problema(s)` : "nada saindo da tela");
process.exit(problems ? 1 : 0);
