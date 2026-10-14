    .section .text.start
    .global _start
    .arm
_start:
    ldr sp, =0x027FF000
    bl main
1:  b 1b
