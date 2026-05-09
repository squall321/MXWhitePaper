#!/usr/bin/env python3
"""
PWA icon generator (Pillow-based).

Renders solid-colour Samsung-blue squares with a centred white "MX" wordmark
into apps/web/public/icon-192.png and apps/web/public/icon-512.png.

Run:  python3 apps/web/scripts/gen-pwa-icons.py

Equivalent to gen-pwa-icons.cjs but uses Pillow when the Node toolchain is
unavailable in the build environment.  Either script is acceptable; commit the
generated PNGs.
"""
from __future__ import annotations

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.stderr.write("Pillow is required: pip install Pillow\n")
    sys.exit(1)


BG = (0x14, 0x28, 0xA0)
FG = (0xFF, 0xFF, 0xFF)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public")


def _font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(size: int, path: str) -> None:
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    text = "MX"
    font = _font(int(size * 0.55))
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (size - tw) // 2 - bbox[0]
        y = (size - th) // 2 - bbox[1]
    except AttributeError:
        tw, th = draw.textsize(text, font=font)  # type: ignore[attr-defined]
        x = (size - tw) // 2
        y = (size - th) // 2
    draw.text((x, y), text, font=font, fill=FG)
    img.save(path, "PNG", optimize=True)
    print(f"wrote {path}")


def main() -> int:
    out = os.path.abspath(OUT_DIR)
    os.makedirs(out, exist_ok=True)
    for size in (192, 512):
        render(size, os.path.join(out, f"icon-{size}.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
