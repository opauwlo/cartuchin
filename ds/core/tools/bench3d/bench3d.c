/* bench3d: ROM de DS para medir o custo do 3D no emulador.
   ARM9 bare-metal (sem libnds): liga o motor 3D e, a cada quadro, desenha N triângulos
   coloridos grandes, sobrepostos e girando (muito preenchimento = rasterizador ocupado).
   Compilado com clang (armv5te) + ld.lld; empacotado em .nds por make_bench_rom.py. */
#include <stdint.h>
#define REG32(a) (*(volatile uint32_t *)(a))
#define REG16(a) (*(volatile uint16_t *)(a))

#define DISPCNT     REG32(0x04000000)
#define VCOUNT      REG16(0x04000006)
#define DISP3DCNT   REG16(0x04000060)
#define POWCNT1     REG16(0x04000304)
#define CLEAR_COLOR REG32(0x04000350)
#define CLEAR_DEPTH REG16(0x04000354)
#define MTX_MODE    REG32(0x04000440)
#define MTX_IDENT   REG32(0x04000454)
#define COLOR       REG32(0x04000480)
#define VTX_16      REG32(0x0400048C)
#define POLY_FMT    REG32(0x040004A4)
#define BEGIN_VTXS  REG32(0x04000500)
#define END_VTXS    REG32(0x04000504)
#define SWAP_BUF    REG32(0x04000540)
#define VIEWPORT    REG32(0x04000580)

#ifndef NTRI
#define NTRI 600
#endif

/* seno em ponto fixo 4.12, tabela de 64 entradas por quadrante (sem libm) */
static const int16_t sintab[65] = {
  0, 100, 201, 301, 401, 501, 601, 700, 799, 897, 995, 1092, 1189, 1285, 1380, 1474, 1567,
  1659, 1751, 1841, 1930, 2018, 2105, 2191, 2275, 2358, 2440, 2520, 2598, 2675, 2751, 2824,
  2896, 2967, 3035, 3102, 3166, 3229, 3290, 3349, 3406, 3461, 3513, 3564, 3612, 3659, 3703,
  3745, 3784, 3822, 3857, 3889, 3920, 3948, 3973, 3996, 4017, 4036, 4052, 4065, 4076, 4085,
  4091, 4095, 4096 };
static int isin(int a) {            /* a: 0..255 = volta inteira */
  a &= 255;
  int q = a >> 6, i = a & 63;
  int v = (q & 1) ? sintab[64 - i] : sintab[i];
  return (q & 2) ? -v : v;
}
static int icos(int a) { return isin(a + 64); }

static void wait_vblank(void) {
  while (VCOUNT >= 192) {}
  while (VCOUNT < 192) {}
}

static inline void vtx(int x, int y, int z) {   /* coordenadas 4.12 */
  VTX_16 = (uint32_t)(x & 0xFFFF) | ((uint32_t)(y & 0xFFFF) << 16);
  VTX_16 = (uint32_t)(z & 0xFFFF);
}

int main(void) {
  POWCNT1 = 0x820F;                 /* LCD, 2D A, motor 3D (render + geometria), tela A em cima */
  DISPCNT = 0x10000 | (1 << 3) | (1 << 8);   /* modo gráfico, BG0 = 3D, BG0 ligado */
  DISP3DCNT = 0;
  CLEAR_COLOR = 0x00001084 | (31 << 16);      /* fundo cinza escuro, opaco */
  CLEAR_DEPTH = 0x7FFF;
  VIEWPORT = 0 | (0 << 8) | (255 << 16) | (191 << 24);
  MTX_MODE = 0; MTX_IDENT = 0;      /* projeção identidade */
  MTX_MODE = 2; MTX_IDENT = 0;      /* posição/vetor identidade */

  for (uint32_t frame = 0;; frame++) {
    POLY_FMT = (31 << 16) | (3 << 6);          /* opaco, desenha frente e verso */
    BEGIN_VTXS = 0;                            /* triângulos */
    for (int i = 0; i < NTRI; i++) {
      int a = (int)(frame * 2 + i * 7);
      int r = 1400 + (i % 5) * 300;            /* raio grande: muitos pixels por triângulo */
      int cx = (isin(i * 37) >> 2), cy = (icos(i * 53) >> 2);
      int z = -2048 + (i % 32) * 128;
      COLOR = (uint32_t)((i * 3) & 31) | (((i * 5 + frame) & 31) << 5) | (((i * 7) & 31) << 10);
      vtx(cx + (isin(a) * r >> 12), cy + (icos(a) * r >> 12), z);
      COLOR = (uint32_t)(31 - (i & 31)) << 5;
      vtx(cx + (isin(a + 85) * r >> 12), cy + (icos(a + 85) * r >> 12), z);
      COLOR = (uint32_t)(i & 31) << 10;
      vtx(cx + (isin(a + 170) * r >> 12), cy + (icos(a + 170) * r >> 12), z);
    }
    END_VTXS = 0;
    SWAP_BUF = 0;
    wait_vblank();
  }
}
