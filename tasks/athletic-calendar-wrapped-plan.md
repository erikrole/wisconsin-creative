# Athletic Calendar Wrapped Plan - 2026-06-12

## Goal
- Create a June athletic-calendar recap experience that feels like "Spotify Wrapped" for Wisconsin Creative, while collecting only durable operational facts that the product can defend.
- Use the athletic year as July 1 through June 30 unless a later product decision chooses a different boundary.
- Start with staff/admin preview and opt-in user profile recap before any public sharing or broad peer comparison.

## Source Checks
- `docs/AREA_EVENTS.md`: Events already name Wrapped-style season analytics as a later feature, and the soft-archive pipeline preserves full event, booking, and travel history for future stats.
- `docs/AREA_REPORTS.md`: Reports are staff/admin-only, read-only analytics over `Booking`, `ScanEvent`, `BulkStockMovement`, and `AuditLog`; existing report exports are bounded and evidence-oriented.
- `docs/AREA_BADGES.md`: Badges are earned from real service-level outcomes, not route visits, timers, or fake progress. Wrapped should follow the same standard.
- `docs/AREA_CHECKOUTS.md`: Checkout truth lives in the unified `Booking` model, with `PENDING_PICKUP`, `OPEN`, `COMPLETED`, and `CANCELLED`; kiosk pickup/return owns custody evidence.
- `docs/BRIEF_SCAN_TELEMETRY_V1.md`: Scan telemetry already identifies missing usage signals such as session duration, manual fallback rate, error breakdown, and device context. Wrapped should use durable scan facts only if they are stored, not if they only exist in short-retention analytics.
- `docs/DECISIONS.md`: D-002 keeps reservations and checkouts unified in `Booking`, D-003 keeps events as operational context, D-007 requires auditability for new mutation paths, D-028 makes photo evidence part of checkout/checkin, and D-034 keeps recognition event-sourced.
- `prisma/schema.prisma`: Current durable sources include `Booking`, `BookingEvent`, `ScanEvent`, `ScanSession`, `BookingPhoto`, `CheckinItemReport`, `CalendarEvent`, `ShiftAssignment`, `ShiftTrade`, `EventTravelMember`, `StudentBadge`, `BadgeStreak`, `BulkStockMovement`, and `AuditLog`.
- `src/lib/services/reports.ts`: Existing reports aggregate directly from domain tables with bounded exports and Postgres-side grouping where needed.
- `src/lib/badges/evaluator.ts`: Badge evaluators already compute checkout, return, scan, and trade recognition from service-level outcomes with Serializable transactions and idempotent source keys.

## Product Model

Working name: **Creative Wrapped**.

The recap should be celebratory, useful, and evidence-backed. It should not become a shame report or productivity scoreboard.

Primary audiences:
- Individual student/staff recap: "your season in Creative."
- Staff/admin team recap: "how the operation moved this athletic year."
- Optional area/sport recap: Photo, Video, Graphics, Comms, and sport-specific cuts when data density is high enough.

Season boundary:
- `seasonYear=2026` means July 1, 2025 through June 30, 2026.
- Generate after June 30, with a staff/admin preview period before users see their recap.

## Candidate Story Cards

Individual recap:
- Season cover: name, role/area, season label, top area or sport.
- Events worked: count of assigned/approved shifts tied to calendar events.
- Sports covered: top sports by shifts, bookings, travel roster, or event links.
- Gear handled: checkouts opened, reservations converted, most-used gear categories, most-used kits when available.
- Reliability: on-time return count/rate, longest on-time return streak, zero-error scan streak, clean handoff badges.
- Scan craft: successful scans, pickup/checkin balance, manual fallback rate if durable telemetry exists.
- Teamwork: trades posted, trades claimed, trades completed, manual awards, above-and-beyond notes.
- Big moments: first checkout, first worked event, first trade, rare badge, busiest month, most photographed/checkin-photo-supported handoff.
- Personal style: playful "gear personality" derived from top categories, for example Lens Wrangler, Battery Boss, Clean Handoff Captain.

Team recap:
- Total events supported, shifts staffed, open slots filled, sports touched.
- Total checkouts/reservations, completed checkouts, on-time return rate, average checkout duration.
- Most-used categories and highest-turnover gear.
- Scan success rate, most common scan error types, busiest kiosk days.
- Missing/damaged item trends from checkin reports and missing-unit evidence.
- Badge distribution, manual recognition themes, underused badges.
- Operational highlights: busiest week, busiest venue, top sport by gear activity, top area by events.

Staff/admin-only risk recap:
- Overdue patterns, repeated missing-unit patterns, football-owned warning follow-through once that feature exists.
- Users graduating with open obligations once Student Lifecycle exists.
- Gear with high use plus repair/loss signals, useful for replacement planning.

## Data Collection Model

Prefer rebuilding most Wrapped stats from durable domain tables. Add collection only for facts that are not durable today.

