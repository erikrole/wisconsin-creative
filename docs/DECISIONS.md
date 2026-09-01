# Wisconsin Creative Architectural and Product Decisions

## Document Control
- Owner: Erik Role (Wisconsin Athletics Creative)
- Product: Wisconsin Creative
- Last Updated: 2026-08-27
- Status: Living decision log
- Purpose: track durable decisions, rationale, and downstream constraints

## Decision Index
- D-001: Asset status is derived, not stored
- D-002: Booking is a unified reservation + checkout model
- D-003: Event-centric checkout flow with default linkage
- D-004: Tag-first asset identity in UI
- D-005: B&H enrichment is isolated and non-destructive
- D-006: Data integrity is protected with SERIALIZABLE + exclusion constraints
- D-007: Audit logging is a product feature, not a backend afterthought
- D-008: Mixed-location operations are first-class
- D-009: Notification escalation threshold for overdue
- D-010: Scope and sequencing priorities
- D-011: Tiered role model with inheritance and ownership checks
- D-012: Booking lifecycle transition guardrails for checkout and reservation flows
- D-013: Item identity and item-kind behavior are explicit and non-interchangeable
- D-014: Cheqroom importer must be lossless and non-authoritative for live status
- D-015: Student-first mobile operations contract with role-adaptive action surfaces
- D-016: Equipment picker sections and guidance rules are code-defined in V1
- D-017: DRAFT booking state is valid
- D-018: Asset financial fields are Phase B
- D-019: Department model is Phase B
- D-020: Kit management is Phase B
- D-021: UW asset tag is an optional import field
- D-022: Item families with checkoutable units — one catalog row, optional unit custody
- D-023: Item Bundling via Parent-Child Accessories
- D-024: Booking reference numbers use kind prefix (CO/RV) with global sequence
- D-025: User-facing status labels are display-only — DB enum stays unchanged
- D-026: Event sync runs on daily cron with manual refresh
- D-027: Venue mapping is admin-owned with pattern validation
- D-028: Photo requirement on checkout/checkin — camera-only, scan-only checkin
- D-029: Registration gated by admin-managed email allowlist
- D-030: Kiosk auth uses device-level token, not user sessions
- D-031: Multi-event booking via junction table with preserved primary FK
- D-032: Kiosk person discovery is global; operational reads stay location-scoped
- D-033: Database enforces one active allocation per asset
- D-034: Badge achievements are event-sourced, flag-gated, and profile-first
- D-035: Daily maintenance work is consolidated into morning-refresh
- D-036: Product image search is Brave-backed and human-picked
- D-037: Bulk onboarding uses an invitation-scoped account lifecycle
- D-038: Firmware watch uses official source adapters and silent baselines
- D-039: Kiosk sessions slide on activity and survive reinstalls via Keychain
- D-040: Kiosk-only custody, reservation-first app/web
- D-041: External collaborators use fixed default-deny profiles
- D-042: Schedule edits use a versioned working copy and deliberate publish
- D-043: Passkeys are an additive sign-in method for invite-granted users
- D-045: A shift's coverage window is a settings-derived fallback, not manual intent
- D-046: Schedule edits release automatically after a ten-minute quiet period
- D-047: The macOS companion must not wake Neon
- D-048: Product usage counting is first-party, pseudonymous, and owner-only
- D-049: Web releases use monthly CalVer tags and GitHub Releases
- D-050: Signature capture uses external roster members and private deterministic artifacts
- D-051: Email-first discovery for invite-gated onboarding
- D-052: Shared software credentials use a dedicated encrypted vault boundary
- D-053: Accessibility text sizes are supported, not designed for
- D-054: App activity is an owner-only named client-presence report
- D-055: Student shift claims are approval-first on both paths
- D-056: Scoreboard metrics are shared authenticated team data
- D-057: Event workers are recorded separately from shift scheduling

---

## D-001: Asset Status Is Derived, Not Stored
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Stored status fields drift and become operationally wrong.
- Decision:
  - Asset availability/status is computed from active allocations and booking lifecycle context.
- Consequences:
  - Fewer manual correction workflows.
  - Read-path complexity increases and requires robust query/test coverage.
- Guardrails:
  - No feature may treat stored status as authoritative.

## D-002: Booking Is Unified Reservation + Checkout
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Separate entities increase workflow friction and reconciliation risk.
- Decision:
  - Booking remains the single lifecycle container with states `BOOKED`, `OPEN`, `COMPLETED`, `CANCELLED`.
- Implementation (2026-03-22 — UI layer):
  - Detail page unified: single `BookingDetailPage` component with `kind` prop at `src/app/(app)/bookings/BookingDetailPage.tsx`
  - Route files `/checkouts/[id]/page.tsx` and `/reservations/[id]/page.tsx` are thin wrappers
  - API unified: `/api/bookings/[id]` serves GET + PATCH for both kinds; old routes redirect (308)
  - Shared hooks: `useBookingDetail` (fetch + reload + patch), `useBookingActions` (all actions)
  - Shared `InlineTitle` component at `src/components/InlineTitle.tsx`
  - Kind-specific behavior handled via conditional rendering (scan buttons, checkin UX, convert CTA)
- Consequences:
  - Simpler user mental model.
  - State transition policy must be explicit and validated.
  - UI parity enforced by sharing one component — no feature drift between checkout and reservation detail.

## D-003: Event-Centric Checkout with Default Linkage
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Athletics operations are event-driven; generic checkout defaults waste time.
- Decision:
  - Checkout creation defaults to event linkage with sport selection and upcoming event picker.
- Consequences:
  - Faster booking creation and stronger operational context.
  - Requires reliable event ingest and fallback UX for no-event cases.

## D-004: Tag-First Identity in UI
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Staff identify gear by sticker/tag, not product catalog name.
- Decision:
  - `tagName` is always primary label in list and picker surfaces.
  - `productName + brand/model` is secondary metadata.
- Consequences:
  - Faster physical lookup.
  - Import and enrichment logic must not overwrite tag identity.

## D-005: B&H Enrichment — Withdrawn
- Date: 2026-03-01
- Status: Withdrawn (2026-03-15)
- Context:
  - B&H blocks scraping; enrichment is non-functional.
- Decision:
  - Feature removed. All code, API route, and UI deleted.
  - If metadata enrichment is revisited, use a different source or API with explicit access.

## D-006: Integrity via SERIALIZABLE Transactions + Exclusion Constraints
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Overlapping reservations and race conditions are critical failure modes.
- Decision:
  - Preserve SERIALIZABLE transaction strategy for booking mutations.
  - Preserve PostgreSQL exclusion constraints for overlap prevention.
- Consequences:
  - High safety for concurrent operations.
  - Engineering changes must be tested for lock/retry behavior.

## D-007: Audit Logging Is a Product Feature
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Student-heavy operations require accountable change history.
- Decision:
  - New mutation paths must include auditable logs with meaningful diffs.
- Consequences:
  - Stronger trust and incident resolution.
  - Additional implementation overhead for every new flow.

## D-008: Mixed-Location Is First-Class
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Inventory and return behavior span Camp Randall and Kohl Center.
- Decision:
  - Mixed location support (`itemLocations`, `locationMode`) is part of baseline behavior.
- Consequences:
  - Every picker and return flow must account for location plurality.
  - UX needs clear return-location guidance.

## D-009: Overdue Escalation Policy
- Date: 2026-03-01
- Status: Accepted (2026-03-15); amended 2026-08-10, local rollout pending
- Context:
  - Overdue notifications need requester urgency, admin escalation, and fatigue controls without duplicate noise.
- Decision:
  - Escalation schedule: -2h, due time, grace expiry, +4h, and +24h relative to `booking.endsAt`. Grace applies only to the first overdue boundary.
  - Checkout open and due-time mutations schedule a durable Workflow. Every stage rechecks `OPEN` and the expected due date; the daily cron is repair-only.
  - Late processing sends only the highest currently eligible stage.
  - Dedup key includes booking, due-date version, stage, recipient kind, and recipient ID. Extensions supersede stale workflows without suppressing the new due date.
  - All enabled stages notify the requester. +4h and +24h reach configured location responders, with active staff/admin creator then admin fallback. +24h also reaches all active visible admins.
  - Requester stages and operational fanout use separate per-due-date caps enforced before every insert.
  - In-app rows remain durable. Outbound requester/responder/admin delivery respects checkout category, channel, and pause preferences. Admin push is suppressed unless that admin is also a responder.
  - Implementation: `src/lib/checkout-escalation-policy.ts`, `src/lib/services/notifications.ts`, `src/workflows/checkout-overdue-notifications.ts`, and migration `0111_checkout_overdue_notification_policy`.
- Reference: `AREA_NOTIFICATIONS.md` is the full spec for escalation behavior
- Consequences:
  - Exact durable timing replaces once-daily alert batches while retaining an idempotent repair path.
  - Location ownership reaches the smallest useful operational group before organization-wide admin escalation.
- Guardrails:
  - Do not fan out to all STAFF. Operational escalation is location-scoped with explicit fallback.
  - Do not replay lower stages after a late wake or extension.
  - Grace, manual nudge eligibility, and first-overdue copy must share one threshold.
  - Apply migration and complete authenticated Workflow/push/email proof before calling the amendment production-ready.

## D-010: Sequencing Priorities
- Date: 2026-03-01
- Status: Accepted (updated 2026-03-09 to reflect shipped items)
- Context:
  - Multiple initiatives compete for near-term bandwidth.
- Decision:
  - Prioritize in this order:
    1. ✅ Checkout UX v2 — Complete (PRs 20–25)
    2. ✅ Items page finish — Complete (6-slice redesign, shadcn DataTable, 5-pass hardening 2026-03-22)
    3. ~~B&H metadata enrichment~~ — Withdrawn (D-005, scraping blocked)
    4. ✅ Event sync phase 1 — Complete (ICS ingest, hardening PRs 26–30)
    5. ✅ Equipment picker upgrade — Complete (sectioned picker, guidance rules, PRs 22–25)
    6. ✅ Notification center — Complete (in-app + email via Resend, escalation schedule, D-009 accepted 2026-03-15)
    7. ✅ Student dashboard baseline — Complete (role-adaptive My Gear, BRIEF_STUDENT_MOBILE_V1 shipped 2026-03-15)
- Consequences:
  - Maximizes immediate operational impact.
  - Advanced reporting intentionally deferred.

## D-011: Tiered Role Model with Inheritance
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Operations need broad staff control while preserving student ownership boundaries.
- Decision:
  - Roles follow inheritance: `ADMIN > STAFF > STUDENT`.
  - `ADMIN` can do everything.
  - `STAFF` can add/edit all users, items, reservations, and check-outs.
  - `STAFF` can promote and demote users between roles.
  - `STAFF` can force location exceptions.
  - `STUDENT` can view all users, items, reservations, and check-outs.
  - `STUDENT` can add/edit only their own reservations and check-outs.
  - V1 delete policy uses cancel/archive patterns, not hard delete.
- Consequences:
  - Clear, predictable authorization behavior across dashboard and mutation paths.
  - Requires consistent ownership checks and row-level action filtering.

## D-012: Booking Lifecycle Transition Guardrails
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Checkout and reservation flows are the highest-frequency workflows and the highest risk for integrity bugs.
- Decision:
  - Use explicit transition guardrails:
    - `BOOKED -> OPEN` allowed only where a specific custody flow owns that transition. D-040 supersedes the old app/web reservation conversion path: normal reservation fulfillment now happens at kiosk pickup by opening linked checkout custody and completing the source reservation.
    - `BOOKED -> CANCELLED` allowed by role/policy.
    - `OPEN -> COMPLETED` only when all allocations are returned.
    - `OPEN -> CANCELLED` disallowed in normal flow.
    - `COMPLETED` and `CANCELLED` are terminal in V1.
  - All availability-impacting edits must re-run overlap/conflict validation.
  - Partial check-in is supported but must not complete booking early.
- Consequences:
  - Reduces invalid state transitions and custody gaps.
  - Requires strict action gating in UI and server enforcement on all mutations.

## D-013: Item Identity and Item-Kind Behavior
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Items need clearer operational identity and fewer data-shape ambiguities across list, create, and detail workflows.
- Decision:
  - Serialized assets are tag-first (`tagName`) and must preserve distinct identity semantics.
  - Bulk items follow quantity-first semantics and separate validation path.
  - UI status shown for items is derived from active allocations; no direct editable authoritative status.
  - Item detail header uses a fixed derived-status set with booking-aware deep links: `Available`, `Check Out by {user}`, `Reserved by {user}`, `Checking Out`, `Needs Maintenance`, and `Retired`.
  - Eligibility toggles (reserve/check-out/custody) are policy flags, not live status values.
  - `Delete` on items is reserved for policy-safe records with no active allocations and no historical booking links; otherwise operators use `Retire`.
  - Item detail defaults to an `Info` dashboard view that combines booking overview and editable item information, with QR thumbnail rendering and controlled fiscal-year/category inputs.
- Consequences:
  - Lower risk of identity drift and status confusion.
  - Requires explicit branching in form validation, mutation endpoints, QR uniqueness checks, and delete gating.

## D-014: Cheqroom Importer Is Lossless and Non-Authoritative for Status
- Date: 2026-03-01
- Status: Accepted
- Context:
  - Migration data includes many columns, mixed quality, and legacy status labels that conflict with Wisconsin Creative derived-status architecture.
- Decision:
  - Importer must parse all source columns and preserve unmapped values in source payload metadata.
  - Source `Status` is stored for traceability only and never written as authoritative asset status.
  - Import process supports dry run, create-only, and upsert modes with row-level diagnostics.
- Consequences:
  - Low migration data loss risk and better auditability.
  - Additional implementation complexity in staging and reporting.

## D-015: Student-First Mobile Operations Contract
- Date: 2026-03-02
- Status: Accepted
- Context:
  - Students are primary day-to-day users on phones.
  - Cheqroom-style mobile can become cluttered when admin actions and dashboards are not role-adaptive.
- Decision:
  - Mobile UX is action-first and role-adaptive across dashboard, reservations, check-outs, and items.
  - V1 mobile prioritizes overdue and due-soon execution, scan access, and owned-work actions for students.
  - Event sync remains operational context for booking flows, not a required standalone dashboard module in V1.
- Consequences:
  - Lower cognitive load and faster student task completion.
  - Every area touching dashboard or list interactions must validate behavior against `AREA_MOBILE.md`.

## D-016: Equipment Picker Sections and Guidance Rules Are Code-Defined in V1
- Date: 2026-03-09
- Status: Accepted
- Related design note: `docs/DESIGN_ios-picker-grouping.md` records the accepted first-slice direction for native iOS reservation picker category grouping.
- Context:
  - The checkout picker uses a sectioned kit-first flow with context-aware guidance hints.
  - Configuring sections and rules via a database admin UI adds complexity without clear near-term need.
- Decision:
  - Equipment sections are defined in `src/lib/equipment-sections.ts`.
  - Guidance rules are defined in `src/lib/equipment-guidance.ts`.
  - New sections or rules are added via code PR, not an admin UI.
  - Database-configurable rules are deferred to Phase C.
- Consequences:
  - Fast to add new rules; requires a code deployment.
  - Operators cannot self-serve rule changes without engineering support.
- Guardrails:
  - New guidance rules must be reviewed against actual equipment workflows, not added speculatively.

## D-017: DRAFT Booking State Is Valid
- Date: 2026-03-09
- Status: Shipped (2026-03-16)
- Context:
  - `checkout-rules.ts` handles a `DRAFT` booking state (allows `edit` and `cancel`) but AREA_CHECKOUTS.md and DECISIONS.md did not formally document this state.
- Decision:
  - DRAFT is a valid pre-BOOKED state for interrupted checkout creation flows.
  - DRAFT allows edit and cancel only; no transitions to OPEN or COMPLETED from DRAFT.
  - DRAFT records appear in dashboard Drafts section only; excluded from main checkout list.
