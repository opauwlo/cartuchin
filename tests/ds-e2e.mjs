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
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required", "--allow-loopback-in-peer-connection",
    // celular e TV são aparelhos diferentes, os dois em primeiro plano: aqui nenhuma página fica em segundo plano
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
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
await phone.waitForSelector("#games .tile:not(.add-tile)", { timeout: 180000 });
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
// a tela do jogo no celular não pode estar preta (foi o defeito das threads: a imagem não era copiada)
const localBright = await phone.evaluate(() => {
  const v = document.querySelector("#game .ds-view"), t = document.createElement("canvas");
  t.width = 64; t.height = 96;
  const g = t.getContext("2d"); g.drawImage(v, 0, 0, 64, 96);
  const d = g.getImageData(0, 0, 64, 96).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s / (64 * 96 * 3);
});
ok(localBright > 3, `tela do jogo não está preta (brilho ${localBright.toFixed(0)})`);
// toque no meio da tela de baixo (qualquer arrumação) chega no jogo como (128, 96)
{
  const lo = await phone.evaluate(() => window.__cartucho.emu.localLayout());
  const AREA = { both: [0, 0.5, 1, 0.5], side: [0.5, 0, 0.5, 1], focus: [2 / 3, 0.5, 1 / 3, 0.5], small: [0.125, 1 / 1.75, 0.75, 0.75 / 1.75], bottom: [0, 0, 1, 1] }[lo];
  const box = await phone.locator("#game .ds-view").boundingBox();
  const ar = await phone.evaluate(() => { const v = document.querySelector("#game .ds-view"); return v.width / v.height; });
  let r = { ...box };
  if (box.width / box.height > ar) { r.width = box.height * ar; r.x += (box.width - r.width) / 2; } else { r.height = box.width / ar; r.y += (box.height - r.height) / 2; }
  await phone.mouse.move(r.x + (AREA[0] + AREA[2] / 2) * r.width, r.y + (AREA[1] + AREA[3] / 2) * r.height);
  await phone.mouse.down();
  const t = await phone.waitForFunction(() => { const e = window.__cartucho.emu; return e.touch ? { x: e.tx, y: e.ty } : false; }, null, { timeout: 3000 }).then((h) => h.jsonValue(), () => null);
  await phone.mouse.up();
  ok(!!t && Math.abs(t.x - 128) <= 3 && Math.abs(t.y - 96) <= 3, `toque na tela de baixo (${lo}) cai no lugar certo${t ? ` (${t.x}, ${t.y})` : ""}`);
}
// controle na tela: trocar o lado do direcional pelo Menu → Ajustes
{
  await phone.click("#menuBtn");
  await phone.click("#gmActions .gs-action:has-text('Ajustes')");
  await phone.click("#gmActions .gs-action:has-text('Direcional à')");
  await phone.click("#gmClose");
  const side = await phone.evaluate(() => { const d = document.querySelector("#pad .pad-dpad").getBoundingClientRect(), a = document.querySelector("#pad .pad-ab").getBoundingClientRect(); return d.left > a.left; });
  ok(side, "direcional vai para a direita pelo menu");
  await phone.evaluate(() => localStorage.removeItem("cartucho.pad.nds"));
  await phone.evaluate(() => window.dispatchEvent(new Event("resize")));
}
if (CORE === "mt") {
  const core = await phone.evaluate(() => [...document.scripts].map((s) => s.src).find((u) => /ds\/nds/.test(u)) || "");
  ok(/nds-test-mt\.js/.test(core), `core com threads carregado (${core.split("/").pop()})`);
}
if (!started) {
  console.log(errors.join("\n"));
  await browser.close(); server.close(); process.exit(1);
}

