# iOS Apple Design Full Audit Plan - 2026-07-10

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

## Goal
- Produce a current, source-grounded audit of the full Wisconsin iOS app and kiosk target using Apple Design principles, then provide prioritized, independently executable remediation slices without changing implementation code.

## Route
- Owner area: Mobile (`docs/AREA_MOBILE.md`)
- Secondary areas: Dashboard, Reservations, Items, Search/Scan, Schedule, Users, Resources, Licenses, Notifications, Settings, Kiosk
- Ledger: `tasks/audit-ios-apple-design-full.md`
- Existing references: `tasks/audit-all-pages-ios.md` and screen-specific `tasks/audit-*-ios.md` records

## Source Checks
- [ ] Reconcile North Star, Mobile area ownership, relevant feature docs, Decisions, Gaps and Risks, schema contracts, and current app entry points.
- [ ] Inventory all user-facing SwiftUI views, destinations, sheets, covers, dialogs, and role-gated branches.
- [ ] Compare prior audit claims with current source and current verification output.
- [ ] Audit response, agency, familiarity, flexibility, simplicity, craft, wayfinding, feedback, Dynamic Type, reduced motion, dark mode, tap targets, SF Symbols, navigation, sheets, loading, empty, error, offline, and expired-session behavior.

## Stop Conditions
- Stop and report if current source contradicts an accepted custody, role, or API contract.
- Do not claim visual or gesture behavior as runtime-verified when only source evidence exists.
- Do not overwrite or fold in unrelated dirty work.
- Do not implement fixes during this audit.

## Slices
- [ ] Slice 1: App shell, authentication, Home, Search/Scan, and Settings/Profile audit.
- [ ] Slice 2: Reservations, item discovery/detail, Guides, Licenses, and Users audit.
- [ ] Slice 3: Schedule, availability, staffing sheets, and event-detail audit.
- [ ] Slice 4: Kiosk activation, idle, checkout, pickup, return, success, recovery, and sleep audit.
- [ ] Slice 5: Cross-cutting accessibility, motion, material, feedback, offline/session, and role-skew synthesis.
- [ ] Slice 6: Prioritized remediation plans with dependencies, acceptance criteria, stop conditions, and exact verification gates.

## Verification
- [ ] `npm run drift:ios`
- [ ] `npm run audit:ios:gaps`
- [ ] `npm run ios:project:check`
- [ ] Relevant source-contract tests identified by the audit
- [ ] Main Wisconsin simulator or generic iOS build
- [ ] WisconsinKiosk simulator or generic iOS build
- [ ] `git diff --check`
- [ ] `npm run verify:docs` for task-ledger and audit artifact changes

## Review
- Shipped: `tasks/audit-ios-apple-design-full.md` and `tasks/ios-apple-design-remediation-slices.md`.
- Verified: iOS drift, audit inventory, project generation, main simulator build, and kiosk simulator build passed.
- Deferred: Implementation, VoiceOver/Accessibility Inspector proof, Dynamic Type runtime matrix, and physical HID/camera testing.
- Blocked: Full MVP signoff is blocked by rapid-scan cart atomicity and unresolved kiosk edit actor attribution.
- Proof artifacts: Command evidence recorded in the audit report.
- Next slice or stop: Start Slice 1, Kiosk Rapid-Scan Atomicity; Slice 2 requires the audit-actor product decision before code.
