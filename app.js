(() => {
  // src/cast/constants.js
  var STREAM_W = 240;
  var STREAM_H = 160;
  var KEYCODES = { 10009: "B", 415: "START", 19: "START", 403: "L", 404: "R", 405: "SELECT", 406: "START" };
  var KEYMAP = {
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    Enter: "A",
    " ": "A",
    Backspace: "B",
    Escape: "B",
    GoBack: "B",
    BrowserBack: "B",
    MediaPlayPause: "START",
    ColorF0Red: "L",
    ColorF1Green: "R",
    ColorF2Yellow: "SELECT",
    ColorF3Blue: "START"
  };
  var keysDown = /* @__PURE__ */ new Set();
  var PAD_BITS = ["B", "SELECT", "START", "UP", "DOWN", "LEFT", "RIGHT", "A", "L", "R", "X", "Y"];
  var PAD = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };
  var RTC_CONFIG = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

  // src/util.js
  var $ = (s) => document.querySelector(s);
  var $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  var el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  };
  var ls = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
      }
    }
  };
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  function actionToast(msg, label, fn, ms = 9e3) {
    const btn = el("button", { class: "toast-btn", type: "button" }, label);
    const t = el("div", { class: "toast toast-action", role: "status" }, el("span", {}, msg), btn);
    btn.addEventListener("click", () => {
      t.remove();
      fn();
    });
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  }
  function toast(msg, ms = 2600) {
    const t = el("div", { class: "toast", role: "status" }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  }
  var rtf = (() => {
    try {
      return new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
    } catch (e) {
      return null;
    }
  })();
  function ago(ts) {
    if (!ts) return "";
    const s = Math.round((ts - Date.now()) / 1e3);
    const a = Math.abs(s);
    if (!rtf) return new Date(ts).toLocaleString("pt-BR");
    if (a < 45) return "agora há pouco";
    if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
    if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
    return new Date(ts).toLocaleDateString("pt-BR");
  }

  // src/bytes.js
  function b64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  async function sha(u8) {
    try {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
      return Array.from(h.subarray(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < u8.length; i++) {
        h ^= u8[i];
        h = Math.imul(h, 16777619) >>> 0;
      }
      return "f" + h.toString(16) + "-" + u8.length;
    }
  }
  async function pack(u8) {
    if (typeof CompressionStream === "function") {
      try {
        const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"));
        return { enc: "gz64", data: b64(new Uint8Array(await new Response(s).arrayBuffer())) };
      } catch (e) {
      }
    }
    return { enc: "b64", data: b64(u8) };
  }
  async function unpack(rec) {
    const raw = unb64(rec.data);
    if (rec.enc === "gz64") {
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return raw;
  }
  var CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 4294967295;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
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
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const comp = u8.subarray(start, start + csize);
      if (method === 0) return { name, bytes: comp.slice() };
      if (method === 8 && typeof DecompressionStream === "function") {
        const s = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return { name, bytes: new Uint8Array(await new Response(s).arrayBuffer()) };
      }
      throw new Error("zip-method");
    }
    return null;
  }

  // src/rom.js
  var KNOWN = {
    BPE: "Pokémon Emerald",
    AXV: "Pokémon Ruby",
    AXP: "Pokémon Sapphire",
    BPR: "Pokémon FireRed",
    BPG: "Pokémon LeafGreen",
    AMK: "Mario Kart: Super Circuit",
    AZL: "The Legend of Zelda: A Link to the Past",
    BZM: "The Legend of Zelda: The Minish Cap",
    AMA: "Super Mario Advance",
    AA2: "Super Mario World: Super Mario Advance 2",
    AMT: "Metroid Fusion",
    BMX: "Metroid: Zero Mission",
    AGS: "Golden Sun",
    AGF: "Golden Sun: The Lost Age",
    AFX: "Final Fantasy Tactics Advance",
    AWR: "Advance Wars"
  };
  function ascii(u8, a, n) {
    let s = "";
    for (let i = a; i < a + n && i < u8.length; i++) {
      const c = u8[i];
      if (c === 0) break;
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : "";
    }
    return s.trim();
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|\s|[-:])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  function parseRom(u8, fileName) {
    let system, title, code = "";
    if (u8.length > 192 && u8[178] === 150) {
      system = "gba";
      title = ascii(u8, 160, 12);
      code = ascii(u8, 172, 4);
    } else if (u8.length > 336 && u8[260] === 206 && u8[261] === 237) {
      system = "gb";
      const cgb = u8[323] === 128 || u8[323] === 192;
      title = ascii(u8, 308, cgb ? 11 : 16);
      if (cgb) {
        const c = ascii(u8, 319, 4);
        if (/^[A-Z0-9]{4}$/.test(c)) code = c;
      }
    } else if (u8.length > 512 && u8[192] === 36 && u8[193] === 255 && u8[194] === 174 && u8[195] === 81) {
      system = "nds";
      title = ascii(u8, 0, 12);
      const c = ascii(u8, 12, 4);
      if (/^[A-Z0-9]{4}$/.test(c)) code = c;
    } else return null;
    const clean = (title || fileName.replace(/\.[^.]+$/, "")).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "jogo";
    const key = /^[A-Z0-9]{4}$/.test(code) ? code + "-" + clean : system + "-" + clean;
    const base = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s*\((?:[^)]*)\)\s*/g, " ").trim();
    const nice = (base.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 4 ? base : title;
    const display = system === "gba" && code && KNOWN[code.slice(0, 3)] || titleCase(nice || title || "Jogo");
    return { key, system, title: display, header: title, code };
  }
  var MGBA_CODES = new Set("2GBP A2YE A3AE A3AJ A3AP AA2E AA2J AA2P AC8E AC8J AC8P AFXE AGFE AI2E AI2P ALFE ALFJ ALFP ALGP ALUE ALUP AR8E AREE AROP ASLE ASLF AW2E AW2P AWRE AWRP AX4E AX4J AX4P AXPD AXPE AXPF AXPI AXPJ AXPP AXPS AXVD AXVE AXVF AXVI AXVJ AXVP AXVS AZCE B24E B24P BDBE BDBP BDKJ BFTJ BGWJ BKAJ BLJJ BLJK BLVJ BPED BPEE BPEF BPEI BPEJ BPEP BPES BPGD BPGE BPGF BPGI BPGJ BPGP BPGS BPRD BPRE BPRF BPRI BPRJ BPRP BPRS BR4J BSME BUHJ KHPJ KYGE KYGJ KYGP PEAJ PSAE PSAJ RZWE RZWJ RZWP TCHK U32E U32J U32P U33J U3IE U3IJ U3IP V49E V49J V49P".split(" "));
  function findBytes(u8, str) {
    const pat = Array.from(str, (c) => c.charCodeAt(0));
    outer: for (let i = u8.indexOf(pat[0]); i !== -1 && i <= u8.length - pat.length; i = u8.indexOf(pat[0], i + 1)) {
      for (let j = 1; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }
  function fixSaveChip(u8) {
    if (u8.length < 192 || u8[178] !== 150) return u8;
    const code = ascii(u8, 172, 4);
    if (MGBA_CODES.has(code) || findBytes(u8, "FLASH1M_V") < 0) return u8;
    const out = u8.slice();
    out.set([65, 88, 86, 69], 172);
    let chk = 0;
    for (let i = 160; i < 189; i++) chk = chk + out[i] & 255;
    out[189] = -(chk + 25) & 255;
    return out;
  }

  // src/idb.js
  var idb = /* @__PURE__ */ (() => {
    let p = null;
    function open() {
      if (!p) p = new Promise((res, rej) => {
        let r;
        try {
          r = indexedDB.open("cartucho", 2);
        } catch (e) {
          rej(e);
          return;
        }
        r.onupgradeneeded = () => {
          const d = r.result;
          for (const s of ["roms", "pend", "sync", "covers"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return p;
    }
    async function run(store, mode, fn) {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req ? req.result : void 0);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }
    return {
      get: (s, k) => run(s, "readonly", (st) => st.get(k)).catch(() => void 0),
      put: (s, k, v) => run(s, "readwrite", (st) => st.put(v, k)),
      del: (s, k) => run(s, "readwrite", (st) => st.delete(k)).catch(() => {
      }),
      all: (s) => run(s, "readonly", (st) => st.getAll()).catch(() => [])
    };
  })();

  // src/device.js
  function guessDevice() {
    const ua = navigator.userAgent || "";
    if (/SmartTV|SMART-TV|Tizen|Web0S|webOS|AFT[A-Z]|BRAVIA|GoogleTV|Android TV|\bTV\b/i.test(ua)) return "TV";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua) || /Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "iPad";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Celular" : "Tablet";
    if (/CrOS/.test(ua)) return "Chromebook";
    if (/Windows/.test(ua)) return "PC";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Linux/.test(ua)) return "PC";
    return "Aparelho";
  }
  var device = { name: ls.get("cartucho.device") || guessDevice() };

  // src/cast/tv.js
  var tvScreen = window.__tvScreen = {
    active: false,
    /** @type {string | null} the pairing code shown on screen */
    code: null,
    /** @type {RTCPeerConnection | null} */
    pc: null,
    /** @type {RTCDataChannel | null} control channel */
    dc: null,
    /** @type {(() => void) | null} stops listening for offers */
    stopListen: null,
    /** @type {AudioContext | null} created on the "Usar como tela" tap, so sound is allowed */
    ac: null,
    /** @type {MediaStreamAudioSourceNode | null} */
    audioSrc: null,
    /** @type {ReturnType<typeof setInterval> | null} the diagnostic check */
    watch: null,
    /** @type {any} last report from the phone */
    phoneStats: null,
    gen: 0,
    // bumped on every new connection; loops of an older one stop
    sharp: false,
    // drawing the video into the pixel-sharp canvas
    drawnSharp: 0,
    framesMode: false,
    // "quadros" mode: JPEG frames over the data channel
    drawn: 0,
    padTimer: null,
    /** @type {ReturnType<typeof setInterval> | null} */
    pingTimer: null,
    /** @type {number[]} control channel round trips (ms) */
    rtt: [],
    /** @type {number[]} "quadros" mode: arrival → drawn (ms) */
    decMs: [],
    lastSent: -1
    // last button mask sent to the phone
  };
  async function startScreen() {
    tvScreen.active = true;
    try {
      tvScreen.ac = new (window.AudioContext || window.webkitAudioContext)();
      tvScreen.ac.resume().catch(() => {
      });
    } catch (e) {
      tvScreen.ac = null;
    }
    $("#library").hidden = true;
    $("#screen").hidden = false;
    keepAwake();
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
    }
    tvScreen.code = newPairCode();
    const link = location.origin + location.pathname + "#tela-" + tvScreen.code;
    $("#scrCode").textContent = tvScreen.code.slice(0, 4) + " " + tvScreen.code.slice(4);
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(link);
      qr.make();
      $("#scrQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) {
    }
    showWaiting(true);
    const sig = await signal(tvScreen.code);
    const handled = /* @__PURE__ */ new Set();
    tvScreen.stopListen = sig.listen("oferta", async (msg) => {
      if (!msg.sdp || !msg.id || handled.has(msg.id)) return;
      handled.add(msg.id);
      closeScreenConnection();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      tvScreen.pc = pc;
      $("#scrStatus").textContent = `Conectando com ${msg.from || "o celular"}…`;
      pc.ontrack = (e) => {
        const v = $("#scrVideo"), st = e.streams[0];
        v.muted = true;
        if (v.srcObject !== st) v.srcObject = st;
        try {
          e.receiver.jitterBufferTarget = 30;
        } catch (x) {
        }
        try {
          e.receiver.playoutDelayHint = 0;
        } catch (x) {
        }
        playScreenVideo();
        if (e.track.kind === "audio") {
          const ac = tvScreen.ac;
          if (ac) {
            try {
              if (tvScreen.audioSrc) tvScreen.audioSrc.disconnect();
            } catch (x) {
            }
            tvScreen.audioSrc = ac.createMediaStreamSource(new MediaStream([e.track]));
            tvScreen.audioSrc.connect(ac.destination);
            if (ac.state !== "running") ac.resume().then(() => {
            }, () => {
              $("#scrTap").hidden = false;
            });
            setTimeout(() => {
              if (ac.state !== "running") $("#scrTap").hidden = false;
            }, 1500);
          } else {
            v.muted = false;
            v.play().catch(() => {
              $("#scrTap").hidden = false;
            });
          }
        }
      };
      pc.ondatachannel = (e) => {
        if (e.channel.label === "quadros") {
          receiveFrames(e.channel);
          return;
        }
        tvScreen.dc = e.channel;
        tvScreen.phoneStats = null;
        const hello = () => {
          try {
            e.channel.send(JSON.stringify({ hello: { vp8: !!window.VideoDecoder } }));
          } catch (x) {
          }
        };
        if (e.channel.readyState === "open") hello();
        else e.channel.onopen = hello;
        e.channel.onmessage = (m) => {
          try {
            const d = JSON.parse(m.data);
            if (d && d.st) tvScreen.phoneStats = d.st;
            if (d && d.pong) {
              tvScreen.rtt.push(performance.now() - d.pong);
              if (tvScreen.rtt.length > 10) tvScreen.rtt.shift();
            }
          } catch (x) {
          }
        };
      };
      pc.onconnectionstatechange = () => {
        if (pc !== tvScreen.pc) return;
        if (pc.connectionState === "connected") {
          showWaiting(false);
          playScreenVideo();
          if (!tvScreen.framesMode) drawVideoSharp();
          watchScreen(pc);
        } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          showWaiting(true);
          $("#scrInfo").hidden = true;
          $("#scrStatus").textContent = "O celular desconectou. Esperando de novo…";
        }
      };
      try {
        await pc.setRemoteDescription(msg.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await iceDone(pc);
        await sig.send("resposta", { re: msg.id, sdp: pc.localDescription.toJSON() });
      } catch (e) {
        $("#scrStatus").textContent = "Não deu para conectar. Tente de novo no celular.";
      }
    });
    clearInterval(tvScreen.padTimer);
    let lastBeat = 0;
    const tick = () => {
      if (!tvScreen.active) return;
      requestAnimationFrame(tick);
      const dc = tvScreen.dc;
      if (!dc || dc.readyState !== "open") return;
      const mask = readPad(), now = performance.now();
      if (mask & 128 && $("#scrVideo").paused && $("#scrVideo").srcObject) {
        $("#scrVideo").play().catch(() => {
        });
        $("#scrTap").hidden = true;
      }
      const send = () => {
        try {
          dc.send(String(tvScreen.lastSent));
        } catch (e) {
        }
      };
      if (mask !== tvScreen.lastSent) {
        tvScreen.lastSent = mask;
        send();
        setTimeout(send, 15);
        setTimeout(send, 40);
        lastBeat = now;
      } else if (now - lastBeat > 100) {
        send();
        lastBeat = now;
      }
    };
    requestAnimationFrame(tick);
  }
  var brightnessCanvas = null;
  function brightness(src) {
    try {
      const c = brightnessCanvas || (brightnessCanvas = document.createElement("canvas"));
      c.width = 24;
      c.height = 16;
      const g = c.getContext("2d");
      g.drawImage(src, 0, 0, 24, 16);
      const d = g.getImageData(0, 0, 24, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return Math.round(sum / (d.length / 4) / 3);
    } catch (e) {
      return -1;
    }
  }
  function receiveFrames(channel) {
    const canvas = $("#scrCanvas"), g = canvas.getContext("2d", { alpha: false });
    tvScreen.framesMode = true;
    tvScreen.sharp = false;
    canvas.hidden = false;
    $("#scrVideo").hidden = true;
    channel.binaryType = "arraybuffer";
    let decodeStart = 0;
    function show(img) {
      if (decodeStart) {
        tvScreen.decMs.push(performance.now() - decodeStart);
        if (tvScreen.decMs.length > 20) tvScreen.decMs.shift();
      }
      const w = img.displayWidth || img.width, h = img.displayHeight || img.height;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      g.drawImage(img, 0, 0);
      if (img.close) img.close();
      tvScreen.drawn++;
    }
    function askKeyFrame() {
      if (tvScreen.dc && tvScreen.dc.readyState === "open") {
        try {
          tvScreen.dc.send(JSON.stringify({ key: 1 }));
        } catch (e) {
        }
      }
    }
    let decoder = null;
    let waitingKey = true;
    function vp8Decoder() {
      const d = new window.VideoDecoder({
        output: show,
        error: () => {
          waitingKey = true;
          decoder = null;
          askKeyFrame();
        }
      });
      d.configure({ codec: "vp8", optimizeForLatency: true });
      return d;
    }
    const isJpeg = (bytes) => bytes[0] === 255 && bytes[1] === 216;
    let pending = null, decoding = false;
    async function drawNext() {
      if (decoding || !pending) return;
      const buf = pending;
      pending = null;
      decoding = true;
      decodeStart = performance.now();
      try {
        const key = new Uint8Array(buf, 0, 1)[0] === 1;
        const timestamp = new DataView(buf).getFloat64(1, true);
        const data = new Uint8Array(buf, 9);
        if (isJpeg(data)) {
          show(await createImageBitmap(new Blob([data], { type: "image/jpeg" })));
        } else if (window.VideoDecoder) {
          if (waitingKey && !key) askKeyFrame();
          else {
            if (!decoder) decoder = vp8Decoder();
            waitingKey = false;
            decoder.decode(new window.EncodedVideoChunk({ type: key ? "key" : "delta", timestamp, data }));
          }
        }
      } catch (e) {
        waitingKey = true;
        askKeyFrame();
      }
      decoding = false;
      drawNext();
    }
    channel.onmessage = (m) => {
      pending = m.data;
      drawNext();
    };
    channel.onclose = () => {
      try {
        decoder && decoder.close();
      } catch (e) {
      }
    };
  }
  function drawVideoSharp() {
    const v = $("#scrVideo"), canvas = $("#scrCanvas");
    if (tvScreen.sharp) return;
    const g = canvas.getContext("2d", { alpha: false });
    const started = performance.now();
    tvScreen.sharp = true;
    tvScreen.drawnSharp = 0;
    const gen = tvScreen.gen;
    canvas.hidden = false;
    function frame() {
      if (!tvScreen.active || gen !== tvScreen.gen) {
        if (gen === tvScreen.gen) tvScreen.sharp = false;
        return;
      }
      if (v.readyState >= 2 && v.videoWidth) {
        if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
        }
        try {
          g.drawImage(v, 0, 0, canvas.width, canvas.height);
          tvScreen.drawnSharp++;
        } catch (e) {
        }
      }
      if (tvScreen.drawnSharp === 0 && performance.now() - started > 3e3) {
        canvas.hidden = true;
        tvScreen.sharp = false;
        return;
      }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame);
      else requestAnimationFrame(frame);
    }
    frame();
  }
  function playScreenVideo() {
    const v = $("#scrVideo");
    const p = v.play();
    if (p && p.catch) p.catch(() => {
      $("#scrTap").textContent = "Toque para mostrar o jogo";
      $("#scrTap").hidden = false;
    });
  }
  function watchScreen(pc) {
    const v = $("#scrVideo"), info = $("#scrInfo"), t0 = performance.now();
    let lastDec = -1, still = 0;
    const net = {};
    clearInterval(tvScreen.watch);
    const check = async () => {
      if (pc !== tvScreen.pc || pc.connectionState !== "connected" || !tvScreen.active) {
        clearInterval(tvScreen.watch);
        info.hidden = true;
        return;
      }
      let rx = null;
      let arx = null;
      let pair = null;
      let codec = "", all = /* @__PURE__ */ new Map();
      try {
        const stats = await pc.getStats();
        stats.forEach((x) => {
          all.set(x.id, x);
          if (x.type === "inbound-rtp" && (x.kind || x.mediaType) === "video") rx = x;
          if (x.type === "inbound-rtp" && (x.kind || x.mediaType) === "audio") arx = x;
          if (x.type === "candidate-pair" && x.nominated && x.state === "succeeded") pair = x;
        });
        if (rx && rx.codecId && all.get(rx.codecId)) codec = (all.get(rx.codecId).mimeType || "").replace("video/", "");
      } catch (e) {
      }
      const got = rx ? rx.packetsReceived || 0 : 0, lost = rx ? Math.max(0, rx.packetsLost || 0) : 0;
      const dGot = got - (net.got || 0), dLost = lost - (net.lost || 0);
      net.got = got;
      net.lost = lost;
      const lossPct = dGot + dLost > 0 ? Math.round(100 * dLost / (dGot + dLost)) : 0;
      const rtt = pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1e3) : null;
      const lc = pair && all.get(pair.localCandidateId), rc = pair && all.get(pair.remoteCandidateId);
      const types = lc && rc ? [lc.candidateType, rc.candidateType] : [];
      const path = !types.length ? "?" : types.includes("relay") ? "por um servidor" : types.includes("srflx") ? "pelo IP público do roteador" : "rede local, direto";
      net.bad = lossPct >= 5 ? (net.bad || 0) + 1 : 0;
      if (net.bad === 2 && !net.warned) {
        net.warned = true;
        net.warnPct = lossPct;
        net.warnUntil = performance.now() + 9e3;
      }
      const frames = tvScreen.framesMode;
      const dec = frames ? tvScreen.drawn : rx ? rx.framesDecoded || 0 : 0;
      still = dec === lastDec ? still + 1 : 0;
      lastDec = dec;
      if (tvScreen.dc && tvScreen.dc.readyState === "open") {
        try {
          tvScreen.dc.send(JSON.stringify({ tv: { dec, pk: got, apk: arx ? arx.packetsReceived || 0 : 0 } }));
        } catch (e) {
        }
      }
      const shown = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : "?";
      const bright = frames || tvScreen.sharp ? brightness($("#scrCanvas")) : v.readyState >= 2 ? brightness(v) : -1;
      const box = v.getBoundingClientRect();
      if (v.paused && dec > 0) playScreenVideo();
      let problem = "";
      if (still >= 2) problem = dec === 0 ? "A imagem não está chegando do celular." : "A imagem parou de chegar do celular.";
      else if (!frames && v.paused) problem = "A imagem chega, mas o vídeo está parado. Toque no botão ou aperte A.";
      else if (!frames && v.readyState < 2) problem = "A imagem chega, mas a TV ainda não começou a mostrar.";
      const ph = tvScreen.phoneStats;
      const warnNet = net.warnUntil && performance.now() < net.warnUntil;
      const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
      const ms = (v2) => v2 == null ? "?" : v2 + " ms";
      const ctl = avg(tvScreen.rtt), oneWay = ctl != null ? Math.round(ctl / 2) : null;
      const lat = ph && ph.lat || {};
      let tvMs = null;
      if (frames) tvMs = avg(tvScreen.decMs);
      else if (rx && rx.framesDecoded) {
        const dJb = (rx.jitterBufferDelay || 0) - (net.jbT || 0), dEm = (rx.jitterBufferEmittedCount || 0) - (net.jbN || 0);
        const dDec = (rx.totalDecodeTime || 0) - (net.decT || 0), dFr = rx.framesDecoded - (net.decN || 0);
        net.jbT = rx.jitterBufferDelay || 0;
        net.jbN = rx.jitterBufferEmittedCount || 0;
        net.decT = rx.totalDecodeTime || 0;
        net.decN = rx.framesDecoded;
        if (dEm > 0 && dFr > 0) tvMs = Math.round((dJb / dEm + dDec / dFr) * 1e3);
      }
      const gameFrame = lat.speed ? Math.round(16.7 / Math.min(1, lat.speed / 100)) : 17;
      const parts = [lat.touch, gameFrame, lat.enc, lat.send, oneWay, tvMs];
      const known = parts.filter((x) => x != null);
      const total = known.length ? known.reduce((a, b) => a + b, 0) : null;
      const latencyLine = `Atraso: controle TV→celular ${ms(oneWay)} · toque→jogo ${ms(lat.touch)} · 1 quadro do jogo ${ms(gameFrame)}${lat.speed ? ` (${lat.speed}%)` : ""} · codificar ${ms(lat.enc)} · enviar ${ms(lat.send)} · rede ${ms(oneWay)} · buffer+decodificar na TV ${ms(tvMs)} · total ≈ ${ms(total)} + 1 quadro da TV`;
      const lines = [
        problem || (warnNet ? `Wi-Fi instável: ${net.warnPct}% dos pacotes se perdem. Dica: ligue o roteador do celular e conecte a TV nele.` : "Conectado. Se a imagem não aparecer, mande uma foto desta tela."),
        `Rede: ${path}${rtt != null ? ` · ida e volta ${rtt} ms` : ""} · perda ${lossPct}%${rx && rx.jitter ? ` · variação ${Math.round(rx.jitter * 1e3)} ms` : ""}`,
        latencyLine,
        ph ? `Celular: ${ph.ua || ""} · formato ${ph.mode || "?"} · enviou ${ph.sent} quadros, ${ph.pk || 0} pacotes${ph.w ? ` (${ph.w}x${ph.h})` : ""} · chaves ${ph.keys || 0} · PLI ${ph.pli || 0}${ph.enc ? ` · ${ph.enc}` : ""}${ph.lim && ph.lim !== "none" ? ` · limitado por ${ph.lim}` : ""}${ph.track && ph.track !== "live" ? ` · captura ${ph.track}` : ""}${ph.br != null && ph.br >= 0 ? ` · brilho ${ph.br}` : ""}` : "Celular: sem relatório ainda",
        `TV: ${chromeVer()} · pacotes de vídeo ${got}, de áudio ${arx ? arx.packetsReceived || 0 : 0} · recebeu ${rx ? rx.framesReceived || 0 : 0}, decodificou ${dec}${codec ? ` · ${codec}` : ""}${rx && rx.frameWidth ? ` · ${rx.frameWidth}x${rx.frameHeight}` : ""} · chaves ${rx ? rx.keyFramesDecoded || 0 : 0} · PLI ${rx ? rx.pliCount || 0 : 0}${rx && rx.decoderImplementation ? ` · ${rx.decoderImplementation}` : ""}`,
        frames ? `Quadros pelo canal de dados (${window.VideoDecoder ? "WebCodecs" : "JPEG"}): desenhados ${tvScreen.drawn} · brilho ${bright}` : `Vídeo: ${v.paused ? "parado" : "tocando"} · ${v.videoWidth}x${v.videoHeight} · estado ${v.readyState} · exibidos ${shown} · brilho ${bright} · ${tvScreen.sharp ? "nítido (canvas)" : "vídeo direto"} · na tela ${Math.round(box.width)}x${Math.round(box.height)} de ${innerWidth}x${innerHeight}`
      ];
      info.textContent = lines.join("\n");
      info.hidden = !(problem || warnNet || performance.now() - t0 < 12e3);
    };
    tvScreen.watch = setInterval(check, 2e3);
    tvScreen.pingTimer = setInterval(() => {
      if (tvScreen.dc && tvScreen.dc.readyState === "open") {
        try {
          tvScreen.dc.send(JSON.stringify({ ping: performance.now() }));
        } catch (e) {
        }
      }
    }, 1e3);
    setTimeout(check, 500);
  }
  function showWaiting(on) {
    $("#scrWait").hidden = !on;
    if (on) $("#scrStatus").textContent = "Esperando o celular…";
  }
  function closeScreenConnection() {
    tvScreen.gen = (tvScreen.gen || 0) + 1;
    clearInterval(tvScreen.watch);
    tvScreen.watch = null;
    clearInterval(tvScreen.pingTimer);
    tvScreen.pingTimer = null;
    tvScreen.rtt = [];
    tvScreen.decMs = [];
    if (tvScreen.dc) {
      try {
        tvScreen.dc.onmessage = null;
        tvScreen.dc.close();
      } catch (e) {
      }
      tvScreen.dc = null;
    }
    if (tvScreen.audioSrc) {
      try {
        tvScreen.audioSrc.disconnect();
      } catch (e) {
      }
      tvScreen.audioSrc = null;
    }
    if (tvScreen.pc) {
      const pc = tvScreen.pc;
      tvScreen.pc = null;
      try {
        pc.onconnectionstatechange = null;
        pc.ondatachannel = null;
        pc.ontrack = null;
      } catch (e) {
      }
      try {
        pc.close();
      } catch (e) {
      }
    }
    const v = $("#scrVideo");
    if (v.srcObject) {
      try {
        for (const t of v.srcObject.getTracks()) t.stop();
      } catch (e) {
      }
      v.srcObject = null;
    }
    tvScreen.phoneStats = null;
    tvScreen.lastSent = -1;
    tvScreen.drawn = 0;
    tvScreen.sharp = false;
    tvScreen.framesMode = false;
    $("#scrInfo").hidden = true;
    $("#scrCanvas").hidden = true;
    $("#scrVideo").hidden = false;
  }
  function stopScreen() {
    tvScreen.active = false;
    try {
      tvScreen.stopListen && tvScreen.stopListen();
    } catch (e) {
    }
    closeScreenConnection();
    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch (e) {
    }
    location.reload();
  }
  $("#screenBtn").addEventListener("click", startScreen);
  $("#scrExit").addEventListener("click", stopScreen);
  $("#scrTap").addEventListener("click", () => {
    if (tvScreen.ac) tvScreen.ac.resume().catch(() => {
    });
    else $("#scrVideo").muted = false;
    $("#scrVideo").play().catch(() => {
    });
    $("#scrTap").hidden = true;
  });
  window.addEventListener("keydown", () => {
    if (tvScreen.ac && tvScreen.ac.state !== "running") tvScreen.ac.resume().then(() => {
      $("#scrTap").hidden = true;
    }, () => {
    });
  }, true);
  window.addEventListener("keydown", (e) => {
    if (!tvScreen.active) return;
    const k = KEYMAP[e.key] || KEYCODES[e.keyCode];
    if (!k) return;
    if (k === "B" && !$("#scrWait").hidden) {
      stopScreen();
      return;
    }
    keysDown.add(k);
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    const k = KEYMAP[e.key] || KEYCODES[e.keyCode];
    if (k) keysDown.delete(k);
  });

  // src/cast/common.js
  async function sealJson(key, obj) {
    const raw = utf8.enc(JSON.stringify(obj));
    const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, gz));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return b64(out);
  }
  async function openJson(key, text) {
    const raw = unb64(text.trim());
    const gz = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12)));
    const plain = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    return JSON.parse(utf8.dec(plain));
  }
  async function signal(code) {
    const { topic, key } = await pairMaterial("TELA" + normCode(code));
    return {
      async send(kind, obj) {
        const r = await fetch(`https://ntfy.sh/${topic}-${kind}`, { method: "POST", body: await sealJson(key, obj) });
        if (!r.ok) throw new Error("ntfy " + r.status);
      },
      listen(kind, onMsg) {
        const since = Math.floor(Date.now() / 1e3) - 2;
        const es = new EventSource(`https://ntfy.sh/${topic}-${kind}/sse?since=${since}`);
        const seen = /* @__PURE__ */ new Set();
        es.onmessage = async (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m.event !== "message" || !m.message) return;
            const id = m.id || m.message.slice(0, 40);
            if (seen.has(id)) return;
            seen.add(id);
            onMsg(await openJson(key, m.message));
          } catch (e) {
          }
        };
        return () => es.close();
      }
    };
  }
  function iceDone(pc, ms = 2500) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, ms);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(t);
          res();
        }
      });
    });
  }
  var wakeLock = null;
  async function keepAwake() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      }
    } catch (e) {
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (cast.pc || tvScreen.active)) keepAwake();
  });
  (() => {
    if (!window.AudioNode) return;
    const connect2 = AudioNode.prototype.connect;
    const taps = /* @__PURE__ */ new WeakMap();
    window.__audioTaps = [];
    AudioNode.prototype.connect = function(dest, ...rest) {
      if (window.AudioDestinationNode && dest instanceof AudioDestinationNode) {
        const ctx = dest.context;
        let t = taps.get(ctx);
        if (!t) {
          const local = ctx.createGain();
          connect2.call(local, dest);
          const out = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
          t = { ctx, local, out };
          taps.set(ctx, t);
          window.__audioTaps.push(t);
        }
        if (t.out) connect2.call(this, t.out);
        return connect2.call(this, t.local);
      }
      return connect2.call(this, dest, ...rest);
    };
  })();
  function wakeAudio() {
    for (const t of window.__audioTaps || []) {
      try {
        if (t.ctx.state !== "running") t.ctx.resume().catch(() => {
        });
      } catch (e) {
      }
    }
  }
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, wakeAudio, true);
  function readPad() {
    let pad = null;
    try {
      pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
    } catch (e) {
    }
    const s = {};
    if (pad) {
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), ax = pad.axes || [];
      s.A = b(1);
      s.B = b(0);
      s.X = b(3);
      s.Y = b(2);
      s.L = b(4) || b(6);
      s.R = b(5) || b(7);
      s.SELECT = b(8);
      s.START = b(9);
      s.UP = b(12) || ax[1] < -0.5;
      s.DOWN = b(13) || ax[1] > 0.5;
      s.LEFT = b(14) || ax[0] < -0.5;
      s.RIGHT = b(15) || ax[0] > 0.5;
    }
    for (const k of PAD_BITS) if (keysDown.has(k)) s[k] = true;
    let mask = 0;
    PAD_BITS.forEach((k, i) => {
      if (s[k]) mask |= 1 << i;
    });
    return mask;
  }

  // src/cast/frame-worker.js
  var frameWorkerSource = () => {
    const worker = self;
    let encoder = null, reader = null, running = false, codec = "jpeg";
    let wantKey = true, framesIn = 0, busy2 = false, lastJpegAt = 0;
    const KEY_EVERY = 180;
    const inFlight = /* @__PURE__ */ new Map();
    function send(buffer, key, timestamp) {
      worker.postMessage({ frame: buffer, key, timestamp }, [buffer]);
    }
    async function startVp8(width, height, bitrate) {
      encoder = new worker.VideoEncoder({
        output: (chunk) => {
          const buf = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(buf);
          const started = inFlight.get(chunk.timestamp);
          inFlight.delete(chunk.timestamp);
          worker.postMessage({ frame: buf, key: chunk.type === "key", timestamp: chunk.timestamp, encMs: started ? performance.now() - started : null }, [buf]);
        },
        error: (e) => worker.postMessage({ error: String(e) })
      });
      const config = { codec: "vp8", width, height, bitrate, framerate: 60, latencyMode: "realtime" };
      const ok = await worker.VideoEncoder.isConfigSupported(config);
      if (!ok.supported) throw new Error("vp8 não suportado");
      encoder.configure(config);
    }
    function encodeVp8(frame) {
      if (encoder.encodeQueueSize > 2) {
        frame.close();
        return;
      }
      const key = wantKey || framesIn % KEY_EVERY === 0;
      wantKey = false;
      inFlight.set(frame.timestamp, performance.now());
      encoder.encode(frame, { keyFrame: key });
      frame.close();
    }
    let canvas = null, ctx = null;
    async function encodeJpeg(frame, width, height) {
      const now = performance.now();
      if (busy2 || now - lastJpegAt < 30) {
        frame.close();
        return;
      }
      busy2 = true;
      lastJpegAt = now;
      try {
        if (!canvas) {
          canvas = new OffscreenCanvas(width, height);
          ctx = canvas.getContext("2d", { alpha: false });
        }
        ctx.drawImage(frame, 0, 0, width, height);
        frame.close();
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
        send(await blob.arrayBuffer(), true, 0);
      } catch (e) {
        worker.postMessage({ error: String(e) });
      }
      busy2 = false;
    }
    async function pump(readable, width, height) {
      reader = readable.getReader();
      while (running) {
        const { value: frame, done } = await reader.read();
        if (done || !running) {
          if (frame) frame.close();
          break;
        }
        framesIn++;
        if (codec === "vp8") encodeVp8(frame);
        else await encodeJpeg(frame, width, height);
      }
    }
    worker.onmessage = async ({ data }) => {
      if (data.cmd === "start") {
        running = true;
        codec = data.codec;
        try {
          if (codec === "vp8") await startVp8(data.width, data.height, data.bitrate);
        } catch (e) {
          codec = "jpeg";
          worker.postMessage({ fallback: "jpeg", why: String(e) });
        }
        pump(data.readable, data.width, data.height);
      } else if (data.cmd === "key") {
        wantKey = true;
      } else if (data.cmd === "stop") {
        running = false;
        try {
          reader && reader.cancel();
        } catch (e) {
        }
        try {
          encoder && encoder.close();
        } catch (e) {
        }
        worker.close();
      }
    };
  };

  // src/player/perf.js
  var PERF_KEY = "cartucho.perf";
  var perf = {
    mode: ls.get(PERF_KEY + ".mode") === "light" ? "light" : "auto",
    // auto | light
    learned: ls.get(PERF_KEY + ".learned") === "light"
    // auto mode already decided this device is slow
  };
  if (!ls.get(PERF_KEY + ".mode") && guessDevice() === "TV") perf.learned = true;
  var perfLight = () => perf.mode === "light" || perf.mode === "auto" && perf.learned;
  var perfProfile = () => perfLight() ? "light" : "auto";
  var PROFILES = {
    auto: { frameskip: "auto", threshold: "33", latency: 128, gameMax: 240 },
    light: { frameskip: "auto", threshold: "50", latency: 160, gameMax: 240 }
  };
  function coreOptions() {
    const pr = PROFILES[perfProfile()];
    return {
      "save-save-interval": "0",
      mgba_idle_optimization: "Remove Known",
      mgba_audio_low_pass_filter: "disabled",
      mgba_color_correction: "OFF",
      mgba_interframe_blending: "OFF",
      mgba_frameskip: pr.frameskip,
      mgba_frameskip_threshold: pr.threshold
    };
  }
  function renderPerf() {
    for (const b of $$("#perfModes button")) {
      const on = b.dataset.mode === perf.mode;
      b.classList.toggle("primary", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    $("#perfHint").textContent = perf.mode === "light" ? "Imagem no tamanho do GBA, pula quadros mais cedo e dá mais folga ao som. Para TVs e aparelhos lentos." : perf.learned ? "Este aparelho ficou lento antes, então já usa o modo leve." : "Recomendado. Só pula o desenho de um quadro quando o som ia falhar; se o jogo ficar lento, passa sozinho para o leve.";
  }
  $("#perfModes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    perf.mode = b.dataset.mode;
    ls.set(PERF_KEY + ".mode", perf.mode);
    if (perf.mode !== "auto") {
      perf.learned = false;
      ls.set(PERF_KEY + ".learned", "");
    }
    renderPerf();
  });
  renderPerf();
  var speed = { last: null, samples: [], timer: null, since: 0 };
  function startSpeedMeter() {
    const gm = player.emu && player.emu.gameManager;
    if (!gm) return;
    speed.since = performance.now();
    speed.samples = [];
    speed.last = null;
    clearInterval(speed.timer);
    speed.timer = setInterval(() => {
      let frames;
      try {
        frames = Number(gm.getFrameNum());
      } catch (e) {
        return;
      }
      const now = performance.now();
      if (document.visibilityState !== "visible" || player.emu.paused) {
        speed.last = null;
        return;
      }
      if (speed.last) {
        const pct = (frames - speed.last.f) / ((now - speed.last.t) / 1e3) / 59.73;
        if (pct > 0 && pct < 3) {
          speed.samples.push(pct);
          if (speed.samples.length > 4) speed.samples.shift();
          const avg = speed.samples.reduce((a, b) => a + b, 0) / speed.samples.length;
          speed.pct = avg;
          const tag = $("#pSpeed");
          tag.textContent = Math.round(Math.min(avg, 1) * 100) + "%";
          tag.className = "speed pix " + (avg >= 0.95 ? "ok" : avg >= 0.8 ? "warn" : "bad");
          tag.hidden = false;
          $("#padSpeed").textContent = tag.textContent;
          $("#padSpeed").className = "pad-speed " + tag.className.replace("speed pix", "").trim();
          if (perf.mode === "auto" && !perf.learned && now - speed.since > 8e3 && speed.samples.length >= 3 && avg < 0.92) {
            perf.learned = true;
            ls.set(PERF_KEY + ".learned", "light");
            try {
              gm.setVariable("mgba_frameskip", "auto");
              gm.setVariable("mgba_frameskip_threshold", PROFILES.light.threshold);
            } catch (e) {
            }
            window.dispatchEvent(new Event("resize"));
            toast("O jogo estava lento aqui, então liguei o modo leve neste aparelho.", 4500);
            renderPerf();
          }
        }
      }
      speed.last = { f: frames, t: now };
    }, 2e3);
  }
  var devInput = $("#deviceName");
  devInput.value = device.name;
  devInput.addEventListener("change", () => {
    const v = devInput.value.trim().slice(0, 40);
    device.name = v || guessDevice();
    devInput.value = device.name;
    ls.set("cartucho.device", device.name);
  });

  // src/cast/phone.js
  var cast = window.__cast = {
    /** @type {RTCPeerConnection | null} */
    pc: null,
    /** @type {RTCDataChannel | null} the control channel: TV → phone buttons, phone → TV stats */
    dc: null,
    /** @type {RTCDataChannel | null} "quadros" mode only: JPEG frames phone → TV */
    frameChannel: null,
    /** @type {MediaStream | null} the capture of the emulator canvas */
    stream: null,
    /** @type {string | null} pairing code of the TV */
    code: null,
    /** @type {string | null} code received by link, used once the game is running */
    pending: null,
    /** @type {number[]} order in which the formats of CAST_MODES are tried */
    order: [],
    mode: 0,
    attempt: 0,
    /** @type {any} last report from the TV (frames decoded, packets) */
    tvStats: null,
    /** @type {string | null} */
    paramErr: null,
    /** @type {ReturnType<typeof setInterval> | null} */
    watch: null,
    /** @type {(() => void) | null} stops the frame pump */
    pumpStop: null,
    /** @type {(() => void) | null} asks the encoder for a key frame */
    requestKey: null,
    /** @type {any} what the TV said it can do ({ vp8: boolean }) */
    tvHello: null,
    /** @type {"vp8" | "jpeg" | null} */
    frameCodec: null,
    touchAt: 0,
    pumped: 0,
    // buttons: what is pressed on this phone, what the TV sends, and what the game currently sees
    lastMask: 0,
    localMask: 0,
    remoteMask: 0
  };
  var MIN_HOLD = 70;
  var lag = { touch: [], enc: [] };
  var avgMs = (arr, keep = 20) => {
    if (arr.length > keep) arr.splice(0, arr.length - keep);
    return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  };
  var DIR_MASK = ["UP", "DOWN", "LEFT", "RIGHT"].reduce((m, k) => m | 1 << PAD_BITS.indexOf(k), 0);
  var pressedAt = new Array(PAD_BITS.length).fill(0);
  var releaseTimer = null;
  function applyInput() {
    const gm = player.emu && player.emu.gameManager;
    if (!gm) return;
    const want = (cast.localMask | cast.remoteMask) >>> 0;
    const now = performance.now();
    let applied = cast.lastMask, wait = Infinity;
    PAD_BITS.forEach((k, i) => {
      const bit = 1 << i, w = want & bit, h = applied & bit;
      if (w && !h) {
        try {
          gm.simulateInput(0, PAD[k], 1);
        } catch (e) {
        }
        applied |= bit;
        pressedAt[i] = now;
        if (cast.touchAt) {
          lag.touch.push(now - cast.touchAt);
          cast.touchAt = 0;
        }
      } else if (!w && h) {
        const turning = bit & DIR_MASK && want & DIR_MASK & ~bit;
        const left = turning ? 0 : pressedAt[i] + MIN_HOLD - now;
        if (left <= 0) {
          try {
            gm.simulateInput(0, PAD[k], 0);
          } catch (e) {
          }
          applied &= ~bit;
        } else wait = Math.min(wait, left);
      }
    });
    cast.lastMask = applied;
    clearTimeout(releaseTimer);
    if (wait < Infinity) releaseTimer = setTimeout(applyInput, wait + 1);
  }
  function applyRemote(mask) {
    cast.remoteMask = mask;
    applyInput();
  }
  function setCastUi(state) {
    const b = $("#castBtn");
    b.innerHTML = state === "on" ? '<span class="long">Na </span>TV ●' : state === "wait" ? "Conectando…" : '<span class="long">Jogar na </span>TV';
    b.classList.toggle("primary", state === "on");
  }
  function closeCastConnection() {
    clearInterval(cast.watch);
    cast.watch = null;
    if (cast.pumpStop) {
      try {
        cast.pumpStop();
      } catch (e) {
      }
      cast.pumpStop = null;
    }
    if (cast.frameChannel) {
      try {
        cast.frameChannel.close();
      } catch (e) {
      }
      cast.frameChannel = null;
    }
    if (cast.dc) {
      try {
        cast.dc.onmessage = null;
        cast.dc.close();
      } catch (e) {
      }
      cast.dc = null;
    }
    if (cast.pc) {
      const pc = cast.pc;
      cast.pc = null;
      try {
        pc.onconnectionstatechange = null;
        pc.ondatachannel = null;
        pc.ontrack = null;
      } catch (e) {
      }
      try {
        for (const s of pc.getSenders()) {
          try {
            s.replaceTrack(null);
          } catch (e) {
          }
        }
      } catch (e) {
      }
      try {
        pc.close();
      } catch (e) {
      }
    }
    if (cast.stream) {
      for (const t of cast.stream.getTracks()) t.stop();
      cast.stream = null;
    }
    cast.tvStats = null;
    cast.paramErr = null;
    cast.remoteMask = 0;
    applyInput();
  }
  function stopCast(msg) {
    closeCastConnection();
    cast.localMask = 0;
    applyRemote(0);
    for (const t of window.__audioTaps || []) t.local.gain.value = 1;
    setCastUi("off");
    showPad(false);
    if (window.__castCap) {
      window.__castCap = 0;
      window.dispatchEvent(new Event("resize"));
    }
    if (msg) toast(msg, 3500);
  }
  var CAST_MODES = [
    { name: "VP8", red: true },
    { name: "H.264", plain: true, codecs: [/h264/i, /vp9/i] },
    // TVs decode H.264 in hardware
    // no WebRTC video at all: each frame of the canvas is compressed by the phone and sent
    // over the data channel, and the TV draws it. Slower to encode, but it depends on
    // nothing the two browsers have to agree on.
    { name: "quadros", frames: true }
  ];
  var chromeVer = () => {
    const ua = navigator.userAgent;
    const c = ua.match(/Chrom(?:e|ium)\/(\d+)/), t = ua.match(/Tizen (\d+(?:\.\d+)?)/), w = ua.match(/Web0S|webOS/);
    return (c ? "Chrome " + c[1] : "navegador ?") + (t ? ` (Tizen ${t[1]})` : w ? " (webOS)" : "");
  };
  async function castTo(code, attempt = 0) {
    const emu = player.emu;
    if (!emu || !emu.started || !emu.canvas) {
      cast.pending = code;
      return;
    }
    stopCast();
    setCastUi("wait");
    if (attempt === 0) {
      const saved = Number(ls.get("cartucho.castMode")) || 0;
      cast.order = [saved, ...CAST_MODES.map((m, i) => i).filter((i) => i !== saved)];
    }
    cast.code = code;
    cast.attempt = attempt;
    cast.tvStats = null;
    const level = cast.order[attempt] || 0, mode = CAST_MODES[level];
    cast.mode = level;
    try {
      const sig = await signal(code);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      cast.pc = pc;
      window.__castCap = 1;
      window.dispatchEvent(new Event("resize"));
      await sleep(150);
      const stream = emu.canvas.captureStream(60);
      cast.stream = stream;
      const vtrack = stream.getVideoTracks()[0];
      try {
        vtrack.contentHint = "motion";
      } catch (e) {
      }
      const opt = { red: !!mode.red, kbps: 2500, layers: "", ...window.__castOpts || {} };
      let vt = null;
      if (mode.frames) {
        cast.frameChannel = pc.createDataChannel("quadros", { ordered: false, maxRetransmits: 0 });
        cast.frameChannel.binaryType = "arraybuffer";
      } else {
        if (opt.layers) {
          try {
            vt = pc.addTransceiver(vtrack, { direction: "sendonly", streams: [stream], sendEncodings: [{ scalabilityMode: opt.layers }] });
          } catch (e) {
          }
        }
        if (!vt) vt = pc.addTransceiver(vtrack, { direction: "sendonly", streams: [stream] });
      }
      const prefer = (tr, kind, first) => {
        try {
          const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities(kind);
          if (!caps || !tr.setCodecPreferences) return;
          const head = first.flatMap((re) => caps.codecs.filter((c) => re.test(c.mimeType)));
          tr.setCodecPreferences([...head, ...caps.codecs.filter((c) => !head.includes(c))]);
        } catch (e) {
        }
      };
      const trimExt = (tr) => {
        try {
          if (!tr.getHeaderExtensionsToNegotiate) return;
          const keep = /sdes:mid|transport-wide-cc|abs-send-time/;
          tr.setHeaderExtensionsToNegotiate(tr.getHeaderExtensionsToNegotiate().map((x) => ({ uri: x.uri, direction: keep.test(x.uri) ? x.direction : "stopped" })));
        } catch (e) {
        }
      };
      if (vt && mode.codecs) prefer(vt, "video", mode.codecs);
      else if (vt && !mode.plain) prefer(vt, "video", [/vp8/i]);
      if (vt && mode.plain) trimExt(vt);
      const tap = (window.__audioTaps || [])[0];
      if (tap && tap.out) {
        const at = tap.out.stream.getAudioTracks()[0];
        if (at && mode.plain) pc.addTrack(at, stream);
        else if (at) prefer(pc.addTransceiver(at, { direction: "sendonly", streams: [stream] }), "audio", opt.red ? [/audio\/red/i, /opus/i] : [/opus/i]);
      }
      const dc = pc.createDataChannel("controle", { ordered: false, maxRetransmits: 0 });
      cast.dc = dc;
      dc.onmessage = (e) => {
        const d = String(e.data);
        if (d[0] === "{") {
          try {
            const j = JSON.parse(d);
            if (j.tv) cast.tvStats = j.tv;
            if (j.hello) cast.tvHello = j.hello;
            if (j.key && cast.requestKey) cast.requestKey();
            if (j.ping) {
              try {
                dc.send(JSON.stringify({ pong: j.ping }));
              } catch (x) {
              }
            }
          } catch (x) {
          }
          return;
        }
        const m = Number(d);
        if (!Number.isNaN(m)) applyRemote(m);
      };
      pc.onconnectionstatechange = () => {
        if (pc !== cast.pc) return;
        if (pc.connectionState === "connected") {
          setCastUi("on");
          keepAwake();
          showPad(true);
          wakeAudio();
          for (const t of window.__audioTaps || []) t.local.gain.value = 0;
          if (attempt === 0) toast("Jogando na TV. Este celular agora é o controle.", 3500);
          if (vt) {
            const send = vt.sender, p = send.getParameters();
            p.encodings = (p.encodings && p.encodings.length ? p.encodings : [{}]).map((e) => ({ ...e, maxBitrate: opt.kbps * 1e3, maxFramerate: 60, scaleResolutionDownBy: 1, priority: "high", networkPriority: "high" }));
            p.degradationPreference = "maintain-framerate";
            send.setParameters(p).catch((e) => {
              cast.paramErr = String(e);
            });
          } else startFramePump(vtrack, cast.frameChannel);
          watchCast(pc, vt ? vt.sender : null, dc, emu);
        } else if (pc.connectionState === "failed") stopCast("Não deu para conectar com a TV. Os dois aparelhos estão na mesma rede Wi-Fi?");
        else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
          if (cast.pc === pc) stopCast("A TV desconectou.");
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await iceDone(pc);
      const offerId = rid();
      const stopListen = sig.listen("resposta", async (msg) => {
        if (!msg.sdp || msg.re !== offerId || pc !== cast.pc || pc.signalingState !== "have-local-offer") return;
        stopListen();
        try {
          await pc.setRemoteDescription(msg.sdp);
        } catch (e) {
          stopCast("A TV respondeu de um jeito inesperado. Tente de novo.");
        }
      });
      await sig.send("oferta", { id: offerId, sdp: pc.localDescription.toJSON(), from: device.name });
      setTimeout(() => {
        if (pc === cast.pc && pc.connectionState !== "connected") {
          stopListen();
          stopCast("A TV não respondeu. Confira o código e se ela está na tela de espera.");
        }
      }, 25e3);
    } catch (e) {
      stopCast("Não deu para começar a transmissão.");
    }
  }
  var FRAME_HEADER = 9;
  function packFrame(buffer, key, timestamp) {
    const out = new Uint8Array(FRAME_HEADER + buffer.byteLength);
    out[0] = key ? 1 : 0;
    new DataView(out.buffer).setFloat64(1, timestamp, true);
    out.set(new Uint8Array(buffer), FRAME_HEADER);
    return out.buffer;
  }
  async function startFramePump(track, dc) {
    cast.pumped = 0;
    const hello = await waitForTvHello(1500);
    const canVp8 = !!(window.MediaStreamTrackProcessor && window.VideoEncoder && hello && hello.vp8);
    cast.frameCodec = canVp8 ? "vp8" : "jpeg";
    if (!window.MediaStreamTrackProcessor) {
      await legacyJpegPump(track, dc);
      return;
    }
    const readable = new MediaStreamTrackProcessor({ track }).readable;
    const source = `(${frameWorkerSource.toString()})();`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    worker.onmessage = ({ data }) => {
      if (data.frame) {
        if (dc.readyState !== "open" || dc.bufferedAmount > 2e5) return;
        try {
          dc.send(packFrame(data.frame, data.key, data.timestamp));
          cast.pumped++;
        } catch (e) {
        }
      } else if (data.fallback) cast.frameCodec = data.fallback;
      if (data.encMs != null) lag.enc.push(data.encMs);
    };
    const emu = player.emu || {};
    worker.postMessage({ cmd: "start", readable, codec: cast.frameCodec, width: emu.streamW || STREAM_W, height: emu.streamH || STREAM_H, bitrate: 12e5 }, [readable]);
    cast.requestKey = () => worker.postMessage({ cmd: "key" });
    cast.pumpStop = () => {
      worker.postMessage({ cmd: "stop" });
      cast.requestKey = null;
    };
  }
  function waitForTvHello(ms) {
    return new Promise((resolve) => {
      const started = performance.now();
      const poll = () => {
        if (cast.tvHello) resolve(cast.tvHello);
        else if (performance.now() - started > ms || !cast.pc) resolve(null);
        else setTimeout(poll, 50);
      };
      poll();
    });
  }
  async function legacyJpegPump(track, dc) {
    const emu = player.emu || {}, sw = emu.streamW || STREAM_W, sh = emu.streamH || STREAM_H;
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const g = off.getContext("2d", { alpha: false });
    const grab = new ImageCapture(track);
    let on = true;
    cast.pumpStop = () => {
      on = false;
    };
    while (on && track.readyState === "live") {
      try {
        const bmp = await grab.grabFrame();
        g.drawImage(bmp, 0, 0, sw, sh);
        const blob = await new Promise((r) => off.toBlob(r, "image/jpeg", 0.85));
        if (blob && dc.readyState === "open" && dc.bufferedAmount < 2e5) {
          dc.send(packFrame(await blob.arrayBuffer(), true, 0));
          cast.pumped++;
        }
      } catch (e) {
      }
      await sleep(33);
    }
  }
  function watchCast(pc, sender, dc, emu) {
    let last = -1, still = 0, recaptured = !sender, checks = 0, worked = false;
    clearInterval(cast.watch);
    cast.watch = setInterval(async () => {
      if (pc !== cast.pc || pc.connectionState !== "connected") {
        clearInterval(cast.watch);
        return;
      }
      let tx = null, codec = "";
      try {
        const stats = await pc.getStats(), all = /* @__PURE__ */ new Map();
        stats.forEach((x) => {
          all.set(x.id, x);
          if (x.type === "outbound-rtp" && (x.kind || x.mediaType) === "video") tx = x;
        });
        if (tx && all.get(tx.codecId)) codec = (all.get(tx.codecId).mimeType || "").replace("video/", "");
      } catch (e) {
      }
      const tr = sender ? sender.track : cast.stream && cast.stream.getVideoTracks()[0];
      let br = -1;
      if (tr && window.ImageCapture) {
        try {
          const bmp = await Promise.race([new ImageCapture(tr).grabFrame(), sleep(600).then(() => null)]);
          if (bmp) {
            br = brightness(bmp);
            bmp.close && bmp.close();
          }
        } catch (e) {
        }
      }
      const encMs = tx && tx.framesEncoded ? Math.round(((tx.totalEncodeTime || 0) - (lag.encT || 0)) / Math.max(1, tx.framesEncoded - (lag.encN || 0)) * 1e3) : avgMs(lag.enc);
      if (tx) {
        lag.encT = tx.totalEncodeTime || 0;
        lag.encN = tx.framesEncoded || 0;
      }
      const sendMs = tx && tx.packetsSent ? Math.round((tx.totalPacketSendDelay || 0) / tx.packetsSent * 1e3) : null;
      const speedPct = speed.pct ? Math.round(speed.pct * 100) : null;
      const st = {
        lat: { touch: avgMs(lag.touch), enc: encMs, send: sendMs, speed: speedPct },
        br,
        ua: chromeVer(),
        mode: `${CAST_MODES[cast.mode].name}${codec ? ` = ${codec}` : cast.frameCodec ? ` = ${cast.frameCodec === "vp8" ? "VP8 WebCodecs" : "JPEG"}` : ""} (${cast.attempt + 1}/${CAST_MODES.length})`,
        enc: tx && tx.encoderImplementation || "",
        keys: tx ? tx.keyFramesEncoded || 0 : 0,
        pli: tx ? tx.pliCount || 0 : 0,
        pk: tx ? tx.packetsSent || 0 : 0,
        sent: tx ? tx.framesSent || 0 : cast.pumped || 0,
        w: tx && tx.frameWidth || 0,
        h: tx && tx.frameHeight || 0,
        lim: tx && tx.qualityLimitationReason || "",
        cw: emu.canvas ? emu.canvas.width : 0,
        ch: emu.canvas ? emu.canvas.height : 0,
        track: tr ? tr.readyState + (tr.muted ? " (sem quadros)" : "") : "sem trilha"
      };
      if (dc.readyState === "open") {
        try {
          dc.send(JSON.stringify({ st }));
        } catch (e) {
        }
      }
      checks++;
      const tv = cast.tvStats;
      if (tv && tv.dec > 0 && !worked) {
        worked = true;
        ls.set("cartucho.castMode", String(cast.mode));
      }
      if (!worked && tv && checks >= 4 && st.sent > 60 && tv.dec === 0) {
        clearInterval(cast.watch);
        if (cast.attempt + 1 < CAST_MODES.length) {
          toast(`A TV não está recebendo a imagem. Tentando outro formato (${cast.attempt + 2}/${CAST_MODES.length})…`, 4e3);
          castTo(cast.code, cast.attempt + 1);
        } else toast("A TV não conseguiu receber a imagem em nenhum formato. Mande uma foto do diagnóstico que aparece na TV.", 8e3);
        return;
      }
      if (emu.paused) {
        still = 0;
        last = st.sent;
        return;
      }
      still = st.sent === last ? still + 1 : 0;
      last = st.sent;
      if (still === 2 && !recaptured) {
        recaptured = true;
        try {
          const ns = emu.canvas.captureStream(60), nt = ns.getVideoTracks()[0];
          try {
            nt.contentHint = "motion";
          } catch (e) {
          }
          await sender.replaceTrack(nt);
          if (cast.stream) for (const t of cast.stream.getVideoTracks()) t.stop();
          cast.stream = ns;
        } catch (e) {
        }
      }
      if (still === 4) toast(`A imagem não está saindo deste celular (${st.sent} quadros enviados). Toque em "TV" para sair e conecte de novo.`, 6e3);
    }, 2e3);
  }

  // src/ui/pickers.js
  function pickRom() {
    const i = $("#romInput");
    i.value = "";
    i.click();
  }
  var savTarget = null;
  function pickSav(key, meta) {
    savTarget = { key, meta };
    const i = $("#savInput");
    i.value = "";
    i.click();
  }
  $("#addRomBtn").addEventListener("click", pickRom);
  $("#romInput").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      let bytes = new Uint8Array(await f.arrayBuffer());
      let name = f.name;
      if (/\.zip$/i.test(name) || bytes[0] === 80 && bytes[1] === 75) {
        const inner = await unzipRom(bytes, /\.(gba|gbc|gb|nds)$/i);
        if (!inner) {
          toast("Não achei uma ROM de GBA, GB ou DS dentro desse .zip.");
          return;
        }
        bytes = inner.bytes;
        name = inner.name.split("/").pop();
      }
      const info = parseRom(bytes, name);
      if (!info) {
        toast("Esse arquivo não parece uma ROM de GBA, GB ou DS.");
        return;
      }
      const ext = info.system === "gba" || info.system === "nds" ? info.system : /\.gbc$/i.test(name) ? "gbc" : "gb";
      const id = await identifyRom(bytes, info, name).catch(() => ({ title: info.title, cover: null }));
      await idb.put("roms", info.key, { ...info, title: id.title, cover: id.cover, ident: true, ext, fileName: name, size: bytes.length, addedAt: Date.now(), blob: new Blob([bytes]) });
      await loadRoms();
      render();
      toast(cloud.docs.has(info.key) ? `${gameInfo(info.key).title}: o save da nuvem já está pronto` : `${gameInfo(info.key).title} adicionado`);
      if (cloud.assets && cloud.db && !cloud.roms.has(info.key)) uploadRom(roms.get(info.key));
    } catch (err) {
      toast("Não consegui ler esse arquivo.");
    }
  });
  $("#savInput").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f || !savTarget) return;
    const { key, meta } = savTarget;
    savTarget = null;
    try {
      const sav = new Uint8Array(await f.arrayBuffer());
      const maxSav = meta && meta.system === "nds" ? 33 * 1024 * 1024 : 160 * 1024;
      if (!sav.length || sav.length > maxSav) {
        toast("Esse arquivo não parece um save desse jogo (tamanho estranho).");
        return;
      }
      const existing = cloud.docs.get(key);
      if (existing) {
        const ok = await dialog(
          "Trocar o save da nuvem?",
          `O save atual (de ${ago(existing.at)}) vira a versão anterior, e dá para voltar nele depois.`,
          [{ label: "Trocar pelo arquivo", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
        );
        if (!ok) return;
      }
      const doc = await writeCloud(key, meta, sav, await sha(sav));
      await idb.del("pend", key);
      await idb.put("sync", key, { lastSha: doc.sha, baseRev: doc.rev });
      toast("Save enviado para a nuvem");
    } catch (err) {
      toast("Não deu para enviar o save agora. Tente de novo.");
    }
  });

  // src/ui/rename-cover.js
  async function setGameMeta(key, patch) {
    const rom = roms.get(key);
    if (rom) {
      const upd = { ...rom, ...patch, ident: true };
      await idb.put("roms", key, upd).catch(() => {
      });
      roms.set(key, upd);
    }
    if (cloud.db) {
      try {
        await updateIndex((d) => {
          d.games[key] = { ...d.games[key] || {}, ...patch };
        }, `Biblioteca: ${patch.title || gameInfo(key).title}`);
      } catch (e) {
        toast("Mudou neste aparelho, mas não deu para salvar na nuvem agora.");
      }
    } else if (cloud.index && cloud.index.games && cloud.index.games[key]) Object.assign(cloud.index.games[key], patch);
    render();
  }
  function renameGame(key) {
    const g = gameInfo(key), root = $("#dialogRoot");
    const input = el("input", { id: "renameInput", class: "rename-input", type: "text", maxlength: "60", value: g.title, autocomplete: "off" });
    const close = () => root.replaceChildren();
    root.replaceChildren(el("div", { class: "scrim" }, el(
      "form",
      { class: "dialog", onsubmit: (e) => {
        e.preventDefault();
        const t = input.value.trim().replace(/\s+/g, " ");
        if (!t) {
          input.focus();
          return;
        }
        close();
        setGameMeta(key, { title: t, titleSet: true }).then(() => toast("Nome atualizado"));
      } },
      el("h2", {}, "Renomear"),
      input,
      el("button", { class: "btn primary", type: "submit" }, "Salvar nome"),
      el("button", { class: "btn", type: "button", onclick: close }, "Cancelar")
    )));
    input.focus();
    input.select();
  }
  var coverTarget = null;
  function pickCover(key) {
    coverTarget = key;
    const i = $("#coverInput");
    i.value = "";
    i.click();
  }
  async function squareJpeg(file, size = 400) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(bmp.width, bmp.height), c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
  }
  $("#coverInput").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0], key = coverTarget;
    coverTarget = null;
    if (!f || !key) return;
    try {
      const blob = await squareJpeg(f), rev = rid();
      await idb.put("covers", key, { rev, blob });
      if (cloud.db) await putBinary("covers/" + key + ".jpg", new Uint8Array(await blob.arrayBuffer()), "Capa", "image/jpeg");
      await setGameMeta(key, { cover: "custom", coverRev: rev });
      toast("Capa trocada");
    } catch (err) {
      toast("Não deu para usar essa imagem.");
    }
  });

  // src/ui/sheets.js
  var sheetKey = null;
  function openSheet(id) {
    $("#sheetScrim").hidden = false;
    for (const sh of $$(".sheet")) sh.hidden = sh.id !== id;
    const first = $("#" + id).querySelector("button");
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeSheets() {
    sheetKey = null;
    $("#sheetScrim").hidden = true;
    for (const sh of $$(".sheet")) sh.hidden = true;
  }
  $("#sheetScrim").addEventListener("click", closeSheets);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheetScrim").hidden) closeSheets();
  });
  $("#accountBtn").addEventListener("click", () => openSheet("settingsSheet"));
  $("#settingsClose").addEventListener("click", closeSheets);
  var ICONS = {
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 11v6M9.5 13.5 12 11l2.5 2.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 10 4 4M21 10l-4 4"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    restart: '<path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 1-8.5L4 10"/>'
  };
  function sheetAction(icon, label, fn, danger) {
    const b = el("button", { class: "gs-action" + (danger ? " danger" : ""), type: "button", onclick: fn });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = ICONS[icon];
    b.append(svg, el("span", {}, label));
    return b;
  }
  function openGameSheet(key) {
    sheetKey = key;
    fillGameSheet(key);
    openSheet("gameSheet");
  }
  function fillGameSheet(key) {
    const g = gameInfo(key), sh = $("#gameSheet");
    const status = el(
      "div",
      { class: "gs-status" },
      el("div", { class: "sync-line" }, g.save ? [el("span", { class: "dot ok" }), `Save na nuvem ${ago(g.save.at)}, do ${g.save.device || "outro aparelho"}`] : cloud.db ? [el("span", { class: "dot" }), "Ainda sem save na nuvem"] : [el("span", { class: "dot warn" }), "Save só neste aparelho"]),
      el("div", { class: "sync-line" }, g.crom ? [el("span", { class: "dot ok" }), "ROM na nuvem, abre em qualquer aparelho"] : g.rom ? [el("span", { class: "dot" }), cloud.db ? "ROM só neste aparelho" : "ROM neste aparelho"] : [el("span", { class: "dot warn" }), "A ROM não está neste aparelho"])
    );
    const working = busy.get(key);
    const playBtn = working ? el("button", { class: "btn primary", type: "button", disabled: true }, working) : g.playable ? el("button", { class: "btn primary", type: "button", onclick: () => {
      closeSheets();
      play(key);
    } }, g.save ? "Continuar" : "Jogar") : el("button", { class: "btn primary", type: "button", onclick: () => {
      closeSheets();
      pickRom();
    } }, "Adicionar a ROM neste aparelho");
    const acts = el("div", { class: "gs-actions" });
    if (g.rom && !g.crom && cloud.db && !working) acts.append(sheetAction("cloud", `Guardar a ROM no ${cloudName()}`, () => uploadRom(g.rom)));
    acts.append(sheetAction("image", "Trocar capa", () => pickCover(key)));
    acts.append(sheetAction("edit", "Renomear", () => renameGame(key)));
    if (cloud.db) acts.append(sheetAction("upload", "Enviar arquivo .sav", () => pickSav(key, { title: g.title, system: g.system, code: g.code })));
    if (g.save) acts.append(sheetAction("download", "Baixar o save", () => downloadSave(g.save)));
    if (g.save && g.save.prev) acts.append(sheetAction("back", "Voltar à versão anterior do save", () => confirmRestore(key, g.save)));
    if (g.rom && !g.crom) acts.append(sheetAction("trash", "Tirar a ROM deste aparelho", () => confirmRemoveRom(key, g.title), true));
    sh.replaceChildren(
      el("div", { class: "sheet-grip", "aria-hidden": "true" }),
      el(
        "div",
        { class: "sheet-body" },
        el("div", { class: "gs-head" }, coverEl(g), el("div", {}, el("h2", { class: "gs-title", id: "gsTitle" }, g.title), el("p", { class: "gs-sub" }, [g.sys, g.code].filter(Boolean).join(" · ")))),
        el("div", { class: "gs-play" }, playBtn),
        status,
        acts
      )
    );
  }

  // src/ui/screens.js
  var localOnly = () => ls.get("cartucho.localOnly") === "1";
  function showWelcome() {
    closeSheets();
    ls.set("cartucho.localOnly", "");
    $("#connect").hidden = false;
    $("#home").hidden = true;
    $("#notice").hidden = true;
    if (typeof showConnect === "function") showConnect();
  }
  function render() {
    if (!cloud.ready) return;
    const welcome = !cloud.auth && !localOnly();
    $("#connect").hidden = !welcome;
    $("#home").hidden = welcome;
    $("#accountBtn").hidden = welcome;
    const letter = cloud.auth && cloud.auth.email ? cloud.auth.email[0].toUpperCase() : cloud.auth && cloud.auth.owner ? cloud.auth.owner[0].toUpperCase() : "?";
    $("#avatarLetter").textContent = letter;
    $("#connText").textContent = isGoogle() ? cloud.db ? `Google Drive${cloud.auth.email ? ": " + cloud.auth.email : ""}` : "Google Drive: reconecte para sincronizar" : cloud.db ? `GitHub: ${cloud.auth.owner}/${cloud.auth.repo}` : cloud.auth ? "GitHub indisponível agora" : "Sem conta: os jogos ficam só neste aparelho.";
    $("#pairOtherBtn").hidden = !cloud.db || isGoogle();
    $("#disconnectBtn").hidden = !cloud.auth;
    $("#connectBtn").hidden = !!cloud.auth;
    const n = $("#notice");
    if (n.dataset.sticky !== "1") {
      if (!welcome && !cloud.auth && googleAvailable()) {
        n.className = "notice";
        n.hidden = false;
        n.replaceChildren(el("span", {}, "Seus jogos estão só neste aparelho. "), el("button", { class: "btn small", type: "button", onclick: showWelcome }, "Entrar com Google"));
      } else n.hidden = true;
    }
    if (welcome) return;
    const keys = /* @__PURE__ */ new Set([...roms.keys(), ...cloud.docs.keys(), ...cloud.roms.keys()]);
    const games = [...keys].map(gameInfo).sort((a, b) => (b.save && b.save.at || 0) - (a.save && a.save.at || 0) || a.title.localeCompare(b.title, "pt"));
    const recent = games.find((g) => g.save && g.playable);
    if (recent) continueHero(recent);
    else $("#continue").hidden = true;
    const box = $("#games");
    box.replaceChildren();
    $("#empty").hidden = games.length > 0;
    box.hidden = games.length === 0;
    for (const g of games) box.append(tile(g));
    if (games.length) box.append(addTile());
    if (sheetKey) fillGameSheet(sheetKey);
  }

  // src/ui/dialogs.js
  function dialog(title, text, buttons) {
    return new Promise((resolve) => {
      const root = $("#dialogRoot");
      const close = (v) => {
        root.replaceChildren();
        resolve(v);
      };
      const box = el(
        "div",
        { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
        el("h2", {}, title),
        text ? el("p", {}, text) : null,
        ...buttons.map((b) => el(
          "button",
          { class: "btn " + (b.cls || "") + (b.sub ? " choice" : ""), type: "button", onclick: () => close(b.value) },
          b.label,
          b.sub ? el("small", {}, b.sub) : null
        ))
      );
      root.replaceChildren(el("div", { class: "scrim", onclick: (e) => {
        if (e.target === e.currentTarget) close(null);
      } }, box));
      const first = box.querySelector("button");
      if (first) first.focus();
    });
  }
  async function confirmRestore(key, save) {
    const p = save.prev;
    const ok = await dialog(
      "Voltar à versão anterior?",
      `A versão anterior é de ${ago(p.at)} (${p.device || "outro aparelho"}). A versão atual vira a anterior, então dá para desfazer.`,
      [{ label: "Voltar à anterior", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
    );
    if (!ok) return;
    try {
      const sav = await unpack(p);
      const doc = await writeCloud(key, { title: save.title, system: save.system, code: save.code }, sav, p.sha || await sha(sav));
      await idb.del("pend", key);
      await idb.put("sync", key, { lastSha: doc.sha, baseRev: doc.rev });
      toast("Versão anterior restaurada");
    } catch (e) {
      toast("Não deu para restaurar agora. Tente de novo.");
    }
  }
  async function confirmRemoveRom(key, title) {
    const ok = await dialog(
      `Tirar ${title} deste aparelho?`,
      "A ROM sai só daqui. O save na nuvem continua lá.",
      [{ label: "Tirar ROM", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
    );
    if (!ok) return;
    await idb.del("roms", key);
    await loadRoms();
    render();
  }
  async function downloadSave(save) {
    try {
      const sav = await unpack(save);
      const name = (save.title || save.game).replace(/[^\w\- ]+/g, "").trim() || "save";
      const url = URL.createObjectURL(new Blob([sav], { type: "application/octet-stream" }));
      const a = el("a", { href: url, download: name + ".sav" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
    } catch (e) {
      toast("Não deu para baixar o save aqui.");
    }
  }

  // src/diag.js
  var DIAG_STEPS = [
    { id: "pad", label: "Controle na tela, horizontal", pad: "h" },
    { id: "padv", label: "Controle na tela, vertical", pad: "v" },
    { id: "padrich", label: "Controle com sombras suaves (visual anterior)", pad: "h", rich: true },
    { id: "touch", label: "Controle + dedos se mexendo", pad: "h", touch: true },
    { id: "local", label: "Jogando no próprio celular, com o controle na tela", local: true, touch: true },
    { id: "cast", label: "Transmissão de vídeo e som (sem rede)", cast: true },
    { id: "all", label: "Tudo junto", pad: "h", touch: true, cast: true },
    { id: "recast", label: "Depois de ligar e desligar a transmissão 3 vezes", recast: 3 }
  ];
  var diag = window.__diag = { running: false, done: false, results: [], bases: [], only: null };
  var GBA_FPS = 59.7275;
  function diagShow(html) {
    $("#diagBody").innerHTML = html;
  }
  var median = (xs) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  function diagRow(r) {
    const pct = Math.round(r.fps / GBA_FPS * 100);
    if (r.rel == null) return `<tr><td>${r.label}</td><td class="num">${pct}%</td><td class="num">referência</td></tr>`;
    const rel = Math.round(r.rel * 100);
    const cls = rel >= 92 ? "ok" : rel >= 80 ? "warn" : "bad";
    return `<tr><td>${r.label}</td><td class="num">${pct}%</td><td class="num ${cls}">${rel >= 100 ? "sem perda" : "−" + (100 - rel) + "%"}</td></tr>`;
  }
  function diagTable() {
    return `<table class="diag-table"><thead><tr><th>Situação</th><th class="num">Capacidade</th><th class="num">Custo</th></tr></thead><tbody>${diag.results.map(diagRow).join("")}</tbody></table>`;
  }
  function diagReport() {
    const lines = diag.results.map((r) => `${r.label}: ${Math.round(r.fps / GBA_FPS * 100)}%${r.rel != null ? ` (${Math.round(r.rel * 100)}% do normal)` : ""}`);
    return [
      "Cartuchin, teste de velocidade",
      (/* @__PURE__ */ new Date()).toLocaleString("pt-BR"),
      `Aparelho: ${device.name} · ${navigator.userAgent}`,
      `Núcleos: ${navigator.hardwareConcurrency || "?"} · Tela: ${screen.width}x${screen.height} @${window.devicePixelRatio || 1}x`,
      `Desempenho: ${perf.mode}${perf.learned ? " (aprendeu modo leve)" : ""} · Controle: ${ls.get("cartucho.pad.orient") || "h"}`,
      `Medidas do emulador sozinho, em ordem: ${diag.bases.map((b) => Math.round(b / GBA_FPS * 100) + "%").join(", ")}`,
      "",
      ...lines
    ].join("\n");
  }
  function diagTouches() {
    let t = 0, down = false;
    const fire = (type, x, y, id) => $("#pad").dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 31 }));
    const timer = setInterval(() => {
      const geo = padGeometry(), d = geo.find((g) => g.id === "dpad"), a = geo.find((g) => g.id === "A");
      if (!d || !a) return;
      const r = (d.r - d.l) * 0.35, x = d.cx + Math.cos(t / 6) * r, y = d.cy + Math.sin(t / 6) * r;
      if (!down) {
        fire("pointerdown", x, y, 31);
        down = true;
      } else fire("pointermove", x, y, 31);
      if (t % 12 === 0) fire("pointerdown", a.cx, a.cy, 32);
      if (t % 12 === 6) fire("pointerup", a.cx, a.cy, 32);
      t++;
    }, 8);
    return () => {
      clearInterval(timer);
      if (down) fire("pointerup", 0, 0, 31);
      fire("pointerup", 0, 0, 32);
    };
  }
  async function diagLoopback(emu) {
    window.__castCap = 1;
    window.dispatchEvent(new Event("resize"));
    await sleep(200);
    const a = new RTCPeerConnection(), b = new RTCPeerConnection();
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {
    });
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {
    });
    const stream = emu.canvas.captureStream(60);
    a.addTrack(stream.getVideoTracks()[0], stream);
    const tap = (window.__audioTaps || [])[0];
    if (tap && tap.out) {
      const at = tap.out.stream.getAudioTracks()[0];
      if (at) a.addTrack(at, stream);
    }
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    b.ontrack = (e) => {
      v.srcObject = e.streams[0];
      v.play().catch(() => {
      });
    };
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    return () => {
      try {
        a.close();
        b.close();
      } catch (e) {
      }
      for (const t of stream.getVideoTracks()) t.stop();
      v.srcObject = null;
      window.__castCap = 0;
      window.dispatchEvent(new Event("resize"));
    };
  }
  async function runDiagnostic() {
    if (diag.running) return;
    diag.running = true;
    diag.done = false;
    diag.results = [];
    $("#library").hidden = true;
    $("#player").hidden = false;
    $("#diag").hidden = false;
    $("#pName").textContent = "Teste de velocidade";
    diagShow("<p>Carregando o emulador…</p>");
    keepAwake();
    let bytes;
    try {
      bytes = new Uint8Array(await (await fetch("bench.gba")).arrayBuffer());
    } catch (e) {
      diagShow("<p>Não deu para baixar o programa de teste. Confira a internet.</p>");
      diag.running = false;
      return;
    }
    const emu = await createEmulator(new File([bytes], "bench.gba"), "cartuchin-bench", { ...coreOptions(), mgba_frameskip: "disabled" });
    if (!emu) {
      diagShow("<p>Não deu para carregar o emulador.</p>");
      diag.running = false;
      return;
    }
    player.emu = emu;
    await new Promise((res) => emu.on("start", res));
    await sleep(1500);
    const gm = emu.gameManager;
    try {
      gm.setFastForwardRatio(0);
      gm.toggleFastForward(1);
    } catch (e) {
    }
    diagShow("<p>Aquecendo o emulador…</p>");
    await sleep(5e3);
    const measure = async () => {
      const windows = [];
      for (let w = 0; w < 3; w++) {
        const f0 = Number(gm.getFrameNum()), t0 = performance.now();
        await sleep(1300);
        windows.push((Number(gm.getFrameNum()) - f0) / ((performance.now() - t0) / 1e3));
      }
      return median(windows);
    };
    diag.bases = [await measure()];
    diag.results = [{ id: "base", label: "Só o emulador", fps: diag.bases[0] }];
    const steps = diag.only ? DIAG_STEPS.filter((st) => diag.only.includes(st.id)) : DIAG_STEPS;
    for (const [i, step] of steps.entries()) {
      diagShow(`<p class="diag-now">Medindo ${i + 1} de ${steps.length}: <b>${step.label}</b></p>${diagTable()}`);
      const undo = [];
      if (step.pad) {
        padState.forceOrient = step.pad;
        $("#pad").classList.toggle("rich", !!step.rich);
        showPad(true);
        undo.push(() => {
          showPad(false);
          $("#pad").classList.remove("rich");
          padState.forceOrient = null;
        });
      }
      if (step.local) {
        padState.forceLocal = true;
        showPad(false);
        undo.push(() => {
          padState.forceLocal = false;
          showPad(false);
        });
      }
      if (step.touch) {
        await sleep(100);
        undo.push(diagTouches());
      }
      if (step.cast) {
        try {
          undo.push(await diagLoopback(emu));
        } catch (e) {
        }
      }
      for (let k = 0; k < (step.recast || 0); k++) {
        try {
          const stop = await diagLoopback(emu);
          await sleep(700);
          stop();
          await sleep(200);
        } catch (e) {
        }
      }
      await sleep(1e3);
      const fps = await measure();
      for (const u of undo.reverse()) try {
        u();
      } catch (e) {
      }
      await sleep(500);
      const after = await measure();
      const before = diag.bases[diag.bases.length - 1];
      diag.bases.push(after);
      diag.results.push({ id: step.id, label: step.label, fps, rel: fps / ((before + after) / 2) });
      diag.results[0].fps = median(diag.bases);
    }
    try {
      gm.toggleFastForward(0);
    } catch (e) {
    }
    diag.running = false;
    diag.done = true;
    const base = diag.results[0].fps;
    const worst = diag.results.filter((r) => r.rel != null).reduce((w, r) => r.rel < w.rel ? r : w, { rel: Infinity });
    const verdict = Math.round(base / GBA_FPS * 100) < 100 ? `Este aparelho emula no máximo ${Math.round(base / GBA_FPS * 100)}% da velocidade de um GBA no pior caso, então jogos pesados vão ficar lentos aqui mesmo sem nada a mais.` : worst.rel < 0.85 ? `O que mais pesa neste aparelho: <b>${worst.label}</b>.` : "Nenhum recurso extra pesa de forma relevante neste aparelho.";
    diagShow(`<p class="diag-now">${verdict}</p>${diagTable()}<p class="diag-note">Capacidade é a velocidade máxima que o aparelho consegue com um programa que nunca descansa (100% = um GBA de verdade). Jogos reais pesam menos que isso.</p>
    <div class="diag-actions"><button class="btn primary" id="diagCopy" type="button">Copiar resultado</button><button class="btn" id="diagClose" type="button">Fechar</button></div>
    <pre class="diag-pre" id="diagText"></pre>`);
    $("#diagText").textContent = diagReport();
    $("#diagCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(diagReport());
        toast("Resultado copiado");
      } catch (e) {
        const r = document.createRange();
        r.selectNodeContents($("#diagText"));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        toast("Selecionei o texto: copie com o menu do navegador");
      }
    });
    $("#diagClose").addEventListener("click", () => location.reload());
  }
  $("#diagBtn").addEventListener("click", runDiagnostic);
  function resetEmulatorSettings() {
    let n = 0;
    try {
      for (const k of Object.keys(localStorage)) if (/^ejs-/.test(k) || /^cartucho\.perf\./.test(k)) {
        localStorage.removeItem(k);
        n++;
      }
    } catch (e) {
    }
    perf.mode = "auto";
    perf.learned = guessDevice() === "TV";
    renderPerf();
    return n;
  }
  $("#resetEmuBtn").addEventListener("click", async () => {
    const ok = await dialog(
      "Restaurar as configurações do emulador?",
      "Controles, vídeo, som e as opções do menu do emulador voltam ao padrão, e o desempenho volta para Automático. Seus jogos, saves e a conexão com a nuvem continuam.",
      [{ label: "Restaurar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
    );
    if (!ok) return;
    resetEmulatorSettings();
    toast("Configurações do emulador restauradas");
  });

  // src/cast/pad.js
  var padTouches = /* @__PURE__ */ new Map();
  var padState = { rot: 0, geo: null, shownMask: -1, shownOver: "", shownDir: "" };
  function padGeometry() {
    if (padState.geo) return padState.geo;
    const geo = [];
    for (const n of $$("#pad [data-btn], #pad .pad-dpad")) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      geo.push({
        id: n.classList.contains("pad-dpad") ? "dpad" : n.dataset.btn,
        round: n.classList.contains("pad-face"),
        l: r.left,
        t: r.top,
        r: r.right,
        b: r.bottom,
        cx: (r.left + r.right) / 2,
        cy: (r.top + r.bottom) / 2,
        rad: Math.min(r.width, r.height) / 2
      });
    }
    return padState.geo = geo;
  }
  function controlAt(x, y) {
    let best = null, bestD = Infinity;
    for (const g of padGeometry()) {
      const w = (g.r - g.l) / 2, h = (g.b - g.t) / 2;
      let d;
      if (g.round) d = Math.hypot(x - g.cx, y - g.cy) / g.rad;
      else d = Math.max(Math.abs(x - g.cx) / w, Math.abs(y - g.cy) / h);
      const reach = g.id === "dpad" ? 1.35 : g.round ? 1.3 : 1.15;
      if (d <= reach && d < bestD) {
        best = g.id;
        bestD = d;
      }
    }
    return best;
  }
  function dpadMask(x, y, prev) {
    const d = padGeometry().find((g) => g.id === "dpad");
    if (!d) return 0;
    let dx = (x - d.cx) / ((d.r - d.l) / 2), dy = (y - d.cy) / ((d.b - d.t) / 2);
    if (padState.rot === 90) [dx, dy] = [dy, -dx];
    else if (padState.rot === -90) [dx, dy] = [-dy, dx];
    if (Math.hypot(dx, dy) < 0.15) return 0;
    const bit = (k) => 1 << PAD_BITS.indexOf(k);
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    const diag2 = [[45, "RIGHT", "DOWN"], [135, "DOWN", "LEFT"], [-135, "LEFT", "UP"], [-45, "UP", "RIGHT"]];
    for (const [c, k1, k2] of diag2) {
      let off = Math.abs(a - c);
      if (off > 180) off = 360 - off;
      if (off <= 10) return bit(k1) | bit(k2);
    }
    const cards = [[0, "RIGHT"], [90, "DOWN"], [180, "LEFT"], [-90, "UP"]];
    let best = null, bestOff = 999;
    for (const [c, k] of cards) {
      let off = Math.abs(a - c);
      if (off > 180) off = 360 - off;
      if (prev & bit(k)) off -= 4;
      if (off < bestOff) {
        bestOff = off;
        best = k;
      }
    }
    return bit(best);
  }
  function touchMask(p) {
    if (p.anchor === "dpad") return dpadMask(p.x, p.y, p.mask);
    if (p.anchor && p.over === p.anchor) return 1 << PAD_BITS.indexOf(p.anchor);
    return 0;
  }
  function padUpdate() {
    let m = 0;
    const over = [];
    for (const p of padTouches.values()) {
      const pm = touchMask(p);
      p.mask = pm;
      m |= pm;
      if (p.over && p.over !== "dpad" && !(pm & 1 << PAD_BITS.indexOf(p.over))) over.push(p.over);
    }
    if (m & ~cast.localMask) cast.touchAt = performance.now();
    cast.localMask = m;
    applyInput();
    const overKey = over.sort().join(" ");
    if (m !== padState.shownMask || overKey !== padState.shownOver) {
      padState.shownMask = m;
      padState.shownOver = overKey;
      for (const b of $$("#pad [data-btn]")) {
        const bit = 1 << PAD_BITS.indexOf(b.dataset.btn);
        b.classList.toggle("on", !!(m & bit));
        b.classList.toggle("over", over.includes(b.dataset.btn));
      }
      const dirs = ["UP", "DOWN", "LEFT", "RIGHT"].filter((k) => m & 1 << PAD_BITS.indexOf(k)).join(" ");
      if (dirs !== padState.shownDir) {
        padState.shownDir = dirs;
        $("#pad .pad-dpad").dataset.dir = dirs;
      }
    }
  }
  var padMsgTimer = null;
  function padMsg(text) {
    const n = $("#padMsg");
    n.textContent = text;
    n.classList.add("show");
    clearTimeout(padMsgTimer);
    padMsgTimer = setTimeout(() => n.classList.remove("show"), 2600);
  }
  function layoutPad() {
    const pad = $("#pad");
    if (pad.hidden) return;
    padState.geo = null;
    if (padState.mode === "local") {
      padState.rot = 0;
      pad.classList.remove("rot", "wide");
      pad.style.width = pad.style.height = pad.style.transform = "";
      const pl = $("#player"), bar = $(".pbar").getBoundingClientRect();
      const availH = innerHeight - bar.bottom, availW = innerWidth;
      const upright = availH > availW;
      const ar = player.isDs && player.emu && player.emu.aspect || 1.5;
      let gw, gh2;
      if (upright) {
        gh2 = Math.min(availW / ar, availH * (player.isDs ? 0.5 : 0.55));
        gw = gh2 * ar;
      } else {
        gw = Math.min(availH * ar, availW * 0.62);
        gh2 = gw / ar;
      }
      for (const n of [pad, pl]) {
        n.classList.toggle("port", upright);
        n.classList.toggle("land", !upright);
      }
      pl.style.setProperty("--game-w", Math.floor(gw) + "px");
      pl.style.setProperty("--game-h", Math.floor(gh2) + "px");
      pad.style.setProperty("--pad-top", bar.bottom + "px");
      requestAnimationFrame(() => {
        padState.geo = null;
      });
      return;
    }
    for (const n of [pad, $("#player")]) n.classList.remove("port", "land");
    const pref = padState.forceOrient || ls.get("cartucho.pad.orient") || "h";
    const portrait = innerHeight > innerWidth;
    padState.rot = pref === "v" || !portrait ? 0 : pref === "hr" ? -90 : 90;
    pad.classList.toggle("rot", padState.rot !== 0);
    pad.classList.toggle("wide", padState.rot !== 0 || !portrait);
    if (padState.rot === 0) {
      pad.style.width = pad.style.height = pad.style.transform = "";
      return;
    }
    pad.style.width = innerHeight + "px";
    pad.style.height = innerWidth + "px";
    pad.style.transform = padState.rot === 90 ? `translateX(${innerWidth}px) rotate(90deg)` : `translateY(${innerHeight}px) rotate(-90deg)`;
    requestAnimationFrame(() => {
      padState.geo = null;
    });
  }
  window.addEventListener("resize", layoutPad);
  window.addEventListener("ds-layout", layoutPad);
  if (window.ResizeObserver) new ResizeObserver(() => {
    if (padState.mode === "local") layoutPad();
  }).observe(document.documentElement);
  (() => {
    const pad = $("#pad");
    const isUi = (e) => e.target.closest(".pad-top, .pad-extra");
    const down = (e) => {
      if (isUi(e)) return;
      if (!padTouches.size) padState.geo = null;
      e.preventDefault();
      try {
        pad.setPointerCapture(e.pointerId);
      } catch (x) {
      }
      const c = controlAt(e.clientX, e.clientY);
      padTouches.set(e.pointerId, { x: e.clientX, y: e.clientY, anchor: c, over: c, mask: 0 });
      padUpdate();
    };
    const move = (e) => {
      const p = padTouches.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      p.x = e.clientX;
      p.y = e.clientY;
      const c = controlAt(p.x, p.y);
      p.over = c;
      padUpdate();
    };
    const up = (e) => {
      if (!padTouches.delete(e.pointerId)) return;
      padUpdate();
    };
    pad.addEventListener("pointerdown", down);
    pad.addEventListener("pointermove", move);
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    $("#padStop").addEventListener("click", () => stopCast("Transmissão encerrada."));
    $("#padSave").addEventListener("click", async () => {
      await tokenFromTap();
      padMsg("Enviando o save…");
      await flush();
      const okState = await uploadState({ force: true });
      if (player.state === "ok" || okState) {
        padMsg(cloud.db ? "Progresso salvo: continua daqui em qualquer aparelho" : "Progresso salvo neste celular");
      } else if (player.state === "none") padMsg("Ainda não há save. Salve dentro do jogo primeiro.");
      else if (player.state === "local") padMsg("Save guardado neste celular (sem nuvem conectada)");
      else padMsg("Save guardado aqui. Ele sobe quando a internet voltar.");
    });
    $("#padRotate").addEventListener("click", () => {
      const order = ["h", "hr", "v"], cur = ls.get("cartucho.pad.orient") || "h";
      const next = order[(order.indexOf(cur) + 1) % order.length];
      ls.set("cartucho.pad.orient", next);
      layoutPad();
      padMsg(next === "v" ? "Controle na vertical" : "Controle na horizontal");
    });
  })();
  var touchDevice = () => matchMedia("(pointer: coarse)").matches && guessDevice() !== "TV";
  padState.mode = "off";
  function showPad(on) {
    const pad = $("#pad");
    padTouches.clear();
    cast.localMask = 0;
    applyInput();
    if (on) padState.mode = player.isDs ? "local" : "cast";
    else padState.mode = (player.key || padState.forceLocal) && touchDevice() ? "local" : "off";
    pad.hidden = padState.mode === "off";
    pad.classList.toggle("local", padState.mode === "local");
    pad.classList.toggle("ds", !!player.isDs);
    $("#player").classList.toggle("casting", padState.mode === "cast");
    $("#player").classList.toggle("touch-pad", padState.mode === "local");
    layoutPad();
  }
  function askCastCode() {
    if (cast.pc) {
      stopCast("Transmissão encerrada.");
      return;
    }
    const root = $("#dialogRoot");
    const input = el("input", { id: "castInput", type: "text", maxlength: "9", autocomplete: "off", autocapitalize: "characters", placeholder: "ABCD 1234", class: "code-input" });
    const close = () => root.replaceChildren();
    root.replaceChildren(el("div", { class: "scrim" }, el(
      "form",
      { class: "dialog", onsubmit: (e) => {
        e.preventDefault();
        const c = normCode(input.value);
        if (c.length !== 8) {
          input.focus();
          return;
        }
        close();
        castTo(c);
      } },
      el("h2", {}, "Jogar na TV"),
      el("p", {}, 'Na TV, abra o Cartuchin e escolha "Usar como tela". Digite aqui o código que aparecer. Os dois precisam estar no mesmo Wi-Fi.'),
      input,
      el("button", { class: "btn primary", type: "submit" }, "Transmitir"),
      el("button", { class: "btn", type: "button", onclick: close }, "Cancelar")
    )));
    input.focus();
  }
  $("#castBtn").addEventListener("click", askCastCode);
  function handleScreenLink() {
    const m = location.hash.match(/^#tela-([A-Za-z0-9]{8})$/);
    if (!m) return;
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {
    }
    cast.pending = normCode(m[1]);
    $("#notice").dataset.sticky = "1";
    notice("TV pronta! Escolha o jogo: ele roda aqui e aparece na TV. Este celular vira o controle.");
  }

  // src/ds/ds-emu.js
  var FPS = 59.8261;
  var FRAME_MS = 1e3 / FPS;
  var W = 256;
  var H = 192;
  var CORE_RATE = 32768;
  var RETRO_TO_DS = { 0: 6, 1: 8, 2: 4, 3: 5, 4: 3, 5: 2, 6: 1, 7: 0, 8: 7, 9: 9, 10: 10, 11: 11 };
  var KEYMAP2 = {
    ArrowRight: 0,
    ArrowLeft: 1,
    ArrowDown: 2,
    ArrowUp: 3,
    ShiftRight: 4,
    ShiftLeft: 4,
    Enter: 5,
    KeyZ: 6,
    KeyX: 7,
    KeyA: 8,
    KeyS: 9,
    KeyQ: 10,
    KeyW: 11,
    KeyM: 14
  };
  var PADMAP = [[0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [8, 4], [9, 5], [12, 3], [13, 2], [14, 1], [15, 0]];
  var LEVELS = [
    { latency: 70, interp: 1, video30: false, skip: 3, name: "qualidade" },
    { latency: 100, interp: 0, video30: false, skip: 3, name: "leve" },
    { latency: 100, interp: 0, video30: true, skip: 3, name: "vídeo a 30 fps" },
    { latency: 135, interp: 0, video30: true, skip: 5, name: "máximo desempenho" }
  ];
  var PERF_MODES = ["auto", "60", "30"];
  var PERF_LABEL = { auto: "Automático", 60: "60 fps", 30: "Vídeo a 30 fps" };
  var LAYOUT_LABEL = { auto: "Automático", both: "As duas", side: "Lado a lado", top: "Só a de cima", bottom: "Só a de baixo" };
  var LOCAL_LAYOUTS = ["auto", "both", "top", "bottom"];
  var CAST_LAYOUTS = ["top", "both", "side"];
  var ds = {
    local: ls.get("cartucho.ds.local") || "auto",
    cast: ls.get("cartucho.ds.cast") || "top",
    perf: ls.get("cartucho.ds.perf") || "auto",
    level: Math.min(LEVELS.length - 1, Number(ls.get("cartucho.ds.level") || 1))
  };
  var WORKLET_SRC = `
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
  var audio = {
    ctx: null,
    node: null,
    gain: null,
    ready: false,
    fill: 0,
    fillAt: 0,
    pushed: 0,
    underruns: 0,
    target: 3300,
    async init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: "interactive" });
      } catch (e) {
        return;
      }
      if (!this.ctx.audioWorklet) return;
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.node = new AudioWorkletNode(this.ctx, "ds-out", { outputChannelCount: [2] });
      this.node.port.onmessage = (e) => {
        this.fill = e.data.fill;
        this.fillAt = performance.now();
        this.pushed = 0;
        this.underruns = e.data.underruns;
      };
      this.node.port.postMessage({ t: "rate", v: CORE_RATE });
      this.gain = this.ctx.createGain();
      this.node.connect(this.gain);
      this.gain.connect(this.ctx.destination);
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
    setLatency(ms) {
      this.target = Math.round(ms * CORE_RATE / 1e3);
      if (this.node) this.node.port.postMessage({ t: "target", v: this.target });
    },
    reset() {
      if (this.node) this.node.port.postMessage({ t: "reset" });
      this.fill = 0;
      this.pushed = 0;
    },
    /** amostras no buffer agora (estimado): último relatório + o que o worker mandou - o que já tocou */
    level() {
      if (!this.ready) return this.target;
      return this.fill + this.pushed - (performance.now() - this.fillAt) * CORE_RATE / 1e3;
    },
    resume() {
      if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {
      });
    }
  };
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, () => audio.resume(), true);
  function workerMain() {
    const g = self;
    let M = null, fbPtr = 0, audioPtr = 0, audioPort = null, romLen = 0, interp = 0, rate = 32768;
    const reply = (m, tr) => g.postMessage(m, tr || []);
    function boot() {
      M._emuSetOpt(0, 1);
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
      setInterp(v) {
        interp = v;
        M._emuSetOpt(1, v);
        return true;
      },
      getSave() {
        return saveBytes();
      }
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
          const busy2 = performance.now() - t0;
          reply({ t: "frame", n: m.n, fb, busy: busy2 }, fb ? [fb.buffer] : []);
          if (t0 - lastSavCheck > 1e3) {
            lastSavCheck = t0;
            if (M._savUpdateChangeFlag()) {
              const s = saveBytes();
              reply({ t: "sav", sav: s }, [s.buffer]);
            }
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
          if (m.sav && m.sav.length) {
            const sp = M._savGetPointer(m.sav.length);
            M.HEAPU8.set(m.sav, sp);
          }
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
            print: () => {
            },
            printErr: (t) => console.warn("[ds]", t),
            onAbort: (r) => reply({ t: "error", msg: "core: " + r })
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
  var workerUrl = null;
  function coreNames() {
    const simd = WebAssembly.validate(new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      1,
      5,
      1,
      96,
      0,
      1,
      123,
      3,
      2,
      1,
      0,
      10,
      10,
      1,
      8,
      0,
      65,
      0,
      253,
      15,
      253,
      98,
      11
    ]));
    if (!simd) return ["nds-nosimd"];
    const mt = window.crossOriginIsolated && typeof SharedArrayBuffer === "function" && ls.get("cartucho.ds.nomt") !== "1";
    return mt ? ["nds-mt", "nds"] : ["nds"];
  }
  function startWorker(name) {
    if (!workerUrl) {
      const src = `const W2 = ${W}, H2 = ${H * 2};
(${workerMain.toString()})();`;
      workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    }
    const worker = new Worker(workerUrl);
    const base = new URL("ds/", location.href).href;
    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 3e4);
      worker.addEventListener("message", function on(e) {
        if (e.data.t === "ready") {
          clearTimeout(t);
          worker.removeEventListener("message", on);
          resolve();
        } else if (e.data.t === "error") {
          clearTimeout(t);
          reject(new Error(e.data.msg));
        }
      });
      worker.addEventListener("error", (e) => {
        clearTimeout(t);
        reject(new Error(e.message || "worker"));
      });
    });
    const audioPort = audio.port();
    worker.postMessage({ t: "init", base, name, audioPort }, audioPort ? [audioPort] : []);
    return { worker, ready, name };
  }
  async function createDsEmulator(romBytes, gameName, startSav) {
    await audio.init().catch(() => {
    });
    let worker = null, coreName = "";
    for (const name of coreNames()) {
      const w = startWorker(name);
      try {
        await w.ready;
        worker = w.worker;
        coreName = name;
        break;
      } catch (e) {
        console.warn("ds worker", name, e);
        w.worker.terminate();
      }
    }
    if (!worker) return null;
    let nextId = 1;
    const waiting = /* @__PURE__ */ new Map();
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
    let blankChecks = 0, frameN = 0;
    function checkBlank() {
      const d = fctx.getImageData(0, 0, W, H * 2).data;
      for (let i = 0; i < d.length; i += 4 * 997) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) {
        blankChecks = 0;
        return;
      }
      blankChecks++;
    }
    const castCanvas = el("canvas", { class: "ds-cast", width: String(W), height: String(H), "aria-hidden": "true" });
    document.body.append(castCanvas);
    const cctx = castCanvas.getContext("2d", { alpha: false });
    const fb = document.createElement("canvas");
    fb.width = W;
    fb.height = H * 2;
    const fctx = fb.getContext("2d", { alpha: false });
    let savCopy = startSav && startSav.length ? new Uint8Array(startSav) : new Uint8Array(0);
    let pendingSav = null;
    const listeners = {};
    const emu = {
      started: false,
      paused: false,
      muted: false,
      volume: 1,
      isDs: true,
      canvas: castCanvas,
      streamW: W,
      streamH: H,
      aspect: 2 / 3,
      padKeys: 0,
      kbKeys: 0,
      gpKeys: 0,
      touch: false,
      tx: 0,
      ty: 0,
      turbo: 1,
      ffRatio: 2,
      frames: 0,
      on(ev, cb) {
        if (ev === "start" && emu.started) setTimeout(cb, 0);
        else (listeners[ev] = listeners[ev] || []).push(cb);
      },
      play() {
        emu.paused = false;
        audio.reset();
        acc = 0;
      },
      pause() {
        emu.paused = true;
      },
      setVolume(v) {
        emu.volume = v;
        if (audio.gain) audio.gain.gain.value = v;
      },
      core: coreName,
      isBlank: () => blankChecks >= 5,
      audioStats: () => ({ ready: audio.ready, fill: Math.round(audio.fill), target: audio.target, underruns: audio.underruns, state: audio.ctx && audio.ctx.state }),
      destroy
    };
    emu.gameManager = {
      // o player pede o save de forma síncrona: devolve a cópia que o worker manda quando ele muda
      getSaveFile() {
        return savCopy.slice();
      },
      writeSav(u8) {
        pendingSav = u8 && u8.length ? new Uint8Array(u8) : null;
      },
      loadSaveFiles() {
      },
      async restart() {
        const sav = pendingSav;
        pendingSav = null;
        if (sav) savCopy = sav.slice();
        await call("restart", sav);
        audio.reset();
        acc = 0;
      },
      getState() {
        return call("getState");
      },
      async loadState(u8) {
        await call("loadState", u8);
        audio.reset();
        acc = 0;
      },
      getFrameNum() {
        return emu.frames;
      },
      simulateInput(_player, index, value) {
        const bit = RETRO_TO_DS[index];
        if (bit == null) return;
        if (value) emu.padKeys |= 1 << bit;
        else emu.padKeys &= ~(1 << bit);
      },
      setFastForwardRatio(r) {
        emu.ffRatio = Math.max(2, Math.min(4, Number(r) || 2));
      },
      toggleFastForward(on) {
        emu.turbo = on ? emu.ffRatio : 1;
        if (!on) {
          audio.reset();
          acc = 0;
        }
      },
      setVariable() {
      }
    };
    const cfg = { latency: 100, interp: 0, video30: false, skip: 3 };
    const tune = { calm: 0, bad: 0, lastUnder: 0 };
    function applyCfg() {
      if (ds.perf === "auto") Object.assign(cfg, LEVELS[ds.level]);
      else Object.assign(cfg, LEVELS[ds.perf === "30" ? 2 : 0]);
      audio.setLatency(cfg.latency);
      if (emu.started) call("setInterp", cfg.interp).catch(() => {
      });
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
    const casting = () => !!window.__castCap;
    function localLayout() {
      if (casting()) return ds.cast === "bottom" ? "top" : "bottom";
      if (ds.local !== "auto") return ds.local;
      return innerWidth > innerHeight * 1.15 ? "side" : "both";
    }
    function sizeFor(layout) {
      return layout === "both" ? [W, H * 2] : layout === "side" ? [W * 2, H] : [W, H];
    }
    function blit(ctx, layout) {
      if (layout === "both") ctx.drawImage(fb, 0, 0);
      else if (layout === "side") {
        ctx.drawImage(fb, 0, 0, W, H, 0, 0, W, H);
        ctx.drawImage(fb, 0, H, W, H, W, 0, W, H);
      } else ctx.drawImage(fb, 0, layout === "top" ? 0 : H, W, H, 0, 0, W, H);
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
      if (casting()) blit(cctx, ds.cast);
    }
    emu.relayout = () => {
      shownLocal = "";
      shownCast = "";
      draw();
    };
    let touchId = null;
    function touchAt(e) {
      const b = view.getBoundingClientRect();
      const ar = view.width / view.height;
      const r = { left: b.left, top: b.top, width: b.width, height: b.height };
      if (b.width / b.height > ar) {
        r.width = b.height * ar;
        r.left += (b.width - r.width) / 2;
      } else {
        r.height = b.width / ar;
        r.top += (b.height - r.height) / 2;
      }
      const lo = shownLocal;
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
      try {
        view.setPointerCapture(e.pointerId);
      } catch (x) {
      }
      emu.touch = true;
      e.preventDefault();
    });
    view.addEventListener("pointermove", (e) => {
      if (e.pointerId === touchId) touchAt(e);
    });
    const touchUp = (e) => {
      if (e.pointerId !== touchId) return;
      touchId = null;
      emu.touch = false;
    };
    view.addEventListener("pointerup", touchUp);
    view.addEventListener("pointercancel", touchUp);
    view.addEventListener("contextmenu", (e) => e.preventDefault());
    const onKey = (down) => (e) => {
      if (!(e.code in KEYMAP2) || e.target && e.target.closest && e.target.closest("input, textarea")) return;
      const bit = 1 << KEYMAP2[e.code];
      if (down) emu.kbKeys |= bit;
      else emu.kbKeys &= ~bit;
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
        if (ax > 0.5) k |= 1;
        else if (ax < -0.5) k |= 2;
        if (ay > 0.5) k |= 4;
        else if (ay < -0.5) k |= 8;
      }
      emu.gpKeys = k;
    }
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
        if (m.err) w.reject(new Error(m.err));
        else w.resolve(m.val);
      } else if (m.t === "error") {
        console.warn("[ds]", m.msg);
      }
    };
    let acc = 0, last = performance.now(), raf = 0, alive = true, toggle30 = 0, sentAt = 0, stuck = false;
    function tick(now) {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      pollGamepad();
      if (!emu.started || emu.paused || document.visibilityState !== "visible") {
        last = now;
        return;
      }
      let dt = now - last;
      last = now;
      if (dt > 200) dt = 200;
      acc += dt;
      if (inFlight) {
        if (now - sentAt > 6e3 && !stuck) {
          stuck = true;
          if (coreName === "nds-mt") {
            ls.set("cartucho.ds.nomt", "1");
            toast("O modo com threads travou neste aparelho. Voltando ao modo normal…", 3e3);
            setTimeout(() => location.reload(), 1500);
          } else toast("O emulador parou de responder. Volte à biblioteca e abra o jogo de novo.", 6e3);
        }
        return;
      }
      let n;
      if (emu.turbo > 1) {
        n = emu.turbo;
        acc = 0;
      } else {
        n = Math.floor(acc / FRAME_MS);
        acc -= n * FRAME_MS;
        if (audio.ready) {
          const lvl = audio.level();
          if (lvl < audio.target * 0.5) n += 1;
          else if (lvl > audio.target * 2 && n > 0) n -= 1;
        }
        if (n > cfg.skip) {
          n = cfg.skip;
          acc = Math.min(acc, FRAME_MS);
        }
      }
      if (n > 0) {
        const draw2 = !cfg.video30 || (++toggle30 & 1) === 0;
        inFlight = true;
        inFlightN = n;
        sentAt = now;
        worker.postMessage({
          t: "tick",
          n,
          draw: draw2,
          keys: emu.padKeys | emu.kbKeys | emu.gpKeys,
          touch: emu.touch,
          tx: emu.tx,
          ty: emu.ty,
          audio: emu.turbo === 1 && !emu.muted
        });
      }
      if (now - stT0 >= 1e3) {
        autoTune(stF / ((now - stT0) / 1e3), stBusy / (now - stT0) * 100);
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
    applyCfg();
    try {
      const buf = romBytes.buffer.byteLength === romBytes.length ? romBytes.buffer : romBytes.slice().buffer;
      await call("rom", { bytes: buf, sav: savCopy.length ? savCopy.slice() : null, interp: cfg.interp, rate: CORE_RATE }, [buf]);
    } catch (e) {
      toast(String(e.message) === "rom-encrypted" ? 'Essa ROM de DS está criptografada. Use uma versão "decrypted".' : "Não deu para abrir essa ROM de DS.", 5e3);
      destroy();
      return null;
    }
    syncSizes();
    emu.started = true;
    audio.reset();
    raf = requestAnimationFrame(tick);
    setTimeout(() => {
      for (const cb of listeners.start || []) cb();
    }, 0);
    return emu;
  }
  function nextOf(list, cur) {
    return list[(list.indexOf(cur) + 1) % list.length];
  }
  function dsMenuItems(emu, refresh) {
    return [
      {
        icon: "sliders",
        label: "Telas aqui: " + LAYOUT_LABEL[ds.local],
        fn: () => {
          ds.local = nextOf(LOCAL_LAYOUTS, ds.local);
          ls.set("cartucho.ds.local", ds.local);
          emu.relayout();
          refresh();
        }
      },
      {
        icon: "sliders",
        label: "Telas na TV: " + LAYOUT_LABEL[ds.cast],
        fn: () => {
          ds.cast = nextOf(CAST_LAYOUTS, ds.cast);
          ls.set("cartucho.ds.cast", ds.cast);
          emu.relayout();
          refresh();
        }
      },
      {
        icon: "sliders",
        label: "Desempenho: " + PERF_LABEL[ds.perf] + (ds.perf === "auto" ? ` (${LEVELS[ds.level].name})` : ""),
        fn: () => {
          ds.perf = nextOf(PERF_MODES, ds.perf);
          ls.set("cartucho.ds.perf", ds.perf);
          emu.applyCfg();
          refresh();
        }
      }
    ];
  }
  var dsStatesOk = true;

  // src/player/player.js
  var player = window.__cartucho = {
    key: null,
    meta: null,
    /** @type {any} the EmulatorJS instance */
    emu: null,
    lastSha: null,
    baseRev: null,
    busy: false,
    again: false,
    timer: null,
    state: "loading",
    at: 0,
    stateBusy: false,
    stateFrames: 0
  };
  function setChip(state, at) {
    player.state = state;
    if (at) player.at = at;
    updateChip();
  }
  function updateChip() {
    const dot = $("#pChip .dot"), txt = $("#pChipText");
    const map = {
      loading: ["", "Carregando…"],
      ok: ["ok", "Save na nuvem " + ago(player.at)],
      up: ["warn", "Enviando save…"],
      pending: ["warn", "Save guardado aqui, envio pendente"],
      local: ["warn", "Save só neste aparelho"],
      none: ["", "Sem save ainda"]
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
    if (cloud.db && document.visibilityState === "visible") refreshLibrary().then(render).catch(() => {
    });
    else if (cloud.ready) render();
  }, 3e4);
  function savPath(gm) {
    return gm.getSaveFilePath();
  }
  function writeSav(gm, sav) {
    if (gm.writeSav) return gm.writeSav(sav);
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
  async function flush(opts = {}) {
    const emu = player.emu;
    if (!emu || !emu.started || !emu.gameManager || !player.key) return;
    if (player.busy) {
      player.again = true;
      return;
    }
    player.busy = true;
    try {
      let sav = null;
      try {
        sav = emu.gameManager.getSaveFile();
      } catch (e) {
      }
      if (!sav || !sav.length) {
        if (!player.lastSha) setChip("none");
        return;
      }
      sav = new Uint8Array(sav);
      const h = await sha(sav);
      if (h === player.lastSha) return;
      await idb.put("pend", player.key, { sav, sha: h, baseRev: player.baseRev, at: Date.now() }).catch(() => {
      });
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
        await idb.put("sync", player.key, { lastSha: h, baseRev: doc.rev }).catch(() => {
        });
        setChip("ok", doc.at);
        if (!$("#pad").hidden && !opts.quiet) padMsg("Save enviado para a nuvem");
      } catch (e) {
        setChip("pending");
      }
    } finally {
      player.busy = false;
      if (player.again) {
        player.again = false;
        setTimeout(flush, 500);
      }
    }
  }
  var stateShas = /* @__PURE__ */ new Map();
  var isBlankSave = (u8) => {
    if (!u8 || !u8.length) return true;
    const f = u8[0];
    if (f !== 255 && f !== 0) return false;
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
    const emu = player.emu;
    if (!emu || !emu.started || !emu.gameManager || !player.key || player.stateBusy) return false;
    const gm = emu.gameManager;
    const frames = Number(gm.getFrameNum());
    if (!opts.force && player.stateFrames && frames - player.stateFrames < 600) return false;
    let st;
    try {
      st = await gm.getState();
    } catch (e) {
      return false;
    }
    player.stateBusy = true;
    try {
      let sav = null;
      try {
        sav = new Uint8Array(gm.getSaveFile());
      } catch (e) {
      }
      const packed = await pack(st);
      const doc = { game: player.key, enc: packed.enc, data: packed.data, size: st.length, at: Date.now(), device: device.name, saveSha: sav && !isBlankSave(sav) ? await sha(sav) : null };
      await idb.put("pend", "state:" + player.key, doc).catch(() => {
      });
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
    } catch (e) {
      return false;
    } finally {
      player.stateBusy = false;
    }
  }
  async function findResumeState(key, start) {
    let best = await idb.get("pend", "state:" + key);
    if (cloud.db) {
      try {
        const remote = await getStateDoc(key);
        if (remote && (!best || remote.at > best.at)) best = remote;
      } catch (e) {
      }
    }
    if (!best || !best.data) return null;
    const startSha = start.sav && !isBlankSave(start.sav) ? start.sha : null;
    if ((best.saveSha || null) !== startSha) return null;
    return best;
  }
  async function chooseStartSave(key) {
    const pend = await idb.get("pend", key);
    let remote = null;
    if (cloud.db) {
      try {
        remote = await getSaveDoc(key);
      } catch (e) {
        remote = cloud.docs.get(key) || null;
      }
    }
    if (remote && pend && pend.sha !== remote.sha && pend.baseRev !== remote.rev) {
      const pick = await dialog(
        "Dois saves diferentes",
        "Este aparelho tem progresso que não chegou à nuvem, e a nuvem tem um save mais novo de outro aparelho. Qual você quer jogar? O outro fica guardado como versão anterior.",
        [
          { label: "Save da nuvem", sub: `${remote.device || "Outro aparelho"}, ${ago(remote.at)}`, value: "cloud", cls: "primary" },
          { label: "Save deste aparelho", sub: `${device.name}, ${ago(pend.at)}`, value: "local" }
        ]
      );
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
  var emuLoading = null;
  function loadEmulator() {
    if (!emuLoading) {
      document.head.append(el("link", { rel: "stylesheet", href: "vendor/emulator.min.css" }));
      emuLoading = loadScript("vendor/emulator.min.js").then(() => loadScript("vendor/mgba_libretro.js"));
    }
    return emuLoading;
  }
  (() => {
    const RO = window.ResizeObserver;
    if (!RO || RO.__cartucho) return;
    const factorFor = (w, h) => {
      const max = PROFILES[perfProfile()].gameMax;
      if (!max) return 1;
      const gameW = w / h > 1.5 ? h * 1.5 : w;
      return gameW > max ? max / gameW : 1;
    };
    const scaleEntry = (e) => {
      if (!(e.target instanceof HTMLCanvasElement)) return e;
      const dpr = window.devicePixelRatio || 1;
      let w, h;
      if (window.__castCap) {
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
      return {
        target: e.target,
        contentRect: { width: w / dpr, height: h / dpr, x: 0, y: 0, top: 0, left: 0 },
        devicePixelContentBoxSize: [{ inlineSize: w, blockSize: h }],
        contentBoxSize: [{ inlineSize: w / dpr, blockSize: h / dpr }],
        borderBoxSize: e.borderBoxSize
      };
    };
    class CappedResizeObserver extends RO {
      constructor(cb) {
        super((entries, obs) => cb(entries.map(scaleEntry), obs));
      }
    }
    CappedResizeObserver.__cartucho = true;
    window.ResizeObserver = /** @type {any} */
    CappedResizeObserver;
  })();
  function patchEmulator() {
    const EJS = window.EmulatorJS;
    if (!EJS || EJS.__cartucho) return;
    EJS.__cartucho = true;
    const GM = window.EJS_GameManager;
    if (GM && !GM.__cartucho) {
      GM.__cartucho = true;
      const orig = GM.prototype.getRetroArchCfg;
      GM.prototype.getRetroArchCfg = function() {
        let cfg = orig.call(this);
        cfg = cfg.replace(/audio_latency = \d+/, "audio_latency = " + PROFILES[perfProfile()].latency);
        cfg = cfg.replace(/autosave_interval = \d+/, "autosave_interval = 0");
        return cfg + "audio_rate_control = true\naudio_rate_control_delta = 0.010\nvideo_threaded = false\n";
      };
    }
    EJS.prototype.initGameCore = function(js, wasm, thread) {
      this.initModule(wasm, thread);
    };
    EJS.prototype.downloadGameCore = function() {
      const core = { name: "mgba", extensions: ["gb", "gbc", "gba"], options: {}, save: "srm", repo: "https://github.com/EmulatorJS/mgba" };
      this.textElem.innerText = this.localization("Download Game Core");
      this.extensions = core.extensions;
      this.coreName = core.name;
      this.repository = core.repo;
      this.defaultCoreOpts = core.options;
      this.enableMouseLock = false;
      this.retroarchOpts = void 0;
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
    EJS.prototype.initModule = function(wasm, thread) {
      if (typeof window.EJS_Runtime !== "function") {
        this.startGameError(this.localization("Error loading EmulatorJS runtime"));
        return;
      }
      const wasmBytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
      window.EJS_Runtime({
        noInitialRun: true,
        onRuntimeInitialized: null,
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
        wasmBinary: wasmBytes,
        locateFile: (f) => f.endsWith(".wasm") ? URL.createObjectURL(new Blob([wasmBytes], { type: "application/wasm" })) : f,
        getSavExt: () => this.saveFileExt ? "." + this.saveFileExt : ".srm"
      }).then((m) => {
        this.Module = m;
        this.downloadFiles();
      }).catch((e) => {
        console.warn(e);
        this.startGameError(this.localization("Failed to start game"));
      });
    };
  }
  async function createEmulator(file, gameName, options) {
    try {
      await loadEmulator();
    } catch (e) {
      return null;
    }
    patchEmulator();
    return new window.EmulatorJS("#game", {
      gameUrl: file,
      dataPath: "ejs/",
      system: "mgba",
      gameName,
      color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b4bd8",
      startOnLoad: true,
      threads: false,
      forceLegacyCores: true,
      cacheLimit: 0,
      language: "pt-BR",
      langJson: window.__CARTUCHO_LANG || void 0,
      backgroundColor: "#000000",
      noAutoFocus: false,
      buttonOpts: { netplay: false, saveSavFiles: false, loadSavFiles: false, cacheManager: false, exitEmulation: false, contextMenu: false },
      defaultOptions: options
    });
  }
  var dsPage = new URLSearchParams(location.search).get("ds");
  async function play(key) {
    if (!dsPage) {
      const r = roms.get(key) || cloud.roms.get(key) || cloud.docs.get(key);
      if (r && r.system === "nds") {
        location.href = location.pathname + "?ds=" + encodeURIComponent(key) + (cast.pending ? "#tela-" + cast.pending : "");
        return;
      }
    }
    let rom = roms.get(key);
    if (!rom) rom = await fetchRom(key);
    if (!rom) return;
    const start = await chooseStartSave(key);
    if (start === null) return;
    const isDs = rom.system === "nds";
    const resume = isDs && !dsStatesOk ? null : await findResumeState(key, start);
    player.key = key;
    player.meta = { title: rom.title, system: rom.system, code: rom.code };
    player.lastSha = start.upload ? null : start.sha;
    player.baseRev = start.baseRev;
    $("#pName").textContent = rom.title;
    $("#library").hidden = true;
    $("#player").hidden = false;
    setChip(start.sav ? start.upload ? "pending" : cloud.db ? "ok" : "local" : "none", start.at);
    try {
      document.title = rom.title + " · Cartuchin";
    } catch (e) {
    }
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
      toast("Não deu para carregar o emulador. Confira a internet.");
      $("#player").hidden = true;
      $("#library").hidden = false;
      return;
    }
    player.emu = emu;
    emu.on("start", async () => {
      const gm = emu.gameManager;
      if (start.sav && !isDs) {
        try {
          writeSav(gm, start.sav);
          gm.loadSaveFiles();
          gm.restart();
        } catch (e) {
          console.warn("save load", e);
        }
      }
      if (resume) {
        await sleep(300);
        try {
          await gm.loadState(await unpack(resume));
          player.stateFrames = Number(gm.getFrameNum());
          const msg = `Continuando de onde parou (${resume.device || "outro aparelho"}, ${ago(resume.at)})`;
          if (!$("#pad").hidden) padMsg(msg);
          else actionToast(msg, "Ir para a tela de título", () => {
            try {
              gm.restart();
            } catch (e) {
            }
          });
          if (isDs && emu.isBlank) {
            await sleep(4e3);
            if (emu.isBlank()) throw new Error("tela preta depois do snapshot");
          }
        } catch (e) {
          console.warn("state load", e);
          if (isDs) {
            try {
              await gm.restart();
            } catch (x) {
            }
            toast("Não deu para continuar de onde parou: o jogo abriu pelo save.", 4e3);
          }
        }
      }
      await sleep(1500);
      if (start.upload) flush();
      player.timer = setInterval(flush, 3e4);
      if (!cast.pc) showPad(false);
      startSpeedMeter();
      if (cast.pending) {
        const c = cast.pending;
        cast.pending = null;
        setTimeout(() => castTo(c), 500);
      }
    });
  }
  async function pullSave(report) {
    if (!player.key || !player.emu || !player.emu.started) return;
    if (!cloud.db) {
      report(isGoogle() ? "Reconecte ao Google primeiro (botão no topo da biblioteca)." : "Este aparelho não está conectado à nuvem.");
      return;
    }
    report("Buscando o save na nuvem…");
    let remote;
    try {
      remote = await getSaveDoc(player.key);
    } catch (e) {
      report(`Não deu para falar com o ${cloudName()} agora.`);
      return;
    }
    if (!remote) {
      report("Ainda não há save deste jogo na nuvem.");
      return;
    }
    const gm = player.emu.gameManager;
    let cur = null;
    try {
      cur = new Uint8Array(gm.getSaveFile());
    } catch (e) {
    }
    if (cur && await sha(cur) === remote.sha) {
      report("Você já está com o save mais recente da nuvem.");
      return;
    }
    const unsent = cur && player.lastSha && await sha(cur) !== player.lastSha;
    const ok = await dialog(
      "Carregar o save da nuvem?",
      `Save de ${remote.device || "outro aparelho"}, ${ago(remote.at)}. O jogo reinicia na tela de título.` + (unsent ? " Este aparelho tem progresso que ainda não subiu: ele vai ser substituído." : ""),
      [{ label: "Carregar e reiniciar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
    );
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
    } catch (e) {
      report("Não deu para carregar o save.");
    }
  }
  $("#pullBtn").addEventListener("click", () => pullSave((m) => m && toast(m)));
  $("#padPull").addEventListener("click", () => pullSave((m) => m && padMsg(m)));
  function tokenFromTap() {
    if (window.crossOriginIsolated) return Promise.resolve();
    if (isGoogle() && !tokenFresh() && gauth.client) return askGoogleToken(false).then(() => {
      googleNeedsTap(false);
      cloud.db = true;
    }, () => {
    });
    return Promise.resolve();
  }
  $("#saveNowBtn").addEventListener("click", async () => {
    await tokenFromTap();
    await flush();
    const ok = await uploadState({ force: true });
    if (ok && cloud.db) toast("Progresso salvo: o jogo continua daqui em qualquer aparelho", 3500);
    else if (ok) toast("Progresso salvo neste aparelho", 3e3);
    else if (player.state === "none") toast("Ainda não há save. Salve dentro do jogo primeiro.");
  });
  $("#backBtn").addEventListener("click", async () => {
    await flush();
    if (player.state === "up" || player.state === "pending") {
      const ok = await dialog(
        "O save ainda não subiu",
        "Ele ficou guardado neste aparelho e vai subir na próxima vez que você abrir o jogo aqui.",
        [{ label: "Voltar mesmo assim", value: true, cls: "primary" }, { label: "Continuar jogando", value: false }]
      );
      if (!ok) return;
    }
    if (dsPage) location.href = location.pathname;
    else location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush({ leaving: true });
  });
  window.addEventListener("pagehide", () => {
    flush({ leaving: true });
  });
  var realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input && /** @type {any} */
    input.url || "";
    if (/^https?:\/\/(cdn|netplay)\.emulatorjs\.org/.test(u)) return Promise.resolve(new Response("{}", { status: 404 }));
    return realFetch(input, init);
  };

  // src/library.js
  var roms = /* @__PURE__ */ new Map();
  async function loadRoms() {
    roms = /* @__PURE__ */ new Map();
    for (const r of await idb.all("roms")) if (r && r.key) roms.set(r.key, r);
  }
  function notice(msg, kind) {
    const n = $("#notice");
    if (!msg) {
      n.hidden = true;
      return;
    }
    n.className = "notice" + (kind === "err" ? " err" : "");
    n.textContent = msg;
    n.hidden = false;
  }
  var APP_V = (() => {
    try {
      return new URL(
        /** @type {HTMLScriptElement} */
        document.currentScript.src
      ).searchParams.get("v") || "";
    } catch (e) {
      return "";
    }
  })();
  var gameDbs = {};
  function gameDb(sys) {
    return gameDbs[sys] || (gameDbs[sys] = fetch(`db/${sys}.json?v=${APP_V}`).then((r) => r.ok ? r.json() : null).catch(() => null));
  }
  var thumbName = (n) => n.replace(/[&*/:`<>?\\|"]/g, "_");
  function artUrls(c) {
    const f = encodeURIComponent(thumbName(c.name)) + ".png";
    return [
      `https://thumbnails.libretro.com/${encodeURIComponent(c.dir)}/Named_Boxarts/${f}`,
      `https://raw.githubusercontent.com/libretro-thumbnails/${c.dir.replace(/ /g, "_")}/master/Named_Boxarts/${f}`
    ];
  }
  function prettyName(n) {
    let t = n.replace(/\s*[([][^)\]]*[)\]]/g, "").trim();
    t = t.replace(/^(.*?), (The|A|An)(?= - |$)/, "$2 $1");
    t = t.replace(/\s+-\s+/g, ": ").replace(/\bPokemon\b/g, "Pokémon");
    t = t.replace(/^Pokémon: (.+?) Version$/, "Pokémon $1").replace(/^Pokémon: /, "Pokémon ");
    return t;
  }
  function cleanTitle(raw) {
    let t = (raw || "").replace(/\.(gba|gbc|gb|nds|zip)$/i, "").replace(/_+/g, " ").replace(/\s*[([][^)\]]*[)\]]/g, " ");
    t = t.replace(/\s+(v|ver|version|vesion|versao|versão|rev)\.?\s*\d[\d.]*\s*$/i, "").replace(/\s+v?\d+(\.\d+)+\s*$/i, "");
    t = t.replace(/\s+/g, " ").trim();
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) t = titleCase(t.toLowerCase());
    return t.replace(/\bpok[eé]mon\b/gi, "Pokémon") || "Jogo";
  }
  var normTitle = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(hack\)|\bpokemon\b|\bversion\b/g, "").replace(/[^a-z0-9]/g, "");
  async function identifyRom(bytes, info, fileName) {
    const crc = crc32(bytes).toString(16).toUpperCase().padStart(8, "0");
    const systems = info.system === "gba" ? ["gba"] : info.system === "nds" ? [] : ["gbc", "gb"];
    for (const sys of systems) {
      const db = await gameDb(sys);
      if (!db) continue;
      const i = db.crc[crc];
      if (i != null) {
        const name = db.names[i];
        return { title: prettyName(name), cover: db.art[i] === "1" ? { dir: db.dir, name } : null };
      }
    }
    const title = cleanTitle(fileName || info.title);
    const want = normTitle(title);
    for (const sys of systems) {
      const db = await gameDb(sys);
      if (!db) continue;
      const h = (db.hacks || []).find((n) => normTitle(n) === want);
      if (h) return { title: prettyName(h), cover: { dir: db.dir, name: h } };
    }
    return { title, cover: null };
  }
  var identifying = false;
  async function identifyOldRoms() {
    if (identifying) return;
    identifying = true;
    try {
      for (const rom of [...roms.values()]) {
        if (rom.ident || !rom.blob) continue;
        const id = await identifyRom(new Uint8Array(await rom.blob.arrayBuffer()), rom, rom.fileName);
        const upd = { ...rom, ident: true, cover: rom.cover !== void 0 && rom.cover !== null ? rom.cover : id.cover, title: rom.titleSet ? rom.title : id.title };
        await idb.put("roms", rom.key, upd).catch(() => {
        });
        roms.set(rom.key, upd);
        const ix = cloud.index && cloud.index.games && cloud.index.games[rom.key];
        if (cloud.db && ix && (!ix.titleSet || ix.cover === void 0)) {
          await updateIndex((d) => {
            const g = d.games[rom.key];
            if (!g) return;
            if (!g.titleSet) g.title = upd.title;
            if (g.cover === void 0 || g.cover === null) g.cover = upd.cover;
          }, `Biblioteca: ${upd.title}`).catch(() => {
          });
        }
        render();
      }
    } finally {
      identifying = false;
    }
  }
  function gameInfo(key) {
    const rom = roms.get(key), save = cloud.docs.get(key), crom = cloud.roms.get(key);
    const ix = cloud.index && cloud.index.games && cloud.index.games[key] || null;
    const title = ix && ix.title || rom && rom.title || save && save.title || crom && crom.title || key;
    const cover = ix && ix.cover !== void 0 && ix.cover !== null ? ix.cover : rom && rom.cover || null;
    const coverRev = ix && ix.coverRev || rom && rom.coverRev || "";
    const system = rom && rom.system || save && save.system || crom && crom.system || "gba";
    const code = rom && rom.code || save && save.code || crom && crom.code || "";
    return { key, rom, save, crom, ix, title, cover, coverRev, system, code, sys: system === "gba" ? "GBA" : system === "nds" ? "DS" : rom && rom.ext === "gbc" ? "GBC" : "GB", playable: !!(rom || crom) };
  }
  var coverUrls = /* @__PURE__ */ new Map();
  var coverLoading = /* @__PURE__ */ new Set();
  async function customCoverUrl(key, rev) {
    const id = key + ":" + rev;
    if (coverUrls.has(id)) return coverUrls.get(id);
    if (coverLoading.has(id)) return null;
    coverLoading.add(id);
    try {
      let rec = await idb.get("covers", key);
      if ((!rec || rec.rev !== rev) && cloud.db) {
        const r = await getBinary("covers/" + key + ".jpg");
        rec = { rev, blob: new Blob([await r.arrayBuffer()], { type: "image/jpeg" }) };
        await idb.put("covers", key, rec).catch(() => {
        });
      }
      if (!rec) return null;
      const url = URL.createObjectURL(rec.blob);
      coverUrls.set(id, url);
      return url;
    } catch (e) {
      return null;
    } finally {
      coverLoading.delete(id);
    }
  }
  function hueOf(t) {
    let h = 0;
    for (const c of t) h = h * 31 + c.charCodeAt(0) >>> 0;
    return h % 360;
  }
  function genCover(g) {
    return el("div", { class: "gen-cover", style: `--h:${hueOf(g.title)}` }, el("span", { class: "gen-title" }, g.title), el("span", { class: "gen-sys" }, [g.sys, g.code].filter(Boolean).join(" ")));
  }
  function coverEl(g) {
    const box = el("div", { class: "cover" });
    if (g.cover === "custom") {
      const id = g.key + ":" + g.coverRev;
      if (coverUrls.has(id)) box.append(el("img", { src: coverUrls.get(id), alt: "", loading: "lazy" }));
      else {
        box.append(genCover(g));
        customCoverUrl(g.key, g.coverRev).then((u) => {
          if (u) render();
        });
      }
    } else if (g.cover && g.cover.name) {
      const [main, mirror] = artUrls(g.cover);
      const img = el("img", { src: main, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => {
        if (img.dataset.alt !== "1") {
          img.dataset.alt = "1";
          img.src = mirror;
        } else img.replaceWith(genCover(g));
      });
      box.append(img);
    } else box.append(genCover(g));
    return box;
  }
  function saveLine(g) {
    const working = busy.get(g.key);
    if (working) return [el("span", { class: "tile-busy" }, working)];
    if (g.save) return [el("span", { class: "dot ok" }), el("span", {}, `Salvo ${ago(g.save.at)}`)];
    if (!g.playable) return [el("span", { class: "dot warn" }), el("span", {}, "Falta a ROM neste aparelho")];
    if (g.rom && !g.crom && cloud.db) return [el("span", { class: "dot" }), el("span", {}, "Só neste aparelho")];
    return [el("span", { class: "dot" }), el("span", {}, "Ainda sem save")];
  }
  function tile(g) {
    return el(
      "button",
      { class: "tile", type: "button", onclick: () => openGameSheet(g.key), "aria-label": g.title },
      coverEl(g),
      el("span", { class: "tile-title" }, g.title),
      el("span", { class: "tile-meta" }, saveLine(g))
    );
  }
  function addTile() {
    const plus = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    plus.setAttribute("viewBox", "0 0 24 24");
    plus.innerHTML = '<path d="M12 5v14M5 12h14"/>';
    return el("button", { class: "tile add-tile", type: "button", onclick: pickRom }, el("div", { class: "cover" }, plus), el("span", { class: "tile-title" }, "Adicionar jogo"));
  }
  function continueHero(g) {
    const sec = $("#continue");
    sec.replaceChildren(
      coverEl(g),
      el(
        "div",
        { class: "continue-body" },
        el("p", { class: "continue-kicker" }, "Continuar jogando"),
        el("h2", { class: "continue-title" }, g.title),
        el("p", { class: "continue-meta" }, `Salvo ${ago(g.save.at)} no ${g.save.device || "outro aparelho"}`),
        el("button", { class: "btn primary", type: "button", onclick: () => play(g.key) }, busy.get(g.key) || "Continuar")
      )
    );
    sec.hidden = false;
  }

  // src/connect.js
  function dataRepoName() {
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return (seg && !/\.html?$/.test(seg) ? seg : "cartuchin") + "-dados";
  }
  function defaultRepo() {
    const host = location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] : "";
    return host ? host + "/" + dataRepoName() : "";
  }
  function showConnect() {
    $("#googleBox").hidden = !googleAvailable();
    if (!googleAvailable()) $("#ghAdv").open = true;
    else loadGis().then(gisClient).catch(() => {
      $("#googleMsg").textContent = "Não deu para carregar o login do Google. Confira a internet.";
    });
    const repo = $("#ghRepo");
    if (!repo.value) repo.value = defaultRepo();
    $("#dataRepoName").textContent = dataRepoName();
    render();
  }
  $("#ghForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const [owner, repo] = $("#ghRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "").split("/");
    const token = $("#ghToken").value.trim();
    const msg = $("#ghMsg");
    if (!owner || !repo || !token) {
      msg.textContent = "Preencha o repositório (usuário/nome) e o token.";
      return;
    }
    msg.textContent = "Testando a conexão…";
    const auth = { owner, repo, token };
    try {
      const info = await gh(`/repos/${owner}/${repo}`, {}, auth);
      if (!info.permissions || !info.permissions.push) {
        msg.textContent = "O token só consegue ler esse repositório. Dê permissão de leitura e escrita em Contents.";
        return;
      }
      if (!info.private) {
        msg.textContent = "Esse repositório é público. Use um repositório privado para guardar ROMs e saves.";
        return;
      }
      saveAuth(auth);
      location.reload();
    } catch (err) {
      msg.textContent = err.status === 401 ? "O GitHub não aceitou esse token. Confira se copiou ele inteiro." : err.status === 404 ? "Não achei o repositório. Confira o nome e se o token tem acesso a ele." : "Não deu para falar com o GitHub agora. Confira a internet.";
    }
  });
  $("#localOnlyBtn").addEventListener("click", () => {
    ls.set("cartucho.localOnly", "1");
    render();
  });
  $("#emptyAddBtn").addEventListener("click", pickRom);
  $("#googleBtn").addEventListener("click", () => {
    const msg = $("#googleMsg");
    if (!gisClient()) {
      msg.textContent = "Carregando o login do Google… toque de novo em um instante.";
      loadGis().then(gisClient).catch(() => {
      });
      return;
    }
    askGoogleToken(true).then(
      () => {
        msg.textContent = "Conectado! Abrindo sua biblioteca…";
        location.reload();
      },
      (e) => {
        msg.textContent = /popup/.test(e.message) ? "O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente de novo." : e.message === "scope" ? "Para guardar seus jogos, deixe marcada a permissão do Google Drive na tela do Google e tente de novo." : "Não deu para entrar. Tente de novo.";
      }
    );
  });
  $("#disconnectBtn").addEventListener("click", async () => {
    const ok = await dialog(
      "Desconectar este aparelho?",
      `Os jogos que já estão aqui continuam, mas o save para de subir para o ${cloudName()} até você conectar de novo.`,
      [{ label: "Desconectar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
    );
    if (ok) {
      if (isGoogle() && cloud.auth.token && window.google && google.accounts && google.accounts.oauth2) try {
        google.accounts.oauth2.revoke(cloud.auth.token, () => {
        });
      } catch (e) {
      }
      clearAuth();
      location.reload();
    }
  });
  var PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function newPairCode() {
    const r = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(r, (b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join("");
  }
  var normCode = (c) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  async function pairMaterial(code) {
    const base = await crypto.subtle.importKey("raw", utf8.enc(normCode(code)), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: utf8.enc("cartucho-pareamento-v1"), iterations: 2e5, hash: "SHA-256" }, base, 384));
    const topic = "cartucho-" + Array.from(bits.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    const key = await crypto.subtle.importKey("raw", bits.subarray(16, 48), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { topic, key };
  }
  async function sendPairing(code) {
    const { topic, key } = await pairMaterial(code);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8.enc(JSON.stringify(cloud.auth))));
    const msg = new Uint8Array(iv.length + ct.length);
    msg.set(iv);
    msg.set(ct, iv.length);
    const r = await fetch("https://ntfy.sh/" + topic, { method: "POST", body: b64(msg) });
    if (!r.ok) throw new Error("ntfy " + r.status);
  }
  var pairTimer = null;
  async function startPairing() {
    const code = newPairCode();
    const { topic, key } = await pairMaterial(code);
    const link = location.origin + location.pathname + "#parear-" + code;
    $("#pairCode").textContent = code.slice(0, 4) + " " + code.slice(4);
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(link);
      qr.make();
      $("#pairQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) {
      $("#pairQr").textContent = "";
    }
    $("#pairBox").hidden = false;
    $("#pairStartBtn").hidden = true;
    $("#pairStatus").textContent = "Esperando o outro aparelho…";
    try {
      $("#pairBox").scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (e) {
    }
    const since = Math.floor(Date.now() / 1e3) - 5;
    clearInterval(pairTimer);
    pairTimer = setInterval(async () => {
      try {
        const r = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${since}`, { cache: "no-store" });
        const lines = (await r.text()).split("\n").filter(Boolean);
        for (const line of lines) {
          const m = JSON.parse(line);
          if (m.event !== "message" || !m.message) continue;
          try {
            const raw = unb64(m.message.trim());
            const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
            const auth = JSON.parse(utf8.dec(new Uint8Array(pt)));
            if (auth && auth.token) {
              clearInterval(pairTimer);
              saveAuth(auth);
              $("#pairStatus").textContent = "Conectado! Abrindo a biblioteca…";
              setTimeout(() => location.reload(), 800);
              return;
            }
          } catch (e) {
          }
        }
      } catch (e) {
      }
    }, 3e3);
  }
  $("#pairStartBtn").addEventListener("click", startPairing);
  async function pairOther(code) {
    if (!cloud.auth || !cloud.db) {
      toast("Conecte este aparelho ao GitHub primeiro.");
      return;
    }
    const ok = await dialog(
      "Conectar o outro aparelho?",
      `Ele vai poder abrir seus jogos e gravar saves no ${cloud.auth.owner}/${cloud.auth.repo}. Confira se o código na tela dele é ${normCode(code).slice(0, 4)} ${normCode(code).slice(4)}.`,
      [{ label: "Conectar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
    );
    if (!ok) return;
    try {
      await sendPairing(code);
      toast("Pronto! O outro aparelho conecta em alguns segundos.", 4e3);
    } catch (e) {
      toast("Não deu para enviar agora. Tente de novo.", 4e3);
    }
  }
  function handlePairLink() {
    const m = location.hash.match(/^#parear-([A-Za-z0-9]{8})$/);
    if (!m) return;
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {
    }
    if (cloud.db) pairOther(m[1]);
    else {
      $("#notice").dataset.sticky = "1";
      notice("Para conectar o outro aparelho, conecte este aqui ao GitHub primeiro e abra o link de novo.");
    }
  }
  $("#pairOtherBtn").addEventListener("click", async () => {
    const root = $("#dialogRoot");
    const input = el("input", { id: "pairInput", type: "text", maxlength: "9", autocomplete: "off", autocapitalize: "characters", placeholder: "ABCD 1234", class: "code-input" });
    const close = () => root.replaceChildren();
    const box = el(
      "form",
      { class: "dialog", onsubmit: (e) => {
        e.preventDefault();
        const c = normCode(input.value);
        if (c.length !== 8) {
          input.focus();
          return;
        }
        close();
        pairOther(c);
      } },
      el("h2", {}, "Conectar outro aparelho"),
      el("p", {}, 'No outro aparelho, abra o Cartuchin e escolha "Conectar com outro aparelho". Escaneie o QR com a câmera deste celular ou digite o código aqui.'),
      input,
      el("button", { class: "btn primary", type: "submit" }, "Conectar"),
      el("button", { class: "btn", type: "button", onclick: close }, "Cancelar")
    );
    root.replaceChildren(el("div", { class: "scrim" }, box));
    input.focus();
  });

  // src/cloud.js
  var GH_API = "https://api.github.com";
  var AUTH_KEY = "cartucho.github";
  var cloud = { db: false, docs: /* @__PURE__ */ new Map(), roms: /* @__PURE__ */ new Map(), ready: false, downloads: true, assets: false, auth: null, index: null, indexSha: null, saveShas: /* @__PURE__ */ new Map() };
  var busy = /* @__PURE__ */ new Map();
  var MAX_DOC = 900 * 1024;
  function loadAuth() {
    try {
      const a = JSON.parse(ls.get(AUTH_KEY) || "null");
      if (a && a.kind === "google") return a;
      if (a && a.token && a.owner && a.repo) return a;
    } catch (e) {
    }
    return null;
  }
  var isGoogle = () => !!(cloud.auth && cloud.auth.kind === "google");
  var cloudName = () => isGoogle() ? "Google Drive" : "GitHub";
  function saveAuth(a) {
    ls.set(AUTH_KEY, JSON.stringify(a));
  }
  function clearAuth() {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch (e) {
    }
  }
  async function gh(path, opts = {}, auth = cloud.auth) {
    const headers = {
      Authorization: "Bearer " + auth.token,
      Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (opts.body) headers["Content-Type"] = "application/json";
    const r = await fetch(GH_API + path, { method: opts.method || "GET", body: opts.body, headers, cache: "no-store", keepalive: !!opts.keepalive });
    if (!r.ok) {
      const e = new Error("github " + r.status);
      e.status = r.status;
      throw e;
    }
    if (opts.raw) return r;
    return r.status === 204 ? null : r.json();
  }
  var contents = (p, auth = cloud.auth) => `/repos/${auth.owner}/${auth.repo}/contents/${p}`;
  var utf8 = { enc: (s) => new TextEncoder().encode(s), dec: (u) => new TextDecoder().decode(u) };
  async function readJson(p) {
    if (isGoogle()) return drive.readJson(p);
    try {
      const r = await gh(contents(p));
      return { sha: r.sha, data: JSON.parse(utf8.dec(unb64((r.content || "").replace(/\s/g, "")))) };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
  async function putFile(p, base64, sha2, message, keepalive) {
    if (isGoogle()) return drive.put(p, unb64(base64), "application/json", keepalive);
    const body = { message, content: base64 };
    if (sha2) body.sha = sha2;
    const json = JSON.stringify(body);
    const r = await gh(contents(p), { method: "PUT", body: json, keepalive: !!keepalive && json.length < 6e4 });
    return r && r.content ? r.content.sha : null;
  }
  async function listDir(dir) {
    if (isGoogle()) return drive.list(dir);
    try {
      const r = await gh(contents(dir));
      return Array.isArray(r) ? r.map((f) => ({ name: f.name })) : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }
  async function putBinary(path, bytes, message, type = "application/gzip") {
    if (isGoogle()) return drive.put(path, bytes, type);
    let sha2;
    try {
      const ex = await gh(contents(path));
      sha2 = ex && ex.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    return putFile(path, b64(bytes), sha2, message);
  }
  async function getBinary(path) {
    if (isGoogle()) return drive.download(path);
    return gh(contents(path), { raw: true });
  }
  var CONFIG = window.CARTUCHIN_CONFIG || {};
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var DRIVE = "https://www.googleapis.com/drive/v3";
  var DRIVE_UP = "https://www.googleapis.com/upload/drive/v3";
  var gauth = { client: null, waiters: [], loading: null, lastAsk: 0 };
  var googleAvailable = () => !!CONFIG.googleClientId;
  var tokenFresh = () => isGoogle() && cloud.auth.token && cloud.auth.exp - Date.now() > 6e4;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gauth.loading) gauth.loading = new Promise((res, rej) => {
      const sc = el("script", { src: "https://accounts.google.com/gsi/client", async: true });
      sc.onload = res;
      sc.onerror = () => {
        gauth.loading = null;
        rej(new Error("gis"));
      };
      document.head.append(sc);
    });
    return gauth.loading;
  }
  function gisClient() {
    if (gauth.client || !(window.google && google.accounts && google.accounts.oauth2)) return gauth.client;
    gauth.client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        const ws = gauth.waiters.splice(0);
        if (!resp || resp.error || !resp.access_token) {
          ws.forEach((w) => w.rej(new Error(resp && resp.error || "denied")));
          return;
        }
        const o2 = google.accounts.oauth2;
        if (o2.hasGrantedAllScopes && !o2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
          ws.forEach((w) => w.rej(new Error("scope")));
          return;
        }
        cloud.auth = { ...isGoogle() ? cloud.auth : {}, kind: "google", token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1e3 };
        saveAuth(cloud.auth);
        ws.forEach((w) => w.res(cloud.auth.token));
      },
      error_callback: (err) => {
        gauth.waiters.splice(0).forEach((w) => w.rej(new Error(err && err.type || "popup")));
      }
    });
    return gauth.client;
  }
  function askGoogleToken(first, consent) {
    const c = gisClient();
    if (!c) return Promise.reject(new Error("gis-not-ready"));
    gauth.lastAsk = Date.now();
    return new Promise((res, rej) => {
      gauth.waiters.push({ res, rej });
      c.requestAccessToken({ prompt: consent ? "consent" : first ? "select_account" : "", hint: cloud.auth && cloud.auth.email || void 0 });
    });
  }
  function needToken() {
    const e = new Error("google-token");
    e.status = 401;
    e.token = true;
    return e;
  }
  var drive = {
    files: /* @__PURE__ */ new Map(),
    // name -> { id, t }
    listedAt: 0,
    async api(url, opts = {}) {
      if (!tokenFresh()) throw needToken();
      const headers = Object.assign({ Authorization: "Bearer " + cloud.auth.token }, opts.headers || {});
      const r = await fetch(url, { method: opts.method || "GET", headers, body: opts.body, cache: "no-store", keepalive: !!opts.keepalive });
      if (r.status === 401) {
        cloud.auth.exp = 0;
        saveAuth(cloud.auth);
        throw needToken();
      }
      if (!r.ok) {
        const e = new Error("drive " + r.status);
        e.status = r.status;
        try {
          e.detail = await r.text();
        } catch (x) {
        }
        throw e;
      }
      return r;
    },
    remember(f) {
      const cur = this.files.get(f.name);
      const t = Date.parse(f.modifiedTime || 0) || Date.now();
      if (!cur || t >= cur.t) this.files.set(f.name, { id: f.id, t });
    },
    async refresh() {
      const fresh = /* @__PURE__ */ new Map();
      this.files = fresh;
      let pageToken = "";
      do {
        const q = new URLSearchParams({ spaces: "appDataFolder", pageSize: "1000", fields: "nextPageToken,files(id,name,modifiedTime)" });
        if (pageToken) q.set("pageToken", pageToken);
        const j = await (await this.api(`${DRIVE}/files?${q}`)).json();
        for (const f of j.files || []) this.remember(f);
        pageToken = j.nextPageToken || "";
      } while (pageToken);
      this.listedAt = Date.now();
    },
    async idFor(name, exact) {
      if (!this.listedAt) await this.refresh();
      const hit = this.files.get(name);
      if (hit || !exact) return hit && hit.id;
      const q = new URLSearchParams({ spaces: "appDataFolder", q: `name = '${name.replace(/'/g, "\\'")}'`, fields: "files(id,name,modifiedTime)" });
      const j = await (await this.api(`${DRIVE}/files?${q}`)).json();
      for (const f of j.files || []) this.remember(f);
      const again = this.files.get(name);
      return again && again.id;
    },
    async list(dir) {
      await this.refresh();
      return [...this.files.keys()].filter((n) => n.startsWith(dir + "/")).map((n) => ({ name: n.slice(dir.length + 1) }));
    },
    async readJson(name) {
      const id = await this.idFor(name);
      if (!id) return null;
      try {
        return { sha: id, data: await (await this.api(`${DRIVE}/files/${id}?alt=media`)).json() };
      } catch (e) {
        if (e.status === 404) {
          this.files.delete(name);
          return null;
        }
        throw e;
      }
    },
    async download(name) {
      const id = await this.idFor(name);
      if (!id) {
        const e = new Error("missing");
        e.status = 404;
        throw e;
      }
      return this.api(`${DRIVE}/files/${id}?alt=media`);
    },
    async put(name, bytes, type, keepalive) {
      const id = await this.idFor(name, true);
      if (id) {
        try {
          await this.api(`${DRIVE_UP}/files/${id}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": type }, body: bytes, keepalive: !!keepalive && bytes.length < 6e4 });
          this.files.set(name, { id, t: Date.now() });
          return id;
        } catch (e) {
          if (e.status !== 404) throw e;
          this.files.delete(name);
        }
      }
      const meta = { name, parents: ["appDataFolder"] };
      let j;
      if (bytes.length < 4 * 1024 * 1024) {
        const boundary = "cartuchin" + rid();
        const body = new Blob([`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${JSON.stringify(meta)}\r
--${boundary}\r
Content-Type: ${type}\r
\r
`, bytes, `\r
--${boundary}--`]);
        j = await (await this.api(`${DRIVE_UP}/files?uploadType=multipart&fields=id,name,modifiedTime`, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body })).json();
      } else {
        const start = await this.api(`${DRIVE_UP}/files?uploadType=resumable&fields=id,name,modifiedTime`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type }, body: JSON.stringify(meta) });
        const where = start.headers.get("Location");
        if (!where) throw new Error("no-upload-url");
        j = await (await this.api(where, { method: "PUT", headers: { "Content-Type": type }, body: bytes })).json();
      }
      this.remember({ id: j.id, name, modifiedTime: (/* @__PURE__ */ new Date()).toISOString() });
      return j.id;
    },
    async whoami() {
      const j = await (await this.api(`${DRIVE}/about?fields=user(displayName,emailAddress)`)).json();
      return j.user && (j.user.emailAddress || j.user.displayName) || "";
    }
  };
  async function updateIndex(mutate, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readJson("cartucho.json");
      const data = cur ? cur.data : { version: 1, games: {} };
      if (!data.games) data.games = {};
      mutate(data);
      try {
        const sha2 = await putFile("cartucho.json", b64(utf8.enc(JSON.stringify(data, null, 1))), cur && cur.sha, message);
        cloud.index = data;
        cloud.indexSha = sha2;
        return data;
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        await sleep(400 + Math.random() * 600);
      }
    }
    throw new Error("index-conflict");
  }
  async function refreshLibrary() {
    if (!cloud.auth) return;
    const idx = await readJson("cartucho.json");
    cloud.index = idx ? idx.data : { version: 1, games: {} };
    cloud.indexSha = idx && idx.sha;
    cloud.roms.clear();
    for (const [key, g] of Object.entries(cloud.index.games || {})) if (g && g.rom) cloud.roms.set(key, { game: key, ...g });
    const files = await listDir("saves");
    const docs = await Promise.all(files.filter((f) => f.name.endsWith(".json")).map(async (f) => {
      try {
        const r = await readJson("saves/" + f.name);
        return r && r.data && r.data.game ? r : null;
      } catch (e) {
        return null;
      }
    }));
    cloud.docs.clear();
    for (const d of docs) if (d) {
      cloud.docs.set(d.data.game, d.data);
      cloud.saveShas.set(d.data.game, d.sha);
    }
  }
  async function connect() {
    cloud.auth = loadAuth();
    if (!cloud.auth) {
      cloud.ready = true;
      showConnect();
      return;
    }
    if (isGoogle()) {
      await connectGoogle();
      handlePairLink();
      return;
    }
    try {
      await gh(`/repos/${cloud.auth.owner}/${cloud.auth.repo}`);
      cloud.db = true;
      cloud.assets = true;
      await refreshLibrary();
    } catch (e) {
      cloud.db = false;
      cloud.assets = false;
      if (e.status === 401 || e.status === 403 || e.status === 404) {
        $("#notice").dataset.sticky = "1";
        notice('O GitHub recusou a conexão: o token pode ter vencido ou perdido o acesso ao repositório. Conecte de novo em "Conexão com o GitHub", lá embaixo.', "err");
      } else {
        $("#notice").dataset.sticky = "1";
        notice("Sem conexão com o GitHub agora. Dá para jogar o que já está neste aparelho; o save sobe quando a internet voltar.");
      }
    }
    cloud.ready = true;
    render();
    handlePairLink();
  }
  async function connectGoogle() {
    if (googleAvailable()) loadGis().then(gisClient).catch(() => {
    });
    if (!tokenFresh()) {
      cloud.db = false;
      cloud.ready = true;
      googleNeedsTap(true);
      render();
      return;
    }
    try {
      if (!cloud.auth.email) {
        cloud.auth.email = await drive.whoami();
        saveAuth(cloud.auth);
      }
      cloud.db = true;
      cloud.assets = true;
      googleNeedsTap(false);
      await refreshLibrary();
    } catch (e) {
      cloud.db = false;
      if (e.token) googleNeedsTap(true);
      else driveProblem(e);
    }
    cloud.ready = true;
    render();
  }
  function driveReason(e) {
    try {
      const j = JSON.parse(e.detail || "{}").error || {};
      return { reason: (j.errors && j.errors[0] && j.errors[0].reason || j.status || "") + " " + (j.details || []).map((d) => d.reason).join(" "), message: j.message || "" };
    } catch (x) {
      return { reason: "", message: "" };
    }
  }
  function driveProblem(e) {
    const n = $("#notice"), { reason, message } = driveReason(e);
    n.dataset.sticky = "1";
    n.className = "notice err";
    n.hidden = false;
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(message)) {
      const proj = (message.match(/project (\d+)/) || [])[1];
      n.replaceChildren(
        el("span", {}, "A API do Google Drive não está ativada no projeto do app no Google Cloud. "),
        proj ? el("a", { href: `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${proj}`, target: "_blank", rel: "noopener" }, "Ativar a API do Drive") : "",
        el("span", {}, " Depois de ativar, espere um minuto e recarregue a página.")
      );
    } else if (/insufficient|SCOPE/i.test(reason)) {
      n.replaceChildren(
        el("span", {}, "O Google não deu acesso à pasta do app no Drive. Entre de novo e deixe marcada a permissão do Google Drive. "),
        el("button", { class: "btn small", type: "button", onclick: () => askGoogleToken(false, true).then(() => location.reload(), () => {
        }) }, "Entrar de novo")
      );
    } else if (e.status) {
      n.replaceChildren(el("span", {}, `O Google Drive respondeu com erro ${e.status}${message ? ": " + message : ""}. Dá para jogar o que já está neste aparelho.`));
    } else {
      n.textContent = "Sem conexão com o Google Drive agora. Dá para jogar o que já está neste aparelho; o save sobe quando a internet voltar.";
    }
  }
  function googleNeedsTap(on) {
    cloud.needTap = on;
    const n = $("#notice");
    if (on) {
      n.dataset.sticky = "1";
      n.className = "notice";
      n.hidden = false;
      n.replaceChildren(
        el("span", {}, "Sua sessão do Google expirou. Os saves ficam guardados aqui até você reconectar. "),
        el("button", { class: "btn small primary", type: "button", onclick: reconnectGoogle }, "Reconectar")
      );
    } else if (n.dataset.sticky === "1" && n.querySelector("button")) {
      n.dataset.sticky = "";
      n.hidden = true;
    }
  }
  function reconnectGoogle() {
    askGoogleToken(false).then(afterGoogleToken, () => toast("Não deu para reconectar. Tente de novo.", 3500));
  }
  async function afterGoogleToken() {
    googleNeedsTap(false);
    if (player.key) {
      cloud.db = true;
      flush();
    } else await connectGoogle();
  }
  window.addEventListener("pointerdown", (e) => {
    if (!isGoogle() || tokenFresh() || !gauth.client || Date.now() - gauth.lastAsk < 2e4) return;
    const target = (
      /** @type {HTMLElement} */
      e.target
    );
    if (!$("#library").hidden || target.closest && target.closest(".pbar, .pad-top")) {
      askGoogleToken(false).then(afterGoogleToken, () => {
      });
    }
  }, true);
  async function getSaveDoc(key) {
    const r = await readJson("saves/" + key + ".json");
    if (r) {
      cloud.saveShas.set(key, r.sha);
      return r.data;
    }
    cloud.saveShas.delete(key);
    return null;
  }
  async function writeCloud(key, meta, sav, savSha, opts = {}) {
    const packed = await pack(sav);
    let cur = cloud.docs.get(key) || null, known = cloud.saveShas.has(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!known) {
        cur = await getSaveDoc(key);
        known = true;
      }
      const doc = {
        game: key,
        title: meta.title,
        system: meta.system,
        code: meta.code || "",
        enc: packed.enc,
        data: packed.data,
        size: sav.length,
        sha: savSha,
        rev: rid(),
        at: Date.now(),
        device: device.name,
        prev: null
      };
      if (cur && cur.data && cur.sha !== savSha) {
        doc.prev = { enc: cur.enc, data: cur.data, size: cur.size, sha: cur.sha, rev: cur.rev, at: cur.at, device: cur.device };
      } else if (cur && cur.prev) doc.prev = cur.prev;
      if (JSON.stringify(doc).length > MAX_DOC) doc.prev = null;
      try {
        const sha2 = await putFile(
          "saves/" + key + ".json",
          b64(utf8.enc(JSON.stringify(doc))),
          cloud.saveShas.get(key),
          `Save: ${meta.title} (${device.name})`,
          opts.keepalive
        );
        cloud.saveShas.set(key, sha2);
        cloud.docs.set(key, doc);
        render();
        return doc;
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        known = false;
        await sleep(300 + Math.random() * 500);
      }
    }
    throw new Error("save-conflict");
  }
  function setBusy(key, msg) {
    if (msg) busy.set(key, msg);
    else busy.delete(key);
    render();
  }
  async function uploadRom(rom) {
    if (!cloud.db || busy.has(rom.key)) return false;
    setBusy(rom.key, `Guardando a ROM no ${cloudName()}…`);
    try {
      const raw = new Uint8Array(await rom.blob.arrayBuffer());
      const s = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
      const gz = new Uint8Array(await new Response(s).arrayBuffer());
      const path = "roms/" + rom.key + ".gz";
      if (!isGoogle() && gz.length > 70 * 1024 * 1024) {
        setBusy(rom.key, null);
        toast(`${rom.title}: ROM grande demais para o GitHub. Ela fica só neste aparelho (o save sincroniza normal).`, 5e3);
        return false;
      }
      await putBinary(path, gz, `ROM: ${rom.title}`);
      await updateIndex((d) => {
        const prev = d.games[rom.key] || {};
        d.games[rom.key] = {
          ...prev,
          title: prev.title || rom.title,
          cover: prev.cover !== void 0 ? prev.cover : rom.cover || null,
          system: rom.system,
          code: rom.code || "",
          ext: rom.ext,
          fileName: rom.fileName || "",
          size: raw.length,
          rom: path,
          romAt: Date.now(),
          romDevice: device.name
        };
      }, `Biblioteca: ${rom.title}`);
      cloud.roms.set(rom.key, { game: rom.key, ...cloud.index.games[rom.key] });
      setBusy(rom.key, null);
      toast(`${rom.title}: ROM guardada no ${cloudName()}`);
      return true;
    } catch (e) {
      setBusy(rom.key, null);
      toast(e.token ? "Reconecte ao Google para guardar a ROM." : e.status === 403 && isGoogle() ? "O Google Drive recusou: pode ser falta de espaço na sua conta." : e.status === 401 || e.status === 403 ? "O token não tem permissão de escrita no repositório." : "Não deu para guardar a ROM agora. Tente de novo.", 4e3);
      return false;
    }
  }
  async function fetchRom(key) {
    const meta = cloud.roms.get(key);
    if (!meta || !cloud.auth) return null;
    setBusy(key, "Baixando a ROM…");
    try {
      const r = await getBinary(meta.rom);
      const total = Number(r.headers.get("content-length")) || 0;
      let got = 0;
      const chunks = [];
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader();
        for (; ; ) {
          const { done, value } = await rd.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          if (total) setBusy(key, `Baixando a ROM… ${Math.round(got / total * 100)}%`);
        }
      } else chunks.push(new Uint8Array(await r.arrayBuffer()));
      const s = new Blob(chunks).stream().pipeThrough(new DecompressionStream("gzip"));
      const bytes = new Uint8Array(await new Response(s).arrayBuffer());
      const rom = {
        key,
        title: meta.title,
        system: meta.system,
        code: meta.code,
        ext: meta.ext || "gba",
        fileName: meta.fileName,
        size: bytes.length,
        addedAt: Date.now(),
        blob: new Blob([bytes])
      };
      await idb.put("roms", key, rom).catch(() => {
      });
      await loadRoms();
      setBusy(key, null);
      return rom;
    } catch (e) {
      setBusy(key, null);
      toast("Não deu para baixar a ROM. Confira a internet e tente de novo.", 4e3);
      return null;
    }
  }

  // src/ui/game-menu.js
  var ffState = { ratio: 1, last: Number(ls.get("cartucho.ff") || 2) };
  function setSpeed(r) {
    const gm = player.emu && player.emu.gameManager;
    if (!gm) return;
    r = Number(r) || 1;
    try {
      if (r > 1) {
        gm.setFastForwardRatio(r);
        gm.toggleFastForward(1);
        ffState.last = r;
        ls.set("cartucho.ff", String(r));
      } else gm.toggleFastForward(0);
    } catch (e) {
    }
    ffState.ratio = r;
    const ff = $("#padFF");
    ff.textContent = (r > 1 ? r : ffState.last) + "x";
    ff.setAttribute("aria-pressed", r > 1 ? "true" : "false");
    for (const b of $$("#ffModes button")) b.classList.toggle("primary", Number(b.dataset.ff) === r);
  }
  $("#padFF").addEventListener("click", () => setSpeed(ffState.ratio > 1 ? 1 : ffState.last));
  $("#ffModes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ff]");
    if (b) {
      setSpeed(b.dataset.ff);
      fillGameMenu();
    }
  });
  function fillGameMenu() {
    const emu = player.emu, acts = $("#gmActions");
    acts.replaceChildren(...[
      sheetAction(emu && emu.paused ? "play" : "pause", emu && emu.paused ? "Continuar o jogo" : "Pausar", () => {
        try {
          emu.paused ? emu.play() : emu.pause();
        } catch (e) {
        }
        fillGameMenu();
      }),
      sheetAction(emu && emu.muted ? "sound" : "mute", emu && emu.muted ? "Ligar o som" : "Tirar o som", () => {
        try {
          emu.muted ? (emu.muted = false, emu.setVolume(emu.volume || 0.5)) : (emu.muted = true, emu.setVolume(0));
        } catch (e) {
        }
        fillGameMenu();
      }),
      sheetAction("save", "Salvar progresso na nuvem", () => {
        closeSheets();
        $("#saveNowBtn").click();
      }),
      sheetAction("download", "Carregar o save da nuvem", () => {
        closeSheets();
        $("#pullBtn").click();
      }),
      ...player.isDs ? dsMenuItems(emu, fillGameMenu).map((it) => sheetAction(it.icon, it.label, it.fn)) : [],
      player.isDs ? null : sheetAction("sliders", $("#player").classList.contains("show-ejs") ? "Esconder opções do emulador" : "Opções avançadas do emulador", () => {
        const on = !$("#player").classList.contains("show-ejs");
        $("#player").classList.toggle("show-ejs", on);
        closeSheets();
        if (on) toast("As opções do emulador aparecem na barra embaixo da imagem do jogo", 3500);
      }),
      sheetAction("restart", "Reiniciar o jogo", async () => {
        closeSheets();
        const ok = await dialog(
          "Reiniciar o jogo?",
          "O jogo volta para a tela de título. O que não foi salvo dentro do jogo se perde.",
          [{ label: "Reiniciar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]
        );
        if (ok) try {
          emu.gameManager.restart();
        } catch (e) {
        }
      }, true)
    ].filter(Boolean));
    setSpeed(ffState.ratio);
  }
  function openGameMenu() {
    if (!player.emu) return;
    fillGameMenu();
    openSheet("gameMenu");
  }
  $("#padMenu").addEventListener("click", openGameMenu);
  $("#menuBtn").addEventListener("click", openGameMenu);
  $("#gmClose").addEventListener("click", closeSheets);

  // src/player/reset.js
  if (ls.get("cartucho.reset.v1") !== "done") {
    resetEmulatorSettings();
    ls.set("cartucho.reset.v1", "done");
  }

  // src/ui/library-gamepad.js
  (() => {
    let was = {}, last = 0;
    function targets() {
      const root = $("#dialogRoot").firstElementChild || $$(".sheet").find((x) => !x.hidden) || $("#library");
      return [...root.querySelectorAll("button:not([disabled]), input[type=text]")].filter((n) => n.offsetParent !== null);
    }
    function move(step) {
      const list = targets();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const n = list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + step))];
      n.focus();
      try {
        n.scrollIntoView({ block: "nearest" });
      } catch (e) {
      }
    }
    function tick(t) {
      requestAnimationFrame(tick);
      if (!$("#player").hidden || !$("#screen").hidden || t - last < 60) return;
      last = t;
      let pad = null;
      try {
        pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
      } catch (e) {
      }
      if (!pad) {
        was = {};
        return;
      }
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), ax = pad.axes || [];
      const now = { up: b(12) || ax[1] < -0.6, down: b(13) || ax[1] > 0.6, left: b(14) || ax[0] < -0.6, right: b(15) || ax[0] > 0.6, a: b(0), b: b(1) };
      const edge = (k) => now[k] && !was[k];
      if (edge("up") || edge("left")) move(-1);
      if (edge("down") || edge("right")) move(1);
      if (edge("a") && document.activeElement && document.activeElement.tagName === "BUTTON") document.activeElement.click();
      if (edge("b")) {
        const btns = targets();
        if ($("#dialogRoot").firstElementChild && btns.length) btns[btns.length - 1].click();
      }
      was = now;
    }
    if (navigator.getGamepads) requestAnimationFrame(tick);
    window.addEventListener("gamepadconnected", () => {
      if ($("#player").hidden && !document.activeElement.matches("button")) move(0);
    });
  })();

  // src/main.js
  $("#connectBtn").addEventListener("click", () => {
    showWelcome();
    window.scrollTo(0, 0);
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {
  });
  (async () => {
    if (!APP_V || sessionStorage.getItem("cartucho.reloaded") === APP_V) return;
    try {
      const r = await fetch("version.txt?t=" + Date.now(), { cache: "no-store" });
      const latest = (await r.text()).trim();
      if (r.ok && /^\d{14}$/.test(latest) && latest > APP_V) {
        sessionStorage.setItem("cartucho.reloaded", APP_V);
        if ("caches" in window) {
          try {
            for (const k of await caches.keys()) await caches.delete(k);
          } catch (e) {
          }
        }
        location.reload();
      }
    } catch (e) {
    }
  })();
  handleScreenLink();
  {
    const m = location.hash.match(/^#diagnostico(?::([a-z,]+))?$/);
    if (m) {
      diag.only = m[1] ? m[1].split(",") : null;
      try {
        history.replaceState(null, "", location.pathname);
      } catch (e) {
      }
      setTimeout(runDiagnostic, 300);
    }
  }
  (async () => {
    if (dsPage) {
      if (!window.crossOriginIsolated && "serviceWorker" in navigator && !sessionStorage.getItem("cartucho.dsIso")) {
        sessionStorage.setItem("cartucho.dsIso", "1");
        try {
          await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 3e3))]);
          if (navigator.serviceWorker.controller) {
            location.reload();
            return;
          }
        } catch (e) {
        }
      }
      $("#library").hidden = true;
    }
    await loadRoms();
    await connect();
    if (dsPage) {
      play(dsPage);
      return;
    }
    identifyOldRoms();
  })();
})();
