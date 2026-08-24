import SwiftUI

/// Hashable wrapper so navigation can distinguish a "go to booking detail"
/// route from arbitrary String values pushed onto the path.
struct BookingRouteId: Hashable {
    let id: String
}

/// Hashable wrapper so navigation can distinguish a "go to asset detail"
/// route from arbitrary String values pushed onto the path. Used by the
/// notifications sheet to route damage / lost / low-stock notifications
/// to the right asset.
struct AssetRouteId: Hashable {
    let id: String
}

@MainActor
@Observable
final class ItemsViewModel {
    enum SortOption: String, CaseIterable, Identifiable {
        case popular = "popular"
        case assetTag = "assetTag"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .popular: "Most popular"
            case .assetTag: "Asset tag"
            }
        }
    }

    var rows: [ItemListRow] = []
    var isLoading = false
    var error: String?
    var pageError: String?
    var searchText = ""
    var selectedStatuses: Set<AssetComputedStatus> = []
    var favoritesOnly = false
    var sortOption: SortOption = .popular
    var hasMore = true

    /// How many toolbar controls are away from their resting state. Drives the
    /// badge on the toolbar and whether the list owes the user a summary line.
    var activeControlCount: Int {
        (favoritesOnly ? 1 : 0)
            + (selectedStatuses.isEmpty ? 0 : 1)
            + (sortOption == .popular ? 0 : 1)
    }

    /// Names what the list is actually showing, in the order the toolbar reads.
    /// Sort only appears once it is off the default, because Most popular is
    /// what an unqualified list of gear already looks like.
    var activeControlSummary: String {
        var parts: [String] = []
        if favoritesOnly { parts.append("Favorites") }
        if !selectedStatuses.isEmpty {
            let ordered = AssetComputedStatus.filterOrder.filter(selectedStatuses.contains)
            parts.append(ordered.count <= 2
                ? ordered.map(\.label).joined(separator: ", ")
                : "\(ordered.count) statuses")
        }
        if sortOption != .popular { parts.append(sortOption.label) }
        return parts.joined(separator: " · ")
    }

    private var offset = 0
    private let limit = 30
    private var searchTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?
    private var loadRequests = LatestRequestGeneration()

    func load(reset: Bool = false) async {
        if reset {
            // Filter / search change: cancel in-flight load so the new query wins.
            loadTask?.cancel()
        } else if isLoading {
            return
        }
        let requestToken = loadRequests.begin()
        let task = Task { await performLoad(reset: reset, requestToken: requestToken) }
        loadTask = task
        await task.value
    }

    private func performLoad(reset: Bool, requestToken: UUID) async {
        if reset {
            offset = 0
            hasMore = true
            pageError = nil
        }
        isLoading = true
        if reset { error = nil }
        defer {
            if loadRequests.owns(requestToken) { isLoading = false }
        }
        do {
            let result = try await APIClient.shared.assets(
                search: searchText.isEmpty ? nil : searchText,
                statuses: selectedStatuses,
                sort: sortOption.rawValue,
                favoritesOnly: favoritesOnly,
                limit: limit,
                offset: offset
            )
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            let resultRows = result.orderedRows
            if reset { rows = resultRows } else { rows += resultRows }
            offset += resultRows.count
            hasMore = offset < result.total
            pageError = nil
            if reset && offset == resultRows.count && searchText.isEmpty && selectedStatuses.isEmpty && !favoritesOnly {
                GearStore.shared.seedAssets(result.data)
            }
        } catch is CancellationError {
            // Superseded by a newer load.
        } catch {
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            if reset {
                self.error = itemListErrorMessage(error)
            } else {
                self.pageError = itemListErrorMessage(error, loadingMore: true)
                hasMore = false
            }
        }
    }

    func retryPage() async {
        pageError = nil
        hasMore = true
        await load()
    }

    func onSearchChange() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await load(reset: true)
        }
    }

    /// Returns the three toolbar controls to their defaults, leaving the search
    /// text alone -- the summary bar this backs sits below the search field and
    /// only ever describes the controls, so clearing a typed query too would
    /// undo something the bar never claimed to own.
    func resetFilters() {
        selectedStatuses = []
        favoritesOnly = false
        sortOption = .popular
    }

    func resetDefaults() {
        searchTask?.cancel()
        loadTask?.cancel()
        loadRequests.invalidate()
        searchText = ""
        selectedStatuses = []
        favoritesOnly = false
        sortOption = .popular
        rows = []
        offset = 0
        hasMore = true
        error = nil
        pageError = nil
        isLoading = false
    }

    func toggleFavorite(_ asset: Asset) async throws {
        let optimistic = !asset.isFavorited
        applyFavorite(assetId: asset.id, value: optimistic)
        do {
            let newState = try await APIClient.shared.toggleFavorite(assetId: asset.id)
            applyFavorite(assetId: asset.id, value: newState)
            if favoritesOnly && !newState {
                rows.removeAll { row in
                    if case .asset(let item) = row {
                        return item.id == asset.id
                    }
                    return false
                }
            }
        } catch {
            applyFavorite(assetId: asset.id, value: asset.isFavorited)
            throw error
        }
    }

    private func applyFavorite(assetId: String, value: Bool) {
        rows = rows.map { row in
            guard case .asset(let asset) = row, asset.id == assetId else { return row }
            return .asset(asset.withFavorited(value))
        }
    }

    private func itemListErrorMessage(_ error: Error, loadingMore: Bool = false) -> String {
        let fallback = loadingMore
            ? "Couldn't load more items. Check your connection and try again."
            : "Couldn't load items. Check your connection and try again."

        if let apiError = error as? APIError {
            return apiError.errorDescription ?? fallback
        }
        if error is DecodingError {
            return "Items could not be read. Refresh and try again."
        }
        if let urlError = error as? URLError {
            return APIError.networkError(urlError).errorDescription ?? fallback
        }
        return fallback
    }
}

