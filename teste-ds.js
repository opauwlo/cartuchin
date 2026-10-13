(() => {
  // src/js/bytes.js
  var CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  var CP437_HI = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
  function cp437(u8) {
    let s = "";
    for (const c of u8) s += c < 128 ? String.fromCharCode(c) : CP437_HI[c - 128];
    return s;
  }
  async function unzipRom(u8, wanted = /\.(gba|gbc|gb)$/i) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 101010256) {
      eocd = i;
      break;
    }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 33639248) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const fnl = dv.getUint16(p + 28, true), exl = dv.getUint16(p + 30, true), cml = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const flags = dv.getUint16(p + 8, true);
      const name = flags & 2048 ? new TextDecoder().decode(u8.subarray(p + 46, p + 46 + fnl)) : cp437(u8.subarray(p + 46, p + 46 + fnl));
      p += 46 + fnl + exl + cml;
      if (!wanted.test(name)) continue;
      const start2 = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const comp = u8.subarray(start2, start2 + csize);
      if (method === 0) return { name, bytes: comp.slice() };
      if (method === 8 && typeof DecompressionStream === "function") {
        const s = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return { name, bytes: new Uint8Array(await new Response(s).arrayBuffer()) };
      }
      throw new Error("zip-method");
    }
    return null;
  }

  // src/js/ds-test.js
  var $ = (s) => document.querySelector(s);
  var DS_FPS = 59.83;
  var CORES = {
    melonds: { label: "melonDS", file: "melonds_libretro", save: "sav" },
    // the 3D renderer on a second core; needs SharedArrayBuffer (see sw.js)
    "melonds-thread": {
      label: "melonDS com threads",
      file: "melonds_thread_libretro",
      save: "sav",
      threads: true,
      options: { melonds_threaded_renderer: "enabled" }
    },
    desmume2015: { label: "DeSmuME 2015", file: "desmume2015_libretro", save: "dsv" },
    // our own build of melonDS, with a profiler that reports where each frame's time goes
    // threaded: a second thread samples which part of the emulator is running (see Prof.cpp)
    "melonds-prof": { label: "melonDS Cartuchin (medidor)", file: "melonds_prof_libretro", save: "sav", threads: true }
  };
  var romFile = null;
  var coreKey = "melonds";
  {
    const extra = new URLSearchParams(location.search).get("arquivo");
    if (extra && /^[a-z0-9_]+$/.test(extra)) {
      const threads = new URLSearchParams(location.search).get("threads") === "1";
      CORES[extra] = {
        label: `Build ${extra}`,
        file: `${extra}_libretro`,
        save: "sav",
        coreName: "melonds",
        threads,
        options: threads ? { melonds_threaded_renderer: "enabled" } : void 0
      };
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.core = extra;
      b.textContent = `Build ${extra}`;
      document.querySelector(".row").append(b);
    }
  }
  var emu = null;
  var realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input && /** @type {any} */
    input.url || "";
    if (/^https?:\/\/(cdn|netplay)\.emulatorjs\.org/.test(u)) return Promise.resolve(new Response("{}", { status: 404 }));
    return realFetch(input, init);
  };
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  (() => {
    const RO = window.ResizeObserver;
    const Capped = class extends RO {
      constructor(cb) {
        super((entries, obs) => cb(entries.map((e) => {
          if (!(e.target instanceof HTMLCanvasElement)) return e;
          const dpr = window.devicePixelRatio || 1, w = e.contentRect.width * dpr, h = e.contentRect.height * dpr;
          const f = w > 256 ? 256 / w : 1;
          if (f === 1) return e;
          const W = Math.round(w * f), H = Math.round(h * f);
          return {
            target: e.target,
            contentRect: { width: W / dpr, height: H / dpr, x: 0, y: 0, top: 0, left: 0 },
            devicePixelContentBoxSize: [{ inlineSize: W, blockSize: H }],
            contentBoxSize: [{ inlineSize: W / dpr, blockSize: H / dpr }],
            borderBoxSize: e.borderBoxSize
          };
        }), obs));
      }
    };
    window.ResizeObserver = Capped;
  })();
  function patchEmulator(core) {
    const EJS = window.EmulatorJS;
    EJS.prototype.downloadGameCore = function() {
      this.extensions = ["nds"];
      this.coreName = core.coreName || coreKey.replace(/-(thread|prof)$/, "");
      this.defaultCoreOpts = {};
      this.saveFileExt = core.save;
      this.webgl2Enabled = false;
      this.enableMouseLock = false;
      this.downloadFile(`cores/${core.file}.wasm`, () => {
      }, false, { responseType: "arraybuffer", method: "GET" }).then((res) => {
        if (res === -1 || !res.data) {
          this.startGameError("Erro de rede");
          return;
        }
        this.initModule(new Uint8Array(res.data), null);
      });
    };
    EJS.prototype.initModule = function(wasm) {
      const bytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
      window.EJS_Runtime({
        noInitialRun: true,
        arguments: [],
        preRun: [],
        postRun: [],
        canvas: this.canvas,
        callbacks: {},
        parent: this.elements.parent,
        print: () => {
        },
        printErr: () => {
        },
        totalDependencies: 0,
        wasmBinary: bytes,
        locateFile: (f) => {
          if (f.endsWith(".wasm")) return URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
          if (f.endsWith(".worker.js")) return new URL(`vendor/${core.file}.worker.js`, location.href).href;
          return f;
        },
        getSavExt: () => "." + core.save,
        // emulator threads start as Workers running this same script
        mainScriptUrlOrBlob: new URL(`vendor/${core.file}.js`, location.href).href
      }).then((m) => {
        this.Module = m;
        this.downloadFiles();
      }).catch(() => this.startGameError("Falhou ao iniciar"));
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
      gameUrl: romFile,
      dataPath: "ejs/",
      system: coreKey,
      gameName: "teste-ds",
      defaultOptions: core.options || {},
      startOnLoad: true,
      threads: !!core.threads,
      forceLegacyCores: true,
      cacheLimit: 0,
      backgroundColor: "#000000",
      buttonOpts: { netplay: false, saveSavFiles: false, loadSavFiles: false, cacheManager: false, exitEmulation: false }
    });
    window.__dsEmu = emu;
    emu.on("start", () => {
      $("#status").textContent = "Passe a abertura e entre no jogo (ande um pouco). Depois toque em Medir.";
      $("#measure").disabled = false;
    });
  }
  async function measure(ms) {
    const gm = emu.gameManager;
    const f0 = Number(gm.getFrameNum()), t0 = performance.now();
    await new Promise((r) => setTimeout(r, ms));
    const f1 = Number(gm.getFrameNum()), t1 = performance.now();
    return Math.round((f1 - f0) / ((t1 - t0) / 1e3) / DS_FPS * 100);
  }
  function profileHtml(p) {
    if (!p) return "";
    if (p.error) return `<b>Medidor:</b> ${p.error}<br>`;
    if (!p.sampled || !p.samples) return "";
    const parts = [
      ["CPU principal (ARM9)", p.arm9],
      ["CPU secundária (ARM7)", p.arm7],
      ["DMA", p.dma],
      ["Timers", p.timers],
      ["Laço do emulador (agenda, eventos)", p.frame],
      ["Geometria 3D", p.geometry],
      ["Desenho 3D", p.raster3d],
      ["Desenho 2D", p.draw2d],
      ["Resto do sistema", p.system],
      ["Som do DS (SPU)", p.spu],
      ["Imagem: montar as telas", p.video],
      ["Imagem: RetroArch/WebGL", p.videocb],
      ["Som: enviar", p.audio],
      ["Controles", p.input],
      ["Opções do core", p.vars],
      ["Fora do núcleo (RetroArch, navegador)", p.outside],
      ["JIT: compilar blocos", p.jitcompile || 0],
      ["JIT: executar blocos do ARM9", p.jitrun9 || 0],
      ["JIT: executar blocos do ARM7", p.jitrun7 || 0]
    ].sort((x, y) => y[1] - x[1]);
    const rows = parts.map(([name, share]) => `<tr><td>${name}</td><td>${(share * p.wall).toFixed(2)} ms</td><td>${Math.round(share * 100)}%</td></tr>`).join("");
    const total = parts.reduce((a, [, v]) => a + v, 0);
    return `<b>Onde vai o tempo de cada quadro</b> (${p.wall.toFixed(1)} ms; o DS precisa de 16,7)<br><small>${p.samples} amostras · soma ${Math.round(total * 100)}% · fatias de CPU por quadro: ARM9 ${Math.round(p.arm9calls)}, ARM7 ${Math.round(p.arm7calls)}</small><table style="width:100%;font-size:0.9rem">${rows}</table><br>`;
  }
  async function runMeasure() {
    $("#measure").disabled = true;
    const gm = emu.gameManager;
    $("#status").textContent = "Medindo na velocidade normal (20 s)… continue jogando.";
    const normal = await measure(2e4);
    $("#status").textContent = "Medindo o máximo, em avanço rápido (15 s)…";
    try {
      gm.setFastForwardRatio(0);
      gm.toggleFastForward(1);
    } catch (e) {
    }
    const max = await measure(15e3);
    const prof = window.__dsProf;
    try {
      gm.toggleFastForward(0);
    } catch (e) {
    }
    const verdict = max >= 115 ? "Ótimo: roda com folga. Dá para fazer o modo DS." : max >= 98 ? "Roda, mas no limite: cenas pesadas podem engasgar." : max >= 85 ? "Quase: precisaria pular quadros (fica menos fluido)." : "Não dá: este celular não aguenta DS no navegador.";
    $("#status").textContent = "";
    $("#result").hidden = false;
    $("#result").innerHTML = profileHtml(prof) + `<b>${CORES[coreKey].label}</b><br>Velocidade normal: <b>${normal}%</b><br>Máximo que este celular aguenta: <b>${max}%</b><br>${verdict}<br><small>Mande um print desta tela pro Claude. Para testar o outro emulador, recarregue a página.</small>`;
  }
  $("#romInput").addEventListener("change", async (e) => {
    const f = (
      /** @type {HTMLInputElement} */
      e.target.files[0]
    );
    if (!f) return;
    let bytes = new Uint8Array(await f.arrayBuffer()), name = f.name;
    if (/\.zip$/i.test(name)) {
      const z = await unzipRom(bytes, /\.nds$/i);
      if (!z) {
        $("#romName").textContent = "Não achei um .nds dentro do .zip.";
        return;
      }
      bytes = z.bytes;
      name = z.name;
    }
    if (!/\.nds$/i.test(name)) {
      $("#romName").textContent = "Escolha um arquivo .nds (ou .zip com um .nds).";
      return;
    }
    romFile = new File([bytes], "jogo.nds");
    $("#romName").textContent = `${name} (${Math.round(bytes.length / 1048576)} MB)`;
    $("#startBtn").disabled = false;
  });
  for (const b of document.querySelectorAll("[data-core]")) {
    b.addEventListener("click", () => {
      coreKey = /** @type {HTMLElement} */
      b.dataset.core;
      for (const x of document.querySelectorAll("[data-core]")) x.classList.toggle("on", x === b);
    });
  }
  $("#startBtn").addEventListener("click", start);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(async () => {
    if (window.crossOriginIsolated) return;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller && !sessionStorage.getItem("cartucho.coi")) {
      sessionStorage.setItem("cartucho.coi", "1");
      location.reload();
    } else if (!navigator.serviceWorker.controller && !sessionStorage.getItem("cartucho.coi")) {
      sessionStorage.setItem("cartucho.coi", "1");
      setTimeout(() => location.reload(), 300);
    }
  }).catch(() => {
  });
  var threadBtn = (
    /** @type {HTMLButtonElement} */
    $('[data-core="melonds-thread"]')
  );
  threadBtn.disabled = !window.crossOriginIsolated;
  $("#isoNote").textContent = window.crossOriginIsolated ? "" : "melonDS com threads: preparando… (a página recarrega sozinha uma vez)";
  $("#measure").addEventListener("click", runMeasure);
})();