- Implementation (2026-03-16):
  - `POST /api/drafts` — create or update a DRAFT booking with partial form data + selected equipment
  - `GET /api/drafts/[id]` — load draft for form pre-fill on resume
  - `DELETE /api/drafts/[id]` — discard a draft (cascade-deletes items)
  - Dashboard: Drafts section in My Gear column with Resume/Discard actions
  - Create flow: auto-saves as draft on cancel if form has data; deletes draft on successful creation
  - Draft items stored as `BookingSerializedItem` / `BookingBulkItem` with no allocations or stock movements
- Consequences:
  - Dashboard Drafts section recovers interrupted flows.
  - DRAFT state is explicitly excluded from checkout list queries (status filter defaults exclude it).
- Guardrails:
  - No new DRAFT behavior (auto-expiry, promotion rules, sharing) without a formal brief.

## D-018: Asset Financial Fields
- Date: 2026-03-11
- Status: Shipped (2026-03-16)
- Context:
  - Schema has `purchasePrice`, `purchaseDate`, `warrantyDate`, `residualValue` on Asset.
- Decision:
  - Financial fields exposed in item detail Info tab → Procurement section for non-STUDENT users.
  - API PATCH endpoint validates and persists all four fields.
  - Import can populate them via CSV.
- Consequences:
  - Staff and admins can view and edit procurement metadata inline on any item.
  - Students do not see financial fields (role-gated in UI).

## D-019: Department Model
- Date: 2026-03-11
- Status: Shipped (2026-03-21)
- Context:
  - `departmentId` FK exists on Asset, Department model exists in schema, but no filter or display in UI.
- Decision:
  - Department is an optional organizational grouping for items.
  - Import can populate it. Department combobox filter shipped on items list page.
- Implementation (2026-03-21):
  - Department FK on Asset, combobox filter on items page, department selectable in new item form.
  - GAPS_AND_RISKS.md Phase B entry struck through.
- Consequences:
  - Items can be filtered and organized by department.

## D-020: Kit Management Is Phase B
- Date: 2026-03-11
- Status: Accepted
- Context:
  - Full Kit/KitMembership schema exists (kit creation, item membership, active status) but zero UI.
- Decision:
  - Kit creation UI and kit-based checkout are Phase B. Schema is ready.
  - V1 imports may reference kits in `sourcePayload` metadata only.
- Consequences:
  - Kit features can be built without schema migration when prioritized.

## D-021: UW Asset Tag Is an Optional Import Field
- Date: 2026-03-11
- Status: Accepted
- Context:
  - `uwAssetTag` on Asset is a university-specific asset tracking identifier from Cheqroom import.
- Decision:
  - Keep as optional field. Importable via CSV. Expose in item detail for admin users.
  - Not a primary identity field — `tagName` remains primary per D-004.
- Consequences:
  - Supports institutional tracking without polluting the tag-first identity model.

## D-022: Item Families With Checkoutable Units
- Date: 2026-03-14
- Status: Accepted
- Context:
  - Items like batteries and consumables are still normal catalog items, but one row represents many identical checkoutable units.
  - Cameras and other serialized gear remain one row per physical asset because serial, history, condition, and identity matter at the catalog level.
  - QR-coded batteries need unit-level custody for pickup, return, loss, and audit without exploding the item catalog into 40+ rows.
- Decision:
  - Keep `BulkSku` as the implementation record for item families and `BulkSkuUnit` as the optional unit-custody record.
  - Product language treats these as item families, not a separate normal-user inventory bucket.
  - `/items` is the primary discovery surface for serialized assets, unit-tracked item families, and quantity-tracked item families.
  - `/bulk-inventory` remains an admin/staff operations cockpit for adjustments, thresholds, unit status, QR labels, and audits.
  - When enabled, numbered `BulkSkuUnit` records (1..N) are created under the parent item family.
  - Unit status (AVAILABLE, CHECKED_OUT, LOST, RETIRED) is stored directly on the unit, not derived.
  - Booking creation requests quantity. Kiosk pickup scans bind exact physical units; kiosk return scans verify those units.
  - Unit QR values derived as `{binQrCodeValue}-{unitNumber}` are accepted as a direct scan of that specific numbered unit.
  - `BookingBulkUnitAllocation` links specific units to bookings with checkout/checkin timestamps.
  - Existing quantity-only SKUs can be converted to numbered tracking via a dedicated endpoint.
  - A numbered item family may contain multiple interchangeable branded products while remaining one booking line and one QR sequence. `BulkSkuProduct` stores the product identity, and each `BulkSkuUnit` may reference one product without changing its family, unit number, status, allocation, or derived QR value.
  - Separate item families may represent independently operated pools even when they share product identity and checkout policy. The split must be explicit operational direction, not a substitute for product metadata.
- Consequences:
  - One item-family row can display availability like `43/46 available`.
  - Loss tracking works at the individual unit level without creating catalog rows for every battery.
  - Physical unit labels must match unit numbers.
  - All unit operations use `createMany`/`updateMany` to batch DB calls efficiently.
  - QR-coded batteries continue to use this model when they behave like the existing Sony battery flow: one item family with unit-level tracking beneath it.
  - Product breakdowns are operational metadata beneath the family. Reservations continue to request the family quantity, while item-family detail and unit lookup can identify the exact product assigned to a scanned unit.
  - The general operational battery catalog uses four canonical unit-tracked families: `Monitor Battery`, `Sony Battery`, `Gold Mount Battery`, and `FX6 Battery`. `Football Sony Battery` is an accepted separate operational pool but shares the normal `Sony Battery` reservation and custody policy. Product or model differences without an accepted pool boundary stay beneath the family rows.
  - Catalog consolidation hard-deletes only history-free duplicates. Rows with booking, allocation, scan, or stock-movement history are retired or deactivated so the active catalog stays singular without erasing operational evidence.
  - Derived unit QR scans keep batteries out of top-level serialized assets while still supporting individual QR labels and custody.
  - Camera-model battery compatibility warnings are advisory at creation; they do not block checkout creation because physical battery accountability happens at kiosk pickup.
  - Printed-label state (when a physical Brother label was printed and applied) may be stored per `BulkSkuUnit` via `labelPrintedAt`, `labelPrintedById`, and `labelPrintBatchId`. This is a physical-workflow state distinct from `BulkUnitStatus` and never gates availability. QR data itself remains derived and is never stored per unit; the Brother CSV `qr_code` column is computed at export time from `{binQrCodeValue}-{unitNumber}`.
- Guardrails:
  - Unit status is NOT derived like serialized assets (D-001). It is stored directly because units lack the full allocation time-window model.
  - Checked-out units cannot be marked lost/retired — must be checked in first.
  - Unit numbers are permanent; retiring #7 does not renumber #8–40.
  - Product assignments must not be inferred from unit-number ranges. The unit-to-product relation is the source of truth.
  - Removing or archiving a product must not delete or renumber its units; assigned historical identity remains readable.
  - A separate family name does not create authorization policy. Any future family-specific access rule requires a new accepted decision and end-to-end mutation-boundary design.

## D-023: Item Bundling via Parent-Child Accessories
- Date: 2026-03-16
- Status: Accepted
- Context:
  - Equipment like camera bodies ship with handles, cages, and other accessories that travel as a unit but need independent maintenance tracking.
  - Camera-tied SD cards use operational slot tags such as `MBB 17 IV 1A`, where `MBB 17 IV` is the parent camera and `1A` means camera 1, slot A.
  - Full kit management (predefined templates, kit-level bookings) is overkill for V1. Users want a simple "this cage belongs to this camera" relationship.
- Decision:
  - Self-referential FK `parentAssetId` on Asset with `ON DELETE SET NULL`. One level only — no nesting.
  - Accessories are hidden from the items list by default (filtered by `parentAssetId IS NULL`).
  - Accessories always travel with their parent — no independent booking line items.
  - Camera-tied SD cards, cages, and fixed camera parts are treated as attachments/accessories, not bulk SKUs, when they should not be individually checked out.
  - Accessories can be flagged independently for maintenance.
  - Standalone items can be converted to accessories (attach) and back (detach) at any time.
  - Accessories can be moved between parents.
  - On attach, `availableForCheckout` and `availableForReservation` are set to false (parent controls booking).
  - On detach, both flags are restored to true.
- Consequences:
  - Items list shows accessory count badge (+N) on parent items.
  - Item detail page labels the surface as Attachments, groups SD Cards / Cages and Rigging / Misc Parts, and shows "Attached to [Parent]" for child items.
  - SD card child detail and scan preview show the parsed camera slot label when the operational tag ends in a slot code like `1A`.
  - Scan preview shows parent relationship when scanning an accessory QR.
  - No schema changes to bookings — accessories ride along implicitly.
- Guardrails:
  - A parent item cannot itself be a child (no nesting).
  - Self-reference is blocked (cannot attach item to itself).
  - Staff+ permission required for attach/detach/move operations.

---

## D-024: Booking reference numbers use kind prefix (CO/RV) with global sequence
- Date: 2026-03-16
- Status: Shipped
- Context:
  - Bookings identified only by CUID internally and user-entered title for display. Neither is speakable or unambiguous on radios.
  - Staff need to say "grab gear for CO-0042" and have it be unambiguous.
  - Options considered: sport prefix (variable width, mutable risk), kind prefix (fixed width, immutable per D-002), both (too long), random (ambiguous), status quo.
- Decision:
  - Format: `{CO|RV}-{zero-padded global sequence}` (e.g., CO-0001, RV-0002).
  - Kind prefix chosen over sport prefix because BookingKind is architecturally immutable (D-002), while sportCode is only accidentally immutable.
  - Global Postgres sequence `booking_ref_seq` shared across all booking kinds — no gaps in the global ordering.
  - 4-digit zero-padding, extends naturally at 10000+.
  - DRAFT bookings do not get refNumbers — assigned only on real creation via `createBooking()`.
  - Searchable in checkouts and reservations list views.
- Consequences:
  - Every non-draft booking gets a stable, speakable, unique reference number.
  - Displayed as monospace badge in list rows, detail sheet header, and dashboard.
  - Sport context available via existing filters, not baked into the identifier.
- Guardrails:
  - Sequence value obtained inside SERIALIZABLE transaction — race-free.
  - Unique constraint on `ref_number` column prevents duplicates.

## D-026: Event Sync Runs on Daily Cron with Manual Refresh
- Date: 2026-03-24
- Status: Accepted
- Context:
  - Calendar event sync is currently manual-only (button click in Settings). Staff forget to sync, leading to stale event data that causes shift coverage gaps and missed game-day prep.
  - Vercel Hobby cron jobs must run at most once per day per scheduled expression. Sub-daily expressions fail deployment on Hobby.
  - Existing daily operational cron routes run through `vercel.json`; sub-daily operational work needs Vercel Pro or an external scheduler.
- Decision:
  - Calendar sync is implemented through `GET /api/cron/morning-refresh` in `vercel.json`, running once daily at 08:00 UTC (`0 8 * * *`) before the 09:00 UTC notification cron.
  - Morning refresh calls enabled-source sync, generates shifts for new events, and owns the related daily maintenance work documented in D-035.
  - Auth: shared cron bearer validation via `withCron()`.
  - Manual "Sync Now" button remains in Settings for on-demand refresh (existing feature).
  - Calendar source list in Settings shows staleness indicator based on `lastFetchedAt`.
  - On repeated sync failure (3+ consecutive errors), create an in-app notification to all admins.
- Consequences:
  - Events refresh daily without manual intervention. Staff can still sync on-demand when needed.
  - Shift auto-generation fires after daily sync — new events produce shifts within ~24 hours.
  - If upgraded to Vercel Pro, cron frequency can increase by re-adding or tightening `vercel.json` schedules without code changes to the protected routes.
- Guardrails:
  - Sources with `enabled: false` are skipped by cron (same as manual sync).
  - Sync is idempotent — manual + cron firing close together is harmless.
  - Sequential source processing to avoid parallel DB contention.
  - Manual source sync keeps the source-scoped database lease so duplicate clicks return 409 instead of running duplicate external fetch and shift-generation work.

## D-027: Venue Mapping Is Admin-Owned with Pattern Validation
- Date: 2026-03-24
- Status: Accepted
- Context:
  - `LocationMapping` table maps ICS venue text to internal locations via regex patterns. Currently any admin can add patterns with no validation. Malformed regex silently falls back to substring match, which may produce unexpected matches.
  - PD-2 asked "who owns the mapping table?" — answer is admins, since they manage locations and calendar sources.
- Decision:
  - Venue mappings are ADMIN-only (not STAFF). Matches location and calendar source management permissions.
  - Pattern validation on create/update: test `new RegExp(pattern, "i")` and reject with 400 if it throws.
  - Canonical term is "venue mapping" in UI, `LocationMapping` in code (no rename — too much churn for no user value).
  - Priority tie-breaking: when multiple patterns match with equal priority, longest pattern wins (most specific match). Add `ORDER BY priority DESC, LENGTH(pattern) DESC` to query.
  - No audit logging in V1 — mapping changes are low-frequency and admin-only. Revisit if usage patterns change.
- Consequences:
  - Only admins manage mappings — reduces accidental misconfiguration.
  - Invalid regex patterns are rejected upfront — no silent fallback surprises.
  - Deterministic matching with priority + length tie-breaking.
- Guardrails:
  - STAFF users cannot access venue mapping CRUD (403).
  - Pattern validation is server-side only (client shows friendly error).

---

## Platform Invariants

These are non-negotiable integrity constraints. Every feature must preserve them. Previously tracked in `AREA_PLATFORM_INTEGRITY.md` (now folded here to eliminate duplication).

1. **Derived status** (D-001): Asset availability is computed from active allocations, never stored as authoritative.
2. **SERIALIZABLE transactions** (D-006): Booking mutations use SERIALIZABLE isolation + PostgreSQL exclusion constraints for overlap prevention.
3. **Audit completeness** (D-007): Every mutation path emits audit records with actor, diff, and timestamp.
4. **Database-enforced active uniqueness** (D-033): The database remains the final boundary against duplicate active serialized-asset allocations.
5. **Concurrency safety**: Performance improvements must not weaken correctness constraints. Cache boundaries for event and metadata read paths are pending (see Pending Decisions).

## Decision Rules for Future Changes
1. Any proposal that risks D-001 or D-006 requires explicit architecture review.
2. Any workflow change touching students must preserve mobile-first usability and low cognitive load.
3. Any new ingestion or enrichment integration must be isolated and failure-tolerant.
4. Major scope changes must update both this file and `PRODUCT_SCOPE.md` in the same PR.
5. Any dashboard/list/scan UX change must also be reflected in `AREA_MOBILE.md`.

## D-025: User-Facing Status Labels Are Display-Only
- Date: 2026-03-22
- Status: Accepted
- Context: The raw `BookingStatus` enum values (DRAFT, BOOKED, PENDING_PICKUP, OPEN, COMPLETED, CANCELLED) are technical and confusing in the UI. "OPEN" means nothing to an equipment manager checking out gear.
- Decision: Introduce `statusLabel(status, kind)` helper in `src/components/booking-details/helpers.ts` that maps DB enum to user-facing labels. DB enum, API responses, and business logic remain unchanged.
- Label mapping:
  - DRAFT → "Draft"
  - BOOKED → "Reserved"
  - PENDING_PICKUP → "Pending Pickup"
  - OPEN → "Checked Out"
  - COMPLETED → "Completed"
  - CANCELLED → "Cancelled"
- Constraint: All UI surfaces must use `statusLabel()` for display. Never show raw enum values to users.
- Derived phase: a `RESERVATION/BOOKED` row displays as Pending Pickup once
  `startsAt` arrives. The stored reservation status remains `BOOKED` until
  kiosk fulfillment or cancellation so display state does not create custody.
- Downstream: List pages, search results, and any future status references should adopt `statusLabel()`.

---

## Active Risks and Mitigations
- Risk: Event data staleness or malformed ICS input.
  - Mitigation: idempotent imports, observability, fallback ad hoc booking path.
- Risk: Alert fatigue from escalation.
  - Mitigation: threshold controls + dedup keys + policy review.

## D-028: Photo Requirement on Checkout/Checkin

