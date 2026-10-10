# UA picker hardening — 2026-10-08

Status: implementation and fixture acceptance complete; full TypeScript and authenticated preview acceptance remain open. No commit, push, PR, deployment, or database changes.

## Scope and baseline

- Isolated branch `codex/ua-picker-hardening`, based on `origin/main` at `e5b141cd` (includes the $192 / $357 allowance correction).
- Owners: `src/app/(app)/gear/GearPicker.tsx`, `GearPicksSheet.tsx`; existing catalog, API/service pricing, permissions, serializable writes, and participant-only access were inspected and preserved.
- Contracts: `docs/AREA_GEAR_PICKS.md`, D-063 in `docs/DECISIONS.md`, repository web UI and recovery rules. No matching gear brief or existing gap record.

## Bounded plan and result

1. Inspect picker, query hook, review sheet, direct consumers, route/service, and tests: complete.
2. Protect list/version ownership, in-flight editing, and failed reload/background-read recovery: complete.
3. Surface durable recovery and filter-reset actions with visible narrow-screen remaining allowance: complete.
4. Browser regressions and matched visual review: complete using synthetic staff/API fixtures.
5. Authenticated preview and full TypeScript acceptance: pending boundaries below.

## Verification

- `npx vitest run tests/gear-picks-pricing.test.ts tests/gear-picks-routes.test.ts`: 45 passed.
- `npx playwright test --config playwright.gear.config.ts`: 7 passed. Browser install prerequisite: `npx playwright install chromium`. This dedicated runner does not add a browser dependency to the default Vitest CI job.
- `GEAR_PICKER_BASELINE=1 npx playwright test --config playwright.gear.config.ts` loads the two original components directly from Git HEAD without modifying the working files. Six original regressions failed in the initial baseline run; the added review recovery regression failed in a later focused baseline run. Failures cover rebasing dirty versions, background read unmounts, reload failure feedback, in-flight editing, deadline rejection, review recovery, and missing filter reset.
- Changed-file ESLint passed; application build's full lint completed with existing warnings in kiosk dashboard, Sidebar, and bookings-checkin.
- `npm run build:app`: passed (application-only; no migration deployment).
- `npx tsc --noEmit --pretty false`: two existing TS2532 errors, `tests/ios-auth-design.test.ts:18` and `tests/ios-flat-surface.test.ts:15`; both access regex capture index 1 without narrowing. Those files are unchanged.
- Local runtime is Node 24.21.0; project declares Node 22.x. No runtime or dependency versions changed.
- `npm run preview:setup`: no hosted environment for this new branch; an authorized push and PR plus passing CI/Managed previews are prerequisites under D-063. No other branch's credentials used.
- Browser evidence uses actual picker/query/UI components with Next navigation/image/link adapters and intercepted synthetic API responses. It does not prove authenticated session handling, database persistence, or production behavior.
- Review: [before/after captures and receipts](archive/proofs/ua-picker-2026-10-08/review.html). Desktop 1280×900 and narrow 390×900, matching fixtures, fixed clock, light theme, source snapshots, and recorded hashes.

## Next gate

Resolve the two repository TypeScript errors in their owning work, then (with shipping authorization) push/open a PR to obtain this branch's managed preview and exercise authenticated save, conflict, reload, and submit flows. Keep this ledger active until those gates close.

## Design and experience follow-up

User requested a substantive design/UI pass after the initial reliability work. Primary skill: frontend-design, with existing components and brand typography preserved. Scope extends to GearItemCard and GearPickLineList; the latter remains read-only on profile screens unless edit callbacks are supplied.

