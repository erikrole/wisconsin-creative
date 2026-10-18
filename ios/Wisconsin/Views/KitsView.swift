import SwiftUI

@MainActor
@Observable
final class KitsViewModel {
    var kits: [KitListItem] = []
    var total = 0
    var summary: KitListSummary?
    var isLoading = false
    var isLoadingMore = false
    var error: String?
    var searchText = "" { didSet { if searchText != oldValue { queryChanged() } } }
    var includeArchived = false { didSet { if includeArchived != oldValue { queryChanged() } } }

    let locationId: String?

    private var loadID = UUID()
    private let pageSize = 50
    private var nextOffset = 0
    private var loadedQuery: String?
    private var exhausted = false
    private var queryKey: String { "\(searchText)|\(includeArchived)" }

    init(locationId: String?) {
        self.locationId = locationId
    }

    var hasMore: Bool { loadedQuery == queryKey && !exhausted && nextOffset < total }

    private func queryChanged() {
        loadID = UUID()
        isLoading = false
        isLoadingMore = false
        error = nil
    }

    func load(reset: Bool) async {
        if !reset { guard hasMore, !isLoading, !isLoadingMore else { return } }
        let requestID = UUID()
        let requestQuery = queryKey
        let requestSearch = searchText
        let requestArchived = includeArchived
        loadID = requestID
        if reset {
            isLoading = true
            isLoadingMore = false
            error = nil
        } else {
            isLoadingMore = true
        }
        defer {
            if loadID == requestID {
                isLoading = false
                isLoadingMore = false
            }
        }
        let offset = reset ? 0 : nextOffset
        do {
            let page = try await APIClient.shared.kitList(
                search: requestSearch,
                locationId: locationId,
                includeArchived: requestArchived,
                limit: pageSize,
                offset: offset
            )
            guard loadID == requestID, requestQuery == queryKey, !Task.isCancelled else { return }
            if reset {
                kits = page.data
            } else {
                let seen = Set(kits.map(\.id))
                kits.append(contentsOf: page.data.filter { !seen.contains($0.id) })
            }
            loadedQuery = requestQuery
            nextOffset = offset + page.data.count
            exhausted = page.data.isEmpty
            total = page.total
            summary = page.summary
            error = nil
        } catch {
            guard loadID == requestID, requestQuery == queryKey, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

struct KitsView: View {
    var locationName: String? = nil
    var wrapsInNavigationStack = true

    @State private var vm: KitsViewModel
    @State private var searchTask: Task<Void, Never>?
    @Environment(SessionStore.self) private var session

    init(locationId: String? = nil, locationName: String? = nil, wrapsInNavigationStack: Bool = true) {
        self.locationName = locationName
        self.wrapsInNavigationStack = wrapsInNavigationStack
        _vm = State(initialValue: KitsViewModel(locationId: locationId))
    }

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack { configuredContent }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        content
            .navigationTitle("Kits")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $vm.searchText, prompt: "Search kits")
            .toolbar {
                if isStaffOrAdmin {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            vm.includeArchived.toggle()
                            Task { await vm.load(reset: true) }
                        } label: {
                            Label("Archived", systemImage: vm.includeArchived ? "archivebox.fill" : "archivebox")
                        }
                        .listControlTint(isActive: vm.includeArchived)
                        .accessibilityLabel(vm.includeArchived ? "Showing archived kits" : "Show archived kits")
                    }
                }
            }
            .onChange(of: vm.searchText) { _, _ in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    await vm.load(reset: true)
                }
            }
            .onDisappear { searchTask?.cancel() }
            .refreshable { await vm.load(reset: true) }
            .task { await vm.load(reset: true) }
            .navigationDestination(for: KitRoute.self) { route in
                KitDetailView(kitId: route.id)
            }
    }

    @ViewBuilder
    private var content: some View {
        if vm.isLoading && vm.kits.isEmpty {
            ProgressView("Loading kits")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = vm.error, vm.kits.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load kits", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load(reset: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.kits.isEmpty {
            ContentUnavailableView {
                Label(vm.searchText.isEmpty && !vm.includeArchived ? "No kits yet" : "No kits match", systemImage: "square.stack.3d.up")
            } description: {
                Text(emptyDescription)
            } actions: {
                if !vm.searchText.isEmpty || vm.includeArchived {
                    Button("Clear search") {
                        vm.searchText = ""
                        vm.includeArchived = false
                        Task { await vm.load(reset: true) }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        } else {
            List {
                if let error = vm.error {
                    Section {
                        Text(error)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Retry") { Task { await vm.load(reset: true) } }
                    }
                }
                Section {
                    ForEach(vm.kits) { kit in
                        NavigationLink(value: KitRoute(id: kit.id)) {
                            KitListRow(kit: kit)
                        }
                    }
                    if vm.hasMore {
                        Button {
                            Task { await vm.load(reset: false) }
                        } label: {
                            if vm.isLoadingMore {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Show more kits")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .disabled(vm.isLoading || vm.isLoadingMore)
                    }
                } header: {
                    if let summary = vm.summary, vm.searchText.isEmpty {
                        Text(summaryLine(summary))
                    }
                } footer: {
                    if let locationName {
                        Text("Kits at \(locationName).")
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private var emptyDescription: String {
        if let locationName, vm.searchText.isEmpty {
            return "No kits at \(locationName)."
        }
        if vm.searchText.isEmpty && !vm.includeArchived {
            return "Gameday kits are created on the web."
        }
        return "Try a different search."
    }

    private func summaryLine(_ summary: KitListSummary) -> String {
        var parts = ["\(summary.active) active"]
        if summary.empty > 0 { parts.append("\(summary.empty) empty") }
        if vm.includeArchived, summary.archived > 0 { parts.append("\(summary.archived) archived") }
        return parts.joined(separator: " · ")
    }
}

private struct KitListRow: View {
    let kit: KitListItem
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        layout {
            VStack(alignment: .leading, spacing: 3) {
                Text(kit.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(kit.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
            StatusPill(label: kit.shelf.label, tone: kit.shelf.tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kit.name), \(kit.subtitle), \(kit.shelf.label)")
    }
}
