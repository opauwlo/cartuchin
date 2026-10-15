// Roda os vetores do teste diferencial do JIT (fases B e B2): cada caso é um módulo wasm de
// uma instrução; compara registradores, CPSR, ciclos e — nas instruções de memória — os
// bytes em volta do acesso e as entradas apagadas do mapa de blocos, com o que o
// interpretador nativo fez.
// uso: node jit-fuzz.cjs vetores.json
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mem = new WebAssembly.Memory({ initial: 16 }), table = new WebAssembly.Table({ initial: 1, element: 'anyfunc' });
const u8 = new Uint8Array(mem.buffer), u32 = new Uint32Array(mem.buffer);
u8.set(d.cond, d.condTab);
const L = d.lay || null;
const JIT_FILL = 0x5A5A5A5A;
let mainSnap = null, dtcmSnap = null;
if (L) {
  u8.set(d.cycTab, L.cyc);
  u32[L.dtcmRegion >> 2] = d.dtcmReg;
  u32[L.mask8 >> 2] = d.masks[0];
  u32[L.mask16 >> 2] = d.masks[1];
  u32[L.mask32 >> 2] = d.masks[2];
  mainSnap = Buffer.from(d.mainHex, 'hex');
  dtcmSnap = Buffer.from(d.dtcmHex, 'hex');
  u8.set(mainSnap, L.main);
  u8.set(dtcmSnap, L.dtcm);
  u32.fill(JIT_FILL, L.jitMain >> 2, (L.jitMain >> 2) + (d.masks[0] + 1) / 2);
}
const R = (d.base + d.oR) >> 2, C = (d.base + d.oC) >> 2;
let bad = 0, memCases = 0;
const hex = (v, n = 8) => (v >>> 0).toString(16).padStart(n, '0');
for (const t of d.t) {
  const bytes = Buffer.from(t.m, 'hex');
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { m: mem, t: table } });
  for (let r = 0; r < 16; r++) u32[R + r] = t.in[r];
  u32[C] = t.cpsr;
  const cyc = inst.exports.f0();
  const diffs = [];
  for (let r = 0; r < 15; r++) if (u32[R + r] !== t.out[r]) diffs.push(`R${r}=${hex(u32[R + r])} esperado ${hex(t.out[r])}`);
  if ((u32[C] >>> 0) !== (t.ocpsr >>> 0)) diffs.push(`CPSR=${hex(u32[C])} esperado ${hex(t.ocpsr)}`);
  if (cyc !== t.cyc) diffs.push(`ciclos ${cyc} esperado ${t.cyc}`);
  if (t.bytes) {
    memCases++;
    const base = (t.dt ? L.dtcm : L.main) + t.from, want = Buffer.from(t.bytes, 'hex'), snap = t.dt ? dtcmSnap : mainSnap;
    for (let i = 0; i < want.length; i++) if (u8[base + i] !== want[i]) { diffs.push(`memória +${t.from + i}=${u8[base + i]} esperado ${want[i]}`); break; }
    u8.set(snap.subarray(t.from, t.from + want.length), base);
    // escrita na RAM principal apaga a(s) entrada(s) do mapa de blocos
    if (t.st && !t.dt) {
      const m = d.masks[t.sz === 2 ? 2 : t.sz === 1 ? 1 : 0];
      const idx = ((t.ea & m) >>> 1);
      const want0 = [idx, ...(t.sz === 2 ? [idx + 1] : [])];
      for (const k of want0) if (u32[(L.jitMain >> 2) + k] !== 0) diffs.push(`mapa de blocos ${k} não apagado`);
      for (const k of want0) u32[(L.jitMain >> 2) + k] = JIT_FILL;
    }
  }
  if (diffs.length) { if (bad++ < 15) console.log(`${t.thumb ? 'THUMB' : 'ARM'}${t.p ? '7' : '9'} ${hex(t.op, t.thumb ? 4 : 8)}: ${diffs.join(', ')}`); }
}
if (L) {
  // nada fora do lugar no mapa de blocos
  const n = (d.masks[0] + 1) / 2;
  for (let k = 0; k < n; k++) if (u32[(L.jitMain >> 2) + k] !== JIT_FILL) { console.log(`mapa de blocos ${k} mexido sem querer`); bad++; break; }
}
console.log(`${d.t.length} casos (${memCases} de memória), ${bad} diferentes`);
console.log(bad ? 'FALHOU' : 'PASSOU');
process.exit(bad ? 1 : 0);
