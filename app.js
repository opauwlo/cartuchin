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
  const r = await fetch(GH_API + path, { method: opts.method || "GET", body: opts.body, headers, cache: "no-store", keepalive: !!opts.keepalive });
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
async function putFile(p, base64, sha, message, keepalive) {
  const body = { message, content: base64 };
  if (sha) body.sha = sha;
  const json = JSON.stringify(body);
  // keepalive lets the upload finish after the page is closed; browsers cap it at 64 KB
  const r = await gh(contents(p), { method: "PUT", body: json, keepalive: !!keepalive && json.length < 60000 });
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

async function writeCloud(key, meta, sav, savSha, opts = {}) {
  const packed = await pack(sav);
  let cur = cloud.docs.get(key) || null, known = cloud.saveShas.has(key);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!known) { cur = await getSaveDoc(key); known = true; }
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
        `Save: ${meta.title} (${device.name})`, opts.keepalive);
      cloud.saveShas.set(key, sha); cloud.docs.set(key, doc); render();
      return doc;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      known = false;   // another device wrote first: read it, keep it as "previous", try again
      await sleep(300 + Math.random() * 500);
    }
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
        $("#padSpeed").textContent = "· " + tag.textContent; $("#padSpeed").className = tag.className;
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
  const ps = $("#padSaveState"); if (ps) ps.textContent = t;
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

async function flush(opts = {}) {
  const emu = player.emu;
  if (!emu || !emu.started || !emu.gameManager || !player.key) return;
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
      const doc = await writeCloud(player.key, player.meta, sav, h, { keepalive: !!opts.leaving });
      player.lastSha = h; player.baseRev = doc.rev;
      await idb.del("pend", player.key);
      await idb.put("sync", player.key, { lastSha: h, baseRev: doc.rev }).catch(() => {});
      setChip("ok", doc.at);
      if (!$("#pad").hidden && !opts.quiet) padMsg("Save enviado para a nuvem");
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

/* The emulator sizes its WebGL canvas from a ResizeObserver, so on a TV it draws a
   1080p (or 4K) surface for a 240x160 picture, which weak TV GPUs struggle with.
   In light mode the observer reports a smaller size: the emulator renders at most
   CANVAS_CAP pixels wide and the browser stretches the result, pixel-perfect. */
const CANVAS_CAP = 960;
const STREAM_W = 240, STREAM_H = 160; // the GBA's own resolution: tiny to encode, the TV scales it up pixel-perfect
(() => {
  const RO = window.ResizeObserver;
  if (!RO || RO.__cartucho) return;
  const factorFor = (w, h) => {
    const cap = perfLight() ? CANVAS_CAP : 0;
    if (!cap) return 1;
    const big = Math.max(w, h); return big > cap ? cap / big : 1;
  };
  const scaleEntry = (e) => {
    if (!(e.target instanceof HTMLCanvasElement)) return e;
    const dpr = window.devicePixelRatio || 1;
    let w, h;
    if (window.__castCap) {
      // streaming: the canvas becomes exactly the GBA screen, 240x160, and is sent as is
      w = STREAM_W; h = STREAM_H;
    } else {
      const pw = e.devicePixelContentBoxSize ? e.devicePixelContentBoxSize[0].inlineSize : e.contentRect.width * dpr;
      const ph = e.devicePixelContentBoxSize ? e.devicePixelContentBoxSize[0].blockSize : e.contentRect.height * dpr;
      const f = factorFor(pw, ph);
      if (f === 1) return e;
      w = Math.round(pw * f); h = Math.round(ph * f);
    }
    return { target: e.target, contentRect: { width: w / dpr, height: h / dpr, x: 0, y: 0, top: 0, left: 0 },
      devicePixelContentBoxSize: [{ inlineSize: w, blockSize: h }], contentBoxSize: [{ inlineSize: w / dpr, blockSize: h / dpr }], borderBoxSize: e.borderBoxSize };
  };
  class CappedResizeObserver extends RO {
    constructor(cb) { super((entries, obs) => cb(entries.map(scaleEntry), obs)); }
  }
  CappedResizeObserver.__cartucho = true;
  window.ResizeObserver = CappedResizeObserver;
})();

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
      cfg = cfg.replace(/autosave_interval = \d+/, "autosave_interval = 0");  // the page saves on its own schedule
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

async function createEmulator(file, gameName, options) {
  try { await loadEmulator(); } catch (e) { return null; }
  patchEmulator();
  return new window.EmulatorJS("#game", {
    gameUrl: file, dataPath: "ejs/", system: "mgba", gameName,
    color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b4bd8",
    startOnLoad: true, threads: false, forceLegacyCores: true, cacheLimit: 0,
    language: "pt-BR", langJson: window.__CARTUCHO_LANG || undefined,
    backgroundColor: "#000000", noAutoFocus: false,
    buttonOpts: { netplay: false, saveSavFiles: false, loadSavFiles: false, cacheManager: false, exitEmulation: false, contextMenu: false },
    defaultOptions: options,
  });
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

  const romBytes = fixSaveChip(new Uint8Array(await rom.blob.arrayBuffer()));
  const file = new File([romBytes], rom.code ? rom.code + "." + rom.ext : "jogo." + rom.ext);
  const emu = await createEmulator(file, key, coreOptions(perfLight()));
  if (!emu) { toast("Não deu para carregar o emulador. Confira a internet."); $("#player").hidden = true; $("#library").hidden = false; return; }
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
    if (cast.pending) { const c = cast.pending; cast.pending = null; setTimeout(() => castTo(c), 500); }
  });
}

