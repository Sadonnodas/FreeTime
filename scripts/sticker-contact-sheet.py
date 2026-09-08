"""
Lay every sticker out on a numbered grid, so the way each dinosaur is FACING
can be read off in one look.

    python3 scripts/sticker-contact-sheet.py

Writes facing-0.png / facing-1.png next to itself. Nothing in the pixels or the
file names says which end the head is — several are drawn face-on, a few curl
their necks right round, one is upside down — so `Sticker.faces` in
src/lib/stickers.ts is a person's call per picture, and this is how the call
gets made without opening fifty-two files one at a time.

It matters because the walk-through-a-row animation on Today uses `faces` to
send each animal forwards rather than backwards. A sticker added without one
moonwalks, and a test in stickers.test.ts fails to stop exactly that.
"""

from PIL import Image, ImageDraw
from pathlib import Path
import re
import math

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent

CELL = 300
COLS, ROWS = 5, 6
PER = COLS * ROWS


def main() -> None:
    ids = re.findall(r'\{ id: "([^"]+)"', (ROOT / "src/lib/stickers.ts").read_text())
    print(f"{len(ids)} stickers")

    for sheet_no in range(math.ceil(len(ids) / PER)):
        chunk = ids[sheet_no * PER : (sheet_no + 1) * PER]
        sheet = Image.new("RGB", (COLS * CELL, ROWS * CELL), (238, 238, 234))
        draw = ImageDraw.Draw(sheet)

        for i, sid in enumerate(chunk):
            im = Image.open(ROOT / "static/dino" / f"{sid}.webp").convert("RGBA")
            im.thumbnail((CELL - 30, CELL - 46))
            cx, cy = (i % COLS) * CELL, (i // COLS) * CELL
            sheet.paste(
                im,
                (cx + (CELL - im.width) // 2, cy + 34 + (CELL - 46 - im.height) // 2),
                im,
            )
            draw.rectangle([cx, cy, cx + CELL - 1, cy + CELL - 1], outline=(180, 180, 175))
            draw.text((cx + 8, cy + 8), str(sheet_no * PER + i), fill=(20, 20, 20))
            # A centre line, so "which side is the head on" is answerable at a
            # glance rather than by measuring.
            draw.line([cx + CELL // 2, cy + 26, cx + CELL // 2, cy + CELL - 4], fill=(210, 120, 120))

        path = OUT / f"facing-{sheet_no}.png"
        sheet.save(path)
        print(f"{path}  {chunk[0]} .. {chunk[-1]}")


if __name__ == "__main__":
    main()
