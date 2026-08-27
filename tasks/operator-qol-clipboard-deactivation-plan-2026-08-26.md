# Operator QoL: Clipboard Feedback and User Deactivation - 2026-08-26

## Goal

Make two high-frequency operator actions trustworthy now that real users are using Gear Tracker daily:

1. Copy actions must report success only after the browser accepts the text.
2. Deactivating a person must require an explicit, consequence-aware confirmation before the existing cleanup mutation runs.

## Scope

- Clipboard feedback on the clean Kiosk Devices activation-code dialog, Markdown reader reference controls, user calendar-feed URL, and item link/QR/identity controls.
- Admin user-detail deactivation confirmation only. Activation remains one click.
- No schema, API, permission, custody, booking, kiosk activation, offboarding, or notification-policy changes.
- Preserve unrelated active work in the working tree.

## Source Checks

- `docs/NORTH_STAR.md`: prioritize speed, clarity, trust, and repair-oriented operator surfaces.
- `docs/DESIGN_LANGUAGE.md`: destructive actions require confirmations; copy success should be short and failure should provide recovery.
- `docs/AREA_USERS.md`: `OPEN` custody blocks deactivation; future booking work is cancelled and cleanup is audited.
- `docs/AREA_ITEMS.md`: item identity values are copyable and QR/identity controls remain web-owned.
- `docs/AREA_RESOURCES.md`: Markdown reader reference blocks expose copy controls.
- `docs/AREA_SETTINGS.md`: Kiosk Devices is an admin-owned settings surface with one-shot activation codes.

## Stop Conditions

- Stop if the follow-up requires schema, API, permission, custody, booking, kiosk-activation, offboarding, or notification-policy changes.
- Stop if a target file contains overlapping parallel work that cannot be preserved with a narrow edit.
- Stop browser proof rather than mutating real user, booking, item, or kiosk data when an isolated local path is unavailable.

## Slices

- [x] Clipboard helper and focused behavior tests.
- [x] Migrate the selected clean clipboard consumers with outcome-specific recovery copy.
- [x] Add deactivation confirmation at `/users/[id]` using the existing `useConfirm` provider.
- [x] Update area docs with the verified local source state and capture the review artifact.
- [x] Second-pass hardening: keep transient copied feedback owned by the latest copy attempt, reset its full display window on repeat success, and clean up timers on unmount.

## Verification

- [x] Focused Vitest coverage for clipboard success, rejection, unavailable API, latest-attempt wiring, Markdown, user, and item-link contracts: 5 files, 24 tests passed.
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run lint`.
- [x] `npm run build:app`.
- [ ] `npm run verify:docs` — generated architecture/frontend codemaps drift against the heavily modified shared working tree; they were not regenerated over parallel work.
- [x] `git diff --check`.
- [x] Authenticated local Preview browser proof for the changed interactions: Markdown clipboard rejection, confirmation rendering, cancel-without-PATCH, a stubbed confirm path, and the rapid repeat-copy timing window.
- [x] Matched UI review artifact updated with the timed repeat-copy proof; the original deactivation before capture remains from the clean HEAD worktree.

## Review

- Shipped: local source slice only; deployment and production acceptance are not claimed.
- Verified: selected clipboard consumers, latest-attempt/timer cleanup, deactivation confirmation ordering, 24 focused tests, TypeScript, full lint, app build, diff check, authenticated local browser interactions, and the updated visual review pass locally.
- Deferred: kiosk activation expiry, user offboarding assistant, admin exception feed, renewal calendar, and morning digest remain out of scope.
- Blocked: docs verification is blocked by generated codemap drift in already-modified shared files; deployment and production acceptance remain open.
- Proof artifacts: [operator QoL UI review](operator-qol-clipboard-deactivation-review-2026-08-26/out.html), with source/behavior test output recorded above.
- Next slice or stop: stop this slice. The audited clipboard/deactivation paths have local runtime proof; reassess only from new day-to-day operator friction.