async function pullSave(report) {
  if (!player.key || !player.emu || !player.emu.started) return;
  if (!cloud.db) { report("Este aparelho não está conectado ao GitHub."); return; }
  report("Buscando o save na nuvem…");
  let remote;
  try { remote = await getSaveDoc(player.key); } catch (e) { report("Não deu para falar com o GitHub agora."); return; }
  if (!remote) { report("Ainda não há save deste jogo na nuvem."); return; }
  const gm = player.emu.gameManager;
  let cur = null; try { cur = new Uint8Array(gm.getSaveFile()); } catch (e) {}
  if (cur && (await sha(cur)) === remote.sha) { report("Você já está com o save mais recente da nuvem."); return; }
  const unsent = cur && player.lastSha && (await sha(cur)) !== player.lastSha;
  const ok = await dialog("Carregar o save da nuvem?",
    `Save de ${remote.device || "outro aparelho"}, ${ago(remote.at)}. O jogo reinicia na tela de título.` + (unsent ? " Este aparelho tem progresso que ainda não subiu: ele vai ser substituído." : ""),
    [{ label: "Carregar e reiniciar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) { report(""); return; }
  try {
    writeSav(gm, await unpack(remote)); gm.loadSaveFiles(); gm.restart();
    player.lastSha = remote.sha; player.baseRev = remote.rev;
    await idb.del("pend", player.key);
    setChip("ok", remote.at);
    report(`Save de ${remote.device || "outro aparelho"} carregado`);
  } catch (e) { report("Não deu para carregar o save."); }
}
$("#pullBtn").addEventListener("click", () => pullSave((m) => m && toast(m)));
$("#padPull").addEventListener("click", () => pullSave((m) => m && padMsg(m)));

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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush({ leaving: true }); });
window.addEventListener("pagehide", () => { flush({ leaving: true }); });

/* keep EmulatorJS from calling its own CDN for update checks */
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const u = typeof input === "string" ? input : (input && input.url) || "";
  if (/^https?:\/\/(cdn|netplay)\.emulatorjs\.org/.test(u)) return Promise.resolve(new Response("{}", { status: 404 }));
  return realFetch(input, init);
};

/* ---------------- console mode: the phone plays, the TV only shows ----------------
   The TV opens "Usar como tela" and shows a code. The phone (running the game) sends
   a WebRTC offer, encrypted with a key from that code, through ntfy.sh; the TV answers
   the same way. After that, video, audio and the TV's controller travel straight
   between the two devices over the home network (UDP), with no server in the middle. */
const RTC_CONFIG = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

async function sealJson(key, obj) {
  const raw = utf8.enc(JSON.stringify(obj));
  const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, gz));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function openJson(key, text) {
  const raw = unb64(text.trim());
  const gz = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12)));
  const plain = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  return JSON.parse(utf8.dec(plain));
}
async function signal(code) {
  const { topic, key } = await pairMaterial("TELA" + normCode(code));
  return {
    async send(kind, obj) {
      const r = await fetch(`https://ntfy.sh/${topic}-${kind}`, { method: "POST", body: await sealJson(key, obj) });
      if (!r.ok) throw new Error("ntfy " + r.status);
    },
    listen(kind, onMsg) {
      const since = Math.floor(Date.now() / 1000) - 2;
      const es = new EventSource(`https://ntfy.sh/${topic}-${kind}/sse?since=${since}`);
      const seen = new Set();
      es.onmessage = async (ev) => {
        try {
          const m = JSON.parse(ev.data); if (m.event !== "message" || !m.message) return;
          const id = m.id || m.message.slice(0, 40); if (seen.has(id)) return; seen.add(id);
          onMsg(await openJson(key, m.message));
        } catch (e) {}
      };
      return () => es.close();
    },
  };
}
function iceDone(pc, ms = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
  });
}
let wakeLock = null;
async function keepAwake() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (cast.pc || tvScreen.active)) keepAwake(); });

/* Every sound that would reach the speakers also goes through a tap the stream can carry. */
(() => {
  if (!window.AudioNode) return;
  const connect = AudioNode.prototype.connect;
  const taps = new WeakMap();
  window.__audioTaps = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (window.AudioDestinationNode && dest instanceof AudioDestinationNode) {
      const ctx = dest.context;
      let t = taps.get(ctx);
      if (!t) {
        const local = ctx.createGain(); connect.call(local, dest);
        const out = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
        t = { ctx, local, out }; taps.set(ctx, t); window.__audioTaps.push(t);
      }
      if (t.out) connect.call(this, t.out);
      return connect.call(this, t.local);
    }
    return connect.call(this, dest, ...rest);
  };
})();

function wakeAudio() {
  for (const t of window.__audioTaps || []) {
    try { if (t.ctx.state !== "running") t.ctx.resume().catch(() => {}); } catch (e) {}
  }
}
for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, wakeAudio, true);

