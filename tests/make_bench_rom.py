"""Builds bench.gba: a tiny GBA program that never sleeps.

It switches the screen to bitmap mode and repaints all 38,400 pixels in an endless
loop, so the emulated CPU and PPU are busy for the whole frame. That makes it a
worst-case, input-free, deterministic load for measuring how fast a device emulates.
"""
import struct, sys

ARM = [
    0xE3A00301,  # mov  r0, #0x04000000      ; I/O base
    0xE3A01B01,  # mov  r1, #0x400           ; BG2 on
    0xE3811003,  # orr  r1, r1, #3           ; mode 3 (bitmap)
    0xE1C010B0,  # strh r1, [r0]             ; DISPCNT
    0xE3A03000,  # mov  r3, #0               ; colour
    0xE3A04406,  # outer: mov r4, #0x06000000 ; VRAM
    0xE3A05C96,  # mov  r5, #0x9600          ; 240*160 pixels
    0xE0C430B2,  # inner: strh r3, [r4], #2
    0xE2833001,  # add  r3, r3, #1
    0xE2555001,  # subs r5, r5, #1
    0x1AFFFFFB,  # bne  inner
    0xEAFFFFF8,  # b    outer
]

rom = bytearray(0x10000)
struct.pack_into("<I", rom, 0, 0xEA00002E)            # b 0xC0
rom[0xA0:0xAC] = b"CARTUCHINBCH"
rom[0xAC:0xB0] = b"ZBCH"
rom[0xB0:0xB2] = b"00"
rom[0xB2] = 0x96
rom[0xBD] = (-(sum(rom[0xA0:0xBD]) + 0x19)) & 0xFF
for i, w in enumerate(ARM):
    struct.pack_into("<I", rom, 0xC0 + 4 * i, w)
open(sys.argv[1] if len(sys.argv) > 1 else "bench.gba", "wb").write(rom)
