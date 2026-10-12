/* ---------------- ROM header ---------------- */
const KNOWN = {
  BPE: "Pokémon Emerald", AXV: "Pokémon Ruby", AXP: "Pokémon Sapphire", BPR: "Pokémon FireRed", BPG: "Pokémon LeafGreen",
  AMK: "Mario Kart: Super Circuit", AZL: "The Legend of Zelda: A Link to the Past", BZM: "The Legend of Zelda: The Minish Cap",
  AMA: "Super Mario Advance", AA2: "Super Mario World: Super Mario Advance 2", AMT: "Metroid Fusion", BMX: "Metroid: Zero Mission",
  AGS: "Golden Sun", AGF: "Golden Sun: The Lost Age", AFX: "Final Fantasy Tactics Advance", AWR: "Advance Wars",
};
function ascii(u8, a, n) {
  let s = "";
  for (let i = a; i < a + n && i < u8.length; i++) {
    const c = u8[i];
    if (c === 0) break;
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : "";
  }
  return s.trim();
}
function titleCase(s) { return s.toLowerCase().replace(/(^|\s|[-:])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function parseRom(u8, fileName) {
  let system, title, code = "";
  if (u8.length > 0xc0 && u8[0xb2] === 0x96) {
    system = "gba";
    title = ascii(u8, 0xa0, 12);
    code = ascii(u8, 0xac, 4);
  } else if (u8.length > 0x150 && u8[0x104] === 0xce && u8[0x105] === 0xed) {
    system = "gb";
    const cgb = u8[0x143] === 0x80 || u8[0x143] === 0xc0;
    title = ascii(u8, 0x134, cgb ? 11 : 16);
    if (cgb) {
      const c = ascii(u8, 0x13f, 4);
      if (/^[A-Z0-9]{4}$/.test(c)) code = c;
    }
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
  let chk = 0;
  for (let i = 0xa0; i < 0xbd; i++) chk = (chk + out[i]) & 0xff;
  out[0xbd] = (-(chk + 0x19)) & 0xff;
  return out;
}

export { titleCase, parseRom, fixSaveChip };
