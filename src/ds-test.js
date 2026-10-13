/* DS speed test (teste-ds.html). Before building DS support, measures whether this
   phone can run a DS game at full speed in the browser.

   The player picks the .nds (or a .zip with it); nothing is uploaded. The game runs
   with one of two cores (melonDS or DeSmuME 2015). When the player taps "Medir", the
   page measures for 20 s at normal speed, then 15 s in fast-forward with no limit:
   the second number is how much DS this phone can emulate, so above 100% there is
   headroom. */
import { unzipRom } from "./bytes.js";

const $ = (s) => document.querySelector(s);
const DS_FPS = 59.83;
const CORES = {
  melonds: { label: "melonDS", file: "melonds_libretro", save: "sav" },
  // the 3D renderer on a second core; needs SharedArrayBuffer (see sw.js)
  "melonds-thread": { label: "melonDS com threads", file: "melonds_thread_libretro", save: "sav", threads: true,
    options: { melonds_threaded_renderer: "enabled" } },
  desmume2015: { label: "DeSmuME 2015", file: "desmume2015_libretro", save: "dsv" },
  // our own build of melonDS, with a profiler that reports where each frame's time goes
  // threaded: a second thread samples which part of the emulator is running (see Prof.cpp)
  "melonds-prof": { label: "melonDS Cartuchin (medidor)", file: "melonds_prof_libretro", save: "sav", threads: true },
};

let romFile = null;
let coreKey = "melonds";

/* for comparing builds: teste-ds.html?arquivo=<name> loads vendor/<name>_libretro.js
   (non-threaded) as an extra choice. Only names of letters, digits and _ are accepted. */
{
  const extra = new URLSearchParams(location.search).get("arquivo");
  if (extra && /^[a-z0-9_]+$/.test(extra)) {
    // &threads=1: a threaded build (the profiler builds sample from a second thread)
    const threads = new URLSearchParams(location.search).get("threads") === "1";
    CORES[extra] = { label: `Build ${extra}`, file: `${extra}_libretro`, save: "sav", coreName: "melonds", threads };
    const b = document.createElement("button");
    b.type = "button"; b.dataset.core = extra; b.textContent = `Build ${extra}`;
    document.querySelector(".row").append(b);
  }
}
/** @type {any} */ let emu = null;

/* keep EmulatorJS from calling its own CDN for update checks */
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const u = typeof input === "string" ? input : (input && /** @type {any} */ (input).url) || "";
  if (/^https?:\/\/(cdn|netplay)\.emulatorjs\.org/.test(u)) return Promise.resolve(new Response("{}", { status: 404 }));
  return realFetch(input, init);
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}

/* The emulator sizes its canvas from a ResizeObserver: report at most the DS's own
   size (256 px wide), so the phone's GPU never draws a 1080p surface for it. */
(() => {
  const RO = window.ResizeObserver;
  /** @type {any} */
  const Capped = class extends RO {
    constructor(cb) {
      super((entries, obs) => cb(entries.map((e) => {
        if (!(e.target instanceof HTMLCanvasElement)) return e;
        const dpr = window.devicePixelRatio || 1, w = e.contentRect.width * dpr, h = e.contentRect.height * dpr;
        const f = w > 256 ? 256 / w : 1;
        if (f === 1) return e;
        const W = Math.round(w * f), H = Math.round(h * f);
        return { target: e.target, contentRect: { width: W / dpr, height: H / dpr, x: 0, y: 0, top: 0, left: 0 },
          devicePixelContentBoxSize: [{ inlineSize: W, blockSize: H }], contentBoxSize: [{ inlineSize: W / dpr, blockSize: H / dpr }], borderBoxSize: e.borderBoxSize };
      }), obs));
    }
  };
  window.ResizeObserver = Capped;
})();

