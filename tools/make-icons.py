#!/usr/bin/env python3
"""
Generate the app icons.

Kept as a script rather than four checked-in binaries nobody can edit: the icon
is derived from the app's own palette, and when that palette moves the icons
should be regenerable rather than redrawn by hand.

    python3 tools/make-icons.py

THE DESIGN. The one image this app has is the round Free Time button — an
amber-to-pink orb glowing on near-black — so that is the icon. It reads as a
low sun, which is what free time looks like, and on a home screen full of blue
and white squares a warm glowing circle is unmistakable at 60 pixels. No
lettering: type at icon size turns to mush, and a monogram would say nothing
that the colour does not.
"""

from PIL import Image, ImageDraw, ImageChops

OUT = "static/icons"

INK = (8, 8, 10)          # --color-ink-950
AMBER = (255, 179, 64)    # a shade up from --color-accent, so the top edge lifts
PINK = (255, 100, 130)    # --color-accent-2
GLOW = (255, 122, 60)     # the same warmth as .btn-hero's shadow

# Rendered this many times larger and scaled down, which is what keeps the
# circle's edge clean without any explicit anti-aliasing.
SUPERSAMPLE = 4


def diagonal_gradient(size: int, c0, c1) -> Image.Image:
    """Top-left to bottom-right, matching the 135deg of .btn-hero."""
    small = 64
    img = Image.new("RGB", (small, small))
    px = img.load()
    for y in range(small):
        for x in range(small):
            t = (x + y) / (2 * small - 2)
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
    # Gradients are smooth, so upscaling a small one costs nothing visible.
    return img.resize((size, size), Image.BICUBIC)


def render(size: int, orb_ratio: float) -> Image.Image:
    n = size * SUPERSAMPLE
    img = Image.new("RGB", (n, n), INK)

    # The bloom. Squaring the falloff keeps it close to the orb instead of
    # washing the whole tile, which at small sizes reads as a smudge.
    gd = int(n * 0.95)
    glow = ImageChops.invert(Image.radial_gradient("L").resize((gd, gd), Image.LANCZOS))
    glow = glow.point(lambda v: int((v / 255) ** 2.4 * 165))
    img.paste(Image.new("RGB", (gd, gd), GLOW), ((n - gd) // 2, (n - gd) // 2), glow)

    # The orb.
    d = int(n * orb_ratio)
    orb = diagonal_gradient(d, AMBER, PINK)
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)
    img.paste(orb, ((n - d) // 2, (n - d) // 2), mask)

    # A highlight across the top third. The same trick as the cards' inset top
    # edge: it stops a flat disc reading as a sticker.
    sheen = Image.new("L", (d, d), 0)
    sp = sheen.load()
    for y in range(d):
        t = y / d
        sp[0, y] = int(max(0.0, 1 - t / 0.45) ** 2 * 64)
    sheen = sheen.resize((d, d))
    for y in range(d):
        v = sp[0, y]
        for x in range(d):
            sp[x, y] = v
    sheen = ImageChops.multiply(sheen, mask)
    img.paste(Image.new("RGB", (d, d), (255, 255, 255)), ((n - d) // 2, (n - d) // 2), sheen)

    return img.resize((size, size), Image.LANCZOS)


# A maskable icon is cropped to a circle of 80% width by Android, so its orb is
# smaller to stay clear of the cut. Everything else is full-bleed: iOS applies
# its own squircle and dislikes transparency, so the dark ground runs to the edge.
# The orb is larger than it first looks right at full size, because a home
# screen shows it at 60 pixels among other icons whose artwork runs edge to
# edge. At 0.60 it read as a timid dot in a dark square; 0.70 has presence
# without crowding the corners the squircle cuts off anyway.
TARGETS = [
    ("icon-192.png", 192, 0.70),
    ("icon-512.png", 512, 0.70),
    ("apple-touch-icon.png", 180, 0.70),
    # Android crops a maskable icon to a circle 80% of the width, so this one
    # stays inside that and loses the corners rather than the sun.
    ("icon-512-maskable.png", 512, 0.56),
]

for name, size, ratio in TARGETS:
    render(size, ratio).save(f"{OUT}/{name}", "PNG", optimize=True)
    print(f"{OUT}/{name}  {size}x{size}")