**Decision (2026-03-30, amended 2026-06-25):** Every checkout and checkin completion requires physical verification. The active execution path is kiosk scanning for pickup and return. The signed-in app `/scan` page is lookup-only. Admins may bypass scanning only through a reasoned close-without-scan exception after physically verifying returned gear.

**Context:** Equipment accountability requires documenting condition at both handoff points. Without photos, damage disputes lack evidence. Without scan-based checkin, items can be marked as returned without physical verification.

**Constraints:**
- Camera-only capture (no gallery upload) to ensure photo is taken at the moment of handoff
- One photo per booking per phase (equipment laid out together)
- Photos stored in Vercel Blob under `bookings/{id}/{phase}/`
- `BookingPhoto` model tracks phase, image URL, actor, and timestamp
- Completion endpoints (`completeCheckoutScan`, `completeCheckinScan`) enforce photo existence
- Admin override bypasses photo/scan requirements only through explicit exception paths with reasoned audit evidence.
- Photos displayed on booking detail page in the info tab

**Downstream Effects:**
- Regular app checkout/check-in scan routes remain kiosk-gated 403 stubs.
- App `/scan` deep links with `checkout` or `phase` query params show kiosk handoff copy and remain in lookup mode.
- Booking detail and dashboard surfaces must not link operators to `/scan?checkout=...`.
- Kiosk pickup and return routes are the custody scan source of truth.

---

## D-029: Registration Gated by Admin-Managed Email Allowlist

**Decision (2026-04-03):** User self-registration is gated by an `AllowedEmail` table. Only email addresses pre-approved by an ADMIN or STAFF user can register. The allowlist entry also pre-assigns the user's role (STAFF or STUDENT).

**Context:** Open registration allowed anyone to create an account and access the system. For an internal tool managing university athletics equipment, access must be controlled. No email service is needed — admins tell users verbally to sign up, and the system verifies their email is on the allowlist.

**Constraints:**
- `AllowedEmail` model: email (unique), role, createdById, claimedAt, claimedById
- Registration endpoint checks allowlist before creating user; returns 403 if not found
- Allowlist entry marked as `claimed` on successful registration (prevents reuse)
- Role comes from allowlist entry, not hardcoded to STUDENT
- STAFF can only add STUDENT-role entries; ADMIN can add both STAFF and STUDENT
- Claimed entries cannot be deleted (audit trail preserved)
- Admin UI under Settings > Allowed Emails with add/delete/filter
- First-time user access now flows through the allowlist and registration. Direct temporary-password onboarding through `/api/users` is retired for beta; administrator password reset remains the forced-password recovery path.

**Downstream Effects:**
- Public `/register` remains a compatibility redirect into `/login`; the existing registration transaction still accepts only pre-approved emails
- First-time user creation via `/api/users` (POST) no longer bypasses the allowlist for beta onboarding
- Existing users unaffected (allowlist only gates new registrations)

## D-037: Bulk Onboarding Uses an Invitation-Scoped Account Lifecycle

- Date: 2026-06-03
- Status: Accepted for V1 planning
- Context:
  - Wisconsin Creative needs to onboard large student and staff cohorts without forcing an operator to manually create users, add allowed emails, and separately manage first sign-in handoff.
  - Existing registration security depends on D-029's `AllowedEmail` gate.
  - Direct-created accounts previously used `forcePasswordChange`.
  - The beta launch should avoid shared first-time password handoffs.
- Decision:
  - Treat invite-to-register as the first-time invitation-scoped lifecycle.
  - Keep `AllowedEmail` as the self-registration gate. Do not introduce open signup or domain-wide automatic access.
  - Add a bulk-capable onboarding workflow where an authorized operator can paste or upload roster rows, preview validation results, and commit selected rows.
  - Support `Invite to register` by creating or reusing unclaimed allowed-email entries.
  - Retire first-time `Create account with temporary password` onboarding. `/api/users` POST and `/api/users/bulk-create` should no longer mint temporary onboarding credentials.
  - Enforce role boundaries server-side on every preview and commit. STAFF may onboard STUDENT accounts only; ADMIN may onboard STAFF and STUDENT accounts.
  - Keep public registration and authentication responses safe from membership enumeration. Authenticated staff/admin preview may show operational status for records within their management scope. The bounded two-state email discovery result in D-051 is the deliberate exception for the normal invited-user entry point.
  - Keep native iOS forced-password handling for administrator reset and recovery users before entering the app shell.
  - Audit every create, claim, skip, retry, and follow-up onboarding action.
- Consequences:
  - `/api/allowed-emails` remains the access authority, while `/login` is the first-time onboarding entry point. The compatibility `/register` route redirects there for older links.
  - Successful registration enters role-aware Welcome setup on web or native iOS. Operational readiness is derived from role-specific canonical profile fields, while apparel, shoes, and a profile photo determine the separate profile-complete state.
  - Collaborator setup remains limited to welcome and an optional photo; internal contact, Wiscard, student, sizing, area, and location requirements do not apply.
  - First-time onboarding must not generate, export, or require shared temporary passwords.
  - The web operator experience should make allowlist invitations feel like the single account-access workflow.
  - iOS cannot treat login success as enough if `forcePasswordChange` is true for reset/recovery.
- Implementation Reference:
  - `docs/BRIEF_ONBOARDING_V1.md`
  - `tasks/onboarding-flow-plan.md`

## D-031: Multi-Event Booking via Junction Table with Preserved Primary FK
- Date: 2026-04-24
- Status: Accepted
- Context:
  - A single booking can cover multiple back-to-back events (game weekends, coverage days).
  - Creating one booking per event duplicates equipment picking and makes conflicts hard to reason about.
  - `Booking.eventId` is a single FK read in 36+ places across the codebase (dashboard, my-shifts, reports, shift groups, search, drafts).
- Decision:
  - Add `BookingEvent` junction table `(booking_id, event_id, ordinal)` with composite unique on `(booking_id, event_id)` and cascade delete on both FKs.
  - Preserve `Booking.eventId` as the **primary** event (ordinal 0, chronologically first). All existing readers keep working unchanged.
  - Cap at 5 linked events per booking (expanded 2026-08-24; the junction model and primary-event compatibility contract remain unchanged).
  - API accepts either `eventId` (legacy single) or `eventIds[]` (multi); mixing both returns 400.
  - `startsAt`/`endsAt` auto-derive from min-to-max of linked events plus the existing travel buffer, unless caller overrides.
  - Migration `0042_booking_events` backfills a junction row for every existing booking with `event_id`, ensuring reverse lookup works uniformly against new and legacy data.
  - Reverse lookup queries (event detail → bookings) use `OR(eventId, events.some)` to be robust against any code path that sets the primary FK without the service layer.
- Consequences:
  - Zero-rewrite migration — no existing reader needs changes.
  - `Booking.eventId` becomes slightly denormalized (redundant with the ordinal-0 junction row). Acceptable trade-off for read-path stability.
  - If the primary event is deleted, the FK nulls (`onDelete: SetNull`) but the remaining junction rows persist. A V2 trigger or service-layer rebuild can promote the next ordinal. V1 accepts brief "booking with no primary event" state.
  - Dashboard/my-shifts group-by-event still keys on primary only. Grouping by all linked events is a V2 enhancement.
  - Junction-table approach is symmetric to existing patterns (`BookingSerializedItem`, `BookingBulkItem`, kit memberships) so there's no new idiom.

---

## D-032: Kiosk Operations Are Global; Check-In Sets Return Location
- Date: 2026-04-29; amended 2026-08-03
- Status: Accepted
- Context:
  - A staffed kiosk may serve people and custody work created at another location.
  - Saved location is neither a safe identity boundary nor a useful visibility boundary for a staffed operational kiosk.
- Decision:
  - Kiosk person discovery includes every active, non-hidden internal user, regardless of `User.locationId`.
  - Active external collaborators appear only when their affiliation policy grants `KIOSK_ROSTER_ELIGIBLE`; that grant is global across staffed kiosks.
  - Every kiosk can read dashboard custody, student checkout and reservation context, checkout detail, and scan resolution across locations, and can pick up or manage an open checkout across locations.
  - Direct checkout continues to use the authenticated kiosk as its availability and booking source. It does not change a serialized asset's saved location.
  - Pickup scans and active-checkout edits do not change an item's saved location. Cross-location pickup is allowed when requester, booking state, allocation, and scan evidence all pass.
  - Kiosk check-in is the explicit physical transfer: it changes a serialized `Asset.locationId` to the authenticated kiosk location; for numbered bulk gear, it creates the `CHECKIN` stock movement and balance at that kiosk location. It never changes family-level `BulkSku.locationId` for one returned unit.
- Consequences:
  - Every kiosk can complete the full operational custody flow without a profile or booking location repair first.
  - Location is preserved as booking/audit evidence and becomes current physical inventory state only on return.
  - Hidden smoke users, inactive users, and collaborators without the explicit kiosk grant remain unavailable to kiosk identity discovery.
- Implementation Reference:
  - `src/lib/user-visibility.ts`
  - `src/app/api/kiosk/users/route.ts`
  - `src/app/api/kiosk/identify/route.ts`
  - `src/app/api/kiosk/resolve-scan/route.ts`
  - `src/app/api/kiosk/student/[userId]/route.ts`
  - `src/app/api/kiosk/dashboard/route.ts`
  - `src/app/api/kiosk/checkin/[id]/scan/route.ts`
  - `src/lib/services/bulk-unit-scans.ts`
  - `docs/AREA_KIOSK.md`

## D-033: Database Enforces One Active Allocation per Asset
- Date: 2026-04-29
- Status: Accepted
- Context:
  - Application-level availability checks cannot fully prevent two concurrent custody flows from allocating the same serialized asset.
- Decision:
  - PostgreSQL enforces a partial unique index on active asset allocations: `asset_allocations_asset_id_active_unique` where `active = TRUE`.
  - Application paths attempt the write directly and catch Prisma `P2002` as an unavailable-item conflict.
  - Migration `0048` includes a preflight check that fails if duplicate active allocations already exist.
- Consequences:
  - The database remains the final concurrency boundary even when requests race across checkout, reservation, or kiosk paths.
  - The migration cannot be applied safely while existing duplicate active allocations remain.
- Implementation Reference:
  - `src/lib/services/bookings-lifecycle.ts`
  - `src/app/api/kiosk/checkout/complete/route.ts`
  - Migration provenance is recorded in the historical change log below; do not recreate a missing migration directory by hand.

## D-030: Kiosk Auth Uses Device-Level Token
- Date: 2026-04-07
- Status: Accepted
- Context:
  - Kiosk iPads need persistent authentication without individual user login.
  - Multiple students use the same device in quick succession.
  - Audit trail must distinguish kiosk actions from personal device actions.
- Decision:
  - New `KioskDevice` model — separate from User/Session.
  - Admin generates 6-digit activation code; iPad enters code to pair.
  - Device gets long-lived session token (7 days) stored as HTTP-only cookie.
  - `requireKiosk()` auth helper validates device token, returns `{ kioskId, locationId }`.
  - Student identity passed as `actorId` parameter on each API call (tap avatar, no password).
  - Booking/audit records include `source: "KIOSK"` metadata + kioskDeviceId.
- Consequences:
  - Kiosk session survives browser restarts (cookie-based, 30-day expiry).
  - No user credentials stored on kiosk device.
  - Admin can deactivate a kiosk remotely by toggling `active` flag.
  - All kiosk API routes use `withKiosk()` wrapper instead of `withAuth()`.

---

## D-034: Badge Achievements Are Event-Sourced, Flag-Gated, and Profile-First
- Date: 2026-05-09
- Status: Accepted for sliced implementation
- Context:
  - The prior badge implementation was reverted because it mixed schema, route wiring, profile UI, reports, and evaluator behavior in one large slice.
  - Current kiosk and scan flows have clear domain outcome boundaries, while the legacy app scan routes are 403 stubs.
  - Recognition should not compete with operational profile signals such as role, availability, overdue gear, or admin actions.
- Decision:
  - Automatic operational badge events are emitted only from durable domain outcomes: kiosk checkout or pickup opens a checkout, checkout return completion flips to `COMPLETED`, a confirmed assigned shift ends, and trade status flips to `COMPLETED`.
  - Shift recognition remains assignment-based, never attendance-based. Rules may derive from source-of-truth `CalendarEvent.result`, `site`, `sportCode`, `locationId`, and `opponent`, plus `ShiftAssignment.hasConflict`; missing fields contribute no credit.
  - New catalog goals should avoid redundant raw-total ladders. Prefer compound or sustained rules that combine schedule facts, checkout context, return quality, trade roles, or meaningful gear/event depth; a threshold of one is acceptable only when the rule itself represents a compound outcome.
  - Checkout context rules may use the immutable opened receipt's `Booking.eventId`/`BookingEvent`, `sourceReservationId`, and `shiftAssignmentId`; return-problem rules belong to the current custodian and use check-in report types, due-date changes, and the existing 15-minute late boundary.
  - Successful kiosk scanning is the expected baseline, not an achievement metric. Existing scan definitions and awards remain as retired history, but scan requests no longer emit badge events or change badge streaks.
  - Hidden easter eggs may use a signed-in app foreground event when the server, not the client, evaluates the rule. App-open events accept no client clock or timezone and must be idempotent through `BadgeEventReceipt`.
  - `BADGES_ENABLED !== "true"` returns before evaluator work, badge database queries, or side effects.
  - Migration and profile reconciliation may backfill an automatic award when the same server-derived progress already meets its threshold. A profile must never present completed progress as a locked badge.
  - On-time return logic uses a 15-minute UTC grace window after `booking.endsAt`.
  - Badge definition `key` values are immutable. Rename display fields in place; retire bad keys with `active=false` and seed replacement keys.
  - `onCheckoutReturned` and `onTradeCompleted` must be emitted from single status-flip helpers so competing call paths do not double-award.
  - Peer badge visibility defaults to true via `SystemConfig["badges.peerVisible"]`; staff/admin can always see user badges.
  - The primary user UI is a `Badges` tab on `/users/{id}` for students, staff, and admins. No top-level nav item and no badge chrome in the profile hero.
  - The legacy `StudentBadge` model/table name remains in place until a dedicated cleanup migration. Product language and UI should say user awards or badge awards.
  - Badge progress is displayed only when it is backed by real counters or streak rows. Manual badges must not show invented progress.
  - Checkout-open credit is immutable. A transfer before the checkout opens moves the future earning opportunity; a transfer after opening does not move the original opener's checkout count or category breadth. The current custodian receives the eventual return, on-time, and damage-free outcome.
- Consequences:
  - The system can ship in independent slices with the flag off until preview verification passes.
  - Historical badge data remains stable if users are deactivated or definitions are retired.
  - Reports can aggregate from the legacy-named `StudentBadge` award table without becoming the primary profile experience.
- Guardrails:
  - All checkout scan endpoints stay badge non-events.
  - Shift approval is not a badge event. Attendance-based shift badges are out of scope unless a future product decision reopens them.
  - Award notification delivery is persistent inbox first; push fan-out is deferred.

---

## D-035: Daily Maintenance Work Is Consolidated Into Morning-Refresh
- Date: 2026-05-13
- Status: Accepted
- Context:
  - Vercel cron capacity is intentionally small, and duplicated cron routes drift from the scheduled path.
  - Shift-group archiving already runs inside `morning-refresh`; the standalone `archive-shifts` route was unscheduled dead code.
  - Stale `PENDING_PICKUP` checkouts need a daily cleanup path, but adding another cron route would increase scheduling and monitoring surface.
  - Firmware release checks are also daily operational maintenance and should not add a separate scheduled cron while Hobby cron capacity is intentionally small.
- Decision:
  - `GET /api/cron/morning-refresh` is the single daily scheduling maintenance route for calendar sync, shift generation, shift-group archiving, stale trade expiry, and pending-pickup auto-expiry.
  - Firmware watch polling also runs inside `morning-refresh` and reports its own summary/failures without blocking unrelated daily maintenance.
  - Delete duplicate standalone cron routes when their work is already owned by morning-refresh.
  - A `BOOKED` reservation enters the operational Pending Pickup phase at
    `startsAt` and becomes eligible for no-show cancellation after the
    configured `noShowExpiryHours` window, which defaults to 48 hours.
  - Legacy `CHECKOUT/PENDING_PICKUP` rows use the same cutoff until production
    data is verified clean enough to remove the compatibility state.