/* RetroPad indexes EmulatorJS understands, and how a standard controller maps onto them */
const PAD = { B: 0, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, L: 10, R: 11 };
const PAD_BITS = ["B", "SELECT", "START", "UP", "DOWN", "LEFT", "RIGHT", "A", "L", "R"];
function readPad() {
  let pad = null;
  try { pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null; } catch (e) {}
  const s = {};
  if (pad) {
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), ax = pad.axes || [];
    s.A = b(1); s.B = b(0); s.L = b(4) || b(6); s.R = b(5) || b(7); s.SELECT = b(8); s.START = b(9);
    s.UP = b(12) || ax[1] < -0.5; s.DOWN = b(13) || ax[1] > 0.5; s.LEFT = b(14) || ax[0] < -0.5; s.RIGHT = b(15) || ax[0] > 0.5;
  }
  for (const k of PAD_BITS) if (keysDown.has(k)) s[k] = true;
  let mask = 0; PAD_BITS.forEach((k, i) => { if (s[k]) mask |= 1 << i; });
  return mask;
}
/* TV remotes send arrow keys, Enter and Back: they work as a controller too */
const keysDown = new Set();
const KEYMAP = { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT", Enter: "A", " ": "A", Backspace: "B", Escape: "B",
  GoBack: "B", BrowserBack: "B", MediaPlayPause: "START", ColorF0Red: "L", ColorF1Green: "R", ColorF2Yellow: "SELECT", ColorF3Blue: "START" };
const KEYCODES = { 10009: "B", 415: "START", 19: "START", 403: "L", 404: "R", 405: "SELECT", 406: "START" };

/* ---------- phone side ---------- */
const cast = window.__cast = { pc: null, dc: null, code: null, pending: null, lastMask: 0, localMask: 0, remoteMask: 0 };

function applyInput() {
  const gm = player.emu && player.emu.gameManager; if (!gm) return;
  const mask = (cast.localMask | cast.remoteMask) >>> 0;
  PAD_BITS.forEach((k, i) => {
    const now = (mask >> i) & 1, was = (cast.lastMask >> i) & 1;
    if (now !== was) try { gm.simulateInput(0, PAD[k], now); } catch (e) {}
  });
  cast.lastMask = mask;
}
function applyRemote(mask) { cast.remoteMask = mask; applyInput(); }
function setCastUi(state) {
  const b = $("#castBtn");
  b.textContent = state === "on" ? "Na TV ●" : state === "wait" ? "Conectando…" : "Jogar na TV";
  b.classList.toggle("primary", state === "on");
}
function stopCast(msg) {
  try { cast.pc && cast.pc.close(); } catch (e) {}
  // closing the connection does not stop the canvas capture: left running, every old
  // capture keeps copying each frame of the game, and they pile up on every reconnect
  if (cast.stream) { for (const t of cast.stream.getVideoTracks()) t.stop(); cast.stream = null; }
  cast.pc = null; cast.dc = null;
  cast.localMask = 0; applyRemote(0);
  for (const t of window.__audioTaps || []) t.local.gain.value = 1;
  setCastUi("off");
  showPad(false);
  if (window.__castCap) { window.__castCap = 0; window.dispatchEvent(new Event("resize")); }
  if (msg) toast(msg, 3500);
}
async function castTo(code) {
  const emu = player.emu;
  if (!emu || !emu.started || !emu.canvas) { cast.pending = code; return; }
  stopCast();
  setCastUi("wait");
  try {
    const sig = await signal(code);
    const pc = new RTCPeerConnection(RTC_CONFIG); cast.pc = pc;
    window.__castCap = 1; window.dispatchEvent(new Event("resize"));
    await sleep(150);
    // capture the emulator's own canvas: no copy, no readback from the GPU
    const stream = emu.canvas.captureStream(60);
    cast.stream = stream;
    const vtrack = stream.getVideoTracks()[0];
    try { vtrack.contentHint = "motion"; } catch (e) {}
    const vt = pc.addTransceiver(vtrack, { direction: "sendonly", streams: [stream] });
    try {
      const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities("video");
      if (caps && vt.setCodecPreferences) {
        const pref = [...caps.codecs.filter((c) => /vp8/i.test(c.mimeType)), ...caps.codecs.filter((c) => !/vp8/i.test(c.mimeType))];
        vt.setCodecPreferences(pref);
      }
    } catch (e) {}
    const tap = (window.__audioTaps || [])[0];
    if (tap && tap.out) { const at = tap.out.stream.getAudioTracks()[0]; if (at) pc.addTrack(at, stream); }
    const dc = pc.createDataChannel("controle", { ordered: false, maxRetransmits: 0 }); cast.dc = dc;
    dc.onmessage = (e) => { const m = Number(e.data); if (!Number.isNaN(m)) applyRemote(m); };
    pc.onconnectionstatechange = () => {
      if (pc !== cast.pc) return;
      if (pc.connectionState === "connected") {
        setCastUi("on"); keepAwake(); showPad(true); wakeAudio();
        for (const t of window.__audioTaps || []) t.local.gain.value = 0;
        toast("Jogando na TV. Este celular agora é o controle.", 3500);
        const send = vt.sender, p = send.getParameters();
        p.encodings = (p.encodings && p.encodings.length ? p.encodings : [{}]).map((e) => ({ ...e, maxBitrate: 2_500_000, maxFramerate: 60, scaleResolutionDownBy: 1, priority: "high", networkPriority: "high" }));
        p.degradationPreference = "maintain-framerate";
        send.setParameters(p).catch(() => {});
      } else if (pc.connectionState === "failed") stopCast("Não deu para conectar com a TV. Os dois aparelhos estão na mesma rede Wi-Fi?");
      else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") { if (cast.pc === pc) stopCast("A TV desconectou."); }
    };
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    const offerId = rid();
    const stopListen = sig.listen("resposta", async (msg) => {
      if (!msg.sdp || msg.re !== offerId || pc !== cast.pc || pc.signalingState !== "have-local-offer") return;
      stopListen();
      try { await pc.setRemoteDescription(msg.sdp); } catch (e) { stopCast("A TV respondeu de um jeito inesperado. Tente de novo."); }
    });
    await sig.send("oferta", { id: offerId, sdp: pc.localDescription.toJSON(), from: device.name });
    setTimeout(() => { if (pc === cast.pc && pc.connectionState !== "connected") { stopListen(); stopCast("A TV não respondeu. Confira o código e se ela está na tela de espera."); } }, 25000);
  } catch (e) { stopCast("Não deu para começar a transmissão."); }
}
/* ---------- the phone as a controller ----------
   A touchscreen can't tell a resting finger from a pressing one, so the rule is
   the one a real pad follows: a button is pressed only by the finger that landed
   on it. A finger that slides across other buttons just "feels" them: a short
   tick on every edge it crosses, and a firmer pulse when something is pressed.
   The D-pad keeps the finger that started on it, even if it drifts a little off,
   and ticks on every change of direction, like the ridges of a real cross. */
