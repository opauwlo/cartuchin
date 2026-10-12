import { sha, unpack } from "../bytes.js";
import { writeCloud } from "../cloud.js";
import { idb } from "../idb.js";
import { loadRoms } from "../library.js";
import { render } from "./screens.js";
import { $, ago, el, toast } from "../util.js";

/* ---------------- dialogs ---------------- */
function dialog(title, text, buttons) {
  return new Promise((resolve) => {
    const root = $("#dialogRoot");
    const close = (v) => {
      root.replaceChildren();
      resolve(v);
    };
    const box = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("h2", {}, title), text ? el("p", {}, text) : null,
      ...buttons.map((b) => el("button", { class: "btn " + (b.cls || "") + (b.sub ? " choice" : ""), type: "button", onclick: () => close(b.value) },
        b.label, b.sub ? el("small", {}, b.sub) : null)));
    root.replaceChildren(el("div", { class: "scrim", onclick: (e) => { if (e.target === e.currentTarget) close(null); } }, box));
    const first = box.querySelector("button");
    if (first) first.focus();
  });
}

async function confirmRestore(key, save) {
  const p = save.prev;
  const ok = await dialog("Voltar à versão anterior?", `A versão anterior é de ${ago(p.at)} (${p.device || "outro aparelho"}). A versão atual vira a anterior, então dá para desfazer.`,
    [{ label: "Voltar à anterior", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  try {
    const sav = await unpack(p);
    const doc = await writeCloud(key, { title: save.title, system: save.system, code: save.code }, sav, p.sha || await sha(sav));
    await idb.del("pend", key);
    await idb.put("sync", key, { lastSha: doc.sha, baseRev: doc.rev });
    toast("Versão anterior restaurada");
  } catch (e) { toast("Não deu para restaurar agora. Tente de novo."); }
}

async function confirmRemoveRom(key, title) {
  const ok = await dialog(`Tirar ${title} deste aparelho?`, "A ROM sai só daqui. O save na nuvem continua lá.",
    [{ label: "Tirar ROM", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  await idb.del("roms", key);
  await loadRoms();
  render();
}

async function downloadSave(save) {
  try {
    const sav = await unpack(save);
    const name = (save.title || save.game).replace(/[^\w\- ]+/g, "").trim() || "save";
    const url = URL.createObjectURL(new Blob([sav], { type: "application/octet-stream" }));
    const a = el("a", { href: url, download: name + ".sav" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    toast("Não deu para baixar o save aqui.");
  }
}

export { dialog, confirmRestore, confirmRemoveRom, downloadSave };
