// Harness nativo: roda o core sem navegador para validar o caminho de áudio.
// uso: nds-native [rom.nds] [frames]
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
extern "C" {
int wasm_main();
void *prepareRomBuffer(int);
int loadROM(int);
int runFrame(int, uint32_t, int, uint32_t, uint32_t);
int audioDrain(int);
void audioSetup(int);
void *getSymbol(int);
int stateSave();
int stateLoad();
}
int main(int argc, char **argv) {
  wasm_main();
  if (argc < 2) { puts("init ok (sem ROM)"); return 0; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("rom"); return 2; }
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  void *buf = prepareRomBuffer((int)n);
  if (fread(buf, 1, n, f) != (size_t)n) { puts("leitura falhou"); return 2; }
  fclose(f);
  audioSetup(48000);
  int r = loadROM((int)n);
  printf("loadROM=%d\n", r);
  if (r != 0) return 3;
  int frames = argc > 2 ? atoi(argv[2]) : 600;
  long total = 0; int minF = 1 << 30, maxF = 0; long nonzero = 0;
  for (int i = 0; i < frames; i++) {
    runFrame(i % 2, 0, 0, 0, 0);
    int got = audioDrain(16384);
    int16_t *a = (int16_t *)getSymbol(6);
    for (int k = 0; k < got * 2; k++) if (a[k]) nonzero++;
    total += got; if (got < minF) minF = got; if (got > maxF) maxF = got;
  }
  printf("frames=%d amostras=%ld media=%.1f min=%d max=%d naoZero=%ld\n",
         frames, total, (double)total / frames, minF, maxF, nonzero);
  int ss = stateSave(); printf("stateSave=%d bytes\n", ss);
  int sl = stateLoad(); printf("stateLoad=%d\n", sl);
  runFrame(1, 0, 0, 0, 0);
  // fps esperado 59.8261 -> 48000/59.8261 = 802.3 amostras por frame
  double avg = (double)total / frames;
  if (avg < 790 || avg > 815 || ss <= 0 || sl != 0) { puts("FALHOU"); return 4; }
  puts("PASSOU");
  return 0;
}
