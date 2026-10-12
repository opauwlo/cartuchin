import { cloud, googleAvailable, isGoogle } from "../cloud.js";
import { showConnect } from "../connect.js";
import { addTile, continueHero, gameInfo, roms, tile } from "../library.js";
import { closeSheets, fillGameSheet, sheetKey } from "./sheets.js";
import { $, el, ls } from "../util.js";

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

function render() {
  if (!cloud.ready) return;
  const welcome = !cloud.auth && !localOnly();
  $("#connect").hidden = !welcome;
  $("#home").hidden = welcome;
  $("#accountBtn").hidden = welcome;
  // account
  const letter = cloud.auth && cloud.auth.email ? cloud.auth.email[0].toUpperCase() : cloud.auth && cloud.auth.owner ? cloud.auth.owner[0].toUpperCase() : "?";
  $("#avatarLetter").textContent = letter;
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
  $("#empty").hidden = games.length > 0;
  box.hidden = games.length === 0;
  for (const g of games) box.append(tile(g));
  if (games.length) box.append(addTile());
  if (sheetKey) fillGameSheet(sheetKey);
}

export { showWelcome, render };
