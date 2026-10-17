import { iceDone, keepAwake, signal } from "./common.js";
import { RTC_CONFIG } from "./constants.js";
import { applyRemote, cast, castTo, setCastUi, stopCast } from "./phone.js";
import { showPad } from "./pad.js";
import { tvScreen } from "./tv.js";
import { sha } from "../bytes.js";
import { device } from "../device.js";
import { idb } from "../idb.js";
import { roms } from "../library.js";
import { flush, play, player, writeSav } from "../player/player.js";
import { $, rid, sleep, toast } from "../util.js";

/* ---------- modo console ----------
   O jogo roda NA OUTRA TELA (notebook, TV, tablet) e o celular vira só o controle:
   pelo canal só passam botões e toques (bytes), sem vídeo para codificar. O celular manda
   a ROM (a outra tela guarda para a próxima vez), o save e o estado de agora; a outra tela
   devolve o save sempre que ele muda, a tela de baixo do DS (para tocar) e, no fim, o
   estado, para o jogo continuar no celular do ponto exato.
   Canais: "controle" (sem reenvio) botões/toque · "arquivo" (confiável) mensagens e
   arquivos · "tela" (sem reenvio) tela de baixo do DS, outra tela → celular. */

const CHUNK = 64 * 1024;

async function sendFile(dc, name, data, onProgress) {
  const size = data.size != null ? data.size : data.length;
  dc.bufferedAmountLowThreshold = 1 << 20;
  dc.send(JSON.stringify({ file: name, size }));
  const STEP = 4 << 20;   // lê a ROM em pedaços de 4 MB, não inteira na memória
  for (let o = 0; o < size; o += STEP) {
    const piece = data.size != null ? new Uint8Array(await data.slice(o, o + STEP).arrayBuffer()) : data.subarray(o, o + STEP);
    for (let i = 0; i < piece.length; i += CHUNK) {
      if (dc.readyState !== "open") throw new Error("canal fechado");
      if (dc.bufferedAmount > 8 << 20) await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
      dc.send(piece.subarray(i, i + CHUNK));
    }
    if (onProgress) onProgress(Math.min(1, (o + STEP) / size));
  }
}
/* a ROM vai comprimida (gzip) enquanto é lida: DS tem muito espaço vazio e tabela repetida
   (Pokémon Black: 202 MB viram ~110 MB), e comprimir anda junto com o envio */
async function sendGz(dc, name, blob, onProgress) {
  dc.bufferedAmountLowThreshold = 1 << 20;
  dc.send(JSON.stringify({ file: name, size: -1, gz: true }));
  let read = 0;
  const counted = blob.stream().pipeThrough(new TransformStream({ transform(ch, ctl) { read += ch.length; ctl.enqueue(ch); } }));
  const reader = counted.pipeThrough(new CompressionStream("gzip")).getReader();
  let shown = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i += CHUNK) {
      if (dc.readyState !== "open") throw new Error("canal fechado");
      if (dc.bufferedAmount > 8 << 20) await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
      dc.send(value.subarray(i, i + CHUNK));
    }
    if (onProgress && read - shown > (2 << 20)) { shown = read; onProgress(read / blob.size); }
  }
  dc.send(JSON.stringify({ fileEnd: 1 }));
}
/* mensagens JSON e arquivos (cabeçalho JSON + pedaços binários), na ordem em que chegam */
function receiver(onJson, onFile, onProgress) {
  let cur = null, chain = Promise.resolve();
  const handle = async (data) => {
    if (typeof data === "string") {
      const j = JSON.parse(data);
      if (j.fileEnd && cur) {   // fim de um arquivo comprimido (tamanho só se sabe no fim)
        const c = cur;
        cur = null;
        await c.writer.close();
        await onFile(c.name, await c.out);   // Blob (pode ficar fora da memória do JS)
        return;
      }
      if (j.file) {
        cur = { name: j.file, size: j.size, gz: !!j.gz, parts: [], got: 0, shown: 0 };
        if (cur.gz) {
          // descomprime enquanto chega: nunca junta a ROM comprimida inteira na memória
          const dz = new DecompressionStream("gzip");
          cur.writer = dz.writable.getWriter();
          cur.out = new Response(dz.readable).blob();
        }
        if (!j.size) { cur = null; await onFile(j.file, new Uint8Array(0)); }
      } else await onJson(j);
      return;
    }
    if (!cur) return;
    cur.got += data.byteLength;
    if (cur.gz) await cur.writer.write(new Uint8Array(data));
    else cur.parts.push(data);
    if (onProgress && !cur.gz && cur.got - cur.shown > (2 << 20)) { cur.shown = cur.got; onProgress(cur.name, cur.got / cur.size); }
    if (onProgress && cur.gz && cur.got - cur.shown > (2 << 20)) { cur.shown = cur.got; onProgress(cur.name, -cur.got); }
    if (!cur.gz && cur.got >= cur.size) {
      const c = cur;
      cur = null;
      await onFile(c.name, new Uint8Array(await new Blob(c.parts).arrayBuffer()));
    }
  };
  return (e) => { const d = e.data; chain = chain.then(() => handle(d)).catch((x) => console.warn("[console]", x)); };
}
/* o canal de controle não reenvia: cada mudança vai 3 vezes e o estado atual 10x por segundo */
function repeater(dc) {
  let last = null;
  const send = () => { if (last != null && dc.readyState === "open") { try { dc.send(last); } catch (e) {} } };
  const beat = setInterval(send, 100);
  const fn = (v) => { if (v === last) return; last = v; send(); setTimeout(send, 15); setTimeout(send, 40); };
  fn.stop = () => clearInterval(beat);
  return fn;
}
const waitOpen = (dc, ms) => new Promise((ok, no) => {
  if (dc.readyState === "open") return ok();
  dc.addEventListener("open", () => ok(), { once: true });
  setTimeout(() => no(new Error("canal não abriu")), ms);
});

