# Search Area Scope

## Document Control
- Area: Search
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-25
- Status: Active
- Version: V1

## Direction
Make search a fast operational jump layer. It should find records when the user knows an identity, and destinations when the user knows an intent.

## Surfaces

### Quick Search Palette
- Opens from the top bar, mobile search button, or `Cmd/Ctrl+K`.
- Searches role-visible pages, settings, reports, items, active checkouts, active reservations, and users.
- Page results are role-aware:
  - Everyone can find core app pages and personal settings.
  - Staff/admin can find staff tools, reports, and system settings.
  - Admin-only destinations stay hidden from staff/student search.
- Entity search fans out to existing list APIs:
  - `/api/assets`
  - `/api/checkouts`
  - `/api/reservations`
  - `/api/users`
- Partial endpoint failures show available matches instead of wiping the palette.
- Empty copy tells operators what to try: tag, borrower, page name, setting, or report.

### Full Search Page
- `/search?q=...` provides a larger result review surface for the same record categories plus role-visible page destinations.
- The page preserves query state in the URL.
- It uses the same partial-failure behavior as the quick palette.

### WebMCP Read Surface
- Authenticated app pages progressively register WebMCP tools through `document.modelContext` when the browser supports the experimental API.
- `gear-tracker.get-current-page`, `gear-tracker.open-page`, `gear-tracker.get-dashboard-snapshot`, and role/capability-filtered item and booking searches reuse the existing authenticated routes and navigation policy.
- WebMCP results are compact read models. They omit serial numbers, notes, QR values, vault data, and mutation actions; kiosk custody and booking mutations remain outside the agent surface.
- The current implementation also recognizes the deprecated `navigator.modelContext` preview alias and fails closed when WebMCP is unavailable.

## Rules
1. Search must never expose navigation targets the current role cannot use.
2. Active booking search should prefer current operational states, not completed/cancelled history.
3. Search result titles should not render empty metadata placeholders.
4. A failure from one record source should not hide successful results from another source.
5. The full search page and quick palette should not disagree on destination search.

