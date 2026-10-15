// Teste automático do DS: abre uma ROM de teste, confere que o jogo roda, salva e
// carrega estado, e transmite para uma "segunda tela" (outra página no mesmo navegador).
//
// O pareamento normal passa pelo ntfy.sh; aqui as duas páginas conversam por um
// BroadcastChannel (mesma origem), então o teste não depende de internet.
//
//   node tests/ds-e2e.mjs            (CHROMIUM_PATH=... para usar outro Chromium)
//   ONLY=state|cast                  roda só uma parte
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROM = process.env.ROM || path.join(root, "ds/core/tools/roms/scene3d-arm.nds");
const ONLY = process.env.ONLY || "";
// CORE=estavel|teste|jit, SCALE=1..6 (resolução interna, só nos cores de teste)
const CORE = process.env.CORE || "estavel", SCALE = process.env.SCALE || "1";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    // como a Vercel: a página do DS (?ds=) é isolada (threads); os arquivos de ds/ também
    const h = { "content-type": types[path.extname(file)] || "application/octet-stream" };
    if (/[?&]ds=/.test(req.url)) Object.assign(h, { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "credentialless" });
    if (p.startsWith("/ds/")) Object.assign(h, { "cross-origin-embedder-policy": "credentialless", "cross-origin-resource-policy": "same-origin" });
    res.writeHead(200, h);
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required", "--allow-loopback-in-peer-connection"],
});
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));   // sem fontes, Google, GitHub
// ntfy.sh trocado por um BroadcastChannel entre as páginas
await ctx.addInitScript(([core, scale]) => {
  localStorage.setItem("cartucho.localOnly", "1");
  localStorage.setItem("cartucho.ds.core", core);
  localStorage.setItem("cartucho.ds.scale", scale);
  localStorage.setItem("cartucho.ds.gpuforce", "1");
  const NT = "https://ntfy.sh/";
  const bc = new BroadcastChannel("fake-ntfy");
  const log = [];
  bc.onmessage = (e) => log.push(e.data);
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).startsWith(NT)) {
      const m = { topic: String(url).slice(NT.length), message: String(opts.body), id: Math.random().toString(36).slice(2) };
      bc.postMessage(m);
      return new Response("{}", { status: 200 });
    }
    return realFetch(url, opts);
  };
  const RealES = window.EventSource;
  window.EventSource = function (url) {
    if (!String(url).startsWith(NT)) return new RealES(url);
    const topic = String(url).slice(NT.length).replace(/\/sse.*$/, "");
    const es = { onmessage: null, close() { ch.close(); } };
    const ch = new BroadcastChannel("fake-ntfy");
    ch.onmessage = (e) => { if (e.data.topic === topic && es.onmessage) es.onmessage({ data: JSON.stringify({ event: "message", id: e.data.id, message: e.data.message }) }); };
    return es;
  };
}, [CORE, SCALE]);
console.log(`core ${CORE}, resolução ${SCALE}x`);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) failed++; };
const errors = [];

const phone = await ctx.newPage();
phone.on("pageerror", (e) => errors.push("celular: " + e.message));
phone.on("dialog", (d) => d.accept());
await phone.goto(base);
await phone.setInputFiles("#romInput", ROM);
await phone.waitForSelector("#games .tile:not(.add-tile)", { timeout: 20000 });
await phone.click("#games .tile:not(.add-tile)");
await phone.click("#gameSheet .btn.primary");
// core com threads: o jogo abre na página isolada (?ds=)
if (CORE === "mt") {
  await phone.waitForURL(/[?&]ds=/, { timeout: 20000 });
  await phone.waitForLoadState("load");
  ok(await phone.evaluate(() => window.crossOriginIsolated), "página do DS isolada (threads disponíveis)");
}
// pode aparecer uma escolha de save: segue com a primeira opção
const started = await phone.waitForFunction(() => {
  const e = window.__cartucho && window.__cartucho.emu;
  if (e && e.started && e.frames > 120) return true;
  const b = document.querySelector(".dialog .btn.primary");
  if (b) b.click();
  return false;
}, null, { timeout: 60000, polling: 250 }).then(() => true, () => false);
ok(started, "DS abre a ROM e roda 120 quadros");
if (CORE === "mt") {
  const core = await phone.evaluate(() => [...document.scripts].map((s) => s.src).find((u) => /ds\/nds/.test(u)) || "");
  ok(/nds-test-mt\.js/.test(core), `core com threads carregado (${core.split("/").pop()})`);
}
if (!started) {
  console.log(errors.join("\n"));
  await browser.close(); server.close(); process.exit(1);
}

