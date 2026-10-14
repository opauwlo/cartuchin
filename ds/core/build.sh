#!/usr/bin/env bash
# Build nds.js + nds.wasm com Emscripten.
#   ./build.sh            -> build SIMD (padrão)
#   SIMD=0 ./build.sh     -> build sem SIMD (fallback p/ navegadores antigos)
#   OUT=dist ./build.sh   -> pasta de saída
# Teste nativo (só checa se compila/linka, sem emcc):
#   NATIVE_CHECK=1 ./build.sh
#   MT=1 ./build.sh       -> build com threads (rasterizador 3D em paralelo); precisa de SIMD
#                            e de página com isolamento cross-origin (SharedArrayBuffer)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/desmume/src"
PORT="$ROOT/desmume/wasm-port"
OUT="${OUT:-$ROOT/dist}"
SIMD="${SIMD:-1}"
NATIVE_CHECK="${NATIVE_CHECK:-0}"
JOBS="${JOBS:-$(nproc)}"
# CCACHE=1: reaproveita objetos já compilados entre execuções (o CI guarda ~/.cache/ccache)
WRAP=()
if [[ "${CCACHE:-0}" == "1" ]] && command -v ccache >/dev/null; then
  WRAP=(ccache)
  export EM_COMPILER_WRAPPER=ccache
fi

SOURCES=(
  armcpu.cpp arm_instructions.cpp bios.cpp cp15.cpp commandline.cpp common.cpp
  debug.cpp Database.cpp emufile.cpp encrypt.cpp FIFO.cpp
  firmware.cpp GPU.cpp mc.cpp path.cpp readwrite.cpp wifi.cpp MMU.cpp
  NDSSystem.cpp ROMReader.cpp render3D.cpp rtc.cpp saves.cpp slot1.cpp slot2.cpp
  SPU.cpp matrix.cpp gfx3d.cpp thumb_instructions.cpp movie.cpp
  utils/advanscene.cpp utils/datetime.cpp utils/guid.cpp
  utils/emufat.cpp utils/fsnitro.cpp utils/xstring.cpp
  utils/decrypt/crc.cpp utils/decrypt/decrypt.cpp utils/decrypt/header.cpp
  utils/vfat.cpp utils/task.cpp utils/dlditool.cpp
  utils/colorspacehandler/colorspacehandler.cpp
  utils/libfat/cache.cpp utils/libfat/directory.cpp utils/libfat/disc.cpp
  utils/libfat/fatdir.cpp utils/libfat/fatfile.cpp utils/libfat/filetime.cpp
  utils/libfat/file_allocation_table.cpp utils/libfat/libfat.cpp
  utils/libfat/libfat_public_api.cpp utils/libfat/lock.cpp utils/libfat/partition.cpp
  utils/tinyxml/tinystr.cpp utils/tinyxml/tinyxml.cpp utils/tinyxml/tinyxmlerror.cpp
  utils/tinyxml/tinyxmlparser.cpp
  addons/slot2_auto.cpp addons/slot2_mpcf.cpp addons/slot2_paddle.cpp
  addons/slot2_gbagame.cpp addons/slot2_none.cpp addons/slot2_rumblepak.cpp
  addons/slot2_guitarGrip.cpp addons/slot2_expMemory.cpp addons/slot2_piano.cpp
  addons/slot2_passme.cpp addons/slot1_none.cpp addons/slot1_r4.cpp
  addons/slot1_retail_nand.cpp addons/slot1_retail_auto.cpp
  addons/slot1_retail_mcrom.cpp addons/slot1_retail_mcrom_debug.cpp
  addons/slot1comp_mc.cpp addons/slot1comp_rom.cpp addons/slot1comp_protocol.cpp
  cheatSystem.cpp texcache.cpp rasterize.cpp metaspu/metaspu.cpp
  version.cpp
  libretro-common/compat/compat_getopt.c libretro-common/file/file_path.c
  libretro-common/compat/compat_strl.c
  libretro-common/file/retro_dirent.c libretro-common/file/retro_stat.c
  libretro-common/rthreads/async_job.c libretro-common/rthreads/rsemaphore.c
  libretro-common/rthreads/rthreads.c libretro-common/encodings/encoding_utf.c
  driver.cpp filter/deposterize.cpp filter/xbrz.cpp
)

COMMON_FLAGS=(-O3 -DNDEBUG -DHAVE_LIBZ -fno-strict-aliasing
  -I"$SRC" -I"$SRC/libretro-common/include" -w)

if [[ "$NATIVE_CHECK" == "1" ]]; then
  CC=gcc; CXX=g++
  OBJ="$ROOT/.obj-native"
  COMMON_FLAGS=(-O0 -DHAVE_LIBZ -fno-strict-aliasing -msse2
    -I"$ROOT/tools/native-stub" -I"$SRC" -I"$SRC/libretro-common/include" -w)
  if [[ "${MT:-0}" == "1" ]]; then OBJ="$ROOT/.obj-native-mt"; COMMON_FLAGS+=(-pthread -DDESMUME_THREADS); fi
