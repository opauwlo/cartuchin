import { busy, cloud, cloudName, uploadRom } from "../cloud.js";
import { coverEl, gameInfo } from "../library.js";
import { play } from "../player/player.js";
import { confirmDeleteGame, confirmRemoveRom, confirmRestore, downloadSave } from "./dialogs.js";
import { pickRom, pickSav } from "./pickers.js";
import { pickCover, renameGame } from "./rename-cover.js";
import { $, $$, ago, el } from "../util.js";

/* ---------------- sheets ---------------- */
let sheetKey = null;
function openSheet(id) {
  $("#sheetScrim").hidden = false;
  for (const sh of $$(".sheet")) sh.hidden = sh.id !== id;
  const first = $("#" + id).querySelector("button");
  if (first) setTimeout(() => first.focus(), 30);
}
function closeSheets() {
  sheetKey = null;
  $("#sheetScrim").hidden = true;
  for (const sh of $$(".sheet")) sh.hidden = true;
}
$("#sheetScrim").addEventListener("click", closeSheets);
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheetScrim").hidden) closeSheets(); });
$("#accountBtn").addEventListener("click", () => openSheet("settingsSheet"));
$("#settingsClose").addEventListener("click", closeSheets);

const ICONS = {
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 11v6M9.5 13.5 12 11l2.5 2.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 10 4 4M21 10l-4 4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  restart: '<path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 1-8.5L4 10"/>',
};
function sheetAction(icon, label, fn, danger) {
  const b = el("button", { class: "gs-action" + (danger ? " danger" : ""), type: "button", onclick: fn });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.innerHTML = ICONS[icon];
  b.append(svg, el("span", {}, label));
  return b;
}
function openGameSheet(key) {
  sheetKey = key;
  fillGameSheet(key);
  openSheet("gameSheet");
}
function fillGameSheet(key) {
  const g = gameInfo(key), sh = $("#gameSheet");
  const status = el("div", { class: "gs-status" },
    el("div", { class: "sync-line" }, g.save ? [el("span", { class: "dot ok" }), `Save na nuvem ${ago(g.save.at)}, do ${g.save.device || "outro aparelho"}`]
      : cloud.db ? [el("span", { class: "dot" }), "Ainda sem save na nuvem"] : [el("span", { class: "dot warn" }), "Save só neste aparelho"]),
    el("div", { class: "sync-line" }, g.crom ? [el("span", { class: "dot ok" }), "ROM na nuvem, abre em qualquer aparelho"]
      : g.rom ? [el("span", { class: "dot" }), cloud.db ? "ROM só neste aparelho" : "ROM neste aparelho"] : [el("span", { class: "dot warn" }), "A ROM não está neste aparelho"]));
  const working = busy.get(key);
  const playBtn = working ? el("button", { class: "btn primary", type: "button", disabled: true }, working)
    : g.playable ? el("button", { class: "btn primary", type: "button", onclick: () => {
      closeSheets();
      play(key);
    } }, g.save ? "Continuar" : "Jogar")
    : el("button", { class: "btn primary", type: "button", onclick: () => {
      closeSheets();
      pickRom();
    } }, "Adicionar a ROM neste aparelho");
  const acts = el("div", { class: "gs-actions" });
  if (g.rom && !g.crom && cloud.db && !working) acts.append(sheetAction("cloud", `Guardar a ROM no ${cloudName()}`, () => uploadRom(g.rom)));
  acts.append(sheetAction("image", "Trocar capa", () => pickCover(key)));
  acts.append(sheetAction("edit", "Renomear", () => renameGame(key)));
  if (cloud.db) acts.append(sheetAction("upload", "Enviar arquivo .sav", () => pickSav(key, { title: g.title, system: g.system, code: g.code })));
  if (g.save) acts.append(sheetAction("download", "Baixar o save", () => downloadSave(g.save)));
  if (g.save && g.save.prev) acts.append(sheetAction("back", "Voltar à versão anterior do save", () => confirmRestore(key, g.save)));
  if (g.rom && !g.crom) acts.append(sheetAction("trash", "Tirar a ROM deste aparelho", () => confirmRemoveRom(key, g.title), true));
  acts.append(sheetAction("trash", "Apagar save e progresso", async () => { if (await confirmDeleteGame(key, g.title, false)) fillGameSheet(key); }, true));
  acts.append(sheetAction("trash", "Apagar jogo (ROM, save e progresso)", async () => { if (await confirmDeleteGame(key, g.title, true)) closeSheets(); }, true));
  sh.replaceChildren(el("div", { class: "sheet-grip", "aria-hidden": "true" }),
    el("div", { class: "sheet-body" },
      el("div", { class: "gs-head" }, coverEl(g), el("div", {}, el("h2", { class: "gs-title", id: "gsTitle" }, g.title), el("p", { class: "gs-sub" }, [g.sys, g.code].filter(Boolean).join(" · ")))),
      el("div", { class: "gs-play" }, playBtn), status, acts));
}

export { sheetKey, openSheet, closeSheets, sheetAction, openGameSheet, fillGameSheet };