Recommended durable sources:
- `Booking`: checkout/reservation counts, status, requester, creator, sport, event, start/end, completion time.
- `BookingEvent`: multi-event linkage so secondary events count.
- `ScanEvent`: scan success/failure, phase, actor, booking, asset/family context, device context.
- `ScanSession`: pickup/checkin session duration and completion rate.
- `BookingPhoto`: photo-backed handoff count by phase.
- `CheckinItemReport`: damage/loss story and maintenance risk inputs.
- `CalendarEvent`: sport, home/away, venue, archived season history.
- `ShiftAssignment`: event work, area, worker type, request/approval/direct assignment state, attendance only if intentionally logged.
- `ShiftTrade`: teamwork and trade completion.
- `EventTravelMember`: travel participation.
- `StudentBadge` and `BadgeStreak`: recognition and streak facts.
- `BulkStockMovement` and unit allocations: missing-unit and consumable movement trends.
- `AuditLog`: staff/manual changes, but only for staff/admin recaps unless the action is safe to expose.

New collection to consider:
- `WrappedSeason`: season key, startsOn, endsOn, status, generatedAt, publishedAt.
- `WrappedSnapshot`: user/team/area/sport scope, season key, generated JSON payload, visibility, generatedAt, publishedAt, invalidatedAt.
- `WrappedFact`: optional append-only fact ledger for non-obvious events such as equipment-guidance acknowledgement, football-owned warning acknowledgement, direct custody assignment/release, guest request conversion, and graduation/offboarding events once those roadmap slices ship.

Recommendation:
- Do not duplicate existing checkout, scan, shift, badge, or event rows into a fact table right now.
- Do add source contracts and tests now so future collection points emit durable facts when the current tables cannot answer a Wrapped question.
- Generate snapshots after June 30 from the source tables, store the generated payload for stable display, and keep a rebuild command for staff/admin if source corrections happen.

## Visual Direction

The experience should feel more like a polished annual recap inside an operations app than a marketing landing page.

Structure:
- Full-screen recap player with 8 to 12 cards.
- Card size optimized for phone first, with desktop using a centered stage and side progress rail.
- Use high-contrast team brand moments sparingly: Wisconsin red, black, white, and subtle sport/area accents.
- Use real visuals where available: booking photos, gear thumbnails, event/team context, badge medallions.
- Avoid public leaderboards for negative stats. Use "team saved this many handoffs" language instead of calling out bad actors.

Card types:
- Hero cover card.
- Stat card with one number, one sentence, and evidence link.
- Timeline card for firsts and busiest month.
- Gallery card for most-used gear or badges.
- Map/venue card if location data is strong enough.
- Teamwork card for trades, manual awards, and event support.
- Closing card with next-season setup: update availability, check assigned gear, set graduation date, review badge goals.

## Privacy And Access
- Staff/admin can preview all generated recaps before publish.
- Users can view their own recap.
- Peer visibility should default to off until explicitly approved.
- Hide sensitive facts: overdue shame, damaged/lost attribution, private notes, staff audit actions, emails/phones, and guest partner details.
- Allow staff/admin to suppress a card or full recap before publishing if the source data creates awkward or misleading output.

## Slices
- [ ] Slice 1: Wrapped source contract and data dictionary. Define season boundary, supported metrics, source tables, visibility, and evidence links.
- [ ] Slice 2: Add missing durable collection only where current tables cannot answer planned cards. Likely candidates are scan session method/device details and future guidance acknowledgements.
- [ ] Slice 3: Build server-side Wrapped aggregation service for one user and one season, read-only and rebuildable.
- [ ] Slice 4: Add staff/admin preview route under Reports or Users with raw evidence links and card suppression controls.
- [ ] Slice 5: Store generated `WrappedSnapshot` payloads after staff preview, with publish/unpublish state.
- [ ] Slice 6: Build the phone-first recap player for a single user.
- [ ] Slice 7: Add team/area/sport recap variants after individual recaps are trusted.
- [ ] Slice 8: Add share/export only after privacy review and suppression controls are proven.

## Verification
- [ ] Source-contract tests for July 1 through June 30 season boundary, inclusive/exclusive date handling, and timezone-safe grouping.
- [ ] Aggregation tests for checkout counts, completed/on-time returns, scan success/failure, shift assignment counts, trade completion counts, badge counts, and multi-event booking links.
- [ ] Privacy tests proving student/self views cannot read another user's recap or staff-only risk cards.
- [ ] Snapshot tests proving published payloads remain stable after unrelated source edits unless explicitly regenerated.
- [ ] Report/API authorization tests for staff/admin preview.
- [ ] UI source tests for card suppression and empty-state copy.
- [ ] `npx tsc --noEmit`.
- [ ] `npm run db:migrate:check` if a snapshot/fact table ships.
- [ ] `git diff --check`.
- [ ] `npm run build` before any commit that ships schema or production routes.

## Stop Conditions
- Stop if a proposed card depends on route visits, timers, or analytics with short retention instead of durable product facts.
- Stop if negative stats become peer-visible or student-visible in a way that creates shame instead of accountability.
- Stop if aggregation reads become broad N+1 queries over bookings, shifts, scans, or events.
- Stop if snapshots cannot explain their source evidence to staff/admin.
- Stop if the recap encourages users to optimize vanity stats at the expense of clean operations.

## Review
- Shipped: Plan only. No implementation or data collection shipped yet.
- Verified: Source checks confirm most candidate metrics already have durable source tables. The biggest gaps are durable scan method/session telemetry and future roadmap facts such as custody assignment, guest request conversion, football-owned warning acknowledgement, and graduation/offboarding events.
- Deferred: Schema decision for `WrappedSnapshot` and optional `WrappedFact`, recap player UI, staff/admin preview, and publish flow.
