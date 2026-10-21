import Foundation

/// The four places a query is answered from. Named so a partial result can say
/// which half of the answer is missing instead of quietly under-reporting.
enum SearchSource: String, CaseIterable {
    case items
    case reservations
    case checkouts
    case people
    case kits
    case events
    case guides

    var label: String {
        switch self {
        case .items: return "Items"
        case .reservations: return "Reservations"
        case .checkouts: return "Check-outs"
        case .people: return "People"
        case .kits: return "Kits"
        case .events: return "Events"
        case .guides: return "Guides"
        }
    }
}

struct SearchPage {
    var items: [Asset] = []
    var itemFamilies: [AssetFamilySearchResult] = []
    var bookings: [Booking] = []
    var users: [AppUser] = []
    var kits: [KitListItem] = []
    var events: [ScheduleEvent] = []
    var guides: [GuideListItem] = []
    let total: Int
    let nextOffset: Int
}

struct SearchResults {
    var items: [Asset] = []
    var itemFamilies: [AssetFamilySearchResult] = []
    var reservations: [Booking] = []
    var checkouts: [Booking] = []
    var users: [AppUser] = []
    var kits: [KitListItem] = []
    var events: [ScheduleEvent] = []
    var guides: [GuideListItem] = []
    /// Sources that failed while others answered. Empty on a clean search.
    var unavailableSources: Set<SearchSource> = []
    /// Server totals and cursors let the UI distinguish a complete short list
    /// from the first page of a larger result set.
    var sourceTotals: [SearchSource: Int] = [:]
    var sourceNextOffsets: [SearchSource: Int] = [:]

    var isEmpty: Bool {
        items.isEmpty && itemFamilies.isEmpty && reservations.isEmpty && checkouts.isEmpty && users.isEmpty
            && kits.isEmpty && events.isEmpty && guides.isEmpty
    }

    /// True when at least one source has confirmed a match. A fully answered
    /// search with zero matches still uses the dedicated no-results state.
    var hasKnownMatches: Bool {
        !isEmpty || sourceTotals.values.contains { $0 > 0 }
    }

    func loadedCount(for source: SearchSource) -> Int {
        switch source {
        case .items: return items.count + itemFamilies.count
        case .reservations: return reservations.count
        case .checkouts: return checkouts.count
        case .people: return users.count
        case .kits: return kits.count
        case .events: return events.count
        case .guides: return guides.count
        }
    }

    func total(for source: SearchSource) -> Int {
        sourceTotals[source] ?? loadedCount(for: source)
    }

    func nextOffset(for source: SearchSource) -> Int {
        sourceNextOffsets[source] ?? loadedCount(for: source)
    }

    func hasMore(for source: SearchSource) -> Bool {
        guard sourceNextOffsets[source] != nil else { return false }
        return loadedCount(for: source) < total(for: source)
    }

    mutating func apply(_ page: SearchPage, for source: SearchSource, appending: Bool) {
        switch source {
        case .items:
            if appending {
                items.append(contentsOf: page.items)
                itemFamilies.append(contentsOf: page.itemFamilies)
            } else {
                items = page.items
                itemFamilies = page.itemFamilies
            }
        case .reservations:
            if appending { reservations.append(contentsOf: page.bookings) }
            else { reservations = page.bookings }
        case .checkouts:
            if appending { checkouts.append(contentsOf: page.bookings) }
            else { checkouts = page.bookings }
        case .people:
            if appending { users.append(contentsOf: page.users) }
            else { users = page.users }
        case .kits:
            if appending { kits.append(contentsOf: page.kits) }
            else { kits = page.kits }
        case .events:
            if appending { events.append(contentsOf: page.events) }
            else { events = page.events }
        case .guides:
            if appending { guides.append(contentsOf: page.guides) }
            else { guides = page.guides }
        }
        sourceTotals[source] = page.total
        sourceNextOffsets[source] = page.nextOffset
    }

