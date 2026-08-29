# Roadmap Ideas Intake - 2026-06-12

## Goal
- Flesh out roadmap ideas around direct user custody, MacBook lifecycle inventory, Brand Communications schedule-first onboarding, stronger badge gamification, guest gear access, football-owned gear warnings, student graduation lifecycle, Athletic Calendar Wrapped, iOS shift/calendar surfaces, smarter notification orchestration, and return exception reporting.
- Log adjacent ideas that fit Wisconsin Creative's current product model without weakening checkout, kiosk, schedule, resources, or badge contracts.

## Source Checks
- `docs/AREA_ITEMS.md`: serialized assets are tag-first, status is derived from allocations, and `availableForReservation`, `availableForCheckout`, and `availableForCustody` are policy flags, not live status values.
- `docs/AREA_BULK_INVENTORY.md`: item families and numbered units fit batteries and countable stock, but daily-use laptops should stay serialized assets because each machine has unique identity, warranty, specs, network identity, and assignee context.
- `docs/AREA_USERS.md`: users already carry role, area, sport, profile, active/deactivated state, contact, assignments, and badge relations. Any direct custody feature should land on user detail as a gear view, not just item detail.
- `docs/AREA_SHIFTS.md`: Schedule already owns Brand Communications as `COMMS`, staff/student slots, assignment conflicts, trades, and Schedule-first daily work.
- `docs/BRIEF_ONBOARDING_V1.md`: first-time access is invite-first through `AllowedEmail`; direct temporary-password onboarding is retired for beta.
- `docs/AREA_RESOURCES.md`: resources are role/area-aware and can target Creative areas, but schedule-only users should not be forced into resources if their workflow does not need it.
- `docs/AREA_BADGES.md` and D-034: badges are profile-first, event-sourced, feature-flagged, and earned from real domain outcomes. Badge progress must come from real counters or streaks.
- `docs/AREA_CHECKOUTS.md`: checkout creation already runs through a three-step wizard, creates `PENDING_PICKUP`, and keeps pickup custody at the kiosk. Equipment guidance and availability warnings are advisory before submit, while server checks remain authoritative.
- `docs/AREA_RESERVATIONS.md`: reservations are `Booking` records, `BOOKED` reservations can convert to `PENDING_PICKUP` checkouts, and approval workflows beyond the current tier model are out of V1 scope. This makes guest requests a distinct intake/approval layer before booking creation, not a mutation of normal reservation semantics.
- `docs/AREA_USERS.md`: student profile fields already include `grad_year` and `student_year_override`, and student year is derived from a September-August academic calendar. Current lifecycle handling is active/deactivated, not graduated/archive state.
- `docs/AREA_EVENTS.md`: the soft-archive pipeline preserves event, booking, and travel history, and the Events area already names Wrapped-style season analytics as a later feature.
- `docs/AREA_REPORTS.md`: reports already aggregate from durable operational tables with staff/admin-only access and bounded evidence exports.
- `docs/BRIEF_SCAN_TELEMETRY_V1.md`: scan session duration, manual fallback rate, error breakdown, and device distribution are identified as missing usage signals; Wrapped should only use these after they are durably stored.
- `docs/AREA_MOBILE.md`: iOS Home is action-first, iOS Schedule is first-class, shift push tap-through exists, and Gotham Black/Bold are already used on native brand moments.
- `docs/AREA_NOTIFICATIONS.md`: shift assignment, approval, removal, and call-time changes already create in-app, email, and push notifications with event routing context.
- `docs/AREA_NOTIFICATIONS.md`: checkout due/overdue escalation, reservation lifecycle, shift trades, badge award inbox rows, native push, calendar sync health, firmware release alerts, and notification preferences already exist, so the next roadmap layer should organize and harden notification intelligence rather than add isolated triggers.
- `src/lib/services/notifications.ts`: current trigger coverage includes checkout escalation, shift gear-up, shift schedule changes, reservation lifecycle, damage/lost item reports, and low-stock alerts.
- `src/lib/services/licenses.ts`: current license notifications include 2-day student rotation nags and admin/staff expiry warnings.
- `src/app/api/notifications/nudge/route.ts`: staff/admin gear-up nudges already enforce actor, assignment, and recipient rate limits.
- `docs/AREA_SCAN.md`: the app scan page is lookup-only now, and the doc explicitly says historical damaged/lost check-in reporting was tied to retired booking-mode scan UI and should be recut outside lookup scan.
- `src/app/api/checkouts/[id]/checkin-report/route.ts`: existing API supports damaged/lost reports, optional photo upload, audit, and supervisor notifications, but damaged photo/description are not yet required by the server contract.
- `prisma/schema.prisma`: `CheckinItemReport` already stores one report per booking and serialized asset, with type, optional description, optional image URL, reporter, and timestamp.
- `tasks/archive/completed-2026-06/sprint-april-plan-2026-04-17.md`: older iCal planning deferred to native EventKit, but current source now has an ICS token/subscription path. The new roadmap should harden the current path before revisiting EventKit-managed writes.
- `docs/DECISIONS.md`: D-001 derived asset status, D-004 tag-first identity, D-007 audit as product feature, D-011 role hierarchy, D-022 item-family boundaries, D-028 kiosk custody boundary, D-029/D-037 invite-first onboarding, and D-034 badge event sourcing are the main constraints.
- `docs/GAPS_AND_RISKS.md`: no open gap currently covers direct assigned custody, MacBook lifecycle planning, schedule-only audience mode, guest checkout request intake, football-owned gear warnings, student graduated archive state, Athletic Calendar Wrapped, or badge accountability beyond the shipped badge MVP.
- `prisma/schema.prisma`: `User`, `Asset`, `Booking`, `AssetAllocation`, `BulkSku`, `AllowedEmail`, `BadgeDefinition`, `StudentBadge`, and `BadgeStreak` provide the current extension points. `User` has `gradYear`, `studentYearOverride`, and `active`, but no exact graduation date, graduated timestamp, or explicit archive reason.
- `tasks/athletic-calendar-wrapped-plan.md`: dedicated plan for Creative Wrapped, including source contracts, candidate cards, durable collection gaps, privacy model, slices, and verification.
- `tasks/ios-shift-calendar-widgets-plan.md`: dedicated plan for iOS widgets, Apple Calendar metadata/reconciliation, and the Gotham Home/AFM greeting summary.
- `tasks/smart-notifications-plan.md`: dedicated plan for notification taxonomy, missing alert families, channel preferences, digesting, quiet hours, and future-roadmap hooks.
- `tasks/return-exception-reporting-plan.md`: dedicated plan for damaged/lost reporting in return flow and active checkout surfaces, evidence requirements, and urgent admin notifications.