- Consequences:
  - One daily maintenance response captures the operational cleanup summary.
  - Fewer unscheduled cron routes and fewer places for schedule comments to drift.
  - Pending-pickup expiry must be idempotent, audited, and safe to retry.
- Guardrails:
  - Reservation expiry deactivates allocations and cancels open scan sessions
    without restoring bulk stock that reservation planning never decremented.
  - Legacy staged checkout expiry also restores held bulk stock and releases
    scanned numbered units.
  - Every expiry writes a system audit entry.
  - Cleanup failures should be visible in the morning-refresh response without preventing unrelated per-source calendar sync results from being recorded.

---

## D-038: Firmware Watch Uses Official Source Adapters and Silent Baselines
- Date: 2026-06-10
- Status: Accepted
- Context:
  - Camera firmware versions and release dates are current operational data, not stable product metadata.
  - Manufacturers expose firmware data in different formats. The active implementation polls verified Sony support pages for camera bodies that exist in the live inventory; DJI, GoPro, Insta360, JVC, and unresolved Sony pages remain deferred until official source parsing is proven.
  - The app already has daily maintenance, notification records, APNs push, and notification dedupe keys.
- Decision:
  - Add `FirmwareWatchTarget` as a model-level watch record with brand, model, product name, official source URL, parser type, support mode/note, latest version, release date, baseline timestamp, last check timestamp, and last error.
  - Poll enabled watch targets once daily from `morning-refresh`.
  - First successful poll establishes a baseline without notifying admins.
  - A later version-string change creates `firmware_update_released` notifications for active admins with dedupe key `firmware_release:{targetId}:{version}:{adminId}`.
  - Source URLs must be constrained by adapter type so the server-side fetch path cannot be used as a general URL fetcher.
  - Canon runtime parsing is not active because there are no Canon camera bodies in the live inventory.
  - Item detail may store a per-asset installed firmware version in existing item metadata as `installedFirmwareVersion`, then compare that value to the matched model-level latest version.
  - Admin target-management UI, non-Sony vendor parsing, unresolved Sony model URLs, and sub-daily polling are deferred.
- Consequences:
  - Daily firmware awareness ships without adding another scheduled cron surface.
  - Notifications represent "new official release observed"; the item-detail badge is the per-camera place to record and compare installed firmware.
  - Adding a new manufacturer requires an explicit adapter and tests instead of a generic scraper.
- Guardrails:
  - Use official manufacturer support URLs only.
  - Keep fetches bounded by timeout and host allowlist.
  - Preserve in-app notification creation as the durable source of delivery truth; push is best-effort.

---

## D-036: Product Image Search Is Brave-Backed and Human-Picked
- Date: 2026-05-20
- Status: Accepted
- Context:
  - D-005 withdrew B&H enrichment because scraping was blocked.
  - Staff still need a fast way to pick clean item photos during item creation and replacement.
  - Metadata enrichment remains out of scope for V1, and item identity must stay tag-first.
- Decision:
  - Use Brave Search API as the only shipped product image-search provider.
  - Hide the Search tab unless `BRAVE_SEARCH_API_KEY` is configured.
  - Seed searches from product title, brand, model, or item-family name when available.
  - Bias outbound searches toward product photos on white backgrounds while keeping the visible field editable.
  - Prefer B&H image candidates through Brave's `site:bhphotovideo.com` operator, then merge broader product-photo-biased Brave results so B&H source links do not monopolize the grid when retailer previews are blocked.
  - Keep the human in the loop: staff selects a result, sees the source domain, and the app re-hosts the chosen URL through the existing image endpoint.
  - Do not scrape B&H, Google Images HTML, retailer pages, or CDN pages.
  - Do not write metadata from search results into item identity fields.
- Consequences:
  - Setup stays to one optional provider key instead of carrying unused fallback branches.
  - Result quality is good enough for image selection but still requires human judgment.
  - Existing paste URL and upload paths remain the fallback when Brave is unconfigured or quota is exhausted.
- Guardrails:
  - Search route requires `asset.edit`, validates query length, and rate-limits by user.
  - Result saves must continue through Blob re-hosting endpoints so stored item photos are app-owned.
  - Provider failures and quota exhaustion must leave paste URL and upload available.

---

## D-039: Kiosk Sessions Slide on Activity and Survive Reinstalls via Keychain
- Date: 2026-06-12
- Status: Accepted
- Context:
  - Kiosk iPads are always-on appliances (plugged in at a gear-room counter). The original design (D-030) gave activations a fixed 7-day `sessionExpiresAt`, so a healthy, continuously-heartbeating kiosk was forced back to the activation screen weekly.
  - The iOS app stored the `kiosk_session` cookie only in `HTTPCookieStorage` and device info only in `UserDefaults` — both live in the app container, which reinstalls (every Xcode build during development, any future App Store reinstall) can wipe. Each rebuild bounced the device to activation.
- Decision:
  - `requireKiosk()` slides `sessionExpiresAt` forward to a full 7-day window on authenticated activity, throttled to roughly one write per day. The cookie is re-issued with the slid expiry on every response, so cookie and DB stay aligned.
  - The iOS app mirrors the session token into the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) and re-creates the cookie from it when the cookie jar comes up empty. The credential survives reinstalls on the same managed iPad but cannot migrate through a backup to another device. With `UserDefaults` also wiped, device info is rebuilt from `/api/kiosk/me` (which now returns the device `name`).
- Consequences:
  - An active kiosk never re-prompts for an activation code; only 7 full days of darkness (or admin deactivation, which still revokes instantly via `active: false`) ends a session.
  - The Keychain copy outlives app deletion by design — `deactivate()` and any 401 path must keep clearing it (both do).

## D-040: Kiosk-Only Custody, Reservation-First App/Web
- Date: 2026-06-15
- Status: Accepted
- Context:
  - Checkout and return are physical custody events. Letting app/web users create checkout custody away from a kiosk blurs intent, inventory commitment, and physical handoff evidence.
  - The app `/scan` surface is already lookup-only by D-028, and the native iOS kiosk is already the canonical checkout, pickup, and return surface by D-030.
  - The unified `Booking` model already supports reservations and checkouts, including `sourceReservationId` for preserving a fulfilled-reservation trail.
- Decision:
  - Direct checkout and standard return mutations are kiosk-only. They must require kiosk authentication, scan evidence where applicable, and the kiosk's physical location context.
  - Admin close-without-scan is a narrow repair exception for `OPEN` checkouts where all gear has been physically verified but cannot be scanned. It requires a reason, writes override/audit evidence, and must not reopen app/web as a normal return surface.
  - App and web users create and manage reservations when they are not physically at the kiosk with the gear.
  - Direct "I need this now" checkout remains available through kiosk checkout, not through app/web checkout creation.
  - Reservation pickup is fulfilled at the kiosk. Once scans pass, the kiosk creates or opens the linked checkout custody record and marks the source reservation `COMPLETED`; it must not treat a fulfilled reservation as user-cancelled.
  - Pending Pickup is the operational phase of a `BOOKED` reservation after
    its scheduled `startsAt` while kiosk fulfillment remains incomplete.
  - New checkout records created at the kiosk open directly as `OPEN` custody.
    The raw `PENDING_PICKUP` enum remains only for existing staged checkout
    records during rollout compatibility.
  - Checkout records remain the custody ledger for active and historical gear-out reporting, search, and audit.
  - Active-checkout edits require an identified student context inside the kiosk. Idle dashboard checkout detail is read-only; selecting the student opens the Manage surface that owns edit and return actions, preventing an anonymous idle tap from being attributed to the checkout requester.
- Consequences:
  - Non-kiosk app/web routes must not create checkout custody, convert reservations into pickup custody, or run normal return flows.
  - Overdue checkout counts mean physical gear is out. Due reservations belong
    to the Pending Pickup lane and must not inflate checkout-overdue custody.
  - Existing `PENDING_PICKUP` records need a compatibility path during rollout; they continue to block availability until cancelled, picked up, or expired.
- Guardrails:
  - Keep server-side enforcement at the mutation boundary. UI removal alone is insufficient.
  - Preserve `sourceReservationId` and audit entries when a reservation is fulfilled into checkout custody.
  - Do not reintroduce app/web scan completion paths outside kiosk APIs.
- 2026-08-03 amendment: The signed-in web app no longer exposes a standalone `/scan` lookup route or browser camera scanner controls. Native iOS owns item lookup, kiosk owns physical custody scans, and web retains text-first search plus scan-history reporting.

## D-041: External Collaborators Use Default-Deny Affiliation Policies
- Date: 2026-07-16
- Status: Accepted; production rollout pending
- Context:
  - Giving an external partner `STUDENT` or `STAFF` would inherit unrelated internal access.
  - Affiliation labels describe identity but are not a safe authorization mechanism.
- Decision:
  - External users use `Role.COLLABORATOR`, which remains absent from the central role permission map.
  - Authorization comes from a directly assigned, database-backed policy. Affiliation remains presentational.
  - Policies grant only the ten implemented capability keys listed in `AREA_COLLABORATORS.md`; unknown keys fail closed and dependencies normalize server-side.
  - BTN is backfilled active with behavior equivalent to its fixed profile. Learfield was seeded suspended and is activated only through an explicit reviewed policy change.
  - `PEOPLE_DIRECTORY_VIEW` grants active, non-hidden teammate discovery through a minimized roster and work-profile response. It never grants contact, identity, presence, activity, booking, shift, badge, audit, or edit access.
  - BTN gear access is sanitized and own-reservation scoped. Checkout custody remains kiosk-owned under D-040.
  - Collaborator Schedule access is read-only and rendered from `ShiftGroup.lastPublishedSnapshot`, never live draft state.
  - Only admins may invite, deactivate, or change collaborator accounts.
- Consequences:
  - New partners require an explicit reviewed and activated policy rather than an affiliation shortcut or internal role grant.
  - Web, API, iOS, and kiosk clients must tolerate additive affiliation/profile/capability metadata.
  - Production rollout must deploy schema/server before collaborator-aware clients and invitations.
- Guardrails:
  - Do not add `COLLABORATOR` to inherited role permissions.
  - Do not authorize from affiliation.
  - Do not authorize from legacy affiliation or profile fields. A collaborator without an assigned active policy fails closed.
  - Do not add per-user capability grants in V1.
  - Keep sensitive profile data, notes, serials, borrower identity, audit history, internal metadata, unrestricted cross-user access, staffing controls, and custody mutations permanently non-configurable.
  - Route every collaborator booking response branch through the collaborator sanitizer and deny direct audit-history reads.
  - Restrict collaborator-created reservation event links to the published, non-hidden Schedule surface and keep inaccessible IDs indistinguishable from missing IDs.
  - Keep linked event objects out of collaborator booking responses; published event identity and crew detail belong to the collaborator Schedule contract.
  - Require full capability replacement, optimistic version checks, `SERIALIZABLE` mutation transactions, immutable revisions, and atomic audit records for policy changes.
  - Load the current policy on every authenticated request so suspension and reductions apply without session deletion.
  - Do not invite a production collaborator until the migrations, server, clients, kiosk roster, and negative authorization smoke are verified.
- Reference: `docs/AREA_COLLABORATORS.md`.

---

## Pending Decisions
1. ~~Event sync refresh cadence and staleness thresholds~~ — Resolved: D-026.
2. ~~Venue mapping governance owner~~ — Resolved: D-027.
3. ~~Metadata enrichment cache TTL target~~ — withdrawn with D-005.
4. ~~Student mobile KPI definitions~~ — resolved (PD-5): taps-to-checkout ≤3, scan success ≥95%, task completion <30s. Telemetry deferred to Phase B.

## D-042: Schedule Edits Use a Versioned Working Copy and Deliberate Publish
- Date: 2026-07-21
- Status: Superseded by D-046 on 2026-08-07; retained as staging-model history
- Context:
  - The expanded web Schedule list is the primary crew-management surface and needs rapid slot, assignment, removal, and worker-class actions.
  - The current publication marker does not isolate later edits. Mutations change live relational shifts and assignments before republish, so worker-facing reads and notification policy can observe work in progress.
  - Existing iOS clients and worker-facing integrations already depend on relational shifts and assignments, while collaborators correctly read `lastPublishedSnapshot` only.
- Decision:
  - A shift group may have one server-validated, versioned working copy owned by staff editing workflows.
  - The relational `Shift` and `ShiftAssignment` rows remain the last published worker-facing source of truth. My Shifts, Dashboard, personal ICS, Open Work, Trade Board, collaborator Schedule, and existing iOS clients do not read the working copy.
  - First publish and later publish operations reconcile the working copy into the relational schedule atomically, increment `publishedVersion`, refresh `lastPublishedSnapshot`, and remove the working copy.
  - Working-copy mutations require optimistic version checks, `shift.manage`, `SERIALIZABLE` transactions, validation, rate limiting, and useful audit snapshots. They do not send assignment or schedule notifications.
  - Publish must preview worker-visible changes. It resets acknowledgement only for affected assignments and sends no more than one version-deduped event summary per affected worker.
  - Staff/Student conversion changes the slot's scheduling class, never `User.staffingType`. A class mismatch, active trade, or linked booking requires an explicit safe resolution instead of silent data loss.
  - Existing response fields remain compatible. Publication and working-copy metadata is additive, and old native clients continue to receive published schedule data.
  - Default staffing changes set the target for new events and conservatively rebase upcoming unpublished schedules. Generated, untouched, unassigned slots may be added, removed, or retimed; occupied and manually touched slots are protected and count toward the target. Published schedules and active working copies require explicit review.
  - Sport call-time offsets are the canonical fallback for future timed shift coverage. Settings changes synchronize relational shift fallbacks and active working-copy payloads through one service, refresh published snapshots when needed, preserve explicit slot and personal overrides, and leave all-day event boundaries unchanged.
- Consequences:
  - Staff can build and preview a schedule without exposing partial staffing or generating notification bursts.
  - Web can become the dense editing control room while iOS keeps a bounded quick-action contract.
  - Publish reconciliation is a correctness boundary and must preserve assignment, trade, booking, acknowledgement, and audit history deliberately.
- Guardrails:
  - Do not expose working-copy payloads from worker, collaborator, public, Open Work, Trade Board, Dashboard, or ICS routes.
  - Do not treat a timestamp or diff badge as publication isolation.
  - Do not hard-delete history-bearing rows during publish reconciliation.
  - Do not allow stale working versions to overwrite newer staff edits.
  - Do not send per-click worker notifications while a working copy exists.
- Reference: `tasks/event-shift-working-schedule-plan.md` and `docs/AREA_SHIFTS.md`.

## D-046: Schedule Edits Release Automatically After a Ten-Minute Quiet Period
- Date: 2026-08-07
- Status: Accepted; implemented locally, rollout pending
- Context:
  - Manual Draft and Publish actions make routine staffing slower and create ambiguity about whether a visible name is actually on the worker-facing schedule.
  - Staff commonly make several assignment and slot changes together and need a short quiet period before workers see or receive churn.
  - The versioned working-copy model already provides safe staging, optimistic concurrency, atomic reconciliation, and compatibility with existing worker-facing relational reads.