const PAD_VIB = { press: 18, tick: 7, dir: 9 };
let lastVib = 0;
function vib(ms) {
  if (!navigator.vibrate || (window.__diag && window.__diag.silentVib)) return;
  const now = performance.now(); if (now - lastVib < 25 && ms < 15) return;
  lastVib = now; try { navigator.vibrate(ms); } catch (e) {}
}
const padTouches = new Map();
const padState = { rot: 0, geo: null, shownMask: -1, shownOver: "", shownDir: "" };
/* Hit-testing uses rectangles measured once per layout. The pad only ever turns by
   90 degrees, so every control's bounding box is still its exact outline on screen. */
function padGeometry() {
  if (padState.geo) return padState.geo;
  const geo = [];
  for (const n of document.querySelectorAll("#pad [data-btn], #pad .pad-dpad")) {
    const r = n.getBoundingClientRect();
    geo.push({ id: n.classList.contains("pad-dpad") ? "dpad" : n.dataset.btn, round: n.classList.contains("pad-face"),
      l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, rad: Math.min(r.width, r.height) / 2 });
  }
  return (padState.geo = geo);
}
function controlAt(x, y) {
  for (const g of padGeometry()) {
    if (x < g.l || x > g.r || y < g.t || y > g.b) continue;
    if (g.round && Math.hypot(x - g.cx, y - g.cy) > g.rad) continue;
    return g.id;
  }
  return null;
}
function dpadMask(x, y) {
  const d = padGeometry().find((g) => g.id === "dpad"); if (!d) return 0;
  let dx = (x - d.cx) / ((d.r - d.l) / 2), dy = (y - d.cy) / ((d.b - d.t) / 2);
  if (padState.rot === 90) [dx, dy] = [dy, -dx];
  else if (padState.rot === -90) [dx, dy] = [-dy, dx];
  if (Math.hypot(dx, dy) < 0.2) return 0;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;   // 0 = right, 90 = down
  let m = 0;
  if (a > -67.5 && a < 67.5) m |= 1 << PAD_BITS.indexOf("RIGHT");
  if (a > 22.5 && a < 157.5) m |= 1 << PAD_BITS.indexOf("DOWN");
  if (a > 112.5 || a < -112.5) m |= 1 << PAD_BITS.indexOf("LEFT");
  if (a > -157.5 && a < -22.5) m |= 1 << PAD_BITS.indexOf("UP");
  return m;
}
function touchMask(p) {
  if (p.anchor === "dpad") return dpadMask(p.x, p.y);
  if (p.anchor && p.over === p.anchor) return 1 << PAD_BITS.indexOf(p.anchor);
  return 0;
}
function padUpdate() {
  let m = 0;
  const over = [];
  for (const p of padTouches.values()) {
    const pm = touchMask(p);
    if (p.anchor === "dpad" && pm !== p.mask && pm) vib(p.mask ? PAD_VIB.dir : PAD_VIB.press);
    else if (pm && !p.mask) vib(PAD_VIB.press);
    p.mask = pm; m |= pm;
    if (p.over && p.over !== "dpad" && !(pm & (1 << PAD_BITS.indexOf(p.over)))) over.push(p.over);
  }
  cast.localMask = m;
  applyInput();
  // touch the DOM only when something visible changed
  const overKey = over.sort().join(" ");
  if (m !== padState.shownMask || overKey !== padState.shownOver) {
    padState.shownMask = m; padState.shownOver = overKey;
    for (const b of document.querySelectorAll("#pad [data-btn]")) {
      const bit = 1 << PAD_BITS.indexOf(b.dataset.btn);
      b.classList.toggle("on", !!(m & bit));
      b.classList.toggle("over", over.includes(b.dataset.btn));
    }
    const dirs = ["UP", "DOWN", "LEFT", "RIGHT"].filter((k) => m & (1 << PAD_BITS.indexOf(k))).join(" ");
    if (dirs !== padState.shownDir) { padState.shownDir = dirs; $("#pad .pad-dpad").dataset.dir = dirs; }
  }
}
function padMsg(text) {
  const n = $("#padMsg"); n.textContent = text; n.classList.add("show");
  clearTimeout(padMsg.t); padMsg.t = setTimeout(() => n.classList.remove("show"), 2600);
}
function layoutPad() {
  const pad = $("#pad"); if (pad.hidden) return;
  padState.geo = null;
  const pref = padState.forceOrient || ls.get("cartucho.pad.orient") || "h";      // h = landscape, hr = landscape the other way, v = portrait
  const portrait = innerHeight > innerWidth;
  padState.rot = pref === "v" || !portrait ? 0 : pref === "hr" ? -90 : 90;
  pad.classList.toggle("rot", padState.rot !== 0);
  pad.classList.toggle("wide", padState.rot !== 0 || !portrait);
  if (padState.rot === 0) { pad.style.width = pad.style.height = pad.style.transform = ""; return; }
  pad.style.width = innerHeight + "px"; pad.style.height = innerWidth + "px";
  pad.style.transform = padState.rot === 90 ? `translateX(${innerWidth}px) rotate(90deg)` : `translateY(${innerHeight}px) rotate(-90deg)`;
  requestAnimationFrame(() => { padState.geo = null; });
}
window.addEventListener("resize", layoutPad);
(() => {
  const pad = $("#pad");
  const isUi = (e) => e.target.closest(".pad-top");
  const down = (e) => {
    if (isUi(e)) return;
    if (!padTouches.size) padState.geo = null;
    e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (x) {}
    const c = controlAt(e.clientX, e.clientY);
    padTouches.set(e.pointerId, { x: e.clientX, y: e.clientY, anchor: c, over: c, mask: 0 });
    if (!c) vib(PAD_VIB.tick);
    padUpdate();
  };
  const move = (e) => {
    const p = padTouches.get(e.pointerId); if (!p) return;
    e.preventDefault(); p.x = e.clientX; p.y = e.clientY;
    const c = controlAt(p.x, p.y);
    if (c !== p.over) {
      // crossing an edge: tick, unless this is the D-pad finger (it ticks on direction instead)
      if (p.anchor !== "dpad" && (c || p.over)) vib(PAD_VIB.tick);
      p.over = c;
    }
    padUpdate();
  };
  const up = (e) => { if (!padTouches.delete(e.pointerId)) return; padUpdate(); };
  pad.addEventListener("pointerdown", down);
  pad.addEventListener("pointermove", move);
  pad.addEventListener("pointerup", up);
  pad.addEventListener("pointercancel", up);
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
  $("#padStop").addEventListener("click", () => stopCast("Transmissão encerrada."));
  $("#padSave").addEventListener("click", async () => {
    vib(PAD_VIB.press);
    padMsg("Enviando o save…");
    const before = player.lastSha; await flush();
    if (player.state === "ok") { padMsg(player.lastSha === before ? "O save já estava na nuvem" : "Save enviado"); try { navigator.vibrate && navigator.vibrate([12, 70, 12]); } catch (e) {} }
    else if (player.state === "none") padMsg("Ainda não há save. Salve dentro do jogo primeiro.");
    else if (player.state === "local") padMsg("Save guardado neste celular (sem GitHub conectado)");
    else padMsg("Save guardado aqui. Ele sobe quando a internet voltar.");
  });
  $("#padRotate").addEventListener("click", () => {
    const order = ["h", "hr", "v"], cur = ls.get("cartucho.pad.orient") || "h";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    ls.set("cartucho.pad.orient", next); layoutPad();
    padMsg(next === "v" ? "Controle na vertical" : "Controle na horizontal");
  });
})();
function showPad(on) {
  $("#pad").hidden = !on;
  if (!on) { padTouches.clear(); cast.localMask = 0; }
  else layoutPad();
}