/* ================= celular ================= */
/* aviso fixo de cada etapa (o botão "Conectando…" some com o celular deitado) */
let statusEl = null;
function say(text) {
  if (!text) { if (statusEl) statusEl.remove(); statusEl = null; return; }
  if (!statusEl) { statusEl = document.createElement("div"); statusEl.className = "toast cast-status"; statusEl.setAttribute("role", "status"); document.body.append(statusEl); }
  statusEl.textContent = text;
}
/** liga numa segunda tela: tenta o modo console; se a outra tela não souber, vai de vídeo */
async function connectScreen(code) {
  const emu = player.emu;
  if (!emu || !emu.started) { cast.pending = code; return; }
  // "cartucho.castVideo" = 1: sempre o modo antigo (vídeo do celular), p.ex. TV fraca demais para emular
  let video = false;
  try { video = localStorage.getItem("cartucho.castVideo") === "1"; } catch (e) {}
  const r = video ? "video" : await consoleTo(code);
  if (r === "video") castTo(code);
}
async function consoleTo(code) {
  const emu = player.emu, gm = emu.gameManager, rom = player.rom;
  if (!rom || !rom.blob) return "video";
  stopCast();
  setCastUi("wait");
  say("Conectando com a segunda tela…");
  const btn = { set textContent(t) { say(t); } };
  const wasPaused = emu.paused;
  try { emu.pause(); } catch (e) {}
  const resumeHere = () => { if (!wasPaused) { try { emu.play(); } catch (e) {} } };
  let state, sav;
  try {
    state = new Uint8Array(await gm.getState());
    sav = new Uint8Array(gm.getSaveFile() || []);
  } catch (e) { resumeHere(); setCastUi("off"); return "video"; }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const ctl = pc.createDataChannel("controle", { ordered: false, maxRetransmits: 0 });
  const files = pc.createDataChannel("arquivo");
  const scr = pc.createDataChannel("tela", { ordered: false, maxRetransmits: 0 });
  files.binaryType = scr.binaryType = "arraybuffer";
  cast.pc = pc;
  cast.dc = ctl;
  cast.code = code;
  const c = cast.console = { pc, ctl, files, scr, ending: false, onEnd: null, started: null, need: null };
  const fail = (msg, video) => {
    say(null);
    if (cast.console === c) cast.console = null;
    stopCast(video ? undefined : msg);
    resumeHere();
    return video ? "video" : "erro";
  };
  try {
    const sig = await signal(code);
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    const id = rid();
    const answer = await new Promise((resolve) => {
      const stop = sig.listen("resposta", (m) => { if (m.re === id && m.sdp) { stop(); resolve(m); } });
      setTimeout(() => { stop(); resolve(null); }, 20000);
      sig.send("oferta", { id, sdp: pc.localDescription.toJSON(), from: device.name, console: { key: player.key, title: rom.title } });
    });
    if (answer) say("Conectado. Preparando o jogo…");
    if (!answer) return fail("A segunda tela não respondeu. Confira o código e se ela está na tela de espera.");
    if (!answer.console) return fail(null, true);   // tela de versão antiga: só vídeo
    await pc.setRemoteDescription(answer.sdp);
    await waitOpen(files, 15000);
  } catch (e) { return fail("Não deu para conectar com a segunda tela. Os dois aparelhos estão na mesma rede Wi-Fi?"); }

  // o que a outra tela manda
  const got = new Promise((resolve) => { c.need = resolve; });
  const started = new Promise((resolve) => { c.started = resolve; });
  files.onmessage = receiver(async (j) => {
    if ("need" in j && c.need) c.need(j.need);
    if (j.started && c.started) c.started(true);
    // a outra tela não aguenta emular em velocidade cheia: volta e transmite a imagem daqui
    if (j.slow && cast.console === c && !c.ending) {
      say(`A outra tela está lenta para rodar o jogo (${j.slow}%). Trocando: o jogo roda aqui e a imagem vai para lá…`);
      // a outra tela recarrega e volta a esperar com o mesmo código: dá um tempo para ela
      endConsole(true).then(() => sleep(6000)).then(() => { say(null); castTo(code); });
    }
    if (j.failed && c.started) c.started(false);
  }, async (name, u8) => {
    if (name === "sav" && u8.length) { player.remoteSav = u8; flush({ quiet: true }); }
    if (name === "state" && c.onEnd) c.onEnd(u8);
  });
  scr.onmessage = async (e) => {
    const v = player.emu && player.emu.view;
    if (!v || cast.console !== c) return;
    try {
      const bmp = await createImageBitmap(new Blob([e.data], { type: "image/webp" }));
      v.getContext("2d").drawImage(bmp, 0, 0, v.width, v.height);
      bmp.close();
      cast.consolePics = (cast.consolePics || 0) + 1;
    } catch (x) {}
  };
  pc.onconnectionstatechange = () => {
    if (cast.console === c && !c.ending && ["failed", "disconnected", "closed"].includes(pc.connectionState)) backToPhone(c, null, "A segunda tela desconectou. O jogo voltou para o celular pelo último save.");
  };

  try {
    const meta = { title: rom.title, system: rom.system, code: rom.code || "", ext: rom.ext || "" };
    files.send(JSON.stringify({ hello: { key: player.key, romId: player.key + ":" + rom.blob.size, rom: meta } }));
    const need = await Promise.race([got, sleep(10000).then(() => { throw new Error("sem resposta"); })]);
    if (need) {
      const prog = (f) => { btn.textContent = `Mandando o jogo para a outra tela: ${Math.round(f * 100)}% (só na primeira vez)`; };
      if (window.CompressionStream) await sendGz(files, "rom", rom.blob, prog);
      else await sendFile(files, "rom", rom.blob, prog);
    }
    btn.textContent = "Abrindo o jogo na outra tela…";
    await sendFile(files, "sav", sav);
    await sendFile(files, "state", state);
    files.send(JSON.stringify({ go: 1 }));
    const ok = await Promise.race([started, sleep(120000).then(() => false)]);
    if (!ok) return fail("A segunda tela não conseguiu abrir o jogo. Ele continua aqui.");
  } catch (e) { return fail("A transferência para a segunda tela parou no meio. O jogo continua aqui."); }

  say(null);
  // daqui em diante este celular é o controle
  const keys = repeater(ctl), touch = repeater(ctl);
  c.stop = () => { keys.stop(); touch.stop(); };
  cast.consoleSend = (mask) => keys(String(mask));
  if (emu.isDs) emu.onTouch = () => touch(JSON.stringify({ t: [emu.touch ? 1 : 0, emu.tx, emu.ty] }));
  window.__castCap = 1;
  window.dispatchEvent(new Event("resize"));
  if (emu.relayout) emu.relayout();   // DS: este celular passa a mostrar só a tela de baixo
  setCastUi("on");
  showPad(true);
  keepAwake();
  toast("O jogo está rodando na outra tela. Este celular é o controle.", 3500);
  return "ok";
}
/** termina: pede o estado à outra tela e continua aqui do mesmo ponto */
async function endConsole(quiet = false) {
  const c = cast.console;
  if (!c) return false;
  c.ending = true;
  const state = await new Promise((resolve) => {
    c.onEnd = resolve;
    try { c.files.send(JSON.stringify({ end: 1 })); } catch (e) { resolve(null); }
    setTimeout(() => resolve(null), 12000);
  });
  await backToPhone(c, state, quiet ? null : state ? "O jogo voltou para o celular." : "A outra tela não respondeu. O jogo voltou pelo último save.");
  return true;
}
async function backToPhone(c, state, msg) {
  if (cast.console !== c) return;
  cast.console = null;
  cast.consoleSend = null;
  if (c.stop) c.stop();
  const emu = player.emu, gm = emu.gameManager;
  emu.onTouch = null;
  emu.touch = false;
  stopCast();
  if (emu.relayout) emu.relayout();
  const rs = player.remoteSav;
  try {
    // o save mais novo é o da outra tela: reabre o jogo com ele e então volta ao estado de lá
    if (rs) {
      writeSav(gm, rs);
      try { gm.loadSaveFiles(); } catch (e) {}
      gm.restart();
      await sleep(500);
    }
    if (state) await gm.loadState(state);
  } catch (e) { console.warn("[console] voltar", e); }
  try { emu.play(); } catch (e) {}
  if (rs) { await flush({ quiet: true }); player.remoteSav = null; }
  if (msg) toast(msg, 4000);
}

