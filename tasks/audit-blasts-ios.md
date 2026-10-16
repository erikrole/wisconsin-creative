# iOS Blasts Audit — 2026-10-16

## Scope
Native Browse destination in `ios/Wisconsin/Views/BlastsView.swift`.

## What Shipped
- Browse shows Blasts for every signed-in role, including collaborators.
- The list and detail use `GET /api/me/blasts`, `ActiveBlast`, and the existing read and acknowledge calls.
- A blast this phone has fetched stays after Got it, so dismissing the home banner does not erase the message.
- Detail has one main action, Got it, and only while the blast still needs acknowledgment. Severity color is the status pill.
- Compose, cancel, and recipient tracking stay on the web.

## Risks Checked
- The archive is cleared when the signed-in person changes.
- A failed acknowledge leaves the blast open and shows the error on the detail screen.
- A blast this phone never fetched is not invented from the push payload.

## Follow-Ups
- Xcode build, `WisconsinTests` / `WisconsinKioskTests`, and an authenticated pass on iPhone 18 Pro Max remain for a Mac.
- Confirm a blast acknowledged on the home banner is still readable from Browse, and that sign-out hides it from the next person.
