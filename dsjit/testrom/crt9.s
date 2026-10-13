    .section .text.start, "ax"
    .arm
    .global _start
_start:
    msr cpsr_c, #0xDF          @ system mode, IRQ/FIQ off
    ldr sp, =0x023F0000
    bl main9
1:  b 1b
