import { player } from "./player/player.js";
import { closeSheets, openSheet } from "./ui/sheets.js";
import { $, el, ls, toast } from "./util.js";

/* ---------------- RetroAchievements ----------------
   O rcheevos (vendor/rcheevos.js, compilado de ra/ra.c) avalia as conquistas a cada quadro
   lendo a memória do jogo; as chamadas ao servidor do RA passam pelo /api/ra do site.
   Só modo casual (softcore): o hardcore pede emulador aprovado pelo RA.
   Conta: guarda só o usuário e o token (a senha vai uma vez, no login).
   Memória: DS = RAM principal do core (4 MB); GBA = IWRAM e EWRAM achadas na memória do
   EmulatorJS comparando com um save state (o mGBA guarda IWRAM em 0x19000 e EWRAM em 0x21000). */
const RA_KEY = "cartucho.ra";
const ra = window.__ra = { mod: null, loading: null, user: null, game: null, list: [], mem: null, waiting: {}, frameTimer: 0, lastFrame: -1, unlockedNow: [] };
const saved = () => { try { return JSON.parse(ls.get(RA_KEY) || "null"); } catch (e) { return null; } };

function loadModule() {
  if (ra.loading) return ra.loading;
  ra.loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/rcheevos.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("rcheevos"));
    document.head.append(s);
  }).then(() => window.createRcheevos({
    locateFile: (f) => "vendor/" + f,
    raRead,
    raServer,
    raEvent,
    raDone: (kind, result, msg) => { const w = ra.waiting[kind]; ra.waiting[kind] = null; if (w) w({ ok: result === 0, msg }); },
    raLog: (m) => console.debug("[ra]", m),
  })).then((m) => { ra.mod = m; m._ra_init(); return m; });
  ra.loading.catch(() => { ra.loading = null; });
  return ra.loading;
}
const call = (fn, ...strs) => {
  const m = ra.mod, ptrs = strs.map((s) => m.stringToNewUTF8(String(s)));
  try { return m[fn](...ptrs); } finally { for (const p of ptrs) m._free(p); }
};
const json = (fn) => { try { return JSON.parse(ra.mod.UTF8ToString(ra.mod[fn]())); } catch (e) { return null; } };
const wait = (kind, ms = 30000) => new Promise((resolve) => {
  ra.waiting[kind] = resolve;
  setTimeout(() => { if (ra.waiting[kind] === resolve) { ra.waiting[kind] = null; resolve({ ok: false, msg: "Sem resposta do RetroAchievements." }); } }, ms);
});

/* chamadas do rcheevos ao servidor: pelo /api/ra (corpo igual ao do dorequest.php) */
function raServer(url, post, ctype, cb, cbdata) {
  fetch("api/ra", { method: "POST", headers: { "Content-Type": ctype || "application/x-www-form-urlencoded", "X-Cartuchin": "1" }, body: post || "" })
    .then(async (r) => ({ status: r.status, text: await r.text() }), () => ({ status: -2, text: "" }))   // -2: falha de rede, o rcheevos tenta de novo
    .then(({ status, text }) => {
      const m = ra.mod, bytes = new TextEncoder().encode(text), p = m._malloc(bytes.length + 1);
      m.HEAPU8.set(bytes, p);
      m.HEAPU8[p + bytes.length] = 0;
      try { m._ra_response(cb, cbdata, p, bytes.length, status); } finally { m._free(p); }
    });
}

