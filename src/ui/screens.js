import { cloud, googleAvailable, isGoogle } from "../cloud.js";
import { showConnect } from "../connect.js";
import { addTile, continueHero, gameInfo, roms, tile } from "../library.js";
import { closeSheets, fillGameSheet, openSheet, sheetKey } from "./sheets.js";
import { idb } from "../idb.js";
import { $, el, ls } from "../util.js";
import { prefetchDsCore } from "../ds/ds-emu.js";

/* ---------------- screens ---------------- */
const localOnly = () => ls.get("cartucho.localOnly") === "1";
function showWelcome() {
  closeSheets();
  ls.set("cartucho.localOnly", "");
  $("#connect").hidden = false;
  $("#home").hidden = true;
  $("#notice").hidden = true;
  if (typeof showConnect === "function") showConnect();
}

/* A letra da conta aparece já no carregamento (antes da rede) e fica guardada:
   sem e-mail ainda (token vencido, rede lenta) usa a última conhecida. */
function showAvatar() {
  const a = cloud.auth;
  const name = a && (a.email || a.owner);
  let letter = name ? name[0].toUpperCase() : "";
  if (letter) ls.set("cartucho.avatar", letter);
  else if (a) letter = ls.get("cartucho.avatar") || (a.kind === "google" ? "G" : "?");
  $("#avatarLetter").textContent = letter || "?";
}

/* antes de qualquer espera (banco local, nuvem): quem já usa o app vê a home com lugares
   marcados, não uma página em branco embaixo do cabeçalho */
function prepaint() {
  let known = localOnly();
  try { known = known || !!localStorage.getItem("cartucho.github"); } catch (e) {}
  if (!known) return;
  $("#home").hidden = false;
  $("#connect").hidden = true;
  $("#empty").hidden = true;
  const box = $("#games");
  box.hidden = false;
  box.replaceChildren(...[0, 1, 2].map(() => el("div", { class: "tile skel", "aria-hidden": "true" }, el("div", { class: "cover" }), el("span", { class: "skel-line" }), el("span", { class: "skel-line short" }))));
}

function render() {
  if (!cloud.ready) return;
  const welcome = !cloud.auth && !localOnly();
  $("#connect").hidden = !welcome;
  $("#home").hidden = welcome;
  $("#accountBtn").hidden = welcome;
  // account
  showAvatar();
  $("#connText").textContent = isGoogle()
    ? (cloud.db ? `Google Drive${cloud.auth.email ? ": " + cloud.auth.email : ""}` : "Google Drive: reconecte para sincronizar")
    : cloud.db ? `GitHub: ${cloud.auth.owner}/${cloud.auth.repo}` : cloud.auth ? "GitHub indisponível agora" : "Sem conta: os jogos ficam só neste aparelho.";
  $("#pairOtherBtn").hidden = !cloud.db || isGoogle();
  $("#disconnectBtn").hidden = !cloud.auth;
  $("#connectBtn").hidden = !!cloud.auth;
  const n = $("#notice");
  if (n.dataset.sticky !== "1") {
    if (!welcome && !cloud.auth && googleAvailable()) {
      n.className = "notice";
      n.hidden = false;
      n.replaceChildren(el("span", {}, "Seus jogos estão só neste aparelho. "), el("button", { class: "btn small", type: "button", onclick: showWelcome }, "Entrar com Google"));
    } else n.hidden = true;
  }
  if (welcome) return;
  // library
  const keys = new Set([...roms.keys(), ...cloud.docs.keys(), ...cloud.roms.keys()]);
  const games = [...keys].map(gameInfo)
    .sort((a, b) => ((b.save && b.save.at) || 0) - ((a.save && a.save.at) || 0) || a.title.localeCompare(b.title, "pt"));
  const recent = games.find((g) => g.save && g.playable);
  if (recent) continueHero(recent);
  else $("#continue").hidden = true;
  const box = $("#games");
  box.replaceChildren();
  // biblioteca ainda vindo da nuvem: lugares marcados em vez de "nenhum jogo"
  const waiting = !games.length && cloud.syncing;
  $("#empty").hidden = games.length > 0 || waiting;
  box.hidden = games.length === 0 && !waiting;
  for (const g of games) box.append(tile(g));
  if (waiting) for (let i = 0; i < 3; i++) box.append(el("div", { class: "tile skel", "aria-hidden": "true" }, el("div", { class: "cover" }), el("span", { class: "skel-line" }), el("span", { class: "skel-line short" })));
  // destaque do DS: some quando já há um jogo de DS ou quando a pessoa dispensa
  $("#dsPromo").hidden = !games.length || games.some((g) => g.system === "nds") || ls.get("cartucho.dsPromo") === "off";
  if (games.some((g) => g.system === "nds" && g.playable)) prefetchDsCore();   // "Jogar" sem esperar o download
  if (games.length) box.append(addTile());
  if (sheetKey) fillGameSheet(sheetKey);
  updateSyncBadge();
}
/* "Tudo salvo" / "N para enviar" / "Sem conexão" ao lado do avatar */
async function updateSyncBadge() {
  const b = $("#syncBadge");
  if (!cloud.auth) { b.hidden = true; return; }
  const pend = (await idb.all("pend")).filter((r) => r && r.sav).length;
  const [cls, text] = cloud.syncing ? ["", "Sincronizando…"] : pend ? ["pend", `↑ ${pend} para enviar`] : cloud.db ? ["ok", "✓ Tudo salvo"] : ["off", "Sem conexão"];
  b.className = "sync-badge " + cls;
  b.textContent = text;
  b.title = pend ? "Saves guardados neste aparelho, esperando a nuvem" : "";
  b.hidden = false;
}
$("#syncBadge").addEventListener("click", () => openSheet("settingsSheet"));

export { showWelcome, render, showAvatar, prepaint };
