import { b64, unb64 } from "./bytes.js";
import { askGoogleToken, clearAuth, cloud, cloudName, gh, gisClient, googleAvailable, isGoogle, loadGis, saveAuth, utf8 } from "./cloud.js";
import { notice } from "./library.js";
import { dialog } from "./ui/dialogs.js";
import { pickRom } from "./ui/pickers.js";
import { render } from "./ui/screens.js";
import { $, el, ls, toast } from "./util.js";

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
  $("#googleBox").hidden = !googleAvailable();
  if (!googleAvailable()) $("#ghAdv").open = true;
  else loadGis().then(gisClient).catch(() => { $("#googleMsg").textContent = "Não deu para carregar o login do Google. Confira a internet."; });
  const repo = $("#ghRepo");
  if (!repo.value) repo.value = defaultRepo();
  $("#dataRepoName").textContent = dataRepoName();
  render();
}

$("#ghForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [owner, repo] = $("#ghRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "").split("/");
  const token = $("#ghToken").value.trim();
  const msg = $("#ghMsg");
  if (!owner || !repo || !token) {
    msg.textContent = "Preencha o repositório (usuário/nome) e o token.";
    return;
  }
  msg.textContent = "Testando a conexão…";
  const auth = { owner, repo, token };
  try {
    const info = await gh(`/repos/${owner}/${repo}`, {}, auth);
    if (!info.permissions || !info.permissions.push) {
      msg.textContent = "O token só consegue ler esse repositório. Dê permissão de leitura e escrita em Contents.";
      return;
    }
    if (!info.private) {
      msg.textContent = "Esse repositório é público. Use um repositório privado para guardar ROMs e saves.";
      return;
    }
    saveAuth(auth);
    location.reload();
  } catch (err) {
    msg.textContent = err.status === 401 ? "O GitHub não aceitou esse token. Confira se copiou ele inteiro."
      : err.status === 404 ? "Não achei o repositório. Confira o nome e se o token tem acesso a ele."
      : "Não deu para falar com o GitHub agora. Confira a internet.";
  }
});
$("#localOnlyBtn").addEventListener("click", () => {
  ls.set("cartucho.localOnly", "1");
  render();
});
$("#emptyAddBtn").addEventListener("click", pickRom);
$("#googleBtn").addEventListener("click", () => {
  const msg = $("#googleMsg");
  if (!gisClient()) {
    msg.textContent = "Carregando o login do Google… toque de novo em um instante.";
    loadGis().then(gisClient).catch(() => {});
    return;
  }
  askGoogleToken(true).then(() => {
    msg.textContent = "Conectado! Abrindo sua biblioteca…";
    location.reload();
  },
    (e) => { msg.textContent = /popup/.test(e.message) ? "O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente de novo."
      : e.message === "scope" ? "Para guardar seus jogos, deixe marcada a permissão do Google Drive na tela do Google e tente de novo."
      : "Não deu para entrar. Tente de novo."; });
});
$("#disconnectBtn").addEventListener("click", async () => {
  const ok = await dialog("Desconectar este aparelho?", `Os jogos que já estão aqui continuam, mas o save para de subir para o ${cloudName()} até você conectar de novo.`,
    [{ label: "Desconectar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (ok) {
    if (isGoogle() && cloud.auth.token && window.google && google.accounts && google.accounts.oauth2) try { google.accounts.oauth2.revoke(cloud.auth.token, () => {}); } catch (e) {}
    clearAuth();
    location.reload();
  }
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
  const msg = new Uint8Array(iv.length + ct.length);
  msg.set(iv);
  msg.set(ct, iv.length);
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
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    $("#pairQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { $("#pairQr").textContent = ""; }
  $("#pairBox").hidden = false;
  $("#pairStartBtn").hidden = true;
  $("#pairStatus").textContent = "Esperando o outro aparelho…";
  try { $("#pairBox").scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
  const since = Math.floor(Date.now() / 1000) - 5;
  clearInterval(pairTimer);
  pairTimer = setInterval(async () => {
    try {
      const r = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${since}`, { cache: "no-store" });
      const lines = (await r.text()).split("\n").filter(Boolean);
      for (const line of lines) {
        const m = JSON.parse(line);
        if (m.event !== "message" || !m.message) continue;
        try {
          const raw = unb64(m.message.trim());
          const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
          const auth = JSON.parse(utf8.dec(new Uint8Array(pt)));
          if (auth && auth.token) {
            clearInterval(pairTimer);
            saveAuth(auth);
            $("#pairStatus").textContent = "Conectado! Abrindo a biblioteca…";
            setTimeout(() => location.reload(), 800);
            return;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }, 3000);
}
$("#pairStartBtn").addEventListener("click", startPairing);

async function pairOther(code) {
  if (!cloud.auth || !cloud.db) {
    toast("Conecte este aparelho ao GitHub primeiro.");
    return;
  }
  const ok = await dialog("Conectar o outro aparelho?", `Ele vai poder abrir seus jogos e gravar saves no ${cloud.auth.owner}/${cloud.auth.repo}. Confira se o código na tela dele é ${normCode(code).slice(0, 4)} ${normCode(code).slice(4)}.`,
    [{ label: "Conectar", value: true, cls: "primary" }, { label: "Cancelar", value: false }]);
  if (!ok) return;
  try {
    await sendPairing(code);
    toast("Pronto! O outro aparelho conecta em alguns segundos.", 4000);
  }
  catch (e) { toast("Não deu para enviar agora. Tente de novo.", 4000); }
}
function handlePairLink() {
  const m = location.hash.match(/^#parear-([A-Za-z0-9]{8})$/);
  if (!m) return;
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (cloud.db) pairOther(m[1]);
  else {
    $("#notice").dataset.sticky = "1";
    notice("Para conectar o outro aparelho, conecte este aqui ao GitHub primeiro e abra o link de novo.");
  }
}
$("#pairOtherBtn").addEventListener("click", async () => {
  const root = $("#dialogRoot");
  const input = el("input", { id: "pairInput", type: "text", maxlength: "9", autocomplete: "off", autocapitalize: "characters", placeholder: "ABCD 1234", class: "code-input" });
  const close = () => root.replaceChildren();
  const box = el("form", { class: "dialog", onsubmit: (e) => {
    e.preventDefault();
    const c = normCode(input.value);
    if (c.length !== 8) {
      input.focus();
      return;
    }
    close();
    pairOther(c);
  } },
    el("h2", {}, "Conectar outro aparelho"),
    el("p", {}, "No outro aparelho, abra o Cartuchin e escolha \"Conectar com outro aparelho\". Escaneie o QR com a câmera deste celular ou digite o código aqui."),
    input,
    el("button", { class: "btn primary", type: "submit" }, "Conectar"),
    el("button", { class: "btn", type: "button", onclick: close }, "Cancelar"));
  root.replaceChildren(el("div", { class: "scrim" }, box));
  input.focus();
});

export { showConnect, newPairCode, normCode, pairMaterial, handlePairLink };
