"""Builds db/<system>.json from the No-Intro DATs in libretro-database and the box-art
file lists of libretro-thumbnails. Each file maps a ROM's CRC32 to its official name,
and tells whether a box art exists for it on thumbnails.libretro.com."""
import json, re, sys, pathlib

S = pathlib.Path(sys.argv[1])           # scratchpad with lrdb/ and boxarts_*.txt
OUT = pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
SYSTEMS = {
    "gba": ("Nintendo - Game Boy Advance", "Nintendo_-_Game_Boy_Advance"),
    "gb": ("Nintendo - Game Boy", "Nintendo_-_Game_Boy"),
    "gbc": ("Nintendo - Game Boy Color", "Nintendo_-_Game_Boy_Color"),
}
thumb = lambda n: re.sub(r'[&*/:`<>?\\|"]', "_", n)
for key, (dat_name, thumb_repo) in SYSTEMS.items():
    dat = (S / "lrdb/metadat/no-intro" / (dat_name + ".dat")).read_text(errors="replace")
    arts = set((S / f"boxarts_{thumb_repo}.txt").read_text().splitlines())
    names, art, crc = [], [], {}
    for block in re.findall(r'game \((.*?)\n\)', dat, re.S):
        m = re.search(r'\n\s*name "(.*?)"', "\n" + block)
        c = re.search(r'crc ([0-9A-Fa-f]{8})', block)
        if not m or not c: continue
        n = m.group(1)
        i = len(names); names.append(n); art.append(1 if thumb(n) in arts else 0)
        crc[c.group(1).upper()] = i
    hacks = sorted(a for a in arts if "(Hack)" in a)
    data = {"dir": dat_name, "names": names, "art": "".join(map(str, art)), "crc": crc, "hacks": hacks}
    (OUT / f"{key}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(key, len(names), "jogos,", sum(art), "com capa,", len(hacks), "hacks com capa,", (OUT / f"{key}.json").stat().st_size // 1024, "KB")