- Decision:
  - Staff schedule edits remain private for ten minutes after the most recent edit. Every new edit restarts the quiet period.
  - When the live event `endsAt` is already past, the standard Schedule editor is the default backfill path: the mutation clears pending release metadata and publishes synchronously instead of entering the quiet period.
  - Each mutation pre-enqueues a version-specific durable Workflow run before committing the pending version. When it wakes, the run releases only if that exact version is still current; superseded runs no-op.
  - Release reconciles the pending copy into relational shifts and assignments atomically, updates the collaborator snapshot, preserves history and safety blockers, and sends at most one consolidated event notification per affected worker.
  - Past-event publication sends no schedule, follower, gear-prep, push, email, in-app, or badge notification. The resulting assignment is immediately Scoreboard-visible; result-less worked events contribute to the work total and event list but not to official W/L/T stats.
  - Draft, Publish, Republish, and Unacknowledged are retired as active product concepts. Staff see Pending changes, the scheduled release time, Revert changes, and actionable recovery when validation blocks release.
  - The relational schedule remains worker-facing truth. Until the quiet period completes, My Shifts, Dashboard, ICS, Open Work, Trade Board, collaborator Schedule, and existing iOS clients continue showing the last released version.
  - Active collaborators whose policy grants `PUBLISHED_SCHEDULE_VIEW` may be manually assigned to Staff slots. They remain outside Student availability, Open Work pickup, and Trade Board workflows, and reservation-created collaborator staffing remains excluded.
  - Only Student slots and Student assignments use configured call times. Staff and collaborator coverage retains the event window internally for integrity but exposes no call-time value, event-time substitute in the call-time position, editing control, or call-time notification copy.
  - Every eligible future event receives configured slots. Home events use their sport Home template; Away and neutral-site games with an opponent use the sport Away template; events without an opponent use the Settings-owned Non-game template. Cancelled, hidden, and archived events are excluded.
  - Assignment acknowledgement timestamps remain historical compatibility data but no longer gate readiness, visibility, or release.
- Consequences:
  - For future events, a name becomes worker-visible only after the ten-minute quiet period, at the same boundary that creates consolidated notification evidence.
  - For ended events, the same editing flow corrects the published schedule immediately without a second backfill control or any recipient notification.
  - Operators can make several quick changes without notification churn or a separate publish ceremony.
  - The staging table remains an internal reliability mechanism, but product surfaces no longer present a draft lifecycle.
- Guardrails:
  - Never commit a pending schedule mutation unless its version-specific release run was successfully enqueued.
  - Never let an older workflow release a newer pending version.
  - Never hide a permanent release blocker; persist and surface recovery state.
  - Never present a pending-release countdown or “assignees notified” copy for an ended event.
  - Never expose collaborators to internal contacts, availability, Trade Board, Open Work, or broader Schedule controls through assignment eligibility.
  - Never apply Student call-time offsets or overrides to Staff or collaborator assignments.
- Reference: `tasks/event-shift-working-schedule-plan.md`, `docs/AREA_SHIFTS.md`, `docs/AREA_MOBILE.md`, and `docs/AREA_SETTINGS.md`.

## D-043: Passkeys Are an Additive Sign-In Method for Invite-Granted Users
- Date: 2026-07-31
- Status: Accepted; web and native iOS slices implemented locally, production rollout pending
- Context:
  - Wisconsin Creative access is already invite-gated through `AllowedEmail`, and active users authenticate through the shared password/session boundary.
  - Users need a faster, phishing-resistant sign-in path on supported browsers and Apple devices without changing the invitation or kiosk custody contracts.
- Decision:
  - Any active user who has completed invite-granted access may enroll one or more passkeys after current-password reauthentication.
  - Passkey login is discoverable, requires user verification, and issues the existing cookie-backed `Session`; it is not a second authorization or session system.
  - Registration and authentication challenges are short-lived, browser-bound by an HTTP-only ceremony cookie, one-time consumable, and persisted server-side so replay and concurrent consumption are rejected.
  - Password sign-in and recovery remain available during rollout. A user may revoke an individual passkey only after current-password reauthentication.
  - Passkey credential metadata, enrollment, login, and revocation are audit-visible. Kiosk authentication remains device-token based under D-030.
- Consequences:
  - Web can ship passkey enrollment and login without adding an identity-verification workflow or changing invite semantics.
  - Native iOS now uses the same server ceremony contract through `AuthenticationServices`, with the app associated to the canonical `webcredentials` domain. Production device and domain proof remain rollout gates.
  - Production must configure an explicit WebAuthn RP ID and exact accepted origin before enrollment is enabled for real users.
- Guardrails:
  - Never accept a passkey assertion without matching RP ID, origin, expected challenge, required user verification, active user, and one-time challenge consumption.
  - Never store private key material; persist only credential ID, public key, counter, transport metadata, and bounded device metadata.
  - Do not let deactivated users authenticate through a credential that remains stored.
- Reference: `tasks/passkey-auth-plan.md`, `docs/AREA_SETTINGS.md`, and `docs/AREA_USERS.md`.

## D-044: Event-Linked Reservations Infer Internal Schedule Work
- Date: 2026-08-04
- Status: Accepted
- Context:
  - An event-linked gear reservation is an explicit statement that the internal requester expects to work that event, but the existing booking flow only linked equipment to the event.
  - Internal Schedule visibility is assignment-backed. A collaborator event follow is not a substitute for an internal `ShiftAssignment`.
  - D-042 protects private working copies and requires published worker-facing schedule truth to remain coherent.
- Decision:
  - Creating a `RESERVATION` for one or more events automatically reuses the requester’s existing active assignment on the chronologically primary event, or creates one direct assignment when a safe slot is available.
  - The requester’s `User.staffingType` selects the FT or ST slot class. `primaryArea`, then area assignments, select a preferred area. An open preferred-area slot is filled first; when all preferred-area slots are occupied, a matching slot is cloned from that area. Without a resolvable area, the system may use an existing open slot but never invents an area.
  - An explicit `shiftAssignmentId` remains authoritative. Collaborators continue to use the existing published-event follow behavior and are never added to internal staffing assignments.
  - The reservation and assignment are written in the same `SERIALIZABLE` transaction. Existing active-assignment conflicts and approved time off block the reservation; advisory availability conflicts are retained on the assignment.
  - A reservation may update a published group’s relational assignment and `lastPublishedSnapshot` together, incrementing `publishedVersion`. It never mutates an active working copy. Missing shift groups, active working copies, and ambiguous crew setup leave the booking valid without silently creating an event crew.
  - `ShiftAssignment.source` records `MANUAL`, `AUTO_FILL`, or `RESERVATION` provenance. Existing reservation-note rows are backfilled during migration `0107`, and new reservation assignments carry the durable source.
  - Event relinks, owner transfers, cancellation, no-show expiry, and user deactivation reconcile reservation-managed links. Shared assignments remain active for another active reservation; manual and auto-fill links remain untouched; a working-copy conflict becomes an auditable review state.
  - Explicit assignment links are validated for requester ownership, active status, and event scope before the booking write. Assignment notifications are dispatched only after the transaction commits.
- Consequences:
  - Reserving gear from an event now places internal workers on the event Schedule without a second staffing action when the event has a usable crew setup.
  - Published collaborator and worker-facing schedule reads remain internally consistent after an automatic assignment.
  - Neutral, Non-game, or otherwise unconfigured events still require deliberate crew setup before a reservation can infer a schedule assignment.
- Guardrails:
  - Do not replace an explicit booking-to-assignment link.
  - Do not mutate a versioned working copy from the reservation path.
  - Do not release a manual or auto-fill assignment merely because a booking changed or was cancelled.
  - Do not release a shared reservation-managed assignment while another active reservation points at it.
  - Do not assign collaborators or guess an operational area when no safe area or slot exists.
  - Keep assignment conflict, availability, permission, transaction, and audit rules in force.
- Reference: `tasks/reservation-auto-schedule-plan.md`, `docs/AREA_RESERVATIONS.md`, and `docs/AREA_SHIFTS.md`.

## D-047: The macOS Companion Must Not Wake Neon
- Date: 2026-08-09
- Status: Accepted; implemented locally, production rollout pending
- Context:
  - A persistent menu bar helper that polls normal Wisconsin Creative routes would wake a suspended Neon compute even when no operational work is happening.
  - Booking and kiosk mutations already wake Neon naturally and are the authoritative moments when companion data can change.
- Decision:
  - Explicit password enrollment may access Neon because the user initiated it. Enrollment builds the initial companion projection and returns a signed, revocable credential.
  - Automatic launch, restoration, APNs handling, and manual refresh may access only Upstash-backed companion routes. They must never fall through to a database-backed route.
  - Successful booking, custody, kiosk, and relevant profile mutations rebuild the bounded companion projection after commit while Neon is already awake. The publisher stores that projection externally and sends a silent APNs invalidation.
  - Kiosk last-seen publication occurs only after the existing deferred heartbeat write commits.
  - APNs is an invalidation hint, not the source of truth. Failed or throttled delivery leaves the last trusted local cache visible, and manual refresh reads the same external projection.
  - Deactivation and role changes revoke external companion sessions so stale role claims cannot retain access.
- Consequences:
  - A suspended Neon compute stays suspended when staff launch, restore, view, or refresh the companion.
  - Companion freshness is event-driven and best-effort. Quiet time is expected and is not itself a health failure.
  - The projection duplicates a small read model in Upstash and requires signed macOS APNs capability before staff distribution.
- Guardrails:
  - Do not add timers, `/api/me`, dashboard, booking, kiosk, diagnostics, or other database-backed fallback reads to the macOS client.
  - Do not put booking details in the APNs payload.
  - Preserve the existing custody and role-visibility rules in projection construction.
- Reference: `plans/062-gearops-menu-bar.md`, `docs/AREA_DASHBOARD.md`, and `docs/AREA_NOTIFICATIONS.md`.

## D-048: Product Usage Counting Is First-Party, Pseudonymous, and Owner-Only
- Date: 2026-08-12
- Status: Accepted; implemented locally, production configuration and migration pending
- Decision:
  - Wisconsin Creative may collect a small allowlisted set of authenticated product-usage events in its own database.
  - Raw identity and client session keys are replaced with yearly rotating HMAC values before storage.
  - The private Usage report is authorized by `USAGE_ANALYTICS_OWNER_EMAILS`; role membership, including ADMIN, never grants access by itself.
- Guardrails:
  - Event names, platforms, surfaces, outcomes, duration buckets, app versions, property keys, and property values are server allowlists.
  - Free-form content, URLs, record identifiers, search terms, scanned values, precise location, advertising identifiers, and device fingerprints are rejected.
  - Telemetry failure cannot block an operational workflow.
  - Raw-event retention must remain bounded to 90 days or less before production enablement.
- Consequences:
  - Badge progress remains derived from server-authoritative operational evidence, never product telemetry.
  - The existing `/reports/usage` exposes aggregates only and stays separate from staff reports, user profiles, accountability, and audit history. The narrow owner-only named client-presence exception is defined by D-054.
- Reference: `tasks/private-usage-analytics-plan.md`, `docs/AREA_REPORTS.md`, and `src/app/privacy/page.tsx`.

## D-049: Web Releases Use Monthly CalVer Tags and GitHub Releases
- Date: 2026-08-15
- Status: Accepted; versioning workflow implemented locally
- Context:
  - The web application needs a simple, visible release identity without
    introducing a second Vercel production-promotion pipeline.
  - The repository already deploys through Git-connected Vercel changes and
    has a release script, but its previous `YYYY.MM.DD.N` format was more
    detailed than the desired monthly release cadence.
- Decision:
  - New release versions use `YYYY.M.N`, where `N` starts at `1` and increments
    within the calendar month. The first August 2026 release is `2026.8.1`.
  - The same version is written to `package.json`, `package-lock.json`, the Git
    tag, and the GitHub Release title.
  - `npm run release` remains an explicit shipping command from a clean,
    verified `main` worktree. It creates the version commit and annotated tag,
    then pushes both; a tag-triggered GitHub Action creates the GitHub Release
    with generated notes.
  - Vercel continues to deploy `main` as the production line. A GitHub Release
    is version metadata and does not independently promote a Vercel deployment.
- Consequences:
  - Reviewers can identify web milestones consistently in GitHub and source
    metadata without changing the current deployment path.
  - Existing historical tags remain readable even though they use the former
    four-part format.
  - A future release-gated Vercel promotion can be designed separately if the
    operational rollout needs it.
- Guardrails:
  - Do not run the release command from a dirty worktree or without explicit
    shipping approval.
  - Do not create a second production deployment from the GitHub Release
    workflow.
- Reference: `scripts/release.sh`, `.github/workflows/release.yml`, and
  `docs/RELEASE_VERIFICATION.md`.

## Change Log
- 2026-08-30: Amended D-022 to accept `Football Sony Battery` as a separate operational pool while keeping the normal `Sony Battery` reservation and custody policy. A family name alone does not create authorization; the earlier local requester-roster policy was walked back before migration or deployment. Physical data setup remains under GAP-74.
- 2026-08-27: Amended D-055 so Admin is the only human reviewer for both open-slot requests and Trade Board claims. Both approval permissions, full review payloads, web/native review queues, and initial/deadline reviewer notifications are Admin-only; Staff retain ordinary scheduling tools but no claim approvals or reviewer alerts, and student lifecycle messages are unchanged.
- 2026-08-26: Amended D-057 so event-worker backfill recognition is explicitly all-silent. Awards still persist, but no badge notification is created for any badge in the backfill recount; the worker surface contains no recipient-notification promise and finished-event adds remain immediate.
- 2026-08-25: Released the accepted Scoreboard, event-worker, Student-read, role-preview, app-activity, and linked-event-cap slices in production deployment `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE` from commit `c48dd43d`; authenticated role-specific and interaction proof remains tracked by the relevant area gaps.
- 2026-08-24: Amended D-056 so Scoreboard result authority is W/L/T rather than W/L-only. The calendar `[T]` marker is retained in raw source evidence, stored as `TIE`, included in official records and filters, and counted as half a win for rate. The enum and idempotent source-backed backfill are split across migrations `0132` and `0133` so the new value is committed before the backfill uses it; migration and compatible route deployment are complete, while authenticated production proof remains pending.
- 2026-08-23: Renamed D-057's record from "Scoreboard credit" to **event worker** in product language, schema, routes, and UI: the control is "Add worker". The Scoreboard's `eventCredits`/`gameCredits` tallies keep the word credit, because a credit is what gets counted and a worker is who gets counted. Migration `0131` was renamed with it -- it had not been deployed anywhere, so the table changed cleanly with no data step.
- 2026-08-23: Extended D-057 so shift badges count added workers too, and stay silent about it. Badge evidence now comes from one shared reader used by both the awarding evaluator and the profile progress bar, added workers contribute only facts the event itself carries (no invented area, call window, or all-day hours), and adding a worker to a finished event re-evaluates badges immediately. A badge the person's own assignments already earned notifies as usual; one that only an added worker pushed them over is granted without its notification, so adding a worker produces no message on any surface.
- 2026-08-23: Added D-057 for admin-added event workers. An admin can add any person -- internal or collaborator -- to a past or future event without creating a shift, an assignment, or a notification. Scoreboard totals, profile records, and worked-event counts read added workers alongside active assignments and still count each person once per event; Schedule, published crews, My Shifts, trades, and ICS never read them. Migration `0131` is written; remote deploy and authenticated production proof remain pending.
- 2026-08-23: Amended D-056 so the shared Scoreboard is an always-on stats explorer and the deterministic aggregation foundation for a future end-of-year story. Sport, Schedule venue, opponent, and Home/Away/Neutral site are exact-match dimensions that stack with AND semantics; every total, breakdown, Snapshot, and person ranking describes the same intersection while the full bounded scope supplies stable filter options. Visible clients call the scope “Current season” instead of naming the year; the server remains the sole owner of the underlying window.
- 2026-08-23: Added D-056 making the read-only Scoreboard a shared authenticated surface for Admin, Staff, Student, and Collaborator roles. The exception is limited to active visible identity plus Schedule-derived Scoreboard metrics; private profiles, contact data, schedules, bookings, activity, and unauthenticated publishing remain outside it. Local web/native implementation and authenticated local web proof are complete; production server/client rollout proof remains pending.
- 2026-08-23: Amended D-052 so Photo Mechanic is the default `/licenses` landing and Shared logins is `?tab=shared-logins`. Existing `?tab=photo-mechanic` links still open Photo Mechanic. The two models remain independent; vault encryption and Photo Mechanic claim/expiry semantics are unchanged.
- 2026-08-22: Added D-055 restoring approval-first student claims on both the open-slot and Trade Board paths, and retiring the half-removed instant-claim policy it replaces. Claims escalate and then auto-approve on a per-claim durable workflow rather than expiring unresolved. No schema or permission change; authenticated runtime proof remains pending.
- 2026-08-21: Added D-054 for the owner-only named App activity report. The narrow client-presence exception shows user/device/build/channel/launch context while preserving pseudonymous aggregate analytics, default-deny access, and the no-content/device-identifier boundary. Migration, environment, authenticated browser, and signed-client rollout proof remain pending.
- 2026-08-21: Amended D-034 for the locally verified, rebalanced 50-definition automatic catalog expansion. New goals avoid redundant raw-total ladders and use sustained or compound checkout, return, trade, and schedule facts; schedule-derived recognition may use confirmed ended assignment result/site/sport/opponent/mapped venue/conflict facts; checkout and return context rules remain on immutable/opened/current-custodian boundaries; app-open rules remain server-time receipt-claimed and no history is backfilled. Production deployment/runtime proof remains pending.
- 2026-08-20: Amended D-052 so `/licenses` is one Software destination with explicit Shared logins and Photo Mechanic licenses tabs. The default Shared logins view does not render or suggest Photo Mechanic pool controls; local transaction, response-minimization, POST reveal, and responsive-pool hardening remain rollout-proof gates.
- 2026-08-19: Added D-052 for the shared Software Vault: dedicated AES-256-GCM ciphertext, a required `SOFTWARE_VAULT_KEY`, audience-gated internal/collaborator access, explicit audited/rate-limited password reveal, and no secret values in list responses or audit records. Migrations `0125`/`0126` and the admin runtime surface are live; student/collaborator and secret-lifecycle acceptance remain.
- 2026-08-17: Added D-051 for rate-limited email-first discovery across web and native iOS. The existing allowlist and registration transaction remain authoritative; discovery returns only onboarding/password flow state, and old registration links now redirect to the app login surface.
- 2026-08-15: Added D-049 for monthly `YYYY.M.N` web release versioning,
  GitHub Release creation from pushed tags, and continued Vercel `main`
  production deployment.
