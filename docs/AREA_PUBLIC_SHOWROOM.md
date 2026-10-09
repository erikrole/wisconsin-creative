# Public Showroom Area Scope

## Document Control
- Area: Public Showroom
- Owner: Wisconsin Athletics Creative Product
- Created: 2026-07-01
- Last Updated: 2026-10-08
- Status: Active
- Version: V1

## Direction
Make `/about` a shareable public overview for Wisconsin Creative. It should explain the product, feature set, technical stack, security model, and field-work model without exposing authenticated data or changing the operational app shell.

## Core Rules
1. Public showroom pages live outside `src/app/(app)` and must not use the authenticated `AppShell`.
2. Public pages use static, reviewable content only. They must not fetch live users, bookings, inventory, audit logs, schedules, or kiosk state. The HTML shell may render dynamically to attach per-request CSP nonces.
3. Product mockups use fictional data only. Do not use real student names, live booking references, production incidents, or screenshots unless separately sanitized.
4. Security copy stays public-safe: name major vendors and controls, but do not publish secrets, thresholds, endpoint internals, exploit detail, or runbooks.
5. `/`, `/login`, and every authenticated app route keep existing behavior.
6. The public pages may use product-page pacing, but the copy should stay matter-of-fact and grounded in shipped workflows.

## Routes
- `/about` - public overview.
- `/about/features` - reservations, kiosk custody, Schedule, item families, reports, and notifications.
- `/about/tech-stack` - public-safe stack map.
- `/about/security` - trust model, access control, auditability, and reliability controls.
- `/about/field-work` - native iOS, kiosk, scanner, and game-day handoffs.
- `/privacy` - public privacy policy for App Store Connect and stakeholder review.
- `/qrcode` - QR Studio, a static client-only QR code generator. Redirects to `/qrcode/index.html` in `public/qrcode/`, which is generated from the QR Studio source by its `scripts/export-web.js`; do not edit the copy here.
- `/tools` - hub listing the public tools. Static `public/tools/index.html`, no script.
- `/board-sizes` - Board Sizes: every display and zone at Camp Randall (incl. IPTV), Kohl Center, Field House, LaBahn and Goodman, cross-referenced from the Wisconsin Board Info sheet, the 2024 Camp Randall content guide, Colosseum's 196_WISC deliverables sheet and the Wisconsin Board Builder (`public/board-sizes/boards.json`, which records each fact's source and is the single source for board sizes; edit there when a source changes, then run `node scripts/build-board-sizes.mjs` to regenerate `data.js`). The same file is published at `/board-sizes/boards.json` with a `version`, a `changes` log, stable `canvases` keys and a stable `id` on every display and zone; the After Effects Board Builder pins a copy of it rather than carrying its own sizes. The build script also generates the agent files `/board-sizes/llms.txt` (rules for agents plus every size), `/board-sizes/index.json` (one flat record per display and zone) and `/board-sizes/boards.csv`; `/board-sizes/boards.schema.json` is the hand-written JSON Schema. Copyable sizes and ids, delivery specs, open issues, cross-venue search, CSV export, per-zone JSON, `#<id>` deep links and guide PNGs drawn in the browser.
- `/golden-hour` - Golden Hour: golden and blue hour for UW venues and every Big Ten road venue, in the venue's own time zone, plus opt-in GPS. `public/golden-hour/` is the canonical source (sun and time-zone maths in `core.js`, page wiring in `app.js`).
- `/timelapse` - Timelapse: S&Q, in-camera Time-lapse and interval-stills plans for the FX3, A1, A1 II, A7 V and A9 III, with limits from Sony's Help Guides. `public/timelapse/` is the canonical source (`core.js` holds the maths and camera data).

## Acceptance Criteria
- [x] AC-1: `/about` and all public subpages render without authentication.
- [x] AC-2: Public routes use typed static content and do not call authenticated APIs.
- [x] AC-3: Product mockups carry fictional data and avoid known live-user or incident identifiers.
- [x] AC-4: Navigation exposes Overview, Features, Tech Stack, Security, Field Work, and Sign in.
- [x] AC-5: `/` and authenticated app shell behavior remain unchanged.
- [x] AC-6: Public pages have route metadata, keyboard-reachable navigation, and mobile-safe layouts.
- [x] AC-7: `/privacy` renders without authentication and does not fetch authenticated data.
- [ ] AC-8: `/qrcode` opens QR Studio without authentication, outside the nonce-CSP middleware, under its own `default-src 'none'` / `connect-src 'none'` policy; script URLs are content-hashed so the service worker's cache-first `.js` rule cannot serve stale code. Pending deploy proof.
- [ ] AC-9: `/tools`, `/golden-hour`, `/timelapse` and `/board-sizes` open without authentication through the same dotted-path redirect pattern, each under its own `default-src 'none'` / `connect-src 'none'` policy with content-hashed scripts (`node scripts/hash-static-tools.mjs`). Only `/golden-hour/*` receives `Permissions-Policy: geolocation=(self)`; every other route keeps `geolocation=()`. Shared Golden Hour links carry a venue id or typed coordinates and a date, never a GPS fix. Pending deploy proof.

