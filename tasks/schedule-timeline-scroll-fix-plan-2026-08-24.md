# Schedule Timeline Scroll Fix Plan - 2026-08-24

## Goal
- Keep the continuous Schedule timeline anchored on today without covering or displacing the app-shell header, and harden the related restore/prepend behavior.

## Route
- Owner area: Events / Schedule web surface.
- Ledger: this bounded fix plan.
- Existing references: `docs/AREA_EVENTS.md` continuous-timeline contract and `tests/schedule-timeline-source.test.ts`.

## Source Checks
- `AppShell` owns a 48px sticky header at viewport `top: 0`.
- The new Schedule frame also uses `top: 0` with a higher z-index, so anchoring the document to today places the Schedule frame over the app-shell header.
- Day-header stickiness, today scroll margins, offscreen detection, and settle checks currently use only the Schedule frame height; they need the combined app-shell plus Schedule frame offset.
- Archived-row prepend state is captured after the archive filter changes, leaving a cached/immediate response able to race the position capture.

## Stop Conditions
- Stop if the app-shell header height or scroll owner is not the current source contract.
- Stop if the fix requires replacing the document timeline with a new nested scrolling surface.

## Slices
- [x] Slice 1: establish one measured combined sticky boundary below the app-shell header and use it for anchoring, day headers, and offscreen detection.
- [x] Slice 2: capture archived-prepend position before changing the query and add bug-focused source contracts.
- [x] Slice 3: verify focused tests, type/lint/build gates, docs, and authenticated browser behavior when the local session is available.
- [x] Slice 4: keep the app-shell breadcrumb/header visible while fresh and restored timeline positioning moves Schedule beneath it.

## Verification
- [x] `npx vitest run tests/schedule-timeline-source.test.ts tests/schedule-freshness-source.test.ts`
- [x] `npx tsc --noEmit --pretty false`
- [x] focused lint for changed source files
- [x] `npm run build:app`
- [ ] `npm run verify:docs` — blocked by pre-existing `docs/CODEMAPS/architecture.md` drift in the shared dirty tree.
- [x] `git diff --check`
- [ ] Authenticated desktop and narrow browser smoke for fresh arrival, Jump to today, reload restore, back restore, and Load archived events — both available browsers redirected to Login and the local dev environment had no database connection.
- [x] Authenticated browser proof that the breadcrumb remains visible before and after the delayed timeline anchor/restore settles.

## Review
- Shipped: Schedule and day headers now share a measured boundary below the app-shell header and pinned breadcrumb; archived prepends retain the prior reading position from either archive entry point; reload restore is limited to a document that initially loaded Schedule.
- Verified: 23 focused timeline tests, TypeScript, focused ESLint, `build:app`, whitespace checks, and authenticated desktop browser proof. Fresh anchoring kept the breadcrumb at 48–92px; a deep reload restored 9,000px with the breadcrumb still visible, and Event-detail Back retained both the reading position and breadcrumb.
- Deferred: narrow-width visual proof and a matched `gt-ui-review` artifact.
- Blocked: docs verification still sees shared dirty-tree drift in `docs/CODEMAPS/architecture.md` and `docs/CODEMAPS/frontend.md`; this slice did not regenerate or overwrite those parallel changes.
- Proof artifacts: no `gt-ui-review` page was produced because a matched authenticated before/after capture was unavailable.
- Next slice or stop: stop on implementation; the reported desktop breadcrumb and scroll-restoration gap is closed.
