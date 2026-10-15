import { PAD_BITS } from "./constants.js";
import { applyInput, cast, castTo, stopCast } from "./phone.js";
import { cloud, gh } from "../cloud.js";
import { normCode } from "../connect.js";
import { guessDevice } from "../device.js";
import { diag } from "../diag.js";
import { notice } from "../library.js";
import { flush, player, tokenFromTap, uploadState } from "../player/player.js";
import { $, $$, el, ls } from "../util.js";

/* ---------- the phone as a controller ----------
   A touchscreen can't tell a resting finger from a pressing one, so the rule is
   the one a real pad follows: a button is pressed only by the finger that landed
   on it. A finger that slides across other buttons only highlights them.
   The D-pad keeps the finger that started on it, even if it drifts a little off. */
const padTouches = new Map();
const padState = { rot: 0, geo: null, shownMask: -1, shownOver: "", shownDir: "" };
/* Hit-testing uses rectangles measured once per layout. The pad only ever turns by
   90 degrees, so every control's bounding box is still its exact outline on screen. */
function padGeometry() {
  if (padState.geo) return padState.geo;
  const geo = [];
  for (const n of $$("#pad [data-btn], #pad .pad-dpad")) {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;   // botão escondido (X/Y fora do DS)
    geo.push({ id: n.classList.contains("pad-dpad") ? "dpad" : n.dataset.btn, round: n.classList.contains("pad-face"),
      l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, rad: Math.min(r.width, r.height) / 2 });
  }
  return (padState.geo = geo);
}
/* Thumbs land a little off target. Every control accepts touches a bit outside its
   drawing (the D-pad more than the rest); where two of those zones meet, the nearest
   control wins. */
function controlAt(x, y) {
  let best = null, bestD = Infinity;
  for (const g of padGeometry()) {
    const w = (g.r - g.l) / 2, h = (g.b - g.t) / 2;
    let d;
    if (g.round) d = Math.hypot(x - g.cx, y - g.cy) / g.rad;                       // 1 = on the edge
    else d = Math.max(Math.abs(x - g.cx) / w, Math.abs(y - g.cy) / h);
    const reach = g.id === "dpad" ? 1.35 : g.round ? 1.3 : 1.15;
    if (d <= reach && d < bestD) {
      best = g.id;
      bestD = d;
    }
  }
  return best;
}
/* The D-pad is read as four 90-degree slices, so rolling the thumb from right to up
   goes straight from "right" to "up". Before, each direction covered 135 degrees and
   the overlap (up+right together) swallowed quick turns. Diagonals still exist, but
   only in a thin 20-degree band right on the diagonal. */
