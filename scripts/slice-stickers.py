#!/usr/bin/env python3
"""
Cut a sticker sheet into individual dinosaurs.

The sheets arrive as one flat image of a dozen stickers on cream paper, which
is unusable in the app: every dinosaur would carry a rectangle of someone
else's background, and on a dark surface that rectangle is a glowing slab.

So: find each sticker, crop it, and knock the paper out from behind it.

WHY THE TRANSPARENCY IS A FLOOD FILL AND NOT A COLOUR KEY
    Keying out "everything near-white" also removes the astronaut's suit, the
    whites of the eyes and every highlight, because those are the same colour
    as the paper. Filling inward from the border instead only reaches paper
    that is actually outside the drawing, so enclosed white survives.

Needs Pillow and numpy, both already used by make-icons.py. No scipy: the
dilation is four numpy shifts and the labelling is a breadth-first walk over a
downsampled grid, which is quick enough on sheets this size.

    python3 scripts/slice-stickers.py art/sheets/*.png

Writes static/dino/<sheet>-<n>.webp plus a contact sheet at
art/contact-<sheet>.png for naming them afterwards.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "dino"
CONTACT = ROOT / "art"

# How far a pixel must sit from the paper colour to count as ink. Low, because
# the drawings have pale washes (the moon's grey, the sky's near-white blue)
# that must not be mistaken for background.
INK = 26

# Coarse grid used for finding the stickers. One cell per 6px is plenty to
# separate a dozen stickers on an A4-ish sheet and makes the walk instant.
CELL = 6

# Cells of slack when merging. A sticker is often several disconnected pieces —
# the dinosaur, the rainbow it is standing beside, a scatter of music notes —
# and they belong to one another. Too large and neighbouring stickers fuse;
# 5 cells (~30px) was the widest that kept a 3-across sheet separated.
GROW = 5

# Discard specks: the page number, JPEG rubbish, a stray dot of the title.
MIN_CELLS = 260

TARGET_H = 360  # tall enough for a project cover, small enough to stay ~15KB


def paper_colour(rgb: np.ndarray) -> np.ndarray:
    """The most common colour in a border strip, which is all background."""
    edge = np.concatenate(
        [rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
         rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)]
    )
    packed = (edge[:, 0].astype(np.int32) << 16) | (edge[:, 1].astype(np.int32) << 8) | edge[:, 2]
    common = np.bincount(packed).argmax()
    return np.array([(common >> 16) & 255, (common >> 8) & 255, common & 255], dtype=np.int16)


def ink_mask(rgb: np.ndarray, paper: np.ndarray) -> np.ndarray:
    return np.abs(rgb.astype(np.int16) - paper).max(axis=2) > INK


def grow(mask: np.ndarray, radius: int) -> np.ndarray:
    """Square dilation, done as repeated shifts so scipy is not needed."""
    out = mask
    for _ in range(radius):
        padded = np.pad(out, 1, constant_values=False)
        out = (
            padded[1:-1, 1:-1] | padded[:-2, 1:-1] | padded[2:, 1:-1]
            | padded[1:-1, :-2] | padded[1:-1, 2:]
        )
    return out


def components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """(top, left, bottom, right, cells) for each blob, largest first."""
    seen = np.zeros_like(mask, dtype=bool)
    h, w = mask.shape
    found = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            queue = deque([(y0, x0)])
            seen[y0, x0] = True
            top = bottom = y0
            left = right = x0
            cells = 0
            while queue:
                y, x = queue.popleft()
                cells += 1
                top, bottom = min(top, y), max(bottom, y)
                left, right = min(left, x), max(right, x)
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            found.append((top, left, bottom, right, cells))
    return sorted(found, key=lambda c: -c[4])


def not_a_sticker(box: tuple[int, int, int, int, int], grid: tuple[int, int]) -> bool:
    """Reject the sheet's caption and anything else shaped like a line of text.

    The first version measured the caption's distance from the top against the
    grid's WIDTH, so on a portrait sheet the test was ~40% down the page and
    the title sailed through — it came out as a 4474x360 "sticker". Hence two
    independent guards: where it sits, and a bare aspect ratio that no drawing
    of an animal ever hits.
    """
    top, left, bottom, right, _ = box
    grid_h, grid_w = grid
    width = right - left + 1
    height = bottom - top + 1
    if width > height * 3.5 or height > width * 3.5:
        return True
    return top < grid_h * 0.06 and width > grid_w * 0.3 and height < width * 0.3


def cut_out(sheet: Image.Image, paper: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    """Crop, then flood the paper away from the outside only."""
    crop = sheet.crop(box).convert("RGBA")
    rgb = np.array(crop)[:, :, :3]
    h, w = rgb.shape[:2]

    # A looser threshold here than for finding: anti-aliased paper next to an
    # outline sits between the two colours, and leaving it opaque draws a pale
    # halo round every sticker.
    background = np.abs(rgb.astype(np.int16) - paper).max(axis=2) <= INK + 16

    outside = np.zeros((h, w), dtype=bool)
    queue = deque()
    for y in range(h):
        for x in (0, w - 1):
            if background[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if background[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and background[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                queue.append((ny, nx))

    out = np.array(crop)
    out[:, :, 3] = np.where(outside, 0, 255)
    trimmed = Image.fromarray(out)
    return trimmed.crop(trimmed.getbbox() or (0, 0, w, h))


def slice_sheet(path: Path) -> list[Path]:
    sheet = Image.open(path).convert("RGB")
    rgb = np.array(sheet)
    paper = paper_colour(rgb)

    mask = ink_mask(rgb, paper)
    coarse = mask[: mask.shape[0] // CELL * CELL, : mask.shape[1] // CELL * CELL]
    coarse = coarse.reshape(coarse.shape[0] // CELL, CELL, -1, CELL).any(axis=(1, 3))

    boxes = [
        b for b in components(grow(coarse, GROW))
        if b[4] >= MIN_CELLS and not not_a_sticker(b, coarse.shape)
    ]
    # Reading order, so the contact sheet matches the original page.
    boxes.sort(key=lambda b: (round(b[0] / (coarse.shape[0] / 12)), b[1]))

    OUT.mkdir(parents=True, exist_ok=True)
    CONTACT.mkdir(parents=True, exist_ok=True)
    stem = path.stem.lower().replace(" ", "-")
    written = []
    tiles = []

    for n, (top, left, bottom, right, _) in enumerate(boxes, start=1):
        pad = GROW * CELL
        box = (
            max(0, left * CELL - pad),
            max(0, top * CELL - pad),
            min(sheet.width, (right + 1) * CELL + pad),
            min(sheet.height, (bottom + 1) * CELL + pad),
        )
        art = cut_out(sheet, paper, box)
        # Never enlarge. A sheet exported at screen size gives stickers around
        # 230px tall, and stretching those to 360 buys nothing but soft edges
        # and a bigger file — better a small sharp sticker than a large blurry
        # one. Export the sheets as large as they come.
        scale = min(1.0, TARGET_H / art.height)
        if scale < 1.0:
            art = art.resize((max(1, round(art.width * scale)), TARGET_H), Image.LANCZOS)

        dest = OUT / f"{stem}-{n:02d}.webp"
        art.save(dest, "WEBP", quality=82, method=6)
        written.append(dest)
        tiles.append(art)

    if tiles:
        cols = 4
        cw = max(t.width for t in tiles) + 16
        rows = (len(tiles) + cols - 1) // cols
        board = Image.new("RGB", (cols * cw, rows * (TARGET_H + 30)), (255, 255, 255))
        for i, tile in enumerate(tiles):
            x = (i % cols) * cw + (cw - tile.width) // 2
            y = (i // cols) * (TARGET_H + 30)
            board.paste(tile, (x, y), tile)
        board.save(CONTACT / f"contact-{stem}.png")

    return written


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        path = Path(arg)
        if not path.exists():
            print(f"missing: {path}")
            continue
        made = slice_sheet(path)
        total = sum(p.stat().st_size for p in made)
        print(f"{path.name}: {len(made)} stickers, {total // 1024} KB")


if __name__ == "__main__":
    main()
