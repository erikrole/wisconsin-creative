# Audit: shared logins (iOS) — 2026-10-17

**MVP verdict:** ships as a read-and-copy list
**Ship bar:** a person who can open Shared logins on the website can copy the same login on iPhone, without a password sitting on screen or leaving the phone
**Audit type:** static source (no Xcode build in this environment)

## Scope check

`SharedLoginsView` opens from Browse. Students, staff, and admins see the row. A collaborator sees it only with `SOFTWARE_VAULT_VIEW`, which is the same capability `GET /api/software` requires.

- `GET /api/software` loads the list. Archived rows are dropped even if a response includes them.
- `POST /api/software/:id/secret` runs only for Show or Copy.
- Create, edit, archive, and restore stay on the website.

## P0 — blocks MVP

_None in source._ The list model has no password field. Reveal errors use the server message and do not include a secret. A failed refresh keeps the previous list.

## P1 — polish before ship

- [x] [Privacy] A shown password clears after 30 seconds, on leaving the screen, and when the app leaves the foreground. Copy uses a pasteboard entry that expires in 2 minutes and does not sync to another device.
- [x] [Flows] A second tap while a reveal is in flight does not send another request. Hiding, or leaving, discards a response that arrives late.
- [x] [Links] Only `http` and `https` website values become an Open website button.

## P2 — follow-ups

- [ ] Signed-in iPhone proof: a student sees only logins shared with students, Show hides again, Copy pastes on this phone, and a collaborator without shared-software access has no row.
- [ ] Xcode build for `Wisconsin` on iPhone 18 Pro Max. This environment has no Xcode.

## Out of scope

Photo Mechanic licenses, including the open redesign of `LicensesView.swift`. Vault administration. Password history and key rotation.