struct ItemsView: View {
    var wrapsInNavigationStack = true

    @State private var vm = ItemsViewModel()
    @State private var navigationPath = NavigationPath()
    @State private var toast: Toast?
    @Environment(AppState.self) private var appState
    @Environment(ReservationDraftStore.self) private var drafts

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack(path: $navigationPath) {
                configuredContent
            }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        contentBody
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Items")
            .searchable(
                text: $vm.searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("Search tag, model, serial, location")
            )
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        vm.favoritesOnly.toggle()
                        Task { await vm.load(reset: true) }
                    } label: {
                        Label("Favorites", systemImage: vm.favoritesOnly ? "star.fill" : "star")
                    }
                    .listControlTint(isActive: vm.favoritesOnly)
                    .accessibilityLabel(vm.favoritesOnly ? "Favorites on" : "Favorites off")
                    .sensoryFeedback(.selection, trigger: vm.favoritesOnly)

                    AssetStatusFilterMenu(selected: $vm.selectedStatuses) {
                        Task { await vm.load(reset: true) }
                    }

                    ItemSortMenu(selected: $vm.sortOption) {
                        Task { await vm.load(reset: true) }
                    }
                }
            }
            .onChange(of: vm.searchText) { vm.onSearchChange() }
            .refreshable { await vm.load(reset: true) }
            .task { await vm.load(reset: true) }
            .toast($toast)
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 2 else { return }
                navigationPath = NavigationPath()
                vm.resetDefaults()
                Task { await vm.load(reset: true) }
            }
            .navigationDestination(for: Asset.self) { asset in
                ItemDetailView(assetId: asset.id)
            }
            .navigationDestination(for: BookingRouteId.self) { route in
                BookingDetailView(bookingId: route.id)
            }
    }

    /// Reserve from a row hands the item to the app-level composer, so the user
    /// keeps the items list underneath and can go on browsing.
    private func startReservation(for asset: Asset) {
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillReservation(for: asset)
            return composer
        }())
    }

    private func startReservation(forFamily family: AssetFamilySearchResult) {
        drafts.start({
            let composer = CreateBookingViewModel()
            composer.prefillReservation(forFamily: family)
            return composer
        }())
    }

    private var contentBody: some View {
        Group {
                if let error = vm.error, vm.rows.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn't load items", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await vm.load(reset: true) } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if vm.rows.isEmpty && vm.isLoading {
                    List {
                        ForEach(0..<10, id: \.self) { _ in
                            ItemRowSkeleton()
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                                .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color(.systemGroupedBackground))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)  // Don't pollute VO with placeholder shapes during initial load.
                } else if vm.rows.isEmpty {
                    ContentUnavailableView {
                        Label(
                            vm.favoritesOnly ? "No Favorites" : "No Items",
                            systemImage: vm.favoritesOnly ? "star" : "archivebox"
                        )
                    } description: {
                        Text(vm.searchText.isEmpty
                            ? (vm.favoritesOnly ? "Star items to add them here." : "No gear found.")
                            : "No results for \"\(vm.searchText)\".")
                    } actions: {
                        emptyStateActions
                    }
                } else {
                    List {
                        // Rides in the list rather than a top safe-area inset:
                        // an inset that appears and disappears makes the
                        // navigation bar drop the large "Items" title, and
                        // Schedule already states its active filters in content
                        // for the same reason.
                        if vm.activeControlCount > 0 {
                            ActiveControlBar(summary: vm.activeControlSummary) {
                                vm.resetFilters()
                                Task { await vm.load(reset: true) }
                            }
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
                        }
                        ForEach(vm.rows) { row in
                            itemRow(row)
                        }
                        if let pageError = vm.pageError {
                            VStack(spacing: 8) {
                                Text(pageError)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                Button("Retry") { Task { await vm.retryPage() } }
                                    .buttonStyle(.bordered)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                        } else if vm.hasMore {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                                .task(id: vm.rows.count) { await vm.load() }
                        } else if vm.rows.count > 10 {
                            Text("End of list")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 12)
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .contentMargins(.bottom, 96, for: .scrollContent)
                    .background(Color(.systemGroupedBackground))
                }
        }
    }

    @ViewBuilder
    private func itemRow(_ row: ItemListRow) -> some View {
        switch row {
        case .asset(let asset):
            ZStack {
                NavigationLink(value: asset) { EmptyView() }.opacity(0)
                AssetRow(asset: asset)
            }
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button {
                    Task { await toggleFavorite(asset) }
                } label: {
                    Label(
                        asset.isFavorited ? "Unfavorite" : "Favorite",
                        systemImage: asset.isFavorited ? "star.slash" : "star"
                    )
                }
                // Shared marker accent, not a status tone -- see Brand.marker.
                .tint(Color.marker)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if asset.computedStatus != .retired {
                    Button {
                        startReservation(for: asset)
                    } label: {
                        Label("Reserve", systemImage: "plus.circle")
                    }
                    .tint(.accentColor)
                }
            }
            .contextMenu {
                Button {
                    Task { await toggleFavorite(asset) }
                } label: {
                    Label(
                        asset.isFavorited ? "Unfavorite" : "Favorite",
                        systemImage: asset.isFavorited ? "star.slash" : "star"
                    )
                }

                if asset.computedStatus != .retired {
                    Button {
                        startReservation(for: asset)
                    } label: {
                        Label("Reserve", systemImage: "plus.circle")
                    }
                }

                if let tag = asset.assetTag {
                    Button {
                        UIPasteboard.general.string = tag
                    } label: {
                        Label("Copy Asset Tag", systemImage: "doc.on.doc")
                    }
                }
            }
        case .family(let family):
            ItemFamilyListRow(family: family)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button {
                        startReservation(forFamily: family)
                    } label: {
                        Label("Reserve", systemImage: "plus.circle")
                    }
                    .tint(.accentColor)
                }
                .contextMenu {
                    Button {
                        startReservation(forFamily: family)
                    } label: {
                        Label("Reserve", systemImage: "plus.circle")
                    }
                }
        }
    }

    private func toggleFavorite(_ asset: Asset) async {
        do {
            try await vm.toggleFavorite(asset)
        } catch {
            toast = Toast(message: "Couldn't update favorite", icon: "exclamationmark.triangle.fill", role: .error)
        }
    }

    @ViewBuilder
    private var emptyStateActions: some View {
        if !vm.searchText.isEmpty {
            Button {
                vm.searchText = ""
                Task { await vm.load(reset: true) }
            } label: {
                Label("Clear search", systemImage: "xmark.circle")
            }
            .buttonStyle(.borderedProminent)
        } else if vm.favoritesOnly {
            Button {
                vm.favoritesOnly = false
                Task { await vm.load(reset: true) }
            } label: {
                Label("Show all items", systemImage: "archivebox")
            }
            .buttonStyle(.borderedProminent)
        }
    }

}


