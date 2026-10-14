import { b64, pack, sha, unb64 } from "./bytes.js";
import { handlePairLink, showConnect } from "./connect.js";
import { device } from "./device.js";
import { idb } from "./idb.js";
import { loadRoms, notice } from "./library.js";
import { flush, player } from "./player/player.js";
import { render } from "./ui/screens.js";
import { $, el, ls, rid, sleep, toast } from "./util.js";

/* ---------------- cloud ----------------
   Two places can hold a player's library, with the same files:
     cartucho.json        library index (game title, system, where the ROM lives)
     saves/<key>.json     current save + the previous one, gzipped and base64-encoded
     states/<key>.json    snapshot to continue where you left off
     roms/<key>.gz        the ROM, gzipped
   - Google Drive (for everyone): the app's hidden folder in the player's own Drive
     (appDataFolder). Only this app can see it; nothing is stored on any server of ours.
   - A private GitHub repository (advanced): every write is a commit, so the history
     is also a backup. */
const GH_API = "https://api.github.com";
const AUTH_KEY = "cartucho.github";
const cloud = { db: false, docs: new Map(), roms: new Map(), ready: false, downloads: true, assets: false, auth: null, index: null, indexSha: null, saveShas: new Map() };
const busy = new Map();
const MAX_DOC = 900 * 1024;

function loadAuth() {
  try {
    const a = JSON.parse(ls.get(AUTH_KEY) || "null");
    if (a && a.kind === "google") return a;
    if (a && a.token && a.owner && a.repo) return a;
  } catch (e) {}
  return null;
}
const isGoogle = () => !!(cloud.auth && cloud.auth.kind === "google");
const cloudName = () => (isGoogle() ? "Google Drive" : "GitHub");
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
  if (!r.ok) {
    /** @type {any} */
    /** @type {any} */
    const e = new Error("github " + r.status);
    e.status = r.status;
    throw e;
  }
  if (opts.raw) return r;
  return r.status === 204 ? null : r.json();
}
const contents = (p, auth = cloud.auth) => `/repos/${auth.owner}/${auth.repo}/contents/${p}`;
const utf8 = { enc: (s) => new TextEncoder().encode(s), dec: (u) => new TextDecoder().decode(u) };

async function readJson(p) {
  if (isGoogle()) return drive.readJson(p);
  try {
    const r = await gh(contents(p));
    return { sha: r.sha, data: JSON.parse(utf8.dec(unb64((r.content || "").replace(/\s/g, "")))) };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
async function putFile(p, base64, sha, message, keepalive) {
  if (isGoogle()) return drive.put(p, unb64(base64), "application/json", keepalive);
  const body = { message, content: base64 };
  if (sha) body.sha = sha;
  const json = JSON.stringify(body);
  // keepalive lets the upload finish after the page is closed; browsers cap it at 64 KB
  const r = await gh(contents(p), { method: "PUT", body: json, keepalive: !!keepalive && json.length < 60000 });
  return r && r.content ? r.content.sha : null;
}
async function listDir(dir) {
  if (isGoogle()) return drive.list(dir);
  try {
    const r = await gh(contents(dir));
    return Array.isArray(r) ? r.map((f) => ({ name: f.name })) : [];
  }
  catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}
async function putBinary(path, bytes, message, type = "application/gzip") {
  if (isGoogle()) return drive.put(path, bytes, type);
  let sha;
  try {
    const ex = await gh(contents(path));
    sha = ex && ex.sha;
  } catch (e) { if (e.status !== 404) throw e; }
  return putFile(path, b64(bytes), sha, message);
}
async function getBinary(path) {   // a Response whose body is the file
  if (isGoogle()) return drive.download(path);
  return gh(contents(path), { raw: true });
}

/* ---------------- Google Drive ----------------
   Signing in uses Google Identity Services in the browser. Without a server there is
   no refresh token: an access token lasts an hour, and a new one is asked for on the
   next tap (Google answers at once, without asking again, once the player agreed).
   Until then saves wait on the device and go up as soon as there is a token. */
const CONFIG = window.CARTUCHIN_CONFIG || {};
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE = "https://www.googleapis.com/drive/v3", DRIVE_UP = "https://www.googleapis.com/upload/drive/v3";
const gauth = { client: null, waiters: [], loading: null, lastAsk: 0 };
const googleAvailable = () => !!CONFIG.googleClientId;
const tokenFresh = () => isGoogle() && cloud.auth.token && cloud.auth.exp - Date.now() > 60000;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!gauth.loading) gauth.loading = new Promise((res, rej) => {
    const sc = el("script", { src: "https://accounts.google.com/gsi/client", async: true });
    sc.onload = res;
    sc.onerror = () => {
      gauth.loading = null;
      rej(new Error("gis"));
    };
    document.head.append(sc);
  });
  return gauth.loading;
}
function gisClient() {
  if (gauth.client || !(window.google && google.accounts && google.accounts.oauth2)) return gauth.client;
  gauth.client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.googleClientId, scope: DRIVE_SCOPE,
    callback: (resp) => {
      const ws = gauth.waiters.splice(0);
      if (!resp || resp.error || !resp.access_token) {
        ws.forEach((w) => w.rej(new Error((resp && resp.error) || "denied")));
        return;
      }
      const o2 = google.accounts.oauth2;
      if (o2.hasGrantedAllScopes && !o2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
        ws.forEach((w) => w.rej(new Error("scope")));
        return;
      }
      cloud.auth = { ...(isGoogle() ? cloud.auth : {}), kind: "google", token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
      saveAuth(cloud.auth);
      ws.forEach((w) => w.res(cloud.auth.token));
    },
    error_callback: (err) => { gauth.waiters.splice(0).forEach((w) => w.rej(new Error((err && err.type) || "popup"))); },
  });
  return gauth.client;
}
/* must be called straight from a tap, before any await, or the browser blocks the window */
function askGoogleToken(first, consent) {
  const c = gisClient();
  if (!c) return Promise.reject(new Error("gis-not-ready"));
  gauth.lastAsk = Date.now();
  return new Promise((res, rej) => {
    gauth.waiters.push({ res, rej });
    c.requestAccessToken({ prompt: consent ? "consent" : first ? "select_account" : "", hint: (cloud.auth && cloud.auth.email) || undefined });
  });
}
function needToken() {
  /** @type {any} */
  /** @type {any} */
  const e = new Error("google-token");
  e.status = 401;
  e.token = true;
  return e;
}

