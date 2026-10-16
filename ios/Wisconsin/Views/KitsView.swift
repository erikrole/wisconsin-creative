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
    var searchText = ""
    var includeArchived = false

    let locationId: String?

    private var loadID = UUID()
    private let pageSize = 50

    init(locationId: String?) {
        self.locationId = locationId
    }

    var hasMore: Bool { kits.count < total }

    func load(reset: Bool) async {
        let requestID = UUID()
        loadID = requestID
        if reset {
            if kits.isEmpty { isLoading = true }
            error = nil
        } else {
            guard hasMore, !isLoadingMore else { return }
            isLoadingMore = true
        }

        let offset = reset ? 0 : kits.count
        do {
            let page = try await APIClient.shared.kitList(
                search: searchText,
                locationId: locationId,
                includeArchived: includeArchived,
                limit: pageSize,
                offset: offset
            )
            guard loadID == requestID else { return }
            if reset {
                kits = page.data
            } else {
                let seen = Set(kits.map(\.id))
                kits.append(contentsOf: page.data.filter { !seen.contains($0.id) })
            }
            total = page.total
            summary = page.summary
            error = nil
        } catch {
            guard loadID == requestID else { return }
            self.error = error.localizedDescription
        }
        guard loadID == requestID else { return }
        isLoading = false
        isLoadingMore = false
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
                        .disabled(vm.isLoadingMore)
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

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(kit.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(kit.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            StatusPill(label: kit.shelf.label, tone: kit.shelf.tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kit.name), \(kit.subtitle), \(kit.shelf.label)")
    }
}
