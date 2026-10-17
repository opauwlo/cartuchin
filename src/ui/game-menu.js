import { player } from "../player/player.js";
import { gov } from "../player/perf.js";
import { openAchievements, ra, raSummary } from "../ra.js";
import { dsMenuItems } from "../ds/ds-emu.js";
import { dialog } from "./dialogs.js";
import { lastState, openGallery } from "./states.js";
import { padPrefs, padState, setPadPrefs } from "../cast/pad.js";
import { closeSheets, openSheet, sheetAction } from "./sheets.js";
import { $, $$, ago, ls, toast } from "../util.js";

/* ---------------- game menu (speed, pause, sound, emulator options) ----------------
   The emulator's own menu bar is hidden while our controller is on screen, so the
   things people reach for while playing live here instead. */
const ffState = { ratio: 1, last: Number(ls.get("cartucho.ff") || 2) };
function setSpeed(r) {
  const t = player.remote || player.emu, gm = t && t.gameManager;   // remote: o jogo roda na outra tela
  if (!gm) return;
  r = Number(r) || 1;
  try {
    if (r > 1) {
      gm.setFastForwardRatio(r);
      gm.toggleFastForward(1);
      ffState.last = r;
      ls.set("cartucho.ff", String(r));
    }
    else { gm.toggleFastForward(0); gov.ratio = 0; gov.last = null; }   // o ajuste automático recomeça do zero
  } catch (e) {}
  ffState.ratio = r;
  player.userFF = r > 1;   // o ajuste automático de velocidade do GBA não mexe enquanto isso
  const ff = $("#padFF");
  ff.textContent = (r > 1 ? r : ffState.last) + "x";
  ff.setAttribute("aria-pressed", r > 1 ? "true" : "false");
  for (const b of $$("#ffModes button")) b.classList.toggle("primary", Number(b.dataset.ff) === r);
}
$("#padFF").addEventListener("click", () => setSpeed(ffState.ratio > 1 ? 1 : ffState.last));
$("#ffModes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ff]");
  if (b) {
    setSpeed(b.dataset.ff);
    fillGameMenu();
  }
});
const lastInfo = { key: "", at: 0 };
let setOpen = false;   // seção "Ajustes" do menu aberta
function fillGameMenu() {
  const emu = player.remote || player.emu, acts = $("#gmActions");
  lastState(player.key).then((it) => {
    const at = it ? it.at : 0;
    if (lastInfo.key !== player.key || lastInfo.at !== at) {
      Object.assign(lastInfo, { key: player.key, at });
      if (!$("#gameMenu").hidden) fillGameMenu();
    }
  }, () => {});
  const sub = (b) => { b.classList.add("sub"); return b; };
  // principais à vista; o resto em "Ajustes" (recolhido)
  acts.replaceChildren(...[
    sheetAction(emu && emu.paused ? "play" : "pause", emu && emu.paused ? "Continuar o jogo" : "Pausar", () => {
      try { emu.paused ? emu.play() : emu.pause(); } catch (e) {}
      fillGameMenu();
    }),
    sheetAction("save", "Salvar estado…", () => openGallery("save")),
    sheetAction("download", "Carregar estado…" + (lastInfo.at ? ` (último ${ago(lastInfo.at)})` : ""), () => openGallery("load")),
    sheetAction("cloud", "Salvar progresso na nuvem", () => {
      closeSheets();
      $("#saveNowBtn").click();
    }),
    sheetAction("back", "Carregar o save da nuvem", () => {
      closeSheets();
      $("#pullBtn").click();
    }),
    ra.game && ra.game.total ? sheetAction("star", `Conquistas (${raSummary()})`, () => { closeSheets(); openAchievements(); }) : null,
    sheetAction("image", "Jogar numa segunda tela", () => {
      closeSheets();
      $("#castBtn").click();
    }),
    sheetAction("sliders", (setOpen ? "▾ " : "▸ ") + "Ajustes", () => { setOpen = !setOpen; fillGameMenu(); }),
    ...(setOpen ? [
      sub(sheetAction(emu && emu.muted ? "sound" : "mute", emu && emu.muted ? "Ligar o som" : "Tirar o som", () => {
        try { emu.muted ? (emu.muted = false, emu.setVolume(emu.volume || 0.5)) : (emu.muted = true, emu.setVolume(0)); } catch (e) {}
        fillGameMenu();
      })),
      ...padItems().map(sub),
      ...(player.isDs ? dsMenuItems(emu, fillGameMenu).map((it) => { const b = sheetAction(it.icon, it.label, it.fn); b.classList.add(it.sub ? "sub2" : "sub"); return b; }) : []),
      player.isDs ? null : sub(sheetAction("sliders", $("#player").classList.contains("show-ejs") ? "Esconder opções do emulador" : "Opções avançadas do emulador", () => {
        const on = !$("#player").classList.contains("show-ejs");
        $("#player").classList.toggle("show-ejs", on);
        closeSheets();
        if (on) toast("As opções do emulador aparecem na barra embaixo da imagem do jogo", 3500);
      })),
      sub(sheetAction("restart", "Reiniciar o jogo", async () => {
        closeSheets();
        const ok = await dialog("Reiniciar o jogo?", "O jogo volta para a tela de título. O que não foi salvo dentro do jogo se perde.",
          [{ label: "Reiniciar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
        if (ok) try { emu.gameManager.restart(); } catch (e) {}
      }, true)),
    ] : []),
  ].filter(Boolean));
  setSpeed(ffState.ratio);
}
/* controle na tela: tamanho, transparência, lado (por sistema) */
const ZOOMS = [0.85, 1, 1.15, 1.3], ALPHAS = [1, 0.75, 0.5];
const nextIn = (list, v) => list[(list.indexOf(v) + 1) % list.length] ?? list[0];
function padItems() {
  if (padState.mode !== "local") return [];
  const p = padPrefs();
  return [
    sheetAction("sliders", `Controles: tamanho ${Math.round(p.zoom * 100)}%`, () => { setPadPrefs({ zoom: nextIn(ZOOMS, p.zoom) }); fillGameMenu(); }),
    sheetAction("sliders", `Controles: ${p.alpha === 1 ? "sem transparência" : `transparência ${Math.round((1 - p.alpha) * 100)}%`}`, () => { setPadPrefs({ alpha: nextIn(ALPHAS, p.alpha) }); fillGameMenu(); }),
    sheetAction("sliders", `Direcional à ${p.swap ? "direita" : "esquerda"}`, () => { setPadPrefs({ swap: !p.swap }); fillGameMenu(); }),
  ];
}
function openGameMenu() {
  if (!player.emu) return;
  fillGameMenu();
  openSheet("gameMenu");
}
$("#padMenu").addEventListener("click", openGameMenu);
$("#menuBtn").addEventListener("click", openGameMenu);
$("#gmClose").addEventListener("click", closeSheets);
