# DS Web+ (teste)

Emulador de DS: DeSmuME-wasm do [44670](https://github.com/44670/desmume-wasm) com patch próprio.

- `index.html`: a página (JS inline). Abre em `/cartuchin/ds/`.
- `core/desmume.patch`: mudanças no core (áudio em ring buffer, correções de crash, save state).
- `core/build.sh`: build Emscripten (SIMD + fallback).
- `nds*.js` / `nds*.wasm`: gerados pelo workflow `ds-core.yml`, não editar à mão.

Licença do core: GPL-2.0 (DeSmuME).
