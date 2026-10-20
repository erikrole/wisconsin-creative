# iOS What's New Audit — 2026-10-20

## Scope
Native Browse destination in `ios/Wisconsin/Views/Announcements/WhatsNewView.swift`, backed by the new `GET /api/announcements/history?platform=ios` route.

## What Shipped
- Browse > Work shows What's new for staff and students. Collaborators never see announcements, so the row is not offered to them and the route refuses them.
- The list is every announcement this person could have been shown (published, their role, iOS), newest first, with an Unread marker while the server has no dismissal.
- Tapping a row reopens the same sheet the splash used, and its button follows the same parser-first route as the splash.
- Opening an announcement here does not record a dismissal; the splash stays the one place that marks it seen.
- Authoring, scheduling, and reach counts stay on the web settings page.

## Risks Checked
- History rows decode through the splash decoder, so an unknown block type is skipped, not fatal.
- The route carries no `remaining` and no dismissal filter, so ended announcements remain readable.
- Pull to refresh re-reads; there is no timer behind the list.

## Follow-Ups
- Xcode build, `WisconsinTests`, and a simulator pass with at least one seen and one unseen announcement.
- Decide whether opening an unread announcement from the list should also dismiss it.
