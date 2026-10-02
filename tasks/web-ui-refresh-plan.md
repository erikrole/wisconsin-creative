# Web UI refresh plan

Owner: Codex with Erik Role. Started: 2026-10-02.
Branch: `codex/web-ui-refresh`.
Status: preview preparation; implementation and visual acceptance pending.

## Outcome and first slice

Bring the current iOS hierarchy, grouped surfaces, consistent section headings,
and action placement to the web. Start with the shared shell and Dashboard,
then carry proven components through Bookings, Items, Schedule, and Settings.
Keep desktop comparison, filtering, and bulk workflows efficient.

## Owners and contracts

- Web shell: `src/components/AppShell.tsx`, `src/components/Sidebar.tsx`.
- Shared presentation: `src/app/globals.css`, `src/components/PageHeader.tsx`,
  `src/components/ui/card.tsx`, existing operational primitives.
- Dashboard: `src/app/(app)/page.tsx` and its direct components.
- Native references: `ios/Wisconsin/Core/Brand.swift` and
  `ios/Wisconsin/Views/HomeView.swift`.
- Accepted direction: [North Star](../docs/NORTH_STAR.md),
  [Design language](../docs/DESIGN_LANGUAGE.md),
  [Dashboard](../docs/AREA_DASHBOARD.md),
  [Mobile](../docs/AREA_MOBILE.md), and
  [Preview environments](../docs/PREVIEW_ENVIRONMENTS.md).

The visual refresh does not grant new permissions or change custody ownership.
Any change to accepted web shape, density, or toolbar rules must be explicit in
the design-language document and reviewed with the affected consumers.

## Execution and acceptance

- [x] Create a dedicated branch from current main in an isolated worktree.
- [ ] Open a draft PR and let CI and Managed previews provision this branch.
- [ ] Attach its encrypted handoff with `npm run preview:setup`.
- [ ] Start `npm run dev:preview`, sign in with `npm run auth:local`, and prove
  the branch-specific Dashboard render and `npm run preview:doctor`.
- [ ] Capture matched before/after states with the same data and viewport.
- [ ] Implement the bounded shared-shell and Dashboard slice.
- [ ] Review light/dark themes, desktop and narrow layouts, keyboard/focus,
  contrast, reduced motion, and loading/empty/error states.
- [ ] Run affected tests, TypeScript, lint, `npm run build:app`, docs checks,
  and the required local `gt-ui-review` page.
- [ ] Update owner docs and acceptance state with actual evidence.

## Current boundary

This initial commit contains planning only. The user authorized a new branch
and preview environment; its draft PR triggers the required hosted provisioning
workflow. UI implementation, production merge, and production deployment are
separate outcomes. Provisioning uses the branch-owned sanitized Neon child and
separate file stores under D-063; no other branch environment is reused.
