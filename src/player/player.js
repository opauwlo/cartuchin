import { b64, pack, sha, unpack } from "../bytes.js";
import { STREAM_H, STREAM_W } from "../cast/constants.js";
import { padMsg, showPad } from "../cast/pad.js";
import { cast } from "../cast/phone.js";
import { connectScreen } from "../cast/console.js";
import { askGoogleToken, cloud, cloudName, fetchRom, gauth, getSaveDoc, googleNeedsTap, isGoogle, putFile, readJson, refreshLibrary, tokenFresh, utf8, writeCloud, hasServerSession, serverToken } from "../cloud.js";
import { device } from "../device.js";
import { idb } from "../idb.js";
import { roms } from "../library.js";
import { PROFILES, coreOptions, perfProfile, startSpeedMeter, startSpeedGovernor } from "./perf.js";
import { fixSaveChip } from "../rom.js";
import { createDsEmulator, ds, dsLastError, dsStatesOk } from "../ds/ds-emu.js";
import { gameCfg } from "../gamecfg.js";
import { dialog } from "../ui/dialogs.js";
import { render } from "../ui/screens.js";
import { $, actionToast, ago, el, sleep, toast } from "../util.js";

/* ---------------- player + sync ---------------- */
/** The game currently open: which one, the emulator instance and the save-sync state. */
const player = window.__cartucho = {
  key: null, meta: null,
  /** @type {any} the EmulatorJS instance */ emu: null,
  lastSha: null, baseRev: null, busy: false, again: false, timer: null, state: "loading", at: 0,
  stateBusy: false, stateFrames: 0,
};

function setChip(state, at) {
  player.state = state;
  if (at) player.at = at;
  updateChip();
}
function updateChip() {
  const dot = $("#pChip .dot"), txt = $("#pChipText");
  const map = {
    loading: ["", "Carregando…"], ok: ["ok", "Save na nuvem " + ago(player.at)], up: ["warn", "Enviando save…"],
    pending: ["warn", "Save guardado aqui, envio pendente"], local: ["warn", "Save só neste aparelho"], none: ["", "Sem save ainda"],
  };
  const [cls, t] = map[player.state] || map.loading;
  dot.className = "dot " + cls;
  txt.textContent = t;
  const ps = $("#padSaveState");
  if (ps) ps.textContent = player.state === "ok" ? "· salvo " + ago(player.at) : player.state === "up" ? "· enviando…" : player.state === "pending" ? "· save pendente" : "";
}
setInterval(() => {
  if (player.key) {
    if (player.state === "ok") updateChip();
    return;
  }
  if (cloud.db && document.visibilityState === "visible") refreshLibrary().then(render).catch(() => {});
  else if (cloud.ready) render();
}, 30000);

function savPath(gm) { return gm.getSaveFilePath(); }
function writeSav(gm, sav) {
  if (gm.writeSav) return gm.writeSav(sav);   // DS: o adaptador guarda e aplica no restart()
  const path = savPath(gm);
  const parts = path.split("/");
  let cp = "";
  for (let i = 0; i < parts.length - 1; i++) {
    if (!parts[i]) continue;
    cp += "/" + parts[i];
    if (!gm.FS.analyzePath(cp).exists) gm.FS.mkdir(cp);
  }
  if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
  gm.FS.writeFile(path, sav);
}

/* GBA (EmulatorJS): pedir o save manda o core gravar o arquivo, mas a gravação termina uns
   quadros depois; ler na hora devolve o save da vez anterior. Grava, espera e lê. */
