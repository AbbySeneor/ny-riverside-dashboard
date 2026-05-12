#!/usr/bin/env python3
"""Write minimal truecolor PNGs for public/brands (replace with official artwork)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path


def _chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def write_png_rgb(path: Path, width: int, height: int, rgb) -> None:
    """rgb(x,y) -> (r,g,b) in 0..255."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(rgb(x, y))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    compressed = zlib.compress(bytes(raw), 9)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", compressed)
        + _chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    brands = root / "public" / "brands"
    brands.mkdir(parents=True, exist_ok=True)

    ink = (0xE8, 0xF0, 0xEB)
    paper = (0x10, 0x16, 0x14)
    mint = (0x34, 0xD3, 0x99)
    sage = (0x8F, 0xB5, 0xA3)

    def treelyon(x: int, y: int) -> tuple[int, int, int]:
        if x < 6 or (x < 56 and y < 6) or (x < 56 and y > 50):
            return mint
        if 60 < x < 240 and 18 < y < 38:
            return ink
        return paper

    def riverside(x: int, y: int) -> tuple[int, int, int]:
        if x < 5 or y < 5 or y > 51:
            return sage
        if 12 < x < 300 and 14 < y < 34:
            return ink
        return paper

    write_png_rgb(brands / "treelyon.png", 260, 56, treelyon)
    write_png_rgb(brands / "riverside.png", 320, 56, riverside)
    print(f"Wrote {brands / 'treelyon.png'} and riverside.png (placeholders — swap for official PNGs).")


if __name__ == "__main__":
    main()
