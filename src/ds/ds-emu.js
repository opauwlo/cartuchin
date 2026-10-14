import { $, el, ls, toast } from "../util.js";

/* ---------------- Nintendo DS ----------------
   O DS roda no DeSmuME-wasm melhorado (ds/nds.js + ds/nds.wasm, compilados pelo
   workflow ds-core.yml a partir de ds/core). Este módulo cria um objeto com a mesma
   cara do EmulatorJS que o resto do app usa (started, paused, canvas, gameManager…),
   então o player, o save na nuvem, o controle do Cartuchin e a transmissão para a TV
   funcionam sem saber que é outro emulador.

   Áudio: o core gera 48 kHz de tempo emulado; um AudioWorklet com ring buffer absorve
   a diferença de relógio variando a leitura em até ±0,5% (sem estalo). O loop roda os
   frames pelo relógio e pelo nível do buffer, com frameskip automático. */

const FPS = 59.8261;
const FRAME_MS = 1000 / FPS;
const W = 256, H = 192;

/* RetroPad (o que o controle do Cartuchin manda) → bits do DS no runFrame
   RetroPad: B0 Y1 SELECT2 START3 UP4 DOWN5 LEFT6 RIGHT7 A8 X9 L10 R11
   DS:       dir0 esq1 baixo2 cima3 select4 start5 B6 A7 Y8 X9 L10 R11 (14 = microfone) */
const RETRO_TO_DS = { 0: 6, 1: 8, 2: 4, 3: 5, 4: 3, 5: 2, 6: 1, 7: 0, 8: 7, 9: 9, 10: 10, 11: 11 };
const KEYMAP = { ArrowRight: 0, ArrowLeft: 1, ArrowDown: 2, ArrowUp: 3, ShiftRight: 4, ShiftLeft: 4, Enter: 5,
  KeyZ: 6, KeyX: 7, KeyA: 8, KeyS: 9, KeyQ: 10, KeyW: 11, KeyM: 14 };
