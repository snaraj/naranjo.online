"""Behaviour tests for scripts/ops/watermark.py (the owner's 2026-09-11 credit
mark on every drawing and photograph).

CI has no ImageMagick, and these tests do not need one: a hand-written
`magick` stand-in on PATH answers `identify` and the label-width probe with
fixed numbers, writes the tile and the composite as plain files, and can be
told to fail at one step. That is enough to pin what this program owns — the
geometry, the credit's provenance, the receipt, and that a failure never
leaves a half-written image or a scratch directory behind.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import stat
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "ops" / "watermark.py"
_spec = importlib.util.spec_from_file_location("watermark", _SCRIPT)
watermark = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(watermark)

# The stand-in: identify reports 1280x720, a label probe reports 500 px, the
# tile step creates its output, and the composite copies the source and
# appends a marker so a test can tell a marked file from the original. When
# FAKE_MAGICK_FAIL names a step, that step exits 1 without writing anything.
FAKE_MAGICK = """#!/usr/bin/env python3
import os, shutil, sys
args = sys.argv[1:]
fail = os.environ.get("FAKE_MAGICK_FAIL", "")
with open(os.environ["FAKE_MAGICK_LOG"], "a") as log:
    log.write(" ".join(args[:2]) + "\\n")
if args[0] == "identify":
    step = "identify"
elif any(a.startswith("label:") for a in args):
    step = "label"
elif "xc:none" in args:
    step = "tile"
else:
    step = "composite"
if step == fail:
    sys.stderr.write("fake magick refused " + step)
    sys.exit(1)
if step == "identify":
    print("1280 720")
elif step == "label":
    print("500")
elif step == "tile":
    open(args[-1], "wb").write(b"tile")
else:
    shutil.copyfile(args[0], args[-1])
    open(args[-1], "ab").write(b"+marked")
"""


class GeometryTests(unittest.TestCase):
    def test_full_width_is_the_reference_look(self):
        self.assertEqual(watermark.geometry(3840, 23.0, 200.0), (23.0, 200, 2))

    def test_previews_keep_the_legibility_floor(self):
        point, row, offset = watermark.geometry(1280, 23.0, 200.0)
        self.assertEqual(point, watermark.FLOOR_PT)
        self.assertEqual((row, offset), (67, 1))

    def test_no_width_refuses(self):
        with self.assertRaises(watermark.WatermarkError):
            watermark.geometry(0, 23.0, 200.0)

    def test_the_tile_draws_two_rows_twice_each_with_a_shadow(self):
        command = watermark.tile_command("t.png", "credit", "f.ttf", 11.0, 700, 67, 1, 0.22, 0.07)
        self.assertEqual(command.count("-annotate"), 8)
        self.assertEqual(command.count("rgba(255,255,255,0.22)"), 4)
        self.assertEqual(command.count("rgba(0,0,0,0.07)"), 4)
        self.assertEqual(command[:2], ["-size", "700x134"])
        self.assertEqual(command[-1], "t.png")


class CreditTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.saved_home = os.environ.get("HOME")
        os.environ["HOME"] = self.home

    def tearDown(self):
        if self.saved_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = self.saved_home
        shutil.rmtree(self.home)

    def test_explicit_then_environment_then_file(self):
        self.assertEqual(watermark.credit_text("given", {watermark.CREDIT_ENV: "env"}), "given")
        self.assertEqual(watermark.credit_text(None, {watermark.CREDIT_ENV: " env "}), "env")
        path = pathlib.Path(self.home, ".config", "naranjo-media", "credit")
        path.parent.mkdir(parents=True)
        path.write_text("from file\nignored second line\n", encoding="utf-8")
        self.assertEqual(watermark.credit_text(None, {}), "from file")

    def test_no_credit_anywhere_refuses_rather_than_marking_nothing(self):
        with self.assertRaises(watermark.WatermarkError):
            watermark.credit_text(None, {})
        with self.assertRaises(watermark.WatermarkError):
            watermark.credit_text("   ", {})

    def test_a_multi_line_credit_refuses(self):
        with self.assertRaises(watermark.WatermarkError):
            watermark.credit_text("one\ntwo", {})

    def test_the_program_ships_no_credit_of_its_own(self):
        # Requirement 12: the credit names a person and an address, so it
        # lives in the operator's config and never in this file.
        self.assertNotIn("@", _SCRIPT.read_text(encoding="utf-8"))


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.bin = self.root / "bin"
        self.bin.mkdir()
        fake = self.bin / "magick"
        fake.write_text(FAKE_MAGICK, encoding="utf-8")
        fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
        self.scratch = self.root / "tmp"
        self.scratch.mkdir()
        self.saved = {name: os.environ.get(name) for name in ("PATH", "FAKE_MAGICK_LOG", "FAKE_MAGICK_FAIL")}
        os.environ["PATH"] = str(self.bin) + os.pathsep + os.environ.get("PATH", "")
        os.environ["FAKE_MAGICK_LOG"] = str(self.root / "calls.log")
        os.environ.pop("FAKE_MAGICK_FAIL", None)
        self.saved_tempdir = tempfile.tempdir
        tempfile.tempdir = str(self.scratch)
        self.font = self.root / "font.ttf"
        self.font.write_bytes(b"font")
        self.image = self.root / "art.png"
        self.image.write_bytes(b"original")

    def tearDown(self):
        tempfile.tempdir = self.saved_tempdir
        for name, value in self.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        shutil.rmtree(self.root)

    def run_main(self, *extra):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = watermark.main([str(self.image), str(self.image), "--text", "credit line",
                                   "--font", str(self.font), *extra])
        return code, err.getvalue()

    def test_marks_in_place_and_writes_a_receipt_that_vouches_for_the_output(self):
        receipt = self.root / "art.receipt.json"
        code, err = self.run_main("--receipt", str(receipt))
        self.assertEqual(code, 0, err)
        self.assertEqual(self.image.read_bytes(), b"original+marked")
        record = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(record["schema"], watermark.RECEIPT_SCHEMA)
        self.assertEqual(record["sha256"], hashlib.sha256(b"original+marked").hexdigest())
        self.assertEqual((record["width"], record["height"]), (1280, 720))
        self.assertEqual(record["period"], 700)
        self.assertEqual(record["creditSha256"], hashlib.sha256(b"credit line").hexdigest())
        self.assertNotIn("credit line", receipt.read_text(encoding="utf-8"))
        self.assertEqual(list(self.scratch.iterdir()), [], "a scratch directory outlived the run")
        self.assertEqual(sorted(p.name for p in self.root.iterdir() if p.name.startswith(".watermark-")), [])

    def test_a_failed_composite_leaves_the_original_and_no_residue(self):
        os.environ["FAKE_MAGICK_FAIL"] = "composite"
        code, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("magick refused", err)
        self.assertEqual(self.image.read_bytes(), b"original")
        self.assertEqual(list(self.scratch.iterdir()), [], "a scratch directory outlived the failure")
        self.assertEqual(sorted(p.name for p in self.root.iterdir() if p.name.startswith(".watermark-")), [],
                         "a staged output outlived the failure")

    def test_a_failed_tile_never_reaches_the_image(self):
        os.environ["FAKE_MAGICK_FAIL"] = "tile"
        code, _ = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(self.image.read_bytes(), b"original")
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_out_of_range_opacity_is_refused_before_any_work(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            watermark.parse([str(self.image), str(self.image), "--fill", "1.5"])
        self.assertFalse((self.root / "calls.log").exists())


if __name__ == "__main__":
    unittest.main()
