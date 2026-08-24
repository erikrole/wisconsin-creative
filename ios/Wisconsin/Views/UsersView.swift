import SwiftUI

/// Hashable wrapper so UsersView can push to UserDetailView without colliding
/// with UserDetailView's own `String`-typed navigationDestination (which
/// routes booking IDs to BookingDetailView).
struct UserRouteId: Hashable {
    let id: String
}

@MainActor
@Observable
final class UsersViewModel {
    var users: [AppUser] = []
    var isLoading = false
    var error: String?
    var pageError: String?
    var searchText = ""
    var selectedRole: String? = nil // "ADMIN" | "STAFF" | "STUDENT" | nil
    var includeInactive = false
    var hasMore = true

    private var offset = 0
    private let limit = 50
    private var searchTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?

    func load(reset: Bool = false) async {
        if reset {
            loadTask?.cancel()
        } else if isLoading {
            return
        }
        let task = Task { await performLoad(reset: reset) }
        loadTask = task
        await task.value
    }

    private func performLoad(reset: Bool) async {
        if reset {
            offset = 0
            hasMore = true
            pageError = nil
        }
        isLoading = true
        if reset { error = nil }
        do {
            let result = try await APIClient.shared.users(
                search: searchText.isEmpty ? nil : searchText,
                role: selectedRole,
                includeInactive: includeInactive,
                limit: limit,
                offset: offset
            )
            if Task.isCancelled { isLoading = false; return }
            if reset { users = result.data } else { users += result.data }
            offset += result.data.count
            hasMore = offset < result.total
            pageError = nil
        } catch is CancellationError {
            // Superseded by a newer load.
        } catch {
            if reset {
                self.error = error.localizedDescription
            } else {
                self.pageError = error.localizedDescription
                hasMore = false
            }
        }
        isLoading = false
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

    func resetDefaults() {
        searchTask?.cancel()
        loadTask?.cancel()
        searchText = ""
        selectedRole = nil
        includeInactive = false
        users = []
        offset = 0
        hasMore = true
        error = nil
        pageError = nil
    }
}

struct UsersView: View {
    var wrapsInNavigationStack = true

    @State private var vm = UsersViewModel()
    @State private var navigationPath = NavigationPath()
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session

    private var isCollaboratorDirectory: Bool {
        session.currentUser?.role == "COLLABORATOR"
    }

    var body: some View {
        // Apple's recommended pattern for binding to an @Observable model:
        // shadow `vm` with a @Bindable wrapper for the duration of body so
        // the dynamic-member subscript resolves cleanly.
        @Bindable var vm = vm
        return Group {
            if wrapsInNavigationStack {
                NavigationStack(path: $navigationPath) {
                    configuredContent
                }
            } else {
                configuredContent
            }
        }
    }