// som: 20 s jogando, quantas vezes o áudio faltou e a velocidade (quadros/s)
if (ONLY === "audio") {
  const a0 = await phone.evaluate(() => ({ s: window.__cartucho.emu.audioStats(), f: window.__cartucho.emu.frames, t: performance.now() }));
  await phone.waitForTimeout(20000);
  const a1 = await phone.evaluate(() => ({ s: window.__cartucho.emu.audioStats(), f: window.__cartucho.emu.frames, t: performance.now() }));
  console.log("AUDIO", JSON.stringify({ under: a1.s.underruns - a0.s.underruns, fps: Math.round((a1.f - a0.f) / ((a1.t - a0.t) / 1000)), fill: a1.s.fill, target: a1.s.target, state: a1.s.state }));
}
// RetroAchievements no DS: servidor do RA simulado; conquista quando a RAM em 0x3FFFF0 vira 7
if ((!ONLY || ONLY === "ra") && CORE !== "mt") {
  const calls = [];
  await ctx.route("**/api/ra", async (route) => {
    const r = new URLSearchParams(route.request().postData() || "").get("r");
    calls.push(r);
    const reply = {
      login2: { Success: true, User: "Tester", Token: "tok123", Score: 0, SoftcoreScore: 10, Messages: 0, Permissions: 1, AccountType: "Registered" },
      achievementsets: { Success: true, GameId: 88, Title: "Teste DS", ConsoleId: 18, ImageIconUrl: "", RichPresenceGameId: 88, RichPresencePatch: "",
        Sets: [{ AchievementSetId: 1, GameId: 88, Title: null, Type: "core", ImageIconUrl: "",
          Achievements: [{ ID: 201, Title: "Sete", Description: "RAM vira 7", Flags: 3, Points: 10, MemAddr: "0xH3ffff0=7", Author: "t", BadgeName: "00002", Created: 1, Modified: 1 }],
          Leaderboards: [] }] },
      startsession: { Success: true, Unlocks: [], HardcoreUnlocks: [], ServerNow: Math.floor(Date.now() / 1000) },
      awardachievement: { Success: true, Score: 0, SoftcoreScore: 20, AchievementID: 201, AchievementsRemaining: 0 },
    }[r] || { Success: true };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
  await phone.evaluate(() => { const i = window.__cartucho.emu.ramInfo(); i.heap[i.ptr + 0x3ffff0] = 0; });
  await phone.evaluate(() => document.querySelector("#raBtn").click());
  await phone.fill(".dialog input[type=text]", "Tester");
  await phone.fill(".dialog input[type=password]", "senha");
  await phone.click(".dialog button[type=submit]");
  const loaded = await phone.waitForFunction(() => window.__ra && window.__ra.game && window.__ra.mem, null, { timeout: 30000 }).then(() => true, () => false);
  ok(loaded, `[conquistas] login e jogo de DS reconhecido (${calls.join(", ")})`);
  // hash do DS como o RA calcula: cabeçalho + ARM9 + ARM7 + ícone
  const rom = fs.readFileSync(ROM), u32 = (o) => rom.readUInt32LE(o);
  const icon = Buffer.alloc(0xA00); rom.copy(icon, 0, u32(0x68), u32(0x68) + 0xA00);
  const want = (await import("node:crypto")).createHash("md5").update(rom.subarray(0, 0x160)).update(rom.subarray(u32(0x20), u32(0x20) + u32(0x2C))).update(rom.subarray(u32(0x30), u32(0x30) + u32(0x3C))).update(icon).digest("hex");
  const hash = await phone.evaluate(() => localStorage.getItem("cartucho.rahash." + window.__cartucho.key));
  ok(hash === want, `[conquistas] hash do DS igual ao do RA (${hash})`);
  if (loaded) {
    await phone.waitForTimeout(500);
    await phone.evaluate(() => { const i = window.__cartucho.emu.ramInfo(); i.heap[i.ptr + 0x3ffff0] = 7; });
    const got = await phone.waitForFunction(() => window.__ra.unlockedNow.includes(201), null, { timeout: 10000 }).then(() => true, () => false);
    await phone.waitForTimeout(1500);
    ok(got && calls.includes("awardachievement"), "[conquistas] conquista do DS desbloqueia e vai para o servidor");
  }
  await phone.evaluate(() => { const i = window.__cartucho.emu.ramInfo(); i.heap[i.ptr + 0x3ffff0] = 0; });
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
  await phone.waitForSelector("#statesSheet:not([hidden]) .st-new", { timeout: 10000 });
  await phone.click("#statesSheet .st-new");
  await phone.waitForFunction(async () => (await window.__states.list(window.__cartucho.key)).length >= 1, null, { timeout: 15000, polling: 300 });
  const autoOk = await phone.evaluate(async () => { return window.__states.saveState({ auto: true }); });
  ok(autoOk, "salvamento automático grava");
  await phone.click("#menuBtn");
  await phone.click("#gmActions .gs-action:has-text('Carregar estado')");
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
  // substituir um espaço: mesmo número de estados, o escolhido fica mais novo
  const before = await phone.evaluate(async () => (await window.__states.list(window.__cartucho.key)).filter((i) => !i.auto).map((i) => ({ id: i.id, at: i.at })));
  await phone.click("#menuBtn");
  await phone.click("#gmActions .gs-action:has-text('Salvar estado')");
  await phone.waitForSelector("#statesSheet:not([hidden]) .st-card[data-id] .st-acts .primary", { timeout: 10000 });
  await phone.click("#statesSheet .st-card[data-id] .st-acts .primary");
  await phone.click(".dialog .btn.primary");
  const replaced = await phone.waitForFunction(async (b) => {
    const now = (await window.__states.list(window.__cartucho.key)).filter((i) => !i.auto);
    const it = now.find((i) => i.id === b[0].id);
    return now.length === b.length && it && it.at > b[0].at;
  }, before, { timeout: 15000, polling: 300 }).then(() => true, () => false);
  ok(replaced, "salvar num espaço existente substitui (sem criar outro)");
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
const CAST_MODES = (process.env.CAST_MODES || "0,1,2,3").split(",").map(Number);
const CAST_LAYOUTS = (process.env.CAST_LAYOUTS || "top,both,side").split(",");
const MODE_NAME = ["pixels", "VP8", "H.264", "quadros"];
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
    localStorage.setItem("cartucho.castMode2", String(m));
    localStorage.setItem("cartucho.castVideo", "1");
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
    if (shown && shown.b > 3 && shown.drawn > (mode === 0 ? 0 : 5)) break;   // pixels: tela parada = 1 quadro só
    await tv.waitForTimeout(500);
  }
  ok(!!shown && shown.b > 3 && shown.drawn > (mode === 0 ? 0 : 5), `${tag} imagem aparece na tela${shown ? ` (${shown.id} ${shown.w}x${shown.h}, brilho ${shown.b.toFixed(0)}, ${shown.drawn} quadros)` : ""}`);
  ok(!!shown && shown.w <= 4096 && shown.h <= 4096, `${tag} tamanho no limite`);
  const sent = await phone.evaluate(() => ({ w: window.__cartucho.emu.canvas.width, h: window.__cartucho.emu.canvas.height, layout: window.__cartucho.emu.localLayout() }));
  const ratio = sent.w / sent.h, want = layout === "both" ? 256 / 384 : layout === "side" ? 512 / 192 : 256 / 192;
  if (mode === 0) {
    // pixels: quanto de rede gasta e se o som chega
    await phone.waitForTimeout(5000);
    const px = await phone.evaluate(() => window.__cast.pixels && { ...window.__cast.pixels.stat });
    const snd = await tv.evaluate(() => window.__tvScreen.sndPk || 0);
    ok(!!px && px.sent > 0, `${tag} pixels: ${px ? `${px.sent} pacotes, ${Math.round(px.bytes / 1024)} KB, ${px.keys} inteiros, ${px.dropped} descartados; quadros ${px.offered} → processados ${px.frames} (${px.empty} iguais), ${px.ms.toFixed(1)} ms cada` : "nada"}`);
    ok(snd > 50, `${tag} som chega na tela (${snd} pacotes)`);
    // a imagem na TV é a mesma do celular, pixel a pixel (sem perda)
    // compara em tamanho cheio (1x ou 2x), sem reduzir: reduzir escolhe pixels diferentes
    const sample = (d, top, k) => { const o = []; const n = 256 * k * (top ? 192 : 384) * k; for (let p = 0; p < n; p += 211) o.push(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]); return o; };
    const got = await tv.evaluate(([lo, src]) => {
      const s = eval(src), c = document.querySelector("#scrCanvas");
      const k = Math.round((lo === "side" ? c.width / 2 : c.width) / 256);
      const full = document.createElement("canvas"); full.width = 256 * k; full.height = 384 * k;
      const f = full.getContext("2d");
      const hw = 256 * k, hh = 192 * k;
      if (lo === "side") { f.drawImage(c, 0, 0, hw, hh, 0, 0, hw, hh); f.drawImage(c, hw, 0, hw, hh, 0, hh, hw, hh); }
      else f.drawImage(c, 0, 0);
      return { k, px: s(f.getImageData(0, 0, full.width, full.height).data, lo === "top", k) };
    }, [layout, sample.toString()]);
    const ref = await phone.evaluate(([src, k]) => {
      const s = eval(src), c = window.__cartucho.emu.fbCanvas, t = document.createElement("canvas");
      t.width = 256 * k; t.height = 384 * k;
      const g = t.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, t.width, t.height);
      return s(g.getImageData(0, 0, t.width, t.height).data, false, k);
    }, [sample.toString(), got.k]);
    let bad = 0;
    const n = got.px.length;
    let maxd = 0;
    for (let i = 0; i < n; i++) { const dd = Math.abs(ref[i] - got.px[i]); maxd = Math.max(maxd, dd); if (dd > 8) bad++; }
    ok(n > 0 && bad === 0, `${tag} imagem igual à do celular em ${got.k}x (${n - bad}/${n} amostras, diferença máx. ${maxd})`);
    // trocar a arrumação com a tela parada muda na TV na hora
    const other = layout === "side" ? "top" : "side";
    await phone.evaluate((lo) => { window.__ds.cast = lo; window.__cartucho.emu.relayout(); }, other);
    const changed = await tv.waitForFunction((side) => { const c = document.querySelector("#scrCanvas"); return side ? c.width / c.height > 2.5 : c.width / c.height < 1.5; }, other === "side", { timeout: 5000 }).then(() => true, () => false);
    await phone.evaluate((lo) => { window.__ds.cast = lo; window.__cartucho.emu.relayout(); }, layout);
    ok(changed, `${tag} trocar a arrumação aparece na TV (${other})`);
  } else ok(Math.abs(ratio - want) < 0.01 && sent.w <= 1536 && sent.h <= 1536, `${tag} vídeo enviado ${sent.w}x${sent.h}`);
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

