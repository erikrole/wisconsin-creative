# SwiftData Caching Layer — Implementation Plan

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

## Goal
Add a local SwiftData cache to the iOS app so users see data instantly on tab switch/app relaunch while a silent background refresh runs. Stale-while-revalidate pattern.

## Architecture

### GearStore singleton
- Owns the `ModelContainer` (schema shared across all features)
- Exposes `context: ModelContext` (lazy, main actor)
- Methods: `seed(assets:)`, `seedBookings(_:)`, `seedEvents(_:)`, `cachedAssets()`, `cachedBookings()`, `cachedEvents()`, `clearAll()`

### @Model classes
- `CachedAsset` — mirrors `Asset` struct (id, assetTag, name, brand, model, serialNumber, imageUrl, computedStatus, locationId, locationName, categoryId, categoryName, isFavorited, cachedAt)
- `CachedBooking` — mirrors `Booking` struct (id, title, status, startsAt, endsAt, assetName, assetTag, requesterName, cachedAt)
- `CachedScheduleEvent` — mirrors `ScheduleEvent` struct (id, title, startsAt, endsAt, kind, cachedAt)

### Cache contract
- Cache is seed-only for list views (first page, no filters active)
- Cache never serves detail views (always live fetch)
- Cache auto-expires: discard entries older than 24 h at read time
- On logout: `GearStore.clearAll()`

## Slices

### Slice 1 — Schema + GearStore + container wiring [ ]
**Files:** `Core/GearStore.swift` (new), `App/WisconsinApp.swift` (add `.modelContainer`)
**User-visible change:** none  
**Done when:** app builds and runs, `GearStore.shared` accessible, no crashes.

### Slice 2 — Items caching [ ]
**Files:** `Views/ItemsView.swift`
**Change:** `ItemsViewModel.load(reset:)` — on reset with no filters active, seed from cache first, then do the API call and overwrite.  
**Done when:** switching to Items tab shows cached rows instantly, then updates silently.

### Slice 3 — Bookings caching [ ]
**Files:** `Views/BookingsView.swift`
**Change:** same stale-while-revalidate pattern in `BookingsViewModel`.  
**Done when:** Bookings tab loads instantly from cache.

### Slice 4 — Schedule caching [ ]
**Files:** `Views/ScheduleView.swift` (or relevant VM)
**Change:** same pattern for schedule events.  
**Done when:** Schedule tab loads instantly from cache.

## Constraints
- Pagination: only seed/read cache for first-page unfiltered state (`offset == 0 && searchText.isEmpty && selectedStatus == nil && favoritesOnly == false`)
- No cache for detail views — always live
- `@Model` classes must be `final class` (SwiftData requirement)
- `ModelContainer` configured in `WisconsinApp` body, passed via `.modelContainer()` modifier
- `GearStore` reads context from environment at call site or holds its own context (use `@MainActor` + lazily created context from shared container)

## Acceptance Criteria
- [ ] App builds clean
- [ ] Items tab shows rows immediately on cold relaunch (from cache)
- [ ] Bookings tab shows rows immediately on cold relaunch
- [ ] Schedule tab shows rows immediately on cold relaunch
- [ ] Logout clears all cached data
- [ ] Cache older than 24h is ignored (stale guard at read)
