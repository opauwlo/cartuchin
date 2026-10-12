import { ls } from "./util.js";

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

export { guessDevice, device };
