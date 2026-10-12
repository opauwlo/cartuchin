import { $, $$ } from "../util.js";

/* ---------------- controller in the library (TV) ----------------
   D-pad or left stick moves between buttons, A presses, B cancels a dialog. */
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
    try { n.scrollIntoView({ block: "nearest" }); } catch (e) {}
  }
  function tick(t) {
    requestAnimationFrame(tick);
    if (!$("#player").hidden || !$("#screen").hidden || t - last < 60) return;
    last = t;
    let pad = null;
    try { pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null; } catch (e) {}
    if (!pad) {
      was = {};
      return;
    }
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), ax = pad.axes || [];
    const now = { up: b(12) || ax[1] < -0.6, down: b(13) || ax[1] > 0.6, left: b(14) || ax[0] < -0.6, right: b(15) || ax[0] > 0.6, a: b(0), b: b(1) };
    const edge = (k) => now[k] && !was[k];
    if (edge("up") || edge("left")) move(-1);
    if (edge("down") || edge("right")) move(1);
    if (edge("a") && document.activeElement && document.activeElement.tagName === "BUTTON") /** @type {HTMLElement} */ (document.activeElement).click();
    if (edge("b")) {
      const btns = targets();
      if ($("#dialogRoot").firstElementChild && btns.length) btns[btns.length - 1].click();
    }
    was = now;
  }
  if (navigator.getGamepads) requestAnimationFrame(tick);
  window.addEventListener("gamepadconnected", () => { if ($("#player").hidden && !document.activeElement.matches("button")) move(0); });
})();
