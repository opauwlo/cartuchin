import "./cast/constants.js";
import "./util.js";
import "./bytes.js";
import "./rom.js";
import "./idb.js";
import "./device.js";
import "./cloud.js";
import "./connect.js";
import "./library.js";
import "./ui/screens.js";
import "./ui/sheets.js";
import "./ui/game-menu.js";
import "./ui/rename-cover.js";
import "./ui/dialogs.js";
import "./ui/pickers.js";
import "./player/perf.js";
import "./player/player.js";
import "./cast/common.js";
import "./cast/phone.js";
import "./cast/pad.js";
import "./cast/tv.js";
import "./diag.js";
import "./player/reset.js";
import "./ui/library-gamepad.js";
import { handleScreenLink } from "./cast/pad.js";
import { connect } from "./cloud.js";
import { diag, runDiagnostic } from "./diag.js";
import { APP_V, identifyOldRoms, loadRoms } from "./library.js";
import { dsPage, play } from "./player/player.js";
import { showWelcome } from "./ui/screens.js";
import { $ } from "./util.js";

/* ---------------- boot ---------------- */
$("#connectBtn").addEventListener("click", () => {
  showWelcome();
  window.scrollTo(0, 0);
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
/* GitHub Pages lets browsers keep the page for 10 minutes. version.txt is asked for
   with the cache bypassed: when it names a newer version than this script, the page
   reloads once, so a TV or phone never runs an old build after an update. */
(async () => {
  if (!APP_V || sessionStorage.getItem("cartucho.reloaded") === APP_V) return;
  try {
    const r = await fetch("version.txt?t=" + Date.now(), { cache: "no-store" });
    const latest = (await r.text()).trim();
    if (r.ok && /^\d{14}$/.test(latest) && latest > APP_V) {
      sessionStorage.setItem("cartucho.reloaded", APP_V);
      if ("caches" in window) { try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) {} }
      location.reload();
    }
  } catch (e) {}
})();
handleScreenLink();
{ // #diagnostico runs the whole speed test; #diagnostico:touch,cast only those steps (used by the automated test to re-check)
  const m = location.hash.match(/^#diagnostico(?::([a-z,]+))?$/);
  if (m) {
    diag.only = m[1] ? m[1].split(",") : null;
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    setTimeout(runDiagnostic, 300);
  }
}
(async () => {
  if (dsPage) {
    // página do jogo de DS: na primeira visita o service worker ainda não controla a
    // página, então ela não veio isolada; recarrega uma vez para ganhar as threads
    if (!window.crossOriginIsolated && "serviceWorker" in navigator && !sessionStorage.getItem("cartucho.dsIso")) {
      sessionStorage.setItem("cartucho.dsIso", "1");
      try {
        await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 3000))]);
        if (navigator.serviceWorker.controller) { location.reload(); return; }
      } catch (e) {}
    }
    $("#library").hidden = true;
  }
  await loadRoms();
  await connect();
  if (dsPage) { play(dsPage); return; }
  identifyOldRoms();
})();