/* Loads the chosen core straight from the published files (same trick as the GBA player). */
function patchEmulator(core) {
  const EJS = window.EmulatorJS;
  EJS.prototype.downloadGameCore = function () {
    this.extensions = ["nds"]; this.coreName = core.coreName || coreKey.replace(/-(thread|prof)$/, ""); this.defaultCoreOpts = {};
    this.saveFileExt = core.save; this.webgl2Enabled = false; this.enableMouseLock = false;
    this.downloadFile(`cores/${core.file}.wasm`, () => {}, false, { responseType: "arraybuffer", method: "GET" }).then((res) => {
      if (res === -1 || !res.data) { this.startGameError("Erro de rede"); return; }
      this.initModule(new Uint8Array(res.data), null);
    });
  };
  EJS.prototype.initModule = function (wasm) {
    const bytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
    window.EJS_Runtime({
      noInitialRun: true, arguments: [], preRun: [], postRun: [], canvas: this.canvas, callbacks: {}, parent: this.elements.parent,
      print: () => {}, printErr: () => {}, totalDependencies: 0, wasmBinary: bytes,
      locateFile: (f) => {
        if (f.endsWith(".wasm")) return URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
        // threaded builds from older Emscripten start their threads from a separate worker file
        if (f.endsWith(".worker.js")) return new URL(`vendor/${core.file}.worker.js`, location.href).href;
        return f;
      },
      getSavExt: () => "." + core.save,
      // emulator threads start as Workers running this same script
      mainScriptUrlOrBlob: new URL(`vendor/${core.file}.js`, location.href).href,
    }).then((m) => { this.Module = m; this.downloadFiles(); }).catch(() => this.startGameError("Falhou ao iniciar"));
  };
}

async function start() {
  const core = CORES[coreKey];
  $("#setup").hidden = true;
  $("#run").hidden = false;
  $("#status").textContent = `Carregando ${core.label}…`;
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "vendor/emulator.min.css" }));
  await loadScript("vendor/emulator.min.js");
  await loadScript(`vendor/${core.file}.js`);
  patchEmulator(core);
  emu = new window.EmulatorJS("#game", {
    gameUrl: romFile, dataPath: "ejs/", system: coreKey, gameName: "teste-ds",
    defaultOptions: core.options || {},
    startOnLoad: true, threads: !!core.threads, forceLegacyCores: true, cacheLimit: 0, backgroundColor: "#000000",
    buttonOpts: { netplay: false, saveSavFiles: false, loadSavFiles: false, cacheManager: false, exitEmulation: false },
  });
  window.__dsEmu = emu;   // for the automated speed/diff tests
  emu.on("start", () => {
    $("#status").textContent = "Passe a abertura e entre no jogo (ande um pouco). Depois toque em Medir.";
    $("#measure").disabled = false;
  });
}

/** frames per second of emulation over `ms`, as % of the real DS */
async function measure(ms) {
  const gm = emu.gameManager;
  const f0 = Number(gm.getFrameNum()), t0 = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  const f1 = Number(gm.getFrameNum()), t1 = performance.now();
  return Math.round(((f1 - f0) / ((t1 - t0) / 1000)) / DS_FPS * 100);
}

/* where each frame's time went, from the profiling build (window.__dsProf, in ms per frame) */
/* where each frame's time went (window.__dsProf from the profiling build). Every value
   is the share of samples spent in that part, exclusive of the parts nested inside it,
   so the rows add up to 100%. */