    /// Copy for the partial-result notice, or nil when everything answered.
    var partialResultNotice: String? {
        guard !unavailableSources.isEmpty else { return nil }
        let names = SearchSource.allCases
            .filter { unavailableSources.contains($0) }
            .map(\.label)
        let joined: String
        switch names.count {
        case 1: joined = names[0]
        case 2: joined = "\(names[0]) and \(names[1])"
        default: joined = names.dropLast().joined(separator: ", ") + ", and \(names[names.count - 1])"
        }
        return "\(joined) didn't load. Showing everything else."
    }

    /// The asset when the result set is a single serialized asset and nothing
    /// else — the canonical "scanned a sticker, got one item" case.
    var singleAssetMatch: Asset? {
        guard items.count == 1,
              itemFamilies.isEmpty,
              reservations.isEmpty,
              checkouts.isEmpty,
              users.isEmpty,
              kits.isEmpty,
              events.isEmpty,
              guides.isEmpty
        else { return nil }
        return items.first
    }

    /// The family when the result set is a single bulk-item family and nothing
    /// else — e.g. a scanned bulk-unit QR like "Sony Battery, Unit #1".
    var singleFamilyMatch: AssetFamilySearchResult? {
        guard itemFamilies.count == 1,
              items.isEmpty,
              reservations.isEmpty,
              checkouts.isEmpty,
              users.isEmpty,
              kits.isEmpty,
              events.isEmpty,
              guides.isEmpty
        else { return nil }
        return itemFamilies.first
    }
}

@MainActor
final class SearchService {
    static let shared = SearchService()
    private init() {}

    private let pageSize = 10

    func search(query: String, rawScan: String? = nil, gearOnly: Bool = false) async throws -> SearchResults {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return SearchResults() }

        if gearOnly {
            let page = try await fetchPage(source: .items, query: q, rawScan: rawScan, offset: 0)
            var results = SearchResults()
            results.apply(page, for: .items, appending: false)
            return results
        }
        // Each source is awaited independently. Search fans out to four
        // endpoints, and a single `try await (...)` tuple made any one failure
        // throw away the three that succeeded -- a flaky users call left the
        // student staring at an error instead of the item they scanned for.
        async let itemsTask = fetchPage(source: .items, query: q, rawScan: rawScan, offset: 0)
        async let reservationsTask = fetchPage(source: .reservations, query: q, offset: 0)
        async let checkoutsTask = fetchPage(source: .checkouts, query: q, offset: 0)
        async let usersTask = fetchPage(source: .people, query: q, offset: 0)

        async let kitsTask = Self.optionalPage { try await self.fetchPage(source: .kits, query: q, offset: 0) }
        async let eventsTask = Self.optionalPage { try await self.fetchPage(source: .events, query: q, offset: 0) }
        async let guidesTask = Self.optionalPage { try await self.fetchPage(source: .guides, query: q, offset: 0) }

        let itemsPage = try? await itemsTask
        let reservationsPage = try? await reservationsTask
        let checkoutsPage = try? await checkoutsTask
        let usersPage = try? await usersTask
        // Kits, Events and Guides are extras: a role without access to one
        // answers 403/404, which means "nothing to show here", not a failure.
        let kitsPage = await kitsTask
        let eventsPage = await eventsTask
        let guidesPage = await guidesTask

        var unavailable: Set<SearchSource> = []
        if itemsPage == nil { unavailable.insert(.items) }
        if reservationsPage == nil { unavailable.insert(.reservations) }
        if checkoutsPage == nil { unavailable.insert(.checkouts) }
        if usersPage == nil { unavailable.insert(.people) }
        if kitsPage.failed { unavailable.insert(.kits) }
        if eventsPage.failed { unavailable.insert(.events) }
        if guidesPage.failed { unavailable.insert(.guides) }

        // Every source failing is not a partial result, it is an outage, and
        // it should read as one rather than as "no matches".
        if unavailable.count == SearchSource.allCases.count {
            throw APIError.serverError("Search is unavailable right now. Check your connection and try again.")
        }

