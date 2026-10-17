import { ls } from "./util.js";

/* Ajustes de desempenho por jogo (neste aparelho). Um jogo pesado pode ir no leve sem
   piorar os outros. Vazio = usa o padrão do aparelho.
   GBA: perf ("auto" | "light"), gov ("on": compensar lentidão), latency (ms de folga do som)
   DS:  ds_perf, ds_scale, ds_gpu, ds_lag (os mesmos do menu do DS) */
const KEY = (k) => "cartucho.cfg." + k;
function gameCfg(key) {
  if (!key) return {};
  try { return JSON.parse(ls.get(KEY(key)) || "{}") || {}; } catch (e) { return {}; }
}
function setGameCfg(key, patch) {
  const c = { ...gameCfg(key), ...patch };
  for (const k of Object.keys(c)) if (c[k] == null) delete c[k];
  ls.set(KEY(key), JSON.stringify(c));
  return c;
}
export { gameCfg, setGameCfg };