## Product Themes

### 1. Direct User Custody For Daily-Use Gear

Working name: **Assigned Gear**.

Problem:
- Some equipment is not checked out through normal booking windows because it lives with a person day to day: MacBooks, backpacks, card readers, adapters, maybe staff camera bodies or permanent student gear.
- Today, these items can be marked unavailable for checkout, but the system does not explain who has the item, why, when that custody should be reviewed, or whether the assignment is still valid.

Product direction:
- Add a first-class custody assignment model for serialized assets that are physically assigned to a user outside the booking lifecycle.
- Keep checkout and kiosk custody separate. This is possession/assignment, not an `OPEN` checkout and not a shortcut around pickup/return scans.
- Direct custody should make item status legible: "Assigned to Jane Smith" instead of only "Unavailable" or "Available".
- User profiles should show an **Assigned Gear** tab or section so staff can answer "what does this person have?" during onboarding, offboarding, and incident review.

Likely V1 scope:
- Assign or unassign a serialized asset to a user.
- Require reason, assigned date, optional expected review/return date, and optional notes.
- Block normal checkout/reservation for directly assigned assets unless a staff/admin explicitly releases or changes the policy flags.
- Show assigned-to user on item detail, items list, global search, and user detail.
- Write audit entries for assign, release, transfer, and review-date changes.
- Include assigned gear in user deactivation/offboarding checks.

Key data questions:
- Add `AssetCustodyAssignment` instead of overloading `Booking` or `AssetAllocation`.
- Keep only one active assignment per asset and optionally allow historical rows.
- Decide whether assignee can be inactive. Recommendation: historical yes, new active assignment no.

First slice:
- Schema and service only: active direct custody assignment with audit, uniqueness, and read model.

### 2. MacBook And Laptop Lifecycle Inventory

Working name: **Device Lifecycle**.

Problem:
- MacBooks are operational assets, but their lifecycle is closer to IT asset management than camera checkout. They have serial numbers, MAC addresses, specs, OS version, warranty or AppleCare, assigned person, replacement cycle, and security state.
- A 3-year refresh cycle needs a visible roadmap so the team can plan replacements before a laptop becomes a surprise problem.

Product direction:
- Treat MacBooks as serialized assets with an IT lifecycle profile layered on top.
- Keep the normal asset identity fields for tag, serial, location, purchase date, purchase price, warranty, and notes.
- Add structured metadata for computer-specific facts rather than burying everything in freeform notes.
- Pair lifecycle planning with direct custody because most laptops will be assigned to a person.

Likely V1 scope:
- Add a **Device** section on item detail for laptop/computer categories.
- Track serial number, asset tag, assigned user, purchase date, warranty date, target replacement date, processor, RAM, storage, screen size, OS version, primary MAC address, secondary MAC address, and management/security notes.
- Add a replacement roadmap view: due this semester, due this year, next 3 years, overdue.
- Allow staff/admin to adjust planned replacement date without changing purchase date.
- Show lifecycle state on user detail and reports.

