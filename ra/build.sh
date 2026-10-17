#!/usr/bin/env bash
# Compila o rcheevos + ra.c para vendor/rcheevos.{js,wasm}.  Uso: ra/build.sh <pasta do rcheevos>
set -euo pipefail
RC="$1"
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor"
SRC=$(ls "$RC"/src/api/*.c "$RC"/src/client/rc_client.c "$RC"/src/client/rc_client_external.c "$RC"/src/runtime/*.c "$RC"/src/util/*.c 2>/dev/null)
emcc -O2 -I"$RC/include" -I"$RC/src" -DRC_DISABLE_LUA \
  "$(dirname "$0")/ra.c" $SRC \
  -s MODULARIZE=1 -s EXPORT_NAME=createRcheevos -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web \
  -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["UTF8ToString","stringToNewUTF8","HEAPU8"]' \
  -o "$OUT/rcheevos.js"
ls -la "$OUT/rcheevos.js" "$OUT/rcheevos.wasm"