/* ---- memória do jogo, no endereço do RA ---- */
function raRead(addr, buf, n) {
  const mem = ra.mem;
  if (!mem) return 0;
  const reg = mem.regions.find((r) => addr >= r.start && addr + n <= r.start + r.size);
  if (!reg) return 0;
  const heap = reg.heap();
  ra.mod.HEAPU8.set(heap.subarray(reg.ptr + addr - reg.start, reg.ptr + addr - reg.start + n), buf);
  return n;
}
function dsMemory(emu) {
  const r = emu.ramInfo && emu.ramInfo();
  if (!r || !r.ptr) return null;
  return { regions: [{ start: 0, size: 0x400000, ptr: r.ptr, heap: () => emu.ramInfo().heap }] };
}
/* acha um bloco (do save state) dentro da memória do EmulatorJS */
function findBlock(heap, block, isCopy) {
  // um trecho de 64 bytes bem variado como agulha; depois confere o bloco inteiro
  let best = -1, bestScore = -1;
  for (let o = 0; o + 64 <= block.length; o += 256) {
    const seen = new Set();
    for (let i = 0; i < 64; i++) seen.add(block[o + i]);
    if (seen.size > bestScore) { bestScore = seen.size; best = o; }
    if (bestScore >= 40) break;
  }
  if (bestScore < 8) return -1;   // memória quase vazia (começo do jogo): tenta mais tarde
  const needle = block.subarray(best, best + 64), first = needle[0];
  for (let i = heap.indexOf(first); i >= 0 && i < heap.length - block.length; i = heap.indexOf(first, i + 1)) {
    let ok = true;
    for (let k = 1; k < 64; k++) if (heap[i + k] !== needle[k]) { ok = false; break; }
    if (!ok) continue;
    const base = i - best;
    if (base < 0 || (isCopy && isCopy(base))) continue;   // a cópia dentro do próprio save state não serve
    let same = 0;
    for (let k = 0; k < block.length; k += 61) if (heap[base + k] === block[k]) same++;
    if (same >= Math.floor(block.length / 61) * 0.98) return base;
  }
  return -1;
}
async function gbaMemory(emu) {
  const gm = emu.gameManager, M = gm.Module;
  if (!M || !M.HEAPU8) return null;
  const wasPaused = emu.paused;
  try { emu.pause(); } catch (e) {}
  try {
    await new Promise((r) => setTimeout(r, 50));
    let st = gm.getState();
    // o RetroArch embrulha o estado do core: "RASTATE" + versão + bloco "MEM " (tamanho) + estado do mGBA
    if (st && st.length > 16 && String.fromCharCode(...st.subarray(0, 7)) === "RASTATE" && String.fromCharCode(...st.subarray(8, 12)) === "MEM ") st = st.subarray(16);
    if (!st || st.length < 0x61000) return null;
    const heap = M.HEAPU8, head = st.subarray(0, 32);
    // o save state também fica na memória do EmulatorJS: pula o bloco que é parte dele
    const inState = (at) => (base) => base - at >= 0 && head.every((b, k) => heap[base - at + k] === b);
    const ew = findBlock(heap, st.subarray(0x21000, 0x61000), inState(0x21000));
    const iw = findBlock(heap, st.subarray(0x19000, 0x21000), (b) => inState(0x19000)(b) || (ew >= 0 && b >= ew && b < ew + 0x40000));
    if (iw < 0 || ew < 0) return null;
    return { regions: [
      { start: 0x000000, size: 0x8000, ptr: iw, heap: () => M.HEAPU8 },
      { start: 0x008000, size: 0x40000, ptr: ew, heap: () => M.HEAPU8 },
    ] };
  } finally { if (!wasPaused) { try { emu.play(); } catch (e) {} } }
}

/* ---- hash do jogo, como o RA calcula ---- */
async function md5Parts(parts) {
  const m = ra.mod, st = m._ra_md5_new();
  for (const u8 of parts) {
    for (let o = 0; o < u8.length; o += 1 << 20) {
      const piece = u8.subarray(o, o + (1 << 20)), p = m._malloc(piece.length);
      m.HEAPU8.set(piece, p);
      m._ra_md5_append(st, p, piece.length);
      m._free(p);
    }
  }
  const out = m._malloc(16);
  m._ra_md5_finish(st, out);
  const hex = Array.from(m.HEAPU8.subarray(out, out + 16), (b) => b.toString(16).padStart(2, "0")).join("");
  m._free(out);
  return hex;
}
async function gameHash(rom) {
  const blob = rom.blob, sys = rom.system;
  if (sys === "gba") return md5Parts([new Uint8Array(await blob.arrayBuffer())]);
  if (sys !== "nds") return null;
  // DS: cabeçalho (0x160) + código ARM9 + código ARM7 + ícone (0xA00)
  const bytes = async (from, n) => new Uint8Array(await blob.slice(from, from + n).arrayBuffer());
  const h = await bytes(0, 512), dv = new DataView(h.buffer);
  const a9 = dv.getUint32(0x20, true), s9 = dv.getUint32(0x2C, true), a7 = dv.getUint32(0x30, true), s7 = dv.getUint32(0x3C, true), ic = dv.getUint32(0x68, true);
  if (s9 + s7 > 16 << 20) return null;
  const icon = new Uint8Array(0xA00);
  icon.set(await bytes(ic, 0xA00));
  return md5Parts([h.subarray(0, 0x160), await bytes(a9, s9), await bytes(a7, s7), icon]);
}

