# Tasks Index

Last updated: 2026-08-25

## Start Here

- Use `DESLOPPIFY.md` for the current cleanup backlog and next recommended desloppify task.
- Use `tasks/todo.md` for active execution notes and recent closeout reviews.
- Use this index for the task-root contract, archive buckets, and active follow-up ledgers.
- Treat `plans/README.md` as historical improve-plan context unless a current task explicitly references it.

## Root Folder Contract

Keep root `tasks/` for current work and durable reference ledgers only:

- `todo.md` - current queue and recent archive summaries.
- `orchestrator.md` - manual Codex cleanup/triage ledger.
- `lessons.md` - concise durable lessons and correction patterns.
- `technical-debt-cleanup-2026-06-19.md` - current task-folder cleanup ledger.
- Active `*-plan.md` files that still have unchecked implementation, rollout, verification, or follow-up work.
- Current audit docs used by audit skills, especially `audit-*-ios.md` and route/page audit files.
- Current roadmap/reference docs that intentionally guide future work.

Move completed plan files to the current dated `tasks/archive/completed-YYYY-MM-DD/` bucket instead of leaving them at root.

## Current Root Shape

As of this cleanup pass, root `tasks/` contains:

- 195 root files.
- 55 root `*-plan.md` files.
- 86 root audit files.
- 19 roadmap/reference files.
- 5 follow-up files.

Audit files intentionally remain at root for now because the repo audit skills read and write `tasks/audit-*.md` paths directly.

## Active Follow-up Ledgers

- `macos-companion-hardening-polish-plan.md` - shipped Developer ID/notarized macOS 1.0.0 companion with event-driven refresh, projection/session privacy hardening, and native interaction/accessibility polish; native XCTest, full smoke, and real APNs proof remain.
- `repository-audit-improvement-plan.md` - current whole-repository evidence-first audit, ranked repair, verification, and proof-boundary ledger.
- `overdue-notification-hardening-plan.md` - durable five-stage checkout escalation is implemented locally; migration, responder configuration, deployment, and authenticated channel/timing proof remain.
- `schedule-mvp-end-to-end-plan.md` - implementation and source/build verification are complete; authenticated web and native Trade Board runtime inspection remains.
- `ios-app-web-trust-contract-plan.md` - Build 24 is in Internal QA and External Beta; physical-device acceptance and authenticated production mutation proof remain.
- `reservation-auto-schedule-plan.md` - event-linked reservations infer internal work and attach the requester to the primary event schedule.
- `dashboard-pending-pickup-web-parity-plan.md` - Dashboard parity is deployed;
  authenticated confirmation of the production Pending Pickup lane remains.