- 2026-08-12: Added D-048 for first-party pseudonymous product usage counting with owner-only report access and a strict data-minimization boundary.
- 2026-08-10: Amended D-009 to use durable due-versioned checkout workflows, a five-stage schedule, late-stage collapse, location responders, +24h admin escalation without broad push, separate exact fanout caps, shared grace semantics, and category-aware delivery. Migration `0111` and authenticated production proof remain open.
- 2026-08-09: Added D-047 for the no-wake macOS companion projection, explicit enrollment exception, post-commit publication, Upstash-only reads, and silent APNs invalidation.
- 2026-08-07: Added D-046, superseding manual Schedule publication with a durable ten-minute quiet-period release, Student-only call times, Non-game defaults, eligible collaborator Staff-slot assignment, and retirement of active acknowledgement state.
- 2026-08-04: Added the settings-owned call-time fallback rule to D-042. The same default-window helper now feeds generation, manual creation, template review, settings mutations, and the live repair path, so call-time updates do not diverge between schedule locations.
- 2026-08-04: Added D-044 for treating internal event-linked gear reservations as schedule-work evidence while preserving explicit assignment links, working-copy isolation, published snapshot coherence, and safe crew-setup boundaries.
- 2026-08-04: Amended D-044 with durable assignment provenance, explicit link validation, lifecycle reconciliation for relinks/owner changes/cancellation/no-show/deactivation, shared-assignment protection, and post-commit schedule notifications.
- 2026-08-03: Amended D-032 after the Kohl Center kiosk exposed only users assigned to Camp Randall. Kiosk person discovery is now global for active visible internal users, with the existing explicit collaborator grant preserved; operational inventory, reservation pickup, booking, and custody location boundaries remain unchanged.
- 2026-07-31: Added D-043 for invite-granted user passkeys, shared sessions, recovery, ceremony replay protection, and kiosk separation. Native iOS now has local `AuthenticationServices` login, enrollment, management, and canonical-domain association; production migration and browser/device proof remain open.
- 2026-07-28: Amended D-039 so kiosk session credentials retain after-first-unlock availability while using the device-only Keychain class, preventing backup migration to another iPad.
- 2026-07-21: Added D-042 for versioned Schedule working copies, published-only worker reads, deliberate reconciliation, and bundled publish notification semantics.
- 2026-07-17: Extended D-037 so authenticated profile completion is native on iOS while registration remains web-owned and the canonical server completion contract remains shared.
- 2026-07-16: Added D-041 for fixed default-deny external collaborator profiles and the BTN_STANDARD gear plus published-Schedule contract.
- 2026-07-16: Hardened D-041 with a single profile registry, mandatory collaborator response sanitization across idempotent branches, direct audit-history denial, published-only collaborator event linking, and route-level negative tests.
- 2026-07-16: Amended D-041 from fixed BTN profiles to database-backed affiliation policies with nine validated grants, immutable revisions, immediate suspension, BTN parity, and Learfield suspended by default.
- 2026-07-15: Applied D-022 to the live battery catalog by consolidating active batteries into the four canonical unit-tracked Monitor, Sony, Gold Mount, and FX6 families while preserving history-bearing legacy rows outside active discovery.
- 2026-07-15: Extended D-022 so one numbered item family can contain multiple branded products while preserving one booking line, one base QR sequence, permanent unit numbers, and exact-unit custody.
- 2026-07-11: Reconciled the decision index and document-control date, formalized the historical D-032 and D-033 decisions, and added their current implementation references and provenance warning.
- 2026-07-10: Amended D-026 for checkout return Live Activities. Their 30-minute remote start is now event-driven through a durable workflow scheduled when custody opens or its return time changes, so it no longer depends on a sub-daily cron. The protected sweep remains a manual repair path.
- 2026-07-10: Amended D-040 so active-checkout editing requires an identified student context; idle dashboard detail remains read-only rather than fabricating requester attribution for an anonymous operator tap.
- 2026-06-25: Amended D-028 and D-040 for admin close-without-scan. Kiosk remains the standard custody return surface, while admins can close a physically verified returned checkout through a reasoned override with audit and override evidence.
- 2026-07-03: Amended D-026 for current Vercel Hobby cron limits. Hobby deploys require daily-or-slower cron expressions, so sub-daily Live Activity sweeps stay unscheduled unless the project moves to Pro or an external scheduler.
- 2026-06-15: Added D-040 for kiosk-only custody. App/web becomes reservation-first; direct checkout, reservation pickup, and return custody mutations are kiosk-only, with fulfilled source reservations closing as `COMPLETED`.
- 2026-06-08: Updated D-029/D-037 for the no-temp-password beta pivot. First-time onboarding now stays invite-first through AllowedEmail registration, while forced-password handling remains recovery-only.
- 2026-06-03: Added D-037 to make onboarding a bulk-capable, invitation-scoped account lifecycle while preserving the allowlist gate and forced-password safety.
- 2026-06-02: Updated D-026 to match shipped cron reality. Calendar sync is now documented as part of `morning-refresh` at 08:00 UTC, aligned with D-035, while manual Settings sync remains the on-demand escape hatch.
- 2026-05-20: Added D-036 for Brave-backed human-pick product image search. This replaces any revival of the withdrawn B&H scraping path for photos and keeps metadata enrichment out of scope.
- 2026-05-13: Added D-035 for daily maintenance consolidation: morning-refresh owns shift archiving, stale trade expiry, and pending-pickup auto-expiry; duplicate unscheduled cron routes should be deleted.
- 2026-05-10: Amended D-028 to match the kiosk custody boundary: app `/scan` is lookup-only, while checkout pickup and return scans run through kiosk routes.
- 2026-03-01: Initial decision log created from project memory dump.
- 2026-03-02: Added student-first mobile operations contract decision.
- 2026-03-09: Updated D-009 to reflect partial implementation and pending acceptance criteria. Updated D-010 to mark shipped items. Added D-016 (code-defined picker sections/rules) and D-017 (DRAFT booking state).
- 2026-03-11: Docs hardening — moved D-017 to Accepted. Clarified D-009 email as Phase B. Added AREA_NOTIFICATIONS.md cross-reference to D-009. Folded AREA_PLATFORM_INTEGRITY.md into Platform Invariants section. Added D-018 (asset financial fields → Phase B), D-019 (department → Phase B), D-020 (kit management → Phase B), D-021 (UW asset tag → optional import field).
- 2026-03-14: Added D-022 (item families with checkoutable units — trackByNumber flag, unit picker, conversion endpoint).
- 2026-03-15: Withdrew D-005 (B&H enrichment) — scraping blocked by source, feature removed.
- 2026-03-16: Shipped D-017 (DRAFT booking lifecycle). Shipped D-018 (asset financial fields — Procurement section in item detail).
- 2026-03-16: Added D-024 (booking reference numbers — CO/RV kind prefix + global sequence).
- 2026-03-22: Updated D-002 — UI layer now unified. Checkout and reservation detail pages share single `BookingDetailPage` component. API routes consolidated to `/api/bookings/[id]`.
- 2026-03-22: Added D-025 — user-facing status labels via `statusLabel()` helper. DB enum unchanged.
- 2026-03-24: Added D-026 (event sync hourly cron + staleness indicator — resolves PD-3) and D-027 (venue mapping admin-only + pattern validation — resolves PD-2). All pending decisions now resolved.
- 2026-03-25: Doc sync — resolved PD-4 (student KPIs defined). Updated D-010 to reflect shipped state (B&H withdrawn, notification center shipped, student dashboard shipped). Updated D-009 email channel from "Phase B" to "Shipped 2026-03-16". Updated D-019 from "Phase B" to "Shipped 2026-03-21" (department filter + combobox).
- 2026-03-30: Added D-028 (photo requirement on checkout/checkin — camera-only capture, scan-only checkin, BookingPhoto model).
- 2026-04-03: Added D-029 (registration gated by admin-managed email allowlist — AllowedEmail table, role pre-assignment, Settings UI).
- 2026-04-07: Added D-030 (kiosk auth — device-level token, not user sessions. KioskDevice model with activation code pairing).
- 2026-04-24: Added D-031 (multi-event booking — BookingEvent junction table with preserved Booking.eventId as primary; cap 3 events per booking).
- 2026-04-29: Added D-032 (kiosk operates within `kiosk.locationId` — `users`, `dashboard`, and `student/[userId]` reads are scoped; users with `locationId = null` are visible to every kiosk as a transitional rule until rosters universally carry a location FK).
- 2026-04-29: Added D-033 (DB-enforced single active allocation per asset — partial unique index `asset_allocations_asset_id_active_unique ON asset_allocations(asset_id) WHERE active = TRUE`. Closes the cross-flow double-checkout race that no application-level guard fully prevents. Application paths now `try { create } catch P2002 → 409`; migration 0048 includes a pre-flight DO block that fails if duplicates already exist).
- 2026-05-05: Updated D-022/D-023 for camera attachment scope — camera-tied SD cards/cages/fixed parts stay as non-bookable asset attachments, while QR-coded batteries keep numbered bulk semantics.
- 2026-05-05: Updated D-022 for derived numbered bulk unit QR scans using `{binQrCodeValue}-{unitNumber}`.
- 2026-05-05: Updated D-022 for kiosk-scanned numbered batteries and non-blocking camera-model battery availability warnings.
- 2026-05-13: Reframed D-022 around first-class item families: `BulkSku` remains the implementation model, but `/items` is the normal discovery/detail surface and `/bulk-inventory` is admin operations.
- 2026-08-10: Amended D-034: successful scans are an operational baseline rather than an achievement metric; checkout-open credit is immutable across post-open owner transfer; objectively completed automatic progress is repaired to an award; and authenticated app-open easter eggs may use server time without accepting a client clock.
- 2026-05-09: Added D-034 for badge achievements: event-sourced service boundary, feature flag off path, no retroactive backfill, 15-minute on-time grace, immutable definition keys, single-emit status helpers, peer visibility default, and profile-first UI.
- 2026-06-11: Extended D-022 consequences for Brother P-Touch label CSV export and printed-label tracking. Printed-label state stored per `BulkSkuUnit` (`labelPrintedAt`/`labelPrintedById`/`labelPrintBatchId`, migration 0077); QR data stays derived and is never stored.
- 2026-06-12: Added D-039 (kiosk sessions slide on activity server-side; iOS persists the session token in Keychain and rebuilds device info from /api/kiosk/me after reinstalls).

## D-045: A Shift's Coverage Window Is a Settings-Derived Fallback

**Decision.** `Shift.startsAt`/`Shift.endsAt` are a fallback derived from Settings > Sports call-time offsets, not a durable record of manual intent. A sport-settings save may retime any future timed shift whose window differs from the new default, regardless of whether that shift was generated, manually created, assigned, or annotated.

**Why.** Two services disagreed about this. `rebaseUpcomingShiftsForSportCodes` retimes only a shift that is `templateManaged` with no assignments, notes, or explicit call window, while `syncCurrentSportCallTimes` retimes every drifting shift with no provenance check. Because a grouped settings save runs the conservative rebase and then the aggressive sync, the sync's rule already won in practice. Making the fallback reading explicit matches shipped behavior and keeps one obvious answer to "what time is this shift?" rather than a per-slot archaeology problem.

**Consequences.**
- The durable per-slot and per-person override layer is the call window (`callStartsAt`/`callEndsAt`), which every propagation path preserves. That is where a real exception belongs.
- A manual edit to a shift's coverage window through `PATCH /api/shifts/[id]`, or an explicit `startsAt`/`endsAt` on shift creation, is not durable: the next sport-settings save may revert it. Staff wanting a lasting exception must set a call window instead. This is a known sharp edge in those two surfaces and is worth a UI nudge if it ever bites.
- All-day events keep date-only boundaries and are never given fabricated clock times.
- Verified on 2026-08-05: across 55 future timed events, 0 shifts differed from their sport default, so adopting this reading required no data change.

## D-050: Signature Capture Uses External Roster Members and Private Deterministic Artifacts

- Date: 2026-08-15
- Status: Accepted; implementation and rollout proof pending
- Context:
  - Signature collection is a team/season workflow for external athletes and coaches, with a separate Creative staff collection backed by linked internal users. It is not an extension of internal Wisconsin Creative staffing assignments or a group nested in a team roster.
  - Public-media Blob helpers and client-generated files cannot provide the authorization, reproducibility, or failure compensation required for signatures.