/* ---- conta ---- */
async function login(user, pass) {
  await loadModule();
  call("_ra_login_password", user, pass);
  const r = await wait(1);
  if (!r.ok) return r;
  ra.user = json("_ra_user_json");
  if (ra.user) ls.set(RA_KEY, JSON.stringify({ user: ra.user.username, token: ra.user.token }));
  renderAccount();
  return r;
}
async function resume() {
  const s = saved();
  if (!s || ra.user) return !!ra.user;
  await loadModule();
  call("_ra_login_token", s.user, s.token);
  const r = await wait(1);
  if (r.ok) ra.user = json("_ra_user_json");
  else if (/token|password|credential|invalid/i.test(r.msg || "")) ls.set(RA_KEY, "");   // token revogado: entra de novo
  renderAccount();
  return r.ok;
}
function logout() {
  if (ra.mod) ra.mod._ra_logout();
  ra.user = null;
  ls.set(RA_KEY, "");
  renderAccount();
}

/* ---- jogo ---- */
async function startGame() {
  ra.game = null; ra.list = []; ra.mem = null;
  stopFrames();
  const emu = player.emu, rom = player.rom;
  if (!saved() || !emu || !rom || player.guest || emu.workerCore) return;
  try {
    if (!(await resume())) return;
    const key = "cartucho.rahash." + player.key;
    let hash = ls.get(key);
    if (!hash) { hash = await gameHash(rom); if (hash) ls.set(key, hash); }
    if (!hash) return;
    // a memória precisa estar pronta antes de carregar as conquistas: o rcheevos lê na hora e
    // desativa (como "sem suporte") a conquista cujo endereço não respondeu
    ra.mem = player.isDs ? dsMemory(emu) : await gbaMemory(emu);
    for (let i = 0; !ra.mem && i < 30 && player.emu === emu; i++) {   // começo do jogo: RAM ainda vazia
      await new Promise((r) => setTimeout(r, 4000));
      ra.mem = await gbaMemory(emu);
    }
    if (!ra.mem || player.emu !== emu) return;
    call("_ra_load_game", hash);
    const r = await wait(2);
    if (!r.ok) { if (!/unknown|not found|unrecognized/i.test(r.msg || "")) console.warn("[ra] jogo", r.msg); return; }
    ra.game = json("_ra_game_json");
    ra.list = json("_ra_achievements_json") || [];
    if (ra.game && ra.game.total) toast(`🏆 RetroAchievements: ${ra.game.unlocked} de ${ra.game.total} conquistas`, 4000);
    startFrames(emu);
  } catch (e) { console.warn("[ra]", e); }
}
/* um rc_client_do_frame por quadro do jogo (no DS o core avisa; no GBA confere a cada atualização de tela) */
function startFrames(emu) {
  if (emu.isDs) { emu.onEmuFrame = () => { if (ra.mem) ra.mod._ra_do_frame(); }; return; }
  const gm = emu.gameManager;
  let idleAt = 0;
  const loop = () => {
    if (player.emu !== emu || !ra.game) return;
    ra.frameTimer = requestAnimationFrame(loop);
    let f = -1;
    try { f = Number(gm.getFrameNum()); } catch (e) {}
    if (f !== ra.lastFrame && ra.mem) { ra.lastFrame = f; ra.mod._ra_do_frame(); }
    else if (performance.now() - idleAt > 1000) { idleAt = performance.now(); ra.mod._ra_idle(); }
  };
  loop();
}
function stopFrames() {
  cancelAnimationFrame(ra.frameTimer);
  if (player.emu) player.emu.onEmuFrame = null;
}

/* ---- avisos ---- */
function raEvent(type, id, data) {
  let a = null;
  try { a = data ? JSON.parse(data) : null; } catch (e) {}
  if (type === 1 && a) {   // conquista
    popup(a.badge, "Conquista desbloqueada", `${a.title} (+${a.points})`);
    ra.unlockedNow.push(a.id);
    ra.list = json("_ra_achievements_json") || ra.list;
    ra.game = json("_ra_game_json") || ra.game;
  } else if (type === 15) popup(ra.game && ra.game.badge, "Jogo completo!", "Todas as conquistas desbloqueadas");
  else if (type === 16 && a) toast("RetroAchievements: " + (a.error || "erro do servidor"), 4000);
  else if (type === 17) toast("RetroAchievements sem conexão: as conquistas vão quando a rede voltar.", 4000);
}
function popup(img, title, text) {
  const box = el("div", { class: "ra-pop", role: "status" },
    img ? el("img", { src: img, alt: "", width: "48", height: "48" }) : el("span", { class: "ra-cup" }, "🏆"),
    el("div", {}, el("b", {}, title), el("span", {}, text)));
  document.body.append(box);
  setTimeout(() => box.classList.add("out"), 4200);
  setTimeout(() => box.remove(), 4800);
}

