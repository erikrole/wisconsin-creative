# Higher-traffic UI batch

Implement 15 evidenced fixes in everyday web filtering and search. No API, custody, permissions, or schema changes. Shared search propagation: Items, Bookings, Kits, global Search, Labels, Resources (all direct consumers found with rg). Dashboard scope is existing filter controls; Items scope is its faceted menus; Bookings scope is its filter toolbar. No Schedule edits required by the selected findings.

1. Do not publish partial IME composition as a search.
2. Enter commits search without submitting an enclosing form.
3. Disabled search cannot be cleared through its still-active clear button.
4. Read-only search cannot be cleared through its clear button or Escape.
5. Pending search callbacks stop when the field becomes disabled/read-only.
6. Malformed saved-view storage cannot crash Dashboard filters.
7. Failed saved-view writes show a persistent error and preserve the current state.
8. Dashboard sport/location/preset toggles expose their pressed state.
9. Long Dashboard filter trigger text stays within available width.
10. Long Dashboard location/preset labels wrap without overflowing their popover.
11. Booking heading follows the special filter that actually takes precedence in the request.
12. Active booking Sport control stays available when the current results contain no sport codes.
13. Item facet options use stable IDs so duplicate labels remain independently selectable.
14. Item facet search has a specific accessible label and selected options announce inclusion.
15. Item facet option/clear rows meet the 40px target floor.

Verification: actual component fixtures in Chromium, focused existing tests plus browser regressions, TypeScript, lint, build:app, docs/codemap and diff checks. Retain original dirty snapshots and matched images. Fixture proof is not authenticated route/server proof. No live data writes, commits, pushes, or deployments.

## Acceptance

Completed locally. 28 focused tests and 16 browser checks pass, with no browser runtime errors. TypeScript, lint, build:app, docs/codemap and diff checks pass. Desktop comparisons and narrow-screen/failure captures reviewed. No signed-in application session was established; authenticated route verification and deployment remain open. No commits or pushes.
