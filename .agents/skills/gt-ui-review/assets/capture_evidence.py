"""Hash-bound capture metadata for comparable local review pairs (stdlib only)."""
import hashlib
import json
import math
import re
import struct
from pathlib import Path

SETTINGS = ("device", "viewport", "fixture", "role", "route", "appearance", "textSize", "locale", "timezone", "clock", "scroll")

def png_dimensions(path):
    data = Path(path).read_bytes()
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError(f"expected a PNG capture: {path}")
    width, height = struct.unpack(">II", data[16:24])
    if width <= 0 or height <= 0:
        raise ValueError("invalid PNG dimensions")
    return [width, height]

def numeric_pair(value, positive=False):
    return (isinstance(value, list) and len(value) == 2 and
            all(type(v) in (int, float) and math.isfinite(v) and (v > 0 if positive else v >= 0) for v in value))

def validate_metadata(meta):
    if not isinstance(meta, dict):
        raise ValueError("capture metadata must be an object")
    if not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", str(meta.get("sourceRevision", ""))):
        raise ValueError("sourceRevision must be the full source commit hash")
    if "sourcePatchSha256" not in meta:
        raise ValueError("record sourcePatchSha256 (null only for a clean snapshot)")
    patch = meta["sourcePatchSha256"]
    if patch is not None and not re.fullmatch(r"[a-fA-F0-9]{64}", str(patch)):
        raise ValueError("sourcePatchSha256 must be a SHA-256 or null")
    settings = meta.get("settings")
    if not isinstance(settings, dict) or set(settings) != set(SETTINGS):
        raise ValueError("settings must contain exactly: " + ", ".join(SETTINGS))
    for key, value in settings.items():
        if key in ("viewport", "scroll"):
            if not numeric_pair(value, positive=key == "viewport"):
                raise ValueError(f"{key} must be two finite {'positive' if key == 'viewport' else 'non-negative'} numbers")
        elif not isinstance(value, str) or not value.strip():
            raise ValueError(f"record a nonempty {key}")
    return meta

def record_capture(image, metadata, output):
    meta = validate_metadata(json.loads(Path(metadata).read_text()))
    image = Path(image)
    result = {"version": 1, "sourceRevision": meta["sourceRevision"],
              "sourcePatchSha256": meta["sourcePatchSha256"], "settings": meta["settings"],
              "imageSha256": hashlib.sha256(image.read_bytes()).hexdigest(), "dimensions": png_dimensions(image)}
    output = Path(output)
    if output.resolve() in (image.resolve(), Path(metadata).resolve()):
        raise ValueError("evidence output must not overwrite the image or metadata")
    # A sidecar is a receipt: do not replace an existing one silently.
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    return result

def read_capture(image, evidence):
    meta = validate_metadata(json.loads(Path(evidence).read_text()))
    if meta.get("version") != 1:
        raise ValueError("unsupported capture evidence version")
    actual = hashlib.sha256(Path(image).read_bytes()).hexdigest()
    if meta.get("imageSha256") != actual:
        raise ValueError("capture hash mismatch: image changed after evidence was recorded")
    if meta.get("dimensions") != png_dimensions(image):
        raise ValueError("capture dimensions disagree with evidence")
    return meta

def validate_pair(pair):
    if not pair.get("beforeEvidence") or not pair.get("afterEvidence"):
        raise ValueError("matched pairs require beforeEvidence and afterEvidence sidecars; use after-only evidence when the baseline is unavailable")
    before = read_capture(pair["before"], pair["beforeEvidence"])
    after = read_capture(pair["after"], pair["afterEvidence"])
    if before["dimensions"] != after["dimensions"]:
        raise ValueError("incompatible capture dimensions")
    differences = [key for key in SETTINGS if before["settings"][key] != after["settings"][key]]
    if differences:
        raise ValueError("incompatible capture settings: " + ", ".join(differences))
    return {"before": before, "after": after}
