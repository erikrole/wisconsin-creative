# Notifications Area Scope (V1 Implemented)

## Document Control
- Area: Notifications
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-27
- Status: Active; durable overdue escalation hardening is implemented locally with migration and production rollout pending
- Version: V1.6

## Direction
Surface custody urgency and overdue situations to the right people at the right time, with zero duplicate noise and a clear escalation path.

## Core Rules
1. Notifications are triggers for action, not passive information.
2. Deduplication is mandatory: one recipient gets one stage for one booking due-date version.
3. In-app and email channels coexist; dev mode logs to console in place of SMTP.
4. The 24h overdue trigger reaches the requester and all admins, per accepted D-009.
5. Notification center supports mark-read and mark-all-read; read mutations must keep the inbox and bell count honest.
6. Approval-first open Student-slot requests and Trade Board claims create reviewer notifications only for active visible Admins. Staff receive no claim-review alerts; the request holds no slot until approved.

## Escalation Schedule (Local Candidate; Migration 0111 Pending)

All triggers are relative to `booking.endsAt`:

| Hours from Due | Type | Title |
|---|---|---|
| −2h | `checkout_due_2h` | Due back in 2 hours |
| 0h | `checkout_due_now` | Checkout is due now |
| Grace expiry | `checkout_overdue_grace` | Checkout overdue |
| +4h | `checkout_overdue_4h` | 4 hours overdue |
| +24h | `checkout_overdue_24h` | Checkout is 24 hours overdue |

The grace period applies only to `checkout_overdue_grace`. The due-time, +4h, and +24h offsets remain exact relative to `booking.endsAt`.

Recipient and channel policy:

| Stage | Requester | Location responder | Admins |
|---|---|---|---|
| -2h | In-app + push | - | - |
| Due time | In-app + push | - | - |
| Grace expiry | In-app + push + email | - | - |
| +4h | In-app + push + email | In-app + push | - |
| +24h | In-app + push + email | In-app + push | In-app + email |

Location responders are active visible STAFF or ADMIN users configured at `/settings/escalation`. If none are configured, delivery falls back to the active staff/admin booking creator, then active admins. Requester and operational recipient caps are independent and enforced inside fanout.

Implementation: `src/lib/checkout-escalation-policy.ts`, `src/lib/services/notifications.ts`, and `src/workflows/checkout-overdue-notifications.ts`.

## Reservation Lifecycle Triggers (Implemented 2026-04-23)

| Event | Type | Recipient | Trigger point |
|---|---|---|---|
| Reservation created | `reservation_booked` | Requester | `POST /api/reservations` |
| Gear ready for pickup | `reservation_pickup_ready` | Requester | `POST /api/reservations/[id]/convert` |
| Reservation cancelled | `reservation_cancelled` | Requester | `POST /api/reservations/[id]/cancel` (skipped if self-cancel) |

- Deduplication: `${bookingId}:reservation_${event}` — idempotent on retry
- Channel: IN_APP only (email deferred)
- Self-cancel: requester is not notified when they cancel their own reservation
- Implementation: `createReservationLifecycleNotification` in `src/lib/services/notifications.ts`

## Shift Trade Triggers (Implemented 2026-05-05)

| Event | Type | Recipient | Channels |
|---|---|---|---|
| Trade claimed, Admin approval required | `trade_claimed` | Original poster | In-app + email |
| Trade completed instantly | `trade_completed` | Original poster | In-app + email |
| Trade approved by an Admin | `trade_approved` | Claimer | In-app + email |
| Trade declined by an Admin | `trade_declined` | Claimer | In-app + email |

- Email is best-effort and sent after the trade transaction resolves.
- Email respects `notificationPrefs.channels.email`, `notificationPrefs.categories.trade`, and `pausedUntil`.
- Trade lifecycle rows now carry event-routable payloads with `eventId`, `shiftId`, `assignmentId`, `tradeId`, and `/events/{eventId}` where the trade can be tied back to a scheduled event.
- Native push is best-effort for claimed, completed, approved, and declined trade events when push and the `trade` category are enabled.
- Initial Trade Board claim review plus escalation, blocked, and auto-approved outcome notifications target active visible Admins only. Staff do not receive claim-review alerts.
- Direct-assignment emails remain out of scope; open Student-slot requests have their own reviewer fanout below.
- Implementation: `src/lib/services/shift-trades.ts` + `src/lib/services/shift-trade-emails.ts`

## Open Shift Claim Triggers (Implemented 2026-08-26)

| Event | Type | Recipient | Channels |
|---|---|---|---|
| Student requests a published open Student slot | `shift_request_review` | Active visible ADMIN reviewers | Durable in-app + best-effort push |

- The pickup route creates the `REQUESTED` assignment first, then calls the reviewer fanout after the request has committed. The reviewer row is informational: `REQUESTED` remains outside `ACTIVE_ASSIGNMENT_STATUSES`, so it does not hold coverage, create a gear-prep nudge, or appear in My Shifts.
- Reviewer rows are deduplicated by assignment and reviewer, carry the event-routable payload, and use the schedule notification preference category for push gating. A retry is safe.
- Initial open-slot request alerts plus the request workflow's escalation, blocked, and auto-approved outcome alerts are Admin-only. Staff have no claim approve/decline permission or queue visibility. Trade Board claim reviewer alerts follow the same Admin-only policy.
- The student receives the existing `shift_request_pending` lifecycle notification; approval or decline continues through the existing assignment notification path.
- Implementation: `handleOpenShiftPickup` in `src/app/api/shift-assignments/pickup/handler.ts` and `notifyPickupRequestReviewers` in `src/lib/services/notifications.ts`.

