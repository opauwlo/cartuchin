import { cloud, getSaveDoc, googleAvailable, isGoogle, writeCloud } from "../cloud.js";
import { dialog } from "./dialogs.js";
import { showConnect } from "../connect.js";
import { addTile, continueHero, gameInfo, roms, tile } from "../library.js";
import { closeSheets, fillGameSheet, sheetKey } from "./sheets.js";
import { idb } from "../idb.js";
import { $, el, ls, toast } from "../util.js";
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
/* saves que ficaram só neste aparelho (jogou sem rede, fechou antes de enviar) */
async function pendingSaves() {
  const keys = await idb.keys("pend"), out = [];
  for (const k of keys) {
    if (typeof k !== "string" || k.includes(":")) continue;
    const r = await idb.get("pend", k);
    if (r && r.sav) out.push({ key: k, ...r });
  }
  return out;
}
async function updateSyncBadge() {
  const b = $("#syncBadge");
  if (!cloud.auth) { b.hidden = true; return; }
  const pend = (await pendingSaves()).length;
  // texto longo e curto (celular estreito); tocar explica e oferece enviar
  const [cls, text, short, tip] = cloud.syncing ? ["", "Sincronizando…", "Sincronizando", "Buscando seus jogos na nuvem"]
    : pend ? ["pend", pend === 1 ? "1 save não enviado" : `${pend} saves não enviados`, `${pend} não enviado${pend > 1 ? "s" : ""}`, "Toque para enviar para a nuvem"]
    : cloud.db ? ["ok", "✓ Tudo na nuvem", "✓ Salvo", "Todos os saves estão na nuvem"] : ["off", "Sem conexão", "Offline", "Os saves ficam aqui e vão quando a rede voltar"];
  b.className = "sync-badge " + cls;
  b.replaceChildren(el("span", { class: "long" }, text), el("span", { class: "short" }, short));
  b.title = tip;
  b.hidden = false;
}
async function syncBadgeClick() {
  const pend = await pendingSaves();
  if (!pend.length) {
    toast(cloud.syncing ? "Buscando seus jogos na nuvem…" : cloud.db ? "Todos os saves estão na nuvem." : "Sem conexão com a nuvem agora. Os saves ficam aqui e vão quando a rede voltar.", 3500);
    return;
  }
  const names = pend.map((p) => gameInfo(p.key).title).join(", ");
  const ok = await dialog(pend.length === 1 ? "1 save ainda não foi para a nuvem" : `${pend.length} saves ainda não foram para a nuvem`,
    `${names}. Eles estão guardados neste aparelho e não se perdem, mas outro aparelho ainda não vê esse progresso.`,
    [{ label: "Enviar agora", value: true, cls: "primary" }, { label: "Depois", value: false }]);
  if (!ok) return;
  if (!cloud.db) { toast("Sem conexão com a nuvem agora. Tente de novo quando a rede voltar.", 4000); return; }
  let sent = 0, conflict = 0, failed = 0;
  for (const p of pend) {
    try {
      const remote = await getSaveDoc(p.key);
      // a nuvem tem um save novo de outro aparelho: quem escolhe é a pessoa, ao abrir o jogo
      if (remote && remote.sha !== p.sha && p.baseRev !== remote.rev) { conflict++; continue; }
      const g = gameInfo(p.key);
      const doc = remote && remote.sha === p.sha ? remote : await writeCloud(p.key, { title: g.title, system: g.system, code: g.code }, p.sav, p.sha);
      await idb.del("pend", p.key);
      await idb.put("sync", p.key, { lastSha: doc.sha, baseRev: doc.rev }).catch(() => {});
      sent++;
    } catch (e) { failed++; }
  }
  toast([sent && `${sent} enviado${sent > 1 ? "s" : ""}`, conflict && `${conflict} com save diferente na nuvem: abra o jogo para escolher qual fica`, failed && `${failed} não foi agora, tente de novo`].filter(Boolean).join(" · "), 5000);
  updateSyncBadge();
}
$("#syncBadge").addEventListener("click", syncBadgeClick);

export { showWelcome, render, showAvatar, prepaint };
