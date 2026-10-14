/* scene3d: ROM de DS que exercita o 3D (para comparar o renderizador em GPU com o
   SoftRasterizer): perspectiva, textura direta e A3I5 (paleta), translúcidos com mesmo ID,
   toon, wireframe, sombra (máscara + cor), marcação de bordas e névoa.
   Cena estática; mesmo empacotamento do bench3d (make_bench_rom.py). */
#include <stdint.h>
#define REG32(a) (*(volatile uint32_t *)(a))
#define REG16(a) (*(volatile uint16_t *)(a))
#define REG8(a)  (*(volatile uint8_t *)(a))

#define DISPCNT     REG32(0x04000000)
#define VCOUNT      REG16(0x04000006)
#define DISP3DCNT   REG16(0x04000060)
#define VRAMCNT_A   REG8(0x04000240)
#define VRAMCNT_E   REG8(0x04000244)
#define POWCNT1     REG16(0x04000304)
#define EDGE_COLOR  ((volatile uint16_t *)0x04000330)
#define ALPHA_REF   REG16(0x04000340)
#define CLEAR_COLOR REG32(0x04000350)
#define CLEAR_DEPTH REG16(0x04000354)
#define FOG_COLOR   REG32(0x04000358)
#define FOG_OFFSET  REG16(0x0400035C)
#define FOG_TABLE   ((volatile uint8_t *)0x04000360)
#define TOON_TABLE  ((volatile uint16_t *)0x04000380)
#define MTX_MODE    REG32(0x04000440)
#define MTX_IDENT   REG32(0x04000454)
#define MTX_LOAD44  REG32(0x04000458)
#define COLOR       REG32(0x04000480)
#define TEXCOORD    REG32(0x04000488)
#define VTX_16      REG32(0x0400048C)
#define POLY_FMT    REG32(0x040004A4)
#define TEXIMAGE    REG32(0x040004A8)
#define PLTT_BASE   REG32(0x040004AC)
#define BEGIN_VTXS  REG32(0x04000500)
#define END_VTXS    REG32(0x04000504)
#define SWAP_BUF    REG32(0x04000540)
#define VIEWPORT    REG32(0x04000580)

#define RGB15(r,g,b) ((uint32_t)(r) | ((uint32_t)(g) << 5) | ((uint32_t)(b) << 10))
#define F(x) ((int)((x) * 4096))

static void wait_vblank(void) {
  while (VCOUNT >= 192) {}
  while (VCOUNT < 192) {}
}
static inline void vtx(int x, int y, int z) {
  VTX_16 = (uint32_t)(x & 0xFFFF) | ((uint32_t)(y & 0xFFFF) << 16);
  VTX_16 = (uint32_t)(z & 0xFFFF);
}
static inline void tc(int s, int t) { TEXCOORD = (uint32_t)((s * 16) & 0xFFFF) | ((uint32_t)((t * 16) & 0xFFFF) << 16); }
/* POLY_FMT: modo bits 4-5, frente+verso, translúcido gravando profundidade opcional, névoa, alfa, ID */
static inline uint32_t pf(int mode, int alpha, int id, int fog) {
  return (uint32_t)(mode << 4) | (3 << 6) | ((uint32_t)fog << 15) | ((uint32_t)alpha << 16) | ((uint32_t)id << 24);
}
static void quad(int x0, int y0, int x1, int y1, int z) {
  BEGIN_VTXS = 1;
  vtx(x0, y0, z); vtx(x1, y0, z); vtx(x1, y1, z); vtx(x0, y1, z);
  END_VTXS = 0;
}

