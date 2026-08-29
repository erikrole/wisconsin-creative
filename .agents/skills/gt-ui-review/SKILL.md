---
name: gt-ui-review
description: Build a before/after visual review page for a Wisconsin Creative UI change. Use when the user runs /gt-ui-review, asks to see or compare a UI change, asks for screenshots of a screen before and after, or ships user-facing native/web UI that needs visual proof. Produces matched screenshots and a published review Artifact, not hand-captured one-offs.
---

# GT UI Review

Every user-facing UI change ships with a review page: matched before/after screenshots, the measured difference, what changed and why, and the verification that backs it. The page is the deliverable, not a nice-to-have.

The rule that makes it worth anything: **the two columns must differ only by the change**. A "before" captured from memory, from a different data set, or from a different device proves nothing.

## Orient

1. Read `AGENTS.md` (simulator policy, verification matrix) and the area doc for the surface.
2. Inspect `git status --short`. Know which of the working-tree changes are yours before you try to build a baseline.
3. Identify the screen's real entry conditions: role gates, capability gates, and every API path it reads.

## Capture

Read `reference/capture-ios.md` for the exact commands and the failure modes that cost the most time. In outline:

1. **Render the screen without a session.** Extend the DEBUG fixture harness (`AppRuntimeMode.PerformanceScenario` + `FixtureAPIProtocol` + `PerformanceTestHarness.swift`) with a scenario for the surface. Never capture against production with real credentials.
2. **Build fixtures that exercise the states the change touches** — empty, partial, full, error, and anything time-relative the design now responds to. A screenshot of the happy path alone will not show a regression.
3. **Capture through a UI test**, not by hand, so the pair is repeatable and the scroll positions match.
4. **Build the baseline from source control**, not from memory: stash your version, restore the pre-change file with `git show HEAD:<path>`, capture, then restore your version. Verify the restore before continuing.
5. **Look at every capture before using it.** Read the PNG. Zoom into the region you changed. This is where you find that the thing you were about to claim as a regression was already broken, or that your new control is being clipped.

## Measure

Do not eyeball a density or size claim. Classify pixel rows to get real numbers (`reference/capture-ios.md` has the routine). Report the measurement and how it was taken. If a number cannot be measured honestly, describe the change qualitatively instead of inventing a percentage.

## Build the page

Write a spec JSON and run the shared builder, so every review page reads the same and the design is not re-derived per task:

```bash
python3 .agents/skills/gt-ui-review/assets/build_review_page.py spec.json out.html
```

Then publish `out.html` with the Artifact tool and give the user the link. Re-publishing the same file path keeps the same URL.

Spec fields: `title`, `eyebrow`, `lede`, `stats[]`, `sections[]` (each with `pairs[]`), `changes[]`, `verification[]`, `notes[]`. Run the builder with `--example` to print a complete spec.

## Content rules

- **Lead with the reader's question.** A pair caption says what to look at, not what the file is.
- **State the problem each change solves**, in the `was`/`now` form. A change with no stated cost to the reader is decoration.
- **Put failures in the verification list**, with whether they reproduce on a clean checkout. A review page that only lists passes is not proof.
- **Notes carry what the user must decide**: things you did not do, things that need a device, contradictions you found in the repo's own records.
- Never present an unverified claim as measured, and never show a "before" you reconstructed by hand as if it were captured.

## Verify

The review page supplements the `AGENTS.md` verification matrix; it does not replace it. Run the matrix proof for the change type as well, and list it on the page.