async function freshSave(gm, wait = true) {
  if (!wait || typeof gm.saveSaveFiles !== "function") return gm.getSaveFile();
  try { gm.saveSaveFiles(); } catch (e) {}
  await sleep(300);
  return gm.getSaveFile(false);
}
async function flush(opts = {}) {
  const emu = player.emu;
  if (!emu || !emu.started || !emu.gameManager || !player.key || player.guest) return;   // guest: jogo de outro aparelho (modo console), quem salva é ele
  if (player.busy) {
    player.again = true;
    return;
  }
  player.busy = true;
  try {
    let sav = null;
    // modo console: o jogo roda na outra tela, que manda o save dela para cá
    try { sav = player.remoteSav || await freshSave(emu.gameManager, !opts.leaving); } catch (e) {}
    if (!sav || !sav.length) {
      if (!player.lastSha) setChip("none");
      return;
    }
    sav = new Uint8Array(sav);
    const h = await sha(sav);
    if (h === player.lastSha) return;
    await idb.put("pend", player.key, { sav, sha: h, baseRev: player.baseRev, at: Date.now() }).catch(() => {});
    if (!cloud.db) {
      player.lastSha = h;
      setChip("local");
      return;
    }
    setChip("up");
    try {
      const doc = await writeCloud(player.key, player.meta, sav, h, { keepalive: !!opts.leaving });
      player.lastSha = h;
      player.baseRev = doc.rev;
      await idb.del("pend", player.key);
      await idb.put("sync", player.key, { lastSha: h, baseRev: doc.rev }).catch(() => {});
      setChip("ok", doc.at);
      if (!$("#pad").hidden && !opts.quiet) padMsg("Save enviado para a nuvem");
    } catch (e) { setChip("pending"); }
  } finally {
    player.busy = false;
    if (player.again) {
      player.again = false;
      setTimeout(flush, 500);
    }
  }
}

/* ---------------- continue where you left off ----------------
   Besides the game's own save, the app keeps a snapshot of the whole console
   (a save state) in states/<game>.json, taken only when you tap Salvar. Opening the
   game on any device then picks
   up at that exact moment, as long as the snapshot belongs to the same in-game
   save that is being loaded (otherwise the two would disagree). */
const stateShas = new Map();
const isBlankSave = (u8) => {
  if (!u8 || !u8.length) return true;   // sem save nenhum (DS antes do primeiro save)
  const f = u8[0];
  if (f !== 0xff && f !== 0) return false;
  for (let i = 0; i < u8.length; i++) if (u8[i] !== f) return false;
  return true;
};
async function getStateDoc(key) {
  const r = await readJson("states/" + key + ".json");
  if (!r) {
    stateShas.delete(key);
    return null;
  }
  stateShas.set(key, r.sha);
  return r.data;
}
async function uploadState(opts = {}) {
  if (cast.console) return false;   // modo console: o estado de agora está na outra tela
  const emu = player.emu;
  if (!emu || !emu.started || !emu.gameManager || !player.key || player.stateBusy) return false;
  const gm = emu.gameManager;
  const frames = Number(gm.getFrameNum());
  if (!opts.force && player.stateFrames && frames - player.stateFrames < 600) return false;   // under ~10 s of play since the last one
  let st;
  try { st = await gm.getState(); } catch (e) { return false; }   // o DS responde de forma assíncrona (worker)
  player.stateBusy = true;
  try {
    let sav = null;
    try { sav = new Uint8Array(gm.getSaveFile()); } catch (e) {}
    const packed = await pack(st);
    const doc = { game: player.key, enc: packed.enc, data: packed.data, size: st.length, at: Date.now(), device: device.name, saveSha: sav && !isBlankSave(sav) ? await sha(sav) : null };
    await idb.put("pend", "state:" + player.key, doc).catch(() => {});
    player.stateFrames = frames;
    if (!cloud.db) return true;
    const body = b64(utf8.enc(JSON.stringify(doc)));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        stateShas.set(player.key, await putFile("states/" + player.key + ".json", body, stateShas.get(player.key), `Progresso: ${player.meta.title} (${device.name})`, opts.keepalive));
        return true;
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        const r = await readJson("states/" + player.key + ".json").catch(() => null);
        if (r) stateShas.set(player.key, r.sha);
        else stateShas.delete(player.key);
      }
    }
    return false;
  } catch (e) { return false; } finally { player.stateBusy = false; }
}
async function findResumeState(key, start) {
  let best = await idb.get("pend", "state:" + key);
  if (cloud.db) {
    try {
      const remote = await getStateDoc(key);
      if (remote && (!best || remote.at > best.at)) best = remote;
    } catch (e) {}
  }
  if (!best || !best.data) return null;
  const startSha = start.sav && !isBlankSave(start.sav) ? start.sha : null;
  if ((best.saveSha || null) !== startSha) return null;   // taken with a different in-game save
  return best;
}

