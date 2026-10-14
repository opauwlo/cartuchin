import { iceDone, keepAwake, signal, wakeAudio } from "./common.js";
import { PAD, PAD_BITS, RTC_CONFIG, STREAM_H, STREAM_W } from "./constants.js";
import { showPad } from "./pad.js";
import { frameWorkerSource } from "./frame-worker.js";
import { brightness } from "./tv.js";
import { busy } from "../cloud.js";
import { device } from "../device.js";
import { player } from "../player/player.js";
import { speed } from "../player/perf.js";
import { $, ls, rid, sleep, toast } from "../util.js";

/* ---------- phone side ---------- */
/** Everything the phone holds while transmitting to a TV. */
const cast = window.__cast = {
  /** @type {RTCPeerConnection | null} */ pc: null,
  /** @type {RTCDataChannel | null} the control channel: TV → phone buttons, phone → TV stats */ dc: null,
  /** @type {RTCDataChannel | null} "quadros" mode only: JPEG frames phone → TV */ frameChannel: null,
  /** @type {MediaStream | null} the capture of the emulator canvas */ stream: null,
  /** @type {string | null} pairing code of the TV */ code: null,
  /** @type {string | null} code received by link, used once the game is running */ pending: null,
  /** @type {number[]} order in which the formats of CAST_MODES are tried */ order: [],
  mode: 0, attempt: 0,
  /** @type {any} last report from the TV (frames decoded, packets) */ tvStats: null,
  /** @type {string | null} */ paramErr: null,
  /** @type {ReturnType<typeof setInterval> | null} */ watch: null,
  /** @type {(() => void) | null} stops the frame pump */ pumpStop: null,
  /** @type {(() => void) | null} asks the encoder for a key frame */ requestKey: null,
  /** @type {any} what the TV said it can do ({ vp8: boolean }) */ tvHello: null,
  /** @type {"vp8" | "jpeg" | null} */ frameCodec: null,
  touchAt: 0,
  pumped: 0,
  // buttons: what is pressed on this phone, what the TV sends, and what the game currently sees
  lastMask: 0, localMask: 0, remoteMask: 0,
};

/* A GBA game reads the buttons once per frame (every 16.7 ms). A quick tap on glass
   can begin and end between two reads, and then the game never sees it: that is the
   "tapped and nothing happened". So every press is held for at least MIN_HOLD.
   Directions are the exception: pressing a new direction releases the old one at
   once, so a quick turn never sends two directions together. */