int main(void) {
  POWCNT1 = 0x820F;
  DISPCNT = 0x10000 | (1 << 3) | (1 << 8);
  /* texturas em VRAM A (slot 0) e paleta em VRAM E: escreve pelo LCDC e depois mapeia */
  VRAMCNT_A = 0x80;
  VRAMCNT_E = 0x80;
  volatile uint16_t *texA = (volatile uint16_t *)0x06800000;
  for (int y = 0; y < 16; y++)          /* 16x16 direta: xadrez laranja/azul */
    for (int x = 0; x < 16; x++)
      texA[y * 16 + x] = 0x8000 | ((((x >> 2) ^ (y >> 2)) & 1) ? RGB15(31, 16, 0) : RGB15(4, 8, 28));
  volatile uint16_t *a3i5 = (volatile uint16_t *)0x06800200;   /* 16x16 A3I5: alfa por coluna */
  for (int y = 0; y < 16; y++)
    for (int x = 0; x < 16; x += 2) {
      uint8_t t0 = (uint8_t)(((x >> 1) & 7) << 5 | ((x + y) & 31));
      uint8_t t1 = (uint8_t)((((x + 1) >> 1) & 7) << 5 | ((x + 1 + y) & 31));
      a3i5[(y * 16 + x) >> 1] = (uint16_t)(t0 | (t1 << 8));
    }
  volatile uint16_t *pal = (volatile uint16_t *)0x06880000;
  for (int i = 0; i < 32; i++) pal[i] = (uint16_t)RGB15(i, 31 - i, (i * 3) & 31);
  VRAMCNT_A = 0x83;    /* textura, slot 0 */
  VRAMCNT_E = 0x83;    /* paleta de textura */

  for (int i = 0; i < 32; i++) TOON_TABLE[i] = (uint16_t)RGB15(i, (i * 2) & 31, 31 - i);
  for (int i = 0; i < 8; i++) EDGE_COLOR[i] = (uint16_t)RGB15(31, 31, 0);
  for (int i = 0; i < 32; i++) FOG_TABLE[i] = (uint8_t)(i * 4);
  FOG_COLOR = RGB15(20, 20, 24) | (31u << 16);
  FOG_OFFSET = 31200;
  ALPHA_REF = 0;
  /* texturas, mistura, marcação de bordas, névoa (shift 5) */
  DISP3DCNT = 1 | (1 << 3) | (1 << 5) | (1 << 7) | (5 << 8);
  CLEAR_COLOR = RGB15(2, 2, 6) | (31u << 16);
  CLEAR_DEPTH = 0x7FFF;
  VIEWPORT = 0 | (0 << 8) | (255 << 16) | (191 << 24);

  /* perspectiva 60°, 4:3, perto 0.1, longe 40 (vetor-linha: w' = -z) */
  static const int proj[16] = { 5321, 0, 0, 0,  0, 7094, 0, 0,  0, 0, -4116, -4096,  0, 0, -821, 0 };
  MTX_MODE = 0;
  for (int i = 0; i < 16; i++) MTX_LOAD44 = (uint32_t)proj[i];
  MTX_MODE = 2; MTX_IDENT = 0;

  for (;;) {
    /* chão com textura direta repetida, opaco, com névoa */
    TEXIMAGE = (0 >> 3) | (1u << 16) | (1u << 17) | (1u << 20) | (1u << 23) | (7u << 26);
    POLY_FMT = pf(0, 31, 1, 1);
    COLOR = RGB15(31, 31, 31);
    BEGIN_VTXS = 1;
    tc(0, 0);    vtx(F(-3), F(-1), F(-1.5));
    tc(96, 0);   vtx(F(3), F(-1), F(-1.5));
    tc(96, 160); vtx(F(3), F(-1), F(-7.9));
    tc(0, 160);  vtx(F(-3), F(-1), F(-7.9));
    END_VTXS = 0;

    TEXIMAGE = 0;  /* sem textura */
    /* triângulo opaco com cores por vértice */
    POLY_FMT = pf(0, 31, 2, 0);
    BEGIN_VTXS = 0;
    COLOR = RGB15(31, 0, 0); vtx(F(-1.6), F(-0.2), F(-3));
    COLOR = RGB15(0, 31, 0); vtx(F(0.2), F(-0.2), F(-3));
    COLOR = RGB15(0, 0, 31); vtx(F(-0.7), F(1.2), F(-3));
    END_VTXS = 0;

    /* toon: índice = vermelho do vértice */
    POLY_FMT = pf(2, 31, 5, 0);
    BEGIN_VTXS = 1;
    COLOR = RGB15(0, 0, 0);  vtx(F(0.6), F(0.4), F(-3.2));
    COLOR = RGB15(31, 0, 0); vtx(F(1.6), F(0.4), F(-3.2));
    COLOR = RGB15(31, 0, 0); vtx(F(1.6), F(1.3), F(-3.2));
    COLOR = RGB15(0, 0, 0);  vtx(F(0.6), F(1.3), F(-3.2));
    END_VTXS = 0;

    /* wireframe (alfa 0) */
    POLY_FMT = pf(0, 0, 6, 0);
    COLOR = RGB15(31, 31, 31);
    BEGIN_VTXS = 0;
    vtx(F(-2.2), F(0.5), F(-3.5)); vtx(F(-1.7), F(1.4), F(-3.5)); vtx(F(-2.6), F(1.3), F(-3.5));
    END_VTXS = 0;

    /* A3I5 com alfa por texel, polígono alfa 31 (tem fragmentos opacos e translúcidos) */
    TEXIMAGE = (0x200 >> 3) | (1u << 20) | (1u << 23) | (1u << 26);
    PLTT_BASE = 0;
    POLY_FMT = pf(0, 31, 8, 0);
    COLOR = RGB15(31, 31, 31);
    BEGIN_VTXS = 1;
    tc(0, 0);   vtx(F(0.5), F(-0.6), F(-2.8));
    tc(16, 0);  vtx(F(1.5), F(-0.6), F(-2.8));
    tc(16, 16); vtx(F(1.5), F(0.3), F(-2.8));
    tc(0, 16);  vtx(F(0.5), F(0.3), F(-2.8));
    END_VTXS = 0;
    TEXIMAGE = 0;

    /* sombra: máscara abaixo do chão (falha na profundidade) e cor por cima */
    POLY_FMT = pf(3, 16, 0, 0);
    COLOR = RGB15(0, 0, 0);
    BEGIN_VTXS = 1;
    vtx(F(-1.5), F(-1.3), F(-2.5)); vtx(F(-0.2), F(-1.3), F(-2.5));
    vtx(F(-0.2), F(-1.3), F(-4.5)); vtx(F(-1.5), F(-1.3), F(-4.5));
    END_VTXS = 0;
    POLY_FMT = pf(3, 20, 9, 0);
    BEGIN_VTXS = 1;
    vtx(F(-2.5), F(-0.9), F(-2)); vtx(F(0.8), F(-0.9), F(-2));
    vtx(F(0.8), F(-0.9), F(-5)); vtx(F(-2.5), F(-0.9), F(-5));
    END_VTXS = 0;

    /* translúcidos: dois com o mesmo ID (o segundo não pinta sobre o primeiro) e um com outro ID */
    POLY_FMT = pf(0, 16, 3, 0);
    COLOR = RGB15(31, 4, 4);
    quad(F(-1.2), F(0.0), F(0.0), F(0.9), F(-2.5));
    COLOR = RGB15(4, 4, 31);
    quad(F(-0.6), F(0.3), F(0.6), F(1.1), F(-2.4));
    POLY_FMT = pf(0, 10, 4, 0);
    COLOR = RGB15(4, 31, 4);
    quad(F(-0.9), F(-0.4), F(0.3), F(0.5), F(-2.2));

    SWAP_BUF = 1;   /* ordem manual dos translúcidos, z-buffer */
    wait_vblank();
  }
}