- Compact expandable kit, clearer catalog heading, wider product cards with stacked names/prices, larger swatches, explicit picked status, mobile filter disclosure, and a budget-first action bar.
- Inline size/quantity editing in both list and review, with validation and save locks intact.
- 9 Chromium checks passed. New inline-review behavior sends the chosen size and quantity in the actual fixture save request, updates totals, rejects a missing apparel size, and disables edits while submitting. The same test fails on the pre-design baseline for the missing controls.
- Matched baseline includes the first pass's uncommitted source: preserved in `archive/proofs/ua-picker-design-2026-10-08/baseline-source/` as text snapshots plus its patch. Test runner can load it with GEAR_PICKER_BASELINE_DIR; no working file was reverted.
- [Design comparison](archive/proofs/ua-picker-design-2026-10-08/review.html): desktop catalog, narrow catalog, and narrow review. Fixture shells intentionally do not claim authenticated app-shell proof.
- A concurrent TypeScript check raced the build's regenerated .next types; that result was discarded and the final checks run sequentially. Final standalone TypeScript and build results are recorded below.

Final design gate results: application-only build passed; changed-file ESLint, docs/codemap verification, local link sweep, and diff check passed. Sequential standalone TypeScript reported only the same two existing TS2532 errors. The local review rendered all six comparison images without horizontal overflow and was visually inspected. Authenticated preview remains unavailable for this branch; no shipping actions taken.

User wording correction: the kit is **Standard issue**, covered by the department separately from the pick allowance. Picker disclosure and review copy updated; prior screenshots preserve their historical wording.

## Approved sizing and selection follow-up

User approved all five audit findings. Plan: share item-specific sizing between client and pricing; restrict profile defaults to matching top/shoe fits; require explicit bottoms and fitted-headwear sizes; edit colors directly in review; default allowance filtering off; update shopping language. Preserve saved invalid sizes visibly until corrected. Verify pricing/default regressions and browser color/filter interactions, then build, lint, docs, and matched review. No schema or shipping changes.

Sizing evidence: Downloads/Under Armour/FW27_AE_Headwear_Wisconsin.pdf pages 2, 6, 9 establish distinct fitted-hat options; Wisconsin Licensed Footwear.pdf page 1 establishes shoe/slide ranges; FW27 Wisconsin Pinnacle B2B.pdf establishes even waist sizes 30–50 for 6021743. Icon Lo's source does not explicitly identify the US men's/women's scale, so it receives no profile default and is labeled catalog size pending confirmation.

Completed locally: required item sizing in both browser and pricing; exact options for three fitted hats, three shoes/slides and waist-size Drive Pant; safe same-fit profile defaults; explicit color edits with duplicate feedback; optional allowance filtering and product language. 53 pricing/route tests and 11 browser checks pass. Eight sizing/default tests fail for the intended reason on an isolated pre-change source copy. Application build and changed-file lint pass. Sequential TypeScript still reports only the same two unrelated errors.

[Selection review](archive/proofs/ua-picker-fit-2026-10-08/review.html) compares the preserved prior dirty state with this follow-up. Icon Lo scale remains unconfirmed: user answered “Men's, I'm guessing”; no conversion or automatic default was added.

Color-edit browser regression also fails on the preserved source because the color control is absent. The old filter check stops at the renamed label, so it is not claimed as independent proof of the old filtering behavior. Matched selected screenshots were visually inspected. Docs/codemap and diff checks pass.

## Shipping gate (2026-10-08)

User authorized commit, push, and merge. Integrated main's How it works splash and aligned its advice with the new sizing/filter/color behavior. Fixed narrow regex-capture typing in two existing iOS source tests; no assertion or native-code changes. Full suite: 5,564 passed, one skipped; 12 browser checks passed; application build, standalone TypeScript, touched-file lint and docs checks passed. PR #442 is open; authenticated branch-preview proof and required hosted checks still precede merge.

Review correction: historical baseline mode now pins e5b141cd4a5e1d939252771cc775d6cee83f51ee and loads the matching gear UI/state/catalog together, rather than resolving HEAD after commit. Baseline-directory snapshots retain their original e5b141cd provenance. Fixture SVG serving now supplies image/svg+xml; intro logo rendering is explicitly checked.
