#!/usr/bin/env python3
"""Gera tone.nds: ROM homebrew mínima (ARM7 toca um tom PSG de ~440 Hz no
canal 8, ARM9 fica em loop). Serve para testar o caminho de áudio do core
sem precisar de nenhum jogo comercial."""
import struct, sys
def ldr_pc(rd, insn_addr, lit_addr):  # LDR rd,[pc,#imm]
    off = lit_addr - (insn_addr + 8); assert 0 <= off < 4096
    return 0xE59F0000 | (rd << 12) | off
STRH_R1_R0 = 0xE1C010B0
STR_R1_R0  = 0xE5801000
B_SELF     = 0xEAFFFFFE
pairs = [  # (registrador alvo, valor, tipo de store)
    (0x04000304, 0x0001,     'h'),  # POWCNT2: liga o som
    (0x04000500, 0x807F,     'h'),  # SOUNDCNT: enable + volume master 127
    (0x04000488, 0xED68,     'h'),  # SOUND8TMR: ~440 Hz
    (0x04000480, 0xEC40007F, 'w'),  # SOUND8CNT: start|PSG|loop|duty 50%|pan 64|vol 127
]
ARM7_BASE = 0x02380000
n_insn = len(pairs) * 3 + 1
lits = []
for addr, val, _ in pairs: lits += [addr, val]
lit_base = ARM7_BASE + n_insn * 4
code = []
for i, (addr, val, kind) in enumerate(pairs):
    pc = ARM7_BASE + len(code) * 4
    code.append(ldr_pc(0, pc, lit_base + (2 * i) * 4))
    pc += 4
    code.append(ldr_pc(1, pc, lit_base + (2 * i + 1) * 4))
    code.append(STRH_R1_R0 if kind == 'h' else STR_R1_R0)
code.append(B_SELF)
arm7 = b''.join(struct.pack('<I', w) for w in code + lits)
arm9 = struct.pack('<I', B_SELF)

rom = bytearray(0x8000)
rom[0:12] = b'TONETEST\0\0\0\0'
rom[0x0C:0x10] = b'TONE'
rom[0x10:0x12] = b'00'
rom[0x12] = 0  # unitcode NDS
struct.pack_into('<IIII', rom, 0x20, 0x200, 0x02000000, 0x02000000, len(arm9))
struct.pack_into('<IIII', rom, 0x30, 0x400, ARM7_BASE, ARM7_BASE, len(arm7))
struct.pack_into('<II', rom, 0x80, len(rom), 0x4000)
rom[0x200:0x200 + len(arm9)] = arm9
rom[0x400:0x400 + len(arm7)] = arm7
out = sys.argv[1] if len(sys.argv) > 1 else 'tone.nds'
open(out, 'wb').write(rom)
print(f'{out}: {len(rom)} bytes, arm7 {len(arm7)} bytes')