// Modo console: o jogo roda na outra tela e o celular é só o controle
async function consoleOnce() {
  await phone.evaluate(() => { localStorage.removeItem("cartucho.castVideo"); localStorage.setItem("cartucho.tvNoCache", "1"); localStorage.setItem("cartucho.tvNoSlow", "1"); });   // a ROM vai mesmo (comprimida)
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
  const c0 = Date.now();
  const on = await phone.waitForFunction(() => !!(window.__cast.console && window.__cast.consoleSend), null, { timeout: 240000 }).then(() => true, () => false);
  ok(on, `[console] jogo abre na outra tela (ROM enviada comprimida, ${((Date.now() - c0) / 1000).toFixed(1)} s)`);
  await phone.evaluate(() => localStorage.removeItem("cartucho.tvNoCache"));
  if (!on) { await tv.close(); return; }
  const runs = await tv.waitForFunction(() => { const e = window.__cartucho.emu; return e && e.frames > 120 && !e.paused && window.__cartucho.guest; }, null, { timeout: 30000 }).then(() => true, () => false);
  ok(runs, "[console] a outra tela roda o jogo");
  const still = await phone.evaluate(() => window.__cartucho.emu.paused);
  ok(still, "[console] o celular fica parado (só controle)");
  const k0 = Date.now();
  await phone.evaluate(() => window.__cast.consoleSend(1 << 6));
  const got = await tv.waitForFunction(() => (window.__cast.remoteMask & (1 << 6)) !== 0, null, { timeout: 5000, polling: 10 }).then(() => Date.now() - k0, () => -1);
  await phone.evaluate(() => window.__cast.consoleSend(0));
  ok(got >= 0, `[console] botão do celular chega no jogo${got >= 0 ? ` (${got} ms)` : ""}`);
  const box = await phone.locator("#game .ds-view").boundingBox();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  const touched = await tv.waitForFunction(() => window.__cartucho.emu.touch, null, { timeout: 5000 }).then(() => true, () => false);
  await phone.mouse.up();
  ok(touched, "[console] toque no celular chega na outra tela");
  const pics = await phone.waitForFunction(() => (window.__cast.consolePics || 0) > 5, null, { timeout: 10000 }).then(() => true, () => false);
  ok(pics, "[console] a tela de baixo aparece no celular");
  // o que a outra tela mostra: só a de cima por padrão; troca pelo menu do celular
  const lay0 = await tv.evaluate(() => window.__cartucho.emu.localLayout());
  const mine = await phone.evaluate(() => window.__ds.cast);
  await phone.evaluate(() => { window.__ds.cast = "both"; window.dispatchEvent(new Event("ds-cast-layout")); });
  const lay1 = await tv.waitForFunction(() => window.__cartucho.emu.localLayout() === "both", null, { timeout: 5000 }).then(() => "both", () => "?");
  await phone.evaluate(() => { window.__ds.cast = "top"; window.dispatchEvent(new Event("ds-cast-layout")); });
  ok(lay0 === mine && lay1 === "both", `[console] arrumação na outra tela segue o celular (${lay0} → ${lay1})`);
  // menu do celular mexe no jogo de lá: pausar e desempenho
  await phone.evaluate(() => window.__cartucho.remote.pause());
  const paused = await tv.waitForFunction(() => window.__cartucho.emu.paused, null, { timeout: 5000 }).then(() => true, () => false);
  await phone.evaluate(() => window.__cartucho.remote.play());
  const resumed = await tv.waitForFunction(() => !window.__cartucho.emu.paused, null, { timeout: 5000 }).then(() => true, () => false);
  ok(paused && resumed, "[console] pausar pelo celular pausa a outra tela");
  const perf0 = await tv.evaluate(() => window.__ds.perf);
  const target = perf0 === "auto" ? "60" : "auto";
  await phone.evaluate((v) => { window.__ds.perf = v; window.__cartucho.remote.applyCfg(); }, target);
  const perfOk = await tv.waitForFunction((v) => window.__ds.perf === v, target, { timeout: 5000 }).then(() => true, () => false);
  ok(perfOk, `[console] ajuste do DS no celular vale na outra tela (desempenho ${perf0} → ${target})`);
  const snap = await phone.evaluate(async () => (await window.__cartucho.remote.gameManager.getState()).length);
  ok(snap > 1000, `[console] estado salvo pelo celular vem da outra tela (${Math.round(snap / 1024)} KB)`);
  const f0 = await tv.evaluate(() => window.__cartucho.emu.frames);
  await phone.evaluate(() => document.querySelector("#padStop").click());
  const back = await phone.waitForFunction(() => !window.__cast.console && !window.__cartucho.emu.paused, null, { timeout: 20000 }).then(() => true, () => false);
  ok(back, "[console] encerrar volta o jogo para o celular");
  const f1 = await phone.evaluate(() => window.__cartucho.emu.frames);
  ok(f1 > 0 && f0 > 0, `[console] estado veio da outra tela (quadros: tela ${f0}, celular ${f1})`);
  const again = await tv.waitForFunction(() => window.__tvScreen && window.__tvScreen.active && !document.querySelector("#screen").hidden, null, { timeout: 20000 }).then(() => true, () => false);
  ok(again, "[console] a outra tela volta para a espera");
  await tv.close();
}
if (!ONLY || ONLY === "cast" || ONLY === "console") await consoleOnce();