Good follow-ups:
- Import/update from CSV exported by MDM, Jamf, Apple Business Manager, or a spreadsheet.
- Maintenance events for repair, battery service, OS upgrades, and reassignment.
- Renewal/expiry calendar integration for AppleCare and warranty dates.

First slice:
- Use existing `Asset` fields plus metadata-backed computer details before committing to a broad new `DeviceProfile` table. If reporting/filtering becomes central, graduate to a table.

### 3. Brand Communications Schedule-First Access

Working name: **Schedule-Only Audience Mode**.

Problem:
- Brand Communications staff and students need Schedule-first participation but do not necessarily need gear checkout, equipment guides/resources, or operational inventory access.
- The current role model is broad: students can view users/items/reservations/checkouts, and schedule access is part of the general app.

Product direction:
- Add an access lane for people whose primary job is shifts, trades, and availability.
- Do not create a separate product. Make the app route and navigation role/area-aware enough that Schedule is the front door for this group.
- Preserve the invite-first onboarding flow and `COMMS` area assignment.

Likely V1 scope:
- Onboarding preview can assign `primaryArea=COMMS`, sport assignments, and a schedule-only capability profile.
- First login sends schedule-only users to `/schedule`, not Dashboard.
- Sidebar hides checkout, items, scan, and resources unless the user is explicitly given gear/resource access.
- Schedule list, My Shifts, availability, trades, and notifications remain available.
- Staff/admin can still manage these users from Users.

Key policy decision:
- A new role is probably the wrong first move. Roles are security levels. Schedule-only is an access profile or capability set layered on top of `STUDENT`/`STAFF`.

First slice:
- Planning decision plus navigation/access matrix. Then implement a "Schedule-only" access profile for `COMMS` onboarding without changing core RBAC.

### 4. Stronger Badge Gamification With Accountability

Working name: **Accountable Awards**.

Problem:
- Current badges recognize real system events and manual staff awards, but they are still mostly recognition. The next level should make incentives clearer while avoiding fake progress or attendance tracking that the product has already rejected.

Product direction:
- Keep badges fun, but connect them to reliable behavior: on-time returns, clean scans, complete handoffs, accepted trades, no missing units, and staff-verified contributions.
- Add accountability by pairing awards with transparent evidence, streak health, and gentle recovery paths.
- Do not award from route visits, timers, or broad attendance assumptions.

Likely V1 scope:
- Badge detail shows the evidence source: booking ref, return time, scan count, trade, or manual award note.
- Add staff/admin badge guidance and suggested award moments in operational flows.
- Add "at risk" progress for streak badges when there is a real pending responsibility, for example gear due soon that could preserve or break an on-time streak.
- Add team-level badge report filters by area, semester, category, and manual/auto source.
- Add positive accountability nudges: "Return by 4:15 PM to keep your on-time streak" when the user has an active checkout.

Hard boundaries:
- No shame leaderboard for overdue or missing gear.
- No badge penalties without an auditable source event.
- No attendance badges until attendance itself becomes a real product feature.

First slice:
- Evidence-backed badge detail and notification copy. This strengthens trust without changing evaluator rules.

### 5. External Partner And Guest Gear Access

Working name: **Guest Gear Requests**.

Problem:
- Some people need occasional gear access but should not become normal Creative users: external partners, Athletics partners, freelancers, visiting collaborators, or university units that work with the team a few times per year.
- Giving them full app access is too broad, but handling their requests fully outside Wisconsin Creative makes custody, audit, and availability weaker.

Product direction:
- Add a guest request intake flow where an external requester provides who, what, when, why, contact info, affiliation, sponsor/staff contact, and pickup/return expectations.
- Staff/admin review the request before it becomes a real reservation or pending-pickup checkout.
- Guest request approval should feed the existing booking wizard instead of creating a separate parallel checkout system.
- The guest requester does not need an app account in V1. Staff/admin remain the authenticated actor who approves, creates, and manages the booking.

Likely V1 scope:
- Public or semi-public request form with strict rate limits, CAPTCHA or equivalent abuse control, and no inventory-sensitive availability disclosure.
- Request fields: requester name, email, phone, organization, internal sponsor, reason, event/date context, requested window, gear notes, and pickup/return location.
- Staff/admin queue for pending guest requests with approve, decline, request more info, and convert to booking.
- Approve opens the existing `/reservations/new` or `/checkouts/new` wizard with guest context prefilled in title/notes/requester display.
- Audit every approval, decline, conversion, and staff note.
- Booking records should clearly show "guest request" context and the staff/admin owner responsible for the external handoff.