## Shift Schedule Triggers (Implemented 2026-05-21)

| Event | Type | Recipient | Channels |
|---|---|---|---|
| New direct assignment | `shift_assigned` | Assignee | In-app + email + push |
| Approved request | `shift_request_approved` | Assignee | In-app + email + push |
| Removed assignment | `shift_assignment_removed` | Assignee | In-app + email + push |
| Shift call-time changed | `shift_time_changed` | Active assignee | In-app + email + push |
| Personal call-time changed | `shift_personal_call_time_changed` | Assignee | In-app + email + push |

- Copy uses Staff and Student labels plus the effective call time.
- Deduplication includes assignment id, event type, and effective call window so retries do not duplicate unchanged messages.
- Worker-facing schedule notifications are publication-aware: draft assignments and draft call-time changes do not notify workers, while published assignment creates, approved requests, removals, and call-time changes do.
- Changed-after-publish call-time edits clear assignment acknowledgement before notifying the worker.
- Payloads are event-routable with `target: "event"`, `/events/{eventId}`, `eventId`, `shiftId`, and `assignmentId`.
- Delivery respects additive notification categories: `schedule`, `trade`, and `gearPrep`. Old preference JSON defaults these categories to enabled.
- Implementation: `src/lib/services/schedule-notification-policy.ts` and `src/lib/services/notifications.ts`.

## Badge Award Triggers (Implemented 2026-05-09)

| Event | Type | Recipient | Channels |
|---|---|---|---|
| Manual badge awarded by admin | `badge_awarded` | Awarded user | In-app |

- Persistent inbox only. No toast fanout, email, APNs, or push in this slice.
- Link target comes from `payload.href` and points to `/users/{userId}?tab=badges`.
- Delivery respects `User.notificationPrefs.badges`; missing or old preference shapes default to enabled.
- Implementation: `POST /api/badges/award` and `awardBadgeManually` in `src/lib/badges/queries.ts`.

## Deduplication (Local Candidate)
- Key format: `"{bookingId}:{dueVersion}:{type}:{recipientKind}:{recipientId}"`
- Stored in `Notification.dedupeKey` (unique index)
- Extending a checkout supersedes the old workflow and gives the new due date an independent notification version
- A late workflow or repair sweep sends only the highest currently eligible stage instead of replaying every elapsed stage
- Result: job is idempotent and safe to run on any cadence

