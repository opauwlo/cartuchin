(() => {
"use strict";

/* ---------------- small helpers ---------------- */
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function toast(msg, ms = 2600) {
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
const rtf = (() => { try { return new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }); } catch (e) { return null; } })();
function ago(ts) {
  if (!ts) return "";
  const s = Math.round((ts - Date.now()) / 1000);
  const a = Math.abs(s);
  if (!rtf) return new Date(ts).toLocaleString("pt-BR");
  if (a < 45) return "agora há pouco";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ts).toLocaleDateString("pt-BR");
}
function fmtSize(n) { return n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; }

/* ---------------- bytes ---------------- */
function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function sha(u8) {
  try {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
    return Array.from(h.subarray(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; }
    return "f" + h.toString(16) + "-" + u8.length;
  }
}
async function pack(u8) {
  if (typeof CompressionStream === "function") {
    try {
      const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"));
      return { enc: "gz64", data: b64(new Uint8Array(await new Response(s).arrayBuffer())) };
    } catch (e) {}
  }
  return { enc: "b64", data: b64(u8) };
}
async function unpack(rec) {
  const raw = unb64(rec.data);
  if (rec.enc === "gz64") {
    const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  return raw;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipOne(name, data) {
  const nm = new TextEncoder().encode(name), crc = crc32(data);
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
  lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint32(16, crc, true);
  cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nm.length, true);
  const cdOff = 30 + nm.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nm.length, true); end.setUint32(16, cdOff, true);
  return new Blob([lh, nm, data, cd, nm, end], { type: "application/zip" });
}
const CP437_HI = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
function cp437(u8) { let s = ""; for (const c of u8) s += c < 128 ? String.fromCharCode(c) : CP437_HI[c - 128]; return s; }
async function unzipRom(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const fnl = dv.getUint16(p + 28, true), exl = dv.getUint16(p + 30, true), cml = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const flags = dv.getUint16(p + 8, true);
    const name = (flags & 0x800) ? new TextDecoder().decode(u8.subarray(p + 46, p + 46 + fnl)) : cp437(u8.subarray(p + 46, p + 46 + fnl));
    p += 46 + fnl + exl + cml;
    if (!/\.(gba|gbc|gb)$/i.test(name)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const comp = u8.subarray(start, start + csize);
    if (method === 0) return { name, bytes: comp.slice() };
    if (method === 8 && typeof DecompressionStream === "function") {
      const s = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return { name, bytes: new Uint8Array(await new Response(s).arrayBuffer()) };
    }
    throw new Error("zip-method");
  }
  return null;
}

/* ---------------- ROM header ---------------- */
const KNOWN = {
  BPE: "Pokémon Emerald", AXV: "Pokémon Ruby", AXP: "Pokémon Sapphire", BPR: "Pokémon FireRed", BPG: "Pokémon LeafGreen",
  AMK: "Mario Kart: Super Circuit", AZL: "The Legend of Zelda: A Link to the Past", BZM: "The Legend of Zelda: The Minish Cap",
  AMA: "Super Mario Advance", AA2: "Super Mario World: Super Mario Advance 2", AMT: "Metroid Fusion", BMX: "Metroid: Zero Mission",
  AGS: "Golden Sun", AGF: "Golden Sun: The Lost Age", AFX: "Final Fantasy Tactics Advance", AWR: "Advance Wars",
};
function ascii(u8, a, n) { let s = ""; for (let i = a; i < a + n && i < u8.length; i++) { const c = u8[i]; if (c === 0) break; s += c >= 32 && c < 127 ? String.fromCharCode(c) : ""; } return s.trim(); }
function titleCase(s) { return s.toLowerCase().replace(/(^|\s|[-:])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function parseRom(u8, fileName) {
  let system, title, code = "";
  if (u8.length > 0xc0 && u8[0xb2] === 0x96) {
    system = "gba"; title = ascii(u8, 0xa0, 12); code = ascii(u8, 0xac, 4);
  } else if (u8.length > 0x150 && u8[0x104] === 0xce && u8[0x105] === 0xed) {
    system = "gb"; const cgb = u8[0x143] === 0x80 || u8[0x143] === 0xc0;
    title = ascii(u8, 0x134, cgb ? 11 : 16);
    if (cgb) { const c = ascii(u8, 0x13f, 4); if (/^[A-Z0-9]{4}$/.test(c)) code = c; }
  } else return null;
  const clean = (title || fileName.replace(/\.[^.]+$/, "")).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "jogo";
  const key = /^[A-Z0-9]{4}$/.test(code) ? code + "-" + clean : system + "-" + clean;
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s*\((?:[^)]*)\)\s*/g, " ").trim();
  const nice = (base.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 4 ? base : title;
  const display = (code && KNOWN[code.slice(0, 3)]) || titleCase(nice || title || "Jogo");
  return { key, system, title: display, header: title, code };
}

/* mGBA picks the save chip from a table of known game codes. ROM hacks with a
   new code fall back to autodetect and get 64 KB flash, which leaves Pokémon
   hacks stuck on a white screen. For those, borrow Ruby's code (AXVE): mGBA then
   treats the ROM as a Pokémon hack and gives it 128 KB flash plus the clock. */
const MGBA_CODES = new Set("2GBP A2YE A3AE A3AJ A3AP AA2E AA2J AA2P AC8E AC8J AC8P AFXE AGFE AI2E AI2P ALFE ALFJ ALFP ALGP ALUE ALUP AR8E AREE AROP ASLE ASLF AW2E AW2P AWRE AWRP AX4E AX4J AX4P AXPD AXPE AXPF AXPI AXPJ AXPP AXPS AXVD AXVE AXVF AXVI AXVJ AXVP AXVS AZCE B24E B24P BDBE BDBP BDKJ BFTJ BGWJ BKAJ BLJJ BLJK BLVJ BPED BPEE BPEF BPEI BPEJ BPEP BPES BPGD BPGE BPGF BPGI BPGJ BPGP BPGS BPRD BPRE BPRF BPRI BPRJ BPRP BPRS BR4J BSME BUHJ KHPJ KYGE KYGJ KYGP PEAJ PSAE PSAJ RZWE RZWJ RZWP TCHK U32E U32J U32P U33J U3IE U3IJ U3IP V49E V49J V49P".split(" "));
function findBytes(u8, str) {
  const pat = Array.from(str, (c) => c.charCodeAt(0));
  outer: for (let i = u8.indexOf(pat[0]); i !== -1 && i <= u8.length - pat.length; i = u8.indexOf(pat[0], i + 1)) {
    for (let j = 1; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}
function fixSaveChip(u8) {
  if (u8.length < 0xc0 || u8[0xb2] !== 0x96) return u8;
  const code = ascii(u8, 0xac, 4);
  if (MGBA_CODES.has(code) || findBytes(u8, "FLASH1M_V") < 0) return u8;
  const out = u8.slice();
  out.set([0x41, 0x58, 0x56, 0x45], 0xac);
  let chk = 0; for (let i = 0xa0; i < 0xbd; i++) chk = (chk + out[i]) & 0xff;
  out[0xbd] = (-(chk + 0x19)) & 0xff;
  return out;
}

/* ---------------- local storage (IndexedDB) ---------------- */
const idb = (() => {
  let p = null;
  function open() {
    if (!p) p = new Promise((res, rej) => {
      let r; try { r = indexedDB.open("cartucho", 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { const d = r.result; for (const s of ["roms", "pend", "sync"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return p;
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    get: (s, k) => run(s, "readonly", (st) => st.get(k)).catch(() => undefined),
    put: (s, k, v) => run(s, "readwrite", (st) => st.put(v, k)),
    del: (s, k) => run(s, "readwrite", (st) => st.delete(k)).catch(() => {}),
    all: (s) => run(s, "readonly", (st) => st.getAll()).catch(() => []),
  };
})();

/* ---------------- device name ---------------- */
function guessDevice() {
  const ua = navigator.userAgent || "";
  if (/SmartTV|SMART-TV|Tizen|Web0S|webOS|AFT[A-Z]|BRAVIA|GoogleTV|Android TV|\bTV\b/i.test(ua)) return "TV";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Celular" : "Tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Windows/.test(ua)) return "PC";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "PC";
  return "Aparelho";
}
const device = { name: ls.get("cartucho.device") || guessDevice() };

/* ---------------- cloud: a private GitHub repository ----------------
   Layout of the data repo:
     cartucho.json        library index (game title, system, where the ROM lives)
     saves/<key>.json     current save + the previous one, gzipped and base64-encoded
     roms/<key>.gz        the ROM, gzipped
   Every write is a commit, so the repo's history is also a full backup. */
const GH_API = "https://api.github.com";
const AUTH_KEY = "cartucho.github";
const cloud = { db: false, docs: new Map(), roms: new Map(), ready: false, downloads: true, assets: false, auth: null, index: null, indexSha: null, saveShas: new Map() };
const busy = new Map();
const MAX_DOC = 900 * 1024;

function loadAuth() {
  try { const a = JSON.parse(ls.get(AUTH_KEY) || "null"); if (a && a.token && a.owner && a.repo) return a; } catch (e) {}
  return null;
}
function saveAuth(a) { ls.set(AUTH_KEY, JSON.stringify(a)); }
function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }

async function gh(path, opts = {}, auth = cloud.auth) {
  const headers = {
    Authorization: "Bearer " + auth.token,
    Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.body) headers["Content-Type"] = "application/json";
  const r = await fetch(GH_API + path, { method: opts.method || "GET", body: opts.body, headers, cache: "no-store" });
  if (!r.ok) { const e = new Error("github " + r.status); e.status = r.status; throw e; }
  if (opts.raw) return r;
  return r.status === 204 ? null : r.json();
}
const contents = (p, auth = cloud.auth) => `/repos/${auth.owner}/${auth.repo}/contents/${p}`;
const utf8 = { enc: (s) => new TextEncoder().encode(s), dec: (u) => new TextDecoder().decode(u) };

async function readJson(p) {
  try {
    const r = await gh(contents(p));
    return { sha: r.sha, data: JSON.parse(utf8.dec(unb64((r.content || "").replace(/\s/g, "")))) };
  } catch (e) { if (e.status === 404) return null; throw e; }
}
async function putFile(p, base64, sha, message) {
  const body = { message, content: base64 };
  if (sha) body.sha = sha;
  const r = await gh(contents(p), { method: "PUT", body: JSON.stringify(body) });
  return r && r.content ? r.content.sha : null;
}

/* index read-modify-write, retried when another device wrote first */
async function updateIndex(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readJson("cartucho.json");
    const data = cur ? cur.data : { version: 1, games: {} };
    if (!data.games) data.games = {};
    mutate(data);
    try {
      const sha = await putFile("cartucho.json", b64(utf8.enc(JSON.stringify(data, null, 1))), cur && cur.sha, message);
      cloud.index = data; cloud.indexSha = sha;
      return data;
    } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; await sleep(400 + Math.random() * 600); }
  }
  throw new Error("index-conflict");
}

async function refreshLibrary() {
  if (!cloud.auth) return;
  const idx = await readJson("cartucho.json");
  cloud.index = idx ? idx.data : { version: 1, games: {} };
  cloud.indexSha = idx && idx.sha;
  cloud.roms.clear();
  for (const [key, g] of Object.entries(cloud.index.games || {})) if (g && g.rom) cloud.roms.set(key, { game: key, ...g });
  let files = [];
  try { files = await gh(contents("saves")); } catch (e) { if (e.status !== 404) throw e; }
  const docs = await Promise.all((Array.isArray(files) ? files : []).filter((f) => f.name.endsWith(".json")).map(async (f) => {
    try { const r = await readJson("saves/" + f.name); return r && r.data && r.data.game ? r : null; } catch (e) { return null; }
  }));
  cloud.docs.clear();
  for (const d of docs) if (d) { cloud.docs.set(d.data.game, d.data); cloud.saveShas.set(d.data.game, d.sha); }
}

async function connect() {
  cloud.auth = loadAuth();
  if (!cloud.auth) { cloud.ready = true; showConnect(); return; }
  try {
    await gh(`/repos/${cloud.auth.owner}/${cloud.auth.repo}`);
    cloud.db = true; cloud.assets = true;
    await refreshLibrary();
  } catch (e) {
    cloud.db = false; cloud.assets = false;
    if (e.status === 401 || e.status === 403 || e.status === 404) {
      $("#notice").dataset.sticky = "1";
      notice("O GitHub recusou a conexão: o token pode ter vencido ou perdido o acesso ao repositório. Conecte de novo em \"Conexão com o GitHub\", lá embaixo.", "err");
    } else {
      $("#notice").dataset.sticky = "1";
      notice("Sem conexão com o GitHub agora. Dá para jogar o que já está neste aparelho; o save sobe quando a internet voltar.");
    }
  }
  cloud.ready = true; render();
  handlePairLink();
}

async function getSaveDoc(key) {
  const r = await readJson("saves/" + key + ".json");
  if (r) { cloud.saveShas.set(key, r.sha); return r.data; }
  cloud.saveShas.delete(key);
  return null;
}

async function writeCloud(key, meta, sav, savSha) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await getSaveDoc(key);
    const packed = await pack(sav);
    const doc = {
      game: key, title: meta.title, system: meta.system, code: meta.code || "",
      enc: packed.enc, data: packed.data, size: sav.length, sha: savSha,
      rev: rid(), at: Date.now(), device: device.name, prev: null,
    };
    if (cur && cur.data && cur.sha !== savSha) {
      doc.prev = { enc: cur.enc, data: cur.data, size: cur.size, sha: cur.sha, rev: cur.rev, at: cur.at, device: cur.device };
    } else if (cur && cur.prev) doc.prev = cur.prev;
    if (JSON.stringify(doc).length > MAX_DOC) doc.prev = null;
    try {
      const sha = await putFile("saves/" + key + ".json", b64(utf8.enc(JSON.stringify(doc))), cloud.saveShas.get(key),
        `Save: ${meta.title} (${device.name})`);
      cloud.saveShas.set(key, sha); cloud.docs.set(key, doc); render();
      return doc;
    } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; await sleep(300 + Math.random() * 500); }
  }
  throw new Error("save-conflict");
}

/* ---------------- ROM in the cloud ---------------- */
function setBusy(key, msg) { if (msg) busy.set(key, msg); else busy.delete(key); render(); }

async function uploadRom(rom) {
  if (!cloud.db || busy.has(rom.key)) return false;
  setBusy(rom.key, "Guardando a ROM no GitHub…");
  try {
    const raw = new Uint8Array(await rom.blob.arrayBuffer());
    const s = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
    const gz = new Uint8Array(await new Response(s).arrayBuffer());
    const path = "roms/" + rom.key + ".gz";
    let sha;
    try { const ex = await gh(contents(path)); sha = ex && ex.sha; } catch (e) { if (e.status !== 404) throw e; }
    await putFile(path, b64(gz), sha, `ROM: ${rom.title}`);
    await updateIndex((d) => {
      d.games[rom.key] = { ...(d.games[rom.key] || {}), title: rom.title, system: rom.system, code: rom.code || "", ext: rom.ext,
        fileName: rom.fileName || "", size: raw.length, rom: path, romAt: Date.now(), romDevice: device.name };
    }, `Biblioteca: ${rom.title}`);
    cloud.roms.set(rom.key, { game: rom.key, ...cloud.index.games[rom.key] });
    setBusy(rom.key, null);
    toast(`${rom.title}: ROM guardada no GitHub`);
    return true;
  } catch (e) {
    setBusy(rom.key, null);
    toast(e.status === 401 || e.status === 403 ? "O token não tem permissão de escrita no repositório." : "Não deu para guardar a ROM agora. Tente de novo.", 4000);
    return false;
  }
}

async function fetchRom(key) {
  const meta = cloud.roms.get(key); if (!meta || !cloud.auth) return null;
  setBusy(key, "Baixando a ROM…");
  try {
    const r = await gh(contents(meta.rom), { raw: true });
    const total = Number(r.headers.get("content-length")) || 0;
    let got = 0; const chunks = [];
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        chunks.push(value); got += value.length;
        if (total) setBusy(key, `Baixando a ROM… ${Math.round((got / total) * 100)}%`);
      }
    } else chunks.push(new Uint8Array(await r.arrayBuffer()));
    const s = new Blob(chunks).stream().pipeThrough(new DecompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(s).arrayBuffer());
    const rom = { key, title: meta.title, system: meta.system, code: meta.code, ext: meta.ext || "gba",
      fileName: meta.fileName, size: bytes.length, addedAt: Date.now(), blob: new Blob([bytes]) };
    await idb.put("roms", key, rom).catch(() => {});
    await loadRoms();
    setBusy(key, null);
    return rom;
  } catch (e) {
    setBusy(key, null);
    toast("Não deu para baixar a ROM. Confira a internet e tente de novo.", 4000);
    return null;
  }
}

/* ---------------- connecting a device ---------------- */
function dataRepoName() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return (seg && !/\.html?$/.test(seg) ? seg : "cartuchin") + "-dados";
}
function defaultRepo() {
  const host = location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] : "";
  return host ? host + "/" + dataRepoName() : "";
}