const MIN_HOLD = 70;
/* latency samples (ms): touch → button in the game; encoder time in "quadros" mode */
const lag = { touch: [], enc: [] };
const avgMs = (arr, keep = 20) => { if (arr.length > keep) arr.splice(0, arr.length - keep); return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null; };
const DIR_MASK = ["UP", "DOWN", "LEFT", "RIGHT"].reduce((m, k) => m | (1 << PAD_BITS.indexOf(k)), 0);
const pressedAt = new Array(PAD_BITS.length).fill(0);
let releaseTimer = null;
function applyInput() {
  const gm = player.emu && player.emu.gameManager;
  if (!gm) return;
  const want = (cast.localMask | cast.remoteMask) >>> 0;
  const now = performance.now();
  let applied = cast.lastMask, wait = Infinity;
  PAD_BITS.forEach((k, i) => {
    const bit = 1 << i, w = want & bit, h = applied & bit;
    if (w && !h) {
      try { gm.simulateInput(0, PAD[k], 1); } catch (e) {}
      applied |= bit;
      pressedAt[i] = now;
      if (cast.touchAt) { lag.touch.push(now - cast.touchAt); cast.touchAt = 0; }
    } else if (!w && h) {
      const turning = (bit & DIR_MASK) && (want & DIR_MASK & ~bit);
      const left = turning ? 0 : pressedAt[i] + MIN_HOLD - now;
      if (left <= 0) {
        try { gm.simulateInput(0, PAD[k], 0); } catch (e) {}
        applied &= ~bit;
      }
      else wait = Math.min(wait, left);
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
  b.innerHTML = state === "on" ? "<span class=\"long\">Na </span>TV ●" : state === "wait" ? "Conectando…" : "<span class=\"long\">Jogar na </span>TV";
  b.classList.toggle("primary", state === "on");
}
/* Ends the current transmission and frees everything it held. Also runs before every
   new attempt, so nothing from an old connection (capture, encoder, channel, timers,
   muted local audio) lives on next to the new one. */
function closeCastConnection() {
  clearInterval(cast.watch);
  cast.watch = null;
  if (cast.pumpStop) {
    try { cast.pumpStop(); } catch (e) {}
    cast.pumpStop = null;
  }
  if (cast.frameChannel) {
    try { cast.frameChannel.close(); } catch (e) {}
    cast.frameChannel = null;
  }
  if (cast.dc) {
    try {
      cast.dc.onmessage = null;
      cast.dc.close();
    } catch (e) {}
    cast.dc = null;
  }
  if (cast.pc) {
    const pc = cast.pc;
    cast.pc = null;
    try {
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;
      pc.ontrack = null;
    } catch (e) {}
    try { for (const s of pc.getSenders()) { try { s.replaceTrack(null); } catch (e) {} } } catch (e) {}
    try { pc.close(); } catch (e) {}
  }
  // closing the connection does not stop the canvas capture: left running, every old
  // capture keeps copying each frame of the game, and they pile up on every reconnect
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
/* Video formats, from the best to the most compatible. TV browsers are old and each
   brand has its quirks: if the TV gets nothing it can show after a few seconds, the
   phone reconnects with the next format, and remembers the one that worked. */
const CAST_MODES = [
  { name: "VP8", red: true },
  { name: "H.264", plain: true, codecs: [/h264/i, /vp9/i] }, // TVs decode H.264 in hardware
  // no WebRTC video at all: each frame of the canvas is compressed by the phone and sent
  // over the data channel, and the TV draws it. Slower to encode, but it depends on
  // nothing the two browsers have to agree on.
  { name: "quadros", frames: true },
];
const chromeVer = () => {
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
    // capture the emulator's own canvas: no copy, no readback from the GPU
    const stream = emu.canvas.captureStream(60);
    cast.stream = stream;
    const vtrack = stream.getVideoTracks()[0];
    try { vtrack.contentHint = "motion"; } catch (e) {}
    // tuned for a so-so Wi-Fi (see test/net.js, which measures them under loss and jitter)
    const opt = { red: !!mode.red, kbps: 2500, layers: "", ...(window.__castOpts || {}) };
    let vt = null;
    if (mode.frames) {
      cast.frameChannel = pc.createDataChannel("quadros", { ordered: false, maxRetransmits: 0 });
      cast.frameChannel.binaryType = "arraybuffer";
    } else {
      if (opt.layers) { try { vt = pc.addTransceiver(vtrack, { direction: "sendonly", streams: [stream], sendEncodings: [{ scalabilityMode: opt.layers }] }); } catch (e) {} }
      if (!vt) vt = pc.addTransceiver(vtrack, { direction: "sendonly", streams: [stream] });
    }
    const prefer = (tr, kind, first) => {
      try {
        const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities(kind);
        if (!caps || !tr.setCodecPreferences) return;
        const head = first.flatMap((re) => caps.codecs.filter((c) => re.test(c.mimeType)));
        tr.setCodecPreferences([...head, ...caps.codecs.filter((c) => !head.includes(c))]);
      } catch (e) {}
    };
    // fewer RTP header extensions: an old receiver that can't parse one drops the whole packet
    const trimExt = (tr) => {
      try {
        if (!tr.getHeaderExtensionsToNegotiate) return;
        const keep = /sdes:mid|transport-wide-cc|abs-send-time/;
        tr.setHeaderExtensionsToNegotiate(tr.getHeaderExtensionsToNegotiate().map((x) => ({ uri: x.uri, direction: keep.test(x.uri) ? x.direction : "stopped" })));
      } catch (e) {}
    };
    if (vt && mode.codecs) prefer(vt, "video", mode.codecs);
    else if (vt && !mode.plain) prefer(vt, "video", [/vp8/i]);
    if (vt && mode.plain) trimExt(vt);
    const tap = (window.__audioTaps || [])[0];
    if (tap && tap.out) {
      const at = tap.out.stream.getAudioTracks()[0];
      // RED: every audio packet also carries the previous one, so a lost packet is
      // rebuilt from the next instead of becoming a crackle (what Google Meet does)
      if (at && mode.plain) pc.addTrack(at, stream);
      else if (at) prefer(pc.addTransceiver(at, { direction: "sendonly", streams: [stream] }), "audio", opt.red ? [/audio\/red/i, /opus/i] : [/opus/i]);
    }
    const dc = pc.createDataChannel("controle", { ordered: false, maxRetransmits: 0 });
    cast.dc = dc;
    dc.onmessage = (e) => {
      const d = String(e.data);
      // the TV also reports what it receives and decodes (JSON); everything else is the pad
      if (d[0] === "{") {
        try {
          const j = JSON.parse(d);
          if (j.tv) cast.tvStats = j.tv;
          if (j.hello) cast.tvHello = j.hello;
          if (j.key && cast.requestKey) cast.requestKey();
          if (j.ping) { try { dc.send(JSON.stringify({ pong: j.ping })); } catch (x) {} }   // the TV measures the control round trip
        } catch (x) {}
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
          p.encodings = (p.encodings && p.encodings.length ? p.encodings : [{}]).map((e) => ({ ...e, maxBitrate: opt.kbps * 1000, maxFramerate: 60, scaleResolutionDownBy: 1, priority: "high", networkPriority: "high" }));
          p.degradationPreference = "maintain-framerate";
          send.setParameters(p).catch((e) => { cast.paramErr = String(e); });
        } else startFramePump(vtrack, cast.frameChannel);
        watchCast(pc, vt ? vt.sender : null, dc, emu);
      } else if (pc.connectionState === "failed") stopCast("Não deu para conectar com a TV. Os dois aparelhos estão na mesma rede Wi-Fi?");
      else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") { if (cast.pc === pc) stopCast("A TV desconectou."); }
    };
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    const offerId = rid();
    const stopListen = sig.listen("resposta", async (msg) => {
      if (!msg.sdp || msg.re !== offerId || pc !== cast.pc || pc.signalingState !== "have-local-offer") return;
      stopListen();
      try { await pc.setRemoteDescription(msg.sdp); } catch (e) { stopCast("A TV respondeu de um jeito inesperado. Tente de novo."); }
    });
    await sig.send("oferta", { id: offerId, sdp: pc.localDescription.toJSON(), from: device.name });
    setTimeout(() => { if (pc === cast.pc && pc.connectionState !== "connected") {
      stopListen();
      stopCast("A TV não respondeu. Confira o código e se ela está na tela de espera.");
    } }, 25000);
  } catch (e) { stopCast("Não deu para começar a transmissão."); }
}
/* "quadros" mode: the canvas frames go to a Worker that encodes them (VP8 with
   WebCodecs, or JPEG where WebCodecs is missing) and every encoded frame is sent over
   the data channel with a 9-byte header: 1 = key frame, then the timestamp (µs).
   The TV says in its hello whether it can decode VP8; without a hello in 1.5 s the
   phone assumes it can't and sends JPEG, which any browser decodes. */
const FRAME_HEADER = 9;
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
    // very old phone: grab frames on the main thread and compress as JPEG
    await legacyJpegPump(track, dc);
    return;
  }
  const readable = new MediaStreamTrackProcessor({ track }).readable;
  const source = `(${frameWorkerSource.toString()})();`;
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  worker.onmessage = ({ data }) => {
    if (data.frame) {
      if (dc.readyState !== "open" || dc.bufferedAmount > 200000) return; // the channel is behind: drop
      try { dc.send(packFrame(data.frame, data.key, data.timestamp)); cast.pumped++; } catch (e) {}
    } else if (data.fallback) cast.frameCodec = data.fallback;
    if (data.encMs != null) lag.enc.push(data.encMs);
  };
  const emu = player.emu || {};
  worker.postMessage({ cmd: "start", readable, codec: cast.frameCodec, width: emu.streamW || STREAM_W, height: emu.streamH || STREAM_H, bitrate: 1_200_000 }, [readable]);
  cast.requestKey = () => worker.postMessage({ cmd: "key" });
  cast.pumpStop = () => { worker.postMessage({ cmd: "stop" }); cast.requestKey = null; };
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
  const off = document.createElement("canvas"); off.width = sw; off.height = sh;
  const g = off.getContext("2d", { alpha: false });
  const grab = new ImageCapture(track);
  let on = true;
  cast.pumpStop = () => { on = false; };
  while (on && track.readyState === "live") {
    try {
      const bmp = await grab.grabFrame();
      g.drawImage(bmp, 0, 0, sw, sh);
      const blob = await new Promise((r) => off.toBlob(r, "image/jpeg", 0.85));
      if (blob && dc.readyState === "open" && dc.bufferedAmount < 200000) { dc.send(packFrame(await blob.arrayBuffer(), true, 0)); cast.pumped++; }
    } catch (e) {}
    await sleep(33);
  }
}
/* Every 2 s: tells the TV what this phone is sending (the TV shows it next to its own
   numbers), and if no new frame has left for a while although the game is running,
   restarts the canvas capture once, then warns. */