if (!ONLY || ONLY === "state") {
  const r = await phone.evaluate(async () => {
    const emu = window.__cartucho.emu, gm = emu.gameManager;
    const s1 = gm.getState();
    const f1 = emu.frames;
    await new Promise((res) => setTimeout(res, 1500));
    const moved = emu.frames - f1;
    gm.loadState(s1);
    const s2 = gm.getState();
    let same = s1.length === s2.length;
    let diff = 0;
    if (same) for (let i = 0; i < s1.length; i++) if (s1[i] !== s2[i]) diff++;
    await new Promise((res) => setTimeout(res, 800));
    return { size: s1.length, size2: s2.length, moved, sameLen: same, diff, after: emu.frames, running: !emu.paused };
  });
  ok(r.size > 100000, `salvar estado gera ${(r.size / 1048576).toFixed(1)} MB`);
  ok(r.moved > 30, `jogo anda depois de salvar (${r.moved} quadros)`);
  ok(Math.abs(r.size - r.size2) < r.size * 0.01, `carregar estado funciona (tamanhos ${r.size}/${r.size2})`);
  ok(r.running, "jogo segue rodando após carregar");
  // galeria: salvar pelo menu, ver o card com miniatura, carregar, renomear e apagar
  await phone.click("#menuBtn");
  await phone.click("#gmActions .gs-action:has-text('Salvar estado')");
  await phone.waitForFunction(async () => (await window.__states.list(window.__cartucho.key)).length >= 1, null, { timeout: 15000, polling: 300 });
  const autoOk = await phone.evaluate(async () => { return window.__states.saveState({ auto: true }); });
  ok(autoOk, "salvamento automático grava");
  await phone.click("#gmActions .gs-action:has-text('Estados salvos')");
  await phone.waitForSelector("#statesSheet:not([hidden]) .st-card", { timeout: 10000 });
  await phone.waitForFunction(() => [...document.querySelectorAll("#statesSheet img")].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});
  const thumbs = await phone.evaluate(async () => (await window.__states.list(window.__cartucho.key)).map((i) => i.thumb ? i.thumb.size : 0));
  console.log("  miniaturas (bytes):", thumbs.join(", "));
  const g = await phone.evaluate(() => ({ cards: document.querySelectorAll("#statesSheet .st-card").length, imgs: [...document.querySelectorAll("#statesSheet .st-card img")].filter((i) => i.complete && i.naturalWidth > 0).length, auto: document.querySelectorAll("#statesSheet .st-card.auto").length }));
  ok(g.cards === 2 && g.auto === 1, `galeria mostra os estados (${g.cards} cards, ${g.auto} automático)`);
  ok(g.imgs >= 1, `cards com miniatura (${g.imgs})`);
  if (process.env.SHOT) await phone.screenshot({ path: process.env.SHOT });
  const f0 = await phone.evaluate(() => window.__cartucho.emu.frames);
  await phone.click("#statesSheet .st-card:not(.auto) .st-acts .primary");
  const loaded = await phone.waitForFunction((f) => window.__cartucho.emu.frames > f + 30 && document.querySelector("#statesSheet").hidden, f0, { timeout: 15000 }).then(() => true, () => false);
  ok(loaded, "carregar pela galeria fecha a folha e o jogo segue");
  const left = await phone.evaluate(async () => {
    const k = window.__cartucho.key, items = await window.__states.list(k);
    await window.__states.renameState(k, items[0].id, "Antes do chefe");
    for (const it of items) await window.__states.removeState(k, it.id);
    return (await window.__states.list(k)).length;
  });
  ok(left === 0, "apagar estados limpa a galeria");
}

