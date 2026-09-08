#!/usr/bin/env python3
"""Measure card/row heights in an iOS screenshot, for honest density claims.

    python3 measure_rows.py before.png after.png --width-pt ACTUAL_VIEWPORT_WIDTH [--from-y 0] [--ground 242,242,247]

Classifies each pixel row by how much of the card's width is non-ground, which
is robust where sampling a single column is not: one column hits text, chips,
and rounded corners and returns noise.

Uses a dependency-free PNG decoder. Handles 8-bit
non-interlaced RGB/RGBA, which is what simctl and XCTest produce.
"""
import argparse
import struct
import sys
import zlib

GROUND = (242, 242, 247)   # UIColor.systemGroupedBackground, light


def read_png(path):
    with open(path, "rb") as stream:
        data = stream.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("expected PNG signature")
    pos, idat = 8, b""
    w = h = ct = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", chunk)
            if bd != 8 or il != 0 or ct not in (2, 6):
                raise ValueError("expected 8-bit non-interlaced RGB/RGBA PNG")
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        pos += 12 + ln
    if not w or not h or ct not in (2, 6):
        raise ValueError("missing or unsupported PNG header")
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * ch
    if len(raw) != (stride + 1) * h:
        raise ValueError("invalid PNG scanline length")
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        if f not in range(5):
            raise ValueError("unsupported PNG filter")
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b, c = prev[i], (prev[i - ch] if i >= ch else 0)
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, bytes(out)


def measure(path, width_pt, from_y, ground=GROUND):
    if width_pt <= 0 or from_y < 0:
        raise ValueError("width must be positive and from-y non-negative")
    w, h, ch, px = read_png(path)
    stride = w * ch
    scale = w / width_pt
    lo, hi = int(0.05 * w), int(0.95 * w)
    runs, start = [], None
    for y in range(h):
        n = 0
        for x in range(lo, hi, 6):
            i = y * stride + x * ch
            if (abs(px[i] - ground[0]) > 3 or abs(px[i + 1] - ground[1]) > 3
                    or abs(px[i + 2] - ground[2]) > 3):
                n += 1
        inside = n > len(range(lo, hi, 6)) * 0.85
        if inside and start is None:
            start = y
        elif not inside and start is not None:
            if y - start > 60 and start >= from_y:
                runs.append(round((y - start) / scale))
            start = None
    if start is not None and h - start > 60 and start >= from_y:
        runs.append(round((h - start) / scale))
    return runs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+")
    parser.add_argument("--width-pt", type=float, required=True)
    parser.add_argument("--from-y", type=int, default=0)
    parser.add_argument("--ground", default="242,242,247", help="background R,G,B")
    args = parser.parse_args()
    try:
        ground = tuple(int(value) for value in args.ground.split(","))
        if len(ground) != 3 or any(v < 0 or v > 255 for v in ground):
            raise ValueError()
        if args.width_pt <= 0 or args.from_y < 0:
            raise ValueError()
    except ValueError:
        parser.error("use positive --width-pt, non-negative --from-y, and three RGB values from 0 to 255")
    for path in args.images:
        runs = measure(path, args.width_pt, args.from_y, ground)
        label = path.split("/")[-1]
        if runs:
            print(f"{label:28s} cards={len(runs):2d}  heights(pt)={runs}  "
                  f"median={sorted(runs)[len(runs) // 2]}")
        else:
            print(f"{label:28s} no cards found — check --from-y and the ground color")


if __name__ == "__main__":
    main()