struct AssetRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let asset: Asset

    private var tone: StatusTone { assetStatusTone(asset) }

    private var metadataLine: String {
        asset.location.name
    }

    private var shouldShowLocation: Bool {
        asset.computedStatus == .available
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibilityRow
            } else {
                compactRow
            }
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.card)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
        .accessibilityHint("Double-tap to view item details")
    }

    private var compactRow: some View {
        HStack(spacing: 12) {
            StatusRail(tone: tone)
            AssetThumbnail(imageUrl: asset.imageUrl, size: 44)
                .accessibilityHidden(true)
            assetCopy(lineLimit: 1)
                .layoutPriority(1)
            Spacer()
            AssetListBadge(asset: asset, tone: tone)
            disclosureIndicator
        }
    }

    private var accessibilityRow: some View {
        HStack(alignment: .top, spacing: 12) {
            StatusRail(tone: tone)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    AssetThumbnail(imageUrl: asset.imageUrl, size: 44)
                        .accessibilityHidden(true)
                    assetCopy(lineLimit: nil)
                    Spacer(minLength: 4)
                    disclosureIndicator
                }
                AssetListBadge(asset: asset, tone: tone)
            }
        }
    }

    private func assetCopy(lineLimit: Int?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(asset.itemListPrimaryTitle)
                .font(.gothamBold(size: 17))
                .lineLimit(lineLimit)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle = asset.itemListSecondaryTitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(lineLimit)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if shouldShowLocation {
                Text(metadataLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .truncationMode(.tail)
                    .lineLimit(lineLimit)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var disclosureIndicator: some View {
        Image(systemName: "chevron.right")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }

    /// Single combined VoiceOver readout. Surfaces overdue state first when
    /// applicable so VO users hear the most important fact in time-pressure
    /// scrolling. Mirrors today's BookingsView + HomeView row patterns.
    private var rowAccessibilityLabel: String {
        var parts: [String] = []

        let isOverdue = asset.computedStatus == .checkedOut && asset.activeBooking?.isOverdue == true
        if isOverdue { parts.append("Overdue") }

        parts.append(asset.itemListPrimaryTitle)
        if let subtitle = asset.itemListSecondaryTitle { parts.append(subtitle) }

        if shouldShowLocation {
            parts.append(asset.location.name)
        }

        // Status + due/overdue: speak who has it (when applicable) + status label.
        if let name = asset.activeBooking?.requesterName,
           asset.computedStatus == .checkedOut || asset.computedStatus == .pendingPickup || asset.computedStatus == .reserved {
            let activeLabel = isOverdue ? "overdue" : asset.computedStatus.label.lowercased()
            parts.append("\(activeLabel) by \(name)")
        } else {
            parts.append(asset.computedStatus.label)
        }

        // Due/overdue label, if active checkout has one.
        if asset.computedStatus == .checkedOut, let booking = asset.activeBooking {
            let days = Int((booking.endsAt.timeIntervalSinceNow / 86_400).rounded())
            if booking.isOverdue {
                let n = max(1, abs(days))
                parts.append("\(n) day\(n == 1 ? "" : "s") overdue")
            } else if days <= 0 {
                parts.append("due today")
            } else if days < 14 {
                parts.append("due in \(days) day\(days == 1 ? "" : "s")")
            }
        }
        return parts.joined(separator: ", ")
    }
}

struct ItemFamilyListRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let family: AssetFamilySearchResult

    private var metadataLine: String {
        family.locationName
    }

    private var shouldShowLocation: Bool {
        family.availableQuantity > 0
    }

    var body: some View {
        let tone: StatusTone = .green

        Group {
            if dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: 12) {
                    StatusRail(tone: tone)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 10) {
                            SearchBulkThumbnail(imageUrl: family.imageUrl, size: 44)
                                .accessibilityHidden(true)
                            familyCopy(lineLimit: nil)
                        }
                        availabilityBadge(tone: tone, expands: true)
                    }
                }
            } else {
                HStack(spacing: 12) {
                    StatusRail(tone: tone)
                    SearchBulkThumbnail(imageUrl: family.imageUrl, size: 44)
                        .accessibilityHidden(true)
                    familyCopy(lineLimit: 1)
                        .layoutPriority(1)
                    Spacer()
                    availabilityBadge(tone: tone, expands: false)
                }
            }
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.card)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
        .accessibilityHint("Swipe or open the context menu to reserve")
    }

    private func familyCopy(lineLimit: Int?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(family.name)
                .font(.gothamBold(size: 17))
                .lineLimit(lineLimit)
                .fixedSize(horizontal: false, vertical: true)
            if shouldShowLocation {
                Text(metadataLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .truncationMode(.tail)
                    .lineLimit(lineLimit)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func availabilityBadge(tone: StatusTone, expands: Bool) -> some View {
        Text(family.listAvailabilityLabel)
            .font(.caption2.weight(.semibold))
            .lineLimit(expands ? nil : 1)
            .fixedSize(horizontal: !expands, vertical: true)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.statusBackground(tone), in: Capsule())
            .foregroundStyle(Color.statusText(tone))
            .frame(maxWidth: expands ? .infinity : 140, alignment: expands ? .leading : .trailing)
            .accessibilityHidden(true)
    }

    private var rowAccessibilityLabel: String {
        var parts = [family.name]
        if shouldShowLocation {
            parts.append(family.locationName)
        }
        parts.append(family.listAvailabilityLabel)
        return parts.joined(separator: ", ")
    }
}

/// Maps an asset's computed status (with overdue override) to a cross-app
/// `StatusTone`. Shared by the row's leading `StatusRail` and its trailing
/// badge so both speak the same color.
func assetStatusTone(_ asset: Asset) -> StatusTone {
    if asset.computedStatus == .checkedOut, asset.activeBooking?.isOverdue == true {
        return .red
    }
    switch asset.computedStatus {
    case .available:   return .green
    case .checkedOut:  return .blue
    case .pendingPickup: return .orange
    case .reserved:    return .purple
    case .maintenance: return .orange
    case .retired:     return .gray
    case .unknown:     return .gray
    }
}

private struct AssetListBadge: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let asset: Asset
    let tone: StatusTone

    private var badgeText: String {
        if showsHolderAvatar, let booking = asset.activeBooking {
            return booking.requesterName
        }
        return asset.computedStatus.label
    }

    private var showsHolderAvatar: Bool {
        asset.activeBooking != nil &&
            (asset.computedStatus == .checkedOut || asset.computedStatus == .pendingPickup || asset.computedStatus == .reserved)
    }

    var body: some View {
        HStack(spacing: 5) {
            if showsHolderAvatar, let booking = asset.activeBooking {
                UserAvatarView(
                    name: booking.requesterName,
                    avatarUrl: booking.requesterAvatarUrl,
                    size: 18,
                    fallbackBackground: Color.statusBackground(tone),
                    fallbackForeground: Color.statusText(tone),
                    showsBorder: false
                )
            }
            Text(badgeText)
                .font(.caption2.weight(.semibold))
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: true)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Color.statusBackground(tone), in: Capsule())
        .foregroundStyle(Color.statusText(tone))
        .frame(
            maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 140,
            alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing
        )
        .accessibilityHidden(true)  // Status surfaced via the combined row label in AssetRow.
    }
}

