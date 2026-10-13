/* ARM7: a small endless computation, so the ARM7 side of the JIT runs too */
typedef unsigned int u32;
int main7(void)
{
    volatile u32 x = 1;
    for (;;) { u32 v = x; for (int i = 0; i < 64; i++) v = v * 1103515245u + 12345u; x = v; }
    return 0;
}
