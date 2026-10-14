// Benchmark nativo: roda N quadros desenhando todos, mede ms/quadro e salva o último
// quadro (as duas telas) como PPM.  uso: nds-bench rom.nds [quadros] [saida.ppm]
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
extern "C" {
int wasm_main();
void *prepareRomBuffer(int);
int loadROM(int);
int runFrame(int, uint32_t, int, uint32_t, uint32_t);
int audioDrain(int);
void audioSetup(int);
void *getSymbol(int);
int emuSetOpt(int, int);
int outWidth();
int outHeight();
}
int main(int argc, char **argv) {
  wasm_main();
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("rom"); return 2; }
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  void *buf = prepareRomBuffer((int)n);
  if (fread(buf, 1, n, f) != (size_t)n) return 2;
  fclose(f);
  audioSetup(48000);
  int scale = argc > 4 ? atoi(argv[4]) : 1;
  if (scale > 1 && emuSetOpt(3, scale) != 0) { puts("escala invalida"); return 4; }
  if (loadROM((int)n) != 0) { puts("loadROM falhou"); return 3; }
  int frames = argc > 2 ? atoi(argv[2]) : 600;
  for (int i = 0; i < 60; i++) { runFrame(1, 0, 0, 0, 0); audioDrain(16384); }   // aquece
  auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < frames; i++) { runFrame(1, 0, 0, 0, 0); audioDrain(16384); }
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  printf("escala=%dx quadros=%d ms/quadro=%.3f (%.0f fps de emulação)\n", scale, frames, ms / frames, 1000.0 * frames / ms);
  if (argc > 3) {
    const int w = outWidth(), h = outHeight();
    const uint8_t *fb = (const uint8_t *)getSymbol(scale > 1 ? 8 : 4);
    FILE *o = fopen(argv[3], "wb");
    fprintf(o, "P6 %d %d 255\n", w, h);
    for (int i = 0; i < w * h; i++) fwrite(fb + i * 4, 1, 3, o);
    fclose(o);
  }
  return 0;
}
