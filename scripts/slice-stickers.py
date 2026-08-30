#!/usr/bin/env python3
"""
Cut a sticker sheet into individual dinosaurs.

The sheets arrive as one flat image of a dozen or so stickers on cream paper,
which is unusable in the app: every dinosaur would carry a rectangle of
someone else's background, and on a dark surface that rectangle is a glowing
slab. So: find each sticker, crop it, and knock the paper out from behind it.

Three things here were arrived at by looking at the output, not by reasoning:

WHY THE PIECES ARE ADOPTED RATHER THAN DILATED TOGETHER
    A sticker is often several disconnected pieces - the dinosaur, the rainbow
    beside it, a scatter of music notes. The obvious way to join them is to
    dilate until they touch, but these sheets are packed tightly enough that a
    radius large enough to catch a dinosaur's own rainbow also welds it to its
    neighbour: going from 2 cells to 3 collapsed fifteen stickers into one.
    Pieces are found undilated, and small ones are adopted by the large one
    they sit nearest.

WHY THE CROP IS MASKED TO ITS OWN COMPONENT
    A bounding box is a rectangle and the art is not, so a crop that is
    correct still catches the corner of whatever sits next to it - a
    stegosaurus wing behind the pterodactyl, the page number, the printed
    border round the sheet. Everything not connected to this sticker's own ink
    is dropped, so a neighbour cannot ride along.

WHY THE TRANSPARENCY IS A FLOOD FILL AND NOT A COLOUR KEY
    Keying out "everything near-white" also removes the astronaut's suit, the
    whites of the eyes and every highlight, because those are the same colour
    as the paper. Filling inward from the border instead only reaches paper
    that is genuinely outside the drawing, so enclosed white survives.

Needs Pillow and numpy, both already used by make-icons.py.

    python3 scripts/slice-stickers.py art/sheets/*

Writes static/dino/<sheet>-<n>.webp, plus a contact sheet at
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
# the drawings have pale washes - a grey shadow, a near-white sky - that must
# not be mistaken for background. Measured: clean paper on these sheets stays
# within 7 of the modal colour, so 26 is a comfortable margin.
INK = 26

# Cells for the coarse pass that finds and groups the stickers. One per 6px is
# ample to separate a dozen on an A4-ish sheet, and makes the walk instant.
CELL = 6

MAJOR_CELLS = 380   # big enough to be a sticker in its own right
MINOR_CELLS = 40    # below this it is a speck: the page number, a stray dot
ADOPT_GAP = 4       # cells (~24px) a stray piece may sit from its owner
ADOPT_RATIO = 0.55  # and it must be clearly smaller than the owner

# The sheets carry a thin printed frame round the page, and a sticker whose
# prop touches it becomes part of it: the DJ triceratops' turntable ran into
# the border, the two labelled as one component the size of the whole page,
# and the guard against that frame threw the dinosaur out with it. Painting a
# margin back to paper before anything else removes the frame from both the
# finding pass and the cut-out. 2.5% is the narrowest that clears it.
FRAME_MARGIN = 0.025

TARGET_H = 360


def paper_colour(rgb: np.ndarray) -> np.ndarray:
    """The most common colour in a border strip, which is all background."""
    edge = np.concatenate(
        [rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
         rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)]
    )
    packed = (edge[:, 0].astype(np.int32) << 16) | (edge[:, 1].astype(np.int32) << 8) | edge[:, 2]
    common = int(np.bincount(packed).argmax())
    return np.array([(common >> 16) & 255, (common >> 8) & 255, common & 255], dtype=np.int16)


def ink_mask(rgb: np.ndarray, paper: np.ndarray, slack: int = 0) -> np.ndarray:
    return np.abs(rgb.astype(np.int16) - paper).max(axis=2) > INK + slack


def label(mask: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """Label connected cells. Returns the label image and a record per blob."""
    ids = np.full(mask.shape, -1, dtype=np.int32)
    h, w = mask.shape
    blobs: list[dict] = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or ids[y0, x0] >= 0:
                continue
            n = len(blobs)
            queue = deque([(y0, x0)])
            ids[y0, x0] = n
            top = bottom = y0
            left = right = x0
            cells = 0
            while queue:
                y, x = queue.popleft()
                cells += 1
                top, bottom = min(top, y), max(bottom, y)
                left, right = min(left, x), max(right, x)
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and ids[ny, nx] < 0:
                        ids[ny, nx] = n
                        queue.append((ny, nx))
            blobs.append({"box": (top, left, bottom, right), "cells": cells, "ids": [n]})
    return ids, blobs


def rubbish(blob: dict, grid: tuple[int, int]) -> bool:
    """Reject the sheet's caption, its printed border, and lines of text.

    Two independent guards, because each has been fooled on its own. The first
    version measured the caption's distance from the top against the grid's
    WIDTH, so on a portrait sheet the test landed 40% down the page and the
    title sailed through as a 4474x360 "sticker". The border round the sheet
    then came through as a component enclosing the entire page.
    """
    top, left, bottom, right = blob["box"]
    grid_h, grid_w = grid
    width = right - left + 1
    height = bottom - top + 1

    # The printed frame: a component spanning most of the page in both axes.
    if width > grid_w * 0.85 and height > grid_h * 0.85:
        return True
    # A line of text is far thinner than any drawing of an animal.
    if width > height * 3.5 or height > width * 3.5:
        return True
    # The caption, sitting alone across the top.
    if top < grid_h * 0.06 and width > grid_w * 0.3 and height < width * 0.3:
        return True
    # ...and the caption again, once it has broken into separate words. Each
    # word is too small to trip the rules above and too large to be a speck, so
    # "Station" was adopted by the triceratops underneath it and cropped in.
    # Nothing small enough to be a word is ever a sticker up in the caption
    # band; a real sticker there is a major and survives this.
    return bottom < grid_h * 0.08 and blob["cells"] < MAJOR_CELLS


def gap(a: tuple, b: tuple) -> float:
    """Cells between two bounding boxes, 0 if they overlap."""
    dy = max(a[0] - b[2], b[0] - a[2], 0)
    dx = max(a[1] - b[3], b[1] - a[3], 0)
    return (dy * dy + dx * dx) ** 0.5


def adopt(blobs: list[dict]) -> list[dict]:
    """Fold each stray piece into the sticker it belongs to."""
    majors = [dict(b, ids=list(b["ids"])) for b in blobs if b["cells"] >= MAJOR_CELLS]
    minors = [b for b in blobs if MINOR_CELLS <= b["cells"] < MAJOR_CELLS]

    for m in minors:
        near = [
            (gap(m["box"], M["box"]), i) for i, M in enumerate(majors)
            if m["cells"] <= M["cells"] * ADOPT_RATIO and gap(m["box"], M["box"]) <= ADOPT_GAP
        ]
        if not near:
            # Close to nothing: a small sticker standing on its own, like the
            # baby dinosaur that is half the size of everything around it.
            majors.append(dict(m, ids=list(m["ids"])))
            continue
        owner = majors[min(near)[1]]
        t, l, b, r = owner["box"]
        mt, ml, mb, mr = m["box"]
        owner["box"] = (min(t, mt), min(l, ml), max(b, mb), max(r, mr))
        owner["cells"] += m["cells"]
        owner["ids"] += m["ids"]

    return majors


def flood(start: list[tuple[int, int]], passable: np.ndarray) -> np.ndarray:
    """Breadth-first fill through `passable`, from the given seeds."""
    seen = np.zeros_like(passable, dtype=bool)
    h, w = passable.shape
    queue = deque()
    for y, x in start:
        if passable[y, x] and not seen[y, x]:
            seen[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and passable[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen


def cut_out(sheet: Image.Image, paper: np.ndarray, blob: dict, ids: np.ndarray,
            box: tuple[int, int, int, int]) -> Image.Image | None:
    """Crop, keep only this sticker's own ink, then clear the paper behind it."""
    crop = sheet.crop(box).convert("RGBA")
    rgb = np.array(crop)[:, :, :3]
    h, w = rgb.shape[:2]

    # A little slack against the finding threshold: the anti-aliased pixel
    # between an outline and the paper sits between the two colours, and
    # leaving it opaque draws a pale halo round every sticker.
    ink = ink_mask(rgb, paper, slack=-10)

    # Seed from the cells this sticker actually owns, then grow through its own
    # connected ink. A neighbour intruding on the crop is never seeded and is
    # not connected to anything that was, so it does not survive.
    mine = np.zeros(int(ids.max()) + 2, dtype=bool)
    for i in blob["ids"]:
        mine[i] = True

    ys, xs = np.nonzero(ink)
    cy = np.clip((box[1] + ys) // CELL, 0, ids.shape[0] - 1)
    cx = np.clip((box[0] + xs) // CELL, 0, ids.shape[1] - 1)
    owned = mine[np.clip(ids[cy, cx], -1, None)] & (ids[cy, cx] >= 0)
    seeds = list(zip(ys[owned].tolist(), xs[owned].tolist()))
    if not seeds:
        return None
    keep = flood(seeds, ink)

    # Whatever the border can still reach is paper outside the drawing.
    # Everything it cannot reach - the eye whites, the astronaut's suit - is
    # enclosed by an outline and stays.
    border = [(y, x) for y in range(h) for x in (0, w - 1)]
    border += [(y, x) for x in range(w) for y in (0, h - 1)]
    outside = flood(border, ~keep)

    out = np.array(crop)
    out[:, :, 3] = np.where(outside, 0, 255)
    art = Image.fromarray(out)
    bounds = art.getbbox()
    return art.crop(bounds) if bounds else None


def slice_sheet(path: Path) -> list[Path]:
    sheet = Image.open(path).convert("RGB")
    rgb = np.array(sheet)
    paper = paper_colour(rgb)

    band = max(1, int(min(rgb.shape[:2]) * FRAME_MARGIN))
    rgb = rgb.copy()
    rgb[:band] = paper
    rgb[-band:] = paper
    rgb[:, :band] = paper
    rgb[:, -band:] = paper
    sheet = Image.fromarray(rgb)

    mask = ink_mask(rgb, paper)
    coarse = mask[: mask.shape[0] // CELL * CELL, : mask.shape[1] // CELL * CELL]
    coarse = coarse.reshape(coarse.shape[0] // CELL, CELL, -1, CELL).any(axis=(1, 3))

    ids, blobs = label(coarse)
    stickers = adopt([b for b in blobs if not rubbish(b, coarse.shape)])
    # Reading order, so the contact sheet matches the page it came from.
    stickers.sort(key=lambda b: (round(b["box"][0] / (coarse.shape[0] / 12)), b["box"][1]))

    OUT.mkdir(parents=True, exist_ok=True)
    CONTACT.mkdir(parents=True, exist_ok=True)
    stem = path.stem.lower().replace(" ", "-")
    written: list[Path] = []
    tiles: list[Image.Image] = []

    for blob in stickers:
        top, left, bottom, right = blob["box"]
        pad = 2 * CELL
        box = (
            max(0, left * CELL - pad),
            max(0, top * CELL - pad),
            min(sheet.width, (right + 1) * CELL + pad),
            min(sheet.height, (bottom + 1) * CELL + pad),
        )
        art = cut_out(sheet, paper, blob, ids, box)
        if art is None:
            continue

        # Never enlarge. These sheets are phone screenshots, so a sticker is
        # around 230px tall; stretching that to 360 buys nothing but soft edges
        # and a bigger file.
        if art.height > TARGET_H:
            scale = TARGET_H / art.height
            art = art.resize((max(1, round(art.width * scale)), TARGET_H), Image.LANCZOS)

        dest = OUT / f"{stem}-{len(written) + 1:02d}.webp"
        art.save(dest, "WEBP", quality=82, method=6)
        written.append(dest)
        tiles.append(art)

    if tiles:
        cols = 4
        cw = max(t.width for t in tiles) + 24
        ch = max(t.height for t in tiles) + 34
        rows = (len(tiles) + cols - 1) // cols
        board = Image.new("RGB", (cols * cw, rows * ch), (255, 255, 255))
        for i, tile in enumerate(tiles):
            x = (i % cols) * cw + (cw - tile.width) // 2
            y = (i // cols) * ch + (ch - tile.height) // 2
            board.paste(tile, (x, y), tile)
        board.save(CONTACT / f"contact-{stem}.png")

    return written


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        path = Path(arg)
        if not path.exists() or path.name == ".DS_Store":
            continue
        made = slice_sheet(path)
        total = sum(p.stat().st_size for p in made)
        print(f"{path.name}: {len(made)} stickers, {total // 1024} KB")


if __name__ == "__main__":
    main()