Key data questions:
- V1 can use a `GuestGearRequest` model with request status and conversion target booking id.
- Do not overload `AllowedEmail`; this is not first-time app onboarding.
- Decide whether the final booking requester must be an internal sponsor user. Recommendation: yes for V1, with guest details stored on the request and copied into booking notes/context.

First slice:
- Staff-only manual guest request creation and approval queue before exposing any public form. This proves data shape and approval flow without opening an unauthenticated surface first.

### 6. Football-Owned Gear Warning And Alternatives

Working name: **Owned-Gear Guidance**.

Problem:
- Students sometimes request football-owned gear even when normal Creative gear is available.
- This does not need a hard block or football-staff approval in the first pass, but it should create friction and make the better option obvious.

Product direction:
- Model gear ownership or stewardship as item metadata/policy, then warn during equipment selection when a student selects football-owned gear.
- Suggest equivalent or near-equivalent Creative-owned alternatives that are available for the same window.
- Let staff/admin proceed when appropriate. Let students proceed with a visible warning and reason capture if we decide that is useful, but avoid a full approval workflow unless behavior stays bad after the warning.

Likely V1 scope:
- Add an ownership/stewardship signal for serialized assets and item families, starting with `Creative`, `Football`, and `Shared`.
- In the booking wizard picker, when requester is a student and selected gear is football-owned, show an advisory warning.
- Suggest alternatives from the same category/type/brand/model family that are Creative-owned or Shared and available for the requested window.
- Carry the warning into Step 3 confirmation so staff/admin see the decision before creating the booking.
- Record warning acknowledgement or selected alternative in booking audit/details if the user continues with football-owned gear.

Key data questions:
- Could start as item metadata or a controlled policy field. If filtering/reporting matters immediately, add a real field.
- Need a lightweight "equivalent alternatives" heuristic before trying anything complex: same category, similar type, same mount/system when available, available for the requested window, not retired/maintenance.
- Need to define whether "football-owned" maps to Department, Category, Location, or a new stewardship field. Recommendation: use a dedicated stewardship field rather than overloading Department, because department often describes accounting or internal organization, not usage restriction.

First slice:
- Source-contract and picker-warning slice using existing item metadata/policy where possible. Add the simplest available-alternative query only after the warning copy and data source are proven.

### 7. Student Graduation Dates And Graduated Archive State

Working name: **Student Lifecycle**.

Problem:
- `gradYear` is useful for class standing, but it is not a precise graduation date and does not communicate whether a student is still operationally active, graduated, or archived.
- Generic deactivation is too blunt for alumni. A graduated student should retain history, badge records, authored resources, past shifts, and gear audit trails, while being removed from default operational pickers.
- Staff need a smart way to fill graduation dates without hand-editing every profile, then mark students graduated after gear, schedule, license, and access obligations are handled.

Product direction:
- Add a lifecycle state or archive reason that distinguishes `ACTIVE`, `GRADUATED`, and other inactive/deactivated states.
- Add an exact graduation date field, populated manually or smart-filled from `gradYear` and the academic calendar default.
- Keep the existing derived student-year behavior, but make graduation date the operational offboarding trigger.
- Marking a student graduated should be a staff/admin action with audit, not a silent cron-only status flip.

Likely V1 scope:
- Add `graduationDate` or equivalent to student profiles, plus a clear graduated/archive state.
- Smart-fill missing graduation dates from `gradYear`, with an editable default such as the end of the graduation term.
- Add Users filters for "missing graduation date", "graduating soon", "graduated", and "archived".
- Add a staff/admin bulk review surface for likely graduating students by grad year, student-year override, area, sport, or assignment.
- Mark graduated only after showing open obligations: assigned custody, open checkouts, future bookings, future shifts, active licenses, allowed-email access, active sessions, and pending guest/sponsor ownership.
- Hide graduated users from default checkout, reservation, schedule assignment, and custody assignment pickers while preserving read-only profile/history access for staff/admin.

Key data questions:
- Is `active=false` enough? Recommendation: no. Keep an explicit graduated/archive state or reason so graduated alumni are not indistinguishable from discipline, account removal, or generic deactivation.
- Should graduation be automatic? Recommendation: support a review queue first. Automation can suggest candidates, but staff/admin should confirm because gear, shifts, and license cleanup are operational decisions.
- Does graduation block login? Recommendation: graduated users should not be able to book gear, claim shifts, or mutate operational records. Whether they can still view limited profile/history is a policy decision.

First slice:
- Decision and data slice: define lifecycle status, exact graduation date semantics, smart-fill rules, and offboarding blockers before touching UI.

### 8. Athletic Calendar Wrapped

Working name: **Creative Wrapped**.

Problem:
- A June recap could make the product feel alive and give students, staff, and admins a positive reason to care about clean operational data all year.
- The risk is building a flashy recap from weak facts. Wrapped should use durable domain events, not page visits, vanity counters, or short-retention analytics.

