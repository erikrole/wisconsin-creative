import SwiftUI

/// Native signature capture hub (iPad + STAFF/ADMIN, reached from Browse).
/// Layout and copy mirror the web Signatures pages (`/signatures`,
/// `/signatures/[id]`) so staff meet the same surface on either; imports,
/// settings, downloads, and roster maintenance stay on the web.
enum SignatureCaptureAvailability {
    /// Capture is iPad-only (an Apple Pencil is required) and staff/admin-only
    /// (the server's `signature:capture` permission).
    @MainActor static func isAvailable(role: String?) -> Bool {
        UIDevice.current.userInterfaceIdiom == .pad && (role == "STAFF" || role == "ADMIN")
    }
}

// MARK: - Collections

@MainActor
@Observable
final class SignatureCollectionsViewModel {
    typealias Loader = @MainActor () async throws -> [SignatureCollectionSummary]

    private(set) var collections: [SignatureCollectionSummary] = []
    private(set) var isLoading = false
    var error: String?
    @ObservationIgnored private let loader: Loader

    init(loader: @escaping Loader = { try await APIClient.shared.signatureCollections() }) {
        self.loader = loader
    }

    struct Group: Identifiable {
        let title: String
        let collections: [SignatureCollectionSummary]
        var id: String { title }
    }

