/* ---------- modo "pixels" ----------
   Em vez de vídeo, o celular manda os PIXELS do jogo: GBA e DS são pixel art pequeno
   (240x160, 256x384), em cores de 15 bits. Cada quadro é comparado com o anterior em
   blocos de 8x8; só os blocos que mudaram vão, comprimidos (deflate). Nada de codificador
   de vídeo, nada de fila de vídeo na TV: o atraso é o do Wi-Fi, e a imagem chega exata.
   O som vai cru (PCM 16 bits) pelo mesmo tipo de canal.

   Pacote de imagem (10 bytes + corpo em deflate-raw):
     [0] 1 = quadro inteiro, 2 = só blocos mudados  [1] arrumação (0 cima, 1 as duas, 2 lado, 3 GBA)
     [2..5] número do pacote  [6..7] largura  [8..9] altura
   Corpo: inteiro = largura*altura cores u16; blocos = u16 quantos, u16 índices, 64 cores cada.
   O canal não reenvia nada (um pacote perdido não atrasa os seguintes): se faltar um pacote
   a TV pede um quadro inteiro e espera por ele.
   Pacote de som: u32 taxa + amostras int16 intercaladas (estéreo). */

const LAYOUT = { top: 0, both: 1, side: 2 };

/* ---- worker do celular: RGBA → 15 bits → diferença por blocos → deflate ---- */
const pixWorkerSource = () => {
  /** @type {any} */ const self_ = self;
  let prev = null, seq = 0, wantKey = true, w = 0, h = 0, sinceKey = 0, busy = false, next = null;
  const T = 8;
  async function deflate(u8) {
    const cs = new CompressionStream("deflate-raw");
    const wr = cs.writable.getWriter();
    wr.write(u8);
    wr.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  function to555(d, n) {
    const out = new Uint16Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = ((d[j] >> 3) << 10) | ((d[j + 1] >> 3) << 5) | (d[j + 2] >> 3);
    return out;
  }
  let frames = 0, empty = 0;
  async function process(f) {
    const t0 = performance.now();
    frames++;
    const n = f.w * f.h, cur = to555(f.data, n);
    if (!prev || f.w !== w || f.h !== h || ++sinceKey > 240) wantKey = true;
    w = f.w; h = f.h;
    let type, body;
    if (wantKey) {
      type = 1; body = new Uint8Array(cur.buffer); wantKey = false; sinceKey = 0;
    } else {
      const tx = w / T, ty = h / T, changed = [];
      for (let by = 0; by < ty; by++) for (let bx = 0; bx < tx; bx++) {
        let diff = false;
        for (let y = 0; y < T && !diff; y++) {
          const o = (by * T + y) * w + bx * T;
          for (let x = 0; x < T; x++) if (cur[o + x] !== prev[o + x]) { diff = true; break; }
        }
        if (diff) changed.push(by * tx + bx);
      }
      if (!changed.length) { prev = cur; empty++; return; }
      type = 2;
      const out = new Uint16Array(1 + changed.length + changed.length * T * T);
      out[0] = changed.length;
      out.set(changed, 1);
      let p = 1 + changed.length;
      for (const t of changed) {
        const bx = t % tx, by = (t / tx) | 0;
        for (let y = 0; y < T; y++) { const o = (by * T + y) * w + bx * T; out.set(cur.subarray(o, o + T), p); p += T; }
      }
      body = new Uint8Array(out.buffer);
    }
    prev = cur;
    const z = await deflate(body);
    const pkt = new Uint8Array(10 + z.length), dv = new DataView(pkt.buffer);
    pkt[0] = type; pkt[1] = f.layout; dv.setUint32(2, ++seq, true); dv.setUint16(6, w, true); dv.setUint16(8, h, true);
    pkt.set(z, 10);
    self_.postMessage({ pkt: pkt.buffer, key: type === 1, bytes: pkt.length, ms: performance.now() - t0, frames, empty }, [pkt.buffer]);
  }
  async function run(f) {
    if (busy) { next = f; return; }   // ocupado: fica só o quadro mais novo
    busy = true;
    try { await process(f); } catch (e) { self_.postMessage({ error: String(e) }); }
    busy = false;
    if (next) { const g = next; next = null; run(g); }
  }
  async function readTrack(readable, fw, fh) {
    const oc = new OffscreenCanvas(fw, fh), g = oc.getContext("2d", { alpha: false, willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    const reader = readable.getReader();
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      if (busy) { frame.close(); continue; }
      g.drawImage(frame, 0, 0, fw, fh);
      frame.close();
      run({ w: fw, h: fh, layout: 3, data: g.getImageData(0, 0, fw, fh).data });
    }
  }
  self_.onmessage = ({ data }) => {
    if (data.cmd === "frame") run(data.f);
    else if (data.cmd === "key") wantKey = true;
    else if (data.cmd === "track") readTrack(data.readable, data.w, data.h);
  };
};

/* ---- worklet do celular: tira o som da mistura em blocos de ~10 ms ---- */
const TAP_WORKLET = `class PixTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(960); this.n = 0; }
  process(inputs) {
    const i = inputs[0];
    if (!i || !i.length) return true;
    const l = i[0], r = i[1] || i[0];
    for (let k = 0; k < l.length; k++) {
      this.buf[this.n++] = Math.max(-1, Math.min(1, l[k])) * 32767;
      this.buf[this.n++] = Math.max(-1, Math.min(1, r[k])) * 32767;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(960); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pix-tap", PixTap);`;

/* ---- worklet da TV: fila curta (~50 ms), reamostra para a taxa da TV ----
   Fila passou de ~130 ms (o celular está mais rápido ou a rede segurou e soltou): pula para
   a meta. Faltou som: silêncio até juntar meia meta de novo (melhor que picotar). */
const PLAY_WORKLET = `class PixPlay extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000 * 2; this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap);
    this.w = 0; this.r = 0; this.rate = 48000; this.prime = true; this.under = 0;
    this.port.onmessage = (e) => {
      const d = new Int16Array(e.data.d); this.rate = e.data.rate;
      for (let k = 0; k < d.length; k += 2) { const p = this.w % this.cap; this.L[p] = d[k] / 32768; this.R[p] = d[k + 1] / 32768; this.w++; }
      const target = this.rate * 0.05;
      if (this.w - this.r > target + this.rate * 0.08) this.r = this.w - target;
      if (this.w - this.r > this.cap - 1024) this.r = this.w - target;
    };
  }
  process(_in, outputs) {
    const o = outputs[0], l = o[0], r = o[1] || o[0], step = this.rate / sampleRate, target = this.rate * 0.05;
    if (this.prime && this.w - this.r >= target * 0.5) this.prime = false;
    for (let k = 0; k < l.length; k++) {
      if (this.prime || this.w - this.r < 2) { l[k] = 0; r[k] = 0; if (!this.prime) { this.prime = true; this.under++; } continue; }
      const i = Math.floor(this.r), f = this.r - i, a = i % this.cap, b = (i + 1) % this.cap;
      l[k] = this.L[a] + (this.L[b] - this.L[a]) * f;
      r[k] = this.R[a] + (this.R[b] - this.R[a]) * f;
      this.r += step;
    }
    return true;
  }
}
registerProcessor("pix-play", PixPlay);`;

async function addWorklet(ctx, src) {
  const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
}

/* ================= celular ================= */
/** começa a mandar imagem e som; devolve a função que para tudo */
async function startPixels({ pix, snd, emu, isDs, layout, onSent }) {
  const worker = new Worker(URL.createObjectURL(new Blob([`(${pixWorkerSource.toString()})();`], { type: "text/javascript" })));
  const stat = { sent: 0, dropped: 0, bytes: 0, keys: 0, ms: 0, frames: 0, empty: 0, offered: 0 };
  worker.onmessage = ({ data }) => {
    if (!data.pkt) return;
    stat.ms = stat.ms ? stat.ms * 0.9 + data.ms * 0.1 : data.ms;
    stat.frames = data.frames; stat.empty = data.empty;
    // canal atrasado (Wi-Fi ruim): não empilha; descarta e o próximo vai inteiro
    if (pix.readyState !== "open" || pix.bufferedAmount > 262144) { stat.dropped++; worker.postMessage({ cmd: "key" }); return; }
    try { pix.send(data.pkt); stat.sent++; stat.bytes += data.bytes; if (data.key) stat.keys++; } catch (e) { worker.postMessage({ cmd: "key" }); }
  };
  const stops = [() => worker.terminate()];
  if (isDs) {
    // DS: o quadro já está em memória (RGBA 256x384 em 1x); em 2x+ reduz o fb para 1x
    let small = null, sg = null;
    emu.onFrame = (im) => {
      if (onSent) onSent();
      stat.offered++;
      let data;
      if (im && im.width === 256) data = im.data.slice();
      else {
        if (!small) { small = document.createElement("canvas"); small.width = 256; small.height = 384; sg = small.getContext("2d", { alpha: false, willReadFrequently: true }); sg.imageSmoothingEnabled = false; }
        sg.drawImage(emu.fbCanvas, 0, 0, 256, 384);
        data = sg.getImageData(0, 0, 256, 384).data;
      }
      worker.postMessage({ cmd: "frame", f: { w: 256, h: 384, layout: LAYOUT[layout()] ?? 0, data } }, [data.buffer]);
    };
    stops.push(() => { emu.onFrame = null; });
  } else {
    // GBA: quadros da captura do canvas do EmulatorJS, lidos dentro do worker
    const track = emu.canvas.captureStream(60).getVideoTracks()[0];
    stops.push(() => track.stop());
    if (window.MediaStreamTrackProcessor) {
      const readable = new window.MediaStreamTrackProcessor({ track }).readable;
      worker.postMessage({ cmd: "track", readable, w: 240, h: 160 }, [readable]);
    } else {
      const c = document.createElement("canvas"); c.width = 240; c.height = 160;
      const g = c.getContext("2d", { alpha: false, willReadFrequently: true });
      g.imageSmoothingEnabled = false;
      let on = true;
      const loop = () => {
        if (!on) return;
        requestAnimationFrame(loop);
        try { g.drawImage(emu.canvas, 0, 0, 240, 160); } catch (e) { return; }
        const data = g.getImageData(0, 0, 240, 160).data;
        if (onSent) onSent();
        worker.postMessage({ cmd: "frame", f: { w: 240, h: 160, layout: 3, data } }, [data.buffer]);
      };
      loop();
      stops.push(() => { on = false; });
    }
  }
  // som: um leitor na mistura de áudio do jogo (cast/common.js), em blocos de 10 ms
  const tap = (window.__audioTaps || [])[0];
  if (tap && tap.ctx.audioWorklet && snd) {
    try {
      await addWorklet(tap.ctx, TAP_WORKLET);
      const node = new AudioWorkletNode(tap.ctx, "pix-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const sink = tap.ctx.createGain();
      sink.gain.value = 0;
      tap.connect(tap.mix, node);
      tap.connect(node, sink);
      tap.connect(sink, tap.ctx.destination);   // um caminho até a saída para o worklet rodar sempre
      const rate = tap.ctx.sampleRate;
      node.port.onmessage = (e) => {
        if (snd.readyState !== "open" || snd.bufferedAmount > 65536) return;
        const pkt = new Uint8Array(4 + e.data.byteLength);
        new DataView(pkt.buffer).setUint32(0, rate, true);
        pkt.set(new Uint8Array(e.data), 4);
        try { snd.send(pkt.buffer); } catch (x) {}
      };
      stops.push(() => { try { node.disconnect(); sink.disconnect(); tap.mix.disconnect(node); } catch (e) {} });
    } catch (e) { console.warn("[pixels] som", e); }
  }
  return {
    stat,
    key: () => worker.postMessage({ cmd: "key" }),
    stop: () => { for (const s of stops) { try { s(); } catch (e) {} } },
  };
}

/* ================= TV ================= */
function receivePixels(channel, tv, askKey) {
  const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector("#scrCanvas"));
  const g = canvas.getContext("2d", { alpha: false });
  canvas.hidden = false;
  document.querySelector("#scrVideo").hidden = true;
  channel.binaryType = "arraybuffer";
  let w = 0, h = 0, cur = null, img = null, last = 0, waitKey = true, askedAt = 0, queued = 0, chain = Promise.resolve();
  const ask = () => { const now = performance.now(); if (now - askedAt > 250) { askedAt = now; askKey(); } };
  async function inflate(u8) {
    const ds = new DecompressionStream("deflate-raw");
    const wr = ds.writable.getWriter();
    wr.write(u8);
    wr.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  const X = new Uint8Array(32).map((_, i) => (i << 3) | (i >> 2));   // 5 bits → 8 bits, como o DS
  function paint(idx, c) {
    const o = idx * 4, d = img.data;
    d[o] = X[(c >> 10) & 31]; d[o + 1] = X[(c >> 5) & 31]; d[o + 2] = X[c & 31]; d[o + 3] = 255;
  }
  async function handle(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf);
    const type = b[0], layout = b[1], seq = dv.getUint32(2, true), fw = dv.getUint16(6, true), fh = dv.getUint16(8, true);
    if (type === 2 && (waitKey || seq !== last + 1 || fw !== w || fh !== h)) { waitKey = true; ask(); return; }
    const body = await inflate(b.subarray(10));
    const u16 = new Uint16Array(body.buffer, body.byteOffset, body.byteLength >> 1);
    if (type === 1) {
      if (fw !== w || fh !== h || !img) { w = fw; h = fh; cur = new Uint16Array(w * h); img = new ImageData(w, h); }
      cur.set(u16.subarray(0, w * h));
      for (let i = 0; i < w * h; i++) paint(i, cur[i]);
      waitKey = false;
    } else {
      const n = u16[0], tx = w / 8;
      let p = 1 + n;
      for (let k = 0; k < n; k++) {
        const t = u16[1 + k], bx = t % tx, by = (t / tx) | 0;
        for (let y = 0; y < 8; y++) {
          const o = (by * 8 + y) * w + bx * 8;
          for (let x = 0; x < 8; x++) { const c = u16[p++]; cur[o + x] = c; paint(o + x, c); }
        }
      }
    }
    last = seq;
    // DS: a TV escolhe o que mostrar (de cima, as duas, lado a lado); GBA: a tela inteira
    const [cw, ch] = layout === 0 ? [256, 192] : layout === 2 ? [512, 192] : [w, h];
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    if (layout === 0) g.putImageData(img, 0, 0, 0, 0, 256, 192);
    else if (layout === 2) { g.putImageData(img, 0, 0, 0, 0, 256, 192); g.putImageData(img, 256, -192, 0, 192, 256, 192); }
    else g.putImageData(img, 0, 0);
    tv.drawn++;
  }
  channel.onmessage = (m) => {
    // a TV não está dando conta: joga a fila fora e pede um quadro inteiro
    if (queued > 6) { waitKey = true; ask(); return; }
    queued++;
    chain = chain.then(() => handle(m.data)).catch(() => { waitKey = true; ask(); }).then(() => { queued--; });
  };
}
async function receiveSound(channel, ctx, tv) {
  channel.binaryType = "arraybuffer";
  if (!ctx || !ctx.audioWorklet) return;
  try {
    await addWorklet(ctx, PLAY_WORKLET);
    const node = new AudioWorkletNode(ctx, "pix-play", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(ctx.destination);
    channel.onmessage = (m) => {
      const rate = new DataView(m.data).getUint32(0, true);
      node.port.postMessage({ d: m.data.slice(4), rate });
      if (tv) tv.sndPk = (tv.sndPk || 0) + 1;
    };
    channel.addEventListener("close", () => { try { node.disconnect(); } catch (e) {} });
  } catch (e) { console.warn("[pixels] som na TV", e); }
}

export { startPixels, receivePixels, receiveSound };