async function chooseStartSave(key) {
  const pend = await idb.get("pend", key);
  let remote = null;
  if (cloud.db) {
    try { remote = await getSaveDoc(key); } catch (e) { remote = cloud.docs.get(key) || null; }
  }
  if (remote && pend && pend.sha !== remote.sha && pend.baseRev !== remote.rev) {
    const pick = await dialog("Dois saves diferentes",
      "Este aparelho tem progresso que não chegou à nuvem, e a nuvem tem um save mais novo de outro aparelho. Qual você quer jogar? O outro fica guardado como versão anterior.",
      [{ label: "Save da nuvem", sub: `${remote.device || "Outro aparelho"}, ${ago(remote.at)}`, value: "cloud", cls: "primary" },
       { label: "Save deste aparelho", sub: `${device.name}, ${ago(pend.at)}`, value: "local" }]);
    if (pick === "local") return { sav: pend.sav, sha: pend.sha, baseRev: remote.rev, upload: true, keepRemoteAsPrev: true };
    await idb.del("pend", key);
    return { sav: await unpack(remote), sha: remote.sha, baseRev: remote.rev, at: remote.at };
  }
  if (pend && (!remote || pend.baseRev === remote.rev || pend.sha === remote.sha)) {
    return { sav: pend.sav, sha: pend.sha, baseRev: remote ? remote.rev : null, upload: pend.sha !== (remote && remote.sha), at: remote && remote.at };
  }
  if (remote) return { sav: await unpack(remote), sha: remote.sha, baseRev: remote.rev, at: remote.at };
  return { sav: null, sha: null, baseRev: null };
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = el("script", { src });
    s.onload = res;
    s.onerror = () => rej(new Error(src));
    document.body.append(s);
  });
}
let emuLoading = null;
function loadEmulator() {
  if (!emuLoading) {
    document.head.append(el("link", { rel: "stylesheet", href: "vendor/emulator.min.css" }));
    emuLoading = loadScript("vendor/emulator.min.js").then(() => loadScript("vendor/mgba_libretro.js"));
  }
  return emuLoading;
}

/* The emulator sizes its WebGL canvas from a ResizeObserver, so on a TV it draws a
   1080p (or 4K) surface for a 240x160 picture, which weak TV GPUs struggle with.
   The observer reports a smaller size instead (see PROFILES.gameMax): the emulator
   draws a small picture and the browser stretches it, pixel-perfect. */

 // the GBA's own resolution: tiny to encode, the TV scales it up pixel-perfect
(() => {
  /** @type {any} */
  const RO = window.ResizeObserver;
  if (!RO || RO.__cartucho) return;
  const factorFor = (w, h) => {
    const max = PROFILES[perfProfile()].gameMax;
    if (!max) return 1;
    const gameW = w / h > 1.5 ? h * 1.5 : w;     // width of the 3:2 picture inside the canvas
    return gameW > max ? max / gameW : 1;
  };
  const scaleEntry = (e) => {
    if (!(e.target instanceof HTMLCanvasElement)) return e;
    const dpr = window.devicePixelRatio || 1;
    let w, h;
    if (window.__castCap) {
      // streaming: the canvas becomes exactly the GBA screen, 240x160, and is sent as is
      w = STREAM_W;
      h = STREAM_H;
    } else {
      const pw = e.devicePixelContentBoxSize ? e.devicePixelContentBoxSize[0].inlineSize : e.contentRect.width * dpr;
      const ph = e.devicePixelContentBoxSize ? e.devicePixelContentBoxSize[0].blockSize : e.contentRect.height * dpr;
      const f = factorFor(pw, ph);
      if (f === 1) return e;
      w = Math.round(pw * f);
      h = Math.round(ph * f);
    }
    return { target: e.target, contentRect: { width: w / dpr, height: h / dpr, x: 0, y: 0, top: 0, left: 0 },
      devicePixelContentBoxSize: [{ inlineSize: w, blockSize: h }], contentBoxSize: [{ inlineSize: w / dpr, blockSize: h / dpr }], borderBoxSize: e.borderBoxSize };
  };
  /** @type {any} */
  class CappedResizeObserver extends RO {
    constructor(cb) { super((entries, obs) => cb(entries.map(scaleEntry), obs)); }
  }
  CappedResizeObserver.__cartucho = true;
  window.ResizeObserver = /** @type {any} */ (CappedResizeObserver);
})();

