/* CPU torture test for the melonDS JIT (Cartuchin).

   A deterministic workload that mixes ARM and THUMB code, conditional execution,
   multiplies, loads/stores of every size, block copies, jump tables, indirect calls,
   recursion and a wait loop on VCOUNT (an idle loop the JIT should detect). The checksum
   of each of 48 rounds is drawn on the top screen as rows of colored bits, then the
   workload keeps running forever, so the same ROM also serves as a speed test.

   The interpreter and the JIT must draw exactly the same picture. */
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned char u8;
typedef int s32;
typedef long long s64;
typedef unsigned long long u64;

#define REG32(a) (*(volatile u32*)(a))
#define REG16(a) (*(volatile u16*)(a))
#define VRAM ((volatile u16*)0x06800000)
#define ROUNDS 48

static u32 words[256];
static u16 halves[256];
static u8 bytes[512];
static u32 copy_dst[64];

__attribute__((noinline)) static u32 mix_arm(u32 h, u32 x)
{
    h ^= x + 0x9E3779B9u + (h << 6) + (h >> 2);
    if (h & 1) h = (h >> 1) ^ 0xEDB88320u;     /* conditional execution */
    else h >>= 1;
    h += (u32)((s32)x >> 3);
    return (h << 7) | (h >> 25);                 /* rotate */
}

__attribute__((noinline, target("thumb"))) static u32 mix_thumb(u32 h, u32 x)
{
    for (int i = 0; i < 4; i++)
    {
        h = h * 33u + (x >> (i * 8) & 0xFF);
        if ((s32)h < 0) h = ~h;
    }
    return h;
}

__attribute__((noinline)) static u32 multiplies(u32 a, u32 b)
{
    u64 p = (u64)a * b;                          /* UMULL */
    s64 q = (s64)(s32)a * (s32)b;                /* SMULL */
    u32 r = a * b + (a ^ b);                     /* MUL / MLA */
    return (u32)p ^ (u32)(p >> 32) ^ (u32)q ^ (u32)(q >> 32) ^ r;
}

__attribute__((noinline)) static u32 memory(u32 seed)
{
    for (int i = 0; i < 256; i++)
    {
        seed = seed * 1664525u + 1013904223u;
        words[i] = seed;
        halves[i] = (u16)(seed >> 7);
        bytes[i * 2] = (u8)(seed >> 3);
        bytes[i * 2 + 1] = (u8)(seed >> 19);
    }
    u32 h = 0;
    for (int i = 0; i < 256; i += 3)
        h = mix_arm(h, words[i] + halves[255 - i] + bytes[i * 2 + 1] + (s32)(signed char)bytes[i]);
    __builtin_memcpy(copy_dst, &words[17], sizeof(copy_dst));   /* LDM/STM */
    for (int i = 0; i < 64; i++) h ^= copy_dst[i] << (i & 7);
    return h;
}

typedef u32 (*op_fn)(u32, u32);
__attribute__((noinline)) static u32 op_add(u32 a, u32 b) { return a + b; }
__attribute__((noinline)) static u32 op_xor(u32 a, u32 b) { return a ^ b; }
__attribute__((noinline, target("thumb"))) static u32 op_sub_thumb(u32 a, u32 b) { return a - b * 3; }
__attribute__((noinline)) static u32 op_mul(u32 a, u32 b) { return a * (b | 1); }
static op_fn const ops[4] = { op_add, op_xor, op_sub_thumb, op_mul };   /* BX / BLX between ARM and THUMB */

__attribute__((noinline)) static u32 jump_table(u32 h, u32 k)
{
    switch (k & 7)
    {
    case 0: return h + 1;
    case 1: return h * 3;
    case 2: return h ^ 0x55AA55AAu;
    case 3: return h >> 3;
    case 4: return h << 5;
    case 5: return ~h;
    case 6: return h - 0x1234567u;
    default: return h ^ (h >> 16);
    }
}