const PADMAP = [[0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [8, 4], [9, 5], [12, 3], [13, 2], [14, 1], [15, 0]];

/* níveis do ajuste automático: do mais bonito ao mais leve */
const LEVELS = [
  { latency: 3200, interp: 1, video30: false, skip: 3, name: "qualidade" },
  { latency: 4800, interp: 0, video30: false, skip: 3, name: "leve" },
  { latency: 4800, interp: 0, video30: true, skip: 3, name: "vídeo a 30 fps" },
  { latency: 6400, interp: 0, video30: true, skip: 5, name: "máximo desempenho" },
];
const PERF_MODES = ["auto", "60", "30"];
const PERF_LABEL = { auto: "Automático", 60: "60 fps", 30: "Vídeo a 30 fps" };

/* telas: "both" (uma em cima da outra), "side" (lado a lado), "top", "bottom" */
const LAYOUT_LABEL = { auto: "Automático", both: "As duas", side: "Lado a lado", top: "Só a de cima", bottom: "Só a de baixo" };
const LOCAL_LAYOUTS = ["auto", "both", "top", "bottom"];
const CAST_LAYOUTS = ["top", "both", "side"];
const ds = {
  local: ls.get("cartucho.ds.local") || "auto",
  cast: ls.get("cartucho.ds.cast") || "top",
  perf: ls.get("cartucho.ds.perf") || "auto",
  level: Math.min(LEVELS.length - 1, Number(ls.get("cartucho.ds.level") || 1)),
};

const WORKLET_SRC = `
class DSOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 1 << 15; this.mask = this.cap - 1;
    this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap);
    this.w = 0; this.rp = 0; this.target = 4800; this.playing = false;
    this.lastL = 0; this.lastR = 0; this.underruns = 0; this.reportIn = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === "s") this.push(m.d);
      else if (m.t === "target") this.target = m.v;
      else if (m.t === "reset") { this.rp = this.w; this.playing = false; }
    };
  }
  push(d) {
    const n = d.length >> 1;
    for (let i = 0; i < n; i++) { const j = (this.w + i) & this.mask; this.L[j] = d[i * 2]; this.R[j] = d[i * 2 + 1]; }
    this.w += n;
    if (this.w - this.rp > this.target * 4) this.rp = this.w - this.target;
  }
  process(_, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], len = oL.length;
    const fill = this.w - this.rp;
    if (!this.playing && fill >= this.target) this.playing = true;
    if (this.playing) {
      let dev = (fill - this.target) / this.target;
      if (dev > 1) dev = 1; else if (dev < -1) dev = -1;
      const ratio = 1 + dev * 0.005;
      for (let i = 0; i < len; i++) {
        if (this.w - this.rp < 2) {
          this.lastL *= 0.995; this.lastR *= 0.995;
          oL[i] = this.lastL; if (oR !== oL) oR[i] = this.lastR;
          if (this.playing) { this.playing = false; this.underruns++; }
          continue;
        }
        const i0 = Math.floor(this.rp), f = this.rp - i0, a = i0 & this.mask, b = (i0 + 1) & this.mask;
        const l = this.L[a] + (this.L[b] - this.L[a]) * f, r = this.R[a] + (this.R[b] - this.R[a]) * f;
        oL[i] = l; if (oR !== oL) oR[i] = r;
        this.lastL = l; this.lastR = r;
        this.rp += ratio;
      }
    } else {
      for (let i = 0; i < len; i++) { this.lastL *= 0.995; this.lastR *= 0.995; oL[i] = this.lastL; if (oR !== oL) oR[i] = this.lastR; }
    }
    if (++this.reportIn >= 8) { this.reportIn = 0; this.port.postMessage({ fill: this.w - this.rp, underruns: this.underruns }); }
    return true;
  }
}
registerProcessor("ds-out", DSOut);
`;

/* ---------- core (um só por página) ---------- */
let corePromise = null;
function loadCore() {
  if (corePromise) return corePromise;
  const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
    2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  const name = simd ? "nds" : "nds-nosimd";
  corePromise = new Promise((resolve, reject) => {
    /** @type {any} */ const w = window;
    w.wasmReady = () => resolve(w.Module);
    w.Module = {
      locateFile: (p) => "ds/" + p.replace(/^nds(-nosimd)?\.wasm$/, name + ".wasm"),
      print: () => {}, printErr: (t) => console.warn("[ds]", t),
      onAbort: (r) => reject(new Error("core: " + r)),
    };
    const s = el("script", { src: "ds/" + name + ".js" });
    s.onerror = () => reject(new Error("ds/" + name + ".js"));
    document.body.append(s);
  });
  corePromise.catch(() => { corePromise = null; });
  return corePromise;
}

/* ---------- áudio ---------- */
const audio = {
  ctx: null, node: null, gain: null, ready: false, fill: 0, fillAt: 0, pushed: 0, underruns: 0, target: 4800,
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ sampleRate: 48000, latencyHint: "interactive" }); } catch (e) { this.ctx = new AC({ latencyHint: "interactive" }); }
    if (!this.ctx.audioWorklet) return;
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    this.node = new AudioWorkletNode(this.ctx, "ds-out", { outputChannelCount: [2] });
    this.node.port.onmessage = (e) => { this.fill = e.data.fill; this.fillAt = performance.now(); this.pushed = 0; this.underruns = e.data.underruns; };
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);   // passa pelo "tap" do cast/common.js: o som também vai para a TV
    this.setTarget(this.target);
    this.ready = true;
  },
  rate() { return this.ctx ? Math.min(48000, this.ctx.sampleRate) : 48000; },
  setTarget(v) { this.target = v; if (this.node) this.node.port.postMessage({ t: "target", v }); },
  reset() { if (this.node) this.node.port.postMessage({ t: "reset" }); this.fill = 0; this.pushed = 0; },
  level() {
    if (!this.ready) return this.target;
    return this.fill + this.pushed - (performance.now() - this.fillAt) * this.rate() / 1000;
  },
  push(f32) {
    if (!this.node) return;
    this.pushed += f32.length >> 1;
    this.node.port.postMessage({ t: "s", d: f32 }, [f32.buffer]);
  },
  resume() { if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {}); },
};
for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, () => audio.resume(), true);

