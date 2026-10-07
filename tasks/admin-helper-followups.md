# Admin Helper Follow-ups - 2026-06-19

## Goal
- Keep remaining admin-helper work in one focused backlog after shipped helper surfaces were reconciled out of `tasks/todo.md`.
- Treat each item as a future slice requiring area-doc review before implementation.

## Source Checks
- `docs/AREA_DASHBOARD.md`: Admin Fix Today and Inventory Hygiene live on `/operations` (legacy `/admin/fix-today` and `/items/hygiene` redirect there). APIs `GET /api/admin/fix-today` and `GET /api/inventory-hygiene` are unchanged.
- `docs/AREA_KIOSK.md`: Settings -> Kiosk Devices already shows live status, pending pickup count, active checkout count, session state, and clear-pickup repair affordances.
- `docs/AREA_ITEMS.md`: Inventory Hygiene is the staff-visible "Keep data clean" lane on `/operations`.
- `docs/GAPS_AND_RISKS.md`: GAP-33 is closed; morning-refresh auto-expires stale pending-pickup checkouts after 48 hours with inventory, scan-session, and audit cleanup.
- `docs/AREA_SETTINGS.md`: checkout policies and reservation rules now store specific operator-facing `SystemConfig` keys, including configurable no-show expiry.

## Shipped Helpers
- [x] **Operations day queue** - `/operations` covers overdue gear, pending pickup handoffs, offline kiosks, flagged maintenance items, low batteries, calendar sync failures, and expiring licenses (ADMIN "Run the day" lane).
- [x] **Battery unit cockpit** - `/bulk-inventory/batteries` covers available/out/missing/retired counts, aging checked-out units, quick actions, and low compatible batteries by camera family.
- [x] **Inventory hygiene center** - `/operations` "Keep data clean" lane covers missing category, missing department, missing primary scan code, missing image, duplicate scan identity, retired items in active kits, camera bodies without attachments, and low-threshold bulk SKUs.
- [x] **Pending-pickup auto-expiry** - morning-refresh auto-cancels stale pending-pickup checkouts after the configured no-show expiry window.

## Future Slices
- [ ] **Kiosk admin cockpit follow-through** - Add failed scan counts, stale activation repair, and wrong-person attribution repair on top of the shipped Settings kiosk device cards.
- [ ] **People offboarding assistant** - On user deactivation, show and resolve open checkouts, upcoming reservations, shift assignments, Photo Mechanic license slots, active sessions, and allowed-email claims tied to that person.
- [ ] **Admin exception review** - One feed for admin overrides, kiosk-source activity, location exceptions, failed scans, manual releases, retired/missing changes, and destructive actions.
- [ ] **Renewal and expiry calendar** - One admin calendar for Photo Mechanic renewals, warranty dates, calendar feed health, expiring credentials, and deadline-based admin attention.
- [ ] **Admin-only morning digest** - Daily email, push, or in-app summary for overdue count, due today, pickups waiting, kiosk offline, low batteries, expiring licenses, and calendar sync errors.

## Low-Priority Systemic Follow-ups
- [ ] **Generic SystemConfig admin surface** - Specific config pages now exist where operator meaning is clear; defer a generic key/value UI until more keys need direct admin ownership.
- [ ] **Mobile staff parity review** - iOS still intentionally lacks full web booking list filters/sorting and some admin item lifecycle actions. Conflict badges already shipped, so keep this narrowed to GAP-34 and GAP-36.
