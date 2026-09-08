# iOS notification audit and polish

Scope: Wisconsin iOS inbox, read mutations, settings, permissions, APNs actions and routing. Preserve existing APNs transport and unrelated native edits. No live recipient tests or distribution in this request.

## Plan and contracts
- [x] Read North Star, native workflows, notification area, D-009/D-055 policy and current source.
- [x] Trace native models against notification/preferences/device responses and server producers.
- [x] Harden inbox read serialization, authoritative recovery, stale refresh visibility, paging identity, and full message readability.
- [x] Preserve local reminder context and session ownership; prevent reminder stacking.
- [x] Clarify supported permission benefits, account-wide controls, provisional delivery, and device test acceptance.
- [x] Run notification source contracts, native build, existing settings fixture capture and inspect local review.
- [x] Reconcile area documentation and acceptance evidence.

## Findings addressed locally
- P1: Concurrent inbox mutations and refresh can restore stale whole-list/count snapshots; failed refresh with cached rows is invisible.
- P1: Snooze add can finish after logout cleanup; repeated snooze nests identifiers despite a replacement promise.
- P2: Inbox pagination appends overlapping IDs when new rows arrive; long content is truncated with no detail reader.
- P2: Permission primer promises tomorrow-shift and claimable-post broadcasts absent from current delivery producers.
- P2: Account-wide push switch describes this device; provisional authorization is labeled Ready; self-test response means APNs acceptance, not observed delivery.
- P2: Blast archive payload omitted blastId; taps now return to the authoritative Home banner without acknowledging automatically.
- P2: Undo exceeded the server 500-ID request limit for large inboxes; native requests now batch and reconcile partial failure.
- Existing boundaries: durable inbox and best-effort push, preference/category gates, current APNs recovery edits, Admin-only claim review, publication suppression and physical-device acceptance remain intact.

## Verification
- 120 tests in 19 Vitest suites pass: notification API/support, native contracts, Schedule notification policy/copy/diff/flush/debounce, and existing APNs expiry handling.
- Eight native NotificationInboxTests pass on iPhone 16 Pro / iOS 26.5. Includes committed write/lost response, concurrent action exclusion, stale refresh, overlapping pagination, 1,001-row Undo, stable reminder identity, blast decoding, and real SwiftUI large-text rendering.
- Wisconsin compiled and the existing notification settings screenshot UI test passed in the main checkout. The ordinary Wisconsin unit-test target is blocked by existing ScheduleDateMathTests.swift initializer mismatches at lines 239, 242, 256, and 259. Focused notification tests ran in `/tmp/wc-notification-isolated-ios`, with the test target restricted to NotificationInboxTests.swift and final notification product files copied unchanged. No Schedule fixture was modified.
- TypeScript, focused ESLint, docs verification (after codemap generation), and git diff --check pass.
- [Local visual review](archive/proofs/ios-notifications-2026-09-07/review.html) includes inspected settings and large-text inbox recovery captures. These are after-only evidence: the existing settings fixture uses a relative pause clock and the inbox fixture was newly introduced. No exact matched comparison is claimed.
- No server runtime changes, migrations, live recipient messages, commit, push, deployment or distribution were performed. Existing APNs transport edits remain preserved and covered by their tests.

## Audited notification families and boundaries

| Family | Native contract checked |
| --- | --- |
| Checkout due/overdue and manual nudges | booking destination, category actions, existing urgency and preference rules |
| Reservations and gear prep | booking/event payload context, local reminder behavior |
| Published Schedule, open-slot review, trade lifecycle | event/trade routing, publication suppression and Admin reviewer contracts |
| Blasts | distinct archive-read and explicit acknowledgment behavior, blast payload destination |
| Badge, damaged/lost item, low stock | existing inbox profile/asset routing and full message readability |
| License, firmware, calendar health | informational alerts remain readable; desktop-owned administrative routes are not recreated here |
| Settings and authentication | pause/channel/category gates, provisional permission, registration, self-test semantics, session cleanup |

## Remaining acceptance
- [ ] Physical iPhone: actual APNs delivery, foreground/lock-screen tap, snooze execution, system permission return, and deliberate blast acknowledgment.
- [ ] Authenticated inbox and preferences recovery against real server state, plus VoiceOver interaction.
- [ ] Resolve unrelated Schedule test fixture compilation before the full native suite can pass.
- [ ] Explicitly requested release/distribution and production acceptance.
