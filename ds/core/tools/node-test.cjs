// Roda o core wasm no Node (fingindo navegador) com a ROM de tom.
// uso: node node-test.js <pasta> <nome> <tone.nds>
const fs = require('fs'), vm = require('vm');
const dir = process.argv[2], name = process.argv[3];
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { currentScript: { src: 'x' }, createElement: () => ({}) };
globalThis.location = { href: 'http://x/' };
let resolveReady; const ready = new Promise((r) => (resolveReady = r));
globalThis.wasmReady = () => resolveReady();
globalThis.Module = { wasmBinary: fs.readFileSync(`${dir}/${name}.wasm`), print: () => {}, printErr: (t) => console.log('[err]', t), onAbort: (r) => console.log('ABORT', r), onRuntimeInitialized: () => console.log('runtime init') };
vm.runInThisContext(fs.readFileSync(`${dir}/${name}.js`, 'utf8'));
ready.then(() => {
  const M = globalThis.Module, rom = fs.readFileSync(process.argv[4] || 'tone.nds');
  const p = M._prepareRomBuffer(rom.length); M.HEAPU8.set(rom, p);
  M._savGetPointer(-1); M._emuSetOpt(1, 1);
  const r = M._loadROM(rom.length); if (r !== 0) throw new Error('loadROM ' + r);
  M._audioSetup(48000);
  const ap = M._getSymbol(6); let total = 0, nz = 0; const t0 = Date.now();
  for (let i = 0; i < 600; i++) { M._runFrame(1, 0, 0, 0, 0); const n = M._audioDrain(16384);
    const a = new Int16Array(M.HEAPU8.buffer, ap, n * 2); for (const v of a) if (v) nz++; total += n; }
  const ms = Date.now() - t0;
  let ss, sl;
  try { ss = M._stateSave(); console.log('save ok', ss); } catch (e) { console.log('THROW em stateSave', e && e.stack || e); }
  try { sl = M._stateLoad(); console.log('load ok', sl); } catch (e) { console.log('THROW em stateLoad', e && e.stack || e); }
  try { M._runFrame(1, 0, 0, 0, 0); } catch (e) { console.log('THROW em runFrame', e && e.stack || e); }
  const fb = M._getSymbol(4); const px = M.HEAPU8.slice(fb, fb + 4);
  console.log(`${name}: media=${(total / 600).toFixed(1)} naoZero=${nz} state=${ss}/${sl} pixel=${[...px]} ${ (ms/600).toFixed(2)}ms/frame`);
  // áudio e vídeo são obrigatórios (exit 1); save state é aviso (exit 2) até o bug do load ser resolvido
  const hard = Math.abs(total / 600 - 802.3) < 3 && nz > 0 && px[3] === 255;
  const stateOk = ss > 0 && sl === 0;
  console.log(hard && stateOk ? 'PASSOU' : hard ? 'PASSOU (save state falhou)' : 'FALHOU');
  process.exit(hard ? (stateOk ? 0 : 2) : 1);
}).catch((e) => { console.error(e); process.exit(1); });
