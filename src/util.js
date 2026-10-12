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

function actionToast(msg, label, fn, ms = 9000) {
  const btn = el("button", { class: "toast-btn", type: "button" }, label);
  const t = el("div", { class: "toast toast-action", role: "status" }, el("span", {}, msg), btn);
  btn.addEventListener("click", () => { t.remove(); fn(); });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
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

export { $, el, ls, sleep, rid, actionToast, toast, ago };