    /// Team rosters first (by sport, newest season first), then staff and
    /// ad-hoc collections.
    var groups: [Group] {
        let ordered = collections.sorted {
            ($0.title, $1.season) < ($1.title, $0.season)
        }
        let teams = ordered.filter { SignatureSport.isTeamRoster($0.sportCode) }
        let other = ordered.filter { !SignatureSport.isTeamRoster($0.sportCode) }
        return [Group(title: "Teams", collections: teams), Group(title: "Staff and other", collections: other)]
            .filter { !$0.collections.isEmpty }
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            collections = try await loader().filter(\.isOpen)
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct SignaturesView: View {
    var wrapsInNavigationStack = true
    @State private var vm: SignatureCollectionsViewModel
    @State private var gridWidth: CGFloat = 1_100
    private let rosterLoader: SignatureRosterViewModel.Loader?

    init(
        wrapsInNavigationStack: Bool = true,
        viewModel: SignatureCollectionsViewModel? = nil,
        rosterLoader: SignatureRosterViewModel.Loader? = nil
    ) {
        self.wrapsInNavigationStack = wrapsInNavigationStack
        _vm = State(initialValue: viewModel ?? SignatureCollectionsViewModel())
        self.rosterLoader = rosterLoader
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
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Signatures")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .refreshable { await vm.load() }
            .task { await vm.load() }
            .navigationDestination(for: SignatureCollectionSummary.self) { collection in
                SignatureRosterView(collection: collection, viewModel: rosterLoader.map { SignatureRosterViewModel(collectionId: collection.id, loader: $0) })
            }
    }

    /// 3 across in landscape, 2 in portrait, 1 in a narrow split view.
    private var collectionColumns: [GridItem] {
        let count = gridWidth >= 1_000 ? 3 : gridWidth >= 560 ? 2 : 1
        return Array(repeating: GridItem(.flexible(), spacing: Brand.Space.sm, alignment: .top), count: count)
    }

    @ViewBuilder
    private var content: some View {
        if vm.collections.isEmpty && vm.isLoading {
            ProgressView("Loading rosters…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = vm.error, vm.collections.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load rosters", systemImage: "wifi.slash")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.collections.isEmpty {
            ContentUnavailableView(
                "No active rosters",
                systemImage: "folder",
                description: Text("Archived years are hidden. Import a roster on the web to start a new season.")
            )
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: Brand.Space.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Signatures")
                            .font(.gothamBlack(size: 34, relativeTo: .largeTitle))
                        Text("\(vm.collections.count) open \(vm.collections.count == 1 ? "roster" : "rosters")")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, Brand.Space.sm)
                    .padding(.bottom, Brand.Space.xs)
                    ForEach(vm.groups) { group in
                        Text(group.title)
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .padding(.top, Brand.Space.sm)
                        LazyVGrid(columns: collectionColumns, spacing: Brand.Space.sm) {
                            ForEach(group.collections) { collection in
                                NavigationLink(value: collection) {
                                    SignatureCollectionCard(collection: collection)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(Brand.Space.lg)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
            }
        }
    }
}

extension SignatureCollectionSummary: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// One open roster: sport mark, sport name in the brand face, season chip,
/// the big signed count with staff alongside, a progress bar, and readiness.
/// Finished rosters turn green. Cards share one height so the grid stays even.
private struct SignatureCollectionCard: View {
    let collection: SignatureCollectionSummary

    private var isCreative: Bool { collection.sportCode == "CREATIVE" }
    private var isAdHoc: Bool { collection.sportCode == "ADHOC" }
    private var hasMembers: Bool { collection.activeMemberCount > 0 }
    private var isComplete: Bool {
        hasMembers && collection.completeness.required > 0 && collection.completeness.complete >= collection.completeness.required
    }

    private var symbol: String {
        switch collection.sportCode {
        case "MBB", "WBB": "basketball.fill"
        case "FB": "football.fill"
        case "VB": "volleyball.fill"
        case "MHKY", "WHKY": "hockey.puck.fill"
        case "WRES": "figure.wrestling"
        case "CREATIVE": "camera.fill"
        case "ADMIN": "building.columns.fill"
        default: "signature"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack(alignment: .center, spacing: Brand.Space.sm) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(isComplete ? Color.statusText(.green) : Color.brandPrimary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                Text(collection.title)
                    .font(.gothamBlack(size: 22, relativeTo: .title2))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: Brand.Space.xs)
                if !isCreative {
                    Text(collection.season)
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color(.tertiarySystemFill), in: Capsule())
                }
            }
            Spacer(minLength: 0)
            HStack(alignment: .lastTextBaseline, spacing: Brand.Space.xs) {
                if hasMembers {
                    Text("\(collection.completeness.complete)/\(collection.completeness.required)")
                        .font(.gothamBold(size: 32, relativeTo: .title))
                        .monospacedDigit()
                        .foregroundStyle(isComplete ? Color.statusText(.green) : Color.primary)
                    Text(isCreative || isAdHoc ? "signed" : "Student-Athletes")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: Brand.Space.xs)
                    if !isCreative, !isAdHoc, let staff = collection.staffCompleteness, staff.total > 0 {
                        Text("\(staff.complete)/\(staff.total) Staff")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Roster not applied")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
            }
            ProgressView(value: Double(hasMembers ? collection.completeness.percent : 0), total: 100)
                .tint(isComplete ? Color.statusText(.green) : Color.brandPrimary)
                .scaleEffect(x: 1, y: 1.6, anchor: .center)
            HStack {
                if isComplete {
                    Label("Complete", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color.statusText(.green))
                } else {
                    Text(isCreative ? "Automatically synced" : hasMembers ? "\(collection.completeness.percent)% ready" : isAdHoc ? "\(collection.season) one-off captures" : "Apply a roster on the web to begin")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }
            .font(.subheadline.weight(.medium))
        }
        .padding(Brand.Space.md)
        .frame(height: 196)
        .background(isComplete ? Color.statusBackground(.green) : Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous).strokeBorder(Color.hairline))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Roster

enum SignatureRosterGroupFilter: String, CaseIterable, Identifiable {
    case all = "ALL", players = "PLAYER", coachingStaff = "COACHING_STAFF", supportStaff = "SUPPORT_STAFF"

    var id: String { rawValue }

    /// Segment labels for the roster header.
    var shortTitle: String {
        switch self {
        case .all: "All"
        case .players: "Players"
        case .coachingStaff: "Coaches"
        case .supportStaff: "Support"
        }
    }
}

@MainActor
@Observable
final class SignatureRosterViewModel {
    typealias Loader = @MainActor (_ collectionId: String) async throws -> SignatureCollectionDetail

    struct Section: Identifiable {
        let roleGroup: String
        let members: [SignatureRosterMember]
        var id: String { roleGroup }
        var title: String { SignatureSport.groupTitle(for: roleGroup) }
        var complete: Int { members.filter(\.isSigned).count }
        var percent: Int { members.isEmpty ? 0 : Int((Double(complete) / Double(members.count) * 100).rounded()) }
    }

    let collectionId: String
    private(set) var detail: SignatureCollectionDetail?
    private(set) var isLoading = false
    var error: String?
    var searchText = ""
    var groupFilter: SignatureRosterGroupFilter = .all
    var collapsedGroups: Set<String> = []
    @ObservationIgnored private let loader: Loader

    init(collectionId: String, loader: @escaping Loader = { try await APIClient.shared.signatureCollection(id: $0) }) {
        self.collectionId = collectionId
        self.loader = loader
    }

    /// Active members in server order, narrowed like the web roster: search
    /// matches name, number, or title; the group filter applies to team rosters.
    var visibleMembers: [SignatureRosterMember] {
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        let isTeam = detail.map { SignatureSport.isTeamRoster($0.sportCode) } ?? true
        return (detail?.members ?? []).filter { member in
            guard member.active else { return false }
            if isTeam, groupFilter != .all, member.roleGroup != groupFilter.rawValue { return false }
            guard !query.isEmpty else { return true }
            return member.name.lowercased().contains(query)
                || member.jerseyNumber.map(String.init) == query
                || (member.title?.lowercased().contains(query) ?? false)
        }
    }

    /// Visible members grouped in server order, student-athletes first.
    var sections: [Section] {
        let active = visibleMembers
        let order = ["PLAYER", "COACHING_STAFF", "SUPPORT_STAFF", "CREATIVE_STAFF"]
        let keys = order.filter { key in active.contains { $0.roleGroup == key } }
            + Set(active.map(\.roleGroup)).subtracting(order).sorted()
        return keys.map { key in Section(roleGroup: key, members: active.filter { $0.roleGroup == key }) }
    }

    /// Saved revisions on this roster, in roster order, for preview prefetch.
    var artifactIds: [String] {
        (detail?.members ?? []).filter(\.active).compactMap(\.artifact?.id)
    }

    /// Active members wearing `number`, for the jersey pad. Staff still pick
    /// who signs; the pad only finds them.
    func members(withJersey number: Int) -> [SignatureRosterMember] {
        (detail?.members ?? []).filter { $0.active && $0.jerseyNumber == number }
    }

    func toggleGroup(_ roleGroup: String) {
        if collapsedGroups.contains(roleGroup) { collapsedGroups.remove(roleGroup) } else { collapsedGroups.insert(roleGroup) }
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await loader(collectionId)
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct SignatureRosterView: View {
    let collection: SignatureCollectionSummary
    @State private var vm: SignatureRosterViewModel
    @State private var capturing: SignatureRosterMember?
    @State private var previewing: SignatureRosterMember?
    @State private var showsJerseyPad = false
    /// The member picked on the jersey pad; capture opens once the pad closes.
    @State private var padPick: SignatureRosterMember?
    /// Replace chosen in Quick Look; capture opens once that sheet closes.
    @State private var replacePick: SignatureRosterMember?
    @State private var gridWidth: CGFloat = 1_100

    init(collection: SignatureCollectionSummary, viewModel: SignatureRosterViewModel? = nil) {
        self.collection = collection
        _vm = State(initialValue: viewModel ?? SignatureRosterViewModel(collectionId: collection.id))
    }

    private var isTeamRoster: Bool { SignatureSport.isTeamRoster(collection.sportCode) }
    private var isOpen: Bool { vm.detail?.isOpen ?? collection.isOpen }

    var body: some View {
        content
            .background(Color(.systemGroupedBackground))
            .navigationTitle(collection.title)
            .navigationBarTitleDisplayMode(.inline)
            // The header carries the roster name in the brand face.
            .toolbar(removing: .title)
            .searchable(text: $vm.searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search name, number, or title")
            .toolbar {
                if isTeamRoster {
                    ToolbarItem(placement: .primaryAction) {
                        Button { showsJerseyPad = true } label: {
                            Label("Jersey #", systemImage: "number")
                                .labelStyle(.titleAndIcon)
                                .font(.body.weight(.semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.brandPrimary)
                        .disabled(!isOpen)
                        .keyboardShortcut("j", modifiers: .command)
                    }
                }
            }
            .refreshable { await vm.load() }
            .task { await vm.load() }
            .task(id: vm.artifactIds) { await SignaturePreviewStore.prefetch(vm.artifactIds) }
            .fullScreenCover(item: $capturing) { member in
                SignatureCaptureView(
                    collectionId: collection.id,
                    memberId: member.id,
                    onSaved: { Task { await vm.load() } }
                )
            }
            .sheet(isPresented: $showsJerseyPad, onDismiss: {
                if let member = padPick {
                    padPick = nil
                    capturing = member
                }
            }) {
                SignatureJerseyPad(isOpen: isOpen, lookup: vm.members(withJersey:)) { member in
                    padPick = member
                    showsJerseyPad = false
                }
            }
            .sheet(item: $previewing, onDismiss: {
                if let member = replacePick {
                    replacePick = nil
                    capturing = member
                }
            }) { member in
                SignatureQuickLook(member: member, canReplace: isOpen) {
                    replacePick = member
                    previewing = nil
                }
            }
    }

    /// Fixed column counts keep the grid even: 4 across an 11-inch iPad in
    /// landscape, 3 in portrait, 2 in a narrow split view.
    private var columns: [GridItem] {
        let count = gridWidth >= 1_000 ? 4 : gridWidth >= 640 ? 3 : 2
        return Array(repeating: GridItem(.flexible(), spacing: Brand.Space.sm, alignment: .top), count: count)
    }

    @ViewBuilder
    private var content: some View {
        if vm.detail == nil && vm.isLoading {
            ProgressView("Loading signature roster…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = vm.error, vm.detail == nil {
            ContentUnavailableView {
                Label("Couldn’t load this signature collection", systemImage: "wifi.slash")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Brand.Space.lg, pinnedViews: [.sectionHeaders]) {
                    rosterHeader
                    if vm.sections.isEmpty {
                        ContentUnavailableView(
                            "No roster members in this view",
                            systemImage: "person.2",
                            description: Text(vm.searchText.trimmingCharacters(in: .whitespaces).isEmpty ? "Try another roster group." : "Try another name, number, or title.")
                        )
                    } else {
                        ForEach(vm.sections) { section in
                            groupSection(section)
                        }
                    }
                }
                .padding(.horizontal, Brand.Space.lg)
                .padding(.bottom, Brand.Space.lg)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
            }
        }
    }

    // MARK: Header (roster name, readiness, group filter)

    private struct Readiness {
        let complete: Int
        let total: Int
        let label: String
    }

    /// Team rosters count required student-athletes and staff separately (like
    /// the web header); other rosters count everyone active.
    private var readiness: [Readiness] {
        let members = (vm.detail?.members ?? []).filter(\.active)
        guard isTeamRoster else {
            return [Readiness(complete: members.filter(\.isSigned).count, total: members.count, label: "Signed")]
        }
        var rows: [Readiness] = []
        if let completeness = vm.detail?.completeness {
            rows.append(Readiness(complete: completeness.complete, total: completeness.required, label: "Student-Athletes"))
        }
        if let staff = vm.detail?.staffCompleteness, staff.total > 0 {
            rows.append(Readiness(complete: staff.complete, total: staff.total, label: "Staff"))
        }
        return rows
    }

    private var readinessPercent: Double {
        if isTeamRoster, let completeness = vm.detail?.completeness { return Double(completeness.percent) }
        guard let first = readiness.first, first.total > 0 else { return 0 }
        return Double(first.complete) / Double(first.total) * 100
    }

    private var rosterHeader: some View {
        VStack(alignment: .leading, spacing: Brand.Space.md) {
            HStack(alignment: .firstTextBaseline, spacing: Brand.Space.sm) {
                Text(collection.title)
                    .font(.gothamBlack(size: 34, relativeTo: .largeTitle))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(collection.season)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                Spacer(minLength: Brand.Space.sm)
                if !isOpen { SignatureBadge(text: "Archived") }
            }
            HStack(alignment: .lastTextBaseline, spacing: Brand.Space.xl) {
                ForEach(readiness, id: \.label) { row in
                    HStack(alignment: .lastTextBaseline, spacing: Brand.Space.xs) {
                        Text("\(row.complete)/\(row.total)")
                            .font(.gothamBold(size: 28, relativeTo: .title))
                            .monospacedDigit()
                            .foregroundStyle(row.total > 0 && row.complete == row.total ? Color.statusText(.green) : Color.primary)
                        Text(row.label)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                Spacer(minLength: 0)
            }
            ProgressView(value: readinessPercent, total: 100)
                .tint(Color.brandPrimary)
            if isTeamRoster {
                Picker("Filter signature roster", selection: $vm.groupFilter) {
                    ForEach(SignatureRosterGroupFilter.allCases) { Text($0.shortTitle).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 560)
            }
        }
        .padding(.top, Brand.Space.sm)
    }

    // MARK: Groups

    /// Group headers stay pinned while their cards scroll by.
    private func groupSection(_ section: SignatureRosterViewModel.Section) -> some View {
        let isOpenGroup = !vm.collapsedGroups.contains(section.roleGroup)
        return Section {
            if isOpenGroup {
                LazyVGrid(columns: columns, spacing: Brand.Space.sm) {
                    ForEach(section.members) { member in
                        SignatureMemberCard(
                            member: member,
                            showsTitle: collection.sportCode != "CREATIVE",
                            primaryCapture: member.roleGroup == "PLAYER" || member.roleGroup == "CREATIVE_STAFF" || collection.sportCode == "ADMIN",
                            isOpen: isOpen,
                            onCapture: { capturing = member },
                            onPreview: { previewing = member }
                        )
                    }
                }
                .padding(.bottom, Brand.Space.sm)
            }
        } header: {
            Button { withAnimation(.snappy) { vm.toggleGroup(section.roleGroup) } } label: {
                HStack(spacing: Brand.Space.sm) {
                    Image(systemName: groupIcon(section.roleGroup))
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text(section.title).font(.headline)
                    Spacer()
                    Text("\(section.complete)/\(section.members.count) signed")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(section.complete == section.members.count ? Color.statusText(.green) : Color.primary)
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isOpenGroup ? 180 : 0))
                }
                .frame(minHeight: 48)
                .padding(.vertical, Brand.Space.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Color(.systemGroupedBackground))
            .accessibilityLabel("\(isOpenGroup ? "Collapse" : "Expand") \(section.title)")
        }
    }

    private func groupIcon(_ roleGroup: String) -> String {
        if collection.sportCode == "ADHOC" { return "pencil.and.list.clipboard" }
        switch roleGroup {
        case "PLAYER": return "person"
        case "COACHING_STAFF": return "checkmark.shield"
        default: return "person.2"
        }
    }
}

extension SignatureRosterMember: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// One roster member as a tappable card: big Wisconsin-font number, name,
/// title, then the saved signature or "Tap to sign". The whole card is the
/// target: unsigned opens capture, signed opens Quick Look (Replace lives
/// there and in the context menu). Players get the prominent red prompt,
/// staff a quieter one. Signed cards carry the green completion tint.
private struct SignatureMemberCard: View {
    let member: SignatureRosterMember
    let showsTitle: Bool
    let primaryCapture: Bool
    let isOpen: Bool
    let onCapture: () -> Void
    let onPreview: () -> Void

    private var subtitle: String {
        if let title = member.title, !title.isEmpty { return title }
        return SignatureSport.groupTitle(for: member.roleGroup)
    }

    var body: some View {
        Button(action: member.isSigned ? onPreview : onCapture) {
            VStack(alignment: .leading, spacing: Brand.Space.xs) {
                HStack(alignment: .top) {
                    jersey
                    Spacer(minLength: Brand.Space.xs)
                    if member.isSigned {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Color.statusText(.green))
                            .accessibilityLabel("Signature complete")
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(member.name)
                        .font(.gothamBlack(size: 16, relativeTo: .subheadline))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(showsTitle ? subtitle : " ")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                // Signed cards step back a little so unsigned ones stand out.
                .opacity(member.isSigned ? 0.75 : 1)
                Spacer(minLength: Brand.Space.xs)
                footer
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .padding(Brand.Space.md)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .frame(height: 176)
            .background(member.isSigned ? Color.statusBackground(.green) : Color.cardSurface)
            .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous).strokeBorder(Color.hairline))
            .contentShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!member.isSigned && !isOpen)
        .contextMenu {
            if member.isSigned {
                Button("Quick Look", systemImage: "eye", action: onPreview)
                if isOpen {
                    Button("Replace signature", systemImage: "pencil.and.scribble", action: onCapture)
                }
            }
        }
        .accessibilityHint(member.isSigned ? "Shows the saved signature" : "Opens signature capture")
    }

    @ViewBuilder
    private var jersey: some View {
        if let number = member.jerseyNumber {
            Text("\(number)")
                .font(.wisconsinJersey(size: 40, relativeTo: .largeTitle))
                .monospacedDigit()
                .tracking(1.6)
                .foregroundStyle(Color.jerseyNumber)
                .accessibilityLabel("Jersey \(number)")
        } else {
            Image(systemName: "person")
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .background(Color(.tertiarySystemFill), in: Circle())
                .accessibilityLabel("No jersey number")
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let artifact = member.artifact {
            SignaturePreview(revisionId: artifact.id, maxHeight: 40)
        } else if isOpen {
            Label("Tap to sign", systemImage: "pencil.and.scribble")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(primaryCapture ? Color.white : Color.primary)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(
                    primaryCapture ? AnyShapeStyle(Color.brandPrimary) : AnyShapeStyle(Color(.tertiarySystemFill)),
                    in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                )
        } else {
            Text("Not signed")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

/// Athletes say their number: a big keypad that finds who wears it. Staff
/// still choose who signs; picking a match opens that member's capture.
private struct SignatureJerseyPad: View {
    let isOpen: Bool
    let lookup: (Int) -> [SignatureRosterMember]
    let onPick: (SignatureRosterMember) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var digits = ""

    private var matches: [SignatureRosterMember] {
        guard let number = Int(digits) else { return [] }
        return lookup(number)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: Brand.Space.lg) {
                Text(digits.isEmpty ? "#" : digits)
                    .font(.wisconsinJersey(size: 96, relativeTo: .largeTitle))
                    .monospacedDigit()
                    .tracking(3)
                    .foregroundStyle(digits.isEmpty ? Color.secondary : Color.jerseyNumber)
                    .frame(height: 110)
                    .accessibilityLabel(digits.isEmpty ? "No number entered" : "Jersey \(digits)")
                results
                    .frame(minHeight: 132, alignment: .top)
                keypad
            }
            .padding(Brand.Space.lg)
            .navigationTitle("Jersey number")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder
    private var results: some View {
        if digits.isEmpty {
            Text("Type the number the athlete gives you.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else if matches.isEmpty {
            Text("No one on this roster wears #\(digits).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: Brand.Space.xs) {
                ForEach(matches) { member in
                    Button { onPick(member) } label: {
                        HStack(spacing: Brand.Space.sm) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(member.name).font(.gothamBlack(size: 18, relativeTo: .headline))
                                Text(member.isSigned ? "Already signed" : SignatureSport.groupTitle(for: member.roleGroup))
                                    .font(.caption)
                                    .foregroundStyle(member.isSigned ? Color.statusText(.green) : Color.secondary)
                            }
                            Spacer()
                            Text(member.isSigned ? "Replace" : "Sign")
                                .font(.headline)
                                .frame(minWidth: 110, minHeight: 44)
                                .foregroundStyle(member.isSigned ? Color.primary : Color.white)
                                .background(
                                    member.isSigned ? AnyShapeStyle(Color(.tertiarySystemFill)) : AnyShapeStyle(Color.brandPrimary),
                                    in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                                )
                        }
                        .padding(Brand.Space.sm)
                        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!isOpen)
                }
            }
        }
    }

    private var keypad: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"]
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(96), spacing: Brand.Space.sm), count: 3), spacing: Brand.Space.sm) {
            ForEach(keys, id: \.self) { key in
                Button { press(key) } label: {
                    Group {
                        switch key {
                        case "clear": Text("Clear").font(.headline)
                        case "delete": Image(systemName: "delete.left").font(.title2)
                        default: Text(key).font(.wisconsinJersey(size: 40, relativeTo: .title)).foregroundStyle(Color.jerseyNumber)
                        }
                    }
                    .frame(width: 96, height: 72)
                    .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(key == "delete" ? "Delete" : key == "clear" ? "Clear" : key)
            }
        }
    }

    private func press(_ key: String) {
        switch key {
        case "clear": digits = ""
        case "delete": digits = String(digits.dropLast())
        default: if digits.count < 2 { digits += key }
        }
        Haptics.selection()
    }
}

/// The web Quick Look dialog: the cropped signature on a transparency
/// checkerboard. Downloads remain on the web.
private struct SignatureQuickLook: View {
    let member: SignatureRosterMember
    let canReplace: Bool
    let onReplace: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack {
                if let artifact = member.artifact {
                    SignaturePreview(revisionId: artifact.id, maxHeight: 360)
                        .padding(Brand.Space.xl)
                        .frame(maxWidth: .infinity, minHeight: 300)
                        .background(Checkerboard().clipShape(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)))
                        .overlay(RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous).strokeBorder(Color.hairline))
                }
                Spacer(minLength: 0)
            }
            .padding(Brand.Space.lg)
            .navigationTitle(member.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if canReplace {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Replace signature", systemImage: "pencil.and.scribble", action: onReplace)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct Checkerboard: View {
    var body: some View {
        Canvas { context, size in
            let cell: CGFloat = 12
            for row in 0..<Int(ceil(size.height / cell)) {
                for column in 0..<Int(ceil(size.width / cell)) where (row + column).isMultiple(of: 2) {
                    context.fill(Path(CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)), with: .color(Color(.tertiarySystemFill)))
                }
            }
        }
        .background(Color.cardSurface)
    }
}

private struct SignatureBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(.secondary)
            .overlay(Capsule().strokeBorder(Color.hairline))
    }
}

// MARK: - Saved signature preview

/// Saved signature PNGs for roster cards. A revision never changes once
/// saved (a replacement gets a new ID), so images are cached by revision ID
/// in memory and on disk with no expiry; iOS may purge the Caches folder,
/// which only costs a re-download. Concurrent requests for one revision
/// share a single download.
@MainActor
enum SignaturePreviewStore {
    typealias Loader = @MainActor (_ revisionId: String) async throws -> Data

    static var loader: Loader = { try await APIClient.shared.signatureArtifactPNG(revisionId: $0) }
    static var directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("SignaturePreviews", isDirectory: true)
    /// Roster prefetch downloads at most this many previews at once.
    static let prefetchWidth = 4

    private static let memory = NSCache<NSString, UIImage>()
    private static var inFlight: [String: Task<UIImage?, Never>] = [:]

    static func cached(_ revisionId: String) -> UIImage? {
        memory.object(forKey: revisionId as NSString)
    }

    static func image(for revisionId: String) async -> UIImage? {
        if let hit = cached(revisionId) { return hit }
        if let running = inFlight[revisionId] { return await running.value }
        let task = Task { () -> UIImage? in
            defer { inFlight[revisionId] = nil }
            let file = fileURL(revisionId)
            if let image = await readFile(file) {
                memory.setObject(image, forKey: revisionId as NSString)
                return image
            }
            do {
                let data = try await loader(revisionId)
                guard let image = UIImage(data: data) else { return nil }
                memory.setObject(image, forKey: revisionId as NSString)
                await writeFile(data, to: file)
                return image
            } catch {
                // A preview is decorative; the card still says Signed without it.
                return nil
            }
        }
        inFlight[revisionId] = task
        return await task.value
    }

    /// Warms the cache for a roster so thumbnails are ready before scrolling.
    static func prefetch(_ revisionIds: [String]) async {
        var pending = revisionIds.filter { cached($0) == nil }[...]
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<prefetchWidth {
                guard let id = pending.popFirst() else { break }
                group.addTask { _ = await image(for: id) }
            }
            while await group.next() != nil {
                guard let id = pending.popFirst() else { continue }
                group.addTask { _ = await image(for: id) }
            }
        }
    }

    /// Test hook: drops the memory layer so the disk layer is exercised.
    static func clearMemory() {
        memory.removeAllObjects()
    }

    private static func fileURL(_ revisionId: String) -> URL {
        let safe = revisionId.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return directory.appendingPathComponent("\(safe).png")
    }

    private nonisolated static func readFile(_ url: URL) async -> UIImage? {
        await Task.detached(priority: .utility) {
            guard let data = try? Data(contentsOf: url) else { return nil }
            return UIImage(data: data)
        }.value
    }

    private nonisolated static func writeFile(_ data: Data, to url: URL) async {
        await Task.detached(priority: .utility) {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
        }.value
    }
}

/// The transparent PNG drawn as a template so the ink follows the text color
/// in light and dark mode (the web's `brightness-0 dark:invert`).
private struct SignaturePreview: View {
    let revisionId: String
    var maxHeight: CGFloat = 32
    @State private var image: UIImage?
    @State private var isLoading = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .renderingMode(.template)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .foregroundStyle(.primary)
            } else if isLoading {
                // Same footprint as the image so the card does not jump.
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(.tertiarySystemFill))
                    .frame(maxWidth: 120)
                    .frame(height: maxHeight * 0.6)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: maxHeight > 32 ? .infinity : 112, maxHeight: maxHeight)
        .accessibilityHidden(true)
        .task(id: revisionId) {
            image = SignaturePreviewStore.cached(revisionId)
            guard image == nil else { return }
            isLoading = true
            image = await SignaturePreviewStore.image(for: revisionId)
            isLoading = false
        }
    }
}