function patchEmulator() {
  const EJS = window.EmulatorJS;
  if (!EJS || EJS.__cartucho) return;
  EJS.__cartucho = true;
  const GM = window.EJS_GameManager;
  if (GM && !GM.__cartucho) {
    GM.__cartucho = true;
    const orig = GM.prototype.getRetroArchCfg;
    GM.prototype.getRetroArchCfg = function () {
      let cfg = orig.call(this);
      cfg = cfg.replace(/audio_latency = \d+/, "audio_latency = " + (gameCfg(player.key).latency || PROFILES[perfProfile()].latency));
      cfg = cfg.replace(/autosave_interval = \d+/, "autosave_interval = 0");  // the page saves on its own schedule
      // sem mensagens do RetroArch por cima do jogo ("Fast-Forward" aparecia com o ajuste automático de velocidade)
      return cfg + "audio_rate_control = true\naudio_rate_control_delta = 0.010\nvideo_threaded = false\nvideo_font_enable = false\nnotification_show_fast_forward = false\n";
    };
  }
  EJS.prototype.initGameCore = function (js, wasm, thread) { this.initModule(wasm, thread); };
  /* load the mGBA core straight from the published files: no archive, no extraction worker */
  EJS.prototype.downloadGameCore = function () {
    const core = { name: "mgba", extensions: ["gb", "gbc", "gba"], options: {}, save: "srm", repo: "https://github.com/EmulatorJS/mgba" };
    this.textElem.innerText = this.localization("Download Game Core");
    this.extensions = core.extensions;
    this.coreName = core.name;
    this.repository = core.repo;
    this.defaultCoreOpts = core.options;
    this.enableMouseLock = false;
    this.retroarchOpts = undefined;
    this.saveFileExt = core.save;
    this.webgl2Enabled = false;
    this.downloadFile("cores/mgba_libretro.wasm", (progress) => {
      this.textElem.innerText = this.localization("Download Game Core") + progress;
    }, false, { responseType: "arraybuffer", method: "GET" }).then((res) => {
      if (res === -1 || !res.data) {
        this.startGameError(this.localization("Network Error"));
        return;
      }
      this.initModule(new Uint8Array(res.data), null);
    });
  };
  EJS.prototype.initModule = function (wasm, thread) {
    if (typeof window.EJS_Runtime !== "function") {
      this.startGameError(this.localization("Error loading EmulatorJS runtime"));
      return;
    }
    const wasmBytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
    window.EJS_Runtime({
      noInitialRun: true, onRuntimeInitialized: null, arguments: [], preRun: [], postRun: [],
      canvas: this.canvas, callbacks: {}, parent: this.elements.parent,
      print: () => {}, printErr: () => {}, totalDependencies: 0,
      wasmBinary: wasmBytes,
      locateFile: (f) => f.endsWith(".wasm") ? URL.createObjectURL(new Blob([wasmBytes], { type: "application/wasm" })) : f,
      getSavExt: () => (this.saveFileExt ? "." + this.saveFileExt : ".srm"),
    }).then((m) => {
      this.Module = m;
      this.downloadFiles();
    })
      .catch((e) => {
        console.warn(e);
        this.startGameError(this.localization("Failed to start game"));
      });
  };
}

async function createEmulator(file, gameName, options) {
  try { await loadEmulator(); } catch (e) { return null; }
  patchEmulator();
  return new window.EmulatorJS("#game", {
    gameUrl: file, dataPath: "ejs/", system: "mgba", gameName,
    color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b4bd8",
    startOnLoad: true, threads: false, forceLegacyCores: true, cacheLimit: 0,
    language: "pt-BR", langJson: window.__CARTUCHO_LANG || undefined,
    backgroundColor: "#000000", noAutoFocus: false,
    buttonOpts: { netplay: false, saveSavFiles: false, loadSavFiles: false, cacheManager: false, exitEmulation: false, contextMenu: false },
    defaultOptions: options,
  });
}

/* jogo de DS: abre em ?ds=<jogo>, que o service worker serve com isolamento
   cross-origin (o core usa threads). O login do Google fica na biblioteca. */