// Segunda tela: cada formato de vídeo (VP8, H.264, quadros pelo canal de dados) em cada
// arrumação das telas. CAST_MODES=0,1,2 e CAST_LAYOUTS=top,both,side limitam a matriz.
const CAST_MODES = (process.env.CAST_MODES || "0,1,2").split(",").map(Number);
const CAST_LAYOUTS = (process.env.CAST_LAYOUTS || "top,both,side").split(",");
const MODE_NAME = ["VP8", "H.264", "quadros"];
async function shownOnTv(tv) {
  return tv.evaluate(() => {
    const v = document.querySelector("#scrVideo");
    const c = document.querySelector("#scrGl:not([hidden])") || document.querySelector("#scrCanvas:not([hidden])") || (v && v.videoWidth ? v : null);
    if (!c) return null;
    const t = document.createElement("canvas"); t.width = 64; t.height = 48;
    const g = t.getContext("2d"); g.drawImage(c, 0, 0, 64, 48);
    const d = g.getImageData(0, 0, 64, 48).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { id: c.id, w: c.width || c.videoWidth, h: c.height || c.videoHeight, b: s / (64 * 48 * 3), drawn: window.__tvScreen.drawnSharp + window.__tvScreen.drawn };
  });
}
async function castOnce(mode, layout) {
  const tag = `[${MODE_NAME[mode]}, ${layout}]`;
  await phone.evaluate(([m, lo]) => {
    localStorage.setItem("cartucho.castMode", String(m));
    localStorage.setItem("cartucho.ds.cast", lo);
  }, [mode, layout]);
  await phone.evaluate((lo) => { window.__ds.cast = lo; window.__cartucho.emu.relayout(); }, layout);
  const tv = await ctx.newPage();
  tv.on("pageerror", (e) => errors.push("tela: " + e.message));
  await tv.goto(base);
  await tv.click("#screenBtn");
  await tv.waitForFunction(() => window.__tvScreen && window.__tvScreen.code, null, { timeout: 15000 });
  const code = await tv.evaluate(() => window.__tvScreen.code);
  await phone.bringToFront();
  await phone.click("#castBtn");
  await phone.fill(".dialog input", code);
  await phone.click(".dialog button[type=submit]");
  const connected = await phone.waitForFunction(() => window.__cast.pc && window.__cast.pc.connectionState === "connected", null, { timeout: 30000 }).then(() => true, () => false);
  ok(connected, `${tag} conecta`);
  if (!connected) { await tv.close(); return; }
  const used = await phone.evaluate(() => window.__cast.mode);
  ok(used === mode, `${tag} usa o formato pedido (${MODE_NAME[used]})`);
  // a TV recebe e desenha imagem que não é preta
  const t0 = Date.now();
  let shown = null;
  while (Date.now() - t0 < 30000) {
    shown = await shownOnTv(tv);
    if (shown && shown.b > 3 && shown.drawn > 5) break;
    await tv.waitForTimeout(500);
  }
  ok(!!shown && shown.b > 3 && shown.drawn > 5, `${tag} imagem aparece na tela${shown ? ` (${shown.id} ${shown.w}x${shown.h}, brilho ${shown.b.toFixed(0)}, ${shown.drawn} quadros)` : ""}`);
  ok(!!shown && shown.w <= 4096 && shown.h <= 4096, `${tag} tamanho no limite`);
  const sent = await phone.evaluate(() => ({ w: window.__cartucho.emu.canvas.width, h: window.__cartucho.emu.canvas.height, layout: window.__cartucho.emu.localLayout() }));
  const ratio = sent.w / sent.h, want = layout === "both" ? 256 / 384 : layout === "side" ? 512 / 192 : 256 / 192;
  ok(Math.abs(ratio - want) < 0.01 && sent.w <= 1536 && sent.h <= 1536, `${tag} vídeo enviado ${sent.w}x${sent.h}`);
  ok(sent.layout === "bottom", `${tag} celular mostra a tela de toque (${sent.layout})`);
  // controle: seta na TV chega no jogo do celular
  await tv.bringToFront();
  const k0 = Date.now();
  await tv.keyboard.down("ArrowRight");
  const got = await phone.waitForFunction(() => (window.__cast.remoteMask & (1 << 6)) !== 0, null, { timeout: 5000, polling: 10 }).then(() => Date.now() - k0, () => -1);
  await tv.keyboard.up("ArrowRight");
  const rel = await phone.waitForFunction(() => window.__cast.remoteMask === 0, null, { timeout: 5000, polling: 10 }).then(() => true, () => false);
  ok(got >= 0 && rel, `${tag} botão da tela chega no jogo e solta${got >= 0 ? ` (${got} ms)` : ""}`);
  // toque na tela de baixo, que fica no celular
  await phone.bringToFront();
  const box = await phone.locator("#game .ds-view").boundingBox();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  const touched = await phone.waitForFunction(() => window.__cartucho.emu.touch, null, { timeout: 3000 }).then(() => true, () => false);
  await phone.mouse.up();
  ok(touched, `${tag} toque na tela de baixo funciona transmitindo`);
  await tv.close();
  await phone.waitForFunction(() => !window.__cast.pc, null, { timeout: 15000 }).catch(() => {});
}
if (!ONLY || ONLY === "cast") {
  for (const mode of CAST_MODES) for (const layout of CAST_LAYOUTS) await castOnce(mode, layout);
}

ok(errors.length === 0, `sem erros de JavaScript${errors.length ? ":\n  " + errors.join("\n  ") : ""}`);
await browser.close();
server.close();
console.log(failed ? `${failed} falha(s)` : "tudo certo");
process.exit(failed ? 1 : 0);
