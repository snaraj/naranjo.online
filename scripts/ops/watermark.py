#!/usr/bin/env python3
"""Tile the owner's credit line into one image, the way Unsplash+ previews do.

The owner's rule (2026-09-11): every drawing and photograph published to the
site carries this mark, applied automatically by the operator's rendition
ladder on the LOSSLESS intermediate, before any encode and before signing.
Films and their stills are not marked. There is no switch to turn it off; this
program is the mark.

    scripts/ops/watermark.py IN OUT [--receipt FILE] [--text T] [--font F]
        [--fill A] [--shadow B] [--size PT] [--row PX] [--gap G]

The look: the credit in two staggered rows per tile, white at 22 % over a 7 %
shadow offset down-right, 23 pt at a 3840 px wide image and scaled with width
(never below an 11 pt floor, so a 1280 px preview stays legible at 100 %
zoom and invisible at gallery size). The horizontal period is the text's own
width plus a gap, so a tile never clips a word; each row is drawn twice one
period apart, so the tile wraps seamlessly.

The credit TEXT is not in this repository (requirement 12): it comes from
--text, else the NARANJO_MEDIA_CREDIT environment variable, else the first
line of ~/.config/naranjo-media/credit. A missing or multi-line credit refuses
the run rather than marking an image with nothing.

--receipt writes a small JSON record of what was marked — the output's
SHA-256, its size, the geometry, and the credit's SHA-256 (never the credit
itself) — so the step that stages renditions can refuse an image no receipt
vouches for.

ImageMagick 7 (`magick`) does the drawing. Every intermediate lives in a
private scratch directory removed on every exit path, and the output is
written beside its destination and renamed into place, so IN may equal OUT
and an interrupted run never leaves a half-written image where a marked one
belongs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile

BASE_WIDTH = 3840
FLOOR_PT = 11.0
CREDIT_ENV = "NARANJO_MEDIA_CREDIT"
CREDIT_FILE = os.path.join("~", ".config", "naranjo-media", "credit")
FONTS = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)
RECEIPT_SCHEMA = "watermark-receipt/v1"


class WatermarkError(Exception):
    """A refusal with a message fit for the operator's terminal."""


def geometry(width: int, size: float, row: float) -> tuple[float, int, int]:
    """Point size, row period and shadow offset for an image this wide."""
    if width <= 0:
        raise WatermarkError("the image reports no width")
    scale = width / BASE_WIDTH
    return max(FLOOR_PT, size * scale), max(1, round(row * scale)), max(1, round(2 * scale))


def credit_text(explicit: str | None, environ: dict[str, str] | None = None) -> str:
    """The credit line, from the first source that supplies one."""
    variables = os.environ if environ is None else environ
    text = explicit if explicit is not None else variables.get(CREDIT_ENV)
    if text is None:
        try:
            with open(os.path.expanduser(CREDIT_FILE), encoding="utf-8") as handle:
                text = handle.readline()
        except FileNotFoundError:
            text = ""
    text = text.strip()
    if not text:
        raise WatermarkError(f"no credit line: pass --text, set {CREDIT_ENV}, or write {CREDIT_FILE}")
    if "\n" in text or "\r" in text:
        raise WatermarkError("the credit line must be one line")
    return text


def pick_font(requested: str | None) -> str:
    for candidate in ((requested,) if requested else ()) + FONTS:
        if os.path.isfile(candidate):
            return candidate
    raise WatermarkError("no usable font found")


def magick(*args: str) -> str:
    try:
        done = subprocess.run(("magick",) + args, check=True, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise WatermarkError("ImageMagick 7 (`magick`) is not installed") from error
    except subprocess.CalledProcessError as error:
        raise WatermarkError(f"magick refused: {error.stderr.strip()[:200]}") from error
    return done.stdout


def tile_command(tile: str, text: str, font: str, pt: float, period: int, row: int, offset: int,
                 fill: float, shadow: float) -> list[str]:
    """The ImageMagick arguments that draw one seamless tile."""
    command = ["-size", f"{period}x{2 * row}", "xc:none", "-font", font,
               "-pointsize", f"{pt:.2f}", "-gravity", "NorthWest"]
    for x, y in ((0, int(row * 0.5)), (int(period * 0.5), int(row * 1.5))):
        for shifted in (x, x - period):
            command += ["-fill", f"rgba(0,0,0,{shadow})", "-annotate", f"{shifted + offset:+d}{y + offset:+d}", text,
                        "-fill", f"rgba(255,255,255,{fill})", "-annotate", f"{shifted:+d}{y:+d}", text]
    return command + [tile]


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def watermark(source: str, destination: str, text: str, font: str, fill: float, shadow: float,
              size: float, row: float, gap: float) -> dict:
    width, height = (int(value) for value in magick("identify", "-format", "%w %h", source).split())
    pt, row_px, offset = geometry(width, size, row)
    text_width = int(magick("-font", font, "-pointsize", f"{pt:.2f}", f"label:{text}", "-format", "%w", "info:"))
    period = max(1, round(text_width * (1 + gap)))
    extension = os.path.splitext(destination)[1] or ".png"
    with tempfile.TemporaryDirectory(prefix="watermark-") as scratch:
        tile = os.path.join(scratch, "tile.png")
        magick(*tile_command(tile, text, font, pt, period, row_px, offset, fill, shadow))
        handle, staged = tempfile.mkstemp(prefix=".watermark-", suffix=extension,
                                          dir=os.path.dirname(os.path.abspath(destination)))
        os.close(handle)
        try:
            magick(source, "(", "-size", f"{width}x{height}", f"tile:{tile}", ")",
                   "-compose", "over", "-composite", staged)
            os.replace(staged, destination)
        except BaseException:
            os.unlink(staged)
            raise
    return {
        "schema": RECEIPT_SCHEMA,
        "output": os.path.basename(destination),
        "sha256": sha256_file(destination),
        "width": width,
        "height": height,
        "pointSize": round(pt, 2),
        "period": period,
        "row": row_px,
        "fill": fill,
        "shadow": shadow,
        "creditSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--receipt")
    parser.add_argument("--text")
    parser.add_argument("--font")
    parser.add_argument("--fill", type=float, default=0.22)
    parser.add_argument("--shadow", type=float, default=0.07)
    parser.add_argument("--size", type=float, default=23.0)
    parser.add_argument("--row", type=float, default=200.0)
    parser.add_argument("--gap", type=float, default=0.40)
    arguments = parser.parse_args(argv)
    for name in ("fill", "shadow"):
        if not 0 < getattr(arguments, name) <= 1:
            parser.error(f"--{name} is an opacity in (0, 1]")
    if arguments.size <= 0 or arguments.row <= 0 or arguments.gap < 0:
        parser.error("--size and --row must be positive and --gap non-negative")
    return arguments


def main(argv: list[str]) -> int:
    arguments = parse(argv)
    try:
        receipt = watermark(arguments.source, arguments.destination, credit_text(arguments.text),
                            pick_font(arguments.font), arguments.fill, arguments.shadow,
                            arguments.size, arguments.row, arguments.gap)
    except WatermarkError as error:
        print(f"watermark: {error}", file=sys.stderr)
        return 1
    if arguments.receipt:
        with open(arguments.receipt, "w", encoding="utf-8") as handle:
            json.dump(receipt, handle, indent=1, sort_keys=True)
            handle.write("\n")
    print(f"{arguments.destination} {receipt['width']}x{receipt['height']} "
          f"pt={receipt['pointSize']} period={receipt['period']} row={receipt['row']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