## Native Push (V1.2 — 2026-04-23)
- Transport: APNs via Node.js built-in `http2` + `crypto` (zero new deps)
- Auth: JWT token (ES256) from .p8 key — re-generated per request, valid 1h
- Schema: `DeviceToken` model (`prisma/migrations/0040_add_device_tokens`) — `token` unique, indexed on `(userId, revokedAt)`
- Registration: `POST /api/devices` upserts token on every app foreground after login; `DELETE /api/devices` bulk-revokes on logout. An intentionally empty DELETE body means revoke all, a token body revokes only that caller-owned registration, and malformed non-empty JSON returns 400 without revoking anything. Native registration/revocation decodes the `{ success: true }` response through the shared API handler so 401s trigger the global session-expired path.
- iOS: `AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken` → POST hex token. Permission requested once after login (`.notDetermined` guard; existing `.authorized` silently re-registers).
- Push fires for: checkout due/overdue escalation, staff-triggered overdue checkout nudges, `shift_gear_up`, shift schedule changes, trade lifecycle events, reservation lifecycle events, and license nag/expiry warnings when the recipient has push enabled for that category.
- Tap handling: `UNUserNotificationCenterDelegate.didReceive` sets `AppState.pendingPushBookingId` or `AppState.pendingPushEventId`. Booking pushes open through `HomeView`; event pushes switch to Schedule and let `ScheduleView` open the matching event sheet.
- Native Settings > Notifications is push-only for launch and exposes category toggles for checkout due reminders, checkout overdue alerts, reservation updates, license expiry reminders, schedule updates, trade updates, and gear prep nudges. Email and pause controls remain available in the server preference contract for rollout compatibility but are not exposed in the native app. In-app inbox rows remain always visible regardless of category settings.
- Environment fallback: sends go to the primary APNs host (production in prod, sandbox in dev); tokens rejected with `BadDeviceToken`/`Unregistered` are retried on the other APNs environment before any revocation, because Xcode development builds carry sandbox tokens even against the production server. Only tokens both environments reject are revoked in DB.
- Provider-token recovery: `ExpiredProviderToken`/`InvalidProviderToken` responses invalidate the cached JWT and retry the affected tokens once with a fresh token.
- Deferred sends: request-path pushes go through `deferPush()` (`after()` from `next/server`, with an awaited-detach fallback outside request scope) so the serverless function can't be frozen mid-APNs-round-trip after the response is written.
- Delivery self-test: `POST /api/devices/test` accepts the current installation's APNs token, verifies that it is an active token owned by the caller, sends a real test push only to that registration, and returns `{ delivered, devices, revoked }`. Normal push delivery can still reach every active registration signed in to the account.
- Required env vars: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_P8_KEY` (base64-encoded full PEM including headers). Missing = push silently skipped.
- Source: `src/lib/push/apns.ts` (dispatch/sendPush), `src/lib/services/notifications.ts` (sendPushToUser, deferPush), `src/app/api/devices/route.ts`, `src/app/api/devices/test/route.ts`

### macOS companion invalidation

- Wisconsin Creative registers its macOS APNs token against `/api/companion/devices` with a signed companion credential held in Keychain.
- Successful operational mutations publish a bounded booking and kiosk projection to Upstash after commit, then send a priority-5 background push on topic `APNS_MACOS_BUNDLE_ID` or `com.erikrole.GearOps`.
- The push contains no booking details. It only invalidates the local snapshot; the Mac then fetches `/api/companion/projection`, whose authentication and data source are entirely external to Neon.
- APNs delivery is best-effort and may be throttled by the operating system. Manual refresh uses the same Upstash-only route and cached data remains visible on failure.
- Local booking-change notifications use the booking title as the stackable notification title and show a localized `Status • Requester • Timestamp` body from the projection's server `updatedAt`, so delayed delivery retains the source event time instead of relying only on the Mac's delivery time.
- Wisconsin Creative requests both alert and sound authorization while keeping sound delivery opt-in. On sign-out or identity replacement it removes pending and delivered companion booking requests so requester names, titles, and timestamps do not remain in Notification Center.
- Account deactivation and role changes revoke that user's external companion sessions and device registrations. Companion credentials are 90-day leases renewed through the Upstash-only session route during normal restore, APNs, or manual refresh; a credential that is unused past its lease still requires sign-in again.
- Existing production KV/Upstash, session-secret, and APNs provider variables satisfy the server prerequisites. The macOS App ID capability and Developer ID signed/notarized build shipped in `macos-v1.0.0` with profile `4f4171d8-f959-4ed5-be70-7cc663253d52`; real APNs delivery and end-to-end notification acceptance remain rollout gates.

## Channels (V1 + Email)
- **In-app**: `Notification` records are durable for the requester and configured operational recipients
- **Email**: Via Resend (`RESEND_API_KEY` env var). Falls back to `console.log` in dev. Non-fatal on failure.
- **Admin escalation**: +24h notifies all active visible admins by in-app + email; push is reserved for configured or fallback location responders
- **Preferences**: requester, responder, and admin outbound delivery all use the checkout due/overdue category plus the recipient's channel and pause preferences
- **Email service**: `src/lib/email.ts` provides `sendEmail()`, the email-safe shared hex palette, HTML escaping, the common document shell, and notification content. Shift-trade and password-reset email producers reuse the same shell.

## Cron / Job Runner
- **Cron endpoint**: `GET /api/cron/notifications` — validates `CRON_SECRET` bearer token, no user session needed
- **Manual endpoint**: `POST /api/notifications/process` — admin/staff auth required
- **Schedule**: Daily at 9:00 AM UTC via Vercel Cron (`vercel.json`, schedule: `0 9 * * *`)
- **Normal timing**: a durable Workflow run is scheduled when checkout custody opens or its due time changes. Every stage rechecks `OPEN` state and the expected `endsAt` before delivery.
- **Repair behavior**: the daily cron scans up to 500 `OPEN` checkouts and sends only the highest eligible unsent stage. It does not replay every elapsed stage.
- Resilience: overdue, license nag, and license-expiry jobs run independently with `Promise.allSettled`. A single failure returns `ok: false` plus `partialFailures`/`errors` metadata while preserving successful job results and safe fallback counts for failed jobs.
- Job is fully idempotent — safe to call multiple times per hour due to dedup logic

## Notification Center (V1.1)
- Route: `/notifications`
- Content: all in-app notifications for current user, ordered by `createdAt` descending
- Mark-as-read: inline single-row action plus Mark all read
- Mutation reliability: mark-read, mark-all-read, and manual overdue processing use ref-backed duplicate-action guards, shared 401 redirects, safe response parsing, and specific server/network error toasts
- API reliability: malformed mark-read JSON returns 400, stale or wrong notification IDs return 404, and audit rows are only created after a real update
- Empty state: "All caught up" with `bell.slash` icon
- Deep links: row actions navigate to the related booking, reservation, schedule surface, or explicit `payload.href`
- Unread badge: `GET /api/notifications/count` returns `{ unreadCount }` — lightweight, no data fetch
- Foreground refresh: iOS app re-fetches unread count on every foreground return (scenePhase hook)

## Dashboard Integration
- Overdue banner count: driven by direct booking query (not notification records) for accuracy
- Badge counts on nav items for Reservations and Check-outs can show overdue + due-today urgency
- Overdue count in banner must remain consistent with `AREA_DASHBOARD.md` overdue banner spec

## Calendar Sync Health Triggers (Implemented 2026-06-02)

| Event | Type | Recipient | Trigger point |
|---|---|---|---|
| Calendar source has repeated hard daily sync failures | `calendar_sync_failure` | Active admins | `morning-refresh` after 3+ consecutive hard source sync failures |

- Channel: IN_APP only.
- Deduplication: `calendar_sync_failure:{sourceId}:{consecutiveFailures}:{adminId}` so each admin gets at most one row for a specific source/failure-count threshold.
- Payload includes `sourceId`, `sourceName`, `consecutiveFailures`, latest `error`, and `href: "/settings/calendar-sources"`.
- Clean hard sync results reset the source counter. Partial malformed-event skips without a hard `SyncResult.error` remain visible in source health but do not trigger repeated-failure notifications.
- Implementation: `src/lib/services/calendar-sync-health.ts` called from `GET /api/cron/morning-refresh`.

## Hidden Smoke/Test Users
- Admin and supervisor fan-out uses the shared visible-active user filter. Hidden smoke/test identities do not receive overdue admin escalation, item-report, low-stock, license-expiry, calendar-sync-health, or firmware-watch notifications even while they remain active for verification.

## Firmware Watch Triggers (Implemented 2026-06-10)

| Event | Type | Recipient | Trigger point |
|---|---|---|---|
| Watched product has a newer official firmware version | `firmware_update_released` | Active admins | `morning-refresh` daily firmware watch step |

- Channel: IN_APP plus best-effort native push when the admin has active device tokens and push enabled.
- Deduplication: `firmware_release:{targetId}:{version}:{adminId}` so each admin receives at most one notification per watched product version.
- First successful check for a target establishes a baseline silently. Historical releases do not notify on the day a target is first added.
- Payload includes `firmwareWatchTargetId`, `brand`, `model`, `productName`, `supportMode`, `supportNote`, `version`, `releaseDate`, `sourceUrl`, and an `/items?search=` link for the model.
- Source URLs are constrained by parser type. The active runtime currently seeds and polls verified Sony support hosts only.
- Implementation: `FirmwareWatchTarget` model, `src/lib/services/firmware-watch.ts`, and `GET /api/cron/morning-refresh`.

## Blasts (Implemented 2026-07-28)

Authored broadcasts to the people working events. Distinct from every other trigger in this
document: a blast is composed by a person, not fired by a rule, and it is the only
notification that demands an explicit acknowledgment back.

| Concern | Behavior |
|---|---|
| Who can send | ADMIN + STAFF, web only (`/blasts`). iOS is receive-only in V1. |
| Targeting | Event crew (active assignments on a **published** shift group), named people (max 200), or dynamic groups (ShiftArea / ShiftWorkerType / sportCode). No "everyone". |
| Delivery | Batched APNs dispatch plus a banner pinned at the top of the iOS dashboard. |
| Acknowledgment | The banner stays until the recipient taps "Got it". |
| Preferences | The in-app banner always renders. Only the push consults `shouldDeliverPush` (`channels.push` + `pausedUntil`). No dedicated `NotificationCategory` in V1. |

- Models: `Blast` + `BlastRecipient` (migration `0105_blast_notifications`). A parallel
  `Notification` row per recipient (`type: "blast"`, `payload.blastId`) keeps the web inbox,
  the unread badge, and the iOS notifications sheet working with no extra wiring.
- **`Notification` is the archive copy; `BlastRecipient` is the authoritative ack ledger.**
  Acking a blast marks the linked notification read; marking that inbox row read does *not*
  acknowledge the blast.
- Targeting resolution runs every branch through `visibleActiveUserWhere`, so inactive,
  roster-hidden, and COLLABORATOR accounts are excluded in exactly one place.
- The recipient set is **frozen at send time** -- a shifting denominator would make
  "21 of 34 acknowledged" meaningless. `GET /api/blasts/[id]` re-resolves the stored
  `targetSpec` and reports who joined the target afterward rather than back-filling them.
- Push outcome is recorded per recipient as `SENT`, `SKIPPED_PREFS` (paused or push off),
  `NO_DEVICE`, or `FAILED` (had tokens, all revoked). A stale token never reads as delivered.
- `deliveredAt` means "the client fetched this blast", not an APNs receipt -- APNs offers no
  such receipt.
- Deduplication: `@@unique([blastId, userId])` + `skipDuplicates`, the globally unique
  `Notification.dedupeKey` `blast:{blastId}:{userId}`, and idempotent read/ack routes.
- Cancelling clears the banner on the next fetch; already-delivered push alerts cannot be
  recalled, and the confirm dialog says so.
- Implementation: `src/lib/services/blasts.ts`, `src/lib/services/blast-targeting.ts`,
  `src/app/api/blasts/**`, `src/app/api/me/blasts/**`, `src/app/(app)/blasts/**`,
  `ios/Wisconsin/Views/Components/BlastBanner.swift`.

## D-009 Acceptance (2026-03-15)

D-009 (Overdue Escalation Policy) is status `Accepted`. Decisions:
1. **Recipient model**: +24h escalation goes to the requester AND all admins
2. **Alert fatigue**: Separate requester-stage and operational-row caps per due-date version. Defaults are 5 and 20. Settings at `/settings/escalation`.
3. **Email channel**: Shipped (2026-03-16 via Resend). Dev mode logs to console; failures are non-fatal
4. **Schedule**: DB-driven via `EscalationRule`, seeded with -2h/due/grace/+4h/+24h by migration `0111_checkout_overdue_notification_policy`

Current behavior:
- All enabled triggers notify the requester
- +4h and +24h notify the checkout location's configured responders, with creator/admin fallback
- +24h also notifies all admins, excluding duplicate requester or responder rows
- Admins can toggle rules, set separate caps, and assign location responders at `/settings/escalation`

## Bug Traps and Mitigations

### Trap: Same trigger fires multiple times
- Mitigation: dedupeKey prevents duplicate records; job is idempotent

### Trap: Booking completed but notification job fires again
- Mitigation: job scans only `status = OPEN` checkouts; completed records are excluded

### Trap: Email failure silently drops notification
- Mitigation: in-app notification is created first; email is best-effort and logged on failure

### Trap: Dev environment sends real emails during local testing
- Mitigation: SMTP credentials absent in dev → console.log fallback; never hard-fails

### Trap: Late delivery replays every elapsed stage
- Mitigation: workflow and repair processing collapse to the highest currently eligible stage

### Trap: Extension suppresses reminders for the new due date
- Mitigation: expected `endsAt` supersedes the old workflow, and dedupe keys include the due-date version

### Trap: Admin fanout overshoots the cap
- Mitigation: requester and operational counters are independent and checked before every recipient insert

## Edge Cases
- Checkout extended after an overdue trigger fired: historical rows remain, the old workflow stops, and the new due date receives its own stages
- Manual staff nudge during grace: rejected until the same grace threshold used by automatic overdue processing has passed
- User has no email on file — create in-app notification only; skip email silently
- Admin manually resolves overdue without system notification — no reconciliation needed
- Notification record exists for a booking that was later cancelled — show in notification center as historical; no re-trigger
- Notification center shows records for soft-deleted or cancelled bookings — handle gracefully in query (null-safe booking join)

## Acceptance Criteria (V1 — Implemented)
- [x] AC-1: All five escalation stages resolve from the booking due date and current grace policy.
- [x] AC-2: Deduplication prevents duplicate notifications per due-date version, stage, and recipient.
- [x] AC-3: In-app notification records appear in notification center for the requester.
- [x] AC-4: Dev mode shows console output instead of sending SMTP email.
- [x] AC-5: Job endpoint is safe to call repeatedly without creating duplicates.

## Acceptance Criteria (D-009 — Accepted 2026-03-15)
- [x] AC-6: Escalation recipient model is formally defined and documented (requester + all admins).
- [x] AC-7: 24h trigger reaches admin recipients in addition to student requester.
- [x] AC-8: Alert fatigue controls use separate requester and operational caps enforced inside fanout.
- [x] AC-10: Late processing sends only the highest eligible stage.
- [x] AC-11: Due-time changes supersede stale durable workflows.
- [x] AC-12: Location responders are configurable with creator/admin fallback.
- [x] AC-9: Email failure path logged without crashing the job runner.

## Dependencies
- `AREA_CHECKOUTS.md` — booking lifecycle, `endsAt` field, `OPEN` state contract
- `AREA_USERS.md` — recipient role resolution for future multi-recipient escalation
- `AREA_DASHBOARD.md` — overdue banner count consistency
- `DECISIONS.md` (D-007) — audit logging of notification creation events

## Current Out of Scope
1. SMS notifications.
2. Multi-channel campaign orchestration or template management.
3. Slack or other shared-channel notification delivery.
4. SMS or shared-channel escalation beyond the configured Gear Tracker recipients.
5. Generic notification authoring tools outside the existing event-specific producers.

## Developer Brief
1. Normal checkout escalation timing is Workflow-owned; the daily cron is repair-only. Do not add a second sub-daily sweep.
2. Dashboard overdue count must query bookings directly for real-time accuracy; do not use notification records as count source.
3. App-shell bell counts must use `GET /api/notifications/count`, not the paginated inbox route.
4. In-app rows remain persistent even when email/push/category preferences suppress outbound delivery.
5. When adding notification types, keep web row styling, iOS payload decoding, and tap-through behavior aligned.
6. Every stage must recheck `OPEN` and expected `endsAt`; every outbound channel must use checkout category preferences.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `CRON_SECRET` | Yes (prod) | Bearer token for Vercel Cron → `/api/cron/notifications` |
| `RESEND_API_KEY` | No (optional) | Enables email delivery via Resend. Falls back to console.log |
| `EMAIL_FROM` | No | From address for transactional email. Default: `Wisconsin Creative <noreply@wisconsincreative.com>` |

## Change Log
- 2026-08-27: **Student claim reviewer alerts are Admin-only.** Initial fanout plus escalation, blocked, and auto-approved outcome notifications for both open Student-slot requests and Trade Board claims target active visible Admins. Staff have no claim-review alerts, approval permission, or queue access; students continue receiving their own request and trade lifecycle messages.
- 2026-08-26: **Open Student-slot claims now notify active reviewers.** The canonical approval-first pickup path persists the student's `REQUESTED` assignment, then creates deduplicated durable `shift_request_review` rows for active visible Admin/Staff users and sends best-effort push through the existing schedule preference gate. The student-facing claim helper is documented under the Schedule/Event surfaces; direct-assignment email remains out of scope. Focused source contracts pass; deployment and authenticated delivery acceptance remain separate gates.
- 2026-08-21: **macOS companion restart recovery.** A login-item launch that occurs before the data-protection Keychain is available no longer converts a missing read into an immediate logout. Wisconsin Creative keeps the last trusted local identity/projection, retries on macOS session activation and menu presentation, and only clears the cached account after a confirmed post-activation miss.
- 2026-08-20: **macOS companion session persistence.** Active credentials now renew through an authenticated Upstash-only route before projection refresh, with the replacement saved to device-only Keychain before the old session is revoked. Network, Keychain, or server interruptions keep the current credential and last trusted projection instead of forcing a logout; inactive credentials still expire after 90 days.
- 2026-08-20: **macOS companion notification cleanup.** Companion alerts now request the sound capability needed by the opt-in sound setting, while delivery remains silent by default. Sign-out and identity replacement remove pending and delivered local booking requests; APNs invalidation remains detail-free and the external projection remains the data source.

- 2026-08-15: macOS companion booking-change notifications now use the booking title as the stackable title and `Status • Requester • Timestamp` as the body, preserving source event-time context when APNs or Notification Center delivery is delayed.
- 2026-08-10: Implemented the durable five-stage overdue policy locally. Checkout open/due-time mutations schedule a due-versioned Workflow; late runs collapse to one current stage; grace only defines the first overdue boundary; +4h routes to location responders with safe fallback; +24h adds all admins without push; separate caps are enforced inside fanout; manual nudges honor grace; and migration `0111` plus production/authenticated proof remain rollout gates.
- 2026-08-10: Shift-trade claimed, completed, approved, and declined flows now share one post-commit push/email dispatcher. Durable in-app notifications and their event-routable payloads remain inside the serializable trade transaction; best-effort push and email continue only after commit, respect existing preferences, and do not change assignment or trade state when delivery fails.
- 2026-07-28: Native auth-lifecycle hardening prevents delayed APNs callbacks, permission results, foreground presentation, and notification taps from publishing previous-user state after sign-out or direct identity replacement. Sign-out unregisters the app and clears local token, badge, delivered, pending, search, and image-cache state. Server-side deactivation atomically revokes device and Live Activity start credentials, deletes password-reset tokens, records cleanup evidence in the same serializable transaction, and leaves active Live Activity tokens as a durable end-delivery queue. The bounded Live Activity cron retries inactive or closed-booking ends; only APNs-accepted or permanently revoked tokens are marked ended. Device, push-to-start, and per-booking Live Activity registrations now require even-length hexadecimal APNs tokens, actor rate limits, a transactional active-user recheck, and fixed active-row caps. Blast delivery excludes inactive users, sends at most two current registrations per recipient through bounded HTTP/2 stream batches, and records `SENT` only for tokens APNs accepted. Reservation lifecycle rows are persisted before create or cancel responses return, while APNs fanout remains deferred. Device-token DELETE preserves empty-body revoke-all and rejects malformed JSON with no writes.
- 2026-07-21: Staff/admin overdue-checkout nudges now pair the durable in-app `overdue_nudge` row with a best-effort iOS push to the requester. Delivery uses the existing `checkoutOverdue` preference, deferred APNs request-path transport, and `bookingId` tap-through; inbox persistence and the existing audit entry remain authoritative when push is disabled, unavailable, or rejected.
- 2026-07-17: Native Notifications now exposes an authenticated Send Test Notification action when iOS permits push. Physical-device proof found that the original endpoint treated active APNs registrations as distinct named devices and sent the test to all of them. The app now persists its current APNs token, the endpoint verifies ownership and targets only that registration, and the UI distinguishes account-wide normal delivery from a this-device-only self-test. It reports missing registration and delivery failure inline, announces the result to VoiceOver, and preserves OS permission and server registration as separate health signals.
- 2026-07-17: Native notification settings is push-only for launch. The unwired email channel and pause controls were removed from the iOS surface, while the server preference shape remains compatible with existing web and historical clients. Delivery summaries, Profile metrics, and category guidance now describe push plus the durable in-app inbox only.
- 2026-07-17: Native notification preference rows now use compact single-line switch labels, explicit green on-state tint in dark mode, section-level delivery context, and VoiceOver hints for each channel and category. The push pre-permission sheet explicitly tints its prominent action Wisconsin red, preventing the inherited Settings tint from producing an unreadable white-on-white button in dark mode; its value statement remains multiline and the content scrolls at maximum Dynamic Type. OS permission and server token-registration health remain separate truths, and the durable in-app inbox and delivery preference semantics are unchanged.
- 2026-07-16: Transactional email HTML now shares one email-client-safe hex palette, escaping helper, document header, divider, and footer across notification, shift-trade, and password-reset producers. The 11px footer gray was strengthened from `#9CA3AF` to `#6B7280` for WCAG AA contrast on white. Delivery, recipients, preference gating, reset behavior, and notification semantics are unchanged.
- 2026-07-10: **Notifications end-to-end ownership pass.** The web inbox now leads with All/Unread filtering, a direct preferences handoff, simplified operational status, responsive row actions, named filtered-empty recovery, and visible refresh progress. Every documented `payload.href` can render an owning action, shipped notification families receive useful category labels, and legacy rows fall back from nullable `sentAt` to `createdAt`. Read mutations now remove rows from the unread view, invalidate every inbox cache, clamp stale pages, and synchronize the app-shell unread badge with rollback on failure. The list API returns separate filtered and whole-inbox totals with deterministic ordering; manual booking nudges now persist `sentAt`. Persistent inbox, producer, delivery preference, and role contracts are unchanged.
- 2026-07-10: **Notification inbox operational status rail.** Unread work now leads through the shared compact rail and can activate the existing unread-only filter, while unread, read, and total counts remain pressed-state-aware under Details. Notification delivery and read mutation contracts are unchanged.
- 2026-07-10: Native notification settings keeps Resume independently actionable under VoiceOver, notification mutation and pagination failures announce live, and the push pre-prompt uses scalable controls, hides decorative symbols, and removes bounce when Reduce Motion is enabled.
- 2026-07-10: **APNs sandbox/production environment fallback + delivery guarantees shipped.** Root cause of silent iOS push loss found and fixed: Xcode development builds hold *sandbox* APNs tokens, the production server only sent to the production APNs host, and the resulting `BadDeviceToken` permanently revoked the token -- every dev-build reinstall repeated register → first push → revoked → silence (confirmed in prod DB: revocation timestamps matched send timestamps exactly). Fixes: (1) tokens the primary APNs environment rejects as bad are retried on the other environment; revocation now requires rejection from both. (2) All four send paths (alert + Live Activity start/update/end) share one `dispatch` core with per-outcome logging. (3) `ExpiredProviderToken`/`InvalidProviderToken` re-mints the cached provider JWT and retries once. (4) Fire-and-forget `void sendPushToUser(...)` call sites were racing Vercel's post-response freeze and could silently drop sends; they now route through `deferPush()` (`after()` with detach fallback). (5) `licenses.ts`'s duplicate `sendPushToUser` was consolidated into the shared never-throw one. (6) New `POST /api/devices/test` sends a real push to the caller's devices for one-tap verification.
- 2026-07-09: **iOS push recovery UI refinement.** The native registration error state now uses a Dynamic Type-safe stacked explanation and full-width bordered Retry action with shared haptic feedback and an accessibility hint.
- 2026-07-09: **iOS push registration health shipped.** Native APNs registration now records server token-registration success or failure separately from OS permission, shows a retryable failure in Settings > Notifications, and retries authorized, provisional, and ephemeral registrations on sign-in and foreground return. In-app notification rows remain the durable source of truth. Production APNs env vars and real-device delivery remain external verification gates.
- 2026-07-07: **Notification delivery hardening shipped.** (1) Low-stock re-alerts were permanently silenced: `dedupeKey` is globally unique, and `notifyLowStock`'s constant per-admin key plus `skipDuplicates` skipped every insert after the first-ever alert, so the documented 24h re-alert never fired again. Keys are now day-stamped with a 24h prefix-window pre-check (legacy un-stamped keys still count as recent). (2) APNs http2 sessions now attach an error handler -- an unhandled session "error" event (transient DNS/connection failure to Apple) previously killed the serverless function mid-request -- and every push request carries a 10s timeout so a stalled stream can't hold the function open. (3) The APNs provider JWT is cached for 50 minutes at module scope instead of minted per send, avoiding Apple's `TooManyProviderTokenUpdates` rejection during notification fan-outs. (4) `sendPushToUser` is now internally never-throw, matching its six fire-and-forget `void` call sites where a rejection would be fatal. (5) Device-token registration caps token/appVersion lengths. Audited and unchanged: pref gating on both channels, HTML-escaped email templates, never-throw email transport, bounded escalation batching, revoked-token cleanup. Plan: `tasks/archive/notifications-hardening-plan.md`.
- 2026-07-01: Wisconsin Creative domain cutover prep updated production email/link guidance. Production should set `APP_URL=https://wisconsincreative.com` before onboarding, and transactional email should use a verified `Wisconsin Creative <noreply@wisconsincreative.com>` sender when Resend delivery is enabled.
- 2026-07-03: Notification support hardening aligned the app-shell bell with the lightweight no-store unread-count endpoint, kept checkout due/overdue inbox styling compatible with current reseeded escalation type names, reconciled the documented escalation schedule plus cron timing with the live `EscalationRule` seed shape and `vercel.json`, restored license notification timestamps/category-gated push delivery, and kept manual badge awards inbox-only per the documented contract.
- 2026-06-18: Schedule Source Of Truth Slice 6 shipped. Scheduling notifications now use one policy for schedule, trade, and gear-prep categories with defensive defaults for old preference JSON; draft assignment changes are suppressed for workers until publish, changed published call times clear acknowledgement, trade lifecycle rows and push/email delivery respect the `trade` category, and schedule/trade/gear-prep payloads carry event-routable context for web and iOS tap-through.
- 2026-06-10: Daily firmware watch notifications shipped. `morning-refresh` now polls enabled official-source firmware watch targets, baselines the first successful result silently, records latest version/release date/check errors, and creates deduped `firmware_update_released` admin inbox rows plus best-effort push when a newer version appears.
- 2026-06-10: iOS notification settings detail menu shipped. Native Settings now keeps notification delivery status at the root and moves OS push permission recovery, pause controls, email/push channel toggles, and category toggles into a dedicated Notifications drill-down while preserving the in-app inbox always-on contract.
- 2026-06-10: iOS notification category parity shipped. Native Profile now exposes the existing web-backed toggles for checkout due reminders, checkout overdue alerts, reservation updates, and license expiry reminders while preserving the in-app inbox always-on contract.
- 2026-06-10: iOS push token delivery honesty shipped. Native APNs token registration and logout revocation now decode `/api/devices` success responses through the shared API handler instead of raw `URLSession.data`, so rejected responses and 401s are handled like the rest of the app.
- 2026-06-10: iOS shift push tap-through shipped. Shift gear-up and shift schedule APNs payloads now include `eventId`, `assignmentId`, and `shiftId`; tapped event pushes switch the native app to Schedule and let the existing event opener present the relevant event sheet. Native push documentation was also reconciled with current checkout escalation, reservation, shift, and license push behavior.
- 2026-06-05: iOS Notifications read-recovery honesty shipped. Native mark-read and mark-all-read now inspect PATCH response status through the shared API handler, restore unread state on failure, and show a recoverable Refresh banner with error haptic instead of silently treating rejected updates as success.
- 2026-06-03: iOS Profile notification controls now use self-describing labels for field use. Quiet-hours controls read Pause alerts with visible Pause 1 hour, Pause 1 day, and Pause 1 week actions, and channel toggles read Email alerts and Push alerts while preserving the in-app inbox always-on contract.
- 2026-06-02: Calendar sync health alerts shipped. Morning refresh now creates persistent in-app `calendar_sync_failure` rows for active admins after 3+ consecutive hard daily failures for a source, deduped by source, failure count, and admin recipient.
- 2026-05-25: Web bug sweep Batch 24 hardened URL-backed notification inbox state. Unread-only and page params now rehydrate from browser back/forward and external URL changes through the shared `useUrlState` hook.
- 2026-05-24: Web bug sweep hardened `/notifications` mark-read, mark-all-read, and manual overdue processing against duplicate clicks, expired sessions, malformed/non-JSON responses, stale notification IDs, and misleading success copy. `PATCH /api/notifications` now returns explicit 400/404 errors and only audits successful single-notification updates.
- 2026-05-21: Shift schedule notifications now cover new assignments, approved requests, removed assignments, shift call-time changes, and personal call-time changes. Copy spells out Staff or Student and includes the effective call time.
- 2026-05-21: Design-language cleanup moved notification summary metrics to the shared `OperationalMetricCard` primitive and raised notification-center header, retry, destination, and mark-read actions to the 40px operational target baseline.
- 2026-05-12: iOS notification routing now recognizes `badge_awarded` inbox rows and opens the awarded user's native profile from the notification payload's `userId`. Badge award delivery remains persistent in-app only, with no push, email, or toast fanout.
- 2026-05-12: Security audit patch. `GET /api/cron/notifications` now uses partial-failure handling across overdue, license nag, and license-expiry jobs so one rejected job no longer drops successful notification work.
- 2026-05-09: Web notification-center UI polish. `/notifications` now reads as an action inbox with unread/read/total summary metrics, a clearer filter toolbar, role-gated overdue processing, explicit refresh, notification type badges, stronger unread/read row treatment, and destination actions that name the target surface without changing notification delivery or API contracts.
- 2026-05-09: Badge award notifications shipped for manual badge awards. Admin awards create persistent inbox rows linked to the awarded user's badges tab, and delivery respects `notificationPrefs.badges` while keeping push and toast fanout deferred.
- 2026-05-08: API hardening Wave 13. Notification count polling is now actor-rate-limited and uses short private caching.
- 2026-05-08: API hardening Wave 6. Cron routes now share `withCron()` for timing-safe `CRON_SECRET` bearer validation instead of each endpoint carrying its own auth comparison.
- 2026-05-08: API hardening Wave 5. Shift gear-up nudges now validate active future assignments and apply layered rate limits per actor, target assignment, and recipient before creating notification/audit rows. Focused tests cover student denial, inactive assignment rejection, and rate-limit enforcement.
- 2026-03-01: Initial stub created.
- 2026-03-09: Rewritten as V1 spec to formalize implemented escalation schedule, dedup behavior, channel model, and D-009 acceptance requirements.
- 2026-03-16: Vercel Cron wired (`vercel.json`, `GET /api/cron/notifications`). Resend email service (`src/lib/email.ts`) replaces console.log stub. Dual-channel delivery: in-app + email for all triggers. GAP-6 closed.
- 2026-03-25: Doc sync — standardized ACs to checkbox format (V1: 5 checked, D-009: 4 checked). Fixed cron schedule claim (was "every 15 minutes", actual is daily 8 AM UTC). Marked email channel as shipped.
- 2026-05-05: Shift trade lifecycle emails shipped for claimed, completed, approved, and declined trade events. Delivery is best-effort and respects email notification preferences.
