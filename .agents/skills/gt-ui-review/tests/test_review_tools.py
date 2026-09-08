"""Local regression checks: python3 -B -m unittest discover -s .agents/skills/gt-ui-review/tests."""
import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / "assets"

def load(name):
    spec = importlib.util.spec_from_file_location(name, ASSETS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

builder = load("build_review_page")
measure = load("measure_rows")

def png(path, color_type=2, width=180, height=200):
    channels = 3 if color_type == 2 else 1
    rows = []
    for y in range(height):
        rgb = (255, 255, 255) if y < 90 or y >= 120 else (242, 242, 247)
        rows.append(bytes([0]) + bytes(rgb[:channels]) * width)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    data = bytes.fromhex("89504e470d0a1a0a")
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")
    path.write_bytes(data)

def receipt(folder, image, name="receipt.json", **settings):
    meta = {"sourceRevision": "a" * 40, "sourcePatchSha256": None, "settings": {
        "device": "test", "viewport": [180, 200], "fixture": "fixture-v1", "role": "staff",
        "route": "/test", "appearance": "light", "textSize": "default", "locale": "en-US",
        "timezone": "America/Chicago", "clock": "2026-09-07T12:00:00Z", "scroll": [0, 0]}}
    meta["settings"].update(settings)
    source = folder / (name + ".metadata.json"); source.write_text(json.dumps(meta))
    output = folder / name
    builder.record_capture(image, source, output)
    return output

class ReviewTools(unittest.TestCase):
    def test_rows_at_top_and_bottom_have_correct_scale(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "capture.png"
            png(p)
            self.assertEqual(measure.measure(p, 90, 0), [45, 40])
            self.assertEqual(measure.measure(p, 180, 100), [80])

    def test_cli_accepts_documented_space_and_equals_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "capture.png"
            png(p)
            for args in (["--width-pt", "90", "--from-y", "0"], ["--width-pt=90", "--from-y=0"]):
                run = subprocess.run([sys.executable, "-B", str(ASSETS / "measure_rows.py"), str(p), *args], capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn("heights(pt)=[45, 40]", run.stdout)

    def test_invalid_or_unsupported_input_fails_explicitly(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "capture.png"
            p.write_text("not PNG")
            with self.assertRaises(ValueError): measure.read_png(p)
            png(p, color_type=0)
            with self.assertRaises(ValueError): measure.read_png(p)
            with self.assertRaises(ValueError): measure.measure(p, 0, 0)

    def test_inline_formatting_does_not_allow_active_html(self):
        s = builder.rich('<strong onclick="bad()">safe</strong><script>bad()</script><img src="https://example.com/x">')
        self.assertIn("<strong>safe</strong>", s)
        self.assertNotIn("<script>", s)
        self.assertNotIn("<img", s)
        self.assertNotIn("onclick", s)
        self.assertEqual(builder.esc('a"b'), 'a&quot;b')

    def test_local_page_resolves_spec_images_and_embeds_png(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); p = folder / "capture.png"; png(p)
            receipt(folder, p)
            spec = {"title": 'A "quoted" title', "lede": "<em>Local</em>", "sections": [{"heading": "Pair", "pairs": [{"title": 'A "quoted" title', "before": "capture.png", "after": "capture.png", "beforeEvidence": "receipt.json", "afterEvidence": "receipt.json"}]}]}
            (folder / "spec.json").write_text(json.dumps(spec))
            out = folder / "nested/review.html"
            run = subprocess.run([sys.executable, "-B", str(ASSETS / "build_review_page.py"), str(folder / "spec.json"), str(out)], cwd=tempfile.gettempdir(), capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            s = out.read_text()
            self.assertIn('<!doctype html>', s)
            self.assertIn('name="viewport"', s)
            self.assertEqual(s.count('src="data:image/png;base64,'), 2)
            self.assertNotIn('fonts.googleapis.com', s)
            self.assertIn('alt="A &quot;quoted&quot; title, before"', s)
            self.assertTrue(s.rstrip().endswith('</html>'))
            # Source capture is never resized or rewritten.
            self.assertEqual(measure.read_png(p)[:2], (180, 200))

class CaptureContracts(unittest.TestCase):
    def test_missing_receipts_rejected(self):
        with self.assertRaises(ValueError): builder.validate_pair({})

    def test_changed_capture_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp); p=folder/"a.png"; png(p); r=receipt(folder,p)
            p.write_bytes(p.read_bytes()+b"changed")
            with self.assertRaisesRegex(ValueError,"hash mismatch"):
                builder.validate_pair(dict(before=p,after=p,beforeEvidence=r,afterEvidence=r))

    def test_mismatched_dimensions_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp); a=folder/"a.png"; b=folder/"b.png"
            png(a);png(b,width=181)
            ra=receipt(folder,a,"a.json");rb=receipt(folder,b,"b.json")
            with self.assertRaisesRegex(ValueError,"incompatible capture dimensions"):
                builder.validate_pair(dict(before=a,after=b,beforeEvidence=ra,afterEvidence=rb))

    def test_each_setting_mismatch_rejected(self):
        changes={"device":"other","viewport":[90,100],"fixture":"other","role":"admin","route":"/other","appearance":"dark","textSize":"large","locale":"fr","timezone":"UTC","clock":"other","scroll":[0,1]}
        for key,value in changes.items():
            with self.subTest(key=key), tempfile.TemporaryDirectory() as tmp:
                folder=Path(tmp); p=folder/"a.png";png(p)
                ra=receipt(folder,p,"a.json");rb=receipt(folder,p,"b.json",**{key:value})
                with self.assertRaisesRegex(ValueError,"incompatible capture settings"):
                    builder.validate_pair(dict(before=p,after=p,beforeEvidence=ra,afterEvidence=rb))

    def test_receipts_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);p=folder/"a.png";png(p);receipt(folder,p)
            with self.assertRaises(FileExistsError):receipt(folder,p)

    def test_invalid_provenance_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);p=folder/"a.png";png(p);r=receipt(folder,p)
            data=json.loads(r.read_text());data["sourceRevision"]="main";r.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,"full source commit"):
                builder.validate_pair(dict(before=p,after=p,beforeEvidence=r,afterEvidence=r))

if __name__ == "__main__":
    unittest.main()
