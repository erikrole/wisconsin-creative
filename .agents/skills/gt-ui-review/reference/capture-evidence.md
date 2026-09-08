# Comparable PNG captures

The local review builder accepts PNG files without platform tools. A before/after pair requires `beforeEvidence` and `afterEvidence` paths alongside `before` and `after`, all relative to the spec file. Existing specs must add these receipts. If there is no trustworthy baseline, omit `pairs` and describe the after-only evidence honestly.

Save capture metadata for each image:

```json
{
  "sourceRevision": "FULL_COMMIT_HASH",
  "sourcePatchSha256": null,
  "settings": {
    "device": "actual device or browser",
    "viewport": [390, 844],
    "fixture": "fixture identifier and revision",
    "role": "staff",
    "route": "/actual-route",
    "appearance": "light",
    "textSize": "default",
    "locale": "en-US",
    "timezone": "America/Chicago",
    "clock": "fixed capture clock",
    "scroll": [0, 0]
  }
}
```

Use the full source commit hash; `sourcePatchSha256` is null only for a clean snapshot. Otherwise record the SHA-256 of the retained source patch or snapshot, including relevant untracked files. A plain `git diff` does not include those files. Record viewport and scroll in logical points/CSS pixels; dimensions are read from the PNG itself. Record actual settings, not placeholders.

```sh
python3 -B .agents/skills/gt-ui-review/assets/build_review_page.py --record-capture before.png before-metadata.json before-evidence.json
python3 -B .agents/skills/gt-ui-review/assets/build_review_page.py --record-capture after.png after-metadata.json after-evidence.json
```

Receipts cannot overwrite an existing file. The builder rejects changed image bytes, differing image dimensions, missing receipts, and any differing capture setting. Source revisions and patch hashes can differ between before and after. Capture metadata is declared provenance: hashes bind a receipt to image bytes but do not independently prove which app build produced it. Verify that relationship during capture. The report displays receipts for review.
