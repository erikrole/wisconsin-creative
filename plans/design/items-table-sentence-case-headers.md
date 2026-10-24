# Render the Items table headers in sentence case

Written against: 189ea5ab976a61c5ef3db0b5b050e2734c88ebcf

## Evidence chain

- Surface: `/items` desktop and tablet table at the `sm` breakpoint and above.
- Problem: `getColumns` supplies sentence-case labels such as `Name`, `Status`, `Category`, `Department`, and `Location`, but the route-owned `TableHead` class forces every visible header to uppercase with added letter spacing.
- Design evidence: `docs/DESIGN_LANGUAGE.md` explicitly requires sentence-case table headers and limits small uppercase labels to metric cards.
- Owner: `src/app/(app)/items/data-table.tsx` owns the rendered desktop `TableHead` presentation; `src/app/(app)/items/columns.tsx` owns the already-correct label strings.
- Scope and affected surfaces: visible `/items` desktop table headers, including sortable and non-sortable columns. Mobile cards do not render table headers and are unaffected.
- Uncertainty: none. The labels are already correct; only the route-level text transformation contradicts the contract.

## Design decision

Remove the `uppercase` and `tracking-wide` utilities from the Items table-header class. Keep the compact 11px size, muted color, 40px header height, sort affordances, sticky header treatment, and column-specific widths. This lets the existing column labels render exactly as authored without changing the shared shadcn `TableHead` primitive.

## Reuse

- Existing shadcn `Table`, `TableHeader`, `TableRow`, and `TableHead` composition.
- Existing sentence-case labels from `src/app/(app)/items/columns.tsx`; no copy mapping is needed.
- Exemplar: `src/components/BookingListPage.tsx` renders sentence-case shadcn table headers without a route-wide uppercase transform.
- Exemplar: `src/app/(app)/users/onboarding-status/page.tsx` renders sentence-case labels such as `Created by` and `Claimed by` directly through `TableHead`.

## Changes

1. `src/app/(app)/items/data-table.tsx`
   - Change: remove `uppercase tracking-wide` from the desktop `TableHead` base class.
   - Preserve: `h-10`, `select-none`, `text-[11px]`, `text-muted-foreground`, sortable cursor/hover treatment, sort icons, header metadata classes, sticky container styling, and mobile-card rendering.
   - Verify: visible labels render as `Name`, `Status`, `Category`, `Department`, and `Location`; sort interaction and indicators remain unchanged.
2. `tests/items-ui-source.test.ts`
   - Change: create this focused source-contract test if absent, or extend it if another selected Items plan created it first. Assert that the Items `TableHead` base class does not include `uppercase` or `tracking-wide` and that `columns.tsx` continues to provide the expected sentence-case labels.
   - Preserve: scope assertions to the Items table so legitimate uppercase metric labels elsewhere remain valid.
   - Verify: the test fails if a route-wide uppercase transform is reintroduced.

## Scope

- Inherit: all current and future visible column labels rendered by the Items desktop `DataTable` inherit sentence-case presentation.
- Verify: default columns, optional staff action column, hidden-column preferences, both density modes, ascending/descending/unsorted states, and the desktop loading-to-data transition.
- Exclude: metric cards, status badges, mobile item cards, column label wording, font size, header height, shared `TableHead` defaults, other routes, native iOS, and kiosk.

## Validation

- Product: open `/items`, sort each sortable column, change density, and verify labels remain sentence case while sorting and row behavior remain intact.
- Interface: inspect the table near the `sm` breakpoint and at a wide desktop viewport in both light and dark themes; expect sentence-case labels, unchanged column alignment, stable header height, visible sort icons, and no truncation introduced by the casing change.
- System: confirm the correction stays in the route-owned `DataTable`, reuses existing column labels, and does not alter the global shadcn table primitive or metric-card typography.
- Repository: `npx vitest run tests/items-ui-source.test.ts` -> focused typography contract passes.
- Repository: `npx tsc --noEmit --pretty false` -> no TypeScript errors.
- Repository: `npm run lint` -> no new lint errors.
- Repository: `npm run build:app` -> application build succeeds.
- Repository: `npx playwright test tests/e2e/launch-smoke.spec.ts --grep '/items renders|Items'` -> authenticated Items smoke remains green; capture or record desktop table proof because the generic smoke is behavior-first rather than pixel-based.
- Repository: `git diff --check` -> no whitespace errors.

## Stop conditions

- Stop if the desktop table no longer renders through this `DataTable`, if a newer accepted design source explicitly exempts Items table headers from sentence case, or if removing the route utilities reveals an inherited global uppercase transform that requires wider design-system work.

## Design documentation

- After acceptance and validation: add one dated `docs/AREA_ITEMS.md` changelog entry recording sentence-case table headers, and update the `/items` evidence in `tasks/design-language-route-conformance-checklist.md` to include the corrected table typography. The global typography rule already exists and needs no edit.
