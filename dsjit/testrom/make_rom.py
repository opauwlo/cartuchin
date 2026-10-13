# Packs arm9.bin and arm7.bin into a .nds that melonDS boots directly.
import struct, sys
def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc
arm9 = open("arm9.bin", "rb").read(); arm7 = open("arm7.bin", "rb").read()
pad = lambda b: b + b"\0" * (-len(b) % 0x200)
arm9, arm7 = pad(arm9), pad(arm7)
off9 = 0x200; off7 = off9 + len(arm9)   # below 0x4000: homebrew, no secure area handling
total = off7 + len(arm7)
h = bytearray(0x200)
h[0:12] = b"CPUTORTURE\0\0"; h[12:16] = b"CTJT"; h[16:18] = b"00"
struct.pack_into("<IIII", h, 0x20, off9, 0x02000000, 0x02000000, len(arm9))
struct.pack_into("<IIII", h, 0x30, off7, 0x037F8000, 0x037F8000, len(arm7))
struct.pack_into("<I", h, 0x80, total); struct.pack_into("<I", h, 0x84, 0x4000)
logo = bytes.fromhex("24FFAE51699AA2213D84820A84E409AD11248B98C0817F21A352BE199309CE2010464A4AF82731EC58C7E83382E3CEBF85F4DF94CE4B09C194568AC01372A7FC9F844D73A3CA9A615897A327FC039876231DC7610304AE56BF38840040A70EFDFF52FE036F9530F197FBC08560D68025A963BE03014E38E2F9A234FFBB3E0344780090CB88113A9465C07C6387F03CAFD625E48B380AAC7221D4F807")
h[0xC0:0xC0 + len(logo)] = logo
struct.pack_into("<H", h, 0x15C, crc16(logo)); struct.pack_into("<H", h, 0x15E, crc16(h[0:0x15E]))
rom = bytearray(total); rom[0:0x200] = h; rom[off9:off9 + len(arm9)] = arm9; rom[off7:off7 + len(arm7)] = arm7
open(sys.argv[1], "wb").write(rom)
print("rom", sys.argv[1], len(rom), "bytes")
