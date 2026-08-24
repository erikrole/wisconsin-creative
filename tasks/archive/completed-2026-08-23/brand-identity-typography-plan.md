# Brand Identity Typography Plan - 2026-08-23

## Goal

- Restore Gotham as the recognizable face for primary operational identity across web rows, selection surfaces, and detail context without moving controls, metadata, or prose away from Geist.

## Route

- Owner area: shared web design language.
- Secondary areas: Items, Bookings, Users, Schedule, Reports, and Bulk Inventory.
- Ledger: this plan; archive it after the review and verification gates close.
- Existing plan/archive references: `tasks/archive/design-language-shared-component-consolidation-plan.md`, `tasks/h1-cascade-fix-2026-08-22/`, and `tasks/dashboard-schedule-polish/`.

## Source Checks

- `src/app/globals.css` loads Gotham at 400, 500, 700, 800, and 900; live local and production browser checks confirmed those faces load.
- `body` intentionally remains on `--font-body` (Geist), while semantic headings and shadcn title slots already use `--font-heading` (Gotham).
- `PageHeader`, `DetailPageHeader`, booking list rows/cards, user rows, and item table rows already preserve Gotham for their primary identity.
- Audit candidates were parallel rows that use plain `font-medium` or `font-semibold`. This slice promotes only primary identity: equipment selection/review, selected-equipment chips, item booking history, entity report links/rankings, app-activity people rows, and organization rows. Schedule assignees and battery-family supporting labels remain Geist pending a surface-specific hierarchy decision.
- D-004 and D-013 keep serialized items tag-first. Product names and metadata stay supporting text even when the operational tag is branded.

## Stop Conditions

- Stop if a proposed shared class changes body copy, button labels, form controls, metadata, or prose.
- Stop if an item surface promotes product name above its serialized tag or numbered-unit identity.
- Stop if a shared primitive has consumers where its title is instructional/control copy rather than entity identity; migrate those consumers directly instead.
- Stop if matched before/after proof cannot isolate typography from data, viewport, or layout changes; record the proof limitation instead of presenting an unmatched comparison.

## Slices

- [x] Slice 1: Add one family-only `brand-identity` treatment and document its semantic boundary.
- [x] Slice 2: Migrate verified primary identity rows and selection/review surfaces while leaving supporting copy unchanged.
- [x] Slice 3: Add source-contract coverage, sync the owning design-language doc and task ledger, and build the visual review artifact.

## Verification

- [x] Focused typography and affected-surface source-contract tests.
- [x] `npx tsc --noEmit --pretty false`.
- [x] Focused ESLint for changed TSX and test files, plus full `npm run lint`.
- [x] `npm run codemap` and `npm run verify:docs` when shared source/docs maps change.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [x] Matched before/after browser captures and `gt-ui-review` page, with the authenticated-route limitation recorded.
- [x] Authenticated production smoke confirmed the current org-chart person-name baseline is Geist. Current-source authenticated rendering is unavailable without a local session and is recorded as a proof limitation.

## Review

- Shipped locally: a family-only `.brand-identity` treatment now restores Gotham to shared row/report identity, equipment selection/review, item booking history, organization rows, overdue rankings, and app-activity person rows. Body/UI/supporting copy remains Geist.
- Verified: 16 focused tests, focused and full lint, TypeScript, the 236-page production app build, codemap/docs checks, whitespace checks, loaded Gotham/Geist browser faces, matched 620x404 captures, and the authenticated production baseline.
- Deferred: Schedule assignee labels and battery-family supporting labels remain Geist pending a surface-specific hierarchy decision.
- Blocked: only an authenticated current-source route capture; no local authenticated session was available and nothing was deployed solely for proof.
- Proof artifacts: `tasks/brand-identity-typography-review-2026-08-23/index.html`, its matched captures, fixture, and spec.
- Next slice or stop: stop. The requested identity pass is complete locally; deployment remains a separate release action.
