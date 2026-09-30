# Wisconsin Creative — System Roadmap

## Document Control
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-09-25
- Status: Living roadmap. Update it when a release closes or priorities change.
- Scope: A system-wide release plan after V1 (Cohesive Foundation) and V2 (Connected Experience) shipped
- Previous: 2026-04-03. That revision was six months stale: it counted 112 API routes, still listed web `/scan`, and treated the native kiosk as a V3 idea.
- Constraints: [NORTH_STAR.md](../docs/NORTH_STAR.md) decision filters, [DECISIONS.md](../docs/DECISIONS.md), [GAPS_AND_RISKS.md](../docs/GAPS_AND_RISKS.md)

---

## Headline

The product is mature enough that the bottleneck is no longer features. It is **rollout skew**: work that is implemented locally but not deployed, migrations that were never applied, and acceptance that is still waiting on signed-in or physical-device proof. That backlog touches more than 15 areas.

Release plan:

- **R1** ships no new features. It lands and proves what already exists.
- **R2** adds game-day readiness features that pass the North Star filters.
- **R3** is a pattern-gated set of "intelligence" work.

Any roadmap that starts new features before R1 clears is fiction. Every new slice adds to the proof backlog it cannot drain.

---

## STEP 1: SYSTEM OVERVIEW

### Core System Purpose

Wisconsin Creative is the operational command system for Wisconsin Athletics Creative. It covers gear custody, event-linked reservations, crew scheduling, and game-day handoffs, and it replaced Cheqroom. The main value is speed, clarity and trust at the physical handoff. Its advantage is athletics-specific context: events, call times, venues, item-family battery units, Wiscard identity, and the staffed-counter kiosk.

### Users and daily workflows

| Mode | Surface | Daily job |
|---|---|---|
| Students / student staff | Native iOS (the Android PWA gets push only) | Reserve gear, see due and overdue gear, work shifts, trade shifts, set availability |
| Gear counter | Native iPad `WisconsinKiosk` | Immediate checkout, reservation pickup, return, and active-checkout edits. This is the only custody boundary (D-040). |
| Staff operators | Web control room, iOS, macOS menu-bar companion | Supervise bookings, author the Schedule and crews, resolve exceptions |
| Admins / owner | Web | Settings, imports, users, reports, Software Vault, app activity (D-054) |

### Domain maturity (2026-09-25)

| Domain | Maturity | Open edge |
|---|---|---|
| Checkouts / Reservations | Polished | Partial pickup leftovers (GAP-80), duplicate-checkout merge (GAP-77), shared travel case (GAP-76) |
| Kiosk | Polished | No "wrong person" undo; counted-only shared reservations have no pickup path; the `UIRequiresFullScreen` deprecation (AREA_KIOSK) |
| Items / Bulk inventory / Kits | Polished / Solid | Bulk mutation ops (AREA_ITEMS); kiosk replay of battery integrity (AREA_BULK_INVENTORY AC-14); Sony battery family (GAP-74) |
| Events / Schedule / Shifts | Solid | Combined events (GAP-75, 0142), authoring (GAP-81, 0148), timed release (GAP-60), week view and gear readiness (AREA_EVENTS) |
| Dashboard / Home | Polished | "Your day" agenda and nudges are in flight on this branch |
| Notifications | Polished | Overdue escalation (0111, GAP-64), Android push acceptance (GAP-73) |
| Users / Onboarding / Collaborators | Polished / Solid | Invites and roster (GAP-66/67/68), collaborator smoke tests |
| Reports / App activity | Solid | Owner app activity acceptance (GAP-70) |
| Resources / Brand assets / Importer | Solid / MVP | GAP-72, GAP-79 |
| Software Vault / Licenses | MVP→Solid | Hardening not deployed; key rotation (GAP-69) |
| Signatures / Badges / Scoreboard | Solid | GAP-65, 0127/0147, GAP-71 |
| Search | MVP | No cross-domain API; scoped client search only |
| Scan (web) | Retired by design | iOS and the kiosk own scanning |

---

## STEP 2: CURRENT ARCHITECTURE

- **Surface:** 77 web pages under `src/app/(app)`, 335 API routes, 92 Prisma models. The clients are web, iOS (`Wisconsin`), the iPad kiosk (`WisconsinKiosk`), the macOS menu-bar companion, and the Android PWA.
- **Established patterns (V1/V2, keep them):**
  - React Query for server state and `useUrlState` for URL-backed filters.
  - Shared shadcn primitives.
  - Services in `src/lib/services/*` own mutations.
  - Every mutation writes an audit entry.
  - Status is derived, never stored (D-001).
  - `SERIALIZABLE` transactions protect custody writes.