const dsPage = new URLSearchParams(location.search).get("ds");
// só o core com threads usa a página isolada (?ds=, COOP/COEP); os outros rodam aqui mesmo
const DS_ISOLATED_PAGE = () => ds.core === "mt";
/* given (modo console, na outra tela): { rom, sav, state } vindos do celular; nada de nuvem aqui */
async function play(key, given = null) {
  if (!given && !dsPage && DS_ISOLATED_PAGE()) {
    const r = roms.get(key) || cloud.roms.get(key) || cloud.docs.get(key);
    if (r && r.system === "nds") {
      location.href = location.pathname + "?ds=" + encodeURIComponent(key) + (cast.pending ? "#tela-" + cast.pending : "");
      return;
    }
  }
  let rom = given ? given.rom : roms.get(key);
  if (!rom) rom = await fetchRom(key);
  if (!rom) return;
  const start = given ? { sav: given.sav, sha: null, baseRev: null } : await chooseStartSave(key);
  if (start === null) return;
  const isDs = rom.system === "nds";
  // DS: retomar do save state fica desligado enquanto o load state do core não está confiável
  const resume = given || (isDs && !dsStatesOk) ? null : await findResumeState(key, start);
  player.guest = !!given;
  $("#player").classList.toggle("guest", !!given);
  player.rom = rom;
  player.key = key;
  player.meta = { title: rom.title, system: rom.system, code: rom.code };
  player.lastSha = start.upload ? null : start.sha;
  player.baseRev = start.baseRev;
  $("#pName").textContent = rom.title;
  $("#library").hidden = true;
  $("#player").hidden = false;
  setChip(start.sav ? (start.upload ? "pending" : (cloud.db ? "ok" : "local")) : "none", start.at);
  try { document.title = rom.title + " · Cartuchin"; } catch (e) {}

  let emu;
  if (isDs) {
    emu = await createDsEmulator(new Uint8Array(await rom.blob.arrayBuffer()), key, start.sav);
  } else {
    const romBytes = fixSaveChip(new Uint8Array(await rom.blob.arrayBuffer()));
    const file = new File([romBytes], rom.code ? rom.code + "." + rom.ext : "jogo." + rom.ext);
    emu = await createEmulator(file, key, coreOptions());
  }
  player.isDs = isDs;
  $("#player").classList.toggle("ds", isDs);
  if (!emu) {
    toast(isDs && dsLastError() ? "Não deu para carregar o emulador de DS: " + dsLastError() : "Não deu para carregar o emulador. Confira a internet.", isDs ? 10000 : 2600);
    $("#player").hidden = true;
    $("#library").hidden = false;
    return;
  }
  player.emu = emu;
  window.dispatchEvent(new Event("cartucho-game-start"));
  emu.on("start", async () => {
    const gm = emu.gameManager;
    if (start.sav && !isDs) {   // o DS já começa com o save
      try {
        writeSav(gm, start.sav);
        gm.loadSaveFiles();
        gm.restart();
      } catch (e) { console.warn("save load", e); }
    }
    if (given && given.state) {
      await sleep(300);
      try { await gm.loadState(given.state); } catch (e) { console.warn("console state", e); }
    }
    if (given) { window.dispatchEvent(new Event("cartucho-guest-start")); return; }
    if (resume) {
      await sleep(300);
      try {
        await gm.loadState(await unpack(resume));
        player.stateFrames = Number(gm.getFrameNum());
        const msg = `Continuando de onde parou (${resume.device || "outro aparelho"}, ${ago(resume.at)})`;
        if (!$("#pad").hidden) padMsg(msg);
        else actionToast(msg, "Ir para a tela de título", () => { try { gm.restart(); } catch (e) {} });
        // DS: se o snapshot carregou mas a tela ficou preta, ele não serve; começa do save
        if (isDs && emu.isBlank) {
          await sleep(4000);
          if (emu.isBlank()) throw new Error("tela preta depois do snapshot");
        }
      } catch (e) {
        console.warn("state load", e);
        if (isDs) {
          try { await gm.restart(); } catch (x) {}
          toast("Não deu para continuar de onde parou: o jogo abriu pelo save.", 4000);
        }
      }
    }

    await sleep(1500);
    if (start.upload) flush();
    player.timer = setInterval(flush, 30000);
    if (!cast.pc) showPad(false);
    startSpeedMeter();
    startSpeedGovernor();
    window.dispatchEvent(new Event("cartucho-game-running"));
    if (cast.pending) {
      const c = cast.pending;
      cast.pending = null;
      setTimeout(() => connectScreen(c), 500);
    }
  });
}

