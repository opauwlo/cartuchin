import { sha, unzipRom } from "../bytes.js";
import { cloud, uploadRom, writeCloud } from "../cloud.js";
import { idb } from "../idb.js";
import { gameInfo, identifyRom, loadRoms, roms } from "../library.js";
import { parseRom } from "../rom.js";
import { dialog } from "./dialogs.js";
import { render } from "./screens.js";
import { $, ago, toast } from "../util.js";

/* ---------------- file pickers ---------------- */
function pickRom() { const i = $("#romInput"); i.value = ""; i.click(); }
let savTarget = null;
function pickSav(key, meta) { savTarget = { key, meta }; const i = $("#savInput"); i.value = ""; i.click(); }

$("#addRomBtn").addEventListener("click", pickRom);
$("#romInput").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    let bytes = new Uint8Array(await f.arrayBuffer()); let name = f.name;
    if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      const inner = await unzipRom(bytes);
      if (!inner) { toast("Não achei uma ROM de GBA ou GB dentro desse .zip."); return; }
      bytes = inner.bytes; name = inner.name.split("/").pop();
    }
    const info = parseRom(bytes, name);
    if (!info) { toast("Esse arquivo não parece uma ROM de GBA ou GB."); return; }
    const ext = info.system === "gba" ? "gba" : (/\.gbc$/i.test(name) ? "gbc" : "gb");
    const id = await identifyRom(bytes, info, name).catch(() => ({ title: info.title, cover: null }));
    await idb.put("roms", info.key, { ...info, title: id.title, cover: id.cover, ident: true, ext, fileName: name, size: bytes.length, addedAt: Date.now(), blob: new Blob([bytes]) });
    await loadRoms(); render();
    toast(cloud.docs.has(info.key) ? `${gameInfo(info.key).title}: o save da nuvem já está pronto` : `${gameInfo(info.key).title} adicionado`);
    if (cloud.assets && cloud.db && !cloud.roms.has(info.key)) uploadRom(roms.get(info.key));
  } catch (err) {
    toast("Não consegui ler esse arquivo.");
  }
});
$("#savInput").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0]; if (!f || !savTarget) return;
  const { key, meta } = savTarget; savTarget = null;
  try {
    const sav = new Uint8Array(await f.arrayBuffer());
    if (!sav.length || sav.length > 160 * 1024) { toast("Esse arquivo não parece um save de GBA (tamanho estranho)."); return; }
    const existing = cloud.docs.get(key);
    if (existing) {
      const ok = await dialog("Trocar o save da nuvem?", `O save atual (de ${ago(existing.at)}) vira a versão anterior, e dá para voltar nele depois.`,
        [{ label: "Trocar pelo arquivo", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
      if (!ok) return;
    }
    const doc = await writeCloud(key, meta, sav, await sha(sav));
    await idb.del("pend", key); await idb.put("sync", key, { lastSha: doc.sha, baseRev: doc.rev });
    toast("Save enviado para a nuvem");
  } catch (err) { toast("Não deu para enviar o save agora. Tente de novo."); }
});

export { pickRom, pickSav };
