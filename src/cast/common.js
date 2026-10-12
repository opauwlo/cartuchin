import { b64, unb64 } from "../bytes.js";
import { PAD_BITS, keysDown } from "./constants.js";
import { cast } from "./phone.js";
import { tvScreen } from "./tv.js";
import { connect, utf8 } from "../cloud.js";
import { normCode, pairMaterial } from "../connect.js";

/* ---------------- console mode: the phone plays, the TV only shows ----------------
   The TV opens "Usar como tela" and shows a code. The phone (running the game) sends
   a WebRTC offer, encrypted with a key from that code, through ntfy.sh; the TV answers
   the same way. After that, video, audio and the TV's controller travel straight
   between the two devices over the home network (UDP), with no server in the middle. */


async function sealJson(key, obj) {
  const raw = utf8.enc(JSON.stringify(obj));
  const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, gz));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
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
      const since = Math.floor(Date.now() / 1000) - 2;
      const es = new EventSource(`https://ntfy.sh/${topic}-${kind}/sse?since=${since}`);
      const seen = new Set();
      es.onmessage = async (ev) => {
        try {
          const m = JSON.parse(ev.data); if (m.event !== "message" || !m.message) return;
          const id = m.id || m.message.slice(0, 40); if (seen.has(id)) return; seen.add(id);
          onMsg(await openJson(key, m.message));
        } catch (e) {}
      };
      return () => es.close();
    },
  };
}
function iceDone(pc, ms = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
  });
}
let wakeLock = null;
async function keepAwake() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (cast.pc || tvScreen.active)) keepAwake(); });

/* Every sound that would reach the speakers also goes through a tap the stream can carry. */
(() => {
  if (!window.AudioNode) return;
  const connect = AudioNode.prototype.connect;
  const taps = new WeakMap();
  window.__audioTaps = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (window.AudioDestinationNode && dest instanceof AudioDestinationNode) {
      const ctx = dest.context;
      let t = taps.get(ctx);
      if (!t) {
        const local = ctx.createGain(); connect.call(local, dest);
        const out = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
        t = { ctx, local, out }; taps.set(ctx, t); window.__audioTaps.push(t);
      }
      if (t.out) connect.call(this, t.out);
      return connect.call(this, t.local);
    }
    return connect.call(this, dest, ...rest);
  };
})();

function wakeAudio() {
  for (const t of window.__audioTaps || []) {
    try { if (t.ctx.state !== "running") t.ctx.resume().catch(() => {}); } catch (e) {}
  }
}
for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, wakeAudio, true);



function readPad() {
  let pad = null;
  try { pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null; } catch (e) {}
  const s = {};
  if (pad) {
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), ax = pad.axes || [];
    s.A = b(1); s.B = b(0); s.L = b(4) || b(6); s.R = b(5) || b(7); s.SELECT = b(8); s.START = b(9);
    s.UP = b(12) || ax[1] < -0.5; s.DOWN = b(13) || ax[1] > 0.5; s.LEFT = b(14) || ax[0] < -0.5; s.RIGHT = b(15) || ax[0] > 0.5;
  }
  for (const k of PAD_BITS) if (keysDown.has(k)) s[k] = true;
  let mask = 0; PAD_BITS.forEach((k, i) => { if (s[k]) mask |= 1 << i; });
  return mask;
}

export { signal, iceDone, keepAwake, wakeAudio, readPad };