## Verification
- `npx vitest run tests/public-showroom-content.test.ts tests/qrcode-static-tool.test.ts tests/static-tools.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run codemap`
- `npm run verify:docs`
- `git diff --check`
- `npm run build:app`
- `npm run smoke:deploy`
- Browser smoke `/about`, `/about/features`, `/about/tech-stack`, `/about/security`, `/about/field-work`, `/login`, and protected `/`.

## Change Log
- 2026-10-08: Board Sizes made the reference agents use for any new project. `boards.json` (manifest 2026-10-08.1, schema unchanged, canvas keys and sizes identical) gains a stable `id` on every display and zone, `{x, y}` positions, typed `issues` (conflict, tbd, unconfirmed, naming) in place of red prose notes, `notes` for plain information everywhere and a `changes` log. `scripts/build-board-sizes.mjs` now validates ids, positions and issues and generates `index.json`, `boards.csv` and `llms.txt` alongside `data.js`. The page adds “For agents & tools” (files, rules, snippets, changelog) and “Open issues” views, copyable ids and canvas keys on every display and zone, a per-zone JSON copy button and `#<id>` deep links that open the right venue.
- 2026-09-24: Board Sizes redesigned as a calm document-style app (sidebar, light/dark) and extended with content types: four draft broad types (full-system feature, sponsor ad windows, main board video, IPTV) and Colosseum's 27 game-day pieces, each mapped to the exact boards it needs, with identical canvases on one board merged (×N). Content views export copyable sizes, CSV and an After Effects script that creates one correctly sized comp per canvas. “Share link” adds `share=1`, which hides the way back to the rest of the site. An “AE template” button appears once `links.aeTemplate` is set in `boards.json`.
- 2026-09-24: Board Sizes cross-referenced against the 2024 Camp Randall content guide, Colosseum's deliverables sheet and the Board Builder. Adds the North Board HD feed (94/180 px crop, 90% title safe), four IPTV canvases with seams, LaBahn (448 × 256) and Goodman Diamond (560 × 308); per-display sources and delivery specs (frame rate, codec, stills-only, exact durations, 20 px border pad, speaker-scrim blanks); zone positions for the North Board, Kellner and Section A from the Board Builder and for the fascias from their sizes. Disagreements are flagged, not resolved silently: Kohl Center fascia 72 vs 144 px, Kohl Center 60 vs 59.94 fps, and the Colosseum-only Kohl Center 16:9 feed and Goodman board. The 2022 guide describes the retired system (6000 × 72 fascia, 306 × 414 wings) and is not used.
- 2026-09-24: Added `/board-sizes` (Board Sizes), a blueprint-styled reference for 19 displays and 193 zones across Camp Randall, Kohl Center and Field House, transcribed from the Wisconsin Board Info sheet (modified 2026-06-09). FG/BG layers collapse into one row; Club Board zones are drawn in place from the sheet's (top, left) positions; the sheet's open items (Main GIP size TBD, a duplicated Field House “Left GIP-BG”, the table rename) show as red notes. Listed on `/tools`.
- 2026-09-24: Redesigned the two tools with their own looks. Golden Hour is a full-page sky driven by the sun's altitude at the chosen venue (night, blue, gold, day), with a hero readout, the sun's real altitude path through the day, and tinted glass cards. Timelapse is a dark viewfinder (focus brackets, REC state, HUD stats, a to-scale roll-to-clip funnel) that sticks to the top on phones. `/tools` previews each tool's look. All three load the self-hosted Gotham under `font-src 'self'`; the per-page theme toggle is gone because each page's appearance is set by design.
- 2026-09-24: Added `/tools`, `/golden-hour` and `/timelapse`, ported from the local Work Projects tools after an end-to-end audit, and made this repo their canonical source. Golden Hour now picks from UW and Big Ten venues and shows each in its own time zone (it previously used the device clock only, so road shoots read wrong), adopts the photographer convention (golden +6° to −4°, blue −4° to −6°), follows today across midnight, fixes a copy bug that printed `null` for days without a 6° crossing, and gains shareable links. Timelapse now covers the team's five bodies with three methods (S&Q, in-camera Time-lapse on the A7 V, A1 II and A9 III with its 5 s 4K cap, and interval stills including the FX3), snaps "find the setting" plans to values the camera can dial in and gives the exact roll time, uses per-frame-rate bitrates and per-body file sizes from Sony's Help Guides, and fixes the "ON THE Α" uppercase and clipped mobile table. `/golden-hour/*` is the only route that may request geolocation. `tests/static-tools.test.ts` covers routing, headers, CSP, script hashes and the core maths.
- 2026-09-23: Added `/qrcode`, the public QR Studio tool (branded, scan-checked QR codes for links, Wi-Fi, email, phone, SMS, contacts and text). Static files in `public/qrcode/`; `/qrcode` redirects to the dotted `index.html` path so the nonce middleware is not involved. The page makes no network requests and stores its library only in the visitor's browser. `tests/qrcode-static-tool.test.ts` guards the redirect, CSP, content-hashed script URLs and the folder's contents.
- 2026-08-03: Fixed the desktop public-header wordmark contrast. The logo link now explicitly uses the white text token required by the dark header, and the public-showroom content contract guards that relationship.
- 2026-07-10: Removed the public showroom's decorative hero atmosphere, repeated oversized card shadows, tinted icon tiles, and max-radius mockup framing. The static routes, factual copy, product mockups, and Wisconsin visual identity remain unchanged; shared status indicators now use a static labeled dot rather than a pulsing halo.
- 2026-07-08: Added `src/app/robots.ts` (`Disallow: /` for all user agents), closing a P2 finding from `tasks/security-headers-audit.md` that predated the public showroom. The site is invite-only and now App Store Unlisted; `/about` and `/privacy` are for direct-link stakeholder/reviewer sharing, not search discovery.
- 2026-07-02: Reduced marketing language across the `/about` route set. Headlines, CTA copy, mockup descriptions, metadata, footer copy, and section navigation now describe concrete workflows, platform pieces, security controls, and field surfaces in a matter-of-fact tone.
- 2026-07-01: Added static `/privacy` for `wisconsincreative.com/privacy`, covering the iOS launch privacy-policy requirement with public-safe copy, no authenticated API reads, and contact routing through `erole@athletics.wisc.edu`.
- 2026-07-01: Improvement pass. Pinned the showroom subtree to light tokens (`[data-theme="light"]` alias in globals plus wrapper attribute) so system-dark visitors no longer get white-on-white text; fixed the invisible gray tone chip on light cards; demoted product-mockup headings to styled text inside a `figure` to keep heading order valid; added a skip-to-content link and `#showroom-content` targets; added `metadataBase` (wisconsincreative.com), Open Graph/Twitter metadata, and a generated `opengraph-image` for the `/about` segment; added a "Keep exploring" cross-link section fed by the nav descriptions; made the stakeholder CTA link configurable so Tech Stack no longer links to itself; refreshed footer and security-page copy; extended the content contract test for light-pinning, share metadata, and nav descriptions.
- 2026-07-01: Public stakeholder showroom shipped locally with static `/about` route set, fictional product mockups, public-safe stack/security copy, and content contract coverage.
- 2026-07-01: Vercel static-shell optimization moved theme and service-worker boot code from nonce-backed inline scripts to same-origin static scripts, removed the root `headers()` dependency, and retired the middleware nonce path so public showroom pages can stay static-friendly under the shared CSP. A non-matching middleware sentinel remains only to keep the current Next 15/Sentry build manifest path stable.
- 2026-07-02: Production blank-page recovery. Live deploy proof showed the App Router shell loading assets but rendering an empty document because `script-src 'self'` blocked Next's inline bootstrap/RSC scripts. The shared CSP now allows `script-src 'self' 'unsafe-inline'` in production until nonce wiring is implemented end-to-end, and content-contract coverage guards the render-critical policy.
- 2026-07-02: Nonce CSP hardening. Rendered HTML routes now receive a per-request CSP nonce from middleware, the root boot scripts carry that nonce, production `script-src` no longer allows `unsafe-inline`, and `npm run smoke:deploy` checks public pages plus a seeded-login path for nonce CSP regressions.
