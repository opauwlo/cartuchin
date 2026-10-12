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

export { b64, unb64, sha, pack, unpack, crc32, unzipRom };