function askCastCode() {
  if (cast.pc) { stopCast("Transmissão encerrada."); return; }
  const root = $("#dialogRoot");
  const input = el("input", { id: "castInput", type: "text", maxlength: "9", autocomplete: "off", autocapitalize: "characters", placeholder: "ABCD 1234", class: "code-input" });
  const close = () => root.replaceChildren();
  root.replaceChildren(el("div", { class: "scrim" }, el("form", { class: "dialog", onsubmit: (e) => {
      e.preventDefault(); const c = normCode(input.value); if (c.length !== 8) { input.focus(); return; } close(); castTo(c);
    } },
    el("h2", {}, "Jogar na TV"),
    el("p", {}, "Na TV, abra o Cartuchin e escolha \"Usar como tela\". Digite aqui o código que aparecer. Os dois precisam estar no mesmo Wi-Fi."),
    input,
    el("button", { class: "btn primary", type: "submit" }, "Transmitir"),
    el("button", { class: "btn", type: "button", onclick: close }, "Cancelar"))));
  input.focus();
}
$("#castBtn").addEventListener("click", askCastCode);
function handleScreenLink() {
  const m = location.hash.match(/^#tela-([A-Za-z0-9]{8})$/);
  if (!m) return;
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  cast.pending = normCode(m[1]);
  $("#notice").dataset.sticky = "1";
  notice("TV pronta! Escolha o jogo: ele roda aqui e aparece na TV. Este celular vira o controle.");
}

/* ---------- TV side ---------- */
const tvScreen = { active: false, code: null, pc: null, dc: null, stopListen: null, padTimer: null, lastSent: -1 };
async function startScreen() {
  tvScreen.active = true;
  // created inside the click, so the TV browser lets it play sound later
  try { tvScreen.ac = new (window.AudioContext || window.webkitAudioContext)(); tvScreen.ac.resume().catch(() => {}); } catch (e) { tvScreen.ac = null; }
  $("#library").hidden = true; $("#screen").hidden = false;
  keepAwake();
  try { await document.documentElement.requestFullscreen(); } catch (e) {}
  tvScreen.code = newPairCode();
  const link = location.origin + location.pathname + "#tela-" + tvScreen.code;
  $("#scrCode").textContent = tvScreen.code.slice(0, 4) + " " + tvScreen.code.slice(4);
  try { const qr = window.qrcode(0, "M"); qr.addData(link); qr.make(); $("#scrQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
  showWaiting(true);
  const sig = await signal(tvScreen.code);
  const handled = new Set();
  tvScreen.stopListen = sig.listen("oferta", async (msg) => {
    if (!msg.sdp || !msg.id || handled.has(msg.id)) return;
    handled.add(msg.id);
    try { tvScreen.pc && tvScreen.pc.close(); } catch (e) {}
    const pc = new RTCPeerConnection(RTC_CONFIG); tvScreen.pc = pc;
    $("#scrStatus").textContent = `Conectando com ${msg.from || "o celular"}…`;
    pc.ontrack = (e) => {
      const v = $("#scrVideo"), st = e.streams[0];
      // the picture is drawn from a muted video (muted video always autoplays);
      // the sound goes through Web Audio, which was unlocked by the "Usar como tela" click
      v.muted = true;
      if (v.srcObject !== st) v.srcObject = st;
      try { e.receiver.jitterBufferTarget = 30; } catch (x) {}
      try { e.receiver.playoutDelayHint = 0; } catch (x) {}
      v.play().catch(() => {});
      if (e.track.kind === "audio") {
        const ac = tvScreen.ac;
        if (ac) {
          try { if (tvScreen.audioSrc) tvScreen.audioSrc.disconnect(); } catch (x) {}
          tvScreen.audioSrc = ac.createMediaStreamSource(new MediaStream([e.track]));
          tvScreen.audioSrc.connect(ac.destination);
          if (ac.state !== "running") ac.resume().then(() => {}, () => { $("#scrTap").hidden = false; });
          setTimeout(() => { if (ac.state !== "running") $("#scrTap").hidden = false; }, 1500);
        } else { v.muted = false; v.play().catch(() => { $("#scrTap").hidden = false; }); }
      }
    };
    pc.ondatachannel = (e) => { tvScreen.dc = e.channel; };
    pc.onconnectionstatechange = () => {
      if (pc !== tvScreen.pc) return;
      if (pc.connectionState === "connected") showWaiting(false);
      else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        showWaiting(true); $("#scrStatus").textContent = "O celular desconectou. Esperando de novo…";
      }
    };
    try {
      await pc.setRemoteDescription(msg.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc);
      await sig.send("resposta", { re: msg.id, sdp: pc.localDescription.toJSON() });
    } catch (e) { $("#scrStatus").textContent = "Não deu para conectar. Tente de novo no celular."; }
  });
  clearInterval(tvScreen.padTimer);
  let lastBeat = 0;
  const tick = () => {
    if (!tvScreen.active) return;
    requestAnimationFrame(tick);
    const dc = tvScreen.dc; if (!dc || dc.readyState !== "open") return;
    const mask = readPad(), now = performance.now();
    if (mask !== tvScreen.lastSent || now - lastBeat > 200) { try { dc.send(String(mask)); } catch (e) {} tvScreen.lastSent = mask; lastBeat = now; }
  };
  requestAnimationFrame(tick);
}
/* The stream arrives at the GBA's own 240x160. Drawing each frame into a canvas of
   that size, then letting CSS enlarge it with pixelated scaling, keeps the pixels
   sharp on any TV (videos are always smoothed when scaled). */
let scrDrawing = false;
function startScreenDraw() {
  if (scrDrawing) return; scrDrawing = true;
  const v = $("#scrVideo"), c = $("#scrCanvas"), g = c.getContext("2d", { alpha: false });
  const draw = () => {
    if (!tvScreen.active) { scrDrawing = false; return; }
    if (v.videoWidth && (c.width !== v.videoWidth || c.height !== v.videoHeight)) { c.width = v.videoWidth; c.height = v.videoHeight; g.imageSmoothingEnabled = false; }
    try { if (v.readyState >= 2) g.drawImage(v, 0, 0, c.width, c.height); } catch (e) {}
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
  };
  g.imageSmoothingEnabled = false;
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
}
function showWaiting(on) {
  $("#scrWait").hidden = !on; $("#scrCanvas").hidden = on;
  if (!on) startScreenDraw();
  if (on) $("#scrStatus").textContent = "Esperando o celular…";
}
function stopScreen() {
  tvScreen.active = false;
  try { tvScreen.stopListen && tvScreen.stopListen(); } catch (e) {}
  try { tvScreen.pc && tvScreen.pc.close(); } catch (e) {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  location.reload();
}
$("#screenBtn").addEventListener("click", startScreen);
$("#scrExit").addEventListener("click", stopScreen);
$("#scrTap").addEventListener("click", () => {
  if (tvScreen.ac) tvScreen.ac.resume().catch(() => {}); else { $("#scrVideo").muted = false; $("#scrVideo").play().catch(() => {}); }
  $("#scrTap").hidden = true;
});
window.addEventListener("keydown", () => { if (tvScreen.ac && tvScreen.ac.state !== "running") tvScreen.ac.resume().then(() => { $("#scrTap").hidden = true; }, () => {}); }, true);
window.addEventListener("keydown", (e) => {
  if (!tvScreen.active) return;
  const k = KEYMAP[e.key] || KEYCODES[e.keyCode];
  if (!k) return;
  if (k === "B" && !$("#scrWait").hidden) { stopScreen(); return; }
  keysDown.add(k); e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.key] || KEYCODES[e.keyCode];
  if (k) keysDown.delete(k);
});

/* ---------------- speed diagnostic ----------------
   Runs bench.gba (a GBA program that never sleeps) in fast-forward with no speed
   limit, so the number is how much emulation this device can do, not just whether
   it reaches 100%. Then it turns on, one at a time, each thing the console mode adds
   on top (the controller, fingers moving, vibration, the video stream) and measures
   again. Whatever makes the number drop is what is slowing this device down. */
const DIAG_STEPS = [
  { id: "base", label: "Só o emulador" },
  { id: "pad", label: "Controle na tela, horizontal", pad: "h" },
  { id: "padv", label: "Controle na tela, vertical", pad: "v" },
  { id: "padrich", label: "Controle com sombras suaves (visual anterior)", pad: "h", rich: true },
  { id: "touch", label: "Controle + dedos se mexendo", pad: "h", touch: true },
  { id: "vib", label: "Controle + dedos + vibração", pad: "h", touch: true, vib: true },
  { id: "cast", label: "Transmissão de vídeo e som (sem rede)", cast: true },
  { id: "all", label: "Tudo junto", pad: "h", touch: true, vib: true, cast: true },
  { id: "recast", label: "Depois de ligar e desligar a transmissão 3 vezes", recast: 3 },
  { id: "base2", label: "Só o emulador, de novo (confere a medida)" },
];
const diag = window.__diag = { running: false, done: false, results: [], silentVib: false };
const GBA_FPS = 59.7275;

function diagShow(html) { $("#diagBody").innerHTML = html; }
function diagRow(r, base) {
  const pct = Math.round((r.fps / GBA_FPS) * 100);
  const rel = base ? Math.round((r.fps / base) * 100) : 100;
  const cls = !base ? "" : rel >= 92 ? "ok" : rel >= 80 ? "warn" : "bad";
  return `<tr><td>${r.label}</td><td class="num">${pct}%</td><td class="num ${cls}">${base ? (rel >= 100 ? "sem perda" : "−" + (100 - rel) + "%") : "referência"}</td></tr>`;
}
function diagBase() {
  const b = diag.results.filter((r) => r.id === "base" || r.id === "base2");
  return b.length ? b.reduce((a, r) => a + r.fps, 0) / b.length : 0;
}
function diagTable() {
  const base = diagBase();
  return `<table class="diag-table"><thead><tr><th>Situação</th><th class="num">Capacidade</th><th class="num">Custo</th></tr></thead><tbody>${
    diag.results.map((r) => diagRow(r, r.id.startsWith("base") ? 0 : base)).join("")}</tbody></table>`;
}
function diagReport() {
  const base = diagBase();
  const lines = diag.results.map((r) => `${r.label}: ${Math.round((r.fps / GBA_FPS) * 100)}%${!r.id.startsWith("base") && base ? ` (${Math.round((r.fps / base) * 100)}% do normal)` : ""}`);
  return ["Cartuchin, teste de velocidade", new Date().toLocaleString("pt-BR"),
    `Aparelho: ${device.name} · ${navigator.userAgent}`,
    `Núcleos: ${navigator.hardwareConcurrency || "?"} · Tela: ${screen.width}x${screen.height} @${window.devicePixelRatio || 1}x`,
    `Desempenho: ${perf.mode}${perf.learned ? " (aprendeu modo leve)" : ""} · Controle: ${ls.get("cartucho.pad.orient") || "h"}`,
    "", ...lines].join("\n");
}

function diagTouches(withVib) {
  diag.silentVib = !withVib;
  let t = 0, down = false;
  const fire = (type, x, y, id) => $("#pad").dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 31 }));
  const timer = setInterval(() => {
    const geo = padGeometry(), d = geo.find((g) => g.id === "dpad"), a = geo.find((g) => g.id === "A");
    if (!d || !a) return;
    const r = (d.r - d.l) * 0.35, x = d.cx + Math.cos(t / 6) * r, y = d.cy + Math.sin(t / 6) * r;
    if (!down) { fire("pointerdown", x, y, 31); down = true; } else fire("pointermove", x, y, 31);
    if (t % 12 === 0) fire("pointerdown", a.cx, a.cy, 32);
    if (t % 12 === 6) fire("pointerup", a.cx, a.cy, 32);
    t++;
  }, 8);   // 125 events a second, like a fast touchscreen
  return () => { clearInterval(timer); if (down) fire("pointerup", 0, 0, 31); fire("pointerup", 0, 0, 32); diag.silentVib = false; };
}
async function diagLoopback(emu) {
  window.__castCap = 1; window.dispatchEvent(new Event("resize"));
  await sleep(200);
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
  const stream = emu.canvas.captureStream(60);
  a.addTrack(stream.getVideoTracks()[0], stream);
  const tap = (window.__audioTaps || [])[0];
  if (tap && tap.out) { const at = tap.out.stream.getAudioTracks()[0]; if (at) a.addTrack(at, stream); }
  const v = document.createElement("video"); v.muted = true; v.playsInline = true;
  b.ontrack = (e) => { v.srcObject = e.streams[0]; v.play().catch(() => {}); };
  await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
  return () => { try { a.close(); b.close(); } catch (e) {} for (const t of stream.getVideoTracks()) t.stop(); v.srcObject = null; window.__castCap = 0; window.dispatchEvent(new Event("resize")); };
}
async function runDiagnostic() {
  if (diag.running) return;
  diag.running = true; diag.done = false; diag.results = [];
  $("#library").hidden = true; $("#player").hidden = false; $("#diag").hidden = false;
  $("#pName").textContent = "Teste de velocidade";
  diagShow("<p>Carregando o emulador…</p>");
  keepAwake();
  let bytes;
  try { bytes = new Uint8Array(await (await fetch("bench.gba")).arrayBuffer()); } catch (e) { diagShow("<p>Não deu para baixar o programa de teste. Confira a internet.</p>"); diag.running = false; return; }
  const emu = await createEmulator(new File([bytes], "bench.gba"), "cartuchin-bench", coreOptions(false));
  if (!emu) { diagShow("<p>Não deu para carregar o emulador.</p>"); diag.running = false; return; }
  player.emu = emu;
  await new Promise((res) => emu.on("start", res));
  await sleep(1500);
  const gm = emu.gameManager;
  try { gm.setFastForwardRatio(0); gm.toggleFastForward(1); } catch (e) {}
  diagShow("<p>Aquecendo o emulador…</p>");
  await sleep(5000);   // the browser optimises the emulator's code during the first seconds
  for (const [i, step] of DIAG_STEPS.entries()) {
    diagShow(`<p class="diag-now">Medindo ${i + 1} de ${DIAG_STEPS.length}: <b>${step.label}</b></p>${diag.results.length ? diagTable() : ""}`);
    const undo = [];
    if (step.pad) {
      padState.forceOrient = step.pad; $("#pad").classList.toggle("rich", !!step.rich); showPad(true);
      undo.push(() => { showPad(false); $("#pad").classList.remove("rich"); padState.forceOrient = null; });
    }
    if (step.touch) { await sleep(100); undo.push(diagTouches(!!step.vib)); }
    if (step.cast) { try { undo.push(await diagLoopback(emu)); } catch (e) {} }
    for (let k = 0; k < (step.recast || 0); k++) {
      try { const stop = await diagLoopback(emu); await sleep(700); stop(); await sleep(200); } catch (e) {}
    }
    await sleep(1200);
    const windows = [];
    for (let w = 0; w < 3; w++) {
      const f0 = Number(gm.getFrameNum()), t0 = performance.now();
      await sleep(1500);
      windows.push((Number(gm.getFrameNum()) - f0) / ((performance.now() - t0) / 1000));
    }
    const fps = windows.sort((x, y) => x - y)[1];   // median of three
    diag.results.push({ id: step.id, label: step.label, fps });
    for (const u of undo.reverse()) try { u(); } catch (e) {}
    await sleep(300);
  }
  try { gm.toggleFastForward(0); } catch (e) {}
  diag.running = false; diag.done = true;
  const base = diagBase();
  const worst = diag.results.filter((r) => !r.id.startsWith("base")).reduce((w, r) => (r.fps < w.fps ? r : w), { fps: Infinity });
  const verdict = Math.round((base / GBA_FPS) * 100) < 100
    ? `Este aparelho emula no máximo ${Math.round((base / GBA_FPS) * 100)}% da velocidade de um GBA no pior caso, então jogos pesados vão ficar lentos aqui mesmo sem nada a mais.`
    : worst.fps / base < 0.85
      ? `O que mais pesa neste aparelho: <b>${worst.label}</b>.`
      : "Nenhum recurso extra pesa de forma relevante neste aparelho.";
  diagShow(`<p class="diag-now">${verdict}</p>${diagTable()}<p class="diag-note">Capacidade é a velocidade máxima que o aparelho consegue com um programa que nunca descansa (100% = um GBA de verdade). Jogos reais pesam menos que isso.</p>
    <div class="diag-actions"><button class="btn primary" id="diagCopy" type="button">Copiar resultado</button><button class="btn" id="diagClose" type="button">Fechar</button></div>
    <pre class="diag-pre" id="diagText"></pre>`);
  $("#diagText").textContent = diagReport();
  $("#diagCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(diagReport()); toast("Resultado copiado"); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($("#diagText")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Selecionei o texto: copie com o menu do navegador"); }
  });
  $("#diagClose").addEventListener("click", () => location.reload());
}
$("#diagBtn").addEventListener("click", runDiagnostic);

