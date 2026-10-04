# YouTube Metadata Area

## Document Control

- Area: YouTube metadata review and publishing for the Wisconsin Badgers channel
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-03
- Status: In development (PR #423). Core rules and the channel connection are built; the review queue, writes and daily drafts are not.
- Route: `/youtube` (ADMIN only)

## Direction

This replaces the Badger Metadata macOS app, which did the same job from one Mac. The tool reviews recent uploads to the Wisconsin Badgers channel (`UCwGvYcF_PDvOvvADzEbrT0A`): it matches each video to the official UWBadgers schedule, prepares a description from the official recap or a fixed press-conference template, checks the title against [YOUTUBE_FORMATS.md](YOUTUBE_FORMATS.md), suggests playlists, and sets visibility. No AI model writes prose. Highlights use verbatim recap sentences with only the opening dateline removed.

## Security Contract

1. Every page and `/api/youtube/*` route requires `ADMIN` through the `youtube` permission (`view`, `connect`, `publish`). Collaborators never see the sidebar entry.
2. The channel connection is one Google grant (scope `youtube`) per channel. Its refresh token is AES-256-GCM encrypted with the dedicated `YOUTUBE_TOKEN_KEY` and is never returned to a client, logged, or written to an audit snapshot. Access tokens are minted on demand and cached in memory only.
3. Connecting uses OAuth with PKCE and a state value bound to the signed-in admin in a short-lived, httpOnly cookie scoped to `/api/youtube/oauth`. The grant is accepted only when it manages the Badgers channel; otherwise it is revoked immediately.
4. When Google rejects the refresh token, the connection is marked for reconnect and nothing retries.
5. Previews read only `WC_PREVIEW_`-prefixed credentials, so a preview never uses production channel access.
6. Writes (later slices) keep the Mac app's contract: re-read the live video and refuse if it changed since review, record the intent durably before sending, send once without automatic retry, and verify by read-back. An unclear result blocks further writes to that video until it is reconciled read-only.

## Data Model

Migration `0164_youtube_connection` adds `YouTubeConnection`: unique channel id, channel title, encrypted refresh token, granted scopes, connecting admin, connected/last-used/revoked timestamps. It has no user foreign key, so the record of who connected survives account changes.

## API Surface

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/youtube/oauth/start` | `youtube:connect` | Redirect to Google consent with PKCE and state |
| GET | `/api/youtube/oauth/callback` | `youtube:connect` | Exchange the code, verify the channel, store the encrypted grant, audit, return to `/youtube` |
| GET | `/api/youtube/connection` | `youtube:view` | Connection status without secrets |
| DELETE | `/api/youtube/connection` | `youtube:connect` | Revoke at Google (best effort), delete the stored grant, audit |

## Configuration

`YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` (Web client in Google Cloud project `yt-channel-audit-510311`, redirect `<APP_URL>/api/youtube/oauth/callback`) and `YOUTUBE_TOKEN_KEY` (32 random bytes, base64). Production values are set. The Google app is published, so grants do not expire after 7 days; it is unverified, so the consent screen shows a one-time warning.

## Code

- `src/lib/youtube/rules.ts`, `recap.ts`, `write-guard.ts`, `publishing.ts`: rules and write coordinators ported from the Mac app, with injected transports and journals.
- `src/lib/youtube/google.ts`, `connection.ts`: OAuth, token storage, YouTube Data API calls.
- `src/lib/secret-box.ts`: shared AES-256-GCM field encryption, also used by the software vault.
- Tests: `tests/youtube-rules.test.ts`, `tests/youtube-publishing.test.ts`, `tests/youtube-connection.test.ts`. Recap fixtures in `tests/fixtures/youtube/`.

## Remaining Slices

1. Read-only review queue: recent uploads, schedule match, recap excerpt and template drafts, playlist suggestions. Drafts stored per video.
2. Admin writes through the coordinators with database journals (one open write per video enforced by a constraint) and audit entries.
3. Daily cron that drafts new uploads for approval.
4. A card on the Tools hub once it ships, shown only to signed-in admins.
5. Import of the Mac app's saved drafts and publish history.

## Change Log

- 2026-10-03: Core rules port (66 tests, sentence IDs identical to the Mac app) and the channel connection: OAuth with PKCE, encrypted grant storage, connect/disconnect UI at `/youtube`, ADMIN-only `youtube` permission, migration `0164_youtube_connection`.