- `ios-collaborator-published-schedule-redesign-plan.md` - implementation and source/build verification are complete; authenticated temporary-collaborator runtime proof remains blocked by the reset Simulator session.
- `ios-schedule-filters-calendar-management-redesign-plan.md` - result-oriented Schedule filters and recoverable Shift Calendar management plus verification.
- `ios-schedule-edit-times-post-trade-redesign-plan.md` - Edit Call Window and unified Post to Trade Board redesign plus verification.
- `ios-schedule-staff-authoring-redesign-plan.md` - Add Shift and Assign Person redesign plus verification.
- `ios-schedule-availability-trade-redesign-plan.md` - interactive Availability and action-first Trade Board implementation and verification.
- `ios-schedule-core-redesign-plan.md` - implementation is complete; List and Calendar appearance screenshots remain blocked only by the locked Mac.
- `admin-helper-followups.md` - remaining admin helper and low-priority systemic follow-ups.
- `bulk-battery-followups.md` - remaining battery-adjacent future slices.
- `internal-public-beta-release-cut-followup.md` - release cut work that requires a clean worktree and explicit shipping approval.
- `repo-public-surface-plan-2026-08-15.md` - public README, GitHub About metadata, and conservative web-release posture.
- `signature-capture-micro-app-plan.md` - Signatures execution ledger for supported team, Creative Staff, Administration, and one-off rosters; pen-only capture, private artifacts, hardening, and rollout proof.
- `software-vault-plan-2026-08-19.md` - encrypted shared software access above the existing Photo Mechanic license pool, with migration, key, and authenticated runtime rollout gates.
- `software-photo-mechanic-first-plan-2026-08-23.md` - make Photo Mechanic the default Software landing and extract the license pool from the page shell.
- `scoreboard-tie-result-plan-2026-08-24.md` - restore source-backed soccer tie results across Calendar sync, web/native Scoreboard contracts, and the migration/deployment proof boundary.
- `admin-role-preview-recovery-plan-2026-08-24.md` - recover the signed, read-only Admin role preview; production deployment is complete in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`, while the authenticated role matrix remains open.
- `student-privacy-dashboard-licenses-plan-2026-08-24.md` - restore broad Student team dashboard and visible user/profile reads, expose safe Photo Mechanic holder identity with masked keys, and retain write/private boundaries; production deployment is complete, while authenticated Student acceptance remains tracked in the ledger.
- `multi-event-five-cap-plan-2026-08-24.md` - expand linked booking/reservation events from three to five across web, API, draft, and native contracts; production deployment is complete, while authenticated five-link interaction remains open.
- `event-all-day-conversion-plan-2026-08-25.md` - let manual Event detail switch between all-day and timed windows and update Veterans Plaza Ceremony today; production data, notification, and editor proof are complete.

## Archive Buckets

- `tasks/archive/completed-2026-08-23/` - completed Accountability, profile/team Scoreboard hardening and explorer work, plus Gotham operational-identity typography plans.
- `tasks/archive/completed-2026-08-12/` - completed launch and Login visual-polish plan.
- `tasks/archive/completed-2026-08-19/` - completed Scoreboard and profile season-event-total plan.
- `tasks/archive/completed-2026-06/` - completed plans and queue cleanup summaries from the June cleanup run.
- `tasks/archive/completed-2026-07/` - completed plans moved during the July 11 repository cleanup.
- `tasks/archive/proofs/` - browser-smoke and screenshot proof artifacts.
- `tasks/archive/lessons-history-2026.md` - dated lesson evidence retained for traceability.
- `tasks/archive/` root - older archived plans that predate the dated completed bucket.

## Cleanup Rules

- Do not move active audit docs until the audit skills are updated to look in an archive/history path.
- Do not delete completed plans; archive them.
- Do not move plans with unchecked implementation, rollout, or verification items unless a new follow-up ledger preserves the remaining work.
- Keep references updated when moving a root plan into archive.

## Recently Archived

- `archive/completed-2026-08-23/accountability-table-readability-plan.md` - reduced the full Accountability leaderboard to five desktop scan targets, made return rate visually prominent on a continuous red-to-green scale, moved cramped widths to structured cards, and grouped incident receipts behind explicit 40px controls without changing ranking or access.
- `archive/completed-2026-08-23/scoreboard-explorer-plan-2026-08-23.md` - expanded the shared Scoreboard into a generic Sport/Venue/Opponent/Site explorer with exact stacked intersections, stable facets, web/native Snapshots, matched authenticated proof, and a deterministic foundation for a future end-of-year story; production rollout remains under GAP-71.
- `archive/completed-2026-08-23/accountability-leaderboard-plan.md` - promoted Accountability to the primary internal sidebar, preserved Admin-only cleanup controls, and replaced fixed podium copy with one deterministic shared draw from a 50-line reviewed jeer deck that stays fixed until the leaderboard changes.
- `archive/completed-2026-08-23/team-scoreboard-plan-2026-08-23.md` - made Scoreboard a universal authenticated web/native destination with bounded aggregate totals, deterministic per-person leaderboards, minimal shared identity, safe direct detail, and matched local runtime proof; production rollout acceptance remains tracked by GAP-71.
- `archive/completed-2026-08-23/profile-scoreboard-hardening-plan.md` - hardened the shared Scoreboard contract around server-owned season scope, pre-lookup privacy, recoverable/deduplicated paging, deterministic highlights, 40px web controls, and matched web/native proof.
- `archive/completed-2026-08-23/brand-identity-typography-plan.md` - restored Gotham to primary operational identity in shared row/report, equipment selection/review, item booking history, organization, overdue, and app-activity surfaces while keeping interface and supporting copy on Geist.
- `archive/completed-2026-08-19/profile-scoreboard-plan-2026-08-19.md` - added the read-only profile Scoreboard and a reusable 2026–27 event-level work total that includes exhibitions and non-game Schedule events while preserving the official game record and assignment-based badge semantics.
- `archive/completed-2026-08-18/license-expiry-date-only-plan.md` - corrected Photo Mechanic annual expiry display and local-calendar status handling while preserving the date-only storage, claim-eligibility, and notification boundaries; authenticated browser proof remains deferred by the shared local Next runtime blocker.
- `archive/completed-2026-08-18/schedule-activity-counts-plan.md` - restored audit-backed Schedule activity counts for imported calendar and staff working-copy changes while preserving the worker-facing release boundary.
- `archive/completed-2026-08-18/schedule-activity-preview-plan.md` - made audit-backed Schedule activity counts actionable through read-only previews linked to Event detail.
- `archive/completed-2026-08-18/schedule-local-date-ordering-plan.md` - keeps Schedule list entries in Central/local chronological order when encoded all-day events mix with timed events.
- `archive/completed-2026-08-12/ios-launch-splash-loading-polish-plan.md` - unified the native system launch, restore state, and identity-first Login around one branded surface while preserving session and auth authority.
- `archive/completed-2026-08-07/personal-calendar-all-day-export-fix-plan.md` - corrected private worker ICS feeds so inherited all-day assignments use date-only boundaries while explicit Student call windows remain timed.
- `archive/completed-2026-08-07/booking-api-hardening-plan.md` - closed booking
  lifecycle, transactional concurrency, change-feed, draft, export, audit, and
  custody-boundary hardening with authenticated local API proof.

- `archive/completed-2026-08-06/2027-sport-assignment-reconciliation-plan.md` - reconciled the 2027 sport roster, prepared ten pending student profiles, deployed Social and registration-time materialization, and verified the production Allowed Emails surface.

- `archive/completed-2026-07/ios-system-hardening-plan.md` - completed the
  full native bug, security, privacy, correctness, accessibility, recovery, and
  source-performance hardening pass. Device-only and authenticated acceptance
  evidence remains explicitly recorded in the root audit and risk registry.
- `archive/completed-2026-07/ios-reservation-drafts-plan.md` - hardened native
  draft recovery, canonical draft authorization and audit history, and atomic
  source-draft consumption during reservation creation.
- `archive/completed-2026-07/pending-pickup-reservation-consolidation-plan.md` - makes due booked reservations the single Pending Pickup model, starts no-show timing at scheduled pickup, opens kiosk custody directly, and retains raw staged rows only for verified cleanup.
- `archive/completed-2026-07/ios-booking-pickup-overdue-row-plan.md` - makes due native reservation rows turn orange and say when pickup was due without changing reservation lifecycle or kiosk custody.
- `archive/completed-2026-07/kiosk-bulk-turnaround-warning-fix-plan.md` - removed misleading bulk-family Tight turn warnings from direct kiosk checkout while preserving hard quantity shortages and exact-unit checks.
- `archive/completed-2026-07/web-booking-detail-ios-alignment-plan.md` - brought the native identity, live timing, requester, location, gear, and event hierarchy to shared web booking detail while retaining operator controls and context.
- `archive/completed-2026-07/booking-nudge-push-plan.md` - paired staff/admin overdue-checkout inbox nudges with preference-aware iOS push and booking tap-through.
- `archive/completed-2026-07/ios-reservation-final-copy-polish-plan.md` - separated event date and venue context, quieted Review battery rows, and removed synthetic event-launched reservation title prefixes.
- `archive/completed-2026-07/ios-reservation-power-picker-followup-plan.md` - completed exact event venue metadata, mixed popularity categories, grouped power guidance, honest availability fractions, Review recovery, and the updated app icon.
- `archive/completed-2026-07/ios-reservation-flow-consistency-polish-plan.md` - matched event selection to Schedule, unified reservation accent semantics, kept power guidance useful, simplified selected gear, and made Review complete.
- `archive/completed-2026-07/ios-reservation-schedule-editor-fix-plan.md` - repaired Manual scheduling, exposed editable linked-event windows, and added one-hour lead plus two-hour return defaults.
- `archive/completed-2026-07/ios-reservation-setup-interaction-polish-plan.md` - made schedule source the first decision, added event scopes, restored real popularity order, exposed counted-item steppers, and anchored power guidance above Review.
- `archive/completed-2026-07/ios-reservation-setup-final-polish-plan.md` - simplified native reservation Details into Event or Manual setup, made pickup location operational in Gear, added battery guidance, and strengthened Review identity.
- `archive/completed-2026-07/ios-reservation-post-create-conflict-recovery-plan.md` - made event-launched reservations open their new detail and returned structured create-time availability conflicts to Gear without losing selections.
- `archive/completed-2026-07/ios-reservation-gear-review-polish-plan.md` - made selected gear and conflicts visible in the native picker and rebuilt Review as compact editable Schedule and Gear summaries with an anchored create action.
- `archive/completed-2026-07/ios-bookings-actions-edit-reservation-redesign-plan.md` - added lifecycle-aware booking row menus, adaptive search, focused availability-aware editing, ownership transfer, and a compact three-step reservation setup.
- `archive/completed-2026-07/ios-bookings-empty-state-polish-plan.md` - replaced the oversized Mine-empty canvas with a compact adaptive all-clear card and quiet scope recovery.
- `archive/completed-2026-07/ios-bookings-surface-polish-plan.md` - unified Booking list/detail relative dates, reduced duplicated urgency chrome, replaced segmented scope with a Mine toolbar toggle, and added inline reservation recovery.
- `archive/completed-2026-07/ios-booking-detail-sheet-redesign-plan.md` - reorganized native Booking Detail around one identity header, one live operational summary, nearby role-gated actions, compact context, and a separate read-only equipment card.
- `archive/completed-2026-07/adversarial-unit-test-sweep-plan.md` - completed adversarial integrity sweep with 2,464 clean tests, shuffled-order proof, measured server coverage floors, native XCTest, and full build verification.
- `ios-booking-surface-alignment-plan.md` - aligned native Bookings rows with Item Detail's title, timing, requester, context, and restrained status hierarchy.
- `ios-item-detail-hierarchy-plan.md` - refreshed native Item Detail around compact Gotham identity, title-first custody, persistent upcoming-reservation state, neutral previous-booking history, grouped metadata, quiet attachments, and production-backed simulator proof.
- `ios-app-store-toggle-row-polish-plan.md` - refined dark-mode Settings and notification controls and replaced inactive Home metric cards with active-only disclosure rows.
- `ios-xcode-26-6-recommended-settings-followup.md` - encoded Xcode's selected sandboxing, team-inheritance, and String Catalog recommendations in XcodeGen.
- `ios-swift-6-xcode-26-6-fixes-plan.md` - moved Wisconsin to Xcode 26.6 project metadata and Swift 6, resolving SwiftData and ActivityKit concurrency diagnostics.
- `items-ui-conformance-ownership-pass.md` - aligned `/items` toolbar targets, creation language, and desktop table-header casing with the accepted design contracts.
- `operational-polling-activity-plan.md` - completed shared two-minute activity governor for booking, item, and audit polling so unattended tabs allow Neon compute to autosuspend.
- 46 completed plans from the root task folder - moved to `tasks/archive/completed-2026-07/` on 2026-07-11.
- `booking-title-normalization-ownership-pass.md` - standardized stored booking titles while preserving canonical UW sport codes across web, drafts, and kiosk writes.
- `schedule-title-normalization-ownership-pass.md` - standardized manual event titles; the 2026-07-17 correction restored source casing for synced and calendar-restored titles.

- `operational-status-rail-page-migrations-plan.md` - completed migration of eight page-level operational summaries to the shared rail with deliberate analytics exclusions.
- `items-status-rail-plan.md` - completed Items adoption of the shared operational status rail with pressed status facets under Details.
- `public-showroom-plan.md` - completed public stakeholder showroom plus the 2026-07-10 visual simplification pass.
- `hidden-smoke-users-plan.md` - completed hidden smoke/test user visibility, owner opt-in, cleanup endpoint, operational sweep, and rollout check.
- `booking-creation-ownership-pass-2026-05-07.md` - completed booking creation ownership pass.
- `scan-ownership-pass-2026-06-19.md` - completed lookup-only scan ownership pass.
- `reports-ownership-pass-2026-06-19.md` - completed reports ownership pass.
- `trade-board-ownership-pass-2026-05-14.md` - completed Trade Board ownership pass.
- `kit-detail-design-language-pass-2026-05-21.md` - completed kit detail design-language pass.
- `kiosk-gate-pending-pickup-plan-2026-05-10.md` - completed kiosk-gated pickup plan.
- `ios-schedule-detail-trade-control-clarity-plan-2026-06-03.md` - completed iOS schedule/trade control clarity plan.
- `web-interface-audit-plan-2026-06-05.md` - completed web interface audit execution plan.
- `web-bug-sweep-plan-2026-05-24.md` - completed web bug sweep ledger.
- `sprint-april-plan-2026-04-17.md` - completed April sprint plan.