/* EmulatorJS keeps its menu settings (controls, video, core options) in localStorage
   under "ejs-…" keys. Resetting removes those and the speed profile; the GitHub
   connection, the device name and the saves are left alone. */
function resetEmulatorSettings() {
  let n = 0;
  try {
    for (const k of Object.keys(localStorage)) if (/^ejs-/.test(k) || /^cartucho\.perf\./.test(k)) { localStorage.removeItem(k); n++; }
  } catch (e) {}
  perf.mode = "auto"; perf.learned = guessDevice() === "TV"; renderPerf();
  return n;
}
$("#resetEmuBtn").addEventListener("click", async () => {
  const ok = await dialog("Restaurar as configurações do emulador?", "Controles, vídeo, som e as opções do menu do emulador voltam ao padrão, e o desempenho volta para Automático. Seus jogos, saves e a conexão com o GitHub continuam.",
    [{ label: "Restaurar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  resetEmulatorSettings();
  toast("Configurações do emulador restauradas");
});
/* one-time reset requested after the emulator menu got changed by accident */
if (ls.get("cartucho.reset.v1") !== "done") { resetEmulatorSettings(); ls.set("cartucho.reset.v1", "done"); }

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
    if (!$("#player").hidden || !$("#screen").hidden || t - last < 60) return;
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
handleScreenLink();
if (location.hash === "#diagnostico") { try { history.replaceState(null, "", location.pathname); } catch (e) {} setTimeout(runDiagnostic, 300); }
(async () => {
  await loadRoms();
  await connect();
})();
})();
