# Bring Items toolbar controls back to the 40px operational baseline

Written against: 189ea5ab976a61c5ef3db0b5b050e2734c88ebcf

## Evidence chain

- Surface: `/items`, normal unselected catalog state, including the always-visible item-type selector and the expanded advanced-filter row at narrow and desktop widths.
- Problem: the `All`, `Standard`, `Units`, and `Quantity` toggle targets and every advanced facet trigger render at `h-9` (36px), while neighboring sort, Favorites, Filters, Clear, attachment, and active-filter controls render at the required 40px baseline.
- Design evidence: `docs/DESIGN_LANGUAGE.md` requires at least 40px interactive targets, assigns search and filters to `OperationalToolbar`, and records that toolbar child controls keep 40px targets. `tasks/design-language-route-conformance-checklist.md` currently marks `/items` targets as passing, so the implementation and audit record disagree.
- Owner: `src/app/(app)/items/components/items-toolbar.tsx` owns the item-type selector and composes `src/app/(app)/items/faceted-filter.tsx` for Category, Status, Location, Department, and Brand.
- Scope and affected surfaces: the `/items` toolbar whenever no rows are selected; all supported viewports; advanced facet triggers only, not popover contents.
- Uncertainty: none. The required size and the existing in-surface exemplar are explicit.

## Design decision

Set the interactive height of the four item-type `ToggleGroupItem` controls and the shared `FacetedFilter` trigger to 40px. Keep the current compact spacing, labels, variants, borders, selection state, wrapping, and popover behavior. This resolves the root mismatch without changing a shared primitive or widening the change to unrelated routes.

## Reuse

- Existing `OperationalToolbar`, shadcn `ToggleGroup` / `ToggleGroupItem`, and shadcn `Button` compositions.
- Exemplar: the `SelectTrigger`, Favorites, Filters, Clear, and attachment controls in `src/app/(app)/items/components/items-toolbar.tsx` already use `h-10`.
- Exemplar: `src/app/(app)/schedule/assign/_components/AssignPageClient.tsx` uses `h-10` on compact `ToggleGroupItem` controls.

## Changes

1. `src/app/(app)/items/components/items-toolbar.tsx`
   - Change: replace `h-9` with `h-10` on the `All`, `Standard`, `Units`, and `Quantity` `ToggleGroupItem` controls.
   - Preserve: the surrounding bordered group, `p-0.5` inset, `px-3`, `text-xs`, selected value behavior, URL/filter state, and responsive wrapping.
   - Verify: each mode target has a 40px interactive box and switching modes still resets the item results to page one.
2. `src/app/(app)/items/faceted-filter.tsx`
   - Change: replace the facet trigger's `h-9` class with `h-10`.
   - Preserve: `Button` `outline` / `sm` composition, dashed border, count badges, selected-label badges, popover alignment, option selection, and clear-filters behavior.
   - Verify: Category, Status, Location, Department, and Brand triggers align with the 40px attachment control when each conditional filter is present.
3. `tests/items-ui-source.test.ts`
   - Change: create this focused source-contract test if absent, or extend it if another selected Items plan created it first. Assert that all four item-type toggles and the `FacetedFilter` trigger use `h-10`, and that the old `h-9` target declarations are absent from those owners.
   - Preserve: keep each assertion scoped to the exact component instead of enforcing global button sizing.
   - Verify: the test fails if either Items toolbar owner returns to a 36px target.

## Scope

- Inherit: every instance of `FacetedFilter` composed by `ItemsToolbar` receives the corrected trigger height.
- Verify: the no-filter state, active filter badges, more-than-two selected badge state, conditional Department and Brand facets, and narrow-width wrapping.
- Exclude: page-header buttons, table row controls, filter popover rows, shared shadcn primitive defaults, Schedule's documented dense-row exception, native iOS, and kiosk.

## Validation

- Product: search inventory, switch among all four item types, open each available advanced facet, select and clear values, and confirm the result set and URL-backed filter behavior are unchanged.
- Interface: inspect `/items` at approximately 375px, 768px, and 1440px with filters closed and open, including long category/location labels and selected-count badges; expect 40px targets, clean wrapping, no clipping, and no horizontal page overflow.
- System: confirm the change reuses the existing Items owners and does not modify `src/components/ui/button.tsx`, `src/components/ui/toggle-group.tsx`, or introduce another toolbar/filter primitive.
- Repository: `npx vitest run tests/items-ui-source.test.ts` -> focused contract passes.
- Repository: `npx tsc --noEmit --pretty false` -> no TypeScript errors.
- Repository: `npm run lint` -> no new lint errors.
- Repository: `npm run build:app` -> application build succeeds.
- Repository: `npx playwright test tests/e2e/launch-smoke.spec.ts --grep '/items renders|Items'` -> authenticated Items smoke remains green; if credentials or the local authenticated path are unavailable, report that proof as unverified rather than substituting a build.
- Repository: `git diff --check` -> no whitespace errors.

## Stop conditions

- Stop if current source no longer renders these controls through `ItemsToolbar` and `FacetedFilter`, if a newer accepted contract explicitly documents a sub-40px Items toolbar exception, or if reaching 40px requires changing global primitive defaults and widening unrelated routes.

## Design documentation

- After acceptance and validation: add one dated `docs/AREA_ITEMS.md` changelog entry recording the restored 40px item-type and facet targets, and update the `/items` Targets and focus evidence in `tasks/design-language-route-conformance-checklist.md` so its pass claim cites the corrected owners. Do not change the global design rule.
