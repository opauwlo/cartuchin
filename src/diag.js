import { keepAwake } from "./cast/common.js";
import { padGeometry, padState, showPad } from "./cast/pad.js";
import { device, guessDevice } from "./device.js";
import { coreOptions, perf, renderPerf } from "./player/perf.js";
import { createEmulator, player } from "./player/player.js";
import { dialog } from "./ui/dialogs.js";
import { $, ls, sleep, toast } from "./util.js";

/* ---------------- speed diagnostic ----------------
   Runs bench.gba (a GBA program that never sleeps) in fast-forward with no speed
   limit, so the number is how much emulation this device can do, not just whether
   it reaches 100%. Then it turns on, one at a time, each thing the console mode adds
   on top (the controller, fingers moving, the video stream) and measures again.
   Each feature is measured between two plain runs and compared with their average,
   so a device that speeds up or slows down along the way (warming up, heating up)
   doesn't blame the wrong feature. Whatever makes the number drop is what is
   slowing this device down. */
const DIAG_STEPS = [
  { id: "pad", label: "Controle na tela, horizontal", pad: "h" },
  { id: "padv", label: "Controle na tela, vertical", pad: "v" },
  { id: "padrich", label: "Controle com sombras suaves (visual anterior)", pad: "h", rich: true },
  { id: "touch", label: "Controle + dedos se mexendo", pad: "h", touch: true },
  { id: "local", label: "Jogando no próprio celular, com o controle na tela", local: true, touch: true },
  { id: "cast", label: "Transmissão de vídeo e som (sem rede)", cast: true },
  { id: "all", label: "Tudo junto", pad: "h", touch: true, cast: true },
  { id: "recast", label: "Depois de ligar e desligar a transmissão 3 vezes", recast: 3 },
];
/** @type {{ running: boolean, done: boolean, results: any[], bases: any[], only: string[] | null }} */
const diag = window.__diag = { running: false, done: false, results: [], bases: [], only: null };
const GBA_FPS = 59.7275;