function showConnect() {
  $("#connect").hidden = false;
  const repo = $("#ghRepo"); if (!repo.value) repo.value = defaultRepo();
  $("#dataRepoName").textContent = dataRepoName();
  render();
}

$("#ghForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [owner, repo] = $("#ghRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "").split("/");
  const token = $("#ghToken").value.trim();
  const msg = $("#ghMsg");
  if (!owner || !repo || !token) { msg.textContent = "Preencha o repositório (usuário/nome) e o token."; return; }
  msg.textContent = "Testando a conexão…";
  const auth = { owner, repo, token };
  try {
    const info = await gh(`/repos/${owner}/${repo}`, {}, auth);
    if (!info.permissions || !info.permissions.push) { msg.textContent = "O token só consegue ler esse repositório. Dê permissão de leitura e escrita em Contents."; return; }
    if (!info.private) { msg.textContent = "Esse repositório é público. Use um repositório privado para guardar ROMs e saves."; return; }
    saveAuth(auth);
    location.reload();
  } catch (err) {
    msg.textContent = err.status === 401 ? "O GitHub não aceitou esse token. Confira se copiou ele inteiro."
      : err.status === 404 ? "Não achei o repositório. Confira o nome e se o token tem acesso a ele."
      : "Não deu para falar com o GitHub agora. Confira a internet.";
  }
});
$("#localOnlyBtn").addEventListener("click", () => { $("#connect").hidden = true; render(); });
$("#disconnectBtn").addEventListener("click", async () => {
  const ok = await dialog("Desconectar este aparelho?", "Os jogos que já estão aqui continuam, mas o save para de subir para o GitHub até você conectar de novo.",
    [{ label: "Desconectar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (ok) { clearAuth(); location.reload(); }
});

/* Pairing: the new device shows a code (and a QR with a link carrying it).
   A connected device encrypts its token with a key derived from that code and
   drops it in a throwaway ntfy.sh topic, also derived from the code. ntfy only
   ever sees ciphertext; the code itself never leaves the two screens. */
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newPairCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join("");
}
const normCode = (c) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
async function pairMaterial(code) {
  const base = await crypto.subtle.importKey("raw", utf8.enc(normCode(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: utf8.enc("cartucho-pareamento-v1"), iterations: 200000, hash: "SHA-256" }, base, 384));
  const topic = "cartucho-" + Array.from(bits.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", bits.subarray(16, 48), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { topic, key };
}
async function sendPairing(code) {
  const { topic, key } = await pairMaterial(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8.enc(JSON.stringify(cloud.auth))));
  const msg = new Uint8Array(iv.length + ct.length); msg.set(iv); msg.set(ct, iv.length);
  const r = await fetch("https://ntfy.sh/" + topic, { method: "POST", body: b64(msg) });
  if (!r.ok) throw new Error("ntfy " + r.status);
}

let pairTimer = null;
async function startPairing() {
  const code = newPairCode();
  const { topic, key } = await pairMaterial(code);
  const link = location.origin + location.pathname + "#parear-" + code;
  $("#pairCode").textContent = code.slice(0, 4) + " " + code.slice(4);
  try {
    const qr = window.qrcode(0, "M"); qr.addData(link); qr.make();
    $("#pairQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { $("#pairQr").textContent = ""; }
  $("#pairBox").hidden = false; $("#pairStartBtn").hidden = true;
  $("#pairStatus").textContent = "Esperando o outro aparelho…";
  try { $("#pairBox").scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
  const since = Math.floor(Date.now() / 1000) - 5;
  clearInterval(pairTimer);
  pairTimer = setInterval(async () => {
    try {
      const r = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${since}`, { cache: "no-store" });
      const lines = (await r.text()).split("\n").filter(Boolean);
      for (const line of lines) {
        const m = JSON.parse(line); if (m.event !== "message" || !m.message) continue;
        try {
          const raw = unb64(m.message.trim());
          const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
          const auth = JSON.parse(utf8.dec(new Uint8Array(pt)));
          if (auth && auth.token) { clearInterval(pairTimer); saveAuth(auth); $("#pairStatus").textContent = "Conectado! Abrindo a biblioteca…"; setTimeout(() => location.reload(), 800); return; }
        } catch (e) {}
      }
    } catch (e) {}
  }, 3000);
}
$("#pairStartBtn").addEventListener("click", startPairing);

async function pairOther(code) {
  if (!cloud.auth || !cloud.db) { toast("Conecte este aparelho ao GitHub primeiro."); return; }
  const ok = await dialog("Conectar o outro aparelho?", `Ele vai poder abrir seus jogos e gravar saves no ${cloud.auth.owner}/${cloud.auth.repo}. Confira se o código na tela dele é ${normCode(code).slice(0, 4)} ${normCode(code).slice(4)}.`,
    [{ label: "Conectar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  try { await sendPairing(code); toast("Pronto! O outro aparelho conecta em alguns segundos.", 4000); }
  catch (e) { toast("Não deu para enviar agora. Tente de novo.", 4000); }
}
function handlePairLink() {
  const m = location.hash.match(/^#parear-([A-Za-z0-9]{8})$/);
  if (!m) return;
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (cloud.db) pairOther(m[1]);
  else { $("#notice").dataset.sticky = "1"; notice("Para conectar o outro aparelho, conecte este aqui ao GitHub primeiro e abra o link de novo."); }
}
$("#pairOtherBtn").addEventListener("click", async () => {
  const root = $("#dialogRoot");
  const input = el("input", { id: "pairInput", type: "text", maxlength: "9", autocomplete: "off", autocapitalize: "characters", placeholder: "ABCD 1234", class: "code-input" });
  const close = () => root.replaceChildren();
  const box = el("form", { class: "dialog", onsubmit: (e) => { e.preventDefault(); const c = normCode(input.value); if (c.length !== 8) { input.focus(); return; } close(); pairOther(c); } },
    el("h2", {}, "Conectar outro aparelho"),
    el("p", {}, "No outro aparelho, abra o Cartuchin e escolha \"Conectar com outro aparelho\". Escaneie o QR com a câmera deste celular ou digite o código aqui."),
    input,
    el("button", { class: "btn primary", type: "submit" }, "Conectar"),
    el("button", { class: "btn", type: "button", onclick: close }, "Cancelar"));
  root.replaceChildren(el("div", { class: "scrim" }, box));
  input.focus();
});

/* ---------------- library ---------------- */
let roms = new Map();
async function loadRoms() {
  roms = new Map();
  for (const r of await idb.all("roms")) if (r && r.key) roms.set(r.key, r);
}

function notice(msg, kind) {
  const n = $("#notice");
  if (!msg) { n.hidden = true; return; }
  n.className = "notice" + (kind === "err" ? " err" : "");
  n.textContent = msg; n.hidden = false;
}

function render() {
  if (!cloud.ready) return;
  if ($("#notice").dataset.sticky !== "1") notice(cloud.auth || !$("#connect").hidden ? "" : "Este aparelho não está conectado ao GitHub: o save fica só aqui.");
  $("#connText").textContent = cloud.db ? `Conectado a ${cloud.auth.owner}/${cloud.auth.repo}` : cloud.auth ? "GitHub indisponível agora" : "Não conectado ao GitHub";
  $("#pairOtherBtn").hidden = !cloud.db; $("#disconnectBtn").hidden = !cloud.auth; $("#connectBtn").hidden = !!cloud.auth;
  const keys = new Set([...roms.keys(), ...cloud.docs.keys(), ...cloud.roms.keys()]);
  const list = [...keys].map((k) => ({ key: k, rom: roms.get(k), save: cloud.docs.get(k) }))
    .sort((a, b) => ((b.save && b.save.at) || 0) - ((a.save && a.save.at) || 0) || (a.key < b.key ? -1 : 1));
  const box = $("#games"); box.replaceChildren();
  $("#empty").hidden = list.length > 0;
  for (const g of list) box.append(card(g));
}

function card({ key, rom, save }) {
  const crom = cloud.roms.get(key);
  const title = (rom && rom.title) || (save && save.title) || (crom && crom.title) || key;
  const code = (rom && rom.code) || (save && save.code) || (crom && crom.code) || "";
  const sys = ((rom && rom.system) || (save && save.system) || "gba") === "gba" ? "GBA" : "GB";
  let line;
  if (save) line = [el("span", { class: "dot ok" }), `Save na nuvem ${ago(save.at)} · ${save.device || "outro aparelho"}`, el("span", { class: "pix" }, fmtSize(save.size || 0))];
  else if (cloud.db) line = [el("span", { class: "dot" }), "Ainda sem save na nuvem"];
  else line = [el("span", { class: "dot warn" }), "Save só neste aparelho"];

  const romLine = crom
    ? [el("span", { class: "dot ok" }), "ROM na nuvem, abre em qualquer aparelho"]
    : rom ? [el("span", { class: "dot" }), "ROM só neste aparelho"] : null;
  const working = busy.get(key);

  const actions = el("div", { class: "actions" });
  if (working) actions.append(el("button", { class: "btn primary", type: "button", disabled: true }, working));
  else if (rom || crom) actions.append(el("button", { class: "btn primary", type: "button", onclick: () => play(key) }, "Jogar"));
  else actions.append(el("button", { class: "btn primary", type: "button", onclick: () => pickRom() }, "Adicionar a ROM neste aparelho"));

  const more = el("div", { class: "more" });
  if (cloud.db) more.append(el("button", { class: "btn small", type: "button", onclick: () => pickSav(key, { title, system: sys === "GBA" ? "gba" : "gb", code }) }, "Enviar arquivo .sav"));
  if (save && cloud.downloads) more.append(el("button", { class: "btn small", type: "button", onclick: () => downloadSave(save) }, "Baixar save"));
  if (save && save.prev) more.append(el("button", { class: "btn small", type: "button", onclick: () => confirmRestore(key, save) }, "Voltar à versão anterior"));
  if (rom && !crom && cloud.db && !working) more.append(el("button", { class: "btn small", type: "button", onclick: () => uploadRom(rom) }, "Guardar ROM no GitHub"));
  if (rom && !crom) more.append(el("button", { class: "btn small ghost", type: "button", onclick: () => confirmRemoveRom(key, title) }, "Tirar ROM daqui"));

  return el("article", { class: "cart" },
    el("div", { class: "cart-label" },
      el("span", { class: "cart-code" }, [sys, code].filter(Boolean).join(" · ")),
      el("span", { class: "cart-title" }, title)),
    el("div", { class: "cart-body" },
      el("div", { class: "sync-line" }, line),
      romLine ? el("div", { class: "sync-line" }, romLine) : null,
      actions, more.childNodes.length ? more : null));
}

/* ---------------- dialogs ---------------- */
function dialog(title, text, buttons) {
  return new Promise((resolve) => {
    const root = $("#dialogRoot");
    const close = (v) => { root.replaceChildren(); resolve(v); };
    const box = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("h2", {}, title), text ? el("p", {}, text) : null,
      ...buttons.map((b) => el("button", { class: "btn " + (b.cls || "") + (b.sub ? " choice" : ""), type: "button", onclick: () => close(b.value) },
        b.label, b.sub ? el("small", {}, b.sub) : null)));
    root.replaceChildren(el("div", { class: "scrim", onclick: (e) => { if (e.target === e.currentTarget) close(null); } }, box));
    const first = box.querySelector("button"); if (first) first.focus();
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
    await idb.del("pend", key); await idb.put("sync", key, { lastSha: doc.sha, baseRev: doc.rev });
    toast("Versão anterior restaurada");
  } catch (e) { toast("Não deu para restaurar agora. Tente de novo."); }
}

async function confirmRemoveRom(key, title) {
  const ok = await dialog(`Tirar ${title} deste aparelho?`, "A ROM sai só daqui. O save na nuvem continua lá.",
    [{ label: "Tirar ROM", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  await idb.del("roms", key); await loadRoms(); render();
}

async function downloadSave(save) {
  try {
    const sav = await unpack(save);
    const name = (save.title || save.game).replace(/[^\w\- ]+/g, "").trim() || "save";
    const url = URL.createObjectURL(new Blob([sav], { type: "application/octet-stream" }));
    const a = el("a", { href: url, download: name + ".sav" }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    toast("Não deu para baixar o save aqui.");
  }
}

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
    await idb.put("roms", info.key, { ...info, ext, fileName: name, size: bytes.length, addedAt: Date.now(), blob: new Blob([bytes]) });
    await loadRoms(); render();
    toast(cloud.docs.has(info.key) ? `${info.title}: o save da nuvem já está pronto` : `${info.title} adicionado`);
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

/* ---------------- performance ----------------
   "auto" starts at full quality and switches this device to the light profile
   the first time emulation can't keep 60 fps. "light" skips frames when needed so
   game speed and audio stay right, and gives audio a bigger buffer. */
const PERF_KEY = "cartucho.perf";
const perf = {
  mode: ls.get(PERF_KEY + ".mode") || "auto",                 // auto | quality | light
  learned: ls.get(PERF_KEY + ".learned") === "light",        // auto mode already decided this device is slow
};
if (!ls.get(PERF_KEY + ".mode") && guessDevice() === "TV") perf.learned = true;
const perfLight = () => perf.mode === "light" || (perf.mode === "auto" && perf.learned);
function coreOptions(light) {
  return {
    "save-save-interval": "0",
    mgba_idle_optimization: "Detect and Remove",
    mgba_audio_low_pass_filter: "disabled",
    mgba_color_correction: "OFF",
    mgba_interframe_blending: "OFF",
    mgba_frameskip: light ? "auto" : "disabled",
    mgba_frameskip_threshold: "33",
  };
}
function renderPerf() {
  for (const b of document.querySelectorAll("#perfModes button")) {
    const on = b.dataset.mode === perf.mode;
    b.classList.toggle("primary", on); b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("#perfHint").textContent = perf.mode === "auto"
    ? (perf.learned ? "Este aparelho já está no modo leve." : "Começa em qualidade máxima e passa para o leve se o jogo ficar lento.")
    : perf.mode === "light" ? "Pula quadros quando precisa para o jogo e o som não ficarem lentos." : "Nunca pula quadros. Use em aparelhos rápidos.";
}
$("#perfModes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]"); if (!b) return;
  perf.mode = b.dataset.mode; ls.set(PERF_KEY + ".mode", perf.mode);
  if (perf.mode !== "auto") { perf.learned = false; ls.set(PERF_KEY + ".learned", ""); }
  renderPerf();
});
renderPerf();

const speed = { last: null, samples: [], timer: null, since: 0 };
function startSpeedMeter() {
  const gm = player.emu && player.emu.gameManager; if (!gm) return;
  speed.since = performance.now(); speed.samples = []; speed.last = null;
  clearInterval(speed.timer);
  speed.timer = setInterval(() => {
    let frames; try { frames = Number(gm.getFrameNum()); } catch (e) { return; }
    const now = performance.now();
    if (document.visibilityState !== "visible" || player.emu.paused) { speed.last = null; return; }
    if (speed.last) {
      const pct = ((frames - speed.last.f) / ((now - speed.last.t) / 1000)) / 59.73;
      if (pct > 0 && pct < 3) {
        speed.samples.push(pct); if (speed.samples.length > 4) speed.samples.shift();
        const avg = speed.samples.reduce((a, b) => a + b, 0) / speed.samples.length;
        const tag = $("#pSpeed");
        tag.textContent = Math.round(Math.min(avg, 1) * 100) + "%";
        tag.className = "speed pix " + (avg >= 0.95 ? "ok" : avg >= 0.8 ? "warn" : "bad");
        tag.hidden = false;
        if (perf.mode === "auto" && !perf.learned && now - speed.since > 8000 && speed.samples.length >= 3 && avg < 0.92) {
          perf.learned = true; ls.set(PERF_KEY + ".learned", "light");
          try { gm.setVariable("mgba_frameskip", "auto"); gm.setVariable("mgba_frameskip_threshold", "33"); } catch (e) {}
          toast("O jogo estava lento aqui, então liguei o modo leve neste aparelho.", 4500);
          renderPerf();
        }
      }
    }
    speed.last = { f: frames, t: now };
  }, 2000);
}

const devInput = $("#deviceName");
devInput.value = device.name;
devInput.addEventListener("change", () => {
  const v = devInput.value.trim().slice(0, 40);
  device.name = v || guessDevice(); devInput.value = device.name; ls.set("cartucho.device", device.name);
});

/* ---------------- player + sync ---------------- */
const player = window.__cartucho = { key: null, meta: null, emu: null, lastSha: null, baseRev: null, busy: false, again: false, timer: null, state: "loading", at: 0 };

function setChip(state, at) { player.state = state; if (at) player.at = at; updateChip(); }
function updateChip() {
  const dot = $("#pChip .dot"), txt = $("#pChipText");
  const map = {
    loading: ["", "Carregando…"], ok: ["ok", "Save na nuvem " + ago(player.at)], up: ["warn", "Enviando save…"],
    pending: ["warn", "Save guardado aqui, envio pendente"], local: ["warn", "Save só neste aparelho"], none: ["", "Sem save ainda"],
  };
  const [cls, t] = map[player.state] || map.loading;
  dot.className = "dot " + cls; txt.textContent = t;
}
setInterval(() => {
  if (player.key) { if (player.state === "ok") updateChip(); return; }
  if (cloud.db && document.visibilityState === "visible") refreshLibrary().then(render).catch(() => {}); else if (cloud.ready) render();
}, 30000);

function savPath(gm) { return gm.getSaveFilePath(); }
function writeSav(gm, sav) {
  const path = savPath(gm); const parts = path.split("/"); let cp = "";
  for (let i = 0; i < parts.length - 1; i++) { if (!parts[i]) continue; cp += "/" + parts[i]; if (!gm.FS.analyzePath(cp).exists) gm.FS.mkdir(cp); }
  if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
  gm.FS.writeFile(path, sav);
}

async function flush() {
  const emu = player.emu;
  if (!emu || !emu.started || !emu.gameManager) return;
  if (player.busy) { player.again = true; return; }
  player.busy = true;
  try {
    let sav = null;
    try { sav = emu.gameManager.getSaveFile(); } catch (e) {}
    if (!sav || !sav.length) { if (!player.lastSha) setChip("none"); return; }
    sav = new Uint8Array(sav);
    const h = await sha(sav);
    if (h === player.lastSha) return;
    await idb.put("pend", player.key, { sav, sha: h, baseRev: player.baseRev, at: Date.now() }).catch(() => {});
    if (!cloud.db) { player.lastSha = h; setChip("local"); return; }
    setChip("up");
    try {
      const doc = await writeCloud(player.key, player.meta, sav, h);
      player.lastSha = h; player.baseRev = doc.rev;
      await idb.del("pend", player.key);
      await idb.put("sync", player.key, { lastSha: h, baseRev: doc.rev }).catch(() => {});
      setChip("ok", doc.at);
    } catch (e) { setChip("pending"); }
  } finally {
    player.busy = false;
    if (player.again) { player.again = false; setTimeout(flush, 500); }
  }
}

async function chooseStartSave(key) {
  const pend = await idb.get("pend", key);
  let remote = null;
  if (cloud.db) {
    try { remote = await getSaveDoc(key); } catch (e) { remote = cloud.docs.get(key) || null; }
  }
  if (remote && pend && pend.sha !== remote.sha && pend.baseRev !== remote.rev) {
    const pick = await dialog("Dois saves diferentes",
      "Este aparelho tem progresso que não chegou à nuvem, e a nuvem tem um save mais novo de outro aparelho. Qual você quer jogar? O outro fica guardado como versão anterior.",
      [{ label: "Save da nuvem", sub: `${remote.device || "Outro aparelho"}, ${ago(remote.at)}`, value: "cloud", cls: "primary" },
       { label: "Save deste aparelho", sub: `${device.name}, ${ago(pend.at)}`, value: "local" }]);
    if (pick === "local") return { sav: pend.sav, sha: pend.sha, baseRev: remote.rev, upload: true, keepRemoteAsPrev: true };
    await idb.del("pend", key);
    return { sav: await unpack(remote), sha: remote.sha, baseRev: remote.rev, at: remote.at };
  }
  if (pend && (!remote || pend.baseRev === remote.rev || pend.sha === remote.sha)) {
    return { sav: pend.sav, sha: pend.sha, baseRev: remote ? remote.rev : null, upload: pend.sha !== (remote && remote.sha), at: remote && remote.at };
  }
  if (remote) return { sav: await unpack(remote), sha: remote.sha, baseRev: remote.rev, at: remote.at };
  return { sav: null, sha: null, baseRev: null };
}

function loadScript(src) {
  return new Promise((res, rej) => { const s = el("script", { src }); s.onload = res; s.onerror = () => rej(new Error(src)); document.body.append(s); });
}
let emuLoading = null;
function loadEmulator() {
  if (!emuLoading) {
    document.head.append(el("link", { rel: "stylesheet", href: "vendor/emulator.min.css" }));
    emuLoading = loadScript("vendor/emulator.min.js").then(() => loadScript("vendor/mgba_libretro.js"));
  }
  return emuLoading;
}

function patchEmulator() {
  const EJS = window.EmulatorJS;
  if (!EJS || EJS.__cartucho) return;
  EJS.__cartucho = true;
  const GM = window.EJS_GameManager;
  if (GM && !GM.__cartucho) {
    GM.__cartucho = true;
    const orig = GM.prototype.getRetroArchCfg;
    GM.prototype.getRetroArchCfg = function () {
      let cfg = orig.call(this);
      cfg = cfg.replace(/audio_latency = \d+/, "audio_latency = " + (perfLight() ? 128 : 80));
      return cfg + "audio_rate_control = true\naudio_rate_control_delta = 0.010\nvideo_threaded = false\n";
    };
  }
  EJS.prototype.initGameCore = function (js, wasm, thread) { this.initModule(wasm, thread); };
  /* load the mGBA core straight from the published files: no archive, no extraction worker */
  EJS.prototype.downloadGameCore = function () {
    const core = { name: "mgba", extensions: ["gb", "gbc", "gba"], options: {}, save: "srm", repo: "https://github.com/EmulatorJS/mgba" };
    this.textElem.innerText = this.localization("Download Game Core");
    this.extensions = core.extensions; this.coreName = core.name; this.repository = core.repo;
    this.defaultCoreOpts = core.options; this.enableMouseLock = false; this.retroarchOpts = undefined; this.saveFileExt = core.save;
    this.webgl2Enabled = false;
    this.downloadFile("cores/mgba_libretro.wasm", (progress) => {
      this.textElem.innerText = this.localization("Download Game Core") + progress;
    }, false, { responseType: "arraybuffer", method: "GET" }).then((res) => {
      if (res === -1 || !res.data) { this.startGameError(this.localization("Network Error")); return; }
      this.initModule(new Uint8Array(res.data), null);
    });
  };
  EJS.prototype.initModule = function (wasm, thread) {
    if (typeof window.EJS_Runtime !== "function") { this.startGameError(this.localization("Error loading EmulatorJS runtime")); return; }
    const wasmBytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
    window.EJS_Runtime({
      noInitialRun: true, onRuntimeInitialized: null, arguments: [], preRun: [], postRun: [],
      canvas: this.canvas, callbacks: {}, parent: this.elements.parent,
      print: () => {}, printErr: () => {}, totalDependencies: 0,
      wasmBinary: wasmBytes,
      locateFile: (f) => f.endsWith(".wasm") ? URL.createObjectURL(new Blob([wasmBytes], { type: "application/wasm" })) : f,
      getSavExt: () => (this.saveFileExt ? "." + this.saveFileExt : ".srm"),
    }).then((m) => { this.Module = m; this.downloadFiles(); })
      .catch((e) => { console.warn(e); this.startGameError(this.localization("Failed to start game")); });
  };
}

async function play(key) {
  let rom = roms.get(key);
  if (!rom) rom = await fetchRom(key);
  if (!rom) return;
  const start = await chooseStartSave(key);
  if (start === null) return;
  player.key = key; player.meta = { title: rom.title, system: rom.system, code: rom.code };
  player.lastSha = start.upload ? null : start.sha; player.baseRev = start.baseRev;
  $("#pName").textContent = rom.title;
  $("#library").hidden = true; $("#player").hidden = false;
  setChip(start.sav ? (start.upload ? "pending" : (cloud.db ? "ok" : "local")) : "none", start.at);
  try { document.title = rom.title + " · Cartuchin"; } catch (e) {}

  try { await loadEmulator(); } catch (e) { toast("Não deu para carregar o emulador. Confira a internet."); $("#player").hidden = true; $("#library").hidden = false; return; }
  patchEmulator();
  const romBytes = fixSaveChip(new Uint8Array(await rom.blob.arrayBuffer()));
  const file = new File([romBytes], rom.code ? rom.code + "." + rom.ext : "jogo." + rom.ext);
  const emu = new window.EmulatorJS("#game", {
    gameUrl: file, dataPath: "ejs/", system: "mgba", gameName: key,
    color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b4bd8",
    startOnLoad: true, threads: false, forceLegacyCores: true, cacheLimit: 0,
    language: "pt-BR", langJson: window.__CARTUCHO_LANG || undefined,
    backgroundColor: "#000000", noAutoFocus: false,
    buttonOpts: { netplay: false, saveSavFiles: false, loadSavFiles: false, cacheManager: false, exitEmulation: false, contextMenu: false },
    defaultOptions: coreOptions(perfLight()),
  });
  player.emu = emu;
  emu.on("start", async () => {
    const gm = emu.gameManager;
    if (start.sav) {
      try { writeSav(gm, start.sav); gm.loadSaveFiles(); gm.restart(); } catch (e) { console.warn("save load", e); }
    }
    await sleep(1500);
    if (start.upload) flush();
    player.timer = setInterval(flush, 15000);
    startSpeedMeter();
  });
}

$("#saveNowBtn").addEventListener("click", async () => {
  const before = player.lastSha; await flush();
  if (player.state === "ok") toast(player.lastSha === before ? "O save já está na nuvem" : "Save enviado");
  else if (player.state === "none") toast("Ainda não há save. Salve dentro do jogo primeiro.");
});
$("#backBtn").addEventListener("click", async () => {
  await flush();
  if (player.state === "up" || player.state === "pending") {
    const ok = await dialog("O save ainda não subiu", "Ele ficou guardado neste aparelho e vai subir na próxima vez que você abrir o jogo aqui.",
      [{ label: "Voltar mesmo assim", value: true, cls: "primary" }, { label: "Continuar jogando", value: false }]);
    if (!ok) return;
  }
  location.reload();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
window.addEventListener("pagehide", () => { flush(); });

/* keep EmulatorJS from calling its own CDN for update checks */
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const u = typeof input === "string" ? input : (input && input.url) || "";
  if (/^https?:\/\/(cdn|netplay)\.emulatorjs\.org/.test(u)) return Promise.resolve(new Response("{}", { status: 404 }));
  return realFetch(input, init);
};

/* ---------------- controller in the library (TV) ----------------
   D-pad or left stick moves between buttons, A presses, B cancels a dialog. */
(() => {
  let was = {}, last = 0;
  function targets() {
    const root = $("#dialogRoot").firstElementChild || $("#library");
    return [...root.querySelectorAll("button:not([disabled]), input[type=text]")].filter((n) => n.offsetParent !== null);
  }
  function move(step) {
    const list = targets(); if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const n = list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + step))];
    n.focus(); try { n.scrollIntoView({ block: "nearest" }); } catch (e) {}
  }
  function tick(t) {
    requestAnimationFrame(tick);
    if (!$("#player").hidden || t - last < 60) return;
    last = t;
    let pad = null;
    try { pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null; } catch (e) {}
    if (!pad) { was = {}; return; }
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), ax = pad.axes || [];
    const now = { up: b(12) || ax[1] < -0.6, down: b(13) || ax[1] > 0.6, left: b(14) || ax[0] < -0.6, right: b(15) || ax[0] > 0.6, a: b(0), b: b(1) };
    const edge = (k) => now[k] && !was[k];
    if (edge("up") || edge("left")) move(-1);
    if (edge("down") || edge("right")) move(1);
    if (edge("a") && document.activeElement && document.activeElement.tagName === "BUTTON") document.activeElement.click();
    if (edge("b")) { const btns = targets(); if ($("#dialogRoot").firstElementChild && btns.length) btns[btns.length - 1].click(); }
    was = now;
  }
  if (navigator.getGamepads) requestAnimationFrame(tick);
  window.addEventListener("gamepadconnected", () => { if ($("#player").hidden && !document.activeElement.matches("button")) move(0); });
})();

/* ---------------- boot ---------------- */
$("#connectBtn").addEventListener("click", () => { showConnect(); $("#connect").scrollIntoView({ behavior: "smooth" }); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
(async () => {
  await loadRoms();
  await connect();
})();
})();