struct AssetThumbnail: View {
    let imageUrl: String?
    let size: CGFloat

    var body: some View {
        Group {
            if let urlString = imageUrl, let url = URL(string: urlString) {
                CachedThumbnail(url: url, size: size)
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius)
                .strokeBorder(Color(.separator), lineWidth: 1)
        )
    }

    private var cornerRadius: CGFloat { max(6, size * 0.18) }

    private var placeholder: some View {
        Image(systemName: "bag")
            .font(.system(size: size * 0.36))
            .foregroundStyle(Color(.systemGray3))
    }
}

struct AssetStatusBadge: View {
    let status: AssetComputedStatus

    var body: some View {
        Text(status.label)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.statusBackground(tone), in: Capsule())
            .foregroundStyle(Color.statusText(tone))
    }

    private var tone: StatusTone {
        switch status {
        case .available:   return .green
        case .checkedOut:  return .blue
        case .pendingPickup: return .orange
        case .reserved:    return .purple
        case .maintenance: return .orange
        case .retired:     return .gray
        case .unknown:     return .gray
        }
    }
}

/// Names what the toolbar has done to the list, with the one control that undoes
/// it. Three glyph-only toolbar buttons can say *that* they are engaged, but not
/// *what* they did -- the sort control in particular changed the list's order
/// with nothing on screen to show for it.
struct AssetStatusFilterMenu: View {
    @Binding var selected: Set<AssetComputedStatus>
    let onSelect: () -> Void