- Decision:
  - Use a dedicated signature domain keyed by canonical collection code and season. Men’s Basketball uses `MBB`, Football uses `FB`, Volleyball uses `VB`, Men’s Hockey uses `MHKY`, Women’s Hockey uses `WHKY`, Women’s Basketball uses `WBB`, and Wrestling uses `WRES`; Creative staff use a standalone `CREATIVE` collection for the same season; Administration uses a standalone `ADMIN` collection sourced from the fixed official UWBadgers Administration staff directory; manually entered one-off signers use a standalone `ADHOC` collection and store their sport/category on the member. Imported roster members remain separate records with an optional link to a Wisconsin Creative user. Creative staff are separate signature-member records linked to active, visible full-time Video/Photo/Graphics users; Administration members are separate required support-staff records and do not participate in Creative Staff identity reconciliation or team roster linking. Creative staff and Administration do not require team-roster nesting. A same-season non-player team member may share that internal identity only through a unique exact normalized-name match among those eligible users; ambiguity, players, ad-hoc members, and existing conflicting links fail closed.
  - Use a pen-class web gate: Safari `pointerType === "pen"` may draw, while touch, mouse, trackpad, and palm input may not. Exact Apple Pencil identity is a physical acceptance concern, not a cryptographic web claim.
  - Import fixed UWBadgers adapters for MBB, Football, Volleyball, Men’s Hockey, Women’s Hockey, Women’s Basketball, Wrestling, and Administration as immutable normalized snapshots. Parse one structural representation, deduplicate by profile identity, preserve player/coaching/support groups, parse Administration's `/staff-directory/<slug>/<profileId>` links and fixed `/1` source page, map Football and Volleyball's `2026-27` season to the source site's `2026` URL segment, and use the full season segment for Men’s Hockey, Women’s Hockey, Women’s Basketball, and Wrestling. Preserve wrestling weight classes as player metadata and leave its jersey number nullable. Apply only with an observed collection version. Reconciliation never deletes members or captures. When a current `PLAYER` source ID changes, apply may transfer a committed READY capture only from one inactive historical member with the same normalized name and role into a blank target; jersey numbers are advisory, and ambiguity, active saves, conflicting captures, and erased history fail closed for review while the historical row remains inactive and audited.
  - The client submits normalized strokes. The server creates a sanitized path-only SVG and renders the transparent PNG from that same SVG with matching crop bounds and content hashes.
  - Store artifacts in a private Blob store under immutable ID-based paths. Download and preview go through authenticated routes; SVG is attachment-only. Collection-card Download All reads only current committed PNG or SVG revisions, selected by format, and returns a deterministic private ZIP with clean signer filenames and collision suffixes. New stroke-generated artifacts conservatively omit tiny isolated marks outside substantive ink; existing imported revisions remain immutable until a reviewed source reimport. Box and native capture remain deferred.
  - Track save operations and pending-delete cleanup as durable signature state because database and Blob writes are not atomic. Successful recaptures retain immutable prior `READY` revisions for authenticated version-history downloads. Explicit signer removal and collection reset are privacy-erasure actions that queue every retained revision in their scope for deletion.
  - Collection delete is an admin-only, version-checked destructive action. It archives and invalidates the collection first, marks all retained revisions pending deletion, cleans private artifacts before removing roster records, and leaves the archived collection retryable when private cleanup fails.
  - Mounting the collection landing page automatically invokes the existing standalone Creative staff reconciliation mutation. Collection-list GET remains read-only so framework prefetch cannot alter roster state. Reconciliation remains version-checked and writes an audit entry only when membership or identity links change. It adds active visible full-time Video/Photo/Graphics users, links uniquely matching same-season team staff, preserves required-state choices and captures, and deactivates stale linked users without deleting their history. One canonical Creative staff capture owns the private artifacts for every linked row. Creative staff are required by default; admins may make individual members optional.
  - Amended 2026-08-27: Signatures is artifact-only and no longer owns a student-athlete website-profile workflow. A committed capture returns directly to the roster; Signatures does not expose or mutate birthday, hometown, or social handles. Existing nullable member columns and historical values remain in place for non-destructive rollback safety, while official roster hometowns may remain dormant source metadata. No destructive migration is required to retire the feature.
- Consequences:
  - A tile is complete only when the current capture revision is committed and both private artifacts are ready.
  - Physical iPad Safari, private Blob provisioning, deterministic rendering, and cleanup failure-injection tests are release gates.
- Guardrails:
  - Do not reuse `StudentSportAssignment`, expose public Blob URLs, trust client filenames or files, use fuzzy or ambiguous identity reconciliation, reconcile by email, or count local drafts as complete. The only name bridge is the exact unique normalized-name rule above.
  - Staff/admin can view, import, reconcile external rosters and Creative staff, capture, replace, remove, and download. Admin alone can configure pen settings, alter required state, archive, delete collections, and perform collection-wide reset.
- Reference: `docs/BRIEF_SIGNATURE_CAPTURE_V1.md`, `docs/AREA_SIGNATURES.md`, and `tasks/signature-capture-micro-app-plan.md`.

## D-051: Email-First Discovery for Invite-Gated Onboarding

- Date: 2026-08-17
- Status: Accepted; implemented locally, rollout proof pending
- Context:
  - Email blasts should send people to one app entry point. Separate registration links make web and native iOS behave differently and leave the user to understand an internal registration concept.
  - `AllowedEmail` is already the source of truth for first-time access, and email delivery is intentionally not a required Wisconsin Creative dependency.
- Decision:
  - The normal web and native sign-in flow starts with an email identity step. A rate-limited `POST /api/auth/discover` normalizes the address and returns only `flow: "onboarding"` for an unclaimed allowed email with no existing user, or `flow: "password"` for every other state.
  - The discovery response never includes role, name, profile fields, policy grants, or roster data. An inactive or missing collaborator policy stays on password sign-in rather than opening a registration path.
  - Web onboarding collects name and a self-chosen password in the login surface. Native iOS opens the existing native registration form with the discovered email locked. Both continue through the existing `/api/auth/register` transaction and role-aware Welcome/profile setup; the client-side discovery result is never an authorization bypass.
  - `/register` remains only as a compatibility alias that redirects to `/login` and preserves an old email query as a prefill. Authenticated onboarding-status actions copy the generic app login link instead of row-specific registration URLs.
- Consequences:
  - Email-blast links, copied operator links, web login, and native iOS now share one first-time entry point.
  - The two-state discovery result is a deliberate, bounded membership signal for the requested onboarding experience. Rate limits, minimal response data, generic failure behavior, and the final registration gate limit its value as an oracle.
  - No schema, temporary password, email service, or new profile authority is introduced.
- Guardrails:
  - Keep discovery IP and normalized-email limits sized for shared campus networks; never return account metadata or collaborator grants.
  - Registration must continue to re-check the allowlist, claim it transactionally, and handle races through the existing server constraints and generic rejection path.
  - Unknown future discovery values must fall back to password on native clients so compatible rollout cannot accidentally open onboarding.
- Reference: `docs/BRIEF_ONBOARDING_V1.md`, `docs/AREA_USERS.md`, `docs/AREA_MOBILE.md`, `src/app/api/auth/discover/route.ts`, and `tasks/email-first-onboarding-plan-2026-08-17.md`.

## D-052: Shared Software Credentials Use a Dedicated Encrypted Vault Boundary

- Date: 2026-08-19
- Status: Accepted; implemented locally, rollout proof pending
- Context:
  - The team needs one Software destination for ordinary shared department logins and a distinct Photo Mechanic two-slot activation-license workflow.
  - The existing `LicenseCode` model is a two-slot Photo Mechanic custody pool and must not become a general plaintext credential store.
- Decision:
  - Store shared software accounts in a separate `SoftwareCredential` model with application-encrypted account email and password ciphertext. Use AES-256-GCM with a dedicated base64-encoded 32-byte `SOFTWARE_VAULT_KEY`; missing or malformed key configuration fails closed.
  - Allow authenticated ADMIN, STAFF, and STUDENT users to discover active records and request password reveal/copy when their role is included in the record audience. ADMIN and STAFF retain management visibility; STUDENT requires the `STUDENT` audience. External `COLLABORATOR` users require both the default-deny `SOFTWARE_VAULT_VIEW` capability and the `COLLABORATOR` audience. Limit create, edit, restore, and archive to ADMIN and STAFF.
  - Return account email in the authorized list response only after server-side audience filtering, but never return password or ciphertext there. Password access is a separate rate-limited authenticated request with `private, no-store` response headers and the same audience boundary.
  - Audit create, update, archive/restore, and password reveal actions without writing secret values to before/after snapshots, errors, exports, or source fixtures. Archive is reversible; permanent deletion is not part of V1.
  - Keep one `/licenses` destination for route compatibility, but present explicit URL-addressable **Photo Mechanic** and **Shared logins** tabs. Photo Mechanic is the default landing; Shared logins is `?tab=shared-logins`. Existing `?tab=photo-mechanic` links still open Photo Mechanic. Photo Mechanic pool controls and actions render only in its own tab, and the two models remain independent.
- Consequences:
  - Shared credentials and Photo Mechanic activations have one discoverable Software destination without collapsing their distinct mental models or changing Photo Mechanic claim/expiry semantics.
  - Key replacement requires an operational re-encryption procedure before rotation; there is no self-service key-rotation UI in V1.
  - Production rollout requires migrations `0125_software_credentials` and `0126_software_credential_visibility`, environment-key configuration, collaborator policy review, admin-entered credentials, and authenticated browser proof before real account data is used.
- Guardrails:
  - Never seed, log, export, or test with real credentials.
  - Never add the password to list payloads, audit JSON, error text, or client source.
  - Keep reveal rate limits and audit events at the server boundary; client masking is defense in depth, not authorization.
- Reference: `docs/AREA_SOFTWARE.md`, `src/lib/software-vault-crypto.ts`, `src/app/api/software/[id]/secret/route.ts`, and `prisma/migrations/0125_software_credentials/migration.sql`.

## D-053: Accessibility Text Sizes Are Supported, Not Designed For

- Date: 2026-08-20
- Status: Accepted
- Context:
  - Wisconsin Creative serves a known, bounded population: roughly 30-60 Wisconsin Athletics creative staff and students, not an open App Store audience.
  - The 2026-08-20 Schedule capture matrix found real layout breakage at `accessibility-extra-large` and fixing the worst of it cost the venue line, which invited a larger `EventRow` layout rewrite.
  - Owner decision: no current user is expected to run accessibility text sizes, so that rewrite is not worth its cost or its regression risk.
- Decision:
  - Design and verify against the default and the standard larger text sizes. Treat the accessibility sizes (`AX1`-`AX5`) as supported-but-not-optimized: the app must remain usable and must not crash or lose function, but layout perfection at those sizes is explicitly out of scope.
  - Do not run the accessibility-size pass as a standing part of visual review. Light and dark remain required.
  - Keep the cheap safeguards already in place. Semantic `Font` styles, `@ScaledMetric` widths where they already exist, and VoiceOver labels stay; they cost nothing and carry the real accessibility value for this audience.
  - Revisit if the audience changes: a public release, an accessibility complaint from an actual user, or an institutional accessibility requirement each reopen this.
- Consequences:
  - `EventRow` keeps its side-by-side layout. The known consequence is that the venue line yields to the time column at accessibility sizes; this is accepted, not a defect to track.
  - Open Dynamic Type findings in `tasks/audit-schedule-ios.md` are retired under this decision rather than left as visible backlog.
  - Future audits should not re-raise accessibility-size layout as a finding without citing a trigger from the revisit list above.
- Guardrails:
  - This narrows layout scope only. It does not weaken VoiceOver, contrast, tap-target size, or Reduce Motion support, which serve this audience and stay in the ship bar.
- Reference: `tasks/audit-schedule-ios.md` (2026-08-20 Accessibility Capture Follow-up) and `docs/AREA_MOBILE.md`.

## D-054: App Activity Is an Owner-Only Named Client-Presence Report
- Date: 2026-08-21
- Status: Accepted; implemented locally, migration/configuration and rollout proof pending
- Context:
  - The product owner needs to answer practical support and adoption questions that aggregate usage cannot answer: which user launched the app, which device and OS they used, which build/channel they have, and whether they are stale.
  - This is useful operational identity context, but it is more sensitive than the existing pseudonymous aggregate report and must not become a role-granted staff analytics surface.
- Decision:
  - Add `/settings/app-activity` and `GET /api/settings/app-activity` behind the separate default-deny `USAGE_ANALYTICS_OWNER_EMAILS` allowlist. ADMIN status, staff permissions, breadcrumb visibility, global search, and direct route access do not grant it.
  - Join the non-hidden roster to a current `UserAppInstallation` record keyed by a secret-scoped server HMAC of a client-generated installation key. This keeps one installation row stable across annual event-identity rotation without exposing a hardware identifier. Store only platform, marketing version, build, OS version, coarse hardware model, best-effort release channel, and first/last/last-opened timestamps.
  - Compare iOS builds only when `IOS_LATEST_APP_VERSION` / `IOS_LATEST_APP_BUILD` is configured. Report `Latest`, `Stale`, `Newer`, or `Compare unavailable`; never infer “latest” from the absence of configuration.
  - Treat TestFlight/App Store classification as best effort. Native DEBUG builds report `development`; Release builds use the receipt path when available and otherwise report `unknown`.
- Guardrails:
  - Never store or accept UDID, hardware serial number, IDFA, raw installation keys, raw receipts, URLs, search text, record IDs, scanned values, or content.
  - Keep app-activity writes best effort so a missing migration or telemetry write failure cannot block product-event acceptance or an operational workflow.
  - Keep the current aggregate Usage report and 90-day raw-event retention contract unchanged; this report is current client presence, not replay or broad behavioral analytics.
- Consequences:
  - The owner can identify stale clients and target support/release follow-up without granting named usage visibility to the broader staff/admin population.
  - Reinstalling an app creates a new pseudonymous installation row; this is an installation-presence view, not a guaranteed device census or cross-install identity.
  - Production rollout requires migration `0129_app_activity_report`, owner/build environment configuration, authenticated owner/non-owner browser proof, and signed TestFlight/App Store client readback.
- Reference: `tasks/private-usage-analytics-plan.md`, `docs/AREA_SETTINGS.md`, `docs/AREA_REPORTS.md`, `docs/AREA_MOBILE.md`, and `src/app/privacy/page.tsx`.

## D-055: Student Shift Claims Are Approval-First on Both Paths
- Date: 2026-08-22
- Status: Accepted; implemented locally, authenticated runtime proof pending
- Context:
  - Claims were instant on both paths: picking up a published open Student slot created a `DIRECT_ASSIGNED` assignment, and claiming a Trade Board post executed the swap and completed the trade. Staff saw neither before it took effect.
  - That was the deliberate 2026-07-02 premier-removal policy, but it was never carried through. `approveTrade`/`declineTrade` and their routes survived with no UI caller, `APIClient.approveShiftTrade`/`declineShiftTrade` became dead Swift, the Schedule "Trade approval" chip counted a `CLAIMED` status that `claimTrade` could no longer produce, and `getScheduleOpenWork` returned a staff-only `pickupRequests` array that could never be non-empty. The system read as approval-first while behaving instantly.
  - This decision supersedes the instant-pickup policy recorded in `tasks/schedule-mvp-end-to-end-plan.md`.
- Decision:
  - A student claiming an open Student slot creates a `REQUESTED` assignment. Several students may hold requests on one slot; an Admin chooses, and `approveRequest` declines the rest in the same transaction. A student cannot file two requests on one shift.
  - A student claiming a Trade Board post moves it to `CLAIMED` and nothing else. The poster keeps the assignment until `approveTrade` runs the swap, so a claim alone never leaves a shift uncovered.
  - Student claim inventory and permission are scoped to the worker's primary area. Photo and Graphics are the only cross-area exception and form one symmetric claim pool; a `StudentAreaAssignment` in any other area does not widen Trade Board or Open Work eligibility.
  - Both queues resolve through `shift_trade.approve` and `shift_assignment.approve`, and both permissions are Admin-only. Staff retain ordinary Schedule/Trade Board reads, posting, cancellation, and non-review staffing tools but receive no full reviewer payload, queue action, or approve/decline authority.
  - Initial and deadline-driven reviewer notifications for both open-slot requests and Trade Board claims target active visible Admins only. Student lifecycle messages still go to the affected requester, poster, or claimer.
  - An unreviewed claim alerts its reviewer audience, then approves itself at a deadline, carried by a per-claim durable workflow (`pendingClaimReviewWorkflow`) modelled on `pendingScheduleReleaseWorkflow`. Deadlines derive from the claim's *effective* window start: escalate at T-48h, resolve at T-24h, falling back to a proportional split for a claim filed inside those leads.
- Guardrails:
  - Auto-approval calls `approveTrade`/`approveRequest` and never bypasses their re-checks. A 4xx (conflict appeared, slot refilled, time off approved) leaves the claim for an Admin and tells the same reviewer audience why.
  - List visibility, direct claim mutation, and approval-time revalidation use the same primary-area rule. Staff/Admin keep global operational reads, and students keep their own posts, pending claims, and history even when a later profile change would make a new claim in that area ineligible.
  - `REQUESTED` stays outside `ACTIVE_ASSIGNMENT_STATUSES`, so a pending request holds no slot, raises no conflict, stays out of My Shifts and the personal ICS feed, and never blocks staff from assigning directly.
  - A pending request sends no gear-prep nudge. Prep belongs to coverage the student actually holds.
  - Reviewer fanout runs after the claim commits, never inside the `SERIALIZABLE` claim transaction, whose read set two students racing a trade already contend over.
  - `expireOpenTrades` remains the post-shift backstop for stale `OPEN`/`CLAIMED` rows.
