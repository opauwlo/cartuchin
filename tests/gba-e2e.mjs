// Teste automático do GBA: abre a ROM de teste (tests/make_gba_test_rom.py), confere que o
// jogo roda, que o botão chega no jogo, o save, os estados e as duas formas de segunda tela
// (pixels: o celular roda e manda a imagem; console: o jogo roda na outra tela).
// Como o teste do DS, as duas páginas conversam por um BroadcastChannel no lugar do ntfy.sh.
//
//   node tests/gba-e2e.mjs        (CHROMIUM_PATH=... para usar outro Chromium)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROM = path.join(root, "tests/gba-test.gba");
if (!fs.existsSync(ROM)) execFileSync("python3", [path.join(root, "tests/make_gba_test_rom.py"), ROM]);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
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
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required", "--allow-loopback-in-peer-connection",
    // celular e TV são aparelhos diferentes, os dois em primeiro plano: aqui nenhuma página fica em segundo plano
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route(/^https:\/\//, (r) => r.fulfill({ status: 404, body: "" }));
await ctx.addInitScript(() => {
  localStorage.setItem("cartucho.localOnly", "1");
  const NT = "https://ntfy.sh/";
  const bc = new BroadcastChannel("fake-ntfy");
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).startsWith(NT)) {
      bc.postMessage({ topic: String(url).slice(NT.length), message: String(opts.body), id: Math.random().toString(36).slice(2) });
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
});

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "OK   " : "FALHA") + " " + msg); if (!cond) failed++; };
const errors = [];
// cor média de um canvas (ou do canvas do jogo); a ROM pinta vermelho + botões em verde/azul
// (o canvas do EmulatorJS é WebGL sem preservar o quadro: lido pela captura, como a transmissão faz)
const PIXEL = `async (sel) => {
  const c = document.querySelector(sel);
  if (!c || !c.width) return null;
  let src = c;
  if (c.getContext && !c.getContext("2d")) {
    const tr = c.captureStream(30).getVideoTracks()[0];
    try { src = await new ImageCapture(tr).grabFrame(); } catch (e) { tr.stop(); return null; }
    tr.stop();
  }
  const t = document.createElement("canvas"); t.width = 24; t.height = 16;
  const g = t.getContext("2d"); g.drawImage(src, 0, 0, 24, 16);
  const d = g.getImageData(0, 1, 24, 3).data; let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return { r: Math.round(r / n), g: Math.round(gr / n), b: Math.round(b / n) };
}`;
const color = (page, sel) => page.evaluate(`(${PIXEL})(${JSON.stringify(sel)})`);

