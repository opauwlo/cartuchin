import { crc32 } from "./bytes.js";
import { busy, cloud, getBinary, updateIndex } from "./cloud.js";
import { idb } from "./idb.js";
import { play } from "./player/player.js";
import { titleCase } from "./rom.js";
import { pickRom } from "./ui/pickers.js";
import { render } from "./ui/screens.js";
import { openGameSheet } from "./ui/sheets.js";
import { $, ago, el } from "./util.js";
import { fmtPlay, gameMeta } from "./meta.js";

/* ---------------- library ---------------- */
let roms = new Map();
async function loadRoms() {
  roms = new Map();
  for (const r of await idb.all("roms")) if (r && r.key) roms.set(r.key, r);
}

function notice(msg, kind) {
  const n = $("#notice");
  if (!msg) {
    n.hidden = true;
    return;
  }
  n.className = "notice" + (kind === "err" ? " err" : "");
  n.textContent = msg;
  n.hidden = false;
}

/* ---------------- game identity: name and cover ----------------
   db/<system>.json (built from the No-Intro lists used by RetroArch) maps a ROM's CRC32
   to its official name and says whether a box art exists on thumbnails.libretro.com.
   ROM hacks are not in it: they get a clean name from the file, a box art when the
   libretro collection has one for that hack, or a generated cover. */
const APP_V = (() => { try { return new URL(/** @type {HTMLScriptElement} */ (document.currentScript).src).searchParams.get("v") || ""; } catch (e) { return ""; } })();
const gameDbs = {};
function gameDb(sys) { return gameDbs[sys] || (gameDbs[sys] = fetch(`db/${sys}.json?v=${APP_V}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)); }
const thumbName = (n) => n.replace(/[&*/:`<>?\\|"]/g, "_");
function artUrls(c) {
  const f = encodeURIComponent(thumbName(c.name)) + ".png";
  return [`https://thumbnails.libretro.com/${encodeURIComponent(c.dir)}/Named_Boxarts/${f}`,
    `https://raw.githubusercontent.com/libretro-thumbnails/${c.dir.replace(/ /g, "_")}/master/Named_Boxarts/${f}`];
}
function prettyName(n) {
  let t = n.replace(/\s*[([][^)\]]*[)\]]/g, "").trim();
  t = t.replace(/^(.*?), (The|A|An)(?= - |$)/, "$2 $1");
  t = t.replace(/\s+-\s+/g, ": ").replace(/\bPokemon\b/g, "Pokémon");
  t = t.replace(/^Pokémon: (.+?) Version$/, "Pokémon $1").replace(/^Pokémon: /, "Pokémon ");
  return t;
}
function cleanTitle(raw) {
  let t = (raw || "").replace(/\.(gba|gbc|gb|nds|zip)$/i, "").replace(/_+/g, " ").replace(/\s*[([][^)\]]*[)\]]/g, " ");
  t = t.replace(/\s+(v|ver|version|vesion|versao|versão|rev)\.?\s*\d[\d.]*\s*$/i, "").replace(/\s+v?\d+(\.\d+)+\s*$/i, "");
  t = t.replace(/\s+/g, " ").trim();
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) t = titleCase(t.toLowerCase());
  return t.replace(/\bpok[eé]mon\b/gi, "Pokémon") || "Jogo";
}
const normTitle = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(hack\)|\bpokemon\b|\bversion\b/g, "").replace(/[^a-z0-9]/g, "");
async function identifyRom(bytes, info, fileName) {
  const crc = crc32(bytes).toString(16).toUpperCase().padStart(8, "0");
  const systems = info.system === "gba" ? ["gba"] : info.system === "nds" ? [] : ["gbc", "gb"];   // DS: ainda sem base de nomes
  for (const sys of systems) {
    const db = await gameDb(sys);
    if (!db) continue;
    const i = db.crc[crc];
    if (i != null) {
      const name = db.names[i];
      return { title: prettyName(name), cover: db.art[i] === "1" ? { dir: db.dir, name } : null };
    }
  }
  const title = cleanTitle(fileName || info.title);
  const want = normTitle(title);
  for (const sys of systems) {
    const db = await gameDb(sys);
    if (!db) continue;
    const h = (db.hacks || []).find((n) => normTitle(n) === want);
    if (h) return { title: prettyName(h), cover: { dir: db.dir, name: h } };
  }
  return { title, cover: null };
}
/* older ROMs on this device get a name and a cover in the background, one at a time */
let identifying = false;
async function identifyOldRoms() {
  if (identifying) return;
  identifying = true;
  try {
    for (const rom of [...roms.values()]) {
      if (rom.ident || !rom.blob) continue;
      const id = await identifyRom(new Uint8Array(await rom.blob.arrayBuffer()), rom, rom.fileName);
      const upd = { ...rom, ident: true, cover: rom.cover !== undefined && rom.cover !== null ? rom.cover : id.cover, title: rom.titleSet ? rom.title : id.title };
      await idb.put("roms", rom.key, upd).catch(() => {});
      roms.set(rom.key, upd);
      const ix = cloud.index && cloud.index.games && cloud.index.games[rom.key];
      if (cloud.db && ix && (!ix.titleSet || ix.cover === undefined)) {
        await updateIndex((d) => {
          const g = d.games[rom.key];
          if (!g) return;
          if (!g.titleSet) g.title = upd.title;
          if (g.cover === undefined || g.cover === null) g.cover = upd.cover;
        }, `Biblioteca: ${upd.title}`).catch(() => {});
      }
      render();
    }
  } finally { identifying = false; }
}

