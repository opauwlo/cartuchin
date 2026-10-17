"""Builds the GBA ROM of the automated test (tests/gba-e2e.mjs).

An endless loop that reads the buttons (KEYINPUT) and:
  - paints the screen red, plus the pressed buttons as green/blue (so a press shows),
  - paints the first row with a counter (the picture changes every frame),
  - writes the pressed buttons to SRAM (so the game has a save that changes).
"SRAM_V113" in the ROM makes the emulator give it battery SRAM.
Source (armv4t): see the comments; assembled with clang --target=armv4t-none-eabi.
"""
import struct, sys

ARM = [
    0xE3A00301,  # mov  r0, #0x04000000        ; I/O
    0xE3A01B01,  # mov  r1, #0x400              ; BG2
    0xE3811003,  # orr  r1, r1, #3              ; mode 3
    0xE1C010B0,  # strh r1, [r0]                ; DISPCNT
    0xE3A0640E,  # mov  r6, #0x0E000000         ; SRAM
    0xE3A03000,  # mov  r3, #0                  ; counter
    0xE2809C01,  # outer: add r9, r0, #0x100
    0xE1D923B0,  # ldrh r2, [r9, #0x30]         ; KEYINPUT (0 = pressed)
    0xE1E02002,  # mvn  r2, r2
    0xE20220FF,  # and  r2, r2, #0xFF
    0xE5C62000,  # strb r2, [r6]                ; save = buttons
    0xE2833001,  # add  r3, r3, #1
    0xE1A07282,  # mov  r7, r2, lsl #5
    0xE387701F,  # orr  r7, r7, #0x1F           ; red + buttons
    0xE3A04406,  # mov  r4, #0x06000000         ; VRAM
    0xE3A05C96,  # mov  r5, #0x9600
    0xE24550F0,  # sub  r5, r5, #240
    0xE3A080F0,  # mov  r8, #240
    0xE0C430B2,  # row0: strh r3, [r4], #2
    0xE2588001,  # subs r8, r8, #1
    0x1AFFFFFC,  # bne  row0
    0xE0C470B2,  # fill: strh r7, [r4], #2
    0xE2555001,  # subs r5, r5, #1
    0x1AFFFFFC,  # bne  fill
    0xEAFFFFEC,  # b    outer
]

rom = bytearray(0x10000)
struct.pack_into("<I", rom, 0, 0xEA00002E)            # b 0xC0
rom[0xA0:0xAC] = b"CARTUCHINTST"
rom[0xAC:0xB0] = b"ZTST"
rom[0xB0:0xB2] = b"00"
rom[0xB2] = 0x96
rom[0xBD] = (-(sum(rom[0xA0:0xBD]) + 0x19)) & 0xFF
for i, w in enumerate(ARM):
    struct.pack_into("<I", rom, 0xC0 + 4 * i, w)
rom[0x400:0x40C] = b"SRAM_V113\0\0\0"
open(sys.argv[1] if len(sys.argv) > 1 else "gba-test.gba", "wb").write(rom)
