/* The frame pump of the "quadros" mode, running in a Worker so the game's thread never
   waits for an encoder.

   In:  { cmd: "start", readable, codec: "vp8" | "jpeg", width, height, bitrate }
        { cmd: "key" }   — the TV lost a frame and needs a key frame to resume
        { cmd: "stop" }
   Out: { frame: ArrayBuffer, key: boolean, timestamp: number }   (buffer transferred)
        { error: string }

   With WebCodecs, every VideoFrame from the canvas capture goes through a VP8 encoder
   in realtime mode: ~1 Mbit/s, one key frame every 3 s and on request. Without it,
   frames are drawn to an OffscreenCanvas and compressed as JPEG (10x the bytes). */

export const frameWorkerSource = () => {
  /** @type {any} */ const worker = self;
  let encoder = null, reader = null, running = false, codec = "jpeg";
  let wantKey = true, framesIn = 0, busy = false, lastJpegAt = 0;
  const KEY_EVERY = 180; // frames
  const inFlight = new Map(); // frame timestamp → when it entered the encoder (to measure its latency)

  function send(buffer, key, timestamp) {
    worker.postMessage({ frame: buffer, key, timestamp }, [buffer]);
  }

  // "Tempo real" (DS): os quadros chegam um a um do jogo ({ cmd: "frame" }), sem captura de
  // canvas no meio. H.264 de hardware quando a TV decodifica, senão VP8. Nunca enfileira.
  let cfg = null;
  async function startDirect(want, width, height, bitrate) {
    const tries = want === "h264"
      ? [{ codec: "avc1.42E028", avc: { format: "annexb" }, hardwareAcceleration: "prefer-hardware" }, { codec: "vp8" }]
      : [{ codec: "vp8" }];
    for (const t of tries) {
      const c = { ...t, width, height, bitrate, framerate: 60, latencyMode: "realtime" };
      try { if ((await worker.VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) {}
    }
    if (!cfg) throw new Error("sem codificador");
    codec = cfg.codec === "vp8" ? "vp8" : "h264";
    encoder = new worker.VideoEncoder({
      output: (chunk) => {
        const buf = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buf);
        const started = inFlight.get(chunk.timestamp); inFlight.delete(chunk.timestamp);
        worker.postMessage({ frame: buf, key: chunk.type === "key", timestamp: chunk.timestamp, codec, encMs: started ? performance.now() - started : null }, [buf]);
      },
      error: (e) => worker.postMessage({ error: String(e) }),
    });
    encoder.configure(cfg);
    worker.postMessage({ codec });
  }
  function encodeDirect(frame) {
    // um quadro atrasado vale menos que o próximo: com o codificador ocupado, descarta
    if (!encoder || encoder.state !== "configured" || encoder.encodeQueueSize > 0) { frame.close(); return; }
    if (frame.displayWidth !== cfg.width || frame.displayHeight !== cfg.height) {
      cfg = { ...cfg, width: frame.displayWidth, height: frame.displayHeight };
      encoder.configure(cfg);
      wantKey = true;
    }
    framesIn++;
    const key = wantKey || framesIn % KEY_EVERY === 0;
    wantKey = false;
    inFlight.set(frame.timestamp, performance.now());
    encoder.encode(frame, { keyFrame: key });
    frame.close();
  }

  async function startVp8(width, height, bitrate) {
    encoder = new worker.VideoEncoder({
      output: (chunk) => {
        const buf = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buf);
        const started = inFlight.get(chunk.timestamp); inFlight.delete(chunk.timestamp);
        worker.postMessage({ frame: buf, key: chunk.type === "key", timestamp: chunk.timestamp, encMs: started ? performance.now() - started : null }, [buf]);
      },
      error: (e) => worker.postMessage({ error: String(e) }),
    });
    const config = { codec: "vp8", width, height, bitrate, framerate: 60, latencyMode: "realtime" };
    const ok = await worker.VideoEncoder.isConfigSupported(config);
    if (!ok.supported) throw new Error("vp8 não suportado");
    encoder.configure(config);
  }

  function encodeVp8(frame) {
    // never queue up: a late frame is worth less than the next one
    if (encoder.encodeQueueSize > 2) { frame.close(); return; }
    const key = wantKey || framesIn % KEY_EVERY === 0;
    wantKey = false;
    inFlight.set(frame.timestamp, performance.now());
    encoder.encode(frame, { keyFrame: key });
    frame.close();
  }

  let canvas = null, ctx = null;
  async function encodeJpeg(frame, width, height) {
    const now = performance.now();
    if (busy || now - lastJpegAt < 30) { frame.close(); return; }
    busy = true; lastJpegAt = now;
    try {
      if (!canvas) { canvas = new OffscreenCanvas(width, height); ctx = canvas.getContext("2d", { alpha: false }); }
      ctx.drawImage(frame, 0, 0, width, height);
      frame.close();
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
      send(await blob.arrayBuffer(), true, 0);
    } catch (e) { worker.postMessage({ error: String(e) }); }
    busy = false;
  }

  async function pump(readable, width, height) {
    reader = readable.getReader();
    while (running) {
      const { value: frame, done } = await reader.read();
      if (done || !running) { if (frame) frame.close(); break; }
      framesIn++;
      if (codec === "vp8") encodeVp8(frame); else await encodeJpeg(frame, width, height);
    }
  }

  worker.onmessage = async ({ data }) => {
    if (data.cmd === "frame") {
      if (running) encodeDirect(data.frame); else data.frame.close();
      worker.postMessage({ ack: 1 });
    } else if (data.cmd === "direct") {
      running = true;
      try { await startDirect(data.codec, data.width, data.height, data.bitrate); }
      catch (e) { running = false; worker.postMessage({ fail: String(e) }); }
    } else if (data.cmd === "start") {
      running = true; codec = data.codec;
      try {
        if (codec === "vp8") await startVp8(data.width, data.height, data.bitrate);
      } catch (e) {
        codec = "jpeg"; worker.postMessage({ fallback: "jpeg", why: String(e) });
      }
      pump(data.readable, data.width, data.height);
    } else if (data.cmd === "key") {
      wantKey = true;
    } else if (data.cmd === "stop") {
      running = false;
      try { reader && reader.cancel(); } catch (e) {}
      try { encoder && encoder.close(); } catch (e) {}
      worker.close();
    }
  };
};