/* ---------- o emulador com cara de EmulatorJS ---------- */
/* motivo da última falha, para a mensagem na tela */
let lastError = "";
const dsLastError = () => lastError;
/* Etapas do carregamento escritas na tela: se travar, dá para ver onde (e o erro). */
let stageEl = null;
function stage(msg, isError) {
  const box = $("#game");
  if (!stageEl || !box.contains(stageEl)) {
    stageEl = el("div", { class: "ds-stage", role: "status" });
    box.append(stageEl);
  }
  stageEl.textContent = msg;
  stageEl.classList.toggle("err", !!isError);
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ": demorou mais de " + Math.round(ms / 1000) + " s")), ms))]);
function onPageError(e) {
  const msg = (e && (e.message || (e.reason && (e.reason.message || String(e.reason))))) || "erro";
  if (stageEl && document.body.contains(stageEl)) stage("Erro: " + String(msg).slice(0, 200), true);
}
window.addEventListener("error", onPageError);
window.addEventListener("unhandledrejection", onPageError);

async function createDsEmulator(romBytes, gameName, startSav) {
  let M;
  $("#game").replaceChildren();
  stage("Carregando o emulador de DS…");
  try {
    // o som não pode segurar o jogo: se o áudio demorar, segue sem ele
    withTimeout(audio.init(), 5000, "som").catch((e) => console.warn("[ds] som", e));
    M = await withTimeout(loadCore(), 30000, "core");
  } catch (e) {
    console.warn(e);
    lastError = "core: " + String(e && e.message || e).slice(0, 160);
    stage("Não carregou o emulador: " + lastError, true);
    return null;
  }
  stage(`Abrindo a ROM (${Math.round(romBytes.length / 1048576)} MB)…`);
  await new Promise((r) => setTimeout(r, 30));   // deixa a mensagem aparecer antes do trabalho pesado
  const box = $("#game");
  box.replaceChildren();
  stageEl = null;
  box.classList.add("ds-game");
  const view = el("canvas", { class: "ds-view", width: String(W), height: String(H * 2), "aria-label": "Telas do DS" });
  box.append(view);
  const vctx = view.getContext("2d", { alpha: false });
  // a tela que vai para a TV: fica no documento (canvas escondido pode parar de gerar quadros)
  const castCanvas = el("canvas", { class: "ds-cast", width: String(W), height: String(H), "aria-hidden": "true" });
  document.body.append(castCanvas);
  const cctx = castCanvas.getContext("2d", { alpha: false });
  // as duas telas cruas, 256x384
  const fb = document.createElement("canvas");
  fb.width = W;
  fb.height = H * 2;
  const fctx = fb.getContext("2d", { alpha: false });

  const fbPtr = M._getSymbol(4), audioPtr = M._getSymbol(6);
  let heapBuf = null, img = null;
  const romLen = romBytes.length;
  let pendingSav = null;

  const listeners = {};
  const emu = {
    started: false, paused: false, muted: false, volume: 1, isDs: true,
    canvas: castCanvas, streamW: W, streamH: H,
    keys: 0, padKeys: 0, kbKeys: 0, gpKeys: 0, touch: false, tx: 0, ty: 0,
    turbo: 1, frames: 0,
    on(ev, cb) {
      if (ev === "start" && emu.started) setTimeout(cb, 0);
      else (listeners[ev] = listeners[ev] || []).push(cb);
    },
    play() { emu.paused = false; audio.reset(); acc = 0; },
    pause() { emu.paused = true; },
    setVolume(v) { emu.volume = v; if (audio.gain) audio.gain.gain.value = v; },
    destroy,
  };
  const gm = emu.gameManager = {
    getSaveFile() {
      const size = M._savGetSize();
      if (size <= 0) return new Uint8Array(0);
      const p = M._savGetPointer(0);
      return M.HEAPU8.slice(p, p + size);
    },
    writeSav(u8) { pendingSav = u8 && u8.length ? new Uint8Array(u8) : null; },
    loadSaveFiles() {},
    restart() {
      // o DeSmuME lê o save quando a ROM carrega: recarrega a ROM (o buffer dela continua na memória)
      if (pendingSav) {
        const p = M._savGetPointer(pendingSav.length);
        M.HEAPU8.set(pendingSav, p);
        pendingSav = null;
      }
      bootRom();
    },
    getState() {
      const size = M._stateSave();
      if (size <= 0) throw new Error("state");
      const p = M._stateGetPointer(0);
      return M.HEAPU8.slice(p, p + size);
    },
    loadState(u8) {
      const p = M._stateGetPointer(u8.length);
      M.HEAPU8.set(u8, p);
      if (M._stateLoad() !== 0) throw new Error("state");
      audio.reset();
    },
    getFrameNum() { return emu.frames; },
    simulateInput(_player, index, value) {
      const bit = RETRO_TO_DS[index];
      if (bit == null) return;
      if (value) emu.padKeys |= 1 << bit; else emu.padKeys &= ~(1 << bit);
    },
    setFastForwardRatio(r) { emu.ffRatio = Math.max(1, Math.min(4, Number(r) || 1)); },
    toggleFastForward(on) { emu.turbo = on ? (emu.ffRatio || 2) : 1; if (!on) { audio.reset(); acc = 0; } },
    setVariable() {},
  };

  function bootRom() {
    M._emuSetOpt(0, 1);                   // idioma do DS: inglês
    M._emuSetOpt(1, cfg.interp);
    const r = M._loadROM(romLen);
    if (r !== 0) throw new Error(r === -1001 ? "rom-encrypted" : "rom " + r);
    M._audioSetup(audio.rate());
    M._savUpdateChangeFlag();
    audio.reset();
    acc = 0;
  }

  // ---- desempenho ----
  const cfg = { latency: 4800, interp: 0, video30: false, skip: 3 };
  const tune = { calm: 0, bad: 0, lastUnder: 0 };
  function applyCfg() {
    if (ds.perf === "auto") Object.assign(cfg, LEVELS[ds.level]);
    else Object.assign(cfg, LEVELS[ds.perf === "30" ? 2 : 0], ds.perf === "30" ? {} : { latency: 3200 });
    audio.setTarget(cfg.latency);
    M._emuSetOpt(1, cfg.interp);
  }
  emu.applyCfg = applyCfg;
  function autoTune(fps, load) {
    if (ds.perf !== "auto" || emu.turbo > 1 || emu.paused) return;
    const under = audio.underruns - tune.lastUnder;
    tune.lastUnder = audio.underruns;
    const struggling = load > 80 || fps < 57 || under > 0;
    tune.bad = struggling ? tune.bad + 1 : 0;
    if ((under > 0 || tune.bad >= 2) && ds.level < LEVELS.length - 1) {
      ds.level++;
      tune.calm = tune.bad = 0;
      ls.set("cartucho.ds.level", String(ds.level));
      applyCfg();
      return;
    }
    tune.calm = !struggling && load < 45 ? tune.calm + 1 : 0;
    if (tune.calm >= 15 && ds.level > 0) {
      ds.level--;
      tune.calm = 0;
      ls.set("cartucho.ds.level", String(ds.level));
      applyCfg();
    }
  }

  // ---- vídeo ----
  function frameImage() {
    const buf = M.HEAPU8.buffer;
    if (buf !== heapBuf) {
      heapBuf = buf;
      img = new ImageData(new Uint8ClampedArray(buf, fbPtr, W * H * 2 * 4), W, H * 2);
    }
    return img;
  }
  /* o que cada canvas mostra: retângulos de origem (no fb 256x384) → destino */
  const casting = () => !!window.__castCap;
  function localLayout() {
    if (casting()) return ds.cast === "bottom" ? "top" : "bottom";   // a TV mostra o resto; o celular fica com a tela de toque
    if (ds.local !== "auto") return ds.local;
    return innerWidth > innerHeight * 1.15 ? "side" : "both";
  }
  function sizeFor(layout) {
    return layout === "both" ? [W, H * 2] : layout === "side" ? [W * 2, H] : [W, H];
  }
  function blit(ctx, layout) {
    if (layout === "both") ctx.drawImage(fb, 0, 0);
    else if (layout === "side") { ctx.drawImage(fb, 0, 0, W, H, 0, 0, W, H); ctx.drawImage(fb, 0, H, W, H, W, 0, W, H); }
    else ctx.drawImage(fb, 0, layout === "top" ? 0 : H, W, H, 0, 0, W, H);
  }
  let shownLocal = "", shownCast = "";
  function syncSizes() {
    const lo = localLayout();
    if (lo !== shownLocal) {
      shownLocal = lo;
      const [w, h] = sizeFor(lo);
      view.width = w;
      view.height = h;
      view.dataset.layout = lo;
      emu.aspect = w / h;
      window.dispatchEvent(new Event("ds-layout"));
    }
    if (casting()) {
      const [w, h] = sizeFor(ds.cast);
      if (ds.cast !== shownCast || castCanvas.width !== w) {
        shownCast = ds.cast;
        castCanvas.width = w;
        castCanvas.height = h;
        emu.streamW = w;
        emu.streamH = h;
      }
    }
  }
  emu.localLayout = localLayout;
  emu.relayout = () => { shownLocal = ""; shownCast = ""; syncSizes(); draw(); };
  function draw() {
    fctx.putImageData(frameImage(), 0, 0);
    blit(vctx, shownLocal);
    if (casting()) blit(cctx, ds.cast);
  }

  // ---- toque na tela de baixo ----
  let touchId = null;
  function touchAt(e) {
    const b = view.getBoundingClientRect();
    // o canvas usa object-fit: contain; acha onde a imagem está de fato dentro dele
    const ar = view.width / view.height;
    const r = { left: b.left, top: b.top, width: b.width, height: b.height };
    if (b.width / b.height > ar) { r.width = b.height * ar; r.left += (b.width - r.width) / 2; }
    else { r.height = b.width / ar; r.top += (b.height - r.height) / 2; }
    const lo = shownLocal;
    // retângulo da tela de baixo dentro do canvas, em fração
    const area = lo === "both" ? [0, 0.5, 1, 0.5] : lo === "side" ? [0.5, 0, 0.5, 1] : lo === "bottom" ? [0, 0, 1, 1] : null;
    if (!area) return false;
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const x = (fx - area[0]) / area[2], y = (fy - area[1]) / area[3];
    if (touchId === null && (x < 0 || x > 1 || y < 0 || y > 1)) return false;
    emu.tx = Math.max(0, Math.min(255, Math.floor(x * W)));
    emu.ty = Math.max(0, Math.min(191, Math.floor(y * H)));
    return true;
  }
  view.addEventListener("pointerdown", (e) => {
    if (!touchAt(e)) return;
    touchId = e.pointerId;
    try { view.setPointerCapture(e.pointerId); } catch (x) {}
    emu.touch = true;
    e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => { if (e.pointerId === touchId) touchAt(e); });
  const touchUp = (e) => { if (e.pointerId !== touchId) return; touchId = null; emu.touch = false; };
  view.addEventListener("pointerup", touchUp);
  view.addEventListener("pointercancel", touchUp);
  view.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---- teclado e controle (no celular quem manda é o controle do Cartuchin) ----
  const onKey = (down) => (e) => {
    if (!(e.code in KEYMAP) || e.target.closest && e.target.closest("input, textarea")) return;
    const bit = 1 << KEYMAP[e.code];
    if (down) emu.kbKeys |= bit; else emu.kbKeys &= ~bit;
    e.preventDefault();
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  function pollGamepad() {
    if (!navigator.getGamepads) return;
    let k = 0;
    for (const gp of navigator.getGamepads()) {
      if (!gp) continue;
      for (const [b, bit] of PADMAP) if (gp.buttons[b] && gp.buttons[b].pressed) k |= 1 << bit;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (ax > 0.5) k |= 1; else if (ax < -0.5) k |= 2;
      if (ay > 0.5) k |= 4; else if (ay < -0.5) k |= 8;
    }
    emu.gpKeys = k;
  }

  // ---- loop ----
  let acc = 0, last = performance.now(), raf = 0, alive = true, toggle30 = 0;
  let stF = 0, stBusy = 0, stT0 = performance.now();
  function drainAudio(push) {
    const n = M._audioDrain(16384);
    if (n <= 0 || !push) return;
    const src = new Int16Array(M.HEAPU8.buffer, audioPtr, n * 2);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < out.length; i++) out[i] = src[i] * (1 / 32768);
    audio.push(out);
  }
  function tick(now) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    pollGamepad();
    if (!emu.started || emu.paused || document.visibilityState !== "visible") { last = now; return; }
    let dt = now - last;
    last = now;
    if (dt > 200) dt = 200;
    const t0 = performance.now();
    let n;
    if (emu.turbo > 1) n = emu.turbo;
    else {
      acc += dt;
      n = Math.floor(acc / FRAME_MS);
      acc -= n * FRAME_MS;
      if (audio.ready) {
        const lvl = audio.level();
        if (lvl < cfg.latency * 0.5) n += 1;
        else if (lvl > cfg.latency * 2 && n > 0) n -= 1;
      }
      n = Math.min(n, cfg.skip);
    }
    const keys = emu.padKeys | emu.kbKeys | emu.gpKeys;
    let drew = false;
    for (let i = 0; i < n; i++) {
      const want = i === n - 1 && (!cfg.video30 || (++toggle30 & 1) === 0);
      M._runFrame(want ? 1 : 0, keys, emu.touch ? 1 : 0, emu.tx, emu.ty);
      drainAudio(emu.turbo === 1 && !emu.muted);
      emu.frames++;
      stF++;
      if (want) drew = true;
    }
    if (drew) {
      syncSizes();
      draw();
    }
    stBusy += performance.now() - t0;
    if (now - stT0 >= 1000) {
      const secs = (now - stT0) / 1000;
      autoTune(stF / secs, (stBusy / (now - stT0)) * 100);
      stF = 0;
      stBusy = 0;
      stT0 = now;
    }
  }

  // ---- saves do jogo: o player pergunta pelo getSaveFile a cada 30 s; aqui só avisamos mudança ----
  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    castCanvas.remove();
  }

  // ---- liga ----
  stage(`Abrindo a ROM (${Math.round(romLen / 1048576)} MB)…`);
  let p = 0;
  try { p = M._prepareRomBuffer(romLen); } catch (e) { p = 0; }
  if (!p) {
    lastError = "sem memória para a ROM";
    stage("Não deu: " + lastError, true);
    return null;
  }
  M.HEAPU8.set(romBytes, p);
  M._savGetPointer(-1);
  if (startSav && startSav.length) {   // o player manda o save junto (não chama mais writeSav no DS)
    const sp = M._savGetPointer(startSav.length);
    M.HEAPU8.set(startSav, sp);
  }
  applyCfg();
  try { bootRom(); } catch (e) {
    lastError = "ROM: " + String(e && e.message || e);
    stage("Não abriu a ROM: " + lastError, true);
    toast(String(e.message) === "rom-encrypted" ? "Essa ROM de DS está criptografada. Use uma versão \"decrypted\"." : "Não deu para abrir essa ROM de DS.", 5000);
    destroy();
    return null;
  }
  syncSizes();
  emu.started = true;
  stage("Iniciando…");
  setTimeout(() => { if (emu.frames > 0 && stageEl) { stageEl.remove(); stageEl = null; } else if (stageEl) stage("O jogo não começou a rodar (0 quadros). Mande um print disto.", true); }, 4000);
  raf = requestAnimationFrame(tick);
  setTimeout(() => { for (const cb of listeners.start || []) cb(); }, 0);
  return emu;
}

