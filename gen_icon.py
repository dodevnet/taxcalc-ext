#!/usr/bin/env python3
"""Generate toolbar icons for the tax calculator browser extension.

Produces three PNGs (16x16, 48x48, 128x128) with a bright "tax red" rounded
square background and a centered, bold white "¥" (yen / yuan) symbol.

Design goals:
  * Background: rounded square filled with a vivid tax red (#E63946).
  * Symbol: white, bold "¥", ~60% of the canvas height, legible even at 16px.
  * Light inner stroke for a subtle sense of depth; flat and clean otherwise.

Renders the "¥" with a TrueType font when available, falling back to a
hand-drawn line version of the symbol if no usable font is found.
"""

import os

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SIZES = (16, 48, 128)

# Vivid "tax red" background and a slightly darker shade for the inner stroke.
RED_FILL = (0xE6, 0x39, 0x46, 255)        # #E63946 - bright, eye-catching
RED_STROKE = (0xC9, 0x2E, 0x38, 255)      # slightly darker red for the rim
WHITE = (255, 255, 255, 255)

# Font candidates, tried in order. .ttc collections need an explicit index.
FONT_CANDIDATES = [
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
    ("/System/Library/Fonts/Helvetica.ttc", 0),
    ("/Library/Fonts/Arial.ttf", 0),
    ("/System/Library/Fonts/PingFang.ttc", 0),
]


def load_font(size: int):
    """Return a PIL font for the requested pixel size, or None if unavailable."""
    for path, index in FONT_CANDIDATES:
        if not os.path.isfile(path):
            continue
        try:
            if path.lower().endswith(".ttc"):
                return ImageFont.truetype(path, size=size, index=index)
            return ImageFont.truetype(path, size=size)
        except (OSError, IOError):
            continue
    return None


def draw_yen_symbol(draw: ImageDraw.ImageDraw, size: int) -> None:
    """Fallback: draw a clean "¥" using primitive lines.

    The yen/yuan symbol is a "Y" with two horizontal bars crossing the arms.
    """
    cx = size / 2.0
    # Glyph box: ~60% of canvas height, centered.
    gh = size * 0.60
    gw = gh * 0.78
    top_y = (size - gh) / 2.0
    bottom_y = top_y + gh
    mid_y = top_y + gh * 0.42          # join point of the Y
    arm = gw / 2.0

    line_w = max(1, int(round(size * 0.075)))
    join = max(1, int(round(size * 0.04)))

    # Two diagonal arms from the top center down to the join.
    draw.line([(cx, top_y), (cx - arm, mid_y)], fill=WHITE, width=line_w,
              joint="curve")
    draw.line([(cx, top_y), (cx + arm, mid_y)], fill=WHITE, width=line_w,
              joint="curve")
    # Vertical stem from the join down to the bottom.
    draw.line([(cx, mid_y - join), (cx, bottom_y)], fill=WHITE, width=line_w,
              joint="curve")

    # Two horizontal bars crossing the arms (classic ¥ styling).
    bar_gap = max(1, int(round(size * 0.09)))
    for offset in (0, bar_gap):
        by = mid_y + offset
        # Interpolate the arm x at this y to keep bars within the V.
        t = (by - top_y) / (mid_y - top_y) if mid_y > top_y else 1.0
        half = arm * max(0.0, min(1.0, t))
        draw.line([(cx - half, by), (cx + half, by)], fill=WHITE,
                  width=line_w, joint="curve")


def generate_icon(size: int) -> str:
    """Render a single icon of the given size and save it; return its path."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-square background.
    radius = max(2, int(round(size * 0.22)))
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        fill=RED_FILL,
    )

    # Subtle inner stroke for a little depth (kept simple/flat).
    inset = max(1, int(round(size * 0.06)))
    stroke_w = max(1, int(round(size * 0.03)))
    draw.rounded_rectangle(
        [(inset, inset), (size - 1 - inset, size - 1 - inset)],
        radius=max(1, radius - inset),
        outline=RED_STROKE,
        width=stroke_w,
    )

    # The "¥" symbol: prefer a font, otherwise draw with lines.
    font = load_font(int(round(size * 0.66)))
    if font is not None:
        # Bold-ish look via a white stroke of the same color.
        stroke_w_text = max(1, int(round(size * 0.06)))
        draw.text(
            (size / 2.0, size / 2.0),
            "¥",
            font=font,
            fill=WHITE,
            anchor="mm",
            stroke_width=stroke_w_text,
            stroke_fill=WHITE,
        )
    else:
        draw_yen_symbol(draw, size)

    out_path = os.path.join(BASE_DIR, f"icon-{size}.png")
    img.save(out_path, "PNG")
    return out_path


def main() -> None:
    print("Generating toolbar icons...")
    for size in SIZES:
        path = generate_icon(size)
        with Image.open(path) as check:
            # Verify it is non-blank by sampling a corner (transparent) and center.
            px = check.getpixel((size // 2, size // 2))
            blank = px is None or (isinstance(px, tuple) and px[-1] == 0)
            print(f"  {os.path.basename(path)}: size={check.size}, "
                  f"mode={check.mode}, center_pixel={px}, "
                  f"non_blank={not blank}")
    print("Done.")


if __name__ == "__main__":
    main()
