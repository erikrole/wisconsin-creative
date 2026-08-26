# Resources Card Interaction Polish - 2026-08-26

## Goal

- Make `/resources` feel calmer and more intentional at a glance: guide cards should read as quiet, title-first hero surfaces, while actual actions retain a clear affordance.
- Preserve the guide-first information architecture, URL-backed filters, reference behavior, permissions, data contracts, and the documented Resources toolbar exception.

## Route

- Owner area: Resources
- Ledger: `tasks/todo.md`
- Area doc: `docs/AREA_RESOURCES.md`
- Existing plan context: `tasks/resources-ownership-pass.md` is complete; this is a separate visual interaction slice.

## Source checks

- `src/app/(app)/resources/page.tsx` owns `GuideCard`, `GuideListRow`, `ReferenceCard`, and `ContactCard`.
- Guide cards and list rows now keep only the title plus compact type/status cues on the landing surface; previews, visibility/audience labels, authors, and dates remain available in the guide reader.
- `ios/Wisconsin/Views/GuidesView.swift` owns the native `GuideRow`; it now follows the same title-first presentation without summary, audience, author, or date content in the list row. The existing Swift model, `/api/resources` list contract, search index, and reader header remain unchanged.
- Guide cards and list rows no longer apply whole-surface border/shadow hover treatment; contact cards are also quiet because only their fields and `View profile` button are actions.
- `docs/AREA_RESOURCES.md` keeps guides primary and Contacts/Sport assignments as supporting references.
- `docs/DESIGN_LANGUAGE.md` requires shared primitives, visible focus, 40px targets, and restrained functional motion; `docs/COLOR_SYSTEM.md` has no new semantic color need.

## Stop conditions

- Stop if the current route or area contract requires whole-card hover state as a product signal.
- Stop if the refinement requires API, schema, permission, or shared-primitive changes outside this route.
- Keep the existing URL/filter/search, guide link, contact link, and reference click behavior unchanged.

## Slices

- [x] Slice 1: Remove misleading whole-card hover emphasis from guide and non-actionable contact cards; preserve visible focus and 0.96 press feedback.
- [x] Slice 2: Add a restrained guide-card affordance and improve the quiet metadata/icon hierarchy without introducing decorative motion or new semantic colors.
- [x] Slice 3: Add focused source-contract coverage, sync the Resources area/task review, and run repository gates.
- [x] Slice 4: Capture matched before/after visual review and record any authenticated-browser boundary.
- [x] Slice 5: Reduce guide results to title-first hero cards/list rows while preserving compact type/status cues and existing search payload behavior.
- [x] Slice 6: Mirror the title-first guide hierarchy in the native iOS list row without changing API, model, search, or reader behavior.

## Verification

- [x] Focused Resources tests, including the new card-interaction contract.
- [x] Full `npm run lint`.
- [x] `npx tsc --noEmit --pretty false`
- [x] `git diff --check`
- [x] `npm run build:app`
- [x] `npm run codemap:check` / `npm run verify:docs` if generated route maps are affected.
- [x] Authenticated in-app browser proof at desktop (1428 × 1153) and narrow (390 × 844); guide surfaces show title/type/status only and hover keeps the card quiet while the local chevron moves 2px.
- [x] Matched before/after UI review page with measured visual notes from a source-equivalent fixture (1280 × 895 capture, 320 × 128px card).
- [x] Focused iOS source-contract coverage for the title-first `GuideRow` and the existing native Guides/API contract.
- [x] `npm run ios:project:check` and `npm run drift:ios`.
- [x] `npm run audit:ios:gaps`.
- [x] Xcode simulator build for the `Wisconsin` target on the available iPhone 16 Pro, iOS 26.5 destination.

## Review

- Shipped: Title-first guide card/list-row surfaces, quiet guide/contact hover behavior, localized guide affordances, and retained action hover for reference shortcuts.
- Shipped: Native iOS Guides now uses the same title-first list hierarchy; the list row no longer renders summary or update-date metadata, and its VoiceOver label matches the visible title/type/status content. The existing API/model/search/detail reader contract is unchanged.
- Verified: 11 focused Resources tests, 45 focused iOS contract tests, full lint, TypeScript, migration check, whitespace, codemap/docs checks, iOS project/drift/gap checks, matched fixture measurements, authenticated desktop/narrow browser rendering, `npm run build:app`, and the `Wisconsin` iPhone 16 Pro iOS 26.5 simulator build.
- Deferred: Production deployment/read-back and native simulator visual walkthrough remain separate release gates.
- Blocked: None.
- Proof artifacts: `tasks/resources-card-interaction-polish-review-2026-08-26/review.html` with matched captures/spec, `docs/AREA_RESOURCES.md` and `docs/AREA_MOBILE.md` changelogs, `tasks/todo.md` review, and source contracts `tests/resources-ui-polish-source.test.ts` plus `tests/ios-guides-ui-polish.test.ts`.
- Next slice or stop: Stop this slice; the local dev server remains running for continued in-app review.