function dpadMask(x, y, prev) {
  const d = padGeometry().find((g) => g.id === "dpad");
  if (!d) return 0;
  let dx = (x - d.cx) / ((d.r - d.l) / 2), dy = (y - d.cy) / ((d.b - d.t) / 2);
  if (padState.rot === 90) [dx, dy] = [dy, -dx];
  else if (padState.rot === -90) [dx, dy] = [-dy, dx];
  if (Math.hypot(dx, dy) < 0.15) return 0;
  const bit = (k) => 1 << PAD_BITS.indexOf(k);
  const a = Math.atan2(dy, dx) * 180 / Math.PI;   // 0 = right, 90 = down
  /** @type {[number, string, string][]} */
  const diag = [[45, "RIGHT", "DOWN"], [135, "DOWN", "LEFT"], [-135, "LEFT", "UP"], [-45, "UP", "RIGHT"]];
  for (const [c, k1, k2] of diag) {
    let off = Math.abs(a - c);
    if (off > 180) off = 360 - off;
    if (off <= 10) return bit(k1) | bit(k2);
  }
  /** @type {[number, string][]} */
  const cards = [[0, "RIGHT"], [90, "DOWN"], [180, "LEFT"], [-90, "UP"]];
  let best = null, bestOff = 999;
  for (const [c, k] of cards) {
    let off = Math.abs(a - c);
    if (off > 180) off = 360 - off;
    if (prev & bit(k)) off -= 4;              // a little stickiness, so the border doesn't flicker
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
    if (p.over && p.over !== "dpad" && !(pm & (1 << PAD_BITS.indexOf(p.over)))) over.push(p.over);
  }
  if (m & ~cast.localMask) cast.touchAt = performance.now();   // a new press: timed until the game gets it
  cast.localMask = m;
  applyInput();
  // touch the DOM only when something visible changed
  const overKey = over.sort().join(" ");
  if (m !== padState.shownMask || overKey !== padState.shownOver) {
    padState.shownMask = m;
    padState.shownOver = overKey;
    for (const b of $$("#pad [data-btn]")) {
      const bit = 1 << PAD_BITS.indexOf(b.dataset.btn);
      b.classList.toggle("on", !!(m & bit));
      b.classList.toggle("over", over.includes(b.dataset.btn));
    }
    const dirs = ["UP", "DOWN", "LEFT", "RIGHT"].filter((k) => m & (1 << PAD_BITS.indexOf(k))).join(" ");
    if (dirs !== padState.shownDir) {
      padState.shownDir = dirs;
      $("#pad .pad-dpad").dataset.dir = dirs;
    }
  }
}
/** @type {any} */
let padMsgTimer = null;
function padMsg(text) {
  const n = $("#padMsg");
  n.textContent = text;
  n.classList.add("show");
  clearTimeout(padMsgTimer);
  padMsgTimer = setTimeout(() => n.classList.remove("show"), 2600);
}
/* ajustes do controle na tela, um por sistema (GBA e DS têm layouts diferentes) */
const padPrefKey = () => "cartucho.pad." + (player.isDs ? "nds" : "gba");
function padPrefs() {
  let p = {};
  try { p = JSON.parse(ls.get(padPrefKey()) || "{}") || {}; } catch (e) {}
  return { zoom: Number(p.zoom) || 1, alpha: Number(p.alpha) || 1, swap: !!p.swap };
}
function setPadPrefs(change) {
  ls.set(padPrefKey(), JSON.stringify({ ...padPrefs(), ...change }));
  layoutPad();
}
function applyPadPrefs(pad) {
  const p = padPrefs();
  pad.style.setProperty("--pad-zoom", String(p.zoom));
  pad.style.setProperty("--pad-alpha", String(p.alpha));
  pad.classList.toggle("swap", p.swap);
}
function layoutPad() {
  const pad = $("#pad");
  if (pad.hidden) return;
  padState.geo = null;
  if (padState.mode === "local") {
    applyPadPrefs(pad);
    /* Nothing may cover the game. A layer on top of the picture, even a transparent
       one, makes the phone blend the two on every frame instead of sending the
       picture straight to the screen, and that alone can halve the speed. So the
       game box shrinks to exactly the 3:2 picture, sits above the controller, and
       the controls only live in the space around it. */
    padState.rot = 0;
    pad.classList.remove("rot", "wide");
    pad.style.width = pad.style.height = pad.style.transform = "";
    const pl = $("#player"), bar = $(".pbar").getBoundingClientRect();
    const availH = innerHeight - bar.bottom, availW = innerWidth;
    const upright = availH > availW;
    // proporção da imagem: GBA 3:2; no DS depende de quais telas aparecem (2:3, 8:3 ou 4:3)
    const ar = (player.isDs && player.emu && player.emu.aspect) || 1.5;
    let gw, gh;
    if (upright) {
      // DS: as telas ocupam a largura toda; os controles ficam com o resto (direcional de
      // pelo menos 140 px + ~110 px das linhas de L/R e Start/Select)
      gh = Math.min(availW / ar, player.isDs ? Math.max(availH * 0.5, availH - 250) : availH * 0.55);
      gw = gh * ar;
      if (player.isDs) pad.style.setProperty("--ctl", Math.round(Math.max(110, Math.min(210, availH - gh - 112, availW * 0.46))) + "px");
    }
    else {
      gw = Math.min(availH * ar, availW * (player.isDs ? 0.7 : 0.62));
      gh = gw / ar;
    }
    for (const n of [pad, pl]) {
      n.classList.toggle("port", upright);
      n.classList.toggle("land", !upright);
    }
    pad.classList.toggle("ds", !!player.isDs);
    // deitado a barra de cima some (CSS): mede de novo uma vez com o espaço que sobrou
    if ($(".pbar").getBoundingClientRect().bottom !== bar.bottom && !layoutPad.again) {
      layoutPad.again = true;
      try { layoutPad(); } finally { layoutPad.again = false; }
      return;
    }
    pl.style.setProperty("--game-w", Math.floor(gw) + "px");
    pl.style.setProperty("--game-h", Math.floor(gh) + "px");
    pad.style.setProperty("--pad-top", bar.bottom + "px");
    requestAnimationFrame(() => { padState.geo = null; });
    return;
  }
  for (const n of [pad, $("#player")]) n.classList.remove("port", "land");
  const pref = padState.forceOrient || ls.get("cartucho.pad.orient") || "h";      // h = landscape, hr = landscape the other way, v = portrait
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
  requestAnimationFrame(() => { padState.geo = null; });
}
window.addEventListener("resize", layoutPad);
window.addEventListener("ds-layout", layoutPad);   // o DS trocou de telas (girou, começou a transmitir…)
// the browser bar on phones grows and shrinks without always firing "resize"
if (window.ResizeObserver) new ResizeObserver(() => { if (padState.mode === "local") layoutPad(); }).observe(document.documentElement);
(() => {
  const pad = $("#pad");
  const isUi = (e) => e.target.closest(".pad-top, .pad-extra");
  const down = (e) => {
    if (isUi(e)) return;
    if (!padTouches.size) padState.geo = null;
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (x) {}
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
    if (player.state === "ok" || okState) { padMsg(cloud.db ? "Progresso salvo: continua daqui em qualquer aparelho" : "Progresso salvo neste celular"); }
    else if (player.state === "none") padMsg("Ainda não há save. Salve dentro do jogo primeiro.");
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
/* The same controller is used when playing on the phone itself (instead of the
   emulator's own touch buttons): the picture stays visible in its slot and the
   controls sit below it (upright) or on both sides of it (sideways). */
const touchDevice = () => matchMedia("(pointer: coarse)").matches && guessDevice() !== "TV";
padState.mode = "off";   // off | local | cast
function showPad(on) {
  const pad = $("#pad");
  padTouches.clear();
  cast.localMask = 0;
  applyInput();
  // DS transmitindo: o celular continua mostrando a tela de toque, com o controle em volta
  if (on) padState.mode = player.isDs ? "local" : "cast";
  else padState.mode = (player.key || padState.forceLocal) && touchDevice() ? "local" : "off";
  pad.hidden = padState.mode === "off";
  pad.classList.toggle("local", padState.mode === "local");
  pad.classList.toggle("ds", !!player.isDs);
  // the game stays rendered under the opaque pad while casting: a hidden canvas can stop
  // producing frames for the stream on some phones
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
  root.replaceChildren(el("div", { class: "scrim" }, el("form", { class: "dialog", onsubmit: (e) => {
      e.preventDefault();
      const c = normCode(input.value);
      if (c.length !== 8) {
        input.focus();
        return;
      }
      close();
      castTo(c);
    } },
    el("h2", {}, "Jogar numa segunda tela"),
    el("p", {}, "Na TV, tablet ou notebook, abra o Cartuchin e escolha \"Usar como tela\". Digite aqui o código que aparecer. Os dois precisam estar no mesmo Wi-Fi."),
    input,
    el("button", { class: "btn primary", type: "submit" }, "Transmitir"),
    el("button", { class: "btn", type: "button", onclick: close }, "Cancelar"))));
  input.focus();
}
$("#castBtn").addEventListener("click", askCastCode);
function handleScreenLink() {
  const m = location.hash.match(/^#tela-([A-Za-z0-9]{8})$/);
  if (!m) return;
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  cast.pending = normCode(m[1]);
  $("#notice").dataset.sticky = "1";
  notice("Segunda tela pronta! Escolha o jogo: ele roda aqui e aparece lá. Este celular vira o controle.");
}

export { padState, padGeometry, padMsg, showPad, handleScreenLink, padPrefs, setPadPrefs };