async function pullSave(report) {
  if (!player.key || !player.emu || !player.emu.started) return;
  if (cast.console) { report("O jogo está rodando na outra tela. Saia da segunda tela para carregar um save."); return; }
  if (!cloud.db) {
    report(isGoogle() ? "Reconecte ao Google primeiro (botão no topo da biblioteca)." : "Este aparelho não está conectado à nuvem.");
    return;
  }
  report("Buscando o save na nuvem…");
  let remote;
  try { remote = await getSaveDoc(player.key); } catch (e) {
    report(`Não deu para falar com o ${cloudName()} agora.`);
    return;
  }
  if (!remote) {
    report("Ainda não há save deste jogo na nuvem.");
    return;
  }
  const gm = player.emu.gameManager;
  let cur = null;
  try { cur = new Uint8Array(gm.getSaveFile()); } catch (e) {}
  if (cur && (await sha(cur)) === remote.sha) {
    report("Você já está com o save mais recente da nuvem.");
    return;
  }
  const unsent = cur && player.lastSha && (await sha(cur)) !== player.lastSha;
  const ok = await dialog("Carregar o save da nuvem?",
    `Save de ${remote.device || "outro aparelho"}, ${ago(remote.at)}. O jogo reinicia na tela de título.` + (unsent ? " Este aparelho tem progresso que ainda não subiu: ele vai ser substituído." : ""),
    [{ label: "Carregar e reiniciar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) {
    report("");
    return;
  }
  try {
    writeSav(gm, await unpack(remote));
    gm.loadSaveFiles();
    gm.restart();
    player.lastSha = remote.sha;
    player.baseRev = remote.rev;
    await idb.del("pend", player.key);
    setChip("ok", remote.at);
    report(`Save de ${remote.device || "outro aparelho"} carregado`);
  } catch (e) { report("Não deu para carregar o save."); }
}
$("#pullBtn").addEventListener("click", () => pullSave((m) => m && toast(m)));
$("#padPull").addEventListener("click", () => pullSave((m) => m && padMsg(m)));

function tokenFromTap() {
  // na página isolada do DS o popup do Google não consegue responder: o save fica
  // guardado aqui e sobe quando houver token (na biblioteca ele é renovado)
  // sessão longa (servidor): renova sem popup, até na página isolada do DS
  if (hasServerSession() && !tokenFresh()) return serverToken().then(() => { googleNeedsTap(false); cloud.db = true; }, () => {});
  if (window.crossOriginIsolated) return Promise.resolve();
  if (isGoogle() && !tokenFresh() && gauth.client) return askGoogleToken(false).then(() => {
    googleNeedsTap(false);
    cloud.db = true;
  }, () => {});
  return Promise.resolve();
}
$("#saveNowBtn").addEventListener("click", async () => {
  await tokenFromTap();
  if (player.remote) await player.remote.gameManager.fetchSave();   // jogo na outra tela: pega o save de lá primeiro
  await flush();
  const ok = await uploadState({ force: true });
  if (ok && cloud.db) toast("Progresso salvo: o jogo continua daqui em qualquer aparelho", 3500);
  else if (ok) toast("Progresso salvo neste aparelho", 3000);
  else if (player.state === "none") toast("Ainda não há save. Salve dentro do jogo primeiro.");
});
$("#backBtn").addEventListener("click", async () => {
  await flush();
  if (player.state === "up" || player.state === "pending") {
    const ok = await dialog("O save ainda não subiu", "Ele ficou guardado neste aparelho e vai subir na próxima vez que você abrir o jogo aqui.",
      [{ label: "Voltar mesmo assim", value: true, cls: "primary" }, { label: "Continuar jogando", value: false }]);
    if (!ok) return;
  }
  // estado automático antes de sair (até 4 s)
  const exit = new CustomEvent("cartucho-game-exit", { detail: { waits: [] } });
  window.dispatchEvent(exit);
  if (exit.detail.waits.length) await Promise.race([Promise.all(exit.detail.waits), new Promise((r) => setTimeout(r, 4000))]);
  player.leaving = true;   // saída pedida: não perguntar no beforeunload
  if (dsPage) location.href = location.pathname;   // sai da página isolada do DS
  else location.reload();
});
// F5 / puxar para atualizar com jogo aberto: o navegador pede confirmação
window.addEventListener("beforeunload", (e) => {
  if (!player.emu || player.leaving) return;
  e.preventDefault();
  e.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush({ leaving: true });
});
window.addEventListener("pagehide", () => { flush({ leaving: true }); });

/* keep EmulatorJS from calling its own CDN for update checks */
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const u = typeof input === "string" ? input : (input && /** @type {any} */ (input).url) || "";
  if (/^https?:\/\/(cdn|netplay)\.emulatorjs\.org/.test(u)) return Promise.resolve(new Response("{}", { status: 404 }));
  return realFetch(input, init);
};

export { player, writeSav, freshSave, flush, uploadState, createEmulator, play, tokenFromTap, dsPage };
