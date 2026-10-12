import { cloud, putBinary, updateIndex } from "../cloud.js";
import { idb } from "../idb.js";
import { gameInfo, roms } from "../library.js";
import { render } from "./screens.js";
import { $, el, rid, toast } from "../util.js";

/* ---------------- rename and cover ---------------- */
async function setGameMeta(key, patch) {
  const rom = roms.get(key);
  if (rom) {
    const upd = { ...rom, ...patch, ident: true };
    await idb.put("roms", key, upd).catch(() => {});
    roms.set(key, upd);
  }
  if (cloud.db) {
    try { await updateIndex((d) => { d.games[key] = { ...(d.games[key] || {}), ...patch }; }, `Biblioteca: ${patch.title || gameInfo(key).title}`); }
    catch (e) { toast("Mudou neste aparelho, mas não deu para salvar na nuvem agora."); }
  } else if (cloud.index && cloud.index.games && cloud.index.games[key]) Object.assign(cloud.index.games[key], patch);
  render();
}
function renameGame(key) {
  const g = gameInfo(key), root = $("#dialogRoot");
  const input = el("input", { id: "renameInput", class: "rename-input", type: "text", maxlength: "60", value: g.title, autocomplete: "off" });
  const close = () => root.replaceChildren();
  root.replaceChildren(el("div", { class: "scrim" }, el("form", { class: "dialog", onsubmit: (e) => {
      e.preventDefault();
      const t = input.value.trim().replace(/\s+/g, " ");
      if (!t) {
        input.focus();
        return;
      }
      close();
      setGameMeta(key, { title: t, titleSet: true }).then(() => toast("Nome atualizado"));
    } },
    el("h2", {}, "Renomear"), input,
    el("button", { class: "btn primary", type: "submit" }, "Salvar nome"),
    el("button", { class: "btn", type: "button", onclick: close }, "Cancelar"))));
  input.focus();
  input.select();
}
let coverTarget = null;
function pickCover(key) {
  coverTarget = key;
  const i = $("#coverInput");
  i.value = "";
  i.click();
}
async function squareJpeg(file, size = 400) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height), c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
}
$("#coverInput").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0], key = coverTarget;
  coverTarget = null;
  if (!f || !key) return;
  try {
    const blob = await squareJpeg(f), rev = rid();
    await idb.put("covers", key, { rev, blob });
    if (cloud.db) await putBinary("covers/" + key + ".jpg", new Uint8Array(await blob.arrayBuffer()), "Capa", "image/jpeg");
    await setGameMeta(key, { cover: "custom", coverRev: rev });
    toast("Capa trocada");
  } catch (err) { toast("Não deu para usar essa imagem."); }
});

export { renameGame, pickCover };
