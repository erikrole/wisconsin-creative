# Announcements Area Scope (V1 Web Implemented, iOS Specified)

## Document Control
- Area: Announcements
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-18
- Status: Web built on a draft PR; iOS not started
- Version: V1.0

## Direction
Admins post a short splash ("new feature", "update", "heads up") from Settings and people see it once, with no deploy. It is for quick blasts, not a notification inbox (see Blasts for crew-targeted acknowledged messages).

## Core Rules
1. Admin only to write (`announcement.manage`); admins, staff, and students can read what is meant for them (collaborators never see it).
2. An announcement is live when it is published, not ended, matches the viewer's role and platform, and the viewer has not dismissed it. An empty role list means everyone.
3. One announcement shows at a time, newest first. Dismissing (Got it, Not now, close, or the button) records a dismissal; the next unseen one then loads.
4. Body is plain text: blank line = paragraph, `- ` = bullet. No HTML or markdown.
5. The button link is an app path (`/releases`) or `https`. Anything else is rejected.
6. "Show to everyone again" deletes the dismissals; "End now" sets `endsAt`.
7. No polling. The web client reads once per page load; iOS reads on launch and when the app returns to the foreground (same rule as the badge fetch in #458).
8. Role preview and a dismiss that fails offline both fail safe: the splash shows again later.

## API
- `GET /api/announcements/active?platform=web|ios` returns `{ data: ActiveAnnouncement | null }` (`src/lib/announcements.ts`).
- `POST /api/announcements/{id}/dismiss` is idempotent.
- Admin: `GET/POST /api/announcements`, `PATCH/DELETE /api/announcements/{id}` (`state: draft|live|ended`, `showAgain`). All writes are audited and rate limited.

## iOS spec (not built)
Decode `ActiveAnnouncement` (`id`, `kind`, `kindLabel`, `title`, `blocks` as `paragraph{text}` or `list{items}`, optional `ctaLabel`/`ctaUrl`, `publishedAt`), tolerating unknown block types by skipping them. Fetch with `platform=ios` on launch and on foreground, present as a medium/large sheet using the web card layout (kind icon, kind label, title, body, bullets, primary button, "Not now"), then POST dismiss. A `ctaUrl` starting with `/` maps to an in-app destination or the website; unknown paths open the website. Needs an Xcode build and the web-side source-contract test before merge.

## Changelog
- 2026-10-18: V1 web (migration 0184, Settings > Announcements, splash in the app layout).