const drive = {
  files: new Map(),   // name -> { id, t }
  listedAt: 0,
  async api(url, opts = {}) {
    if (!tokenFresh()) throw needToken();
    const headers = Object.assign({ Authorization: "Bearer " + cloud.auth.token }, opts.headers || {});
    const r = await fetch(url, { method: opts.method || "GET", headers, body: opts.body, cache: "no-store", keepalive: !!opts.keepalive });
    if (r.status === 401) {
      cloud.auth.exp = 0;
      saveAuth(cloud.auth);
      throw needToken();
    }
    if (!r.ok) {
      /** @type {any} */
      /** @type {any} */
      const e = new Error("drive " + r.status);
      e.status = r.status;
      try { e.detail = await r.text(); } catch (x) {}
      throw e;
    }
    return r;
  },
  remember(f) {
    const cur = this.files.get(f.name);
    const t = Date.parse(f.modifiedTime || 0) || Date.now();
    if (!cur || t >= cur.t) this.files.set(f.name, { id: f.id, t });
  },
  async refresh() {
    const fresh = new Map();
    this.files = fresh;
    let pageToken = "";
    do {
      const q = new URLSearchParams({ spaces: "appDataFolder", pageSize: "1000", fields: "nextPageToken,files(id,name,modifiedTime)" });
      if (pageToken) q.set("pageToken", pageToken);
      const j = await (await this.api(`${DRIVE}/files?${q}`)).json();
      for (const f of j.files || []) this.remember(f);
      pageToken = j.nextPageToken || "";
    } while (pageToken);
    this.listedAt = Date.now();
  },
  async idFor(name, exact) {
    if (!this.listedAt) await this.refresh();
    const hit = this.files.get(name);
    if (hit || !exact) return hit && hit.id;
    // before creating a file, ask Drive directly: another device may have just made it
    const q = new URLSearchParams({ spaces: "appDataFolder", q: `name = '${name.replace(/'/g, "\\'")}'`, fields: "files(id,name,modifiedTime)" });
    const j = await (await this.api(`${DRIVE}/files?${q}`)).json();
    for (const f of j.files || []) this.remember(f);
    const again = this.files.get(name);
    return again && again.id;
  },
  async list(dir) {
    await this.refresh();
    return [...this.files.keys()].filter((n) => n.startsWith(dir + "/")).map((n) => ({ name: n.slice(dir.length + 1) }));
  },
  async readJson(name) {
    const id = await this.idFor(name);
    if (!id) return null;
    try { return { sha: id, data: await (await this.api(`${DRIVE}/files/${id}?alt=media`)).json() }; }
    catch (e) {
      if (e.status === 404) {
        this.files.delete(name);
        return null;
      }
      throw e;
    }
  },
  async download(name) {
    const id = await this.idFor(name);
    if (!id) {
      /** @type {any} */
      /** @type {any} */
      const e = new Error("missing");
      e.status = 404;
      throw e;
    }
    return this.api(`${DRIVE}/files/${id}?alt=media`);
  },
  async put(name, bytes, type, keepalive) {
    const id = await this.idFor(name, true);
    if (id) {
      try {
        await this.api(`${DRIVE_UP}/files/${id}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": type }, body: bytes, keepalive: !!keepalive && bytes.length < 60000 });
        this.files.set(name, { id, t: Date.now() });
        return id;
      } catch (e) {
        if (e.status !== 404) throw e;
        this.files.delete(name);
      }
    }
    const meta = { name, parents: ["appDataFolder"] };
    let j;
    if (bytes.length < 4 * 1024 * 1024) {
      const boundary = "cartuchin" + rid();
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
      j = await (await this.api(`${DRIVE_UP}/files?uploadType=multipart&fields=id,name,modifiedTime`, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body })).json();
    } else {
      // big files (ROMs) go up in a resumable session
      const start = await this.api(`${DRIVE_UP}/files?uploadType=resumable&fields=id,name,modifiedTime`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type }, body: JSON.stringify(meta) });
      const where = start.headers.get("Location");
      if (!where) throw new Error("no-upload-url");
      j = await (await this.api(where, { method: "PUT", headers: { "Content-Type": type }, body: bytes })).json();
    }
    this.remember({ id: j.id, name, modifiedTime: new Date().toISOString() });
    return j.id;
  },
  async whoami() {
    const j = await (await this.api(`${DRIVE}/about?fields=user(displayName,emailAddress)`)).json();
    return (j.user && (j.user.emailAddress || j.user.displayName)) || "";
  },
};

/* index read-modify-write, retried when another device wrote first */
async function updateIndex(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readJson("cartucho.json");
    const data = cur ? cur.data : { version: 1, games: {} };
    if (!data.games) data.games = {};
    mutate(data);
    try {
      const sha = await putFile("cartucho.json", b64(utf8.enc(JSON.stringify(data, null, 1))), cur && cur.sha, message);
      cloud.index = data;
      cloud.indexSha = sha;
      return data;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      await sleep(400 + Math.random() * 600);
    }
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
  const files = await listDir("saves");
  const docs = await Promise.all(files.filter((f) => f.name.endsWith(".json")).map(async (f) => {
    try {
      const r = await readJson("saves/" + f.name);
      return r && r.data && r.data.game ? r : null;
    } catch (e) { return null; }
  }));
  cloud.docs.clear();
  for (const d of docs) if (d) {
    cloud.docs.set(d.data.game, d.data);
    cloud.saveShas.set(d.data.game, d.sha);
  }
}

async function connect() {
  cloud.auth = loadAuth();
  if (!cloud.auth) {
    cloud.ready = true;
    showConnect();
    return;
  }
  if (isGoogle()) {
    await connectGoogle();
    handlePairLink();
    return;
  }
  try {
    await gh(`/repos/${cloud.auth.owner}/${cloud.auth.repo}`);
    cloud.db = true;
    cloud.assets = true;
    await refreshLibrary();
  } catch (e) {
    cloud.db = false;
    cloud.assets = false;
    if (e.status === 401 || e.status === 403 || e.status === 404) {
      $("#notice").dataset.sticky = "1";
      notice("O GitHub recusou a conexão: o token pode ter vencido ou perdido o acesso ao repositório. Conecte de novo em \"Conexão com o GitHub\", lá embaixo.", "err");
    } else {
      $("#notice").dataset.sticky = "1";
      notice("Sem conexão com o GitHub agora. Dá para jogar o que já está neste aparelho; o save sobe quando a internet voltar.");
    }
  }
  cloud.ready = true;
  render();
  handlePairLink();
}

async function connectGoogle() {
  if (googleAvailable()) loadGis().then(gisClient).catch(() => {});
  if (!tokenFresh()) {
    cloud.db = false;
    cloud.ready = true;
    googleNeedsTap(true);
    render();
    return;
  }
  try {
    if (!cloud.auth.email) {
      cloud.auth.email = await drive.whoami();
      saveAuth(cloud.auth);
    }
    cloud.db = true;
    cloud.assets = true;
    googleNeedsTap(false);
    await refreshLibrary();
  } catch (e) {
    cloud.db = false;
    if (e.token) googleNeedsTap(true);
    else driveProblem(e);
  }
  cloud.ready = true;
  render();
}
function driveReason(e) {
  try {
    const j = JSON.parse(e.detail || "{}").error || {};
    return { reason: ((j.errors && j.errors[0] && j.errors[0].reason) || j.status || "") + " " + ((j.details || []).map((d) => d.reason).join(" ")), message: j.message || "" };
  }
  catch (x) { return { reason: "", message: "" }; }
}
function driveProblem(e) {
  const n = $("#notice"), { reason, message } = driveReason(e);
  n.dataset.sticky = "1";
  n.className = "notice err";
  n.hidden = false;
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(message)) {
    const proj = (message.match(/project (\d+)/) || [])[1];
    n.replaceChildren(el("span", {}, "A API do Google Drive não está ativada no projeto do app no Google Cloud. "),
      proj ? el("a", { href: `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${proj}`, target: "_blank", rel: "noopener" }, "Ativar a API do Drive") : "",
      el("span", {}, " Depois de ativar, espere um minuto e recarregue a página."));
  } else if (/insufficient|SCOPE/i.test(reason)) {
    n.replaceChildren(el("span", {}, "O Google não deu acesso à pasta do app no Drive. Entre de novo e deixe marcada a permissão do Google Drive. "),
      el("button", { class: "btn small", type: "button", onclick: () => askGoogleToken(false, true).then(() => location.reload(), () => {}) }, "Entrar de novo"));
  } else if (e.status) {
    n.replaceChildren(el("span", {}, `O Google Drive respondeu com erro ${e.status}${message ? ": " + message : ""}. Dá para jogar o que já está neste aparelho.`));
  } else {
    n.textContent = "Sem conexão com o Google Drive agora. Dá para jogar o que já está neste aparelho; o save sobe quando a internet voltar.";
  }
}
/* The Google token expired: show a one-tap way back. Any tap on the page outside the
   game counts too, so most of the time the player never sees this. */
function googleNeedsTap(on) {
  cloud.needTap = on;
  const n = $("#notice");
  if (on) {
    n.dataset.sticky = "1";
    n.className = "notice";
    n.hidden = false;
    n.replaceChildren(el("span", {}, "Sua sessão do Google expirou. Os saves ficam guardados aqui até você reconectar. "),
      el("button", { class: "btn small primary", type: "button", onclick: reconnectGoogle }, "Reconectar"));
  } else if (n.dataset.sticky === "1" && n.querySelector("button")) {
    n.dataset.sticky = "";
    n.hidden = true;
  }
}
function reconnectGoogle() {
  askGoogleToken(false).then(afterGoogleToken, () => toast("Não deu para reconectar. Tente de novo.", 3500));
}
async function afterGoogleToken() {
  googleNeedsTap(false);
  if (player.key) {
    cloud.db = true;
    flush();
  }
  else await connectGoogle();
}
window.addEventListener("pointerdown", (e) => {
  if (!isGoogle() || tokenFresh() || !gauth.client || Date.now() - gauth.lastAsk < 20000) return;
  // only on the library or the game's top bar: never in the middle of playing
  const target = /** @type {HTMLElement} */ (e.target);
  if (!$("#library").hidden || (target.closest && target.closest(".pbar, .pad-top"))) {
    askGoogleToken(false).then(afterGoogleToken, () => {});
  }
}, true);

async function getSaveDoc(key) {
  const r = await readJson("saves/" + key + ".json");
  if (r) {
    cloud.saveShas.set(key, r.sha);
    return r.data;
  }
  cloud.saveShas.delete(key);
  return null;
}

async function writeCloud(key, meta, sav, savSha, opts = {}) {
  const packed = await pack(sav);
  let cur = cloud.docs.get(key) || null, known = cloud.saveShas.has(key);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!known) {
      cur = await getSaveDoc(key);
      known = true;
    }
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
      cloud.saveShas.set(key, sha);
      cloud.docs.set(key, doc);
      render();
      return doc;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      known = false;   // another device wrote first: read it, keep it as "previous", try again
      await sleep(300 + Math.random() * 500);
    }
  }
  throw new Error("save-conflict");
}

/* ---------------- apagar ---------------- */
async function deleteFile(path, message) {
  try {
    if (isGoogle()) {
      const id = await drive.idFor(path);
      if (!id) return;
      await drive.api(`${DRIVE}/files/${id}`, { method: "DELETE" });
      drive.files.delete(path);
      return;
    }
    const ex = await gh(contents(path));
    if (ex && ex.sha) await gh(contents(path), { method: "DELETE", body: JSON.stringify({ message, sha: ex.sha }) });
  } catch (e) { if (e.status !== 404) throw e; }
}
/* Apaga da nuvem o save, o progresso (snapshot) e, se pedido, a ROM e o jogo da biblioteca. */
async function deleteCloudGame(key, title, withRom) {
  if (!cloud.db) return;
  await deleteFile("saves/" + key + ".json", `Apagar save: ${title}`);
  await deleteFile("states/" + key + ".json", `Apagar progresso: ${title}`);
  cloud.docs.delete(key);
  cloud.saveShas.delete(key);
  if (withRom) {
    await deleteFile("roms/" + key + ".gz", `Apagar ROM: ${title}`);
    await deleteFile("covers/" + key + ".jpg", `Apagar capa: ${title}`);
    cloud.roms.delete(key);
    await updateIndex((d) => { delete d.games[key]; }, `Biblioteca: tirar ${title}`);
  }
}

/* ---------------- ROM in the cloud ---------------- */
function setBusy(key, msg) {
  if (msg) busy.set(key, msg);
  else busy.delete(key);
  render();
}

async function uploadRom(rom) {
  if (!cloud.db || busy.has(rom.key)) return false;
  setBusy(rom.key, `Guardando a ROM no ${cloudName()}…`);
  try {
    const raw = new Uint8Array(await rom.blob.arrayBuffer());
    const s = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
    const gz = new Uint8Array(await new Response(s).arrayBuffer());
    const path = "roms/" + rom.key + ".gz";
    // a API de arquivos do GitHub não aceita mais que ~100 MB por envio (em base64)
    if (!isGoogle() && gz.length > 70 * 1024 * 1024) {
      setBusy(rom.key, null);
      toast(`${rom.title}: ROM grande demais para o GitHub. Ela fica só neste aparelho (o save sincroniza normal).`, 5000);
      return false;
    }
    await putBinary(path, gz, `ROM: ${rom.title}`);
    await updateIndex((d) => {
      const prev = d.games[rom.key] || {};
      d.games[rom.key] = { ...prev, title: prev.title || rom.title, cover: prev.cover !== undefined ? prev.cover : (rom.cover || null), system: rom.system, code: rom.code || "", ext: rom.ext,
        fileName: rom.fileName || "", size: raw.length, rom: path, romAt: Date.now(), romDevice: device.name };
    }, `Biblioteca: ${rom.title}`);
    cloud.roms.set(rom.key, { game: rom.key, ...cloud.index.games[rom.key] });
    setBusy(rom.key, null);
    toast(`${rom.title}: ROM guardada no ${cloudName()}`);
    return true;
  } catch (e) {
    setBusy(rom.key, null);
    toast(e.token ? "Reconecte ao Google para guardar a ROM." : (e.status === 403 && isGoogle()) ? "O Google Drive recusou: pode ser falta de espaço na sua conta." : e.status === 401 || e.status === 403 ? "O token não tem permissão de escrita no repositório." : "Não deu para guardar a ROM agora. Tente de novo.", 4000);
    return false;
  }
}

async function fetchRom(key) {
  const meta = cloud.roms.get(key);
  if (!meta || !cloud.auth) return null;
  setBusy(key, "Baixando a ROM…");
  try {
    const r = await getBinary(meta.rom);
    const total = Number(r.headers.get("content-length")) || 0;
    let got = 0;
    const chunks = [];
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
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

export { deleteCloudGame, cloud, busy, isGoogle, cloudName, saveAuth, clearAuth, gh, utf8, readJson, putFile, putBinary, getBinary, gauth, googleAvailable, tokenFresh, loadGis, gisClient, askGoogleToken, updateIndex, refreshLibrary, connect, googleNeedsTap, getSaveDoc, writeCloud, uploadRom, fetchRom };
