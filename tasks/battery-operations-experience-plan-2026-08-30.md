# Battery Operations Experience Plan - 2026-08-30

## Goal
- Make Battery Ops the fast staff workspace for understanding and correcting battery inventory without changing the numbered-unit custody model.
- Improve unit review, receiving new batteries, quantity correction for quantity-tracked families, and access to family metadata.

## Product Contract
- Unit-tracked battery availability is derived from permanent numbered units and their effective status. There is no independent live-number override for these families.
- Adding numbered batteries creates the next permanent unit numbers. Correcting an existing family count means recovering, marking missing, or retiring the affected units through the audited status path.
- Quantity-tracked battery families keep their audited stock-adjustment control.
- Product identity remains metadata beneath a family. New numbered units may be assigned an existing active family product as they are received.
- This slice does not add requester gates, change kiosk custody, create the Football Sony Battery production family, or mutate live inventory.

## Bounded Slice
- [x] Extend the Battery Ops read model with active product metadata and per-unit product assignment identity.
- [x] Replace always-expanded two-column family cards with compact one-column operational workspaces.
- [x] Show available/active inventory, status breakdown, low-stock threshold, QR identity, label readiness, and product mix before the unit roster.
- [x] Make actions explicit: `Add units`, `Export labels`, `Edit metadata`, and `Show units`.
- [x] Add product selection to the numbered-unit receiving dialog and preserve the existing reason, resulting unit range, and audit path.
- [x] Keep quantity-tracked families separate with an explicit `Adjust live count` action.
- [x] Add a status filter inside each expanded numbered-unit roster so staff can isolate available, checked-out, missing, or retired units.
- [x] Add focused source/route coverage for the product-aware and count-truth contracts.
- [x] Sync the Bulk Inventory area doc and this plan with verified reality.

## Acceptance
- [x] A staff operator can understand a battery family without scanning every numbered tile.
- [x] Numbered units are hidden until requested, and expanding one family does not create large dead space beside another family.
- [x] Receiving units shows the exact next unit range, resulting available/active totals, reason, and optional product assignment before commit.
- [x] The page explains that numbered availability is derived from units; it never offers a free-form numbered-family count override.
- [x] Quantity-tracked families retain an audited count adjustment with clear before/after impact.
- [x] Family metadata and deeper product/unit management remain one direct action away.
- [x] Existing checked-out-unit, stale-flag repair, label export/confirmation, and unit-status flows continue to work.

## Verification
- [x] Focused Battery Ops tests.
- [x] `npx tsc --noEmit --pretty false`.
- [x] Focused lint for changed source.
- [x] `npm run build:app` in a build-safe environment.
- [ ] Authenticated desktop and narrow-width browser proof without submitting a production mutation.
- [x] Authenticated desktop browser proof completed without submitting a mutation; narrow-width visual proof remains unavailable because the connected browser has no viewport override.
- [x] Matched before/after UI review with measured density improvement.
- [x] `git diff --check` and final scoped diff review.

## Review Notes
- The authenticated desktop review used a development-only 90-unit fixture matched to the deployed family counts and current operating identities. Unit expansion, status filters, and the product-aware receiving dialog were inspected; no mutation was submitted.
- The ordinary Preview database is behind the dirty shared Prisma client, so a normal local database read currently fails before Battery Ops rendering. Production remained read-only and the fixture path is development-gated.

## Stop Conditions
- Stop before any schema or migration work unless the current product/unit model proves insufficient.
- Stop before creating or changing production battery families or units; that remains separately authorized operational work.
- Stop if a proposed count shortcut would bypass effective unit status, active allocations, kiosk return, or audit evidence.
