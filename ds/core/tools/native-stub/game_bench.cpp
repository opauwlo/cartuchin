// Benchmark com um jogo de verdade: carrega ROM + save (.sav), passa da tela de título com
// um roteiro de botões e mede ms/quadro parado e andando. Salva imagens para conferir.
// uso: nds-game rom.nds save.sav pasta [quadros_medidos] [jit 0|1] [escala] [rend 1|2]
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <string>
#ifdef PROFILE
#include <valgrind/callgrind.h>
#else
#define CALLGRIND_START_INSTRUMENTATION
#define CALLGRIND_STOP_INSTRUMENTATION
#endif
extern "C" {
int wasm_main();
void *prepareRomBuffer(int);
int loadROM(int);
int runFrame(int, uint32_t, int, uint32_t, uint32_t);
int audioDrain(int);
void audioSetup(int);
void *getSymbol(int);
int emuSetOpt(int, int);
void *savGetPointer(int);
int outWidth();
int outHeight();
}
enum { K_RIGHT = 1, K_LEFT = 2, K_DOWN = 4, K_UP = 8, K_SELECT = 16, K_START = 32, K_B = 64, K_A = 128 };
static std::string dir;
static void shot(const char *name) {
  const int w = 256, h = 384;
  const uint8_t *fb = (const uint8_t *)getSymbol(4);
  FILE *o = fopen((dir + "/" + name).c_str(), "wb");
  fprintf(o, "P6 %d %d 255\n", w, h);
  for (int i = 0; i < w * h; i++) fwrite(fb + i * 4, 1, 3, o);
  fclose(o);
}
static void run(int frames, uint32_t keys) { for (int i = 0; i < frames; i++) { runFrame(1, keys, 0, 0, 0); audioDrain(16384); } }
static double timed(int frames, uint32_t (*keys)(int)) {
  auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < frames; i++) { runFrame(1, keys(i), 0, 0, 0); audioDrain(16384); }
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() / frames;
}
int main(int argc, char **argv) {
  if (argc < 4) { puts("uso: nds-game rom.nds save.sav pasta [quadros] [jit] [escala] [rend]"); return 2; }
  dir = argv[3];
  wasm_main();
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("rom"); return 2; }
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  void *buf = prepareRomBuffer((int)n);
  if (fread(buf, 1, n, f) != (size_t)n) return 2;
  fclose(f);
  FILE *s = fopen(argv[2], "rb");
  if (!s) { perror("sav"); return 2; }
  fseek(s, 0, SEEK_END); long sn = ftell(s); fseek(s, 0, SEEK_SET);
  void *sp = savGetPointer((int)sn);
  if (fread(sp, 1, sn, s) != (size_t)sn) return 2;
  fclose(s);
  audioSetup(48000);
  const int frames = argc > 4 ? atoi(argv[4]) : 600;
  const int rend = argc > 7 ? atoi(argv[7]) : 1;
  if (rend == 2 && emuSetOpt(4, 2) != 0) { puts("GPU indisponivel"); return 5; }
  if (argc > 5) emuSetOpt(6, atoi(argv[5]));
  const int scale = argc > 6 ? atoi(argv[6]) : 1;
  if (scale > 1 && emuSetOpt(3, scale) != 0) { puts("escala invalida"); return 4; }
  emuSetOpt(0, 1);
  if (loadROM((int)n) != 0) { puts("loadROM falhou"); return 3; }
  // título → "Continuar" → jogo (apertos curtos, com folga entre eles)
  run(900, 0); shot("1-titulo.ppm");
  for (int k = 0; k < 6; k++) { run(8, k < 2 ? K_START : K_A); run(150, 0); }
  shot("2-continuar.ppm");
  for (int k = 0; k < 6; k++) { run(8, K_A); run(150, 0); }
  run(300, 0); shot("3-jogo.ppm");
  CALLGRIND_START_INSTRUMENTATION;
  const double still = timed(frames, [](int) -> uint32_t { return 0; });
  shot("4-parado.ppm");
  const double walk = timed(frames, [](int i) -> uint32_t { return ((i / 90) & 1) ? K_LEFT : K_RIGHT; });
  CALLGRIND_STOP_INSTRUMENTATION;
  shot("5-andando.ppm");
  printf("parado: %.3f ms/quadro (%.0f fps)  andando: %.3f ms/quadro (%.0f fps)\n", still, 1000 / still, walk, 1000 / walk);
  return 0;
}
