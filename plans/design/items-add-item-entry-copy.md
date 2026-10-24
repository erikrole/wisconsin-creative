# Align Items creation entry points on Add item

Written against: 189ea5ab976a61c5ef3db0b5b050e2734c88ebcf

## Evidence chain

- Surface: `/items` for a staff or admin who can create inventory, in both the populated catalog header and the empty-inventory recovery state.
- Problem: the two controls that start the existing item-creation sheet say `New item`, while the sheet itself says `Add item` and the active workflow language requires `Add {thing}` for starting creation.
- Design evidence: `docs/DESIGN_LANGUAGE.md` requires `Add {thing}` for creation entry points and explicitly names `Add item` as the item label.
- Owner: `src/app/(app)/items/page.tsx` owns both launch labels and opens `NewItemSheet`; `src/app/(app)/items/new-item-sheet.tsx` already owns the conforming `Add item` sheet title and final action.
- Scope and affected surfaces: the create-capable `/items` page header and the create-capable no-inventory empty state.
- Uncertainty: none. The contract and the downstream flow use the same exact label.

## Design decision

Rename both `/items` creation launch controls from `New item` to `Add item`. Do not rename the route, component, internal state, sheet owner, or post-create behavior. This makes the entry copy agree with the accepted workflow vocabulary and the sheet users reach.

## Reuse

- Existing `PageHeader`, shadcn `Button`, shared `EmptyState`, and `NewItemSheet` composition.
- Exemplar: `src/app/(app)/items/new-item-sheet.tsx` already renders `Add item` in its `SheetTitle` and submit action.
- Exemplar: `src/app/(app)/users/page.tsx` uses `Add users` for both its creation header action and empty-state recovery.

## Changes

1. `src/app/(app)/items/page.tsx`
   - Change: replace the staff/admin page-header button text `New item` with `Add item`.
   - Preserve: role gating, `canCreateItem` disabling, button priority, `setShowCreate(true)`, and all sibling Import, Fill gaps, Export, and density actions.
   - Verify: selecting `Add item` opens the same `NewItemSheet` with no behavioral change.
2. `src/app/(app)/items/page.tsx`
   - Change: replace the create-capable empty state's `actionLabel` from `New item` to `Add item`.
   - Preserve: the read-only empty state, `canOfferCreateItem` gate, title, description, and `setShowCreate(true)` action.
   - Verify: an authorized user with no inventory sees `Add item`; a user without creation permission receives no creation action.
3. `tests/items-ui-source.test.ts`
   - Change: create this focused source-contract test if absent, or extend it if another selected Items plan created it first. Assert that the page contains both `Add item` entry labels, contains no `New item` user-facing label, and still routes both entry points to `setShowCreate(true)`.
   - Preserve: do not assert internal component names such as `NewItemSheet`, because those are implementation names rather than product copy.
   - Verify: the test fails if either entry point drifts back to `New item`.

## Scope

- Inherit: no shared consumer inherits this route-local copy change.
- Verify: populated catalog, empty inventory, create-permitted and read-only roles, and the opened creation sheet.
- Exclude: `NewItemSheet` component naming, sheet title and submit copy that already say `Add item`, import, item-family terminology, checkout creation, native iOS, and kiosk.

## Validation

- Product: as a create-capable role, open the sheet from the populated header and from the no-inventory empty state; both controls should say `Add item` and reach the same form. Confirm a non-editing role does not gain an action.
- Interface: inspect populated and empty `/items` states at narrow and desktop widths; expect the new label to fit the existing control without clipping, reordering, or changing the primary-action hierarchy.
- System: confirm only the two route-owned launch labels change and that no parallel creation component or copy abstraction is introduced.
- Repository: `npx vitest run tests/items-ui-source.test.ts` -> focused copy contract passes.
- Repository: `npx tsc --noEmit --pretty false` -> no TypeScript errors.
- Repository: `npm run lint` -> no new lint errors.
- Repository: `npm run build:app` -> application build succeeds.
- Repository: `npx playwright test tests/e2e/launch-smoke.spec.ts --grep '/items renders|Items'` -> authenticated Items smoke remains green; if the empty-inventory state is not represented in the fixture, verify that state with a controlled mocked response and record the evidence.
- Repository: `git diff --check` -> no whitespace errors.

## Stop conditions

- Stop if a newer accepted contract changes item creation vocabulary, if either control no longer starts item creation, or if the two entry points are intentionally split into different workflows with distinct product language.

## Design documentation

- After acceptance and validation: add one dated `docs/AREA_ITEMS.md` changelog entry recording the `Add item` entry-point alignment, and update the `/items` Copy evidence in `tasks/design-language-route-conformance-checklist.md`. The governing `docs/DESIGN_LANGUAGE.md` rule already states the accepted decision and needs no edit.
