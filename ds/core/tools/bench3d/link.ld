ENTRY(_start)
SECTIONS {
  . = 0x02000000;
  .text : { *(.text.start) *(.text*) *(.rodata*) }
  .data : { *(.data*) }
  .bss  : { *(.bss*) *(COMMON) }
}
