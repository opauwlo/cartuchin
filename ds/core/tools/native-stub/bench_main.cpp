// Benchmark nativo: roda N quadros desenhando todos, mede ms/quadro e salva o último
// quadro (as duas telas) como PPM.  uso: nds-bench rom.nds [quadros] [saida.ppm] [escala] [1=soft|2=gpu] [atraso 3D] [jit 0|1]
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
int screenWidth(int);
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
  // mesma ordem da página: renderizador primeiro, depois a escala
  int rend = argc > 5 ? atoi(argv[5]) : 1;   // 1 = software, 2 = GPU
  if (rend == 2 && emuSetOpt(4, 2) != 0) { puts("GPU indisponivel"); return 5; }
  if (argc > 6) emuSetOpt(5, atoi(argv[6]));
  if (argc > 7) emuSetOpt(6, atoi(argv[7]));   // build com JIT: 1 = JIT, 0 = interpretador   // 3D da GPU com 1 quadro de atraso (1) ou não (0)
  int scale = argc > 4 ? atoi(argv[4]) : 1;
  if (scale > 1 && emuSetOpt(3, scale) != 0) { puts("escala invalida"); return 4; }
  if (loadROM((int)n) != 0) { puts("loadROM falhou"); return 3; }
  int frames = argc > 2 ? atoi(argv[2]) : 600;
  for (int i = 0; i < 60; i++) { runFrame(1, 0, 0, 0, 0); audioDrain(16384); }   // aquece
  auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < frames; i++) { runFrame(1, 0, 0, 0, 0); audioDrain(16384); }
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  printf("render=%s escala=%dx quadros=%d ms/quadro=%.3f (%.0f fps de emulação)\n", rend == 2 ? "gpu" : "soft", scale, frames, ms / frames, 1000.0 * frames / ms);
  if (argc > 3) {
    // as duas telas empilhadas em 256*s x 384*s; a tela não ampliada (só 2D) é esticada
    const int w = outWidth(), h = outHeight(), sh = h / 2;
    const uint8_t *fb = (const uint8_t *)getSymbol(scale > 1 ? 8 : 4);
    FILE *o = fopen(argv[3], "wb");
    fprintf(o, "P6 %d %d 255\n", w, h);
    for (int scr = 0; scr < 2; scr++) {
      const int sw = scale > 1 ? screenWidth(scr) : w, f = w / sw;
      const uint8_t *base = fb + (size_t)scr * w * sh * 4;
      for (int y = 0; y < sh; y++)
        for (int x = 0; x < w; x++) fwrite(base + ((size_t)(y / f) * sw + x / f) * 4, 1, 3, o);
    }
    fclose(o);
  }
  return 0;
}
