import { unpack } from "../bytes.js";
import { idb } from "../idb.js";
import { player } from "../player/player.js";
import { dialog } from "./dialogs.js";
import { closeSheets, openSheet } from "./sheets.js";
import { $, ago, el, ls, toast } from "../util.js";

/* ---------------- galeria de estados (save states) ----------------
   Cada estado é um retrato do console guardado só neste aparelho, com miniatura.
   Manuais: até MAX_MANUAL por jogo (escolhe o espaço). Automáticos: ao sair do jogo,
   num rodízio de AUTO_SLOTS (o mais antigo é trocado).
   IndexedDB ("pend"): "stidx:<jogo>" = lista; "st:<jogo>:<id>" = estado (gzip, Blob). */
const MAX_MANUAL = 12, AUTO_SLOTS = 3;
const idxKey = (g) => "stidx:" + g, dataKey = (g, id) => "st:" + g + ":" + id;
const autoOn = () => ls.get("cartucho.autostate") !== "off";

async function list(game) {
  let items = (await idb.get("pend", idxKey(game))) || [];
  // estado rápido antigo ("quick:<jogo>", em base64) vira um item da galeria
  const old = await idb.get("pend", "quick:" + game);
  if (old && old.data) {
    try {
      const raw = await unpack(old);
      const id = "q" + (old.at || Date.now());
      await idb.put("pend", dataKey(game, id), { blob: await gz(raw) });
      items = [{ id, at: old.at || Date.now(), name: "", auto: false, thumb: null }, ...items];
      await idb.put("pend", idxKey(game), items);
    } catch (e) {}
    await idb.del("pend", "quick:" + game);
  }
  return items.sort((a, b) => b.at - a.at);
}
async function gz(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(s).blob();
}
async function ungz(blob) {
  const s = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/* miniatura da tela de cima (DS) ou da tela do jogo */
function thumb() {
  const src = /** @type {HTMLCanvasElement} */ ($("#game .ds-view") || $("#game canvas"));
  if (!src || !src.width) return Promise.resolve(null);
  let sx = 0, sy = 0, sw = src.width, sh = src.height;
  const lo = src.dataset && src.dataset.layout;
  if (lo === "both") sh /= 2;
  else if (lo === "side") sw /= 2;
  else if (lo === "focus") sw = sw * 2 / 3;
  else if (lo === "small") sh = sh / 1.75;
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = Math.round(192 * sh / sw);
  try {
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  } catch (e) { return Promise.resolve(null); }
  return new Promise((r) => c.toBlob((b) => r(b), "image/webp", 0.75));
}

/* um salvamento por vez: um segundo toque espera o primeiro terminar */
let queue = Promise.resolve(false);
function saveState(opts = {}) {
  queue = queue.then(() => doSave(opts), () => doSave(opts));
  return queue;
}
async function doSave({ auto = false, quiet = false, replaceId = null }) {
  const emu = player.emu, game = player.key;
  if (!emu || !game) return false;
  try {
    const st = await emu.gameManager.getState();
    if (!st || !st.length) throw new Error("vazio");
    // automático (ao sair): guarda sem comprimir, para terminar antes de o celular congelar a página
    const [data, pic] = await Promise.all([auto ? new Blob([st]) : gz(st), thumb()]);
    const items = await list(game);
    const old = replaceId ? items.find((i) => i.id === replaceId) : null;
    if (auto) {
      const autos = items.filter((i) => i.auto);
      while (autos.length >= AUTO_SLOTS) {
        const gone = autos.pop();
        items.splice(items.indexOf(gone), 1);
        await idb.del("pend", dataKey(game, gone.id));
      }
    } else if (!old && items.filter((i) => !i.auto).length >= MAX_MANUAL) {
      if (!quiet) toast(`Os ${MAX_MANUAL} espaços estão ocupados. Escolha um para substituir.`, 4000);
      return false;
    }
    const id = old ? old.id : (auto ? "a" : "m") + Date.now().toString(36);
    await idb.put("pend", dataKey(game, id), auto ? { raw: data } : { blob: data });
    if (old) items.splice(items.indexOf(old), 1);
    items.unshift({ id, at: Date.now(), name: old ? old.name : "", auto, thumb: pic, frames: emu.frames || 0 });
    await idb.put("pend", idxKey(game), items);
    if (!quiet) toast(old ? `Estado "${old.name || "sem nome"}" substituído` : "Estado salvo");
    return true;
  } catch (e) {
    console.warn("[estados] salvar", e);
    if (!quiet) toast("Não deu para salvar o estado.");
    return false;
  }
}
async function loadState(game, id) {
  const emu = player.emu;
  const rec = await idb.get("pend", dataKey(game, id));
  if (!emu || !rec || !(rec.blob || rec.raw)) { toast("Esse estado não está mais aqui."); return false; }
  try {
    await emu.gameManager.loadState(rec.raw ? new Uint8Array(await rec.raw.arrayBuffer()) : await ungz(rec.blob));
    toast("Estado carregado");
    return true;
  } catch (e) {
    // um load que falha no meio deixa o console quebrado: reinicia pelo save do jogo
    try { await emu.gameManager.restart(); } catch (x) {}
    toast("Não deu para carregar esse estado; o jogo reiniciou pelo save.", 4000);
    return false;
  }
}
async function removeState(game, id) {
  const items = (await list(game)).filter((i) => i.id !== id);
  await idb.put("pend", idxKey(game), items);
  await idb.del("pend", dataKey(game, id));
}
async function renameState(game, id, name) {
  const items = await list(game);
  const it = items.find((i) => i.id === id);
  if (it) it.name = name.slice(0, 40);
  await idb.put("pend", idxKey(game), items);
}
async function lastState(game) {
  const items = await list(game);
  return items[0] || null;
}

/* ---------- a folha da galeria ---------- */
const sheet = el("section", { class: "sheet", id: "statesSheet", role: "dialog", "aria-modal": "true", "aria-label": "Estados salvos", hidden: true });
$("#gameMenu").after(sheet);
const urls = [];
let mode = "load";   // "save": escolher onde salvar; "load": escolher qual carregar
async function openGallery(m = "load") {
  mode = m;
  await fillGallery();
  openSheet("statesSheet");
}
async function fillGallery() {
  const game = player.key;
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  const all = game ? await list(game) : [];
  const saving = mode === "save";
  const items = saving ? all.filter((i) => !i.auto) : all;   // salvar: só nos espaços manuais
  const manual = all.filter((i) => !i.auto).length;
  const grid = el("div", { class: "st-grid" });
  if (saving && manual < MAX_MANUAL) {
    grid.append(el("button", { class: "st-card st-new", type: "button", onclick: () => saveHere(null) },
      el("span", { class: "st-plus" }, "+"), el("b", {}, "Novo espaço")));
  }
  for (const it of items) {
    let img;
    if (it.thumb) {
      const u = URL.createObjectURL(it.thumb);
      urls.push(u);
      img = el("img", { src: u, alt: "" });
    } else img = el("div", { class: "st-noimg" }, "sem imagem");
    const title = it.name || (it.auto ? "Automático" : "Estado");
    const main = saving ? () => saveHere(it) : () => pick(it);
    grid.append(el("div", { class: "st-card" + (it.auto ? " auto" : ""), "data-id": it.id },
      el("button", { class: "st-pic", type: "button", "aria-label": `${saving ? "Salvar em" : "Carregar"} ${title}, ${ago(it.at)}`, onclick: main }, img,
        it.auto ? el("span", { class: "st-tag" }, "auto") : null),
      el("div", { class: "st-meta" },
        el("b", {}, title),
        el("span", {}, ago(it.at))),
      el("div", { class: "st-acts" },
        el("button", { class: "btn small primary", type: "button", onclick: main }, saving ? "Salvar aqui" : "Carregar"),
        el("button", { class: "btn small", type: "button", "aria-label": "Renomear", onclick: () => rename(it) }, "✎"),
        el("button", { class: "btn small danger", type: "button", "aria-label": "Apagar", onclick: () => remove(it) }, "✕"))));
  }
  sheet.replaceChildren(
    el("div", { class: "sheet-grip", "aria-hidden": "true" }),
    el("div", { class: "sheet-body" },
      el("div", { class: "st-head" },
        el("h3", {}, saving ? "Salvar estado em…" : "Carregar estado"),
        el("button", { class: "btn small", type: "button", onclick: () => { mode = saving ? "load" : "save"; fillGallery(); } }, saving ? "Ver para carregar" : "Salvar…")),
      items.length || saving ? grid : el("p", { class: "small-note" }, "Nenhum estado ainda. Um estado guarda o jogo exatamente como está agora, para voltar nele quando quiser."),
      el("p", { class: "small-note" }, `${manual} de ${MAX_MANUAL} espaços · guardados só neste aparelho`),
      saving ? null : el("button", { class: "gs-action", type: "button", onclick: () => { ls.set("cartucho.autostate", autoOn() ? "off" : "on"); fillGallery(); } },
        el("span", {}, `Salvar sozinho ao sair do jogo: ${autoOn() ? "Sim" : "Não"} (guarda os ${AUTO_SLOTS} últimos)`)),
      el("button", { class: "btn", type: "button", onclick: closeSheets }, "Voltar ao jogo")));
}
async function saveHere(it) {
  if (it) {
    const ok = await dialog("Substituir este estado?", `"${it.name || "Estado"}" de ${ago(it.at)} vira o jogo de agora.`,
      [{ label: "Substituir", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
    if (!ok) { openSheet("statesSheet"); return; }
  }
  closeSheets();
  await saveState({ replaceId: it ? it.id : null });
}
async function pick(it) {
  closeSheets();
  await loadState(player.key, it.id);
}
async function rename(it) {
  const name = prompt("Nome do estado", it.name || "");
  if (name == null) return;
  await renameState(player.key, it.id, name.trim());
  fillGallery();
}
async function remove(it) {
  const ok = await dialog("Apagar este estado?", `${it.name || (it.auto ? "Automático" : "Estado")} de ${ago(it.at)}. Não dá para desfazer.`,
    [{ label: "Apagar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) { openSheet("statesSheet"); return; }
  await removeState(player.key, it.id);
  await fillGallery();
  openSheet("statesSheet");
}

/* salvamento automático: na hora de sair (trocar de app, apagar a tela, voltar à
   biblioteca), nunca no meio do jogo — gerar o estado trava uns quadros */
function autoSave(e) {
  const emu = player.emu;
  if (!autoOn() || !emu || !player.key || !emu.frames || Date.now() - lastAuto < 60000) return;
  lastAuto = Date.now();
  const p = saveState({ auto: true, quiet: true });
  if (e && e.detail && e.detail.waits) e.detail.waits.push(p);   // quem sai espera terminar
}
let lastAuto = 0;
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") autoSave(); });
window.addEventListener("cartucho-game-exit", autoSave);

window.__states = { saveState, loadState, list, removeState, renameState, openGallery };   // usado pelo teste automático
export { saveState, loadState, openGallery, lastState, list as listStates };