else
  command -v emcc >/dev/null || { echo "emcc não encontrado"; exit 1; }
  WRAP=()   # no emcc o ccache entra pelo EM_COMPILER_WRAPPER
  CC=emcc; CXX=em++
  OBJ="$ROOT/.obj-simd$SIMD"
  COMMON_FLAGS+=(-flto -sUSE_ZLIB=1)
  if [[ "${DEBUG:-0}" == "1" ]]; then
    # build de diagnóstico: exceções com stack trace e asserts do runtime
    OBJ="$ROOT/.obj-debug"
    dbg=()
    for f in "${COMMON_FLAGS[@]}"; do
      case "$f" in -O3) dbg+=(-O1) ;; -flto) ;; *) dbg+=("$f") ;; esac
    done
    COMMON_FLAGS=("${dbg[@]}" -g2 -fexceptions)
  fi
  if [[ "${MT:-0}" == "1" ]]; then
    [[ "$SIMD" == "1" ]] || { echo "MT=1 precisa de SIMD=1"; exit 1; }
    OBJ="$ROOT/.obj-mt"
    COMMON_FLAGS+=(-pthread -DDESMUME_THREADS)   # todo objeto precisa de -pthread (memória compartilhada)
  fi
  if [[ "$SIMD" == "1" ]]; then
    # wasm SIMD + emulação de SSE2: ativa os caminhos SSE2 do DeSmuME
    # (compositor 2D da GPU e conversão de cor), que são o grosso do custo de vídeo.
    # bulk-memory: memcpy/memset viram uma instrução só (o core copia muito buffer).
    # nontrapping-fptoint: float→int sem checagem (o rasterizador 3D faz isso o tempo todo).
    # Todo navegador com SIMD já tem esses dois.
    COMMON_FLAGS+=(-msimd128 -msse2 -mbulk-memory -mnontrapping-fptoint)
  fi
fi

mkdir -p "$OBJ" "$OUT"
SOURCES+=("$PORT/main.cpp" "$PORT/stubs.cpp")

compile_one() {
  local s="$1" o
  local path="$s"; [[ "$s" = /* ]] || path="$SRC/$s"
  o="$OBJ/$(echo "$s" | tr '/' '_').o"
  if [[ "$path" == *.c ]]; then
    "${WRAP[@]}" "$CC" "${COMMON_FLAGS[@]}" -c "$path" -o "$o"
  else
    local extra=()
    [[ "$NATIVE_CHECK" == "1" && "$path" == *wasm-port/main.cpp ]] && extra=(-Dmain=wasm_main)
    "${WRAP[@]}" "$CXX" "${COMMON_FLAGS[@]}" "${extra[@]}" -std=gnu++14 -fno-rtti -c "$path" -o "$o"
  fi
}

# Compila em paralelo; qualquer falha derruba o script.
fails=0
pids=()
for s in "${SOURCES[@]}"; do
  compile_one "$s" &
  pids+=($!)
  if (( ${#pids[@]} >= JOBS )); then
    wait "${pids[0]}" || fails=$((fails+1)); pids=("${pids[@]:1}")
  fi
done
for p in "${pids[@]}"; do wait "$p" || fails=$((fails+1)); done
if (( fails > 0 )); then echo "ERRO: $fails arquivo(s) falharam ao compilar"; exit 1; fi

OBJS=("$OBJ"/*.o)
echo "Objetos: ${#OBJS[@]} (fontes: ${#SOURCES[@]})"
[[ ${#OBJS[@]} -eq ${#SOURCES[@]} ]] || { echo "ERRO: faltam objetos"; exit 1; }

if [[ "$NATIVE_CHECK" == "1" ]]; then
  g++ "${OBJS[@]}" "$ROOT/tools/native-stub/stub_main.cpp" \
      -I"$SRC" -o "$OBJ/nds-native" -lz -lpthread
  echo "OK: link nativo -> $OBJ/nds-native"
  exit 0
fi

NAME="nds"; [[ "$SIMD" == "1" ]] || NAME="nds-nosimd"
LINK_EXTRA=(-O3 -flto)
MEM=(-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728)
if [[ "${MT:-0}" == "1" ]]; then
  NAME="nds-mt"
  # memória fixa de 768 MB (cabe ROM de 512 MB): com threads, crescer a memória deixa
  # as views do JS desatualizadas; reservada só no endereço, as páginas vêm sob demanda.
  # Pool de 8 workers pronto antes do main(): rasterizador (até 4) + tarefas da GPU (3).
  MEM=(-sINITIAL_MEMORY=805306368 -pthread -sPTHREAD_POOL_SIZE=8)
fi
if [[ "${DEBUG:-0}" == "1" ]]; then
  NAME="nds-debug"
  LINK_EXTRA=(-O1 -g2 -fexceptions -sEXCEPTION_STACK_TRACES=1 -sASSERTIONS=2)
fi

EXPORTS='["_main","_malloc","_free","_prepareRomBuffer","_loadROM","_reset","_runFrame","_getSymbol","_savGetSize","_savGetPointer","_savUpdateChangeFlag","_audioDrain","_audioSetup","_micWriteSamples","_emuSetOpt","_chtGetList","_chtAddItem","_utilStrLen","_zlibCompress","_zlibDecompress","_stateSave","_stateLoad","_stateGetPointer"]'

em++ "${OBJS[@]}" "${LINK_EXTRA[@]}" -sUSE_ZLIB=1 \
  $([[ "$SIMD" == "1" ]] && echo "-msimd128 -mbulk-memory -mnontrapping-fptoint") --profiling-funcs \
  "${MEM[@]}" -sSTACK_SIZE=1048576 \
  -sENVIRONMENT=web,worker -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS","HEAPU8","HEAP16","HEAPU32","UTF8ToString"]' \
  -o "$OUT/$NAME.js"

for f in "$OUT/$NAME.js" "$OUT/$NAME.wasm"; do
  [[ -s "$f" ]] || { echo "ERRO: $f ausente ou vazio"; exit 1; }
done
ls -la "$OUT"
echo "OK: $OUT/$NAME.{js,wasm}"