function diagShow(html) { $("#diagBody").innerHTML = html; }
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
function diagRow(r) {
  const pct = Math.round((r.fps / GBA_FPS) * 100);
  if (r.rel == null) return `<tr><td>${r.label}</td><td class="num">${pct}%</td><td class="num">referência</td></tr>`;
  const rel = Math.round(r.rel * 100);
  const cls = rel >= 92 ? "ok" : rel >= 80 ? "warn" : "bad";
  return `<tr><td>${r.label}</td><td class="num">${pct}%</td><td class="num ${cls}">${rel >= 100 ? "sem perda" : "−" + (100 - rel) + "%"}</td></tr>`;
}
function diagTable() {
  return `<table class="diag-table"><thead><tr><th>Situação</th><th class="num">Capacidade</th><th class="num">Custo</th></tr></thead><tbody>${
    diag.results.map(diagRow).join("")}</tbody></table>`;
}
function diagReport() {
  const lines = diag.results.map((r) => `${r.label}: ${Math.round((r.fps / GBA_FPS) * 100)}%${r.rel != null ? ` (${Math.round(r.rel * 100)}% do normal)` : ""}`);
  return ["Cartuchin, teste de velocidade", new Date().toLocaleString("pt-BR"),
    `Aparelho: ${device.name} · ${navigator.userAgent}`,
    `Núcleos: ${navigator.hardwareConcurrency || "?"} · Tela: ${screen.width}x${screen.height} @${window.devicePixelRatio || 1}x`,
    `Desempenho: ${perf.mode}${perf.learned ? " (aprendeu modo leve)" : ""} · Controle: ${ls.get("cartucho.pad.orient") || "h"}`,
    `Medidas do emulador sozinho, em ordem: ${diag.bases.map((b) => Math.round((b / GBA_FPS) * 100) + "%").join(", ")}`,
    "", ...lines].join("\n");
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
  }, 8);   // 125 events a second, like a fast touchscreen
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
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
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
    v.play().catch(() => {});
  };
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  return () => {
    try {
      a.close();
      b.close();
    } catch (e) {}
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
  try { bytes = new Uint8Array(await (await fetch("bench.gba")).arrayBuffer()); } catch (e) {
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
  } catch (e) {}
  diagShow("<p>Aquecendo o emulador…</p>");
  await sleep(5000);   // the browser optimises the emulator's code during the first seconds
  const measure = async () => {
    const windows = [];
    for (let w = 0; w < 3; w++) {
      const f0 = Number(gm.getFrameNum()), t0 = performance.now();
      await sleep(1300);
      windows.push((Number(gm.getFrameNum()) - f0) / ((performance.now() - t0) / 1000));
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
    if (step.cast) { try { undo.push(await diagLoopback(emu)); } catch (e) {} }
    for (let k = 0; k < (step.recast || 0); k++) {
      try {
        const stop = await diagLoopback(emu);
        await sleep(700);
        stop();
        await sleep(200);
      } catch (e) {}
    }
    await sleep(1000);
    const fps = await measure();
    for (const u of undo.reverse()) try { u(); } catch (e) {}
    await sleep(500);
    const after = await measure();
    const before = diag.bases[diag.bases.length - 1];
    diag.bases.push(after);
    diag.results.push({ id: step.id, label: step.label, fps, rel: fps / ((before + after) / 2) });
    diag.results[0].fps = median(diag.bases);
  }
  try { gm.toggleFastForward(0); } catch (e) {}
  diag.running = false;
  diag.done = true;
  const base = diag.results[0].fps;
  const worst = diag.results.filter((r) => r.rel != null).reduce((w, r) => (r.rel < w.rel ? r : w), { rel: Infinity });
  const verdict = Math.round((base / GBA_FPS) * 100) < 100
    ? `Este aparelho emula no máximo ${Math.round((base / GBA_FPS) * 100)}% da velocidade de um GBA no pior caso, então jogos pesados vão ficar lentos aqui mesmo sem nada a mais.`
    : worst.rel < 0.85
      ? `O que mais pesa neste aparelho: <b>${worst.label}</b>.`
      : "Nenhum recurso extra pesa de forma relevante neste aparelho.";
  diagShow(`<p class="diag-now">${verdict}</p>${diagTable()}<p class="diag-note">Capacidade é a velocidade máxima que o aparelho consegue com um programa que nunca descansa (100% = um GBA de verdade). Jogos reais pesam menos que isso.</p>
    <div class="diag-actions"><button class="btn primary" id="diagCopy" type="button">Copiar resultado</button><button class="btn" id="diagClose" type="button">Fechar</button></div>
    <pre class="diag-pre" id="diagText"></pre>`);
  $("#diagText").textContent = diagReport();
  $("#diagCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(diagReport());
      toast("Resultado copiado");
    }
    catch (e) {
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

/* EmulatorJS keeps its menu settings (controls, video, core options) in localStorage
   under "ejs-…" keys. Resetting removes those and the speed profile; the GitHub
   connection, the device name and the saves are left alone. */
function resetEmulatorSettings() {
  let n = 0;
  try {
    for (const k of Object.keys(localStorage)) if (/^ejs-/.test(k) || /^cartucho\.perf\./.test(k)) {
      localStorage.removeItem(k);
      n++;
    }
  } catch (e) {}
  perf.mode = "auto";
  perf.learned = guessDevice() === "TV";
  renderPerf();
  return n;
}
$("#resetEmuBtn").addEventListener("click", async () => {
  const ok = await dialog("Restaurar as configurações do emulador?", "Controles, vídeo, som e as opções do menu do emulador voltam ao padrão, e o desempenho volta para Automático. Seus jogos, saves e a conexão com a nuvem continuam.",
    [{ label: "Restaurar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  resetEmulatorSettings();
  toast("Configurações do emulador restauradas");
});

export { diag, runDiagnostic, resetEmulatorSettings };
