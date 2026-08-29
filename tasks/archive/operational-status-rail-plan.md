# Operational Status Rail Plan

Date: 2026-07-09
Status: Complete

## Scope

Create one reusable operational status rail for dense app surfaces, then prove the contract on Schedule and Admin Fix Today without moving domain calculations into the shared component.

## Peer Patterns Checked

- Schedule readiness: compact orientation, queue actions, and collapsed metric details.
- Admin Fix Today: queue health indicator, summary metrics, partial-result warning, and section cards.
- Inventory Hygiene: shared metric cards, partial-result warning, and checklist health.
- Shared shadcn layer: Badge, Button, Collapsible, Separator, Tooltip, Card, Progress, and StatusIndicator.

## Checklist

- [x] Audit current route contracts, design language, shadcn setup, and peer operational surfaces.
- [x] Add `OperationalStatusRail` with responsive orientation, prioritized status items, calm all-clear copy, overflow accounting, and optional details.
- [x] Migrate Schedule readiness without changing queue math, filtering, automation, or details behavior.
- [x] Migrate Admin Fix Today and remove its duplicate oversized summary surface.
- [x] Clean touched Fix Today styling to semantic Wisconsin Creative tokens and shadcn composition.
- [x] Add focused source contracts and sync Schedule, Dashboard, design-language, gaps, codemap, and task docs.
- [x] Run focused tests, TypeScript, docs/codemap checks, whitespace, app build, and browser smoke.

## Review

`OperationalStatusRail` now composes shadcn Badge, Button, Collapsible, Separator, and Tooltip primitives into a responsive action-first status summary. Schedule retains its existing queue calculations and expanded readiness metrics, while Admin Fix Today replaces three duplicate summary treatments with one rail and keeps section health indicators. Focused Vitest passed (6 files, 26 tests), along with ESLint, TypeScript, migration-prefix guard, codemaps/docs, whitespace, and `npm run build:app`. The build retains the unrelated `BookingEquipmentTab.tsx` exhaustive-deps warning. Local runtime checks reached both protected routes and received the expected `/login` redirect; authenticated visual inspection was unavailable because localhost had no signed-in session. Dev server: `http://localhost:3001`.
