import { $, el, ls, toast } from "../util.js";

/* ---------------- Nintendo DS ----------------
   O DS roda no DeSmuME-wasm melhorado (ds/nds.js + ds/nds.wasm, compilados pelo
   workflow ds-core.yml a partir de ds/core). Este módulo monta um objeto com a mesma
   cara do EmulatorJS que o resto do app usa (started, paused, canvas, gameManager…),
   então o player, o save na nuvem, o controle do Cartuchin e a transmissão para a TV
   funcionam sem saber que é outro emulador.

   Desempenho:
   - O core roda num Web Worker. A página só desenha, lê o toque e cuida do áudio;
     enquanto ela desenha um quadro, o worker já está emulando o próximo.
   - O som do core sai a 32 kHz (a taxa do próprio DS): ~1/3 menos trabalho de mixagem.
     O AudioWorklet converte para a taxa da placa e absorve a diferença de relógio
     variando a leitura em até ±0,5% (sem estalo). As amostras vão do worker direto
     para o worklet, sem passar pela página.
   - Frameskip e "vídeo a 30 fps" automáticos, olhando quanto o worker está ocupado. */

const FPS = 59.8261;
const FRAME_MS = 1000 / FPS;
const W = 256, H = 192;
const CORE_RATE = 32768;

/* RetroPad (o que o controle do Cartuchin manda) → bits do DS no runFrame
   RetroPad: B0 Y1 SELECT2 START3 UP4 DOWN5 LEFT6 RIGHT7 A8 X9 L10 R11
   DS:       dir0 esq1 baixo2 cima3 select4 start5 B6 A7 Y8 X9 L10 R11 (14 = microfone) */
const RETRO_TO_DS = { 0: 6, 1: 8, 2: 4, 3: 5, 4: 3, 5: 2, 6: 1, 7: 0, 8: 7, 9: 9, 10: 10, 11: 11 };
const KEYMAP = { ArrowRight: 0, ArrowLeft: 1, ArrowDown: 2, ArrowUp: 3, ShiftRight: 4, ShiftLeft: 4, Enter: 5,
  KeyZ: 6, KeyX: 7, KeyA: 8, KeyS: 9, KeyQ: 10, KeyW: 11, KeyM: 14 };
