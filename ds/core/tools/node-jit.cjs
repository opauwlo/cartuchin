// Compara o JIT com o interpretador no Node: mesma ROM, mesmos quadros, mesmo resultado.
// uso: node node-jit.cjs <pasta> <nome> <rom.nds> [quadros]
// Roda a ROM com o interpretador (emuSetOpt 6,0) e com o JIT (6,1), cada um num processo
// novo (o reset do console não zera tudo: comparar no mesmo processo dá falso alarme),
// comparando um hash das duas telas a cada 30 quadros. Sai 0 se tudo bate, 1 se não.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), cp = require('child_process');
if (!process.env.NJ_MODE) {
  const one = (mode) => JSON.parse(cp.execFileSync(process.execPath, process.argv.slice(1), { env: { ...process.env, NJ_MODE: mode }, maxBuffer: 1 << 26 }).toString().trim().split('\n').pop());
  const a = one('0'), b = one('1');
  let firstBad = -1;
  for (let i = 0; i < a.hashes.length; i++) if (a.hashes[i] !== b.hashes[i]) { firstBad = i; break; }
  console.log(`${process.argv[4]}: interpretador ${a.ms.toFixed(2)} ms/quadro, JIT ${b.ms.toFixed(2)} ms/quadro (${(a.ms / b.ms).toFixed(2)}x)` +
    ` · blocos compilados: ${b.blocks}, lotes com erro: ${b.errs} · ` + (firstBad < 0 ? 'imagens iguais' : `DIFERE a partir do quadro ${(firstBad + 1) * 30}`));
  console.log(firstBad < 0 ? 'PASSOU' : 'FALHOU');
  process.exit(firstBad < 0 ? 0 : 1);
}
const [dir, name, romPath] = process.argv.slice(2);
const frames = Number(process.argv[5] || 600);
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { currentScript: { src: 'x' }, createElement: () => ({}) };
globalThis.location = { href: 'http://x/' };
let resolveReady; const ready = new Promise((r) => (resolveReady = r));
globalThis.wasmReady = () => resolveReady();
globalThis.Module = { wasmBinary: fs.readFileSync(`${dir}/${name}.wasm`), print: () => {}, printErr: (t) => console.log('[err]', t), onAbort: (r) => console.log('ABORT', r) };
vm.runInThisContext(fs.readFileSync(`${dir}/${name}.js`, 'utf8'));

ready.then(async () => {
  const M = globalThis.Module, rom = fs.readFileSync(romPath);
  const p = M._prepareRomBuffer(rom.length); M.HEAPU8.set(rom, p);
  M._savGetPointer(-1);
  if (M._loadROM(rom.length) !== 0) throw new Error('loadROM');
  M._audioSetup(48000);
  const fb = M._getSymbol(4);
  const tick = () => new Promise((r) => setImmediate(r));   // deixa os lotes do JIT (assíncronos) compilarem
  const run = async (jit) => {
    M._emuSetOpt(6, jit);
    const hashes = [];
    const t0 = process.hrtime.bigint();
    for (let i = 1; i <= frames; i++) {
      M._runFrame(1, 0, 0, 0, 0);
      M._audioDrain(16384);
      await tick();
      if (i % 30 === 0) hashes.push(crypto.createHash('md5').update(M.HEAPU8.subarray(fb, fb + 256 * 384 * 4)).digest('hex').slice(0, 8));
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / frames;
    return { hashes, ms };
  };
  const r = await run(+process.env.NJ_MODE);
  console.log(JSON.stringify({ ...r, blocks: M.jitBlocks || 0, errs: M.jitErrors || 0 }));
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