- Consequences:
  - Claims fail toward approval rather than expiry. Both students have already agreed to the swap, and an unresolved claim reaching the shift is the outcome where the poster believes they are off, the claimer believes they are on, and coverage depends on who guesses right.
  - No schema migration: `ShiftTradeStatus.CLAIMED` and `ShiftAssignmentStatus.REQUESTED`/`APPROVED`/`DECLINED` all survived the 2026-07-02 cleanup.
  - An auto-approval is a schedule change reviewers did not make, so it is always reported to the applicable reviewer audience.
- Reference: `docs/AREA_SHIFTS.md`, `src/lib/services/shift-trades.ts`, `src/lib/services/schedule-open-work.ts`, `src/workflows/pending-claim-review.ts`, and `tests/schedule-instant-pickup-source.test.ts`.

## D-056: Scoreboard Metrics Are Shared Authenticated Team Data

- Date: 2026-08-23
- Status: Accepted; deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; authenticated production rollout proof pending
- Context:
  - Team totals and per-person leaderboards are useful only when the whole signed-in team can discover and compare them. Making the destination role- or collaborator-capability-specific would turn recognition into private profile data and contradict the requested product behavior.
  - Existing user profiles contain contact, identity, scheduling, custody, and activity fields that must not be widened merely to expose a Scoreboard.
- Decision:
  - Every authenticated Admin, Staff, Student, and Collaborator may view `/scoreboard`, `GET /api/scoreboard`, and the Scoreboard for an active, non-hidden person. `scoreboard.view` is an explicit all-role permission and does not depend on `PEOPLE_DIRECTORY_VIEW` or another collaborator policy grant.
  - Team aggregates use the server-owned Scoreboard season and distinguish unique team events and games from person-event and person-game credits. Multiple shifts for one person on one event count once, and the aggregate is built with bounded batched event reads rather than per-person queries.
  - Official resolved game outcomes are source-owned `WIN`, `LOSS`, or `TIE` values. Ties count as resolved games, render as the third record value only when present, and contribute half a win to the server-owned win-rate calculation; clients may default an absent additive `ties` field to zero during rollout.
  - The aggregate route accepts at most one exact Sport, Schedule venue, opponent, and site value. Different dimensions stack with AND semantics. The service applies that one intersection to unique totals, all dimensional breakdowns, and every person summary; stable facets continue to come from the full bounded window so narrowing one dimension never removes the available choices in another.
  - Venue means the cleaned display component of `CalendarEvent.rawLocationText`, never an equipment pickup location. Site means the canonical `CalendarEvent.site` Home/Away/Neutral classification. The clients use generic “Current season” copy while the server retains ownership of the active scope key and date bounds.
  - The shared identity contract is limited to user id, display name, avatar, and Scoreboard metrics. Cross-user detail resolves only that minimal identity and the dedicated Scoreboard response; it does not load or expose the private user-profile payload, and protected event links are omitted from the shared detail surface.
  - Per-person event history includes every completed event with an active assignment or EventWorker, including result-less work. Result-less rows carry event summary identity but remain out of wins/losses/ties, form, streak, and result-filtered views.
  - The shared roster includes active, non-hidden people. Existing self and internal-operator handling of inactive or hidden records remains outside aggregate discovery and retains its current visibility rules.
  - This is an authenticated app surface, not public internet publishing. Unauthenticated reads remain denied.
- Consequences:
  - Scoreboard is first-class in the web left navigation and in native Browse plus regular-width sidebar navigation for every role.
  - The always-on explorer can produce a deterministic Snapshot for any filter intersection and establishes the reusable stat vocabulary for a later end-of-year narrative experience. That future presentation may add superlatives, streaks, and surprising combinations, but it must derive them from the same event authority and counting rules rather than inventing client-only facts.
  - Collaborators can recognize team work without receiving People-directory, contact, scheduling, booking, badge, audit, or custody access.
  - Server/web deployment must precede a native release that depends on the aggregate endpoint; student and collaborator production smoke remain release gates.
- Guardrails:
  - Never satisfy a Scoreboard read by widening `/api/users/[id]`, `UserDetailView`, or another private profile contract.
  - Never add email, phone, role, affiliation, profile fields, availability, call times, booking history, activity, audit data, or unrestricted event links to a shared Scoreboard payload.
  - Do not let a future recap or generated insight silently change the server-owned scope, official-record exclusions, event/person deduplication, venue/site meaning, or privacy boundary. Narrative copy must be reproducible from returned or server-derived facts.
  - Do not make the Scoreboard unauthenticated without a separate publishing, indexing, institutional-policy, and privacy decision.
- Reference: `docs/AREA_USERS.md`, `docs/AREA_COLLABORATORS.md`, `docs/AREA_EVENTS.md`, `docs/AREA_MOBILE.md`, `src/lib/services/team-scoreboard.ts`, `tasks/archive/completed-2026-08-23/team-scoreboard-plan-2026-08-23.md`, and `tasks/archive/completed-2026-08-23/scoreboard-explorer-plan-2026-08-23.md`.

## D-057: Event Workers Are Recorded Separately From Shift Scheduling

- Date: 2026-08-23
- Status: Accepted; migration deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; fully-silent backfill amendment implemented locally; authenticated production proof pending
- Context:
  - People work events they were never staffed on: a late fill-in, someone who covered without a slot, or a collaborator whose contribution is tracked but who is never scheduled through our crew system.
  - Backfilling those contributions as shift assignments would be wrong in every direction. It would message the person, publish them into a crew, put a past or future event on their My Shifts, expose them to trade and acknowledgement flows, and let staffing coverage math count a slot that never existed.
  - Collaborators in particular need tracking without scheduling: their assignments live outside our system, so a shift row would describe work we do not direct.
- Decision:
  - The product language is "add worker", never "credit". A credit is what the Scoreboard *counts*; an event worker is a *person on record*. Keeping the two words apart stops a person and a tally from sharing a name.
  - `EventWorker` is a distinct, admin-owned record: one person, one event, optional note, recorded actor, unique per pair. It carries no area, no slot, no call window, and no status.
  - Every place that already counts an active shift assignment for stats counts an added worker identically: the team Scoreboard, the per-person Scoreboard, profile game records, worked-event totals, and shift badge recognition. A person who is both added and assigned on one event still counts once, exactly as two shifts on one event count once.
  - Badge evidence is read through one shared reader used by both the awarding evaluator and the profile progress bar, so a badge can never award from a count the profile cannot show. An added worker contributes the event's own sport, site, result, opponent, and mapped venue; it claims no area and no call window, because it records that the work happened, not how it was staffed. An all-day event's midnight boundaries are a date rather than hours, so an added worker on one is excluded from the early-start and late-finish rules instead of tripping them.
  - Adding a worker to a finished event re-evaluates that person's badges immediately; a worker added to a future event is picked up by the nightly sweep once the event ends. Badges are never revoked, so removing a worker lowers live Scoreboard totals but leaves an already-earned badge in place.
  - Nothing else reads the table. Schedule, working copies, published snapshots, crew coverage, My Shifts, trades, acknowledgements, notifications, and ICS are unchanged and unaware.
  - An ended event that already has a planned shift slot is corrected through the normal Schedule working-copy editor; that automatic past-event backfill is a schedule publication, not an `EventWorker` record. `EventWorker` remains for work with no shift or slot to correct.
  - Writes are ADMIN-only, rate-limited, transactional, and audited on the event. Staff may read the worker list for an event they are running. Adding or removing a worker sends no notification of any kind, by design and not by omission.
  - Workers can be added to past and future events alike, and in any role including `COLLABORATOR`.
- Consequences:
  - Season stats can be corrected after the fact without rewriting schedule history or paging anyone.
  - Operators use one Schedule editing flow for both future planning and ended-event correction; no separate backfill affordance is required when a slot already exists.
  - The audit trail is the only record of an added worker, so audit coverage is the accountability mechanism for a control that silently moves recognition numbers.
  - Silence covers the entire backfill badge recount. Every newly earned badge is still written, but no badge notification is created, including when scheduled assignments also cross a threshold in the same pass. The suppression is durable, not deferred: the award row exists after the silent grant, so no later pass re-inserts it and none can notify late. Ordinary scheduled-shift recognition remains separate and may notify when it is not part of a backfill pass.
  - Because the shared Scoreboard response boundary is unchanged, no client -- web, native, or collaborator -- learns how a person came to be on an event; an added worker appears exactly like an assigned one.
- Guardrails:
  - Never notify, publish, or schedule from an added worker, and never surface one as a shift.
  - Never let an added worker create staffing coverage: an unfilled slot stays unfilled.
  - Never let an added worker double-count a person who also holds an assignment on the same event.
  - Never let an added worker invent an area, a call window, or an hour-of-day fact it does not have; breadth and time-of-day rules must stay unearned rather than approximated.
  - Never let the awarding path and the progress path read worked evidence from two different queries again.
  - Never notify for any badge award produced by an added-worker backfill, including one whose threshold is also reached by schedule-owned assignments.
  - Do not widen writes beyond ADMIN, and do not add a worker-writing path that skips the audit entry.
  - Do not reintroduce "credit" as the name for this record; the Scoreboard's own `eventCredits`/`gameCredits` tallies keep that word.
- Reference: `docs/AREA_EVENTS.md`, `docs/AREA_COLLABORATORS.md`, `src/lib/services/event-worker.ts`, `src/lib/badges/worked-evidence.ts`, `prisma/migrations/0131_event_workers/migration.sql`.

## D-058: Student Operational Reads Are Team-Visible
- Date: 2026-08-24
- Status: Accepted; deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; authenticated runtime proof pending
- Context:
  - The prior local pass over-constrained Students by hiding the Team Activity dashboard surface and limiting Users/profile routes to self-only. Current product direction is broad authenticated read visibility; mutations remain role/ownership-gated.
  - Photo Mechanic needs a useful shared-capacity view: students should know who holds an active linked slot, but that does not require exposing another account's private profile fields or the pool's management controls.
  - `scope=ios-home` is an explicit native personal payload, and collaborator capabilities/private-field minimization remain separate boundaries.
- Decision:
  - Normal `/api/dashboard` and `/api/dashboard/stats` responses and the authenticated web/native Bookings list/detail reads are team-visible for internal Students, Staff, and Admins. Student regular web Home shows team checkouts/reservations/pending pickup/overdue counts and generic Upcoming Events. `scope=ios-home` remains personal; collaborators remain capability-driven.
  - Student `/api/users` list and `/api/users/[id]` profile reads cover all active visible users/profiles. Hidden-roster protections remain server-owned; collaborator cross-user profile data remains minimized.
  - Student Photo Mechanic responses keep activation keys masked unless the student owns the active claim, while allowing the name/avatar of active linked holders. Other holder ids, email, occupant labels, and management fields remain server-side. The web pool's Action column is staff/admin-only; row selection continues to own the student claim flow.
- Guardrails:
  - Keep mutations and ownership checks role-gated; broad reads do not grant edit, claim, return, or management rights.
  - Keep hidden-roster protections and collaborator field minimization server-owned.
  - Do not reuse Photo Mechanic holder identity as a link to a private user profile.
  - Keep claim, copy, release, shared Scoreboard, and staff/admin operations unchanged unless a separate decision changes them.
- Consequences:
  - A Student can see team booking totals, other visible dashboard bookings, generic Upcoming Events, and all active visible user profiles without receiving cross-user mutation rights or hidden/private collaborator fields.
  - Local source and focused route/UI contracts are verified; deployment and authenticated browser proof remain rollout gates.
- Reference: `docs/AREA_DASHBOARD.md`, `docs/AREA_LICENSES.md`, `docs/AREA_USERS.md`, `src/app/api/dashboard/route.ts`, `src/app/api/licenses/route.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, and the Student privacy plan in `tasks/student-privacy-dashboard-licenses-plan-2026-08-24.md`.

## D-059: Brand Assets Are Logical Files With Immutable Versions in a Private Blob Store
- Date: 2026-08-26
- Status: Accepted; implemented locally with the dedicated private store and Preview migrations/runtime foundation verified; populated file lifecycle proof pending
- Context:
  - Resources currently stores Markdown knowledge-base entries and public editor images, but it does not provide a durable home for the logos, fonts, brand guide, templates, and other production files the Creative team needs to reuse.
  - Replacing a file by uploading a second name and deleting the first loses provenance and makes links or operational references ambiguous. The product needs one stable file identity with explicit replacement history.
  - The supplied 2026 brand guide supplies useful content categories, but its editorial design instructions must not silently become application authorization, validation, or approval rules.
- Decision:
  - Add an additive `Brand assets` tab under `/resources` backed by separate folder, logical asset, version, and short-lived upload-intent records. Keep the existing Markdown `Resource` model and guide routes unchanged.
  - Treat `(folder, normalized file name)` as the logical identity. A new upload to an existing identity creates the next `ResourceAssetVersion`, leaves prior versions intact, and advances the asset's explicit `currentVersionId` in one serializable transaction.
  - Use the existing Vercel Blob SDK's client-upload/multipart flow for binary transport, but require a dedicated private store credential (`RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN`). Do not reuse the public Markdown-image token or the private Signature Capture token, and do not fall back silently when the dedicated credential is missing.
  - Store only the verified Blob pathname and metadata in Prisma. Serve files through an authenticated download route with safe content-disposition and no-store headers; never return raw Blob URLs from the asset API.
  - Use existing `resource.view` for internal reads and `resource.create`/`resource.edit` for Staff/Admin folder and upload management. No collaborator visibility or new permission family is inferred in V1.
  - Create only the empty technical `Brand assets` root container in the migration. Do not seed the supplied PDF, assets, or category folders; users create the taxonomy that fits their work. The guide's visual rules remain human reference content, not code-enforced upload policy.
  - Add server-backed all-folder search, kind/favorite filters, and explicit sorting; keep folder browsing as the default and make broader discovery an explicit scope choice.
  - Provide authenticated previews for PDFs, images, and supported fonts. Preview requests continue through the app route, and unsupported production files retain a download/native-application path.
  - Make version notes part of the immutable version record. Restoring an older version copies its private Blob to a new pathname and creates a new version row/current pointer with an audit entry; it never repoints history or deletes a prior Blob.
  - Use a client upload queue for drag/drop and multi-file uploads with per-file progress, retry, and explicit duplicate handling. Favorites are server-persisted per user; recent shortcuts are deliberately browser-local and are not product records.
  - Generate internal links to the authenticated Resources route only. Links may identify a folder and logical asset, but never expose a raw Blob URL or public sharing capability.
- Guardrails:
  - Never delete or overwrite a previous version as part of replacement, and never let the client choose the current version pointer.
  - Bind each upload token to one pending intent, actor, exact pathname, size, content type, target folder/file, and expiry. Finalization must re-read Blob metadata before committing the version row.
  - Never expose a raw asset URL, secret Blob token, or private file to an unauthenticated or unauthorized caller. Missing private-store configuration fails closed.
  - Keep upload finalization and the current-version pointer/audit write in the same serializable transaction. Abandoned intents may remain pending until a later cleanup job; cleanup is not a destructive user action in V1.
  - Do not promote PDF copy about brand approvals, tone, logo usage, or design restrictions into a hidden validator without a separate accepted decision.
- Consequences:
  - The Resources tab can house the supplied brand guide and related assets without growing the Markdown guide model or requiring a bespoke binary protocol.
  - A replacement is visible as a single file row with a new version badge, while History provides traceable prior downloads.
  - The first real upload remains a separate authenticated browser read-back gate. Preview private storage is provisioned and empty, and migrations `0135`/`0136` are applied with no supplied PDF ingested; source, migration, and empty-state success alone do not prove the upload/replacement/history lifecycle.
  - The experience remains small by omitting delete, move, rename, public/external links, generated server thumbnails, and approval workflow. Browser previews, favorites, local recents, and internal authenticated links improve retrieval without changing ownership or publication policy.
- Reference: `docs/BRIEF_BRAND_ASSET_LIBRARY_V1.md`, `tasks/brand-asset-library-plan-2026-08-26.md`, `docs/AREA_RESOURCES.md`, `src/app/(app)/resources/page.tsx`, `src/lib/blob.ts`, and `src/lib/signatures/storage.ts`.
