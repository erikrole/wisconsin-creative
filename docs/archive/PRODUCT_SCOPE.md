# Wisconsin Creative Product Scope Index

## Document Control
- Owner: Erik Role (Wisconsin Athletics Creative)
- Product: Wisconsin Creative
- Last Updated: 2026-03-11
- Status: Living index
- Purpose: route planning work to focused area files so implementation agents can load only relevant context

## Product Mission
Replace Cheqroom with an athletics-first, event-driven gear system for Wisconsin Athletics Creative across Camp Randall Stadium and Kohl Center.

## North Star
Read `NORTH_STAR.md` first in any Claude session. It is the authoritative product direction document: what Wisconsin Creative is, who it serves, product principles, decision filters, roadmap, and gaps in current planning.

## Core Invariants
1. Asset status is derived from active allocations, never authoritative stored status.
2. Booking integrity protections remain intact (SERIALIZABLE + overlap prevention).
3. Audit logging integrity is preserved for every mutation path.
4. Mobile-first usability remains a baseline requirement.

## Area Files
1. Dashboard: `AREA_DASHBOARD.md`
2. Items: `AREA_ITEMS.md`
3. Checkouts: `AREA_CHECKOUTS.md`
4. Reservations: `AREA_RESERVATIONS.md`
5. Events: `AREA_EVENTS.md`
6. Notifications: `AREA_NOTIFICATIONS.md`
7. Users: `AREA_USERS.md`
8. Importer: `AREA_IMPORTER.md`
9. Mobile Operations: `AREA_MOBILE.md`

## Phase Sequence Across Areas
1. Phase A (Now):
   - ✅ Checkouts + Equipment Picker (Checkout UX V2 — complete, PRs 20–25)
   - ✅ Events foundation + ICS sync hardening (complete, PRs 26–30)
   - ✅ Reservations V1 (complete, PRs 33–38)
   - ✅ Items V1 (complete, PRs 31–32)
   - ~~B&H metadata enrichment~~ (withdrawn — scraping blocked)
   - ⬜ Student mobile hardening
2. Phase B (Next): Dashboard expansion + Notifications escalation (D-009) + Picker improvements + Calendar source health UI.
3. Phase C (Later): Templates, kiosk, board, analytics, and integrations.

## Immediate Brief Queue
1. ✅ Checkout UX v2 — Complete.
2. ~~B&H metadata enrichment~~ — Withdrawn (scraping blocked by source).
3. ✅ Event sync phase 1 — Complete.
4. Student-first mobile operations hardening — Write `BRIEF_STUDENT_MOBILE_V1.md` before implementing.

## Implementation Brief Files
1. ✅ Checkout UX V2: `BRIEF_CHECKOUT_UX_V2.md` — Shipped.
2. ✅ Reservations Lifecycle V1: `BRIEF_RESERVATIONS_V1.md` — Shipped.
3. ✅ Items List + Create + Detail V1: `BRIEF_ITEMS_V1.md` — Shipped.
4. CSV Importer V1 (Cheqroom preset): `BRIEF_CHEQROOM_IMPORTER_V1.md`
5. B&H Enrichment V1: `BRIEF_BH_ENRICHMENT_V1.md` — Ready.
6. Student Mobile V1: `BRIEF_STUDENT_MOBILE_V1.md` — Pending creation.

## Working Rule for Claude Sessions
1. Read `NORTH_STAR.md` first — it is the product direction anchor.
2. Load only the relevant `AREA_*.md` file.
3. Load `DECISIONS.md` only for invariants that affect the change.
4. Use `FEATURE_BRIEF_TEMPLATE.md` to scope the request before implementation.
5. For role or visibility changes, always include `AREA_USERS.md`.
6. For dashboard, list, or scan changes that touch phone UX, include `AREA_MOBILE.md`.

## Sync Checklist (Required Per Scope Update)
1. Update `DECISIONS.md` if behavior changes a durable rule.
2. Update relevant `AREA_*.md` files in the same pass when shared behavior changes.
3. Confirm role effects in `AREA_USERS.md` for any action or visibility change.
4. Confirm mobile effects in `AREA_MOBILE.md` for any dashboard, reservations, check-outs, or items change.
5. Update affected `BRIEF_*.md` files when acceptance criteria or file scope changes.

## Change Log
- 2026-03-01: Converted monolithic scope doc into area-index model.
- 2026-03-01: Added standalone users and permissions area file.
- 2026-03-01: Added implementation brief file index for checkout and reservation hardening work.
- 2026-03-01: Added items implementation brief file.
- 2026-03-01: Added importer area and Cheqroom CSV importer brief.
- 2026-03-02: Added mobile operations area and scope-sync checklist.
- 2026-03-09: Added NORTH_STAR.md reference as first read. Updated phase sequence and brief queue to reflect shipped Checkout UX V2 and Event sync. Added pending briefs for B&H enrichment and student mobile.
- 2026-03-11: Docs hardening pass — marked Reservations V1 and Items V1 as shipped. Updated B&H enrichment status to Ready. Synced brief index to reality.