function profileHtml(p) {
  if (!p) return "";
  if (p.error) return `<b>Medidor:</b> ${p.error}<br>`;
  if (!p.sampled || !p.samples) return "";
  const parts = [
    ["CPU principal (ARM9)", p.arm9], ["CPU secundária (ARM7)", p.arm7], ["DMA", p.dma], ["Timers", p.timers],
    ["Laço do emulador (agenda, eventos)", p.frame], ["Geometria 3D", p.geometry], ["Desenho 3D", p.raster3d],
    ["Desenho 2D", p.draw2d], ["Resto do sistema", p.system], ["Som do DS (SPU)", p.spu],
    ["Imagem: montar as telas", p.video], ["Imagem: RetroArch/WebGL", p.videocb], ["Som: enviar", p.audio],
    ["Controles", p.input], ["Opções do core", p.vars], ["Fora do núcleo (RetroArch, navegador)", p.outside],
    ["JIT: compilar blocos", p.jitcompile || 0], ["JIT: executar blocos do ARM9", p.jitrun9 || 0],
    ["JIT: executar blocos do ARM7", p.jitrun7 || 0],
  ].sort((x, y) => y[1] - x[1]);
  const rows = parts.map(([name, share]) => `<tr><td>${name}</td><td>${(share * p.wall).toFixed(2)} ms</td><td>${Math.round(share * 100)}%</td></tr>`).join("");
  const total = parts.reduce((a, [, v]) => a + v, 0);
  return `<b>Onde vai o tempo de cada quadro</b> (${p.wall.toFixed(1)} ms; o DS precisa de 16,7)` +
    `<br><small>${p.samples} amostras · soma ${Math.round(total * 100)}% · fatias de CPU por quadro: ARM9 ${Math.round(p.arm9calls)}, ARM7 ${Math.round(p.arm7calls)}</small>` +
    `<table style="width:100%;font-size:0.9rem">${rows}</table><br>`;
}
async function runMeasure() {
  $("#measure").disabled = true;
  const gm = emu.gameManager;
  $("#status").textContent = "Medindo na velocidade normal (20 s)… continue jogando.";
  const normal = await measure(20000);
  $("#status").textContent = "Medindo o máximo, em avanço rápido (15 s)…";
  try { gm.setFastForwardRatio(0); gm.toggleFastForward(1); } catch (e) {}
  const max = await measure(15000);
  const prof = window.__dsProf;
  try { gm.toggleFastForward(0); } catch (e) {}
  const verdict = max >= 115 ? "Ótimo: roda com folga. Dá para fazer o modo DS."
    : max >= 98 ? "Roda, mas no limite: cenas pesadas podem engasgar."
    : max >= 85 ? "Quase: precisaria pular quadros (fica menos fluido)."
    : "Não dá: este celular não aguenta DS no navegador.";
  $("#status").textContent = "";
  $("#result").hidden = false;
  $("#result").innerHTML = profileHtml(prof) + `<b>${CORES[coreKey].label}</b><br>Velocidade normal: <b>${normal}%</b><br>Máximo que este celular aguenta: <b>${max}%</b><br>${verdict}<br><small>Mande um print desta tela pro Claude. Para testar o outro emulador, recarregue a página.</small>`;
}

$("#romInput").addEventListener("change", async (e) => {
  const f = /** @type {HTMLInputElement} */ (e.target).files[0];
  if (!f) return;
  let bytes = new Uint8Array(await f.arrayBuffer()), name = f.name;
  if (/\.zip$/i.test(name)) {
    const z = await unzipRom(bytes, /\.nds$/i);
    if (!z) { $("#romName").textContent = "Não achei um .nds dentro do .zip."; return; }
    bytes = z.bytes; name = z.name;
  }
  if (!/\.nds$/i.test(name)) { $("#romName").textContent = "Escolha um arquivo .nds (ou .zip com um .nds)."; return; }
  romFile = new File([bytes], "jogo.nds");
  $("#romName").textContent = `${name} (${Math.round(bytes.length / 1048576)} MB)`;
  $("#startBtn").disabled = false;
});
for (const b of document.querySelectorAll("[data-core]")) {
  b.addEventListener("click", () => {
    coreKey = /** @type {HTMLElement} */ (b).dataset.core;
    for (const x of document.querySelectorAll("[data-core]")) x.classList.toggle("on", x === b);
  });
}
$("#startBtn").addEventListener("click", start);

/* the threads option needs this page to be "cross-origin isolated": the service worker
   adds the headers, but only from the second load, so the page reloads itself once */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(async () => {
  if (window.crossOriginIsolated) return;
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller && !sessionStorage.getItem("cartucho.coi")) { sessionStorage.setItem("cartucho.coi", "1"); location.reload(); }
  else if (!navigator.serviceWorker.controller && !sessionStorage.getItem("cartucho.coi")) { sessionStorage.setItem("cartucho.coi", "1"); setTimeout(() => location.reload(), 300); }
}).catch(() => {});
const threadBtn = /** @type {HTMLButtonElement} */ ($('[data-core="melonds-thread"]'));
threadBtn.disabled = !window.crossOriginIsolated;
$("#isoNote").textContent = window.crossOriginIsolated ? "" : "melonDS com threads: preparando… (a página recarrega sozinha uma vez)";
$("#measure").addEventListener("click", runMeasure);