/* ---------- opções do DS para o menu do jogo ---------- */
function nextOf(list, cur) { return list[(list.indexOf(cur) + 1) % list.length]; }
function dsMenuItems(emu, refresh) {
  return [
    {
      icon: "sliders", label: "Telas aqui: " + LAYOUT_LABEL[ds.local],
      fn: () => { ds.local = nextOf(LOCAL_LAYOUTS, ds.local); ls.set("cartucho.ds.local", ds.local); emu.relayout(); refresh(); },
    },
    {
      icon: "sliders", label: "Telas na TV: " + LAYOUT_LABEL[ds.cast],
      fn: () => { ds.cast = nextOf(CAST_LAYOUTS, ds.cast); ls.set("cartucho.ds.cast", ds.cast); emu.relayout(); refresh(); },
    },
    {
      icon: "sliders", label: "Desempenho: " + PERF_LABEL[ds.perf] + (ds.perf === "auto" ? ` (${LEVELS[ds.level].name})` : ""),
      fn: () => { ds.perf = nextOf(PERF_MODES, ds.perf); ls.set("cartucho.ds.perf", ds.perf); emu.applyCfg(); refresh(); },
    },
  ];
}

/* o load state do core ainda lança exceção no wasm (investigando): enquanto isso,
   o "continuar de onde parou" do DS fica desligado */
const dsStatesOk = false;

export { createDsEmulator, dsMenuItems, ds, dsStatesOk, dsLastError };