    private var configuredContent: some View {
        content
                .navigationTitle(isCollaboratorDirectory ? "People" : "Users")
                .searchable(
                    text: $vm.searchText,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: Text(isCollaboratorDirectory ? "Search by name…" : "Search by name or email…")
                )
                .onChange(of: vm.searchText) { vm.onSearchChange() }
                .onChange(of: vm.selectedRole) { Task { await vm.load(reset: true) } }
                .onChange(of: vm.includeInactive) { Task { await vm.load(reset: true) } }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        filterMenu
                    }
                }
                .refreshable { await vm.load(reset: true) }
                .task {
                    if vm.users.isEmpty && vm.error == nil {
                        await vm.load(reset: true)
                    }
                }
                .onChange(of: appState.tabResetToken) { _, _ in
                    guard appState.resetTab == 5 else { return }
                    navigationPath = NavigationPath()
                    vm.resetDefaults()
                    Task { await vm.load(reset: true) }
                }
                .navigationDestination(for: UserRouteId.self) { route in
                    UserDetailView(userId: route.id)
                }
    }

    @ViewBuilder
    private var content: some View {
        if let error = vm.error, vm.users.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load users", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load(reset: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.users.isEmpty && vm.isLoading {
            List {
                ForEach(0..<10, id: \.self) { index in
                    UserRowSkeleton(seed: index)
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
        } else if vm.users.isEmpty {
            ContentUnavailableView {
                Label(isCollaboratorDirectory ? "No people" : "No users", systemImage: "person.2")
            } description: {
                Text(emptyDescription)
            } actions: {
                // Narrowing yourself into an empty list needs a way out; without
                // this the only recovery was undoing each control by hand.
                if isNarrowed {
                    Button("Clear filters") { clearFilters() }
                        .buttonStyle(.borderedProminent)
                }
            }
        } else {
            List {
                ForEach(vm.users) { user in
                    ZStack {
                        NavigationLink(value: UserRouteId(id: user.id)) { EmptyView() }.opacity(0)
                        UserListRow(user: user)
                    }
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
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
                        .task(id: vm.users.count) { await vm.load() }
                } else if vm.users.count > 10 {
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
            .background(Color(.systemGroupedBackground))
        }
    }

    private var hasFilter: Bool {
        vm.selectedRole != nil || vm.includeInactive
    }

    /// Search counts here but not in `hasFilter` — the search field shows its
    /// own state, so tinting the filter control for it would double-report.
    private var isNarrowed: Bool {
        hasFilter || !vm.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var emptyDescription: String {
        let query = vm.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let noun = isCollaboratorDirectory ? "people" : "users"
        switch (query.isEmpty, hasFilter) {
        case (false, true):
            return "Nothing matches \"\(query)\" with these filters."
        case (false, false):
            return "No results for \"\(query)\"."
        case (true, true):
            return "No \(noun) match these filters."
        case (true, false):
            return "No \(noun) yet."
        }
    }

    private func clearFilters() {
        vm.searchText = ""
        vm.selectedRole = nil
        vm.includeInactive = false
    }

    private var filterMenu: some View {
        Menu {
            // Picker inside Menu renders the checkmark for the selected tag
            // automatically — no `systemImage: cond ? "checkmark" : ""` hack
            // (which logs "No symbol named ''" warnings every render).
            Picker("Role", selection: $vm.selectedRole) {
                Text("All roles").tag(String?.none)
                ForEach(["ADMIN", "STAFF", "STUDENT"], id: \.self) { role in
                    Text(role.capitalized).tag(String?.some(role))
                }
            }

            if !isCollaboratorDirectory {
                Section {
                    Button {
                        vm.includeInactive.toggle()
                    } label: {
                        Label(
                            vm.includeInactive ? "Hide inactive" : "Show inactive",
                            systemImage: vm.includeInactive ? "eye.slash" : "eye"
                        )
                    }
                    .accessibilityLabel(vm.includeInactive ? "Hide inactive users" : "Show inactive users")
                }
            }
        } label: {
            Image(systemName: hasFilter ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .frame(minWidth: 44, minHeight: 44)
        }
        // Inherited the app accent before, which put brand red -- the urgent and
        // destructive colour -- on a control that only narrows a list.
        .listControlTint(isActive: hasFilter)
        .accessibilityLabel(hasFilter ? "Filter users, active" : "Filter users")
    }
}

// MARK: - Row

private struct UserListRow: View {
    let user: AppUser

    var body: some View {
        // Same card anatomy as the Items/Bookings rows: leading accent rail,
        // 44pt identity tile, Gotham title, trailing badge + chevron. The rail
        // and role pill share the role tone; inactive users drop to gray so a
        // deactivated account never carries an active-looking accent.
        let tone: StatusTone = user.active == false ? .gray : StatusTone.forRole(user.role)

        HStack(spacing: 12) {
            StatusRail(tone: tone)

            UserAvatarView(
                name: user.name,
                avatarUrl: user.avatarUrl,
                size: 44,
                fallbackBackground: Color.statusBackground(tone),
                fallbackForeground: Color.statusText(tone),
                showsBorder: false
            )
            .accessibilityHidden(true)
            .opacity(user.active == false ? 0.6 : 1)

            // No email here. A monospaced address is the widest, least scannable
            // thing a row can carry, and it pushed the line that actually
            // distinguishes two people -- their year and area -- down to
            // tertiary. Email is a detail you go to a profile for; this list is
            // for finding a person.
            VStack(alignment: .leading, spacing: 3) {
                Text(user.name)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                if let secondary = secondaryLine {
                    Text(secondary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .layoutPriority(1)

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                StatusPill.role(user.role)
                if user.active == false {
                    StatusPill(label: "Inactive", tone: .gray)
                }
            }

            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.card)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
        .accessibilityHint("Double-tap to view profile")
    }

    private var rowAccessibilityLabel: String {
        var parts: [String] = [user.name, StatusTone.publicDirectoryRole(user.role).capitalized]
        if user.active == false { parts.append("Inactive") }
        if let secondary = secondaryLine { parts.append(secondary) }
        return parts.joined(separator: ", ")
    }

    private var secondaryLine: String? {
        UserIdentity.line(
            role: user.role,
            title: user.title,
            gradYear: user.gradYear,
            studentYearOverride: user.studentYearOverride,
            primaryArea: user.primaryArea
        )
    }

}

private struct UserRowSkeleton: View {
    var seed: Int = 0

    // Identical rows read as a test pattern rather than content arriving. These
    // widths are the rough shape of real names and detail lines.
    private static let nameWidths: [CGFloat] = [132, 168, 108, 152, 190]
    private static let detailWidths: [CGFloat] = [186, 148, 212, 164, 128]

    private var nameWidth: CGFloat { Self.nameWidths[seed % Self.nameWidths.count] }
    private var detailWidth: CGFloat { Self.detailWidths[seed % Self.detailWidths.count] }

    var body: some View {
        HStack(spacing: 12) {
            StatusRail(tone: .gray)
            Circle()
                .fill(Color.secondary.opacity(0.15))
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.secondary.opacity(0.15))
                    .frame(width: nameWidth, height: 12)
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.secondary.opacity(0.10))
                    .frame(width: detailWidth, height: 9)
            }
            Spacer()
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.secondary.opacity(0.12))
                .frame(width: 50, height: 16)
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.card)
        .redacted(reason: .placeholder)
    }
}
