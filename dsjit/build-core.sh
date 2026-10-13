#!/usr/bin/env bash
# Builds melonDS (libretro) + the EmulatorJS RetroArch frontend and installs the result
# into the Cartuchin source tree. Stops at the first failure; every artifact is checked
# to exist and to be newer than the start of this run, so a stale file is never copied.
#
# Usage: [THREADS=0|1] [PROF=0|1] [LTO=0|1] [JIT=0|1] build-core.sh <name>
#   e.g. THREADS=1 build-core.sh melonds_prof      PROF=0 LTO=1 build-core.sh melonds_lto
#   → cartucho/cores-built/<name>_libretro.{js,wasm}
set -euo pipefail

NAME="${1:?usage: [THREADS=1] build-core.sh <name>}"
THREADS="${THREADS:-0}"
PROF="${PROF:-1}"
LTO="${LTO:-0}"
JIT="${JIT:-0}"
for v in THREADS PROF LTO JIT; do
  [[ "${!v}" == 0 || "${!v}" == 1 ]] || { echo "$v deve ser 0 ou 1" >&2; exit 1; }
done
ROOT=/home/claude/dsjit
OUT=/home/claude/cartucho/cores-built
LOGS="$ROOT/logs"
mkdir -p "$OUT" "$LOGS"

export PATH="$ROOT/emscripten:$PATH"
export EM_CONFIG="$ROOT/emscripten/.emscripten"
export EMCC_LOCAL_PORTS="zlib=$ROOT/zlib-1.2.13"
# emcc adds EMCC_CFLAGS to every compile and link, of the core and of the frontend alike
EMCC_CFLAGS=""
[[ "$PROF" == 0 ]] && EMCC_CFLAGS+=" -DCARTUCHIN_NO_PROF"
[[ "$LTO" == 1 ]] && EMCC_CFLAGS+=" -flto"
export EMCC_CFLAGS

STAMP=$(mktemp)            # artifacts must be newer than this file
trap 'rm -f "$STAMP"' EXIT

fail() { echo "ERRO: $*" >&2; exit 1; }
fresh() {                  # fresh <file>: exists, not empty, built during this run
  [[ -s "$1" ]] || fail "$1 não foi gerado"
  [[ "$1" -nt "$STAMP" ]] || fail "$1 é de uma build anterior"
}
run() {                    # run <log> <cmd...>: output to the log; on failure show its errors
  local log="$1"; shift
  if ! "$@" >"$log" 2>&1; then
    grep -m 10 -E "error|Error" "$log" >&2 || tail -n 20 "$log" >&2
    fail "falhou: $* (log: $log)"
  fi
}

echo "1/3 núcleo melonDS"
cd "$ROOT/melonds-ejs"
# The Makefile tracks only .cpp → .o, not headers: if any header is newer than the
# oldest object, rebuild everything so no object is compiled against an old header.
OLDEST_O=$(find src -name '*.o' -printf '%T@ %p\n' | sort -n | head -n1 | cut -d' ' -f2-)
# Objects built with and without threads can't be mixed: switching rebuilds everything.
FLAGS="threads=$THREADS prof=$PROF lto=$LTO jit=$JIT"
if [[ "$(cat .cartuchin-flags 2>/dev/null || true)" != "$FLAGS" ]]; then
  echo "   modo mudou ($FLAGS): recompilando tudo"
  find src -name '*.o' -delete
  rm -f melonds_libretro_emscripten.bc
  OLDEST_O=""
fi
if [[ -n "$OLDEST_O" ]] && [[ -n "$(find src -name '*.h' -newer "$OLDEST_O" -print -quit)" ]]; then
  echo "   cabeçalho mudou: recompilando tudo"
  find src -name '*.o' -delete
  rm -f melonds_libretro_emscripten.bc
fi
run "$LOGS/core.log" emmake make -f Makefile platform=emscripten EMULATORJS_THREADS=$THREADS EMULATORJS_JIT=$JIT -j2
echo "$FLAGS" > .cartuchin-flags
# make leaves the archive alone when no source changed, so here "fresh" would be wrong:
# make succeeded, which means the archive matches the sources
[[ -s melonds_libretro_emscripten.bc ]] || fail "melonds_libretro_emscripten.bc não existe"

echo "2/3 frontend RetroArch"
cd "$ROOT/retroarch-ejs"
rm -f melonds_libretro.js melonds_libretro.wasm melonds_libretro.worker.js
if [[ "$(cat .cartuchin-flags 2>/dev/null || true)" != "$FLAGS" ]]; then
  echo "   frontend: modo mudou, limpando"
  rm -rf obj-emscripten
fi
cp "$ROOT/melonds-ejs/melonds_libretro_emscripten.bc" libretro_emscripten.a
run "$LOGS/frontend.log" emmake make -f Makefile.emulatorjs \
  HAVE_7ZIP=1 HAVE_CHD=1 HAVE_THREADS=$THREADS PTHREAD_POOL_SIZE=$((THREADS * 4)) ASYNC=0 HAVE_OPENGLES3=0 \
  STACK_SIZE=4194304 INITIAL_HEAP=134217728 HAVE_AL=0 HAVE_RWEBAUDIO=1 LIGHT_DEBUG=0 \
  TARGET=melonds_libretro.js -j2
fresh melonds_libretro.js
fresh melonds_libretro.wasm
if [[ "$THREADS" == 1 ]]; then fresh melonds_libretro.worker.js; fi
echo "$FLAGS" > .cartuchin-flags

echo "3/3 instalar"
cp melonds_libretro.js "$OUT/${NAME}_libretro.js"
cp melonds_libretro.wasm "$OUT/${NAME}_libretro.wasm"
rm -f "$OUT/${NAME}_libretro.worker.js"
if [[ "$THREADS" == 1 ]]; then
  cp melonds_libretro.worker.js "$OUT/${NAME}_libretro.worker.js"
  fresh "$OUT/${NAME}_libretro.worker.js"
fi
fresh "$OUT/${NAME}_libretro.js"
fresh "$OUT/${NAME}_libretro.wasm"
ls -la "$OUT/${NAME}_libretro."*
echo "OK"
