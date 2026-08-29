# Public Showroom Area Scope

## Document Control
- Area: Public Showroom
- Owner: Wisconsin Athletics Creative Product
- Created: 2026-07-01
- Last Updated: 2026-08-03
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

## Acceptance Criteria
- [x] AC-1: `/about` and all public subpages render without authentication.
- [x] AC-2: Public routes use typed static content and do not call authenticated APIs.
- [x] AC-3: Product mockups carry fictional data and avoid known live-user or incident identifiers.
- [x] AC-4: Navigation exposes Overview, Features, Tech Stack, Security, Field Work, and Sign in.
- [x] AC-5: `/` and authenticated app shell behavior remain unchanged.
- [x] AC-6: Public pages have route metadata, keyboard-reachable navigation, and mobile-safe layouts.
- [x] AC-7: `/privacy` renders without authentication and does not fetch authenticated data.

## Verification
- `npx vitest run tests/public-showroom-content.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run codemap`
- `npm run verify:docs`
- `git diff --check`
- `npm run build:app`
- `npm run smoke:deploy`
- Browser smoke `/about`, `/about/features`, `/about/tech-stack`, `/about/security`, `/about/field-work`, `/login`, and protected `/`.

## Change Log
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
