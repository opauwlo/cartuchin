import { busy, cloud, cloudName, uploadRom } from "../cloud.js";
import { coverEl, gameInfo } from "../library.js";
import { fmtPlay, gameMeta, toggleFav } from "../meta.js";
import { play } from "../player/player.js";
import { peekGame, raCached } from "../ra.js";
import { confirmDeleteGame, confirmRemoveRom, confirmRestore, downloadSave } from "./dialogs.js";
import { pickRom, pickSav } from "./pickers.js";
import { pickCover, renameGame } from "./rename-cover.js";
import { closeSheets, sheetAction } from "./sheets.js";
import { listStates } from "./states.js";
import { $, ago, el } from "../util.js";

/* ---------------- página do jogo ----------------
   Tudo sobre um jogo numa página só: jogar, tempo de jogo, conquistas, save, estados e o
   que dá para fazer com ele. A folha que sobe na biblioteca fica só com Jogar e Detalhes. */
const page = el("section", { class: "details", id: "gameDetails", role: "dialog", "aria-modal": "true", "aria-labelledby": "gdTitle", hidden: true });
document.body.append(page);
let openKey = null;

function openDetails(key) {
  openKey = key;
  closeSheets();
  fill();
  page.hidden = false;
  page.scrollTop = 0;
  history.pushState({ details: key }, "");
  const g = gameInfo(key), cached = raCached(key);
  // conquistas ainda não vistas: lê a lista do RA (só com a ROM aqui e conta do RA conectada)
  if (!cached && g.rom) peekGame(key, g.rom).then(() => { if (openKey === key) fill(); }, () => {});
}
function closeDetails() {
  if (page.hidden) return;
  page.hidden = true;
  openKey = null;
}
window.addEventListener("popstate", () => closeDetails());