const PADMAP = [[0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [8, 4], [9, 5], [12, 3], [13, 2], [14, 1], [15, 0]];

/* níveis do ajuste automático, do mais bonito ao mais leve (latência do som em ms) */
const LEVELS = [
  { latency: 70, interp: 1, video30: false, skip: 3, name: "qualidade" },
  { latency: 100, interp: 0, video30: false, skip: 3, name: "leve" },
  { latency: 100, interp: 0, video30: true, skip: 3, name: "vídeo a 30 fps" },
  { latency: 135, interp: 0, video30: true, skip: 5, name: "máximo desempenho" },
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

/* ---------- áudio: AudioWorklet com ring buffer e DRC ---------- */
const WORKLET_SRC = `
class DSOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 1 << 15; this.mask = this.cap - 1;
    this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap);
    this.w = 0; this.rp = 0; this.target = 3300; this.playing = false;
    this.base = 1;                      // taxa do core / taxa da placa
    this.lastL = 0; this.lastR = 0; this.underruns = 0; this.reportIn = 0;
    const onMsg = (e) => {
      const m = e.data;
      if (m.t === "s") this.push(m.d);
      else if (m.t === "target") this.target = m.v;
      else if (m.t === "rate") this.base = m.v / sampleRate;
      else if (m.t === "reset") { this.rp = this.w; this.playing = false; }
      else if (m.t === "port") m.p.onmessage = onMsg;   // canal direto do worker do emulador
    };
    this.port.onmessage = onMsg;
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
      const step = this.base * (1 + dev * 0.005);
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
        this.rp += step;
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

const audio = {
  ctx: null, node: null, gain: null, ready: false, fill: 0, fillAt: 0, pushed: 0, underruns: 0, target: 3300,
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ latencyHint: "interactive" }); } catch (e) { return; }
    if (!this.ctx.audioWorklet) return;
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    this.node = new AudioWorkletNode(this.ctx, "ds-out", { outputChannelCount: [2] });
    this.node.port.onmessage = (e) => { this.fill = e.data.fill; this.fillAt = performance.now(); this.pushed = 0; this.underruns = e.data.underruns; };
    this.node.port.postMessage({ t: "rate", v: CORE_RATE });
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);   // passa pelo "tap" do cast/common.js: o som também vai para a TV
    this.setLatency(100);
    this.ready = true;
  },
  /** canal para o worker mandar amostras direto ao worklet */
  port() {
    if (!this.node) return null;
    const ch = new MessageChannel();
    this.node.port.postMessage({ t: "port", p: ch.port1 }, [ch.port1]);
    return ch.port2;
  },
  setLatency(ms) { this.target = Math.round(ms * CORE_RATE / 1000); if (this.node) this.node.port.postMessage({ t: "target", v: this.target }); },
  reset() { if (this.node) this.node.port.postMessage({ t: "reset" }); this.fill = 0; this.pushed = 0; },
  /** amostras no buffer agora (estimado): último relatório + o que o worker mandou - o que já tocou */
  level() {
    if (!this.ready) return this.target;
    return this.fill + this.pushed - (performance.now() - this.fillAt) * CORE_RATE / 1000;
  },
  resume() { if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {}); },
};
for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, () => audio.resume(), true);

/* ---------- o worker que roda o core ----------
   Mensagens:  página → worker  init | rom | tick | call
               worker → página  ready | frame | sav | ret | error
   O worker nunca decide o ritmo: a página manda "tick" com quantos quadros rodar
   (e se desenha o último). Se o worker ainda está ocupado, a página espera e acumula. */
function workerMain() {
  /** @type {any} */ const g = self;
  let M = null, fbPtr = 0, audioPtr = 0, audioPort = null, romLen = 0, interp = 0, rate = 32768;
  const reply = (m, tr) => g.postMessage(m, tr || []);
  function boot() {
    M._emuSetOpt(0, 1);                       // idioma do DS: inglês
    M._emuSetOpt(1, interp);
    const r = M._loadROM(romLen);
    if (r !== 0) throw new Error(r === -1001 ? "rom-encrypted" : "rom " + r);
    M._audioSetup(rate);
    M._savUpdateChangeFlag();
  }
  function saveBytes() {
    const size = M._savGetSize();
    if (size <= 0) return new Uint8Array(0);
    const p = M._savGetPointer(0);
    return M.HEAPU8.slice(p, p + size);
  }
  let lastSavCheck = 0;
  const calls = {
    restart(sav) {
      if (sav && sav.length) {
        const p = M._savGetPointer(sav.length);
        M.HEAPU8.set(sav, p);
      }
      boot();
      return true;
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
      return true;
    },
    setInterp(v) { interp = v; M._emuSetOpt(1, v); return true; },
    getSave() { return saveBytes(); },
  };
  g.onmessage = (e) => {
    const m = e.data;
    try {
      if (m.t === "tick") {
        if (!M || !romLen) return;
        const t0 = performance.now();
        let drew = false;
        for (let i = 0; i < m.n; i++) {
          const draw = m.draw && i === m.n - 1;
          M._runFrame(draw ? 1 : 0, m.keys, m.touch ? 1 : 0, m.tx, m.ty);
          const n = M._audioDrain(16384);
          if (n > 0 && m.audio && audioPort) {
            const src = new Int16Array(M.HEAPU8.buffer, audioPtr, n * 2);
            const out = new Float32Array(n * 2);
            for (let k = 0; k < out.length; k++) out[k] = src[k] * (1 / 32768);
            audioPort.postMessage({ t: "s", d: out }, [out.buffer]);
          }
          if (draw) drew = true;
        }
        const fb = drew ? M.HEAPU8.slice(fbPtr, fbPtr + W2 * H2 * 4) : null;
        const busy = performance.now() - t0;
        reply({ t: "frame", n: m.n, fb, busy }, fb ? [fb.buffer] : []);
        // save do jogo mudou? manda a cópia para a página (o player lê de forma síncrona)
        if (t0 - lastSavCheck > 1000) {
          lastSavCheck = t0;
          if (M._savUpdateChangeFlag()) { const s = saveBytes(); reply({ t: "sav", sav: s }, [s.buffer]); }
        }
      } else if (m.t === "call") {
        const val = calls[m.fn](m.arg);
        const tr = val && val.buffer instanceof ArrayBuffer ? [val.buffer] : [];
        reply({ t: "ret", id: m.id, val }, tr);
      } else if (m.t === "rom") {
        const bytes = new Uint8Array(m.bytes);
        romLen = bytes.length;
        const p = M._prepareRomBuffer(romLen);
        if (!p) throw new Error("mem");
        M.HEAPU8.set(bytes, p);
        M._savGetPointer(-1);
        if (m.sav && m.sav.length) { const sp = M._savGetPointer(m.sav.length); M.HEAPU8.set(m.sav, sp); }
        interp = m.interp | 0;
        rate = m.rate | 0;
        boot();
        reply({ t: "ret", id: m.id, val: true });
      } else if (m.t === "init") {
        audioPort = m.audioPort || null;
        g.Module = {
          locateFile: (p) => m.base + p.replace(/^nds(-nosimd|-mt)?\.wasm$/, m.name + ".wasm"),
          // build com threads: cada thread é um worker que carrega este mesmo script
          mainScriptUrlOrBlob: m.base + m.name + ".js",
          print: () => {}, printErr: (t) => console.warn("[ds]", t),
          onAbort: (r) => reply({ t: "error", msg: "core: " + r }),
        };
        g.wasmReady = () => {
          M = g.Module;
          fbPtr = M._getSymbol(4);
          audioPtr = M._getSymbol(6);
          reply({ t: "ready" });
        };
        g.importScripts(m.base + m.name + ".js");
      }
    } catch (err) {
      reply({ t: m.t === "call" || m.t === "rom" ? "ret" : "error", id: m.id, err: String(err && err.message || err), msg: String(err && err.message || err) });
    }
  };
}

let workerUrl = null;
/* Qual core usar: com isolamento cross-origin (página do jogo de DS, ?ds=) dá para usar
   threads — o rasterizador 3D roda em paralelo. Sem isso, o core de uma thread só. */
function coreNames() {
  const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
    2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  if (!simd) return ["nds-nosimd"];
  const mt = window.crossOriginIsolated && typeof SharedArrayBuffer === "function" && ls.get("cartucho.ds.nomt") !== "1";
  return mt ? ["nds-mt", "nds"] : ["nds"];
}
function startWorker(name) {
  if (!workerUrl) {
    const src = `const W2 = ${W}, H2 = ${H * 2};\n(${workerMain.toString()})();`;
    workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  }
  const worker = new Worker(workerUrl);
  const base = new URL("ds/", location.href).href;
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 30000);
    worker.addEventListener("message", function on(e) {
      if (e.data.t === "ready") { clearTimeout(t); worker.removeEventListener("message", on); resolve(); }
      else if (e.data.t === "error") { clearTimeout(t); reject(new Error(e.data.msg)); }
    });
    worker.addEventListener("error", (e) => { clearTimeout(t); reject(new Error(e.message || "worker")); });
  });
  const audioPort = audio.port();
  worker.postMessage({ t: "init", base, name, audioPort }, audioPort ? [audioPort] : []);
  return { worker, ready, name };
}

/* ---------- o emulador com cara de EmulatorJS ---------- */
/* o motivo da última falha, para a mensagem na tela (ajuda a diagnosticar no celular) */
let lastError = "";
const dsLastError = () => lastError;
async function createDsEmulator(romBytes, gameName, startSav, skip = []) {
  await audio.init().catch(() => {});
  let worker = null, coreName = "";
  const names = coreNames().filter((n) => !skip.includes(n));
  for (const name of names) {
    const w = startWorker(name);
    try {
      await w.ready;
      worker = w.worker;
      coreName = name;
      break;
    } catch (e) {
      console.warn("ds worker", name, e);
      lastError = name + ": " + String(e && e.message || e).slice(0, 160);
      w.worker.terminate();
    }
  }
  if (!worker) return null;
  const lastTry = coreName === names[names.length - 1];

  // chamadas ao worker que devolvem resultado
  let nextId = 1;
  const waiting = new Map();
  function call(fn, arg, transfer) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage(fn === "rom" ? { t: "rom", id, ...arg } : { t: "call", id, fn, arg }, transfer || []);
    });
  }

  const box = $("#game");
  box.replaceChildren();
  box.classList.add("ds-game");
  const view = el("canvas", { class: "ds-view", width: String(W), height: String(H * 2), "aria-label": "Telas do DS" });
  box.append(view);
  const vctx = view.getContext("2d", { alpha: false });
  // a tela que vai para a TV: fica no documento (canvas escondido pode parar de gerar quadros)
  // tela preta: amostra alguns pixels a cada ~0,5 s (para descartar um snapshot ruim)
  let blankChecks = 0, frameN = 0;
  function checkBlank() {
    const d = fctx.getImageData(0, 0, W, H * 2).data;
    for (let i = 0; i < d.length; i += 4 * 997) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) { blankChecks = 0; return; }
    blankChecks++;
  }
  const castCanvas = el("canvas", { class: "ds-cast", width: String(W), height: String(H), "aria-hidden": "true" });
  document.body.append(castCanvas);
  const cctx = castCanvas.getContext("2d", { alpha: false });
  // as duas telas cruas, 256x384
  const fb = document.createElement("canvas");
  fb.width = W;
  fb.height = H * 2;
  const fctx = fb.getContext("2d", { alpha: false });

  let savCopy = startSav && startSav.length ? new Uint8Array(startSav) : new Uint8Array(0);
  let pendingSav = null;
  const listeners = {};
  const emu = {
    started: false, paused: false, muted: false, volume: 1, isDs: true,
    canvas: castCanvas, streamW: W, streamH: H, aspect: 2 / 3,
    padKeys: 0, kbKeys: 0, gpKeys: 0, touch: false, tx: 0, ty: 0,
    turbo: 1, ffRatio: 2, frames: 0,
    on(ev, cb) {
      if (ev === "start" && emu.started) setTimeout(cb, 0);
      else (listeners[ev] = listeners[ev] || []).push(cb);
    },
    play() { emu.paused = false; audio.reset(); acc = 0; },
    pause() { emu.paused = true; },
    setVolume(v) { emu.volume = v; if (audio.gain) audio.gain.gain.value = v; },
    core: coreName,
    isBlank: () => blankChecks >= 5,
    audioStats: () => ({ ready: audio.ready, fill: Math.round(audio.fill), target: audio.target, underruns: audio.underruns, state: audio.ctx && audio.ctx.state }),
    destroy,
  };
  emu.gameManager = {
    // o player pede o save de forma síncrona: devolve a cópia que o worker manda quando ele muda
    getSaveFile() { return savCopy.slice(); },
    writeSav(u8) { pendingSav = u8 && u8.length ? new Uint8Array(u8) : null; },
    loadSaveFiles() {},
    async restart() {
      const sav = pendingSav;
      pendingSav = null;
      if (sav) savCopy = sav.slice();
      await call("restart", sav);
      audio.reset();
      acc = 0;
    },
    getState() { return call("getState"); },
    async loadState(u8) {
      await call("loadState", u8);
      audio.reset();
      acc = 0;
    },
    getFrameNum() { return emu.frames; },
    simulateInput(_player, index, value) {
      const bit = RETRO_TO_DS[index];
      if (bit == null) return;
      if (value) emu.padKeys |= 1 << bit; else emu.padKeys &= ~(1 << bit);
    },
    setFastForwardRatio(r) { emu.ffRatio = Math.max(2, Math.min(4, Number(r) || 2)); },
    toggleFastForward(on) { emu.turbo = on ? emu.ffRatio : 1; if (!on) { audio.reset(); acc = 0; } },
    setVariable() {},
  };

  // ---- desempenho ----
  const cfg = { latency: 100, interp: 0, video30: false, skip: 3 };
  const tune = { calm: 0, bad: 0, lastUnder: 0 };
  function applyCfg() {
    if (ds.perf === "auto") Object.assign(cfg, LEVELS[ds.level]);
    else Object.assign(cfg, LEVELS[ds.perf === "30" ? 2 : 0]);
    audio.setLatency(cfg.latency);
    if (emu.started) call("setInterp", cfg.interp).catch(() => {});
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
  const casting = () => !!window.__castCap;
  function localLayout() {
    if (casting()) return ds.cast === "bottom" ? "top" : "bottom";   // a TV mostra o resto; o celular fica com a tela de toque
    if (ds.local !== "auto") return ds.local;
    return innerWidth > innerHeight * 1.15 ? "side" : "both";
  }
  function sizeFor(layout) { return layout === "both" ? [W, H * 2] : layout === "side" ? [W * 2, H] : [W, H]; }
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
      if (ds.cast !== shownCast || castCanvas.width !== w || castCanvas.height !== h) {
        shownCast = ds.cast;
        castCanvas.width = w;
        castCanvas.height = h;
        emu.streamW = w;
        emu.streamH = h;
      }
    }
  }
  function draw() {
    syncSizes();
    blit(vctx, shownLocal);
    if (emu.onFrame) emu.onFrame(null);
    else if (casting()) blit(cctx, ds.cast);
  }
  emu.fbCanvas = fb;
  emu.relayout = () => { shownLocal = ""; shownCast = ""; draw(); };

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
    if (emu.onTouch) emu.onTouch();
    return true;
  }
  view.addEventListener("pointerdown", (e) => {
    if (!touchAt(e)) return;
    touchId = e.pointerId;
    try { view.setPointerCapture(e.pointerId); } catch (x) {}
    emu.touch = true;
    if (emu.onTouch) emu.onTouch();
    e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => { if (e.pointerId === touchId) touchAt(e); });
  const touchUp = (e) => { if (e.pointerId !== touchId) return; touchId = null; emu.touch = false; if (emu.onTouch) emu.onTouch(); };
  // modo console: a outra tela roda o jogo e manda a tela de baixo de volta para este celular
  emu.drawBottom = (ctx, w, h) => ctx.drawImage(fb, 0, fb.height / 2, fb.width, fb.height / 2, 0, 0, w, h);
  emu.view = view;
  view.addEventListener("pointerup", touchUp);
  view.addEventListener("pointercancel", touchUp);
  view.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---- teclado e controle (no celular quem manda é o controle do Cartuchin) ----
  const onKey = (down) => (e) => {
    if (!(e.code in KEYMAP) || (e.target && e.target.closest && e.target.closest("input, textarea"))) return;
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

  // ---- respostas do worker ----
  let inFlight = false, inFlightN = 0;
  let stF = 0, stBusy = 0, stT0 = performance.now();
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.t === "frame") {
      inFlight = false;
      emu.frames += m.n;
      stF += m.n;
      stBusy += m.busy;
      audio.pushed += m.n * CORE_RATE / FPS * (emu.turbo === 1 && !emu.muted ? 1 : 0);
      if (m.fb) {
        fctx.putImageData(new ImageData(new Uint8ClampedArray(m.fb.buffer), W, H * 2), 0, 0);
        draw();
        if (++frameN % 30 === 0) checkBlank();
      }
    } else if (m.t === "sav") {
      savCopy = m.sav;
    } else if (m.t === "ret") {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.err) w.reject(new Error(m.err)); else w.resolve(m.val);
    } else if (m.t === "error") {
      console.warn("[ds]", m.msg);
    }
  };

  // ---- loop: o relógio da página decide quantos quadros; o worker emula ----
  let acc = 0, last = performance.now(), raf = 0, alive = true, toggle30 = 0, sentAt = 0, stuck = false;
  function tick(now) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    pollGamepad();
    if (!emu.started || emu.paused || document.visibilityState !== "visible") { last = now; return; }
    let dt = now - last;
    last = now;
    if (dt > 200) dt = 200;
    acc += dt;
    if (inFlight) {                             // worker ainda emulando: o tempo acumula e vira frameskip
      if (now - sentAt > 6000 && !stuck) {
        stuck = true;
        if (coreName === "nds-mt") {
          // o core com threads travou neste aparelho: não usa mais e recarrega
          ls.set("cartucho.ds.nomt", "1");
          toast("O modo com threads travou neste aparelho. Voltando ao modo normal…", 3000);
          setTimeout(() => location.reload(), 1500);
        } else toast("O emulador parou de responder. Volte à biblioteca e abra o jogo de novo.", 6000);
      }
      return;
    }
    let n;
    if (emu.turbo > 1) { n = emu.turbo; acc = 0; }
    else {
      n = Math.floor(acc / FRAME_MS);
      acc -= n * FRAME_MS;
      if (audio.ready) {
        const lvl = audio.level();
        if (lvl < audio.target * 0.5) n += 1;
        else if (lvl > audio.target * 2 && n > 0) n -= 1;
      }
      if (n > cfg.skip) { n = cfg.skip; acc = Math.min(acc, FRAME_MS); }
    }
    if (n > 0) {
      const draw = !cfg.video30 || (++toggle30 & 1) === 0;
      inFlight = true;
      inFlightN = n;
      sentAt = now;
      worker.postMessage({ t: "tick", n, draw, keys: emu.padKeys | emu.kbKeys | emu.gpKeys, touch: emu.touch, tx: emu.tx, ty: emu.ty,
        audio: emu.turbo === 1 && !emu.muted });
    }
    if (now - stT0 >= 1000) {
      autoTune(stF / ((now - stT0) / 1000), (stBusy / (now - stT0)) * 100);
      stF = 0;
      stBusy = 0;
      stT0 = now;
    }
  }

  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    castCanvas.remove();
    worker.terminate();
  }

  // ---- liga ----
  applyCfg();
  try {
    // na última tentativa a ROM é transferida (sem cópia); antes disso vai uma cópia,
    // para dar para tentar o próximo core se este falhar
    const buf = lastTry ? (romBytes.buffer.byteLength === romBytes.length ? romBytes.buffer : romBytes.slice().buffer) : romBytes.slice().buffer;
    await call("rom", { bytes: buf, sav: savCopy.length ? savCopy.slice() : null, interp: cfg.interp, rate: CORE_RATE }, [buf]);
  } catch (e) {
    const msg = String(e && e.message || e);
    lastError = coreName + " (ROM): " + msg.slice(0, 160);
    destroy();
    if (msg !== "rom-encrypted" && !lastTry) {
      console.warn("ds rom", coreName, msg, "tentando o próximo core");
      return createDsEmulator(romBytes, gameName, startSav, [...skip, coreName]);
    }
    if (msg === "rom-encrypted") lastError = "a ROM está criptografada, use uma versão \"decrypted\"";
    return null;   // o player mostra a mensagem com o motivo
  }
  syncSizes();
  emu.started = true;
  audio.reset();
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
      fn: () => { ds.cast = nextOf(CAST_LAYOUTS, ds.cast); ls.set("cartucho.ds.cast", ds.cast); emu.relayout(); refresh(); window.dispatchEvent(new Event("ds-cast-layout")); },
    },
    {
      icon: "sliders", label: "Desempenho: " + PERF_LABEL[ds.perf] + (ds.perf === "auto" ? ` (${LEVELS[ds.level].name})` : ""),
      fn: () => { ds.perf = nextOf(PERF_MODES, ds.perf); ls.set("cartucho.ds.perf", ds.perf); emu.applyCfg(); refresh(); },
    },
  ];
}

/* load state corrigido no core (fseek(-1) com save vazio tentava alocar 4 GB) */
const dsStatesOk = true;

export { createDsEmulator, dsMenuItems, ds, dsStatesOk, dsLastError };