Product direction:
- Generate a season recap after the athletic calendar closes in June. Default season boundary: July 1 through June 30.
- Start with staff/admin preview, then user-owned recaps, then team/area/sport variants after privacy and evidence rules are proven.
- Treat Wrapped as a read model over existing source-of-truth tables wherever possible.
- Store generated snapshots only after review so the recap stays stable even if source data changes later.

Likely V1 scope:
- Individual recap cards for events worked, sports touched, gear handled, on-time returns, scan success, badges, trades, firsts, busiest month, and a playful gear personality.
- Staff/admin team recap for total events supported, staffed shifts, checkout volume, most-used categories, scan success, badge distribution, and operational highlights.
- Staff/admin-only risk recap for missing-unit patterns, repair/damage signals, overdue patterns, and graduating users with open obligations once Student Lifecycle exists.
- Evidence links from staff preview back to the underlying bookings, scans, events, shifts, badges, and reports.
- Card suppression before publish so awkward or misleading cards can be removed.

Key data questions:
- Existing data is enough for many cards: `Booking`, `BookingEvent`, `ScanEvent`, `ScanSession`, `CalendarEvent`, `ShiftAssignment`, `ShiftTrade`, `EventTravelMember`, `StudentBadge`, `BadgeStreak`, `BookingPhoto`, `CheckinItemReport`, `BulkStockMovement`, and `AuditLog`.
- Missing durable data should be collected before next June: scan method/manual fallback/session details, guidance acknowledgements, future football-owned warning acknowledgements, guest request conversions, direct custody assignment/release, and graduation/offboarding events.
- Recommendation: create a `WrappedSnapshot` table only when the preview/publish flow ships. Add a `WrappedFact` ledger only for facts not already represented by current domain tables.

First slice:
- Source contract and data dictionary, then durable collection gaps. Do not build the recap player before the facts are stable.

### 9. iOS Shift Widgets, Apple Calendar Trust, And Home Greeting

Working name: **Shift Glance**.

Problem:
- Students will often check shifts from iOS widgets or Apple Calendar before they open Wisconsin Creative.
- The current iOS Calendar action opens a Wisconsin Creative ICS feed, but the feed is metadata-light and does not yet give strong local trust/reconciliation.
- Native Home could use a branded greeting and one-line shift state so the app answers "what do I need to know right now?" immediately.

Product direction:
- Add WidgetKit widgets backed by a small cached "my shift snapshot" rather than making the widget process do fragile live auth work.
- Harden the current ICS subscription feed first: stable identifiers, deep links, call-window metadata, gear status, area/role/sport, and custom `X-GEAR-TRACKER-*` fields.
- Treat Wisconsin Creative as authoritative for shift data. Apple Calendar can mirror and reconcile metadata, but calendar edits should not mutate official assignments without a separate audited workflow.
- Add a Gotham Black/Ultra-style Home/AFM greeting. Gotham Black is already bundled on iOS; Ultra requires a bundled font file before implementation.

Likely V1 scope:
- Small widget for next shift.
- Medium widget for next two shifts plus gear status.
- Lock Screen widget for next call time or clear calendar state.
- Apple Calendar management/status screen with subscribe/open, rotate feed link, and refresh expectations.
- Home greeting states: "Good morning, Erik", "Your shift starts at 7:00 PM tonight", "You have two shifts this week, with the next on Wednesday", "Your calendar is clear", and "You're on the clock."

Key data questions:
- Use `/api/my-shifts` or a thinner summary endpoint as the source for Home, widgets, and calendar status.
- Add App Group cached snapshot storage for WidgetKit.
- Extend ICS metadata before building EventKit managed-calendar mode.
- If EventKit V2 ships, store local event identifiers and report sync health, but do not accept local calendar edits as authoritative schedule changes.

First slice:
- Shared "my shift summary" contract and ICS metadata hardening. Widgets and greeting should read from the same contract so they do not drift.

### 10. Smarter Notifications And Nudges

Working name: **Smart Alerts**.

Problem:
- Notifications have grown into several valuable one-off triggers: checkout escalation, reservation lifecycle, shift changes, trade board updates, badge awards, license nags, firmware releases, calendar health, damage/lost reports, and low-stock warnings.
- The next risk is alert fatigue. Students should not get a push storm when a schedule is posted, and staff/admin should not have to infer which inbox rows are urgent, informational, or system health.
- Upcoming roadmap slices like guest requests, direct custody, football-owned guidance, graduation/offboarding, device lifecycle, and Wrapped will all need notifications. That needs a shared contract first.

Product direction:
- Create a notification taxonomy and delivery contract before adding more triggers.
- Every notification should declare source entity, actor, recipient policy, urgency, category, channel policy, dedupe key, deep link, expiry, and suppression rules.
- In-app remains the durable inbox. Push and email become preference-aware delivery channels, with future quiet hours, snooze, and digest support.
- Batch schedule-like changes into summaries when the human experience is a batch.
- Keep alerts role-aware: students get personal next actions, staff/admin get exceptions, coverage, approval queues, and system health.