- **Real inconsistencies now:**
  - **Contracts between the server and its clients.** JSON shapes drift against Swift `Codable` types and the macOS companion projection; secondary clients get missed (lessons.md). Source-contract tests cover this partially and case by case.
  - **Freshness.** Dashboard, list and detail can disagree after mutations or cached reloads. This is NORTH_STAR planning gap #1.
  - **Kiosk mutation logic.** Some still lives in oversized native and API files instead of services (NORTH_STAR focus #2).
- **Schema with no surface:**
  - `SportShiftConfig` appears superseded by call windows owned by Settings.
  - `BookingAccountabilityExclusion` and `ScheduleEventFollow` have no routes.
  - Diagnostics models (`AppDiagnostic`, `JobRun`, `ProductEvent`, `FirmwareWatchTarget`) are ingest-only.
  - The decision to make: retire these models or wire them up (GAP-83).
- **Dead ends / orphans:** no systemic issue. Web `/scan` was retired on purpose.

---

## STEP 3: RELEASE ROADMAP

V1 (Cohesive Foundation, 2026-03-24) and V2 (Connected Experience, 2026-03-27) are complete. The V2+ items from April have mostly shipped since: CSP, `useUrlState`, deactivation UI, student availability V1, and shift and trade notifications.

### R1 — "Land It" (target: before the end of the regular football season)

**Goal:** zero rollout skew. Every implemented slice is deployed and proven in production, or it is explicitly parked.

**Migrations to apply, then prove in production:**

| Migration | Feature | Gap |
|---|---|---|
| 0111 | Overdue escalation policy | GAP-64 |
| 0127 / 0147 | Badges and preview repair | AREA_BADGES |
| 0129 | Owner app activity | GAP-70 |
| 0132 / 0133 | Scoreboard ties | GAP-71 |
| 0142 | Combined events, then combine the live Cross Country pair | GAP-75 |
| 0143 | Shared checkout | GAP-76 |
| 0148 | Event authoring | GAP-81 |

Confirm `PENDING_PICKUP` has zero rows, then drop the enum value (GAP-61).

**Deploy work that is only local:**
- Bookings and Search quality-of-life (todo.md)
- Software Vault hardening (AREA_SOFTWARE)
- Native partial-pickup client (GAP-80)
- The in-flight Home "Your day" agenda and booking nudges

**Infrastructure leftovers (GAPS rollout note, 2026-09-22):**
- Production pooling deploy
- Patched lockfile
- Redis on Preview
- Managed workflow activation
- Native-preview cutover

**Proof debt:**
- Signed-in web proof: `/licenses`, `/schedule` activity counts, approval-first claims, the Trade Board, event correction
- Passkeys in production (GAP-62)
- Android push on a physical device (GAP-73)
- Timed release (GAP-60)
- iOS Student preview

**Enabler (M):** a durable signed-in Playwright harness. It is NORTH_STAR planning gap #6 and is currently "not a blocker", but it is now the single biggest throughput limit on R1. Promote it.

**Enabler (S):** a single rollout ledger listing each migration or slice with its status in local, Preview, production and proof (GAP-82).

**Exit criteria:** GAPS_AND_RISKS "Rollout skew" is empty, or every remaining row names a parked reason.

### R2 — "Game-Day Ready" (spring 2027 planning window)

**Goal:** reduce friction at the three moments that matter: prep, counter and return. Every item traces to a stated gap and passes the NORTH_STAR filters.

1. **Booking freshness contract (M–L).** Define a truth cursor or version per booking, and one invalidation contract across web React Query, iOS, the kiosk and the macOS companion. This is the #1 NORTH_STAR planning gap. It enables everything in R3.
2. **Kiosk service extraction (M).**
   - Move active-checkout edit, pickup and return mutations into `src/lib/services`, with service tests.
   - Shrink the oversized kiosk Swift files.
   - Prerequisite for the kiosk features below.
3. **Kiosk counter recovery (M).**
   - "Wrong person" undo within a short audited window.
   - A pickup path for counted-only shared reservations.
   - Replace `UIRequiresFullScreen` before the OS drops it.
4. **Schedule V2: week view with gear readiness (L).**
   - A per-event readiness signal: crew staffed, gear reserved, gear picked up.
   - Conflict surfacing.
   - Read-only projection; it does not cascade into bookings.
   - AREA_EVENTS.
5. **Item-family operations (M):**
   - Football Sony batteries (GAP-74)
   - Battery Ops repair tools (NORTH_STAR suggestion #3)
   - Kiosk battery-integrity replay
6. **Items bulk mutation (M).** Bulk category, location and retire actions with full audit (AREA_ITEMS). Reuse the guards from the single-item endpoints; lessons.md records a history of bulk endpoints missing them.
7. **Operational reports (M).**
   - Utilization by family, repeat-overdue students, and pickup no-shows.
   - Tables and exports, not charts.
   - "Reports before analytics" (NORTH_STAR).
8. **Custody corrections (M):** duplicate-checkout merge (GAP-77) and serialized ownership transfer follow-through (GAP-78).
9. **Onboarding at season turnover (S–M).** Email-first invites, roster CSV preload and persisted invite failure (GAP-66/67/68), in time for the 2027 roster.

### R3 — "Anticipate" (gated; start only after the named evidence exists)

| Candidate | Gate | Notes |
|---|---|---|
| Reservation templates | Review of real re-reserve usage. Re-reserve from a past booking shipped on 2026-09-16. | NORTH_STAR §12. Name the first 3 templates from the data, not from guesses. |
| Unified search V2 (`/api/search` across items, bookings, users, events) | Search telemetry shows cross-domain misses | Search is the weakest-maturity user-facing area |
| Game-day board view | R2 Schedule readiness shipped and used | Currently deferred scope |
| Suggested gear by event type or sport | Templates exist; the suggestion is a pre-fill only | Must not auto-create bookings |
| Proactive nudges (pickup window, return before next shift) | Nudge history service (in flight) proves the signal is not noisy | Extends `src/lib/nudge-window.ts` |
| Equipment guidance rules in the database (D-016) | A repeated real mistake that code-defined rules cannot express | Stays code-defined until then |
| Maintenance / firmware coverage for DJI, GoPro, Insta360, JVC (GAP-59) | Operator demand | Keep it narrow |

**Explicitly rejected** by the NORTH_STAR filters and recorded decisions. Do not re-propose these:

- Bulk scan-session check-in outside the kiosk. The kiosk owns custody (D-040).
- Event time changes cascading into gear windows. Gear windows stay independent by product decision; manual event correction moves the crew only.
- Shift assignment automatically granting checkout custody (D-040).
- Equipment health scoring, peak-usage prediction, or general usage analytics (D-054 scope; the "analytics creep" risk).
- A public Scoreboard or public accountability publishing (D-056, deferred scope).
- Unattended kiosk security (PIN/NFC) while the counter is staffed.
- SMS or Slack channels (AREA_NOTIFICATIONS, out of scope).

---

## STEP 4: CROSS-CUTTING FEATURES

| Feature | Current | R1 target | R2 target |
|---|---|---|---|
| Error handling | Consistent on web; clients decode tolerantly | Add a tolerant-decode check to production proof | Shared error codes across all clients |
| Loading / empty states | Consistent | — | Readiness states in the Schedule week view |
| Toasts / confirmations | shadcn Sonner and AlertDialog | — | Undo toasts for reversible kiosk and bulk actions |
| Form validation | Zod on the server; mixed on the client | — | — |
| RBAC | Enforced in services and routes | Proof with signed-in role previews | Bulk endpoints reach guard parity |
| Audit logging | Every mutation | Plan an audit export before retention deletes (existing risk) | Audit read-back in reports |
| Freshness | Per-surface invalidation | Documented | Truth-cursor contract on all clients |
| Client contracts | Case-by-case source-contract tests | — | Generated or shared response fixtures checked against the web, Swift and macOS clients |
| Mobile | Native iOS first-class; the web is responsive | — | — |
| Accessibility | Free SwiftUI and shadcn basics only (30–60 known users) | — | — |

---

## STEP 5: DATA & STATE STRATEGY

- **State today:**
  - Web: React Query server state plus URL state.
  - iOS: `APIClient` plus in-view state.
  - Kiosk: location-scoped device auth.
  - macOS companion: a two-read projection with a cache.
- **Risks:**
  - Stale booking reads across clients (freshness).
  - Read-then-write races on custody. These are covered today by `SERIALIZABLE` transactions and DB constraints; keep new custody paths on that.
  - Booking read-path growth needs cursor indexes.
  - 5,000-row CSV exports come close to the function timeout.
  - Audit log growth.
- **R2 recommendations:**
  - A truth cursor per booking, returned by every booking read and mutation.
  - Clients compare cursors and refetch instead of guessing.
  - Cursor pagination on booking lists.
  - Streamed or background CSV exports.
- **R3:** push-driven invalidation over the existing APNs, Web Push and companion channels, only if R2 polling proves insufficient.

---

## STEP 6: DEPENDENCIES & ORDER

```
R1 rollout ledger ─┐
Signed-in harness ─┼─> R1 proof burn-down ─> R1 exit
Migrations deploy ─┘
Freshness contract ─┬─> Schedule readiness ─> Game-day board (R3)
                    └─> Proactive nudges (R3)
Kiosk service extraction ─> Kiosk recovery (undo, counted pickup)
Bulk guard parity ─> Items bulk mutation
Re-reserve usage review ─> Templates ─> Suggested gear (R3)
```

**Quick wins (independent):**
- Drop `PENDING_PICKUP` after the zero-row check.
- Retire or wire the orphan models.
- Build the rollout ledger.
- Replace `UIRequiresFullScreen`.

---

## STEP 7: RISKS & COMPLEXITY

- **Season timing.** Do not land custody-path migrations (0142, 0143, and the partial-pickup client) during a home-game week without Preview proof. Deploy early in a bye or away week.
- **Overengineering.** Game-day board, templates and search V2 each serve real but narrow moments. Keep their gates.
- **Tight coupling.** Four clients read booking shapes. Any contract change needs web, iOS, kiosk and macOS updated together; the Codable and nullability lesson applies.
- **Migration burden.** R1 alone applies about 9 migrations. Ship them in order with health checks (PRISMA_NEON_RUNBOOK) and never batch them blind.
- **Scaling.** Fine at 2× users. At 10× items, booking lists, CSV export and audit growth are the pinch points.
- **Scope creep.** The most likely blur is R2 Schedule readiness turning into event-to-booking cascade. That cascade is rejected; readiness stays a projection.

---

## STEP 8: IMPLEMENTATION STRATEGY

- **Order:**
  - R1: ledger, then harness, then migrations in numeric order with proof each, then local-only deploys, then infra.
  - R2: freshness contract and kiosk extraction in parallel, then kiosk recovery, Schedule readiness, and item-family ops, then bulk items and reports, then onboarding before the 2027 roster.
- **Parallel:**
  - Web-only work (reports, bulk items) runs alongside native work (kiosk extraction).
  - Onboarding is independent.
- **Sequential:** freshness comes before readiness; extraction comes before kiosk recovery.

| Item | Size |
|---|---|
| Rollout ledger | S |
| Signed-in harness | M |
| Migration and proof burn-down | L (many S slices) |
| Freshness contract | M–L |
| Kiosk extraction | M |
| Kiosk recovery | M |
| Schedule week readiness | L |
| Item-family ops | M |
| Bulk items | M |
| Operational reports | M |
| Custody corrections | M |
| Onboarding | S–M |

---

## Change Log
- 2026-09-25: Full rewrite after maturity.
  - V1/V2 are closed.
  - The V2+ and V3 sections are replaced by R1 "Land It" (rollout-skew burn-down), R2 "Game-Day Ready" and R3 "Anticipate" (gated).
  - Architecture counts refreshed.
  - Added an explicit list of rejected ideas with decision references.
  - Added GAP-82 (rollout ledger) and GAP-83 (orphan schema surface).
- 2026-03-23: Initial system roadmap created. Full architecture analysis, three-version plan.
- 2026-03-24: V2 revision. V1 marked complete. V2 plan detailed.
- 2026-03-26: V3 revision. V2 mostly complete. Updated domain maturity levels. New systemic gaps (GAP-19–23).
- 2026-03-27: Alpha → Beta release (v0.2.0). V2 marked COMPLETE. Late additions: React Query, reports charts, search overhaul, favorites UI.
- 2026-03-28: Post-Beta revision. V2+ polish items shipped (dead code cleanup, audit log pagination, calendar sync failure surfacing, CSV export truncation warning). Closed 4 stale gaps (GAP-19, 22, 23 + events monolith risk). All 26 documented gaps resolved except GAP-4 (Phase C unscoped), GAP-11 (cross-page cache), GAP-21 (SystemConfig UI). Updated maturity: Users→Polished, Booking→Polished (audit log pagination). Added reports partial failure and page decomposition backlog. Revised V2+ → V3 boundary.
- 2026-04-03: Security hardening revision. Added Security domain (Polished maturity). Shipped: registration gating (D-029, AllowedEmail table + admin UI), SESSION_SECRET entropy validation (32+ chars), deactivated user login blocking, existing users backfilled to allowlist. Updated pattern consistency analysis — React Query adoption measured at ~70% (Kits/Search/Bookings remain on raw patterns). Added V2+ items: pattern consistency cleanup, user deactivation UI, CSP header. Updated cross-cutting table with Auth & Security row. Revised V2+ recommended order (3 items shipped, 7 remaining). Updated quick wins list.