// outra tela lenta demais para emular: o celular volta a rodar e manda os pixels
async function slowFallback() {
  await phone.evaluate(() => { localStorage.removeItem("cartucho.castVideo"); localStorage.setItem("cartucho.tvForceSlow", "1"); localStorage.setItem("cartucho.castMode2", "0"); });
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
  const px = await phone.waitForFunction(() => !window.__cast.console && window.__cast.pixels && window.__cast.pc && window.__cast.pc.connectionState === "connected" && !window.__cartucho.emu.paused, null, { timeout: 90000 }).then(() => true, () => false);
  ok(px, "[lenta] troca sozinha para o modo pixels, com o jogo rodando no celular");
  await phone.evaluate(() => localStorage.removeItem("cartucho.tvForceSlow"));
  const shown = await tv.waitForFunction(() => window.__tvScreen.drawn > 0 && !document.querySelector("#scrCanvas").hidden, null, { timeout: 20000 }).then(() => true, () => false);
  ok(shown, "[lenta] a imagem aparece na outra tela");
  await tv.close();
  await phone.waitForFunction(() => !window.__cast.pc, null, { timeout: 15000 }).catch(() => {});
}
if (!ONLY || ONLY === "cast" || ONLY === "console") await slowFallback();

ok(errors.length === 0, `sem erros de JavaScript${errors.length ? ":\n  " + errors.join("\n  ") : ""}`);
await browser.close();
server.close();
console.log(failed ? `${failed} falha(s)` : "tudo certo");
process.exit(failed ? 1 : 0);