/* ================= outra tela ================= */
async function tvConsole(msg, sig) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  tvScreen.pc = pc;
  const status = (t) => { $("#scrStatus").textContent = t; };
  status(`Conectando com ${msg.from || "o celular"}…`);
  const ch = {};
  let info = null, rom = null, sav = null, state = null, live = false;
  const reply = (j) => { try { ch.arquivo.send(JSON.stringify(j)); } catch (e) {} };
  const onFiles = receiver(async (j) => {
    if (j.hello) {
      info = j.hello;
      // já tem: na biblioteca deste aparelho (mesmo jogo, mesmo tamanho) ou da última vez
      let fresh = false;   // teste automático: força mandar a ROM
      try { fresh = localStorage.getItem("cartucho.tvNoCache") === "1"; } catch (e) {}
      const mine = fresh ? null : roms.get(info.key);
      if (mine && mine.blob && info.romId === info.key + ":" + mine.blob.size) rom = mine.blob;
      const cached = rom || fresh ? null : await idb.get("pend", "tvrom");
      if (cached && cached.id === info.romId) rom = cached.blob;
      reply({ need: !rom });
      status(rom ? `Abrindo ${info.rom.title}…` : `Recebendo ${info.rom.title}…`);
    } else if (j.go) start();
    else if (j.end) finish();
  }, async (name, u8) => {
    if (name === "rom") {
      rom = u8 instanceof Blob ? u8 : new Blob([u8]);
      await idb.put("pend", "tvrom", { id: info.romId, blob: rom }).catch(() => {});   // próxima vez abre na hora
    } else if (name === "sav") sav = u8;
    else if (name === "state") state = u8;
  }, (name, f) => { if (name === "rom") status(`Recebendo ${info ? info.rom.title : "o jogo"}… ${f < 0 ? Math.round(-f / 1e6) + " MB" : Math.round(f * 100) + "%"}`); });
  const onCtl = (e) => {
    const emu = player.emu, d = String(e.data);
    if (!emu || !live) return;
    if (d[0] === "{") {
      try { const t = JSON.parse(d).t; if (t) { emu.touch = !!t[0]; emu.tx = t[1]; emu.ty = t[2]; } } catch (x) {}
    } else applyRemote(Number(d) >>> 0);
  };
  pc.ondatachannel = (e) => {
    const dc = e.channel;
    dc.binaryType = "arraybuffer";
    ch[dc.label] = dc;
    if (dc.label === "arquivo") dc.onmessage = onFiles;
    if (dc.label === "controle") dc.onmessage = onCtl;
  };
  pc.onconnectionstatechange = () => {
    if (pc !== tvScreen.pc) return;
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      if (live) { try { player.emu.pause(); } catch (x) {} again("O celular desconectou."); }
      else status("O celular desconectou. Esperando de novo…");
    }
  };
  let savTimer = null, picTimer = null;
  async function start() {
    status(`Abrindo ${info.rom.title}…`);
    $("#screen").hidden = true;
    let ready = false;
    window.addEventListener("cartucho-guest-start", () => { ready = true; }, { once: true });
    await play(info.key, { rom: { ...info.rom, blob: rom }, sav: sav && sav.length ? sav : null, state });
    for (let i = 0; i < 1200 && !ready && player.emu; i++) await sleep(100);
    if (!ready || !player.emu) { reply({ failed: 1 }); again("Não deu para abrir o jogo aqui."); return; }
    live = true;
    reply({ started: 1 });
    keepAwake();
    const emu = player.emu, gm = emu.gameManager;
    // mede a velocidade de verdade (depois de assentar): abaixo de ~90% o som picota e o jogo
    // fica lento; aí é melhor o celular rodar e mandar a imagem (modo pixels)
    let noSlow = false;   // teste automático: a máquina de teste é lenta de propósito
    try { noSlow = localStorage.getItem("cartucho.tvNoSlow") === "1"; } catch (e) {}
    let force = false;
    try { force = localStorage.getItem("cartucho.tvForceSlow") === "1"; } catch (e) {}
    if (force) setTimeout(() => reply({ slow: 40 }), 1000);
    else if (!noSlow) setTimeout(async () => {
      if (!live) return;
      const f0 = emu.frames, t0 = performance.now();
      await sleep(4000);
      if (!live || emu.paused || emu.frames == null) return;
      const pct = Math.round((emu.frames - f0) / ((performance.now() - t0) / 1000) / 59.83 * 100);
      if (pct < 88) reply({ slow: pct });
    }, 3000);
    // save novo (o jogo salvou): vai para o celular, que manda para a nuvem
    let lastSav = sav && sav.length ? await sha(sav) : null;
    savTimer = setInterval(async () => {
      try {
        const s = new Uint8Array(gm.getSaveFile() || []);
        if (!s.length) return;
        const h = await sha(s);
        if (h !== lastSav) { lastSav = h; await sendFile(ch.arquivo, "sav", s); }
      } catch (e) {}
    }, 5000);
    // DS: a tela de baixo vai para o celular, que é onde se toca
    if (emu.isDs && emu.drawBottom && ch.tela) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 192;
      const g = c.getContext("2d", { alpha: false });
      let busy = false;
      picTimer = setInterval(() => {
        if (busy || ch.tela.readyState !== "open" || ch.tela.bufferedAmount > 65536) return;
        busy = true;
        try { emu.drawBottom(g, 256, 192); } catch (e) {}
        c.toBlob(async (b) => {
          try { if (b && ch.tela.readyState === "open") ch.tela.send(await b.arrayBuffer()); } catch (e) {}
          busy = false;
        }, "image/webp", 0.7);
      }, 50);
    }
  }
  async function finish() {
    live = false;
    clearInterval(savTimer);
    clearInterval(picTimer);
    const gm = player.emu && player.emu.gameManager;
    try {
      player.emu.pause();
      await sendFile(ch.arquivo, "sav", new Uint8Array(gm.getSaveFile() || []));
      await sendFile(ch.arquivo, "state", new Uint8Array(await gm.getState()));
    } catch (e) {}
    await sleep(1500);
    again("O jogo voltou para o celular.");
  }
  try {
    await pc.setRemoteDescription(msg.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await iceDone(pc);
    await sig.send("resposta", { re: msg.id, sdp: pc.localDescription.toJSON(), console: true });
  } catch (e) { status("Não deu para conectar. Tente de novo no celular."); }
}
/* volta para a tela de espera, com o mesmo código (a página recarrega para soltar o emulador) */
function again(text) {
  clearInterval(tvScreen.padTimer);
  try { sessionStorage.setItem("cartucho.tvAuto", text || "1"); } catch (e) {}
  player.leaving = true;
  setTimeout(() => location.reload(), 300);
}

export { connectScreen, endConsole, tvConsole };