        var results = SearchResults(unavailableSources: unavailable)
        if let itemsPage { results.apply(itemsPage, for: .items, appending: false) }
        if let reservationsPage { results.apply(reservationsPage, for: .reservations, appending: false) }
        if let checkoutsPage { results.apply(checkoutsPage, for: .checkouts, appending: false) }
        if let usersPage { results.apply(usersPage, for: .people, appending: false) }
        if let page = kitsPage.page { results.apply(page, for: .kits, appending: false) }
        if let page = eventsPage.page { results.apply(page, for: .events, appending: false) }
        if let page = guidesPage.page { results.apply(page, for: .guides, appending: false) }
        return results
    }

    /// `page` is nil when the source is simply not available to this role;
    /// `failed` is true only for a real error worth telling the user about.
    private static func optionalPage(_ task: @MainActor () async throws -> SearchPage) async -> (page: SearchPage?, failed: Bool) {
        do {
            return (try await task(), false)
        } catch APIError.notFound {
            return (nil, false)
        } catch APIError.httpError(let status, _) where status == 403 {
            return (nil, false)
        } catch {
            return (nil, true)
        }
    }

    func loadMore(query: String, source: SearchSource, offset: Int, gearOnly: Bool = false) async throws -> SearchPage {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            return SearchPage(total: 0, nextOffset: offset)
        }
        return try await fetchPage(source: source, query: q, offset: offset)
    }

    private func fetchPage(
        source: SearchSource,
        query: String,
        rawScan: String? = nil,
        offset: Int
    ) async throws -> SearchPage {
        let api = APIClient.shared
        switch source {
        case .items:
            let response = try await api.assets(search: query, qr: rawScan, limit: pageSize, offset: offset)
            let isDirectScan = rawScan?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            let visibleItems = isDirectScan ? response.data : response.data.filter(Self.isSearchVisibleAsset)
            let visibleFamilies = isDirectScan ? response.bulkItems : response.bulkItems.filter(Self.isSearchVisibleFamily)
            let nextOffset = response.offset + response.data.count + response.bulkItems.count
            return SearchPage(
                items: visibleItems,
                itemFamilies: visibleFamilies,
                total: response.total,
                nextOffset: nextOffset
            )
        case .reservations:
            let response = try await api.reservations(activeOnly: false, search: query, limit: pageSize, offset: offset)
            return SearchPage(bookings: response.data, total: response.total, nextOffset: response.offset + response.data.count)
        case .checkouts:
            let response = try await api.checkouts(activeOnly: false, search: query, limit: pageSize, offset: offset)
            return SearchPage(bookings: response.data, total: response.total, nextOffset: response.offset + response.data.count)
        case .people:
            let response = try await api.users(search: query, limit: pageSize, offset: offset)
            return SearchPage(users: response.data, total: response.total, nextOffset: response.offset + response.data.count)
        case .kits:
            let response = try await api.kitList(search: query, locationId: nil, includeArchived: false, limit: pageSize, offset: offset)
            return SearchPage(kits: response.data, total: response.total, nextOffset: offset + response.data.count)
        case .events:
            // Upcoming and in-progress events only: the list is ordered by
            // start time, so including the past would bury what is next.
            let response = try await api.searchCalendarEvents(query: query, limit: pageSize, offset: offset)
            return SearchPage(events: response.data, total: response.total, nextOffset: offset + response.data.count)
        case .guides:
            // `/api/resources` has no paging, so the first fetch returns every
            // match; slice it here to keep the section the same size as the rest.
            let all = try await api.guides(search: query)
            let slice = Array(all.dropFirst(offset).prefix(pageSize))
            return SearchPage(guides: slice, total: all.count, nextOffset: offset + slice.count)
        }
    }

    private static func isSearchVisibleAsset(_ asset: Asset) -> Bool {
        !isHiddenAttachmentCategory(asset.category?.name)
    }

    private static func isSearchVisibleFamily(_ family: AssetFamilySearchResult) -> Bool {
        !isHiddenAttachmentCategory(family.category)
    }

    private static func isHiddenAttachmentCategory(_ title: String?) -> Bool {
        let normalized = title?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard let normalized, !normalized.isEmpty else { return false }
        return normalized == "accessories"
            || normalized == "camera accessories"
            || normalized.hasSuffix("/accessories")
            || normalized.hasSuffix("/camera accessories")
    }
}
