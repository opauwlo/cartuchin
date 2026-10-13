    .section .text.start, "ax"
    .arm
    .global _start
_start:
    msr cpsr_c, #0xDF
    ldr sp, =0x0380FF00
    bl main7
1:  b 1b
