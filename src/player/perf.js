import { device, guessDevice } from "../device.js";
import { player } from "./player.js";
import { $, $$, ls, toast } from "../util.js";

/* ---------------- performance ----------------
   "auto" starts with the normal profile and switches this device to the light one
   the first time emulation can't keep 60 fps. "light" skips frames when needed so
   game speed and audio stay right, and gives audio a bigger buffer. */
const PERF_KEY = "cartucho.perf";
const perf = {
  mode: ls.get(PERF_KEY + ".mode") === "light" ? "light" : "auto",   // auto | light
  learned: ls.get(PERF_KEY + ".learned") === "light",        // auto mode already decided this device is slow
};
if (!ls.get(PERF_KEY + ".mode") && guessDevice() === "TV") perf.learned = true;
const perfLight = () => perf.mode === "light" || (perf.mode === "auto" && perf.learned);
/* The settings both modes share are the cheapest ones that don't change the game:
   no colour filters, no frame blending, the default idle-loop handling, and the
   picture drawn at the GBA's own 240x160 and enlarged by the browser without
   smoothing. Drawing it bigger looks exactly the same and costs much more: on some
   phones the browser draws WebGL without the graphics chip, and then the size of
   that picture is what decides the speed.
   - auto (default): skips drawing a frame only when sound is about to run dry
   - light: skips earlier and gives sound the longest buffer */
const perfProfile = () => perfLight() ? "light" : "auto";
const PROFILES = {
  auto: { frameskip: "auto", threshold: "33", latency: 128, gameMax: 240 },
  light: { frameskip: "auto", threshold: "50", latency: 160, gameMax: 240 },
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
    mgba_frameskip_threshold: pr.threshold,
  };
}
function renderPerf() {
  for (const b of $$("#perfModes button")) {
    const on = b.dataset.mode === perf.mode;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("#perfHint").textContent = perf.mode === "light"
    ? "Imagem no tamanho do GBA, pula quadros mais cedo e dá mais folga ao som. Para TVs e aparelhos lentos."
    : perf.learned ? "Este aparelho ficou lento antes, então já usa o modo leve."
    : "Recomendado. Só pula o desenho de um quadro quando o som ia falhar; se o jogo ficar lento, passa sozinho para o leve."
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

const speed = { last: null, samples: [], timer: null, since: 0 };
function startSpeedMeter() {
  const gm = player.emu && player.emu.gameManager;
  if (!gm) return;
  speed.since = performance.now();
  speed.samples = [];
  speed.last = null;
  clearInterval(speed.timer);
  speed.timer = setInterval(() => {
    let frames;
    try { frames = Number(gm.getFrameNum()); } catch (e) { return; }
    const now = performance.now();
    if (document.visibilityState !== "visible" || player.emu.paused) {
      speed.last = null;
      return;
    }
    if (speed.last) {
      const pct = ((frames - speed.last.f) / ((now - speed.last.t) / 1000)) / 59.73;
      if (pct > 0 && pct < 3) {
        speed.samples.push(pct);
        if (speed.samples.length > 4) speed.samples.shift();
        const avg = speed.samples.reduce((a, b) => a + b, 0) / speed.samples.length;
        const tag = $("#pSpeed");
        tag.textContent = Math.round(Math.min(avg, 1) * 100) + "%";
        tag.className = "speed pix " + (avg >= 0.95 ? "ok" : avg >= 0.8 ? "warn" : "bad");
        tag.hidden = false;
        $("#padSpeed").textContent = tag.textContent;
        $("#padSpeed").className = "pad-speed " + tag.className.replace("speed pix", "").trim();
        if (perf.mode === "auto" && !perf.learned && now - speed.since > 8000 && speed.samples.length >= 3 && avg < 0.92) {
          perf.learned = true;
          ls.set(PERF_KEY + ".learned", "light");
          try {
            gm.setVariable("mgba_frameskip", "auto");
            gm.setVariable("mgba_frameskip_threshold", PROFILES.light.threshold);
          } catch (e) {}
          window.dispatchEvent(new Event("resize"));   // redraw at the light profile's smaller size
          toast("O jogo estava lento aqui, então liguei o modo leve neste aparelho.", 4500);
          renderPerf();
        }
      }
    }
    speed.last = { f: frames, t: now };
  }, 2000);
}

const devInput = $("#deviceName");
devInput.value = device.name;
devInput.addEventListener("change", () => {
  const v = devInput.value.trim().slice(0, 40);
  device.name = v || guessDevice();
  devInput.value = device.name;
  ls.set("cartucho.device", device.name);
});

export { perf, perfProfile, PROFILES, coreOptions, renderPerf, startSpeedMeter };
