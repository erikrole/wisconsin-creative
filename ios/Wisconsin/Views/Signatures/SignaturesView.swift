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
            .refreshable { await vm.load() }
            .task { await vm.load() }
            .navigationDestination(for: SignatureCollectionSummary.self) { collection in
                SignatureRosterView(collection: collection, viewModel: rosterLoader.map { SignatureRosterViewModel(collectionId: collection.id, loader: $0) })
            }
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
                    HStack {
                        Text("Rosters").font(.title3.weight(.semibold))
                        Spacer()
                        SignatureBadge(text: "\(vm.collections.count) \(vm.collections.count == 1 ? "roster" : "rosters")", prominent: false)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: Brand.Space.sm)], spacing: Brand.Space.sm) {
                        ForEach(vm.collections) { collection in
                            NavigationLink(value: collection) {
                                SignatureCollectionCard(collection: collection)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(Brand.Space.lg)
            }
        }
    }
}

extension SignatureCollectionSummary: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// The web roster card: title, season, Open badge, Complete x/y with a
/// progress bar, the staff count, and "% ready / Open roster".
private struct SignatureCollectionCard: View {
    let collection: SignatureCollectionSummary

    private var isCreative: Bool { collection.sportCode == "CREATIVE" }
    private var isAdHoc: Bool { collection.sportCode == "ADHOC" }
    private var hasMembers: Bool { collection.activeMemberCount > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(collection.title).font(.headline)
                    if !isCreative {
                        Text(isAdHoc ? "\(collection.season) one-off captures" : collection.season)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                SignatureBadge(text: "Open", prominent: true)
            }
            HStack {
                Text(hasMembers ? "Complete" : "Roster status").foregroundStyle(.secondary)
                Spacer()
                Text(hasMembers ? "\(collection.completeness.complete)/\(collection.completeness.required)" : "Not applied")
                    .fontWeight(.semibold)
                    .monospacedDigit()
            }
            .font(.subheadline)
            ProgressView(value: Double(hasMembers ? collection.completeness.percent : 0), total: 100)
                .tint(Color.brandPrimary)
            if !isCreative, !isAdHoc, let staff = collection.staffCompleteness, staff.total > 0 {
                Text("\(staff.complete)/\(staff.total) Staff")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            HStack {
                Text(isCreative ? "Automatically synced" : hasMembers ? "\(collection.completeness.percent)% ready" : "Apply a roster to begin")
                    .foregroundStyle(.secondary)
                Spacer()
                HStack(spacing: 4) {
                    Text("Open roster")
                    Image(systemName: "arrow.right").imageScale(.small)
                }
                .fontWeight(.medium)
            }
            .font(.caption)
        }
        .padding(Brand.Space.md)
        .brandCard(padding: 0)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Roster

enum SignatureRosterGroupFilter: String, CaseIterable, Identifiable {
    case all = "ALL", players = "PLAYER", coachingStaff = "COACHING_STAFF", supportStaff = "SUPPORT_STAFF"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All roster groups"
        case .players: "Players"
        case .coachingStaff: "Coaching staff"
        case .supportStaff: "Support staff"
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
            .refreshable { await vm.load() }
            .task { await vm.load() }
            .fullScreenCover(item: $capturing) { member in
                SignatureCaptureView(
                    collectionId: collection.id,
                    memberId: member.id,
                    sportTitle: collection.title,
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
            .sheet(item: $previewing) { member in
                SignatureQuickLook(member: member, canReplace: isOpen) {
                    previewing = nil
                    capturing = member
                }
            }
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
                VStack(alignment: .leading, spacing: Brand.Space.lg) {
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
                .padding(Brand.Space.lg)
            }
        }
    }

    // MARK: Header (readiness, search, group filter)

    private var rosterHeader: some View {
        HStack(alignment: .bottom, spacing: Brand.Space.md) {
            VStack(alignment: .leading, spacing: Brand.Space.xs) {
                Text("Roster").font(.title3.weight(.semibold))
                if isTeamRoster, let completeness = vm.detail?.completeness {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(completeness.complete)/\(completeness.required) Student-Athletes")
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                        Spacer()
                        if let staff = vm.detail?.staffCompleteness, staff.total > 0 {
                            Text("\(staff.complete)/\(staff.total) Staff")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    ProgressView(value: Double(completeness.percent), total: 100)
                        .tint(Color.brandPrimary)
                }
            }
            .frame(maxWidth: 520, alignment: .leading)
            Spacer(minLength: 0)
            HStack(spacing: Brand.Space.sm) {
                HStack(spacing: Brand.Space.xs) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search name, number, or title", text: $vm.searchText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                }
                .padding(.horizontal, Brand.Space.sm)
                .frame(width: 300, height: 44)
                .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
                if isTeamRoster {
                    Button { showsJerseyPad = true } label: {
                        Label("Jersey #", systemImage: "number")
                            .font(.body.weight(.semibold))
                            .frame(minWidth: 110, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.brandPrimary)
                    .disabled(!isOpen)
                    Picker("Filter signature roster", selection: $vm.groupFilter) {
                        ForEach(SignatureRosterGroupFilter.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.menu)
                    .frame(width: 210, height: 44)
                    .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
                }
            }
        }
    }

    // MARK: Groups

    private func groupSection(_ section: SignatureRosterViewModel.Section) -> some View {
        let isOpenGroup = !vm.collapsedGroups.contains(section.roleGroup)
        return VStack(alignment: .leading, spacing: Brand.Space.xs) {
            Button { withAnimation(.snappy) { vm.toggleGroup(section.roleGroup) } } label: {
                HStack(spacing: Brand.Space.sm) {
                    Image(systemName: groupIcon(section.roleGroup))
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
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
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(isOpenGroup ? "Collapse" : "Expand") \(section.title)")
            if isOpenGroup {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: Brand.Space.sm)], spacing: Brand.Space.sm) {
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
            }
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
                Text(member.name)
                    .font(.gothamBlack(size: 16, relativeTo: .subheadline))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if showsTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: Brand.Space.xs)
                footer
            }
            .padding(Brand.Space.md)
            .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
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
            SignaturePreview(revisionId: artifact.id, maxHeight: 36)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if isOpen {
            Label("Tap to sign", systemImage: "pencil.and.scribble")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(primaryCapture ? Color.white : Color.primary)
                .frame(maxWidth: .infinity, minHeight: 36)
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
    let prominent: Bool

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(prominent ? Color(.systemBackground) : Color.secondary)
            .background(prominent ? AnyShapeStyle(Color.primary) : AnyShapeStyle(Color.clear), in: Capsule())
            .overlay(Capsule().strokeBorder(prominent ? Color.clear : Color.hairline))
    }
}

// MARK: - Saved signature preview

/// Loads and caches the saved PNG for a roster row. Revisions never change, so
/// the cache is keyed by revision ID for the life of the app process.
@MainActor
enum SignaturePreviewStore {
    typealias Loader = @MainActor (_ revisionId: String) async throws -> Data

    static var loader: Loader = { try await APIClient.shared.signatureArtifactPNG(revisionId: $0) }
    private static let cache = NSCache<NSString, UIImage>()

    static func cached(_ revisionId: String) -> UIImage? {
        cache.object(forKey: revisionId as NSString)
    }

    static func image(for revisionId: String) async -> UIImage? {
        if let hit = cached(revisionId) { return hit }
        do {
            guard let image = UIImage(data: try await loader(revisionId)) else { return nil }
            cache.setObject(image, forKey: revisionId as NSString)
            return image
        } catch {
            // A preview is decorative; the row still says Signed without it.
            return nil
        }
    }
}

/// The transparent PNG drawn as a template so the ink follows the text color
/// in light and dark mode (the web's `brightness-0 dark:invert`).
private struct SignaturePreview: View {
    let revisionId: String
    var maxHeight: CGFloat = 32
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .renderingMode(.template)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .foregroundStyle(.primary)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: maxHeight > 32 ? .infinity : 112, maxHeight: maxHeight)
        .accessibilityHidden(true)
        .task(id: revisionId) {
            image = SignaturePreviewStore.cached(revisionId)
            if image == nil { image = await SignaturePreviewStore.image(for: revisionId) }
        }
    }
}
