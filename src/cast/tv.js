import { iceDone, keepAwake, readPad, signal } from "./common.js";
import { KEYCODES, KEYMAP, RTC_CONFIG, keysDown } from "./constants.js";
import { chromeVer } from "./phone.js";
import { newPairCode } from "../connect.js";
import { $, appUrl } from "../util.js";

/* ---------- TV side ---------- */
/** Everything the TV holds while acting as the screen. */
const tvScreen = window.__tvScreen = {
  active: false,
  /** @type {string | null} the pairing code shown on screen */ code: null,
  /** @type {RTCPeerConnection | null} */ pc: null,
  /** @type {RTCDataChannel | null} control channel */ dc: null,
  /** @type {(() => void) | null} stops listening for offers */ stopListen: null,
  /** @type {AudioContext | null} created on the "Usar como tela" tap, so sound is allowed */ ac: null,
  /** @type {MediaStreamAudioSourceNode | null} */ audioSrc: null,
  /** @type {ReturnType<typeof setInterval> | null} the diagnostic check */ watch: null,
  /** @type {any} last report from the phone */ phoneStats: null,
  /** @type {any} */ view: null,   // DS: como ampliar ({ mode, grid }), mandado pelo celular
  /** @type {any} */ gl: undefined, // ampliação WebGL (null = indisponível)
  gen: 0,             // bumped on every new connection; loops of an older one stop
  sharp: false,       // drawing the video into the pixel-sharp canvas
  drawnSharp: 0,
  framesMode: false,  // "quadros" mode: JPEG frames over the data channel
  drawn: 0,
  padTimer: null,
  /** @type {ReturnType<typeof setInterval> | null} */ pingTimer: null,
  /** @type {number[]} control channel round trips (ms) */ rtt: [],
  /** @type {number[]} "quadros" mode: arrival → drawn (ms) */ decMs: [],
  lastSent: -1,       // last button mask sent to the phone
};
async function startScreen() {
  tvScreen.active = true;
  // created inside the click, so the TV browser lets it play sound later
  try {
    tvScreen.ac = new (window.AudioContext || window.webkitAudioContext)();
    tvScreen.ac.resume().catch(() => {});
  } catch (e) { tvScreen.ac = null; }
  $("#library").hidden = true;
  $("#screen").hidden = false;
  keepAwake();
  try { await document.documentElement.requestFullscreen(); } catch (e) {}
  tvScreen.code = newPairCode();
  const link = appUrl() + "#tela-" + tvScreen.code;
  $("#scrCode").textContent = tvScreen.code.slice(0, 4) + " " + tvScreen.code.slice(4);
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    $("#scrQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) {}
  showWaiting(true);
  const sig = await signal(tvScreen.code);
  const handled = new Set();
  tvScreen.stopListen = sig.listen("oferta", async (msg) => {
    if (!msg.sdp || !msg.id || handled.has(msg.id)) return;
    handled.add(msg.id);
    closeScreenConnection();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    tvScreen.pc = pc;
    $("#scrStatus").textContent = `Conectando com ${msg.from || "o celular"}…`;
    pc.ontrack = (e) => {
      const v = $("#scrVideo"), st = e.streams[0];
      // the picture is a muted video (muted video always autoplays);
      // the sound goes through Web Audio, which was unlocked by the "Usar como tela" click
      v.muted = true;
      if (v.srcObject !== st) v.srcObject = st;
      try { e.receiver.jitterBufferTarget = 30; } catch (x) {}
      try { e.receiver.playoutDelayHint = 0; } catch (x) {}
      playScreenVideo();
      if (e.track.kind === "audio") {
        const ac = tvScreen.ac;
        if (ac) {
          try { if (tvScreen.audioSrc) tvScreen.audioSrc.disconnect(); } catch (x) {}
          tvScreen.audioSrc = ac.createMediaStreamSource(new MediaStream([e.track]));
          tvScreen.audioSrc.connect(ac.destination);
          if (ac.state !== "running") ac.resume().then(() => {}, () => { $("#scrTap").hidden = false; });
          setTimeout(() => { if (ac.state !== "running") $("#scrTap").hidden = false; }, 1500);
        } else {
          v.muted = false;
          v.play().catch(() => { $("#scrTap").hidden = false; });
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
      // first thing: tell the phone what this TV can decode, so it can pick the format
      const hello = () => { try { e.channel.send(JSON.stringify({ hello: { vp8: !!window.VideoDecoder } })); } catch (x) {} };
      if (e.channel.readyState === "open") hello(); else e.channel.onopen = hello;
      // the phone reports what it is sending, so the TV can show both ends in one place
      e.channel.onmessage = (m) => { try {
        const d = JSON.parse(m.data);
        if (d && d.st) tvScreen.phoneStats = d.st;
        // DS: a imagem já vem ampliada do celular; no modo "suave" a TV também amplia suave
        if (d && d.view) { tvScreen.view = d.view; $("#screen").classList.toggle("smooth", !!d.view.smooth); }
        if (d && d.pong) { tvScreen.rtt.push(performance.now() - d.pong); if (tvScreen.rtt.length > 10) tvScreen.rtt.shift(); }
      } catch (x) {} };
    };
    pc.onconnectionstatechange = () => {
      if (pc !== tvScreen.pc) return;
      if (pc.connectionState === "connected") {
        showWaiting(false);
        playScreenVideo();
        if (!tvScreen.framesMode) drawVideoSharp();
        watchScreen(pc);
      }
      else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
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
    } catch (e) { $("#scrStatus").textContent = "Não deu para conectar. Tente de novo no celular."; }
  });
  clearInterval(tvScreen.padTimer);
  let lastBeat = 0;
  const tick = () => {
    if (!tvScreen.active) return;
    requestAnimationFrame(tick);
    const dc = tvScreen.dc;
    if (!dc || dc.readyState !== "open") return;
    const mask = readPad(), now = performance.now();
    if ((mask & 128) && $("#scrVideo").paused && $("#scrVideo").srcObject) {
      $("#scrVideo").play().catch(() => {});
      $("#scrTap").hidden = true;
    }
    // the channel never resends lost packets (that would add delay), so every change is
    // sent three times in quick succession and the current state is repeated 10x a second
    const send = () => { try { dc.send(String(tvScreen.lastSent)); } catch (e) {} };
    if (mask !== tvScreen.lastSent) {
      tvScreen.lastSent = mask;
      send();
      setTimeout(send, 15);
      setTimeout(send, 40);
      lastBeat = now;
    }
    else if (now - lastBeat > 100) {
      send();
      lastBeat = now;
    }
  };
  requestAnimationFrame(tick);
}
/* average brightness (0-255) of a picture, through a tiny canvas; -1 if it can't be read */
/** @type {HTMLCanvasElement | null} */
let brightnessCanvas = null;
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
  } catch (e) { return -1; }
}
/* "quadros" mode on the TV. Each message is one encoded frame (9-byte header: key
   flag + timestamp, see packFrame). VP8 goes through a WebCodecs VideoDecoder; JPEG
   through createImageBitmap. Decoding is async, so while one frame decodes the newest
   arrival waits and older ones are dropped. After an error or a dropped delta frame,
   the TV asks the phone for a key frame and skips everything until it comes. */
function receiveFrames(channel) {
  const canvas = $("#scrCanvas"), g = canvas.getContext("2d", { alpha: false });
  tvScreen.framesMode = true; tvScreen.sharp = false;
  canvas.hidden = false; $("#scrVideo").hidden = true;
  channel.binaryType = "arraybuffer";

  let decodeStart = 0;
  function show(img) {
    if (decodeStart) { tvScreen.decMs.push(performance.now() - decodeStart); if (tvScreen.decMs.length > 20) tvScreen.decMs.shift(); }
    const w = img.displayWidth || img.width, h = img.displayHeight || img.height;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.drawImage(img, 0, 0);
    if (img.close) img.close();
    tvScreen.drawn++;
  }
  function askKeyFrame() {
    if (tvScreen.dc && tvScreen.dc.readyState === "open") { try { tvScreen.dc.send(JSON.stringify({ key: 1 })); } catch (e) {} }
  }

  /** @type {any} */ let decoder = null;
  let waitingKey = true;
  function vp8Decoder() {
    const d = new window.VideoDecoder({
      output: show,
      error: () => { waitingKey = true; decoder = null; askKeyFrame(); },
    });
    d.configure({ codec: "vp8", optimizeForLatency: true });
    return d;
  }
  const isJpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8;

  let pending = null, decoding = false;
  async function drawNext() {
    if (decoding || !pending) return;
    const buf = pending; pending = null; decoding = true;
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
    } catch (e) { waitingKey = true; askKeyFrame(); }
    decoding = false;
    drawNext();
  }
  channel.onmessage = (m) => { pending = m.data; drawNext(); };
  channel.onclose = () => { try { decoder && decoder.close(); } catch (e) {} };
}
/* The stream is the GBA's own 240x160. Drawn into a canvas of that size and enlarged by
   CSS with pixelated scaling, the pixels stay sharp (a <video> is always smoothed when
   enlarged). The video stays underneath: if the canvas gets nothing in 3 s, it is hidden
   and the video shows. */
