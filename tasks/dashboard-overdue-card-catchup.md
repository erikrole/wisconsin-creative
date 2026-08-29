# Dashboard UI Catchup

## Scope

Bring the dashboard overdue checkout card and the remaining action columns into the current site UI without changing their data, permissions, routes, or behavior.

## Peer patterns checked

- Dashboard action-lane cards: shared `Card`, neutral surfaces, compact bordered headers, sentence-case labels.
- Dashboard booking rows: neutral row hover, bold booking title, semantic status badge, keyboard focus ring.
- Operational status rail: semantic red is reserved for urgency signals instead of tinting the entire surface.

## Checklist

- [x] Replace the bespoke red-wash container with the shared card primitive.
- [x] Align the header, count badge, row density, hover state, and action buttons with current dashboard patterns.
- [x] Preserve detail-sheet selection, checkout link, permission gating, and nudge feedback.
- [x] Normalize dashboard action cards to flat shared surfaces and consistent header and row density.
- [x] Remove full-row severity washes while preserving semantic rails and badges.
- [x] Refresh column labels, empty states, shift rows, draft rows, and event rows using current dashboard patterns.
- [x] Run focused tests, TypeScript, lint, migration checks, whitespace checks, and `build:app`.
- [ ] Authenticated browser smoke. The local app reached the sign-in boundary, but the available in-app browser had no authenticated Wisconsin Creative session.

## Verification

- `npx eslint src/app/(app)/dashboard/overdue-banner.tsx`
- `npx vitest run tests/scan-route-gate-contract.test.ts tests/booking-realtime-sync-source.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run db:migrate:check`
- `npm run build:app`
- `git diff --check`
