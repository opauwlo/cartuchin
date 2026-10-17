import { cloud, updateIndex } from "./cloud.js";
import { player } from "./player/player.js";
import { ls, rid } from "./util.js";

/* ---------------- tempo de jogo e favoritos ----------------
   Guardados aqui (localStorage) e no índice da nuvem (cartucho.json, em games[jogo]):
     fav: true/false + favAt (vale o mais recente entre aparelhos)
     play: { <id do aparelho>: ms }   cada aparelho só escreve o seu; o total é a soma
   Conta só o tempo jogando de verdade: tela visível e jogo rodando (no modo console conta
   o celular, que é o controle; a outra tela não conta). */
const KEY = "cartucho.meta";
const devId = (() => { let v = ls.get("cartucho.devid"); if (!v) { v = rid(); ls.set("cartucho.devid", v); } return v; })();
function load() { try { return JSON.parse(ls.get(KEY) || "{}") || {}; } catch (e) { return {}; } }
let local = load();
const saveLocal = () => ls.set(KEY, JSON.stringify(local));
const entry = (key) => (local[key] = local[key] || {});

function gameMeta(key) {
  const l = local[key] || {}, ix = (cloud.index && cloud.index.games && cloud.index.games[key]) || {};
  const fav = (l.favAt || 0) >= (ix.favAt || 0) ? !!l.fav : !!ix.fav;
  const play = { ...(ix.play || {}) };
  if (l.ms) play[devId] = Math.max(play[devId] || 0, l.ms);
  const ms = Object.values(play).reduce((a, b) => a + (Number(b) || 0), 0);
  return { fav, ms, lastPlayed: Math.max(l.lastAt || 0, ix.lastAt || 0) };
}
function fmtPlay(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

let pushTimer = null;
/* manda para o índice da nuvem (sem pressa; junta mudanças) */
function pushSoon(key, ms = 4000) {
  if (!cloud.db) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(key).catch(() => {}), ms);
}
async function pushNow(key) {
  if (!cloud.db || !key) return;
  const l = local[key];
  if (!l) return;
  await updateIndex((d) => {
    const g = d.games[key] = d.games[key] || {};
    if ((l.favAt || 0) > (g.favAt || 0)) { g.fav = !!l.fav; g.favAt = l.favAt; }
    if (l.ms) { g.play = g.play || {}; g.play[devId] = Math.max(g.play[devId] || 0, l.ms); }
    if ((l.lastAt || 0) > (g.lastAt || 0)) g.lastAt = l.lastAt;
  }, "Tempo de jogo e favoritos");
}
function toggleFav(key) {
  const e = entry(key), now = gameMeta(key).fav;
  e.fav = !now;
  e.favAt = Date.now();
  saveLocal();
  pushSoon(key, 500);
  return e.fav;
}

/* contador: a cada 10 s soma o tempo desde a última vez, se estava jogando */
let tick = null, lastAt = 0;
function playing() {
  const emu = player.emu;
  if (!emu || !player.key || player.guest || document.visibilityState !== "visible") return false;
  return !!player.remote || !emu.paused;
}
function account() {
  const now = Date.now();
  if (lastAt && playing()) {
    const dt = Math.min(now - lastAt, 15000);   // tela apagada/aba parada não vira horas jogadas
    const e = entry(player.key);
    e.ms = (e.ms || 0) + dt;
    e.lastAt = now;
    saveLocal();
  }
  lastAt = now;
}
window.addEventListener("cartucho-game-start", () => {
  lastAt = Date.now();
  // o índice da nuvem pode ter um tempo maior deste aparelho (dados apagados daqui): parte dele
  const key = player.key, ix = cloud.index && cloud.index.games && cloud.index.games[key];
  const e = entry(key), mine = ix && ix.play && ix.play[devId];
  if (mine && mine > (e.ms || 0)) { e.ms = mine; saveLocal(); }
  clearInterval(tick);
  tick = setInterval(account, 10000);
});
const flushPlay = () => { account(); if (player.key && !player.guest) pushNow(player.key).catch(() => {}); };
window.addEventListener("cartucho-game-exit", flushPlay);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushPlay(); else lastAt = Date.now(); });
// de vez em quando também, para não perder horas se o aparelho desligar
setInterval(() => { if (player.key && !player.guest && playing()) pushNow(player.key).catch(() => {}); }, 5 * 60000);

window.__meta = { gameMeta, toggleFav, account };   // usado pelo teste automático
export { gameMeta, toggleFav, fmtPlay };
