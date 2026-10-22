# Dashboard balance review — 2026-10-21

Local implementation on `codex/dashboard-polish`, based on Home `f1501f9c6f60ad54933f841926b41d9d78b66f53`.

## Scope

- Original grouped summary and column proportions retained.
- Recent activity fills the left column below Up next; personal gear, crew, coverage and team gear keep the right rail.
- Students place Team gear below Up next. Narrow reading order keeps personal work before secondary activity/team context.
- Compact inline quiet states retain their actions. All cards remain visible and use natural content heights.

## Evidence

`review.html` is self-contained. Selected `balanced-*` captures compare with the original `before-*` baseline using matching 1440×1100 viewport, fixtures, role, clock, locale, timezone and scroll. `source.patch` and PNG receipts record provenance. Earlier exploration captures and patches remain separate from this selected review.

The populated Admin fixture has a 545px difference between column endpoints before and 88px after. Coming up and Team gear move 316px earlier. Document height falls from 1618px to 1389px; the empty fixture fits 1100px instead of extending to 1555px. See `balanced-measurements.json` and `balanced-state-matrix.json`.

## Verification

57 focused tests, TypeScript, edited-file ESLint, docs verification and diff check pass. All 20 role/state fixtures pass overflow and column placement checks. Four responsive captures were visually inspected; keyboard expand/collapse and fixture reminder feedback pass, with no uncaught browser exceptions. The final `npm run build:app` passes (309 static pages); existing unrelated unused-variable warnings remain.

## Boundaries

No managed preview exists for this branch. Fixtures do not establish authenticated authorization, durable booking changes or reminder delivery. No commit, push, merge or deployment was performed. Original user and Claude work is preserved.