Likely V1 scope:
- Expand notification categories beyond checkout/reservation/license into shifts, gear, badges, trade board, admin health, and system updates.
- Add schedule-posted and assignment-delta digest notifications.
- Add proactive call-time reminders, with suppression after recent changes or acknowledgement.
- Add pending-pickup expiry pre-warning before the 48-hour auto-cancel.
- Add smarter return nudges when gear is needed soon by another checkout, shift, or event.
- Add trade-board risk reminders for open trades nearing call time and stale approval queues.
- Add admin health digest for calendar sync, license expiry, firmware, low stock, damage/lost reports, and pending approvals.

What else is missing:
- Calendar trust alerts when Apple Calendar might be stale or token metadata changes.
- Gear readiness alerts for upcoming shifts without reserved or picked-up gear.
- License slot-available alerts for recent claim failures.
- Repair and maintenance lifecycle alerts after damaged/lost item reports.
- Custody review, assigned gear on inactive users, and semester possession checks after Direct User Custody ships.
- Graduation/offboarding obligations after Student Lifecycle ships.
- Guest request lifecycle notifications after Guest Gear Requests ships.
- Football-owned gear warning acknowledgements and pattern digests after Owned-Gear Guidance ships.
- Wrapped data-health alerts before the June recap window.
- Delivery health alerts when push tokens are revoked or a user has disabled a channel needed for critical operations.

First slice:
- Notification taxonomy and delivery contract. Do not add another broad family of alerts until existing trigger types are mapped into categories, channel rules, dedupe rules, and deep-link expectations.

### 11. Return Exception Reporting

Working name: **Return Exception Reporting**.

Problem:
- Damaged/lost reporting exists as a backend seed, but the modern app scan page is lookup-only and the historical booking-mode checklist that exposed this flow has been retired.
- Operators need to report damage while returning gear, and borrowers need a clear way to report an outstanding item as lost from an active checkout.
- Damaged gear is time-sensitive because the next booking may depend on that item being usable. Admins need instant notification with evidence.

Product direction:
- Add **Report issue** to the return gear flow for serialized items.
- Add **Report lost item** to active checkout equipment rows for outstanding serialized gear.
- Require photo and description for damaged gear.
- Require a description for lost gear.
- Notify admins immediately through in-app plus push with a checkout/item deep link. Email can remain best effort, but it should not be the only urgent path.
- Keep kiosk/return custody boundaries intact. Reporting an issue records evidence and accountability; the return/check-in flow still owns actual custody completion.

Likely V1 scope:
- Server-contract hardening for `checkin-report`: damaged requires photo and description, lost requires description, all paths audit.
- Return flow UI for damaged or lost reports per item.
- Active checkout UI for lost outstanding serialized items.
- Admin notification payload with report type, asset tag, booking title, reporter, evidence link when present, and deep link.
- Clear row state after submission: Damaged, Lost, evidence attached, reported by, reported time.

Key data questions:
- Existing `CheckinItemReport` is probably enough for V1 because it already carries booking, asset, type, description, image URL, reporter, and timestamp.
- If repair workflow becomes first-class, add a separate maintenance/repair case later instead of overloading the report row.
- Decide whether STAFF should receive the urgent notification with ADMIN. Recommendation: start with active admins to match the user's request, then add role policy after notification taxonomy work.

First slice:
- Tighten the API contract and tests before UI work. The current optional evidence contract is the highest-risk mismatch with the desired damaged-gear workflow.

## Additional Roadmap Ideas

### A. Offboarding Checklist With Gear, Schedule, Licenses, And Access
- When a student graduates, leaves Creative, or is deactivated, staff should see assigned gear, open bookings, future shifts, trade posts, license claims, resources authored, allowed-email state, sessions, and badge history.
- This should build on direct custody and the existing deactivation flow.

### B. Gear Readiness For Assigned Staff
- A person with assigned daily-use gear should periodically acknowledge possession and condition: "I still have this backpack and the charger is included."
- Keep it lightweight: semester check-in, move-in/move-out, or before a known refresh cycle.

### C. Device Replacement Budget View
- Turn the laptop roadmap into budget planning: replacement year, estimated replacement cost, department, and priority.
- Useful once MacBook lifecycle data is reliable.

### D. Schedule-To-Gear Eligibility Hints
- For users with both schedule and gear access, show whether their upcoming assigned event has the expected gear reserved or picked up.
- This already exists in pieces around event/detail/dashboard work; direct custody would add "you already have the assigned laptop/backpack" context.