__attribute__((noinline)) static u32 fib(u32 n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

/* THUMB code that calls: BL to THUMB, BLX to ARM, and THUMB recursion. The JIT merges
   each THUMB BL/BLX pair into one instruction (a bug there hung real games). */
__attribute__((noinline, target("thumb"))) static u32 fib_thumb(u32 n) { return n < 2 ? n : fib_thumb(n - 1) + fib_thumb(n - 2); }
__attribute__((noinline, target("thumb"))) static u32 thumb_caller(u32 h, u32 x)
{
    h = mix_thumb(h, x);          /* BL  THUMB → THUMB */
    h = op_sub_thumb(h, x);
    h = mix_arm(h, x);            /* BLX THUMB → ARM */
    h ^= multiplies(h, x + 7);
    return h + fib_thumb(6);
}

/* Self-modifying code, like a game loading an overlay over old code: two tiny ARM
   functions are written alternately into the same RAM and called. A JIT that kept a
   stale block would keep running the old one and the checksum would differ. */
static u32 code_buf[4] __attribute__((aligned(32)));
static const u32 code_add[2] = { 0xE0800001u, 0xE12FFF1Eu };   /* add r0, r0, r1 ; bx lr */
static const u32 code_eor[2] = { 0xE0200001u, 0xE12FFF1Eu };   /* eor r0, r0, r1 ; bx lr */
__attribute__((noinline)) static u32 self_modifying(u32 h, u32 round)
{
    for (int v = 0; v < 4; v++)
    {
        const u32* src = ((v + round) & 1) ? code_eor : code_add;
        volatile u32* dst = code_buf;
        dst[0] = src[0]; dst[1] = src[1];
        u32 (*fn)(u32, u32) = (u32 (*)(u32, u32))(void*)code_buf;
        for (u32 i = 0; i < 16; i++) h = fn(h, i * 0x01010101u + v);
    }
    return h;
}

__attribute__((noinline)) static u32 round_work(u32 round)
{
    u32 h = 0x811C9DC5u ^ round;
    h = mix_thumb(h, memory(round * 2654435761u));
    for (u32 i = 0; i < 200; i++)
    {
        h = ops[(h >> 3) & 3](h, i);
        h = jump_table(h, h >> 11);
        h ^= multiplies(h, i * 0x10001u + round);
        h = mix_arm(h, i);
        h = thumb_caller(h, i ^ round);
    }
    h += fib(12 + (round & 3));
    h = self_modifying(h, round);
    return h;
}

static void draw_round(u32 round, u32 h)
{
    /* 32 bits as 32 squares of 7x3 pixels, one row per round */
    for (int bit = 0; bit < 32; bit++)
    {
        u16 color = (h >> bit) & 1 ? 0x7FFF : (u16)(0x0010 + (bit << 10));
        for (int y = 0; y < 3; y++)
            for (int x = 0; x < 7; x++)
                VRAM[(round * 4 + y) * 256 + bit * 8 + x] = color;
    }
}

static void wait_vcount_zero(void)
{
    while (REG16(0x04000006) != 0) {}    /* idle loop: nothing changes until VCOUNT does */
}

int main9(void)
{
    REG32(0x04000304) = 0x8003;           /* POWCNT1: LCD + 2D engine A, engine A on the top screen */
    REG16(0x04000240) = 0x80;             /* VRAMCNT_A: on, LCDC mode (0x06800000) */
    REG32(0x04000000) = 0x00020000;       /* DISPCNT: display mode 2, VRAM A */
    for (int i = 0; i < 256 * 192; i++) VRAM[i] = 0;

    for (u32 round = 0; round < ROUNDS; round++)
    {
        draw_round(round, round_work(round));
        wait_vcount_zero();
    }
    /* done: a green bar, then keep the CPU busy forever for speed tests */
    for (int i = 0; i < 256 * 2; i++) VRAM[190 * 256 + i] = 0x03E0;
    volatile u32 sink = 0;
    for (u32 round = ROUNDS;; round++) sink += round_work(round);
    return 0;
}