function watchCast(pc, sender, dc, emu) {
  let last = -1, still = 0, recaptured = !sender, checks = 0, worked = false;
  clearInterval(cast.watch);
  cast.watch = setInterval(async () => {
    if (pc !== cast.pc || pc.connectionState !== "connected") {
      clearInterval(cast.watch);
      return;
    }
    /** @type {any} */ let tx = null, codec = "";
    try {
      const stats = await pc.getStats(), all = new Map();
      stats.forEach((x) => {
        all.set(x.id, x);
        if (x.type === "outbound-rtp" && (x.kind || x.mediaType) === "video") tx = x;
      });
      if (tx && all.get(tx.codecId)) codec = (all.get(tx.codecId).mimeType || "").replace("video/", "");
    } catch (e) {}
    const tr = sender ? sender.track : (cast.stream && cast.stream.getVideoTracks()[0]);
    let br = -1;
    if (tr && window.ImageCapture) {
      try {
        const bmp = await Promise.race([new ImageCapture(tr).grabFrame(), sleep(600).then(() => null)]);
        if (bmp) {
          br = brightness(bmp);
          bmp.close && bmp.close();
        }
      } catch (e) {}
    }
    // where the time goes on this side, in ms (the TV adds its own and the network)
    const encMs = tx && tx.framesEncoded ? Math.round(((tx.totalEncodeTime || 0) - (lag.encT || 0)) / Math.max(1, tx.framesEncoded - (lag.encN || 0)) * 1000) : avgMs(lag.enc);
    if (tx) { lag.encT = tx.totalEncodeTime || 0; lag.encN = tx.framesEncoded || 0; }
    const sendMs = tx && tx.packetsSent ? Math.round((tx.totalPacketSendDelay || 0) / tx.packetsSent * 1000) : null;
    const speedPct = speed.pct ? Math.round(speed.pct * 100) : null;
    const st = { lat: { touch: avgMs(lag.touch), enc: encMs, send: sendMs, speed: speedPct }, br, ua: chromeVer(), mode: `${CAST_MODES[cast.mode].name}${codec ? ` = ${codec}` : cast.frameCodec ? ` = ${cast.frameCodec === "vp8" ? "VP8 WebCodecs" : "JPEG"}` : ""} (${cast.attempt + 1}/${CAST_MODES.length})`,
      enc: (tx && tx.encoderImplementation) || "", keys: tx ? tx.keyFramesEncoded || 0 : 0, pli: tx ? tx.pliCount || 0 : 0, pk: tx ? tx.packetsSent || 0 : 0, sent: tx ? tx.framesSent || 0 : cast.pumped || 0, w: (tx && tx.frameWidth) || 0, h: (tx && tx.frameHeight) || 0, lim: (tx && tx.qualityLimitationReason) || "",
      cw: emu.canvas ? emu.canvas.width : 0, ch: emu.canvas ? emu.canvas.height : 0, track: tr ? tr.readyState + (tr.muted ? " (sem quadros)" : "") : "sem trilha" };
    if (dc.readyState === "open") { try { dc.send(JSON.stringify({ st })); } catch (e) {} }
    // the TV says how many frames it decoded: none after ~8 s while this phone is
    // sending means the TV can't take this format, so try the next one
    checks++;
    const tv = cast.tvStats;
    if (tv && tv.dec > 0 && !worked) {
      worked = true;
      ls.set("cartucho.castMode", String(cast.mode));
    }
    if (!worked && tv && checks >= 4 && st.sent > 60 && tv.dec === 0) {
      clearInterval(cast.watch);
      if (cast.attempt + 1 < CAST_MODES.length) {
        toast(`A TV não está recebendo a imagem. Tentando outro formato (${cast.attempt + 2}/${CAST_MODES.length})…`, 4000);
        castTo(cast.code, cast.attempt + 1);
      } else toast("A TV não conseguiu receber a imagem em nenhum formato. Mande uma foto do diagnóstico que aparece na TV.", 8000);
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
        try { nt.contentHint = "motion"; } catch (e) {}
        await sender.replaceTrack(nt);
        if (cast.stream) for (const t of cast.stream.getVideoTracks()) t.stop();
        cast.stream = ns;
      } catch (e) {}
    }
    if (still === 4) toast(`A imagem não está saindo deste celular (${st.sent} quadros enviados). Toque em "TV" para sair e conecte de novo.`, 6000);
  }, 2000);
}

export { cast, applyInput, stopCast, chromeVer, castTo };