## Change Log
- 2026-08-25: **Authenticated WebMCP progressive enhancement.** The app now registers bounded, role-aware read tools for current-page context, internal navigation, dashboard snapshot, item search, and active booking search when the browser exposes WebMCP. The `tools=(self)` Permissions Policy is explicit; unsupported browsers continue to use the normal website without a fallback dependency. Mutation/custody tools remain intentionally out of scope.
- 2026-07-10: Native Search and Scan interaction hardening removed fixed presentation/autofocus delays, routes scan results from actual cover dismissal, keeps recovery actions independently reachable to VoiceOver, turns image zoom into a semantic Button, adds coherent result-row labels, and substitutes static/opacity feedback when Reduce Motion is enabled.
- 2026-07-10: **Web global search typing stability.** `/search` now uses the shared `DebouncedSearchInput` (local keystroke echo, one committed query per pause, instant clear/Enter/Escape) with the committed value synced straight to the `q` URL param, and previous results stay visible (dimmed, with an "Updating" spinner) while the four-source fan-out is in flight instead of wiping to skeletons on every pause. Skeletons only show when there are no prior results. Regression guard: `tests/search-input-focus-stability.test.ts`.
- 2026-07-03: Native iOS QR scanner fallback polish hides the unavailable-state controls behind the manual-entry sheet, so the typed-code form no longer sits over a glowing fallback button in Simulator or unsupported-camera states.
- 2026-07-03: Native iOS typed Search tab item results no longer send the typed query as a QR lookup and now filter attachment/accessory categories from normal typed results. QR/direct scan lookup can still resolve child attachments for recovery.
- 2026-07-03: Tapping the native iOS Search tab now presents the system search field immediately so the keyboard is ready for query entry, while scan remains in the Search toolbar.
- 2026-07-03: Native iOS tab order now keeps Search as the pinned trailing tab after Home, Schedule, Bookings/My Gear, and More. The old Browse directory surface is labeled More and still owns Items, Guides, Licenses, and Users; QR scanning remains inside Search.
- 2026-06-30: Native iOS Browse navigation replaced the standalone compact Items tab with a system Browse tab for Items, Guides, Licenses, and Users. Search remains the compact trailing tab with `role: .search`, and QR scanning remains an action inside Search.
- 2026-06-29: Native iOS app-shell search/scan affordance now uses SwiftUI's built-in `Tab(...)` API with Scan marked `role: .search` and pinned placement, and compact iPhone uses `.tabBarOnly` instead of sidebar-adaptable styling so the system owns the dedicated trailing Scan placement. Users is kept out of the compact iPhone tab set because six native tabs force More and hide Scan; regular-width layouts expose Guides, Users, and Licenses as sidebar-only secondary destinations, and compact iPhone reaches them from Profile/Settings > Directory. Global search and QR scanner lookup behavior did not change.
- 2026-06-27: Web partial-result visibility standardized. Quick Search and `/search` now track the exact failed result types and render the shared `OperationalPartialResultsAlert`, so operators can keep using available matches while knowing which sources need a refresh before trusting a clean result.
- 2026-06-10: Web ambient type-to-search removed from the quick palette. Quick Search now opens only from the top-bar search trigger, mobile search button, or `Cmd/Ctrl+K`, leaving all printable typing to the active page or focused field.
- 2026-06-10: Web quick-search input guard tightened. The global type-to-search shortcut now respects page-owned keyboard events and the currently focused text-entry control, so local search fields such as Items search keep typing focus instead of being interrupted by the command palette.
- 2026-06-11: Native iOS global search and QR shortcut now keep item-family results from `/api/assets.bulkItems`, so printed numbered battery unit labels can show the resolved Sony battery family instead of being treated as no match.
- 2026-06-09: Native iOS runtime warning cleanup. `APIClient`, kiosk API, and thumbnail image sessions now use explicit 15s/30s mobile timeouts with multipath disabled, reducing avoidable CFNetwork fallback churn for Scan/Search lookups and image fetches.
- 2026-06-06: Web quick-search item identity parity shipped. The command palette and full `/search` page now share the same item-title fallback through asset tag, item name, brand/model, type, then `Untitled item`, so sparse item data no longer makes the two search surfaces disagree.
- 2026-06-06: Web full-search item identity fallback shipped. `/search` item results now fall back through asset tag, item name, brand/model, type, then `Untitled item`, preventing blank result titles while preserving role-aware destinations, partial-failure behavior, active booking search scope, and URL query state.
- 2026-06-06: Native iOS Scan result retry recovery. `ScanView` lookup failures now expose Try again before Type code instead, retry the last scanned query after clearing same-code dedupe, and preserve the same `SearchService` fan-out plus item/booking handoff behavior.
- 2026-06-05: Native iOS global-search QR shortcut HIG polish. `QRScannerSheet` now uses the same camera pre-prompt and denied-state recovery as the primary Scan tab, raises overlay controls to 44pt targets, moves manual code entry out of an alert into a medium sheet, keeps lookup errors visible with recovery actions, adds error haptics, and preserves the same `assetsLookup` route and asset-detail handoff.
- 2026-05-25: Web bug sweep Batch 42 fixed full-page Search clear-state drift. Clearing the query now aborts in-flight entity fan-out, removes `q` from the URL, clears stale results immediately, and prevents stale `View all ...?q=` links from lingering while the debounce catches up.
- 2026-05-25: Web bug sweep Batch 24 hardened full-page Search URL rehydration. `/search?q=...` now updates the input, debounced query, and results when the address bar changes through browser back/forward or external links instead of keeping the previous local query.
- 2026-05-24: Web bug sweep search reliability. Full-page Search and the command palette now use safe JSON parsing and shared auth redirects across their four endpoint fan-outs, so a malformed/non-JSON response from one record source degrades to partial results instead of throwing away successful matches.
- 2026-05-21: Global search MVP hardening. Quick search now includes role-aware page/settings/report destinations, uses partial-result handling across the four entity endpoints, explains empty searches with concrete examples, and keeps `/search` aligned with the same page-result catalog and failure semantics. Added regression coverage for role-visible page search.