### E. Area-Specific Starter Packs
- New students in Photo, Video, Graphics, or Comms could get onboarding checklists: required resources, profile fields, availability, assigned gear, badge starter goals, and first shifts.
- This would make onboarding more than account access.

### F. Custody Exceptions Report
- Report active direct assignments, overdue review dates, assigned gear with missing serials, laptops without replacement dates, and inactive users with assigned items.
- This is the admin counterpart to Assigned Gear.

### G. Partner Directory
- If guest requests become frequent, maintain a lightweight partner directory with organization, contacts, sponsor, history, and default checkout notes.
- Keep it separate from normal `User` accounts unless a partner truly needs authenticated app access.

### H. Ownership Policy Dashboard
- Staff/admin can audit football-owned, Creative-owned, shared, assigned, and restricted gear in one place.
- Useful once owned-gear warnings prove the signal is reliable.

### I. Graduating Cohort Review
- Semester-end staff workflow that lists likely graduates, missing graduation dates, assigned gear, active licenses, future shifts, and future bookings in one place.
- This should share the same obligation checks as deactivation/offboarding, but with graduated-specific language and archive behavior.

### J. Season Data Health
- Staff/admin can see whether this season is ready for Wrapped: missing event links, unclosed checkouts, scan telemetry gaps, unnamed gear categories, missing user area/sport assignments, and badge feature flag status.
- This makes data cleanup useful before the June recap instead of discovering gaps after the season ends.

### K. Calendar Trust Dashboard
- A staff/admin and self-service diagnostic for calendar subscription status, last generated feed time, token rotation, upcoming assignment count, and common Apple Calendar refresh caveats.
- Useful because students will treat Apple Calendar as the operational source even though Wisconsin Creative remains authoritative.

### L. Notification Digest And Quiet Hours
- Let students and staff choose immediate versus digest delivery by category once the taxonomy exists.
- Quiet hours should suppress push/email, not in-app inbox creation, and critical changes should still be visible immediately in the app.
- This is especially important for schedule publishing, trade board activity, and admin health alerts.

### M. Repair And Replacement Queue
- Damaged/lost reports should eventually feed a staff repair/replacement queue with owner, next action, target return-to-service date, and replacement decision.
- Keep this separate from the initial reporting slice so the first version stays focused on evidence capture and urgent awareness.

## Thin Slice Order
- [ ] Decision: define direct custody versus checkout custody and whether schedule-only access is a capability profile.
- [ ] Slice 1: Direct custody schema/service/read model.
- [ ] Slice 2: Item detail and user detail assigned gear surfaces.
- [ ] Slice 3: Device lifecycle metadata for MacBooks and laptops.
- [ ] Slice 4: Replacement roadmap/report.
- [ ] Slice 5: Schedule-only onboarding and navigation profile for Brand Communications.
- [ ] Slice 6: Student lifecycle decision, exact graduation date semantics, and smart-fill rules.
- [ ] Slice 7: Graduated archive state with user roster filters and offboarding blockers.
- [ ] Slice 8: Guest gear request model and staff/admin approval queue.
- [ ] Slice 9: Guest request conversion into the existing booking wizard.
- [ ] Slice 10: Football-owned gear stewardship signal and picker warning.
- [ ] Slice 11: Available alternative suggestions for football-owned gear selections.
- [ ] Slice 12: Evidence-backed badge detail and accountable nudges.
- [ ] Slice 13: Offboarding checklist that ties custody, graduation, and user deactivation into one review flow.
- [ ] Slice 14: Athletic Calendar Wrapped source contract, season boundary, and data dictionary.
- [ ] Slice 15: Durable collection for Wrapped gaps such as scan method/session telemetry and future guidance acknowledgement facts.
- [ ] Slice 16: Wrapped preview/snapshot model after source facts are trusted.
- [ ] Slice 17: iOS shift summary contract for Home, widgets, and calendar metadata.
- [ ] Slice 18: Apple Calendar ICS metadata hardening and native calendar status UX.
- [ ] Slice 19: iOS Gotham Home/AFM greeting summary.
- [ ] Slice 20: WidgetKit shift glance widgets backed by App Group cached snapshots.
- [ ] Slice 21: Notification taxonomy, channel policy, dedupe, deep-link, and preference matrix.
- [ ] Slice 22: Schedule-posted, assignment-delta, and call-time reminder digests.
- [ ] Slice 23: Gear pickup-expiry pre-warning and next-use return nudges.
- [ ] Slice 24: Trade-board risk, approval queue, admin health, and future-roadmap notification hooks.
- [ ] Slice 25: Return exception API hardening for damaged/lost evidence requirements and urgent admin notification.
- [ ] Slice 26: Return flow and active checkout UI for damaged/lost serialized gear reporting.