/* everything the library knows about one game, from this device and the cloud */
function gameInfo(key) {
  const rom = roms.get(key), save = cloud.docs.get(key), crom = cloud.roms.get(key);
  const ix = (cloud.index && cloud.index.games && cloud.index.games[key]) || null;
  const title = (ix && ix.title) || (rom && rom.title) || (save && save.title) || (crom && crom.title) || key;
  const cover = ix && ix.cover !== undefined && ix.cover !== null ? ix.cover : (rom && rom.cover) || null;
  const coverRev = (ix && ix.coverRev) || (rom && rom.coverRev) || "";
  const system = (rom && rom.system) || (save && save.system) || (crom && crom.system) || "gba";
  const code = (rom && rom.code) || (save && save.code) || (crom && crom.code) || "";
  return { key, rom, save, crom, ix, title, cover, coverRev, system, code, sys: system === "gba" ? "GBA" : system === "nds" ? "DS" : (rom && rom.ext === "gbc") ? "GBC" : "GB", playable: !!(rom || crom) };
}

/* custom covers: kept in IndexedDB and, with a cloud, in covers/<key>.jpg */
const coverUrls = new Map(), coverLoading = new Set();
async function customCoverUrl(key, rev) {
  const id = key + ":" + rev;
  if (coverUrls.has(id)) return coverUrls.get(id);
  if (coverLoading.has(id)) return null;
  coverLoading.add(id);
  try {
    let rec = await idb.get("covers", key);
    if ((!rec || rec.rev !== rev) && cloud.db) {
      const r = await getBinary("covers/" + key + ".jpg");
      rec = { rev, blob: new Blob([await r.arrayBuffer()], { type: "image/jpeg" }) };
      await idb.put("covers", key, rec).catch(() => {});
    }
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    coverUrls.set(id, url);
    return url;
  } catch (e) { return null; } finally { coverLoading.delete(id); }
}
function hueOf(t) {
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
function genCover(g) {
  return el("div", { class: "gen-cover", style: `--h:${hueOf(g.title)}` }, el("span", { class: "gen-title" }, g.title), el("span", { class: "gen-sys" }, [g.sys, g.code].filter(Boolean).join(" ")));
}
function coverEl(g) {
  const box = el("div", { class: "cover" });
  if (g.cover === "custom") {
    const id = g.key + ":" + g.coverRev;
    if (coverUrls.has(id)) box.append(el("img", { src: coverUrls.get(id), alt: "", loading: "lazy" }));
    else {
      box.append(genCover(g));
      customCoverUrl(g.key, g.coverRev).then((u) => { if (u) render(); });
    }
  } else if (g.cover && g.cover.name) {
    const [main, mirror] = artUrls(g.cover);
    const img = el("img", { src: main, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => {
      if (img.dataset.alt !== "1") {
        img.dataset.alt = "1";
        img.src = mirror;
      }
      else img.replaceWith(genCover(g));
    });
    box.append(img);
  } else box.append(genCover(g));
  return box;
}
function saveLine(g) {
  const working = busy.get(g.key);
  if (working) return [el("span", { class: "tile-busy" }, working)];
  if (g.save) return [el("span", { class: "dot ok" }), el("span", {}, `Salvo ${ago(g.save.at)}`)];
  if (!g.playable) return [el("span", { class: "dot warn" }), el("span", {}, "Falta a ROM neste aparelho")];
  if (g.rom && !g.crom && cloud.db) return [el("span", { class: "dot" }), el("span", {}, "Só neste aparelho")];
  return [el("span", { class: "dot" }), el("span", {}, "Ainda sem save")];
}
function tile(g) {
  const m = gameMeta(g.key);
  return el("button", { class: "tile" + (m.fav ? " fav" : ""), type: "button", onclick: () => openGameSheet(g.key), "aria-label": g.title + (m.fav ? ", favorito" : "") },
    coverEl(g), m.fav ? el("span", { class: "tile-star", "aria-hidden": "true" }, "★") : null,
    el("span", { class: "tile-title" }, g.title), el("span", { class: "tile-meta" }, saveLine(g)));
}
function addTile() {
  const plus = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  plus.setAttribute("viewBox", "0 0 24 24");
  plus.innerHTML = '<path d="M12 5v14M5 12h14"/>';
  return el("button", { class: "tile add-tile", type: "button", onclick: pickRom }, el("div", { class: "cover" }, plus), el("span", { class: "tile-title" }, "Adicionar jogo"));
}
function continueHero(g) {
  const sec = $("#continue");
  sec.replaceChildren(coverEl(g),
    el("div", { class: "continue-body" },
      el("p", { class: "continue-kicker" }, "Continuar jogando"),
      el("h2", { class: "continue-title" }, g.title),
      el("p", { class: "continue-meta" }, `Salvo ${ago(g.save.at)} no ${g.save.device || "outro aparelho"}` + (gameMeta(g.key).ms >= 60000 ? ` · ${fmtPlay(gameMeta(g.key).ms)} de jogo` : "")),
      el("button", { class: "btn primary", type: "button", onclick: () => play(g.key) }, busy.get(g.key) || "Continuar")));
  sec.hidden = false;
}

export { roms, loadRoms, notice, APP_V, identifyRom, identifyOldRoms, gameInfo, coverEl, tile, addTile, continueHero };