/* DS: ampliação na própria TV (WebGL). O vídeo chega com cada pixel do DS em um bloco
   grid x grid (2x evita que a compressão de cor do vídeo borre pixels de 1 de largura).
   O shader lê o centro de cada bloco (volta ao pixel original) e amplia 4x: exato
   ("nitida"/"x1") ou Scale2x/EPX ("suave", depois o CSS suaviza o resto). */
function tvUpscaler() {
  if (tvScreen.gl !== undefined) return tvScreen.gl;
  tvScreen.gl = null;
  const canvas = document.createElement("canvas");
  canvas.id = "scrGl";
  canvas.hidden = true;
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const vs = "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
  const fs = `precision highp float;
varying vec2 uv;
uniform sampler2D t;
uniform vec2 vid;        // tamanho do vídeo
uniform float grid;      // pixels do vídeo por pixel do jogo
uniform bool epx;
vec3 px(vec2 c) { vec2 n = vid / grid; c = clamp(c, vec2(0.0), n - 1.0); return texture2D(t, (c * grid + grid * 0.5) / vid).rgb; }
bool eq(vec3 a, vec3 b) { return all(lessThan(abs(a - b), vec3(0.06))); }
void main() {
  vec2 s = uv * vid / grid, c = floor(s);
  vec3 E = px(c);
  if (!epx) { gl_FragColor = vec4(E, 1.0); return; }
  vec3 A = px(c + vec2(0.0, -1.0)), B = px(c + vec2(1.0, 0.0)), C = px(c + vec2(-1.0, 0.0)), D = px(c + vec2(0.0, 1.0));
  vec2 f = s - c;
  vec3 o = E;
  if (f.y < 0.5) {
    if (f.x < 0.5) { if (eq(C, A) && !eq(C, D) && !eq(A, B)) o = A; }
    else { if (eq(A, B) && !eq(A, C) && !eq(B, D)) o = B; }
  } else {
    if (f.x < 0.5) { if (eq(D, C) && !eq(D, B) && !eq(C, A)) o = C; }
    else { if (eq(B, D) && !eq(B, A) && !eq(D, C)) o = D; }
  }
  gl_FragColor = vec4(o, 1.0);
}`;
  try {
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const uVid = gl.getUniformLocation(prog, "vid"), uGrid = gl.getUniformLocation(prog, "grid"), uEpx = gl.getUniformLocation(prog, "epx");
    $("#screen").appendChild(canvas);
    tvScreen.gl = {
      canvas,
      draw(video, view) {
        const vw = video.videoWidth, vh = video.videoHeight, grid = Math.max(1, view.grid | 0);
        // 4 pixels de saída por pixel do jogo (o resto da ampliação até a TV é do CSS)
        const ow = Math.round(vw / grid) * 4, oh = Math.round(vh / grid) * 4;
        if (canvas.width !== ow || canvas.height !== oh) { canvas.width = ow; canvas.height = oh; }
        gl.viewport(0, 0, ow, oh);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); } catch (e) { return false; }
        gl.uniform2f(uVid, vw, vh);
        gl.uniform1f(uGrid, grid);
        gl.uniform1i(uEpx, view.mode === "suave" && grid > 1 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return true;
      },
    };
  } catch (e) { console.warn("[tv] ampliação WebGL", e); }
  return tvScreen.gl;
}
window.__tvUpscaler = tvUpscaler;   // usado pelo teste automático
function drawVideoSharp() {
  const v = $("#scrVideo"), canvas = $("#scrCanvas");
  if (tvScreen.sharp) return;
  const g = canvas.getContext("2d", { alpha: false });
  const started = performance.now();
  tvScreen.sharp = true;
  tvScreen.drawnSharp = 0;
  const gen = tvScreen.gen;                         // a new connection ends this loop
  canvas.hidden = false;
  function frame() {
    if (!tvScreen.active || gen !== tvScreen.gen) {
      if (gen === tvScreen.gen) tvScreen.sharp = false;
      return;
    }
    const view = tvScreen.view;
    const glr = view && view.grid && v.readyState >= 2 && v.videoWidth ? tvUpscaler() : null;
    if (glr) {
      // DS: o celular manda a imagem crua (2x ou resolução interna); a TV amplia aqui
      if (glr.draw(v, view)) tvScreen.drawnSharp++;
      glr.canvas.hidden = false;
      canvas.hidden = true;
    } else if (v.readyState >= 2 && v.videoWidth) {
      if (tvScreen.gl) tvScreen.gl.canvas.hidden = true;
      canvas.hidden = false;
      if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
      }
      try {
        g.drawImage(v, 0, 0, canvas.width, canvas.height);
        tvScreen.drawnSharp++;
      } catch (e) {}
    }
    if (tvScreen.drawnSharp === 0 && performance.now() - started > 3000) {
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
/* Checks every 2 s that the picture is really arriving and playing. It never hides the
   picture: when something is off it only shows, in a corner, what each end is doing
   (frames the phone sent, frames this TV received and decoded, video state), so a
   photo of the TV says where it stops. It also shows for the first seconds. */
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
    /** @type {any} */ let rx = null;
    /** @type {any} */ let arx = null;
    /** @type {any} */ let pair = null;
    let codec = "", all = new Map();
    try {
      const stats = await pc.getStats();
      stats.forEach((x) => {
        all.set(x.id, x);
        if (x.type === "inbound-rtp" && (x.kind || x.mediaType) === "video") rx = x;
        if (x.type === "inbound-rtp" && (x.kind || x.mediaType) === "audio") arx = x;
        if (x.type === "candidate-pair" && x.nominated && x.state === "succeeded") pair = x;
      });
      if (rx && rx.codecId && all.get(rx.codecId)) codec = (all.get(rx.codecId).mimeType || "").replace("video/", "");
    } catch (e) {}
    // network: packets lost since the last check, round trip, and which path the pair took
    const got = rx ? rx.packetsReceived || 0 : 0, lost = rx ? Math.max(0, rx.packetsLost || 0) : 0;
    const dGot = got - (net.got || 0), dLost = lost - (net.lost || 0);
    net.got = got;
    net.lost = lost;
    const lossPct = dGot + dLost > 0 ? Math.round((100 * dLost) / (dGot + dLost)) : 0;
    const rtt = pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
    const lc = pair && all.get(pair.localCandidateId), rc = pair && all.get(pair.remoteCandidateId);
    const types = lc && rc ? [lc.candidateType, rc.candidateType] : [];
    const path = !types.length ? "?" : types.includes("relay") ? "por um servidor" : types.includes("srflx") ? "pelo IP público do roteador" : "rede local, direto";
    net.bad = lossPct >= 5 ? (net.bad || 0) + 1 : 0;
    if (net.bad === 2 && !net.warned) {
      net.warned = true;
      net.warnPct = lossPct;
      net.warnUntil = performance.now() + 9000;
    }
    const frames = tvScreen.framesMode;                        // "quadros" mode: the picture comes over the data channel
    const dec = frames ? tvScreen.drawn : (rx ? rx.framesDecoded || 0 : 0);
    still = dec === lastDec ? still + 1 : 0;
    lastDec = dec;
    if (tvScreen.dc && tvScreen.dc.readyState === "open") { try { tvScreen.dc.send(JSON.stringify({ tv: { dec, pk: got, apk: arx ? arx.packetsReceived || 0 : 0 } })); } catch (e) {} }
    const shown = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : "?";
    const glOn = tvScreen.gl && !tvScreen.gl.canvas.hidden;
    const bright = glOn ? brightness(tvScreen.gl.canvas) : frames || tvScreen.sharp ? brightness($("#scrCanvas")) : v.readyState >= 2 ? brightness(v) : -1;
    const box = v.getBoundingClientRect();
    if (v.paused && dec > 0) playScreenVideo();
    let problem = "";
    if (still >= 2) problem = dec === 0 ? "A imagem não está chegando do celular." : "A imagem parou de chegar do celular.";
    else if (!frames && v.paused) problem = "A imagem chega, mas o vídeo está parado. Toque no botão ou aperte A.";
    else if (!frames && v.readyState < 2) problem = "A imagem chega, mas esta tela ainda não começou a mostrar.";
    const ph = tvScreen.phoneStats;
    const warnNet = net.warnUntil && performance.now() < net.warnUntil;
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const ms = (v) => (v == null ? "?" : v + " ms");
    const ctl = avg(tvScreen.rtt), oneWay = ctl != null ? Math.round(ctl / 2) : null;
    const lat = (ph && ph.lat) || {};
    // TV side of the picture: jitter buffer wait + decode, from the WebRTC stats, or measured in "quadros" mode
    let tvMs = null;
    if (frames) tvMs = avg(tvScreen.decMs);
    else if (rx && rx.framesDecoded) {
      const dJb = (rx.jitterBufferDelay || 0) - (net.jbT || 0), dEm = (rx.jitterBufferEmittedCount || 0) - (net.jbN || 0);
      const dDec = (rx.totalDecodeTime || 0) - (net.decT || 0), dFr = rx.framesDecoded - (net.decN || 0);
      net.jbT = rx.jitterBufferDelay || 0; net.jbN = rx.jitterBufferEmittedCount || 0; net.decT = rx.totalDecodeTime || 0; net.decN = rx.framesDecoded;
      if (dEm > 0 && dFr > 0) tvMs = Math.round((dJb / dEm + dDec / dFr) * 1000);
    }
    const gameFrame = lat.speed ? Math.round(16.7 / Math.min(1, lat.speed / 100)) : 17;
    const parts = [lat.touch, gameFrame, lat.enc, lat.send, oneWay, tvMs];
    const known = parts.filter((x) => x != null);
    const total = known.length ? known.reduce((a, b) => a + b, 0) : null;   // of the parts measured so far
    const latencyLine = `Atraso: controle TV→celular ${ms(oneWay)} · toque→jogo ${ms(lat.touch)} · 1 quadro do jogo ${ms(gameFrame)}${lat.speed ? ` (${lat.speed}%)` : ""} · codificar ${ms(lat.enc)} · enviar ${ms(lat.send)} · rede ${ms(oneWay)} · buffer+decodificar na TV ${ms(tvMs)} · total ≈ ${ms(total)} + 1 quadro da TV`;
    const lines = [
      problem || (warnNet ? `Wi-Fi instável: ${net.warnPct}% dos pacotes se perdem. Dica: ligue o roteador do celular e conecte esta tela nele.` : "Conectado. Se a imagem não aparecer, mande uma foto desta tela."),
      `Rede: ${path}${rtt != null ? ` · ida e volta ${rtt} ms` : ""} · perda ${lossPct}%${rx && rx.jitter ? ` · variação ${Math.round(rx.jitter * 1000)} ms` : ""}`,
      latencyLine,
      ph ? `Celular: ${ph.ua || ""} · formato ${ph.mode || "?"} · enviou ${ph.sent} quadros, ${ph.pk || 0} pacotes${ph.w ? ` (${ph.w}x${ph.h})` : ""} · chaves ${ph.keys || 0} · PLI ${ph.pli || 0}${ph.enc ? ` · ${ph.enc}` : ""}${ph.lim && ph.lim !== "none" ? ` · limitado por ${ph.lim}` : ""}${ph.track && ph.track !== "live" ? ` · captura ${ph.track}` : ""}${ph.br != null && ph.br >= 0 ? ` · brilho ${ph.br}` : ""}`
         : "Celular: sem relatório ainda",
      `TV: ${chromeVer()} · pacotes de vídeo ${got}, de áudio ${arx ? arx.packetsReceived || 0 : 0} · recebeu ${rx ? rx.framesReceived || 0 : 0}, decodificou ${dec}${codec ? ` · ${codec}` : ""}${rx && rx.frameWidth ? ` · ${rx.frameWidth}x${rx.frameHeight}` : ""} · chaves ${rx ? rx.keyFramesDecoded || 0 : 0} · PLI ${rx ? rx.pliCount || 0 : 0}${rx && rx.decoderImplementation ? ` · ${rx.decoderImplementation}` : ""}`,
      frames ? `Quadros pelo canal de dados (${window.VideoDecoder ? "WebCodecs" : "JPEG"}): desenhados ${tvScreen.drawn} · brilho ${bright}` : `Vídeo: ${v.paused ? "parado" : "tocando"} · ${v.videoWidth}x${v.videoHeight} · estado ${v.readyState} · exibidos ${shown} · brilho ${bright} · ${tvScreen.sharp ? "nítido (canvas)" : "vídeo direto"} · na tela ${Math.round(box.width)}x${Math.round(box.height)} de ${innerWidth}x${innerHeight}`,
    ];
    info.textContent = lines.join("\n");
    info.hidden = !(problem || warnNet || performance.now() - t0 < 12000);
  };
  tvScreen.watch = setInterval(check, 2000);
  tvScreen.pingTimer = setInterval(() => {
    if (tvScreen.dc && tvScreen.dc.readyState === "open") { try { tvScreen.dc.send(JSON.stringify({ ping: performance.now() })); } catch (e) {} }
  }, 1000);
  setTimeout(check, 500);
}
function showWaiting(on) {
  $("#scrWait").hidden = !on;
  if (on) $("#scrStatus").textContent = "Esperando o celular…";
}
/* Forgets the phone that was connected: connection, channels, audio node, the video's
   stream and every timer. Runs before each new phone connects and when leaving. */
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
    } catch (e) {}
    tvScreen.dc = null;
  }
  if (tvScreen.audioSrc) {
    try { tvScreen.audioSrc.disconnect(); } catch (e) {}
    tvScreen.audioSrc = null;
  }
  if (tvScreen.pc) {
    const pc = tvScreen.pc;
    tvScreen.pc = null;
    try {
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;
      pc.ontrack = null;
    } catch (e) {}
    try { pc.close(); } catch (e) {}
  }
  const v = $("#scrVideo");
  if (v.srcObject) {
    try { for (const t of v.srcObject.getTracks()) t.stop(); } catch (e) {}
    v.srcObject = null;
  }
  tvScreen.phoneStats = null;
  tvScreen.lastSent = -1;
  tvScreen.drawn = 0;
  tvScreen.sharp = false;
  tvScreen.framesMode = false;
  $("#scrInfo").hidden = true;
  $("#scrCanvas").hidden = true;
  if (tvScreen.gl) tvScreen.gl.canvas.hidden = true;
  tvScreen.view = null;
  $("#scrVideo").hidden = false;
}
function stopScreen() {
  tvScreen.active = false;
  try { tvScreen.stopListen && tvScreen.stopListen(); } catch (e) {}
  closeScreenConnection();
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  location.reload();
}
$("#screenBtn").addEventListener("click", startScreen);
$("#scrExit").addEventListener("click", stopScreen);
$("#scrTap").addEventListener("click", () => {
  if (tvScreen.ac) tvScreen.ac.resume().catch(() => {});
  else $("#scrVideo").muted = false;
  $("#scrVideo").play().catch(() => {});
  $("#scrTap").hidden = true;
});
window.addEventListener("keydown", () => { if (tvScreen.ac && tvScreen.ac.state !== "running") tvScreen.ac.resume().then(() => { $("#scrTap").hidden = true; }, () => {}); }, true);
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

export { tvScreen, brightness };