    private var statuses: [AssetComputedStatus] { AssetComputedStatus.filterOrder }

    var body: some View {
        Menu {
            Button {
                if !selected.isEmpty {
                    selected = []
                    onSelect()
                }
            } label: {
                HStack {
                    Text("All")
                    if selected.isEmpty { Image(systemName: "checkmark") }
                }
            }
            Divider()
            ForEach(statuses, id: \.self) { status in
                Button {
                    if selected.contains(status) {
                        selected.remove(status)
                    } else {
                        selected.insert(status)
                    }
                    onSelect()
                } label: {
                    HStack {
                        Text(status.label)
                        if selected.contains(status) { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            Label(
                statusFilterTitle,
                systemImage: "line.3.horizontal.decrease.circle\(selected.isEmpty ? "" : ".fill")"
            )
        }
        .listControlTint(isActive: !selected.isEmpty)
        .accessibilityLabel(selected.isEmpty ? "Filter by status" : "Filtering by \(selected.count) statuses")
    }

    private var statusFilterTitle: String {
        selected.isEmpty ? "All statuses" : "\(selected.count) statuses"
    }
}

struct ItemSortMenu: View {
    @Binding var selected: ItemsViewModel.SortOption
    let onSelect: () -> Void

    var body: some View {
        Menu {
            ForEach(ItemsViewModel.SortOption.allCases) { option in
                Button {
                    guard selected != option else { return }
                    selected = option
                    onSelect()
                } label: {
                    HStack {
                        Text(option.label)
                        if selected == option { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            // The filled circle is the only thing that ever said this control
            // had been touched -- a bare up/down arrow looks identical whether
            // the list is in its default order or not.
            Label(
                selected.label,
                systemImage: isDefault ? "arrow.up.arrow.down" : "arrow.up.arrow.down.circle.fill"
            )
        }
        .listControlTint(isActive: !isDefault)
        .accessibilityLabel("Sort items by \(selected.label)")
    }

    private var isDefault: Bool { selected == .popular }
}
