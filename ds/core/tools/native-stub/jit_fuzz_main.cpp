// Gera os vetores do teste diferencial da fase B do JIT (ver jit_fuzz_dump em arm_jit_wasm.cpp).
// uso: nds-jitfuzz saida.json [quantidade]
#include <cstdio>
#include <cstdlib>
int jit_fuzz_dump(const char *path, int count);
int main(int argc, char **argv) {
  if (argc < 2) { puts("uso: nds-jitfuzz saida.json [quantidade]"); return 2; }
  const int n = jit_fuzz_dump(argv[1], argc > 2 ? atoi(argv[2]) : 20000);
  printf("casos: %d\n", n);
  return n > 0 ? 0 : 1;
}