/* ---- telas ---- */
function renderAccount() {
  const line = $("#raLine"), btn = $("#raBtn");
  if (!line) return;
  const s = saved();
  line.textContent = ra.user ? `Conectado como ${ra.user.name} · ${ra.user.score} pontos (modo casual)` : s ? `Conta ${s.user}` : "Conquistas dos jogos com a sua conta do retroachievements.org (modo casual).";
  btn.textContent = s ? "Sair do RetroAchievements" : "Entrar no RetroAchievements";
}
function askLogin() {
  const root = $("#dialogRoot");
  const u = el("input", { type: "text", autocomplete: "username", placeholder: "Usuário", class: "code-input" });
  const p = el("input", { type: "password", autocomplete: "current-password", placeholder: "Senha", class: "code-input" });
  const msg = el("p", { class: "small-note" }, "A senha vai uma vez para o RetroAchievements e não fica guardada aqui.");
  const close = () => root.replaceChildren();
  const form = el("form", { class: "dialog", onsubmit: async (e) => {
    e.preventDefault();
    if (!u.value.trim() || !p.value) return;
    msg.textContent = "Entrando…";
    const r = await login(u.value.trim(), p.value).catch(() => ({ ok: false, msg: "Não deu para carregar o RetroAchievements." }));
    if (r.ok) { close(); toast(`RetroAchievements: conectado como ${ra.user ? ra.user.name : u.value}`); if (player.emu) startGame(); }
    else msg.textContent = r.msg || "Usuário ou senha incorretos.";
  } },
    el("h2", {}, "RetroAchievements"), u, p, msg,
    el("button", { class: "btn primary", type: "submit" }, "Entrar"),
    el("button", { class: "btn", type: "button", onclick: close }, "Cancelar"),
    el("p", { class: "small-note" }, "Ainda não tem conta? Crie grátis em retroachievements.org."));
  root.replaceChildren(el("div", { class: "scrim" }, form));
  u.focus();
}
const sheet = el("section", { class: "sheet", id: "raSheet", role: "dialog", "aria-modal": "true", "aria-label": "Conquistas", hidden: true });
document.body.append(sheet);
function openAchievements() {
  const g = ra.game;
  const items = (ra.list || []).slice().sort((a, b) => b.unlocked - a.unlocked || a.bucket - b.bucket);
  sheet.replaceChildren(el("div", { class: "sheet-grip", "aria-hidden": "true" }),
    el("div", { class: "sheet-body" },
      el("h3", {}, g ? `${g.title}: ${g.unlocked} de ${g.total} · ${g.pointsUnlocked}/${g.points} pontos` : "Conquistas"),
      el("div", { class: "ra-list" }, ...items.map((a) => el("div", { class: "ra-item" + (a.unlocked ? " on" : "") },
        el("img", { src: a.unlocked ? a.badge : a.badgeLocked, alt: "", width: "48", height: "48", loading: "lazy" }),
        el("div", {}, el("b", {}, `${a.title} · ${a.points}`), el("span", {}, a.description),
          a.progress && !a.unlocked ? el("span", { class: "ra-prog" }, a.progress) : null)))),
      el("p", { class: "small-note" }, "Modo casual: as conquistas valem no seu perfil do retroachievements.org."),
      el("button", { class: "btn", type: "button", onclick: closeSheets }, "Voltar ao jogo")));
  openSheet("raSheet");
}
const raSummary = () => (ra.game && ra.game.total ? `${ra.game.unlocked}/${ra.game.total}` : "");

window.addEventListener("cartucho-game-running", () => { startGame(); });
document.addEventListener("click", (e) => {
  if (e.target.closest("#raBtn")) { if (saved()) logout(); else askLogin(); }
});
renderAccount();

export { ra, login, logout, openAchievements, raSummary, gameHash };
