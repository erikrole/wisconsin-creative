import SwiftUI

// Navigation destination enum for the search sheet
enum SearchDestination: Hashable {
    case asset(String)
    case booking(String)
    case user(String)
    case kit(String)
    case event(String)
    case guide(String)
}

/// Narrows the result list to one of the sources `SearchService` already
/// fans out to. Filtering is display-only: the four requests still run, so
/// switching chips never refetches and the counts on the chips stay honest.
enum SearchScope: String, CaseIterable, Identifiable {
    case all, gear, kits, reservations, checkouts, people, events, guides

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .gear: "Gear"
        case .kits: "Kits"
        case .events: "Events"
        case .guides: "Guides"
        case .reservations: "Reservations"
        case .checkouts: "Check-outs"
        case .people: "People"
        }
    }

    var source: SearchSource? {
        switch self {
        case .all: nil
        case .gear: .items
        case .kits: .kits
        case .events: .events
        case .guides: .guides
        case .reservations: .reservations
        case .checkouts: .checkouts
        case .people: .people
        }
    }
}

enum SearchRecentsStorage {
    private static let key = "recentSearches"

    static func load() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    static func save(_ searches: [String]) {
        UserDefaults.standard.set(searches, forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

struct GlobalSearchSheet: View {
    var showsCancelButton = true
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session
    @Environment(ReservationDraftStore.self) private var drafts

    /// Same composer prefill the Items list uses. The search sheet dismisses
    /// first so the reservation opens over the app rather than behind a modal
    /// the user then has to close.
    private func startReservation(for asset: Asset) {
        dismiss()
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillReservation(for: asset)
            return composer
        }())
    }

    private func startReservation(forFamily family: AssetFamilySearchResult) {
        dismiss()
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillReservation(forFamily: family)
            return composer
        }())
    }
    @State private var query = ""
    @State private var results = SearchResults()
    @State private var isSearching = false
    @State private var searchError: String?
    @State private var showScanner = false
    @State private var isSearchPresented = false
    @State private var debounceTask: Task<Void, Never>?
    @State private var navigationPath = NavigationPath()
    @State private var pendingScannerDestination: SearchDestination?
    @State private var suppressNextQuerySearch = false
    @State private var loadingMoreSource: SearchSource?
    @State private var loadMoreErrors: [SearchSource: String] = [:]

    @State private var recentSearches = SearchRecentsStorage.load()
    @State private var scope: SearchScope = .all

    var body: some View {
        NavigationStack(path: $navigationPath) {
            VStack(spacing: 0) {
                if !trimmedQuery.isEmpty, !isCollaborator, results.hasKnownMatches {
                    scopeStrip
                }
                Group {
                    if trimmedQuery.isEmpty {
                        recentsView
                    } else if isSearching && results.isEmpty {
                        searchingView
                    } else if results.hasKnownMatches || results.partialResultNotice != nil {
                        // Also when empty-but-partial: "no matches" would be a
                        // lie if the sources that could have matched never
                        // answered.
                        resultsList
                    } else if let searchError, !isSearching {
                        errorView(message: searchError)
                    } else if !isSearching {
                        noResultsView
                    }
                }
            }
            .frame(maxHeight: .infinity)
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $query,
                isPresented: $isSearchPresented,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(isCollaborator ? "Search reservable gear" : "Search gear, kits, events, people")
            )
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onSubmit(of: .search) { commitSearch() }
            .toolbar {
                if showsCancelButton {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
                if !isCollaborator {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            presentScanner()
                        } label: {
                            Label("Scan QR code", systemImage: "qrcode.viewfinder")
                        }
                    }
                }
            }
            .navigationDestination(for: SearchDestination.self) { destination in
                switch destination {
                case .asset(let id):
                    ItemDetailView(assetId: id)
                case .booking(let id):
                    BookingDetailView(bookingId: id)
                case .user(let id):
                    UserDetailView(userId: id)
                case .kit(let id):
                    KitDetailView(kitId: id)
                case .event(let id):
                    if let event = results.events.first(where: { $0.id == id }) {
                        EventDetailView(event: event, myShifts: [])
                    } else {
                        ContentUnavailableView("Event unavailable", systemImage: "calendar.badge.exclamationmark")
                    }
                case .guide(let id):
                    if let guide = results.guides.first(where: { $0.id == id }) {
                        GuideReaderView(guide: guide)
                    } else {
                        ContentUnavailableView("Guide unavailable", systemImage: "book")
                    }
                }
            }
            .navigationDestination(for: BulkSkuRoute.self) { route in
                BulkInventoryDetailView(skuId: route.id)
            }
        }
        .fullScreenCover(isPresented: $showScanner, onDismiss: {
            if let destination = pendingScannerDestination {
                pendingScannerDestination = nil
                navigationPath.append(destination)
            }
        }) {
            QRScannerSheet { match in
                switch match {
                case .asset(let assetId):
                    pendingScannerDestination = .asset(assetId)
                case .itemFamily(let family):
                    scope = .gear
                    suppressNextQuerySearch = true
                    query = family.name
                    results = SearchResults(itemFamilies: [family])
                }
                showScanner = false
            }
        }
        .onChange(of: query) { _, newValue in
            scheduleSearch(query: newValue)
        }
        // Typed for the capture scenario rather than seeded as an initial
        // value, so the debounce and the result path run exactly as they do
        // for a real query.
        .onAppear {
            guard let seeded = AppRuntimeMode.CaptureSeed.searchQuery, query.isEmpty else { return }
            query = seeded
#if DEBUG
            // Lets a capture land on one scope without a tap.
            if let raw = ProcessInfo.processInfo.environment["GT_SEARCH_SCOPE"],
               let seededScope = SearchScope(rawValue: raw) {
                scope = seededScope
            }
#endif
            // Let the debounce and the four searches finish, then drop focus so
            // the keyboard stops covering the destinations this capture is of.
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                isSearchPresented = false
            }
        }
        .onChange(of: appState.pendingAppIntentDestination) { _, _ in
            consumePendingAppIntent()
        }
        .task {
            consumePendingAppIntent()
            await Task.yield()
            isSearchPresented = true
        }
    }

    private func consumePendingAppIntent() {
        if appState.consumeAppIntentDestination(.scan) {
            isSearchPresented = false
            showScanner = true
        }
    }

    private func presentScanner() {
        isSearchPresented = false
        showScanner = true
    }

    // MARK: - States

    private var scannerEmptyState: some View {
        Button {
            presentScanner()
        } label: {
            Label("Scan a code", systemImage: "qrcode.viewfinder")
                .fontWeight(.semibold)
                .frame(minWidth: 180)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHint("Opens the camera scanner.")
    }

    /// What to offer before anything is typed: the two places people go most
    /// (Scan and their own gear), then their recent searches. Rows, not
    /// buttons-in-a-void, so the screen reads as a short menu instead of an
    /// empty state.
    private var recentsView: some View {
        List {
            if !isCollaborator {
                Section {
                    quickRow("Scan a code", systemImage: "qrcode.viewfinder", hint: "Opens the camera scanner.") {
                        presentScanner()
                    }
                    quickRow("My gear", systemImage: "bag", hint: "Opens your active bookings.") {
                        Haptics.selection()
                        appState.apply(.myGear)
                        dismiss()
                    }
                }
            }
            if recentSearches.isEmpty {
                Section {
                    Text(isCollaborator ? "Search reservable gear." : "Search gear, kits, events, and people.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
            } else {
                Section {
                    ForEach(recentSearches, id: \.self) { term in
                        Button {
                            Haptics.selection()
                            query = term
                        } label: {
                            Label(term, systemImage: "clock")
                                .foregroundStyle(.primary)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                removeRecent(term)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .accessibilityLabel("Recent search: \(term)")
                    }
                } header: {
                    HStack {
                        Text("Recent")
                        Spacer()
                        Button("Clear") {
                            Haptics.selection()
                            recentSearches = []
                            SearchRecentsStorage.clear()
                        }
                        .font(.caption.weight(.semibold))
                        .textCase(nil)
                        .accessibilityLabel("Clear recent searches")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.immediately)
    }

    private func quickRow(_ title: String, systemImage: String, hint: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Color.brandPrimary)
                    .frame(width: 28)
                Text(title)
                    .foregroundStyle(.primary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint(hint)
    }

    private func removeRecent(_ term: String) {
        recentSearches.removeAll { $0 == term }
        SearchRecentsStorage.save(recentSearches)
    }

    /// One chip per source, each carrying the server-backed match count so the
    /// strip doubles as a summary of where the answer is.
    private var scopeStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Brand.Space.sm) {
                ForEach(SearchScope.allCases) { option in
                    FilterChip(label: chipLabel(option), isOn: scope == option) {
                        guard scope != option else { return }
                        Haptics.selection()
                        scope = option
                    }
                }
            }
            .padding(.horizontal, Brand.Space.md)
            .padding(.vertical, Brand.Space.xs)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Result type")
    }

    private func chipLabel(_ option: SearchScope) -> String {
        guard let source = option.source else { return option.label }
        let total = results.total(for: source)
        return total > 0 ? "\(option.label) \(total)" : option.label
    }

    private func shows(_ source: SearchSource) -> Bool {
        scope.source == nil || scope.source == source
    }

    private var searchingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Searching…")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private var noResultsView: some View {
        VStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 40))
                .foregroundStyle(.quaternary)
            Text("No results for \"\(query)\"")
                .foregroundStyle(.secondary)
                .font(.subheadline)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    /// Distinct from `noResultsView` so a server failure doesn't masquerade
    /// as "no matches" — same shape as the booking-detail / dashboard
    /// recovery surfaces shipped today.
    private func errorView(message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(Color.statusText(.red))
            Text("Couldn't search")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry") {
                Task { await performSearch(query: query.trimmingCharacters(in: .whitespaces)) }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private var resultsList: some View {
        List {
            // A partial answer says so. Search asks four places at once, and
            // silently dropping one would under-report without the student
            // having any way to know the list is short.
            if let notice = results.partialResultNotice {
                Section {
                    Label(notice, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                        .accessibilityLabel("Partial results. \(notice)")
                }
            }

            if let source = scope.source, results.loadedCount(for: source) == 0 {
                Section {
                    Text("No \(scope.label.lowercased()) match \"\(trimmedQuery)\".")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
            }

            if shows(.items), !results.items.isEmpty || !results.itemFamilies.isEmpty {
                Section(header: sectionHeader("Items", source: .items)) {
                    ForEach(results.items) { asset in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.asset(asset.id))
                        } label: {
                            AssetResultRow(asset: asset)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            if let tag = asset.assetTag, !tag.isEmpty {
                                Button {
                                    UIPasteboard.general.string = tag
                                } label: {
                                    Label("Copy Asset Tag", systemImage: "doc.on.doc")
                                }
                                .tint(Color.statusText(.blue))
                            }
                        }
                        // Same menu the Items list carries, because this is the
                        // same row reached a different way — someone who
                        // learned the gesture there should not lose it here.
                        .contextMenu {
                            if asset.computedStatus != .retired {
                                Button {
                                    startReservation(for: asset)
                                } label: {
                                    Label("Reserve", systemImage: "plus.circle")
                                }
                            }
                            if let tag = asset.assetTag, !tag.isEmpty {
                                Button {
                                    UIPasteboard.general.string = tag
                                } label: {
                                    Label("Copy Asset Tag", systemImage: "doc.on.doc")
                                }
                            }
                        }
                    }
                    ForEach(results.itemFamilies) { family in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(BulkSkuRoute(id: family.id))
                        } label: {
                            ItemFamilyResultRow(family: family, showsReserveAction: false)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens this item family.")
                        .contextMenu {
                            Button {
                                rememberActiveQuery()
                                startReservation(forFamily: family)
                            } label: {
                                Label("Reserve", systemImage: "plus.circle")
                            }
                        }
                    }
                    if results.hasMore(for: .items) {
                        moreResultsRow(for: .items)
                    }
                }
            }

            if shows(.reservations), !results.reservations.isEmpty {
                Section(header: sectionHeader("Reservations", source: .reservations)) {
                    ForEach(results.reservations) { booking in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.booking(booking.id))
                        } label: {
                            BookingResultRow(booking: booking)
                        }
                        .buttonStyle(.plain)
                    }
                    if results.hasMore(for: .reservations) {
                        moreResultsRow(for: .reservations)
                    }
                }
            }

            if shows(.checkouts), !results.checkouts.isEmpty {
                Section(header: sectionHeader("Checkouts", source: .checkouts)) {
                    ForEach(results.checkouts) { booking in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.booking(booking.id))
                        } label: {
                            BookingResultRow(booking: booking)
                        }
                        .buttonStyle(.plain)
                    }
                    if results.hasMore(for: .checkouts) {
                        moreResultsRow(for: .checkouts)
                    }
                }
            }

            if shows(.people), !results.users.isEmpty {
                Section(header: sectionHeader("People", source: .people)) {
                    ForEach(results.users) { user in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.user(user.id))
                        } label: {
                            UserResultRow(user: user)
                        }
                        .buttonStyle(.plain)
                    }
                    if results.hasMore(for: .people) {
                        moreResultsRow(for: .people)
                    }
                }
            }

            if shows(.kits), !results.kits.isEmpty {
                Section(header: sectionHeader("Kits", source: .kits)) {
                    ForEach(results.kits) { kit in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.kit(kit.id))
                        } label: {
                            KitResultRow(kit: kit)
                        }
                        .buttonStyle(.plain)
                    }
                    if results.hasMore(for: .kits) {
                        moreResultsRow(for: .kits)
                    }
                }
            }

            if shows(.events), !results.events.isEmpty {
                Section(header: sectionHeader("Events", source: .events)) {
                    ForEach(results.events) { event in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.event(event.id))
                        } label: {
                            EventResultRow(event: event)
                        }
                        .buttonStyle(.plain)
                    }
                    if results.hasMore(for: .events) {
                        moreResultsRow(for: .events)
                    }
                }
            }

            if shows(.guides), !results.guides.isEmpty {
                Section(header: sectionHeader("Guides", source: .guides)) {
                    ForEach(results.guides) { guide in
                        Button {
                            rememberActiveQuery()
                            navigationPath.append(SearchDestination.guide(guide.id))
                        } label: {
                            GuideResultRow(guide: guide)
                        }
                        .buttonStyle(.plain)
                    }
                    if results.hasMore(for: .guides) {
                        moreResultsRow(for: .guides)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.immediately)
    }

    /// Section headers show the server-backed total when the first page is
    /// incomplete, so a list ending after ten rows is not mistaken for a
    /// complete answer.
    private func sectionHeader(_ title: String, source: SearchSource) -> some View {
        let loaded = results.loadedCount(for: source)
        let total = results.total(for: source)
        return HStack {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(0.3)
            Spacer()
            Text(loaded == total ? "\(total)" : "\(loaded) of \(total)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private func moreResultsRow(for source: SearchSource) -> some View {
        if results.hasMore(for: source) {
            VStack(spacing: 8) {
                Button {
                    loadMore(source)
                } label: {
                    HStack(spacing: 8) {
                        if loadingMoreSource == source {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text("Show more \(source.label.lowercased())")
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)

                if let message = loadMoreErrors[source] {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Retry") {
                        loadMore(source)
                    }
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Search logic

    private func scheduleSearch(query: String) {
        debounceTask?.cancel()
        if suppressNextQuerySearch {
            suppressNextQuerySearch = false
            return
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            results = SearchResults()
            scope = .all
            searchError = nil
            loadMoreErrors.removeAll()
            return
        }
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await performSearch(query: q)
        }
    }

    private func commitSearch() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        debounceTask?.cancel()
        Task { await performSearch(query: q) }
        addToRecents(q)
    }

    @MainActor
    private func performSearch(query: String) async {
        isSearching = true
        searchError = nil
        loadMoreErrors.removeAll()
        defer { isSearching = false }
        do {
            let outcome = try await SearchService.shared.search(query: query, gearOnly: isCollaborator)
            // Stale-write guard: if the live `query` no longer matches what
            // this request was for (user typed more characters mid-flight),
            // drop the result. Without this guard, on slow networks an older
            // "ab" response can overwrite a newer "abc" response.
            guard self.query.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            results = outcome
        } catch {
            // Same staleness guard: a stale failure doesn't blow away the
            // current results either.
            guard self.query.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            searchError = error.localizedDescription
        }
    }

    @MainActor
    private func loadMore(_ source: SearchSource) {
        guard loadingMoreSource == nil else { return }
        let q = trimmedQuery
        guard !q.isEmpty, results.hasMore(for: source) else { return }

        let offset = results.nextOffset(for: source)
        loadingMoreSource = source
        loadMoreErrors.removeValue(forKey: source)
        Task { @MainActor in
            defer { loadingMoreSource = nil }
            do {
                let page = try await SearchService.shared.loadMore(
                    query: q,
                    source: source,
                    offset: offset,
                    gearOnly: isCollaborator
                )
                guard self.query.trimmingCharacters(in: .whitespacesAndNewlines) == q else { return }
                results.apply(page, for: source, appending: true)
            } catch {
                guard self.query.trimmingCharacters(in: .whitespacesAndNewlines) == q else { return }
                loadMoreErrors[source] = error.localizedDescription
            }
        }
    }

    private var isCollaborator: Bool {
        session.currentUser?.role == "COLLABORATOR"
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func rememberActiveQuery() {
        let q = trimmedQuery
        guard !q.isEmpty else { return }
        addToRecents(q)
    }

    private func addToRecents(_ term: String) {
        var recents = recentSearches.filter { $0 != term }
        recents.insert(term, at: 0)
        recentSearches = Array(recents.prefix(10))
        SearchRecentsStorage.save(recentSearches)
    }
}