const phone = await ctx.newPage();
phone.on("pageerror", (e) => { if (!/Wake Lock/.test(e.message)) errors.push("celular: " + e.message); });
phone.on("dialog", (d) => d.accept());
await phone.goto(base);
await phone.setInputFiles("#romInput", ROM);
await phone.waitForSelector("#games .tile:not(.add-tile)", { timeout: 30000 });
await phone.click("#games .tile:not(.add-tile)");
await phone.click("#gameSheet .btn.primary");
const started = await phone.waitForFunction(() => {
  const e = window.__cartucho && window.__cartucho.emu;
  if (e && e.started && e.gameManager) return true;
  const b = document.querySelector(".dialog .btn.primary");
  if (b) b.click();
  return false;
}, null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
ok(started, "GBA abre a ROM");
if (!started) { await browser.close(); server.close(); process.exit(1); }
await phone.waitForTimeout(1500);
const fps = await phone.evaluate(async () => { const gm = window.__cartucho.emu.gameManager, f0 = gm.getFrameNum(), t0 = performance.now(); await new Promise((r) => setTimeout(r, 3000)); return Math.round((gm.getFrameNum() - f0) / ((performance.now() - t0) / 1000)); });
console.log(`      velocidade no celular: ${fps} quadros/s`);
const c0 = await color(phone, "#game canvas");
ok(!!c0 && c0.r > 150 && c0.g < 60, `tela do jogo aparece (vermelho: ${JSON.stringify(c0)})`);

// botão A pelo controle na tela: a ROM pinta verde e grava no save
const press = async (page, btn, down) => {
  const box = await page.locator(`#pad [data-btn="${btn}"]`).boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (down) await page.mouse.down(); else await page.mouse.up();
  return true;
};
const hasPad = await press(phone, "A", true);
const savA = await phone.waitForFunction(() => { const s = window.__cartucho.emu.gameManager.getSaveFile(); return s && s.length && s[0] === 1 ? 1 : 0; }, null, { timeout: 5000 }).then(() => 1, () => 0);
const greenOn = await phone.waitForFunction(`(async () => { const c = await (${PIXEL})("#game canvas"); return !!c && c.g > 20; })()`, null, { timeout: 5000, polling: 50 }).then(() => true, () => false);
if (hasPad) await press(phone, "A", false);
ok(hasPad && greenOn, "botão A do controle na tela chega no jogo");
ok(savA === 1, `o jogo grava no save (byte ${savA})`);

// estados: salvar, mexer, carregar volta
const st = await phone.evaluate(async () => {
  const ok1 = await window.__states.saveState({ quiet: true });
  const list = await window.__states.list(window.__cartucho.key);
  const ok2 = list.length ? await window.__states.loadState(window.__cartucho.key, list[0].id) : false;
  for (const it of list) await window.__states.removeState(window.__cartucho.key, it.id);
  return { ok1, ok2, n: list.length, thumb: !!(list[0] && list[0].thumb) };
});
ok(st.ok1 && st.ok2 && st.n === 1, `estado salva e carrega${st.thumb ? " (com miniatura)" : " (sem miniatura)"}`);

// tempo de jogo conta enquanto joga; favorito liga e desliga
const meta = await phone.evaluate(async () => {
  const k = window.__cartucho.key;
  window.__meta.account(); await new Promise((r) => setTimeout(r, 1500)); window.__meta.account();
  const ms = window.__meta.gameMeta(k).ms;
  const on = window.__meta.toggleFav(k), off = window.__meta.toggleFav(k);
  return { ms, on, off };
});
ok(meta.ms >= 1000, `tempo de jogo conta (${meta.ms} ms)`);
ok(meta.on === true && meta.off === false, "favoritar e desfavoritar");

// RetroAchievements: servidor do RA simulado em /api/ra; uma conquista "aperte A" (EWRAM[0] = 1)
{
  const calls = [];
  await ctx.route("**/api/ra", async (route) => {
    const body = route.request().postData() || "";
    const r = new URLSearchParams(body).get("r");
    calls.push(r);
    const reply = {
      login2: { Success: true, User: "Tester", Token: "tok123", Score: 0, SoftcoreScore: 10, Messages: 0, Permissions: 1, AccountType: "Registered" },
      achievementsets: { Success: true, GameId: 77, Title: "Teste", ConsoleId: 5, ImageIconUrl: "", RichPresenceGameId: 77, RichPresencePatch: "",
        Sets: [{ AchievementSetId: 1, GameId: 77, Title: null, Type: "core", ImageIconUrl: "",
          Achievements: [{ ID: 101, Title: "Aperte A", Description: "Aperte o botão A", Flags: 3, Points: 5, MemAddr: "0xH8000=1", Author: "t", BadgeName: "00001", Created: 1, Modified: 1 }],
          Leaderboards: [] }] },
      startsession: { Success: true, Unlocks: [], HardcoreUnlocks: [], ServerNow: Math.floor(Date.now() / 1000) },
      awardachievement: { Success: true, Score: 0, SoftcoreScore: 15, AchievementID: 101, AchievementsRemaining: 0 },
    }[r] || { Success: true };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
  await phone.evaluate(() => document.querySelector("#raBtn").click());
  await phone.fill(".dialog input[type=text]", "Tester");
  await phone.fill(".dialog input[type=password]", "senha");
  await phone.click(".dialog button[type=submit]");
  const loaded = await phone.waitForFunction(() => window.__ra && window.__ra.game && window.__ra.mem, null, { timeout: 30000 }).then(() => true, () => false);
  ok(loaded, `[conquistas] login, jogo reconhecido e memória achada (${calls.join(", ")})`);
  const hash = await phone.evaluate(() => localStorage.getItem("cartucho.rahash." + window.__cartucho.key));
  const md5 = (await import("node:crypto")).createHash("md5").update(fs.readFileSync(ROM)).digest("hex");
  ok(hash === md5, `[conquistas] hash do jogo igual ao do RA (${hash})`);
  if (loaded) {
    await press(phone, "A", true);
    const got = await phone.waitForFunction(() => window.__ra.unlockedNow.includes(101), null, { timeout: 10000 }).then(() => true, () => false);
    if (!got) console.log("      dbg", JSON.stringify(await phone.evaluate(() => { const r = window.__ra, reg = r.mem.regions[1], h = reg.heap(); return { regs: r.mem.regions.map((x) => [x.start, x.size, x.ptr]), ew0: h[reg.ptr], ew1: h[reg.ptr + 1], ew5: h[reg.ptr + 5], frame: r.lastFrame, list: r.list.map((a) => [a.id, a.unlocked, a.bucket]) }; })));
    await press(phone, "A", false);
    await phone.waitForTimeout(1500);
    ok(got && calls.includes("awardachievement"), "[conquistas] conquista desbloqueia ao apertar A e vai para o servidor");
    const pop = await phone.evaluate(() => !!document.querySelector(".ra-pop"));
    ok(pop, "[conquistas] aviso de conquista na tela");
  }
}

async function tvPage() {
  const tv = await ctx.newPage();
  await tv.setViewportSize({ width: 960, height: 540 });   // TV / notebook deitado
  tv.on("pageerror", (e) => { if (!/Wake Lock/.test(e.message)) errors.push("tela: " + e.message); });
  await tv.goto(base);
  await tv.click("#screenBtn");
  await tv.waitForFunction(() => window.__tvScreen && window.__tvScreen.code, null, { timeout: 15000 });
  return [tv, await tv.evaluate(() => window.__tvScreen.code)];
}
async function connect(code) {
  await phone.bringToFront();
  await phone.click("#castBtn");
  await phone.fill(".dialog input", code);
  await phone.click(".dialog button[type=submit]");
}

// segunda tela, modo pixels (o celular roda o jogo e manda só o que muda)
{
  await phone.evaluate(() => { localStorage.setItem("cartucho.castVideo", "1"); localStorage.setItem("cartucho.castMode2", "0"); });
  const [tv, code] = await tvPage();
  await connect(code);
  const conn = await phone.waitForFunction(() => window.__cast.pixels && window.__cast.pc && window.__cast.pc.connectionState === "connected", null, { timeout: 30000 }).then(() => true, () => false);
  ok(conn, "[pixels] conecta");
  const shown = await tv.waitForFunction(`(async () => { const c = await (${PIXEL})("#scrCanvas"); return !!c && c.r > 150 && window.__tvScreen.drawn > 10; })()`, null, { timeout: 20000 }).then(() => true, () => false);
  const tc = await color(tv, "#scrCanvas");
  const px = await phone.evaluate(() => ({ ...window.__cast.pixels.stat }));
  ok(shown, `[pixels] imagem aparece e se mexe na tela (${JSON.stringify(tc)}, ${px.sent} pacotes, ${Math.round(px.bytes / 1024)} KB, ${px.ms.toFixed(1)} ms cada)`);
  const size = await tv.evaluate(() => [document.querySelector("#scrCanvas").width, document.querySelector("#scrCanvas").height]);
  ok(size[0] === 240 && size[1] === 160, `[pixels] tamanho exato do GBA (${size.join("x")})`);
  // tecla na TV vira botão no jogo do celular, e a imagem na TV muda (o celular segue na frente:
  // no teste as duas páginas dividem uma janela, e a de trás quase não roda)
  await tv.keyboard.down("Enter");   // Enter = A no teclado da TV
  const greenTv = await tv.waitForFunction(`(async () => { const c = await (${PIXEL})("#scrCanvas"); return !!c && c.g > 20; })()`, null, { timeout: 5000, polling: 50 }).then(() => true, () => false);
  await tv.keyboard.up("Enter");
  ok(greenTv, "[pixels] botão da TV chega no jogo e a imagem muda lá");
  await tv.close();
  await phone.waitForFunction(() => !window.__cast.pc, null, { timeout: 15000 }).catch(() => {});
}

// segunda tela, modo console (o jogo roda na outra tela)
{
  await phone.evaluate(() => { localStorage.removeItem("cartucho.castVideo"); localStorage.setItem("cartucho.tvNoCache", "1"); });
  const [tv, code] = await tvPage();
  await connect(code);
  const on = await phone.waitForFunction(() => !!(window.__cast.console && window.__cast.consoleSend), null, { timeout: 90000 }).then(() => true, () => false);
  ok(on, "[console] jogo abre na outra tela");
  if (on) {
    await tv.bringToFront();   // agora quem roda o jogo é a outra tela
    const runs = await tv.waitForFunction(() => { const e = window.__cartucho.emu; return e && e.started && window.__cartucho.guest; }, null, { timeout: 30000 }).then(() => true, () => false);
    ok(runs, "[console] a outra tela roda o jogo");
    const tvFps = await tv.evaluate(async () => { const gm = window.__cartucho.emu.gameManager, f0 = gm.getFrameNum(), t0 = performance.now(); await new Promise((r) => setTimeout(r, 3000)); return Math.round((gm.getFrameNum() - f0) / ((performance.now() - t0) / 1000)); });
    console.log(`      velocidade na outra tela: ${tvFps} quadros/s`);
    await tv.waitForFunction(`(async () => { const c = await (${PIXEL})("#game canvas"); return !!c && c.r > 150; })()`, null, { timeout: 15000 }).catch(() => {});
    const t0 = await color(tv, "#game canvas");
    if (process.env.SHOT) await tv.screenshot({ path: process.env.SHOT });
    ok(!!t0 && t0.r > 150, `[console] imagem na outra tela (${JSON.stringify(t0)})`);
    const k0 = Date.now();
    await phone.evaluate(() => window.__cast.consoleSend((1 << 7) | 1));   // A + B (PAD_BITS): save = 3, diferente de tudo antes
    const green = await tv.waitForFunction(`(async () => { const c = await (${PIXEL})("#game canvas"); return !!c && c.g > 20; })()`, null, { timeout: 5000, polling: 20 }).then(() => Date.now() - k0, () => -1);
    // o save de lá chega aqui (a outra tela manda quando muda)
    await tv.waitForTimeout(800);
    await phone.evaluate(() => window.__cartucho.remote.gameManager.fetchSave());   // como o "Salvar" do menu faz
    const remoteSav = await phone.waitForFunction(() => window.__cartucho.remoteSav && window.__cartucho.remoteSav[0] === 3, null, { timeout: 25000 }).then(() => true, () => false);
    if (!remoteSav) console.log("      dbg2", JSON.stringify(await tv.evaluate(async () => { const gm = window.__cartucho.emu.gameManager; gm.saveSaveFiles(); await new Promise((r) => setTimeout(r, 500)); const s = gm.getSaveFile(false); return { b0: s && s[0], rm: window.__cast.remoteMask, lm: window.__cast.lastMask }; })), JSON.stringify(await phone.evaluate(() => window.__cartucho.remoteSav && window.__cartucho.remoteSav[0])));
    if (!remoteSav) console.log("      dbg", JSON.stringify(await tv.evaluate(() => { const s = window.__cartucho.emu.gameManager.getSaveFile(); return [s && s.length, s && s[0], window.__cast.remoteMask, window.__cartucho.emu.gameManager.getFrameNum(), document.visibilityState, document.hasFocus()]; })), JSON.stringify(await phone.evaluate(() => { const r = window.__cartucho.remoteSav; return r ? [r.length, r[0]] : null; })));
    await phone.evaluate(() => window.__cast.consoleSend(0));
    ok(green >= 0, `[console] botão do celular chega no jogo de lá${green >= 0 ? ` (${green} ms até a imagem mudar)` : ""}`);
    ok(remoteSav, "[console] save da outra tela volta para o celular");
    await phone.evaluate(() => document.querySelector("#padStop").click());
    const back = await phone.waitForFunction(() => !window.__cast.console && window.__cartucho.emu && !window.__cartucho.emu.paused, null, { timeout: 20000 }).then(() => true, () => false);
    ok(back, "[console] encerrar volta o jogo para o celular");
  }
  await phone.evaluate(() => localStorage.removeItem("cartucho.tvNoCache"));
  await tv.close();
}

// biblioteca e página do jogo mostram as conquistas (guardadas depois de jogar)
{
  await phone.bringToFront();
  await phone.evaluate(() => { window.__cartucho.leaving = true; });
  await phone.goto(base);
  const tileRa = await phone.waitForSelector("#games .tile-ra", { timeout: 10000 }).then((e) => e.textContent(), () => "");
  ok(/1\/1/.test(tileRa), `[detalhes] contador de conquistas na biblioteca (${tileRa})`);
  await phone.click("#games .tile:not(.add-tile)");
  await phone.click("#gsDetails");
  const det = await phone.waitForFunction(() => { const p = document.querySelector("#gameDetails"); return p && !p.hidden && p.querySelectorAll(".gd-badge.on").length === 1 && /Tempo de jogo/.test(p.textContent); }, null, { timeout: 5000 }).then(() => true, () => false);
  ok(det, "[detalhes] página do jogo com tempo de jogo e conquistas");
  await phone.goBack();
  const closed = await phone.waitForFunction(() => document.querySelector("#gameDetails").hidden, null, { timeout: 3000 }).then(() => true, () => false);
  ok(closed, "[detalhes] voltar fecha a página do jogo");
}

ok(errors.length === 0, `sem erros de JavaScript${errors.length ? ":\n  " + errors.join("\n  ") : ""}`);
await browser.close();
server.close();
console.log(failed ? `${failed} falha(s)` : "tudo certo");
process.exit(failed ? 1 : 0);
