# iOS Browse Audit — 2026-06-30

## Scope
Native iOS Browse tab in `ios/Wisconsin/Views/BrowseView.swift`.

## What Shipped
- Compact iPhone primary navigation now uses Browse instead of a standalone Items tab.
- Browse is a native SwiftUI `NavigationStack` and inset grouped `List`.
- Browse links to Items, Guides, Licenses, and Users.
- Users is visible to every authenticated role as a read directory; mutation controls remain governed by the existing Users page and server authorization.
- Settings Directory remains a fallback path for Guides, Users, and Licenses.
- Browse now owns one bound navigation path across every embedded destination; Items and Users opt out of their standalone stack wrappers when opened from Browse.
- Item Detail and User Detail push on the Browse-owned hierarchy, and repeated selection of the active Browse tab resets that parent path to the menu.
- Items and Users use the explicit always-visible navigation-bar search drawer, matching Guides and reserving search layout above loaded rows instead of overlaying the first result.

## Risks Checked
- Compact tab count stays at five, so Search remains the pinned trailing search tab.
- Browse uses system NavigationLinks rather than a custom hamburger or drawer.
- No backend permission, schema, or API contract changed.
- Guides and Licenses remain read/self-service native surfaces with web-owned admin workflows.

## Follow-Ups
- 2026-10-16: Browse adds a Brand assets row for internal roles. The folder list and file page live in `BrandAssetsView.swift` and are covered by `tasks/audit-brand-assets-ios.md`.
- 2026-10-16: Browse adds a Blasts row for every signed-in role. The list and detail live in `BlastsView.swift` and are covered by `tasks/audit-blasts-ios.md`.
- Resolved 2026-07-17: Items and Users now use non-nested wrappers inside Browse while preserving standalone stack behavior for regular-width/sidebar entry points.
- Visual interaction proof remains to be repeated on an authenticated simulator or physical device; this pass had no booted simulator available after source, XCTest, simulator-build, and generic-device-build verification completed.
