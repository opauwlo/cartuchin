// Roda os vetores do teste diferencial da fase B do JIT: cada caso é um módulo wasm de uma
// instrução; compara registradores, CPSR e ciclos com o que o interpretador nativo fez.
// uso: node jit-fuzz.cjs vetores.json
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mem = new WebAssembly.Memory({ initial: 1 }), table = new WebAssembly.Table({ initial: 1, element: 'anyfunc' });
const u8 = new Uint8Array(mem.buffer), u32 = new Uint32Array(mem.buffer);
u8.set(d.cond, d.condTab);
const R = (d.base + d.oR) >> 2, C = (d.base + d.oC) >> 2;
let bad = 0;
for (const t of d.t) {
  const bytes = Buffer.from(t.m, 'hex');
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { m: mem, t: table } });
  for (let r = 0; r < 16; r++) u32[R + r] = t.in[r];
  u32[C] = t.cpsr;
  const cyc = inst.exports.f0();
  const diffs = [];
  for (let r = 0; r < 15; r++) if (u32[R + r] !== t.out[r]) diffs.push(`R${r}=${(u32[R + r] >>> 0).toString(16)} esperado ${(t.out[r] >>> 0).toString(16)}`);
  if ((u32[C] >>> 0) !== (t.ocpsr >>> 0)) diffs.push(`CPSR=${(u32[C] >>> 0).toString(16)} esperado ${(t.ocpsr >>> 0).toString(16)}`);
  if (cyc !== t.cyc) diffs.push(`ciclos ${cyc} esperado ${t.cyc}`);
  if (diffs.length) { if (bad++ < 15) console.log(`${t.thumb ? 'THUMB' : 'ARM'} ${(t.op >>> 0).toString(16).padStart(t.thumb ? 4 : 8, '0')}: ${diffs.join(', ')}`); }
}
console.log(`${d.t.length} casos, ${bad} diferentes`);
console.log(bad ? 'FALHOU' : 'PASSOU');
process.exit(bad ? 1 : 0);
