#!/usr/bin/env python3
"""
Generate the app icons from the sauropod, plus a smile and a thought cloud.

    python3 tools/make-icons.py

macOS only: it rasterises SVG with `qlmanage` (QuickLook), because nothing else
on this machine can. If this ever needs to run elsewhere, swap that one call for
rsvg-convert or cairosvg — everything around it is portable.

THE ARTWORK. scripts/sauropod.svg is Twemoji's sauropod, which is CC-BY 4.0 and
credited in the README. Using it rather than a hand-drawn one is a deliberate
admission: bezier curves written blind make passable geometry and bad animals,
and four attempts at drawing a cute dinosaur by hand proved it. The smile, the
cloud, the trail and the composition are ours; the dinosaur is theirs.

WHY A MASCOT AT ALL. It is the one icon nobody else can have. It also gives the
app a character for its empty states, which is worth more than the icon.
"""

import io, os, re, subprocess, sys, tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "sauropod.svg")
OUT = os.path.join(ROOT, "static", "icons")

INK = "#08080a"          # --color-ink-950
GLOW = "#ff7a3c"         # the warmth of .btn-hero's shadow
CLOUD = "#fdf6e3"
BULB = "#ffc861"

# The dinosaur lives on a 36x36 grid, facing right: eye at (12.37, 2.18), muzzle
# front near x=16.2, back and tail filling the lower right. That leaves an empty
# pocket above its back, which is exactly where a thought belongs — no
# rearranging needed. Everything below is placed in those units.
SMILE = ('<path d="M14.45 3.75c.5.62 1.18.66 1.72.15" fill="none" stroke="#2f5a15"'
         ' stroke-width=".42" stroke-linecap="round"/>')

# Overlapping circles read as a cloud at every size; a traced outline does not.
CLOUD_PUFFS = (f'<g fill="{CLOUD}">'
               '<circle cx="24.2" cy="5.6" r="3.5"/><circle cx="28.4" cy="4.7" r="4.3"/>'
               '<circle cx="32.2" cy="6.0" r="3.1"/><circle cx="27.0" cy="7.8" r="3.4"/>'
               '<circle cx="30.9" cy="8.0" r="2.7"/></g>')

# Set well clear of the cloud's outermost puff, which starts at x=20.7. Any
# closer and they merge into it, and the thought stops reading as a thought.
TRAIL = (f'<g fill="{CLOUD}">'
         '<circle cx="17.3" cy="6.1" r=".8"/><circle cx="19.1" cy="4.9" r="1.2"/></g>')

IDEA = (f'<g><circle cx="28.3" cy="5.3" r="1.85" fill="{BULB}"/>'
        f'<rect x="27.55" y="6.85" width="1.5" height="1" rx=".35" fill="{BULB}"/>'
        '<rect x="27.75" y="7.7" width="1.1" height=".42" rx=".2" fill="#c98a2e"/>'
        f'<g stroke="{BULB}" stroke-width=".38" stroke-linecap="round">'
        '<path d="M28.3 2.5v.7"/><path d="M25.5 4.1l.5.5"/><path d="M31.1 4.1l-.5.5"/></g></g>')


def dino_markup() -> str:
    raw = io.open(SRC, encoding="utf-8").read()
    inner = raw[raw.index(">", raw.index("<svg")) + 1 : raw.rindex("</svg>")]
    return re.sub(r"<title[^>]*>.*?</title>", "", inner, flags=re.S)


def compose(pad: float) -> str:
    """`pad` is the margin in 512-space. The artwork spans x 2-35, y 0-36."""
    scale = (512 - 2 * pad) / 36.0
    dx, dy = pad - 2.0 * scale, pad
    art = (f'<g transform="translate({dx:.2f} {dy:.2f}) scale({scale:.4f})">'
           f"{dino_markup()}{SMILE}{CLOUD_PUFFS}{TRAIL}{IDEA}</g>")
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"'
            ' viewBox="0 0 512 512">'
            f'<defs><radialGradient id="bg"><stop offset="0" stop-color="{GLOW}"'
            ' stop-opacity=".55"/>'
            f'<stop offset="1" stop-color="{GLOW}" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="512" height="512" fill="{INK}"/>'
            f'<circle cx="256" cy="266" r="250" fill="url(#bg)"/>{art}</svg>')


def rasterise(svg: str) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "icon.svg")
        io.open(path, "w", encoding="utf-8").write(svg)
        subprocess.run(["qlmanage", "-t", "-s", "1024", "-o", tmp, path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        png = path + ".png"
        if not os.path.exists(png):
            sys.exit("qlmanage produced nothing — is this macOS?")
        return Image.open(png).convert("RGB")


# Android crops a maskable icon to a circle 80% of the width, and this animal is
# wide — its tail and feet reach the extremities. So that one gets far more
# margin and loses empty ground rather than a foot.
TARGETS = [
    ("icon-192.png", 192, 56),
    ("icon-512.png", 512, 56),
    ("apple-touch-icon.png", 180, 56),
    ("icon-512-maskable.png", 512, 104),
]

for name, size, pad in TARGETS:
    rasterise(compose(pad)).resize((size, size), Image.LANCZOS).save(
        os.path.join(OUT, name), "PNG", optimize=True)
    print(f"static/icons/{name}  {size}x{size}")

# The favicon stays vector: it is drawn at 16px in a tab, where a downscaled
# photo of a dinosaur turns to mud but a shape does not.
fav = compose(56).replace('width="1024" height="1024" ', "")
io.open(os.path.join(ROOT, "static", "favicon.svg"), "w", encoding="utf-8").write(fav)
print("static/favicon.svg")
