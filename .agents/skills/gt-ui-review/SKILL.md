---
name: gt-ui-review
description: "Create matched visual evidence and a local HTML review for a Wisconsin Creative web or native UI change."
---

# GT UI Review

Produce the review required by `AGENTS.md`: the changed surface, what improved, matched captures where available, measurements only when supported, and actual verification. A local self-contained HTML file is the default deliverable. External publishing is optional and requires existing authorization plus a callable tool.

## Establish a trustworthy comparison

Identify the actual pre-change baseline before editing when possible. Record source revision plus any relevant dirty patch, role, fixture/data snapshot, viewport/device, appearance, text size, clock, scroll position, and route/scenario. Both sides must use the same inputs apart from the intended change.

Never stash, restore, or replace files in the active checkout to create a baseline. Use an isolated snapshot or worktree when needed and allowed, preserving the relevant pre-existing dirty state. `HEAD` is not automatically the user's baseline. Do not remove inconvenient debug code from a baseline and call it original. If the true baseline cannot be reproduced, show after-only evidence with the missing comparison explicitly stated; do not manufacture a pair.

- Native: read [reference/capture-ios.md](reference/capture-ios.md).
- Web: read [reference/capture-web.md](reference/capture-web.md).

Capture the states affected by the change, including the relevant failure/recovery path. Reuse existing fixtures/tests before expanding harness code. Inspect every selected image. Fixture captures prove presentation, not authenticated server behavior, record persistence, notification delivery, or hardware custody.

## Measure only what the evidence supports

Use known image dimensions and actual viewport points/CSS pixels, not a guessed device scale. `assets/measure_rows.py` is a light-background row-height heuristic, not a general visual-diff engine. Supply the real point width, crop/row range, and matching background; inspect the detected rows. Use a qualitative claim when those assumptions do not hold.

## Build and inspect the review

Create a spec using:

```bash
python3 .agents/skills/gt-ui-review/assets/build_review_page.py --example
python3 .agents/skills/gt-ui-review/assets/build_review_page.py /absolute/path/spec.json /absolute/path/review.html
```

Images resolve relative to the spec file; absolute paths are also supported. Fields include `title`, `eyebrow`, `lede`, `stats`, `sections` with `pairs`, `changes`, `verification`, and `notes`. For after-only evidence, omit pairs and explain the unavailable baseline; link the actual capture separately. Never reuse example statistics as results.

Store repo proof under `tasks/archive/proofs/<surface>-<date>/`. Open the local HTML with the available file/browser panel, inspect it, and return a usable local link. Do not wait for an Artifact publishing tool. Preserve source images and sensitive data boundaries; public sharing requires appropriately sanitized evidence.

Report failed checks and blocked gates alongside passes. The review supplements the repository verification matrix; it does not replace builds, authenticated interaction, device, or production proof.

## Capture contract

Before building a comparison, follow [capture evidence](reference/capture-evidence.md). PNG pairs require hash-bound receipts with matching settings and dimensions. Keep declared source provenance separate from runtime proof.
