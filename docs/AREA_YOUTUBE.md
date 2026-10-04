# YouTube Metadata Area

## Document Control

- Area: YouTube metadata review and publishing for the Wisconsin Badgers channel
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-03
- Status: In development (PR #423). Core rules, the channel connection and the read-only review queue are built; writes to YouTube and daily drafts are not.
- Route: `/youtube` (ADMIN only)

## Direction

This replaces the Badger Metadata macOS app, which did the same job from one Mac. The tool reviews recent uploads to the Wisconsin Badgers channel (`UCwGvYcF_PDvOvvADzEbrT0A`): it matches each video to the official UWBadgers schedule, prepares a description from the official recap or a fixed press-conference template, checks the title against [YOUTUBE_FORMATS.md](YOUTUBE_FORMATS.md), suggests playlists, and sets visibility. No AI model writes prose. Highlights use verbatim recap sentences with only the opening dateline removed.

## Security Contract

1. Every page and `/api/youtube/*` route requires `ADMIN` through the `youtube` permission (`view`, `connect`, `draft`, `publish`). `draft` covers the stored review queue (refresh and draft edits); `publish` covers every write to the channel. Collaborators never see the sidebar entry.
2. The channel connection is one Google grant (scope `youtube`) per channel. Its refresh token is AES-256-GCM encrypted with the dedicated `YOUTUBE_TOKEN_KEY` and is never returned to a client, logged, or written to an audit snapshot. Access tokens are minted on demand and cached in memory only.
3. Connecting uses OAuth with PKCE and a state value bound to the signed-in admin in a short-lived, httpOnly cookie scoped to `/api/youtube/oauth`. The grant is accepted only when it manages the Badgers channel; otherwise it is revoked immediately.
4. When Google rejects the refresh token, the connection is marked for reconnect and nothing retries.
5. Previews read only `WC_PREVIEW_`-prefixed credentials, so a preview never uses production channel access. A local preview dev server can instead replay recorded read-only API responses from `WC_PREVIEW_YOUTUBE_REPLAY_DIR`; the replay is ignored when `NODE_ENV` is production or the environment is not a preview, and it pins the library clock to the recording time.
6. Writes (later slices) keep the Mac app's contract: re-read the live video and refuse if it changed since review, record the intent durably before sending, send once without automatic retry, and verify by read-back. An unclear result blocks further writes to that video until it is reconciled read-only.
7. The review queue never writes to YouTube. Refresh only reads the channel (uploads, `videos.list`, playlists, memberships of suggested playlists) and the public UWBadgers calendar and recap pages (HTTPS uwbadgers.com only, same-host redirects, size-limited).

## Data Model

Migration `0164_youtube_connection` adds `YouTubeConnection`: unique channel id, channel title, encrypted refresh token, granted scopes, connecting admin, connected/last-used/revoked timestamps. It has no user foreign key, so the record of who connected survives account changes.

Migration `0165_youtube_review_queue` adds:

- `YouTubeLibraryVideo`: the last imported snapshot (with etag), publish time and thumbnail for each upload in the 30-day window. Replaced on every refresh.
- `YouTubeReviewDraft`: one per video, shaped like the Mac app's `SavedSelection` (matched title and game, recap document, selected sentence IDs, manual title and description, conference kind and speakers, staged playlists) plus the preparation result (match kind, official game choices, hold reason). A `version` column guards concurrent edits; refresh bumps it and never overwrites manual edits.
- `YouTubeLibraryState`: per channel, last check time and failure, the channel's playlists, and the memberships of playlists suggested to at least one queued video.

## API Surface

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/youtube/oauth/start` | `youtube:connect` | Redirect to Google consent with PKCE and state |
| GET | `/api/youtube/oauth/callback` | `youtube:connect` | Exchange the code, verify the channel, store the encrypted grant, audit, return to `/youtube` |
| GET | `/api/youtube/connection` | `youtube:view` | Connection status without secrets |
| DELETE | `/api/youtube/connection` | `youtube:connect` | Revoke at Google (best effort), delete the stored grant, audit |
| POST | `/api/youtube/library/refresh` | `youtube:draft` | Read recent uploads, playlists and official sources; store the library and prepared drafts; audit `REFRESH` with counts. 60 s budget, preparation stops at 40 s and resumes on the next refresh |
| PATCH | `/api/youtube/drafts/[videoId]` | `youtube:draft` | Save manual choices with the draft version; sentences, speakers and playlists are checked against the video's own source and the channel; audit `UPDATE_DRAFT` (lengths and IDs, not text) |
| POST | `/api/youtube/drafts/[videoId]/game` | `youtube:draft` | Confirm one offered official game and load its recap; audit `CHOOSE_GAME` |
| POST | `/api/youtube/drafts/[videoId]/prepare` | `youtube:draft` | Match one video to its source again, keeping manual edits; audit `PREPARE_DRAFT` |

## Configuration

`YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` (Web client in Google Cloud project `yt-channel-audit-510311`, redirect `<APP_URL>/api/youtube/oauth/callback`) and `YOUTUBE_TOKEN_KEY` (32 random bytes, base64). Production values are set. The Google app is published, so grants do not expire after 7 days; it is unverified, so the consent screen shows a one-time warning.

## Code

- `src/lib/youtube/rules.ts`, `recap.ts`, `write-guard.ts`, `publishing.ts`: rules and write coordinators ported from the Mac app, with injected transports and journals.
- `src/lib/youtube/google.ts`, `connection.ts`: OAuth, token storage, YouTube Data API calls.
- `src/lib/youtube/review.ts`: queue rules (identity, matching, preparation, suggested titles, checks, status), shared by the server and the editor.
- `src/lib/youtube/queue.ts`, `reader.ts`, `payload.ts`, `uwbadgers.ts`, `replay.ts`: refresh and draft service, read-only channel access, payload decoding, the UWBadgers schedule and recap client, and the local replay.
- UI: `src/app/(app)/youtube/ReviewQueue.tsx` (list, filters, refresh) and `VideoReview.tsx` (checklist, game choice, title, recap sentences or coach template, playlists, save draft).
- `src/lib/secret-box.ts`: shared AES-256-GCM field encryption, also used by the software vault.
- Tests: `tests/youtube-rules.test.ts`, `tests/youtube-publishing.test.ts`, `tests/youtube-connection.test.ts`, `tests/youtube-review-queue.test.ts`, `tests/youtube-queue-service.test.ts`. Recap fixtures in `tests/fixtures/youtube/`.

## Remaining Slices

1. Admin writes through the coordinators with database journals (one open write per video enforced by a constraint) and audit entries.
2. Daily cron that drafts new uploads for approval (reuses `refreshLibrary`).
3. A card on the Tools hub once it ships, shown only to signed-in admins.
4. Import of the Mac app's saved drafts and publish history.

## Local Preview Replay

Previews have no channel credentials. To exercise the queue locally, record read-only responses with `python3 scripts/youtube-record-replay.py tmp/youtube-replay` (uses the read-only audit grant in `~/Code/Certificates`), then set `WC_PREVIEW_YOUTUBE_REPLAY_DIR=tmp/youtube-replay` in `.env.development.local` and run `npm run dev:preview`. Recordings include unlisted titles, so they stay in the gitignored `tmp/` folder. UWBadgers requests stay live.

## Known Limits

- Playlist membership is checked only for playlists suggested to a queued video (sport and year, or conference). A video sitting in some other playlist shows as "Not in a suggested playlist". Scanning every channel playlist on each refresh would spend quota shared with the audit tooling.
- The first live refresh can only run in production after merge; previews have no channel credentials.

## Change Log

- 2026-10-03: Read-only review queue. Refresh stores the 30-day library, playlists and prepared drafts (recap excerpt for highlights, coach template for press conferences, official game choices when the match is ambiguous or the sport is unassigned). Editors save drafts per video with version checks and audit entries. Suggested highlight titles follow YOUTUBE_FORMATS.md (AP dates, `vs`/`at` from the schedule). New `youtube:draft` permission, migration `0165_youtube_review_queue`, local replay of recorded read-only API responses for preview proof.

- 2026-10-03: Core rules port (66 tests, sentence IDs identical to the Mac app) and the channel connection: OAuth with PKCE, encrypted grant storage, connect/disconnect UI at `/youtube`, ADMIN-only `youtube` permission, migration `0164_youtube_connection`.
