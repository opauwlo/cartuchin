#!/usr/bin/env python3
"""Empacota um binário ARM9 (carregado em 0x02000000) num .nds com ARM7 parado.
uso: make_bench_rom.py arm9.bin saida.nds"""
import struct, sys
arm9 = open(sys.argv[1], 'rb').read()
B_SELF = struct.pack('<I', 0xEAFFFFFE)
arm7 = B_SELF
ARM7_AT = 0x200 + ((len(arm9) + 0x1FF) & ~0x1FF)
size = ARM7_AT + 0x200
size = max(0x8000, (size + 0x7FFF) & ~0x7FFF)
rom = bytearray(size)
rom[0:12] = b'BENCH3D\0\0\0\0\0'
rom[0x0C:0x10] = b'B3DT'
rom[0x10:0x12] = b'00'
rom[0xC0:0xC4] = bytes([0x24, 0xFF, 0xAE, 0x51])
struct.pack_into('<IIII', rom, 0x20, 0x200, 0x02000000, 0x02000000, len(arm9))
struct.pack_into('<IIII', rom, 0x30, ARM7_AT, 0x02380000, 0x02380000, len(arm7))
struct.pack_into('<II', rom, 0x80, len(rom), 0x4000)
rom[0x200:0x200 + len(arm9)] = arm9
rom[ARM7_AT:ARM7_AT + len(arm7)] = arm7
open(sys.argv[2], 'wb').write(rom)
print(f'{sys.argv[2]}: {len(rom)} bytes (arm9 {len(arm9)})')
