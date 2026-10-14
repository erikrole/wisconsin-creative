# Public Showroom Area Scope

## Document Control
- Area: Public Showroom
- Owner: Wisconsin Athletics Creative Product
- Created: 2026-07-01
- Last Updated: 2026-10-14
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
- `/releases` - public release notes. Releases live in `src/lib/releases.json` (newest first); `src/lib/releases.ts` owns the types and the public-safe term list. The page opens on the last eight weeks with a "Show earlier releases" control, platform and type filters, a sticky month header, and weekly fix roundups collapsed into one expandable line; deep links to older releases expand the history. `/releases/feed.xml` is a static RSS feed of the latest 50 releases. Every PR to `main` must add or update an entry (AGENTS.md); the required CI `validate` job runs `scripts/check-release-note.mjs` and fails the PR unless a changed entry carries the PR's number, the PR is labeled `no-release-note` (re-run CI after labeling), or Dependabot opened it.
- `/apps` - signed-in directory of the team's apps and browser tools, rendered by `src/app/apps/route.ts` at `wisconsincreative.com/apps`. It is not a public file. The page is `noindex`. Icons live in `public/apps/icons/`. The Board Sizes card links to `/board-sizes`.
- `/tools` - redirects to `/apps`.
- `/golden-hour` - Golden Hour: golden and blue hour for UW venues and every Big Ten road venue, in the venue's own time zone, plus opt-in GPS. `public/golden-hour/` is the canonical source (sun and time-zone maths in `core.js`, page wiring in `app.js`).
- `/timelapse` - Timelapse: S&Q, in-camera Time-lapse and interval-stills plans for the FX3, A1, A1 II, A7 V and A9 III, with limits from Sony's Help Guides. `public/timelapse/` is the canonical source (`core.js` holds the maths and camera data).
- `/privacy` - public privacy policy for App Store Connect and stakeholder review.
- `/qrcode` - QR Studio, a static client-only QR code generator. Redirects to `/qrcode/index.html` in `public/qrcode/`, which is generated from the QR Studio source by its `scripts/export-web.js`; do not edit the copy here.

## Acceptance Criteria
- [x] AC-1: `/about` and all public subpages render without authentication.
- [x] AC-2: Public routes use typed static content and do not call authenticated APIs.
- [x] AC-3: Product mockups carry fictional data and avoid known live-user or incident identifiers.
- [x] AC-4: Navigation exposes Overview, Features, Tech Stack, Security, Field Work, Releases, and Sign in.
- [x] AC-5: `/` and authenticated app shell behavior remain unchanged.
- [x] AC-6: Public pages have route metadata, keyboard-reachable navigation, and mobile-safe layouts.
- [ ] AC-11: `/apps` is the signed-in apps directory at `src/app/apps/route.ts`. `/golden-hour` and `/timelapse` open without authentication through the dotted-path redirect, each under its own `default-src 'none'` / `connect-src 'none'` policy with content-hashed scripts (`node scripts/hash-static-tools.mjs`). Only `/golden-hour/*` receives `Permissions-Policy: geolocation=(self)`; every other route keeps `geolocation=()`. Shared Golden Hour links carry a venue id or typed coordinates and a date, never a GPS fix. The Board Sizes card points at `/board-sizes`. Pending deploy proof.
- [x] AC-7: `/privacy` renders without authentication and does not fetch authenticated data.
- [ ] AC-8: `/qrcode` opens QR Studio without authentication, outside the nonce-CSP middleware, under its own `default-src 'none'` / `connect-src 'none'` policy; script URLs are content-hashed so the service worker's cache-first `.js` rule cannot serve stale code. Pending deploy proof.
- [ ] AC-9: `/releases` renders static, public-safe release notes grouped by date (no people's names, emails, or security specifics), newest first with stable date anchors. Pending deploy proof.

## Verification
- `npx vitest run tests/public-showroom-content.test.ts tests/public-releases-content.test.ts tests/check-release-note.test.ts tests/qrcode-static-tool.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run codemap`
- `npm run verify:docs`
- `git diff --check`
- `npm run build:app`
- `npm run smoke:deploy`
- Browser smoke `/about`, `/about/features`, `/about/tech-stack`, `/about/security`, `/about/field-work`, `/releases`, `/login`, and protected `/`.
- `npx vitest run tests/static-tools.test.ts tests/apps-static-page.test.ts tests/apps-live-versions.test.ts`

## Change Log
- 2026-10-08: Added `/releases`, a public release-notes page backfilled with per-feature releases (mapped to merged PRs where they exist), grouped by date, from the first build (2026-02-27) through 2026-10-08. Entries are static JSON with a content test for date order, unique anchors, and public-safe copy. The showroom nav and footer gain a Releases link, and the about and releases layouts share one footer component. Backfilled dates are when work landed on `main`, not announcement dates. From now on every PR to `main` must add or update a release entry, enforced in the required CI `validate` job (opt out with the `no-release-note` label), with a PR template checkbox to match. Design pass: recent-first view with earlier history behind a button, app and type filters, sticky month headers, collapsed fix roundups, neutral platform tags (red reserved for New), summary text darker than detail bullets, PR numbers kept in data but not shown, a Latest line, and an RSS feed.
- 2026-10-14: Added `/apps`, a signed-in directory of the team's apps and browser tools, rendered by `src/app/apps/route.ts`. `/tools` redirects there. Golden Hour and Timelapse ship here. The Board Sizes card links to `/board-sizes`. The page sends `noindex`.
- 2026-09-24: Redesigned the two tools with their own looks. Golden Hour is a full-page sky driven by the sun's altitude at the chosen venue (night, blue, gold, day), with a hero readout, the sun's real altitude path through the day, and tinted glass cards. Timelapse is a dark viewfinder (focus brackets, REC state, HUD stats, a to-scale roll-to-clip funnel) that sticks to the top on phones. `/tools` previews each tool's look. Both tools load the self-hosted Gotham under `font-src 'self'`; the per-page theme toggle is gone because each page's appearance is set by design.
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