function stat(label, value, note) {
  return el("div", { class: "gd-stat" }, el("span", { class: "gd-stat-l" }, label), el("span", { class: "gd-stat-v" }, value), note ? el("span", { class: "gd-stat-l" }, note) : null);
}
function fill() {
  const key = openKey;
  if (!key) return;
  const g = gameInfo(key), m = gameMeta(key), ra = raCached(key);
  const working = busy.get(key);
  const playBtn = working ? el("button", { class: "btn primary", type: "button", disabled: true }, working)
    : g.playable ? el("button", { class: "btn primary", type: "button", onclick: () => { history.back(); play(key); } }, g.save ? "Continuar" : "Jogar")
    : el("button", { class: "btn primary", type: "button", onclick: () => pickRom() }, "Adicionar a ROM neste aparelho");
  const fav = el("button", { class: "btn gd-fav" + (m.fav ? " on" : ""), type: "button", "aria-pressed": m.fav ? "true" : "false", onclick: () => { toggleFav(key); fill(); window.dispatchEvent(new Event("cartucho-library-changed")); } },
    m.fav ? "★ Favorito" : "☆ Favoritar");

  // números do jogo
  const stats = el("div", { class: "gd-stats" },
    stat("Tempo de jogo", m.ms >= 60000 ? fmtPlay(m.ms) : "ainda não"),
    stat("Último save", g.save ? ago(g.save.at) : "ainda não", g.save ? `no ${g.save.device || "outro aparelho"}` : null),
    ra && ra.game ? stat("Conquistas", `${ra.game.unlocked} de ${ra.game.total}`, `${ra.game.pointsUnlocked} pontos`) : null);

  // conquistas (RetroAchievements)
  let achievements = null;
  if (ra && ra.game && ra.list.length) {
    const pct = ra.game.points ? Math.round(ra.game.pointsUnlocked / ra.game.points * 100) : 0;
    const items = ra.list.slice().sort((a, b) => b.unlocked - a.unlocked);
    achievements = el("section", { class: "gd-sec" },
      el("h3", {}, "Conquistas"),
      el("div", { class: "gd-bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, el("span", { style: `width:${pct}%` })),
      el("p", { class: "gd-note" }, `${ra.game.pointsUnlocked} de ${ra.game.points} pontos · atualizado ${ago(ra.at)}`),
      el("div", { class: "gd-badges" }, ...items.map((a) => el("div", { class: "gd-badge" + (a.unlocked ? " on" : ""), title: `${a.title}: ${a.description}` },
        el("img", { src: a.unlocked ? a.badge : a.badgeLocked, alt: "", width: "56", height: "56", loading: "lazy" }),
        el("span", {}, a.title)))));
  } else if (ra && ra.none) achievements = el("section", { class: "gd-sec" }, el("h3", {}, "Conquistas"), el("p", { class: "gd-note" }, "Este jogo não tem conquistas no RetroAchievements (ou esta versão da ROM não é a reconhecida)."));

  // save e estados
  const saveLines = el("div", { class: "gs-status" },
    el("div", { class: "sync-line" }, g.save ? [el("span", { class: "dot ok" }), `Save na nuvem ${ago(g.save.at)}, do ${g.save.device || "outro aparelho"}`]
      : cloud.db ? [el("span", { class: "dot" }), "Ainda sem save na nuvem"] : [el("span", { class: "dot warn" }), "Save só neste aparelho"]),
    el("div", { class: "sync-line" }, g.crom ? [el("span", { class: "dot ok" }), "ROM na nuvem, abre em qualquer aparelho"]
      : g.rom ? [el("span", { class: "dot" }), cloud.db ? "ROM só neste aparelho" : "ROM neste aparelho"] : [el("span", { class: "dot warn" }), "A ROM não está neste aparelho"]));
  listStates(key).then((items) => {
    if (!items.length || openKey !== key) return;
    saveLines.append(el("div", { class: "sync-line" }, el("span", { class: "dot ok" }), `${items.length} ${items.length === 1 ? "estado salvo" : "estados salvos"} neste aparelho, o último ${ago(items[0].at)}`));
  }, () => {});
  const saveActs = el("div", { class: "gs-actions" });
  if (cloud.db) saveActs.append(sheetAction("upload", "Enviar arquivo .sav", () => pickSav(key, { title: g.title, system: g.system, code: g.code })));
  if (g.save) saveActs.append(sheetAction("download", "Baixar o save", () => downloadSave(g.save)));
  if (g.save && g.save.prev) saveActs.append(sheetAction("back", "Voltar à versão anterior do save", () => confirmRestore(key, g.save)));

  const gameActs = el("div", { class: "gs-actions" });
  if (g.rom && !g.crom && cloud.db && !working) gameActs.append(sheetAction("cloud", `Guardar a ROM no ${cloudName()}`, () => uploadRom(g.rom)));
  gameActs.append(sheetAction("image", "Trocar capa", () => pickCover(key)));
  gameActs.append(sheetAction("edit", "Renomear", () => renameGame(key)));

  const dangerActs = el("div", { class: "gs-actions" });
  if (g.rom && !g.crom) dangerActs.append(sheetAction("trash", "Tirar a ROM deste aparelho", () => confirmRemoveRom(key, g.title), true));
  dangerActs.append(sheetAction("trash", "Apagar save e progresso", async () => { if (await confirmDeleteGame(key, g.title, false)) fill(); }, true));
  dangerActs.append(sheetAction("trash", "Apagar jogo (ROM, save e progresso)", async () => { if (await confirmDeleteGame(key, g.title, true)) history.back(); }, true));

  page.replaceChildren(
    el("div", { class: "gd-top" },
      el("button", { class: "btn small ghost pbtn", type: "button", "aria-label": "Voltar à biblioteca", onclick: () => history.back() },
        Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "svg"), { innerHTML: '<path d="M15 5l-7 7 7 7"/>' })),
      el("span", { class: "gd-top-title" }, g.title)),
    el("div", { class: "gd-body" },
      el("header", { class: "gd-hero" }, coverEl(g),
        el("div", { class: "gd-head" },
          el("h1", { id: "gdTitle" }, g.title),
          el("p", { class: "gd-sub" }, [g.sys, g.code].filter(Boolean).join(" · ")),
          el("div", { class: "gd-play" }, playBtn, fav))),
      stats, achievements,
      el("section", { class: "gd-sec" }, el("h3", {}, "Save"), saveLines, saveActs),
      el("section", { class: "gd-sec" }, el("h3", {}, "Jogo"), gameActs),
      el("section", { class: "gd-sec danger" }, dangerActs)));
  const svg = page.querySelector(".gd-top svg");
  if (svg) svg.setAttribute("viewBox", "0 0 24 24");
}
// a biblioteca mudou (save chegou, capa trocada, conquistas lidas): atualiza a página aberta
for (const ev of ["ra-cache", "cartucho-library-changed"]) window.addEventListener(ev, () => { if (openKey) fill(); });

export { openDetails, closeDetails, fill as fillDetails, openKey as detailsKey };