## Verification
- [ ] Schema validation and migration check for any model changes.
- [ ] Focused service tests for one-active-custody-per-asset, audit writes, release/transfer behavior, and deactivated-user guards.
- [ ] Student lifecycle tests for smart graduation-date defaults, explicit graduated/archive state, audit writes, and graduated-user visibility rules.
- [ ] Offboarding-blocker tests for graduation with assigned custody, open checkouts, future bookings, future shifts, active licenses, and active sessions.
- [ ] Role tests for schedule-only access so users cannot reach checkout or inventory mutations through direct API calls.
- [ ] Guest request tests for rate limits, approval/decline authorization, conversion audit, and no public inventory disclosure.
- [ ] Picker guidance tests for football-owned warning visibility, non-blocking behavior, and alternative suggestion filtering.
- [ ] UI source tests for item/user direct custody display and navigation hiding.
- [ ] Badge evaluator/profile tests if badge evidence or nudge behavior changes.
- [ ] Wrapped aggregation tests for season boundary, user/team visibility, multi-event links, source evidence, and snapshot stability.
- [ ] iOS shift summary and calendar tests for WidgetKit snapshot data, ICS metadata, token rotation, and Home greeting copy priority.
- [ ] Notification tests for taxonomy mapping, recipient policy, channel preferences, dedupe keys, deep links, quiet-hours suppression, and batch/digest behavior.
- [ ] Return exception tests for damaged photo/description requirements, lost description requirements, authorization, audit writes, admin notification payloads, and row-level UI state.
- [ ] `npx tsc --noEmit`.
- [ ] `npm run db:migrate:check`.
- [ ] `git diff --check`.
- [ ] `npm run build` before any commit that ships functionality.

## Stop Conditions
- Stop if direct custody starts reusing `Booking` or kiosk scan flows in a way that blurs checkout custody.
- Stop if schedule-only access requires broad role rewrites before a smaller capability-profile approach is proven.
- Stop if guest request intake exposes inventory availability or internal user data to unauthenticated requesters.
- Stop if guest requests start bypassing staff/admin responsibility for the final booking owner.
- Stop if football-owned gear warnings become a hidden block or approval workflow without a separate product decision.
- Stop if football ownership is modeled by overloading Department and that creates accounting/reporting ambiguity.
- Stop if graduated students are represented only by `active=false` and the product loses the reason/state distinction between graduation and other deactivation.
- Stop if marking graduated can hide users with unresolved assigned gear, open checkouts, active licenses, or future operational commitments without staff/admin review.
- Stop if MacBook lifecycle needs structured reporting immediately and metadata becomes too weak; choose a real table before writing migrations.
- Stop if badge accountability starts showing negative public rankings or progress that is not backed by auditable events.
- Stop if Wrapped cards depend on route visits, short-retention analytics, or stats that cannot be explained from source evidence.
- Stop if Wrapped exposes negative or sensitive user facts outside staff/admin preview.
- Stop if widgets require live authenticated network reads from the widget process instead of cached shift snapshots.
- Stop if Apple Calendar edits start mutating official shift assignments without staff/admin workflow and audit.
- Stop if a new notification lacks source entity, dedupe key, recipient policy, category, channel policy, and deep link.
- Stop if schedule publishing creates push storms instead of digest behavior.
- Stop if push/email delivery bypasses notification preferences or future quiet-hours logic.
- Stop if damaged gear can be reported without both photo and description.
- Stop if return exception reporting reopens the retired app booking-mode scan path or treats report records as authoritative item status.

## Review
- Logged only. No implementation shipped in this intake.
- Recommended near-term bet: Direct User Custody first, because it unlocks MacBook lifecycle, offboarding, and cleaner daily-use gear truth.
- Second near-term bet: Football-owned gear warning. It likely fits the existing picker guidance model and can reduce bad requests without a heavy approval workflow.
- Guest requests need more care because any public form creates abuse, privacy, and inventory-disclosure risk. Start staff-only, then expose externally after the approval model is proven.
- Added Student Lifecycle as a user-domain slice. Existing `gradYear` should feed smart defaults, but graduation itself needs exact date semantics, explicit archive state, audit, and offboarding gates.
- Added Creative Wrapped as a reports/events/badges slice. Existing durable tables can power most cards, but scan telemetry and future roadmap acknowledgement facts need collection before the next June recap.
- Added Shift Glance as an iOS schedule slice. Current `/api/my-shifts` and ICS token flows give a base, but widgets need cached snapshots and Apple Calendar needs stronger metadata before students can rely on it as their primary shift view.
- Added Smart Alerts as a notification orchestration slice. Existing triggers cover several important cases, but the next move should be taxonomy, digesting, preference expansion, and missing-family coverage rather than isolated push additions.
- Added Return Exception Reporting as a checkout/return slice. Existing `CheckinItemReport` and API work are a useful base, but damaged evidence must become required and the modern return/active checkout surfaces need first-class report actions plus urgent admin push.
