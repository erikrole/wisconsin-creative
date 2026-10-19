import SwiftUI
import UIKit

@MainActor
@Observable
final class LicensesViewModel {
    var codes: [LicenseCode] = []
    var activeClaim: ActiveLicenseClaim?
    var isLoading = false
    var error: String?
    var notice: String?
    var pendingActionId: String?

    private var lastLoadedAt: Date?
    private var loadTask: Task<Void, Never>?
    private var noticeTask: Task<Void, Never>?
    private static let freshnessWindow: TimeInterval = 60
    private static let noticeLifetime: Duration = .seconds(5)

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh,
           let lastLoadedAt,
           Date().timeIntervalSince(lastLoadedAt) < Self.freshnessWindow,
           !codes.isEmpty || activeClaim != nil {
            return
        }

        // A pull-to-refresh supersedes an in-flight load instead of being
        // dropped, so the refresh control reflects a real fetch.
        if forceRefresh {
            loadTask?.cancel()
        } else if isLoading {
            return
        }

        let task = Task { await performLoad(forceRefresh: forceRefresh) }
        loadTask = task
        await task.value
    }

    private func performLoad(forceRefresh: Bool) async {
        isLoading = true
        if forceRefresh { error = nil }

        do {
            // The pool and the current claim are independent reads; awaiting
            // them in series doubled the time to first paint on a slow network.
            async let fetchedCodes = APIClient.shared.licenses()
            async let fetchedClaim = APIClient.shared.myLicense()
            let (loadedCodes, loadedClaim) = try await (fetchedCodes, fetchedClaim)
            guard !Task.isCancelled else { return }
            codes = loadedCodes
            activeClaim = loadedClaim
            error = nil
            lastLoadedAt = Date()
        } catch is CancellationError {
            // Superseded by a newer load, which owns `isLoading` from here.
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    /// Confirmations are transient. Leaving them pinned to the list meant a
    /// "copied for 2 minutes" banner outlived the clipboard entry it described.
    private func showNotice(_ message: String) {
        notice = message
        // The notice is a transient row in the middle of a list. Sighted users
        // see it arrive; VoiceOver users got no announcement at all, so a
        // successful claim or copy was silent to them.
        UIAccessibility.post(notification: .announcement, argument: message)
        noticeTask?.cancel()
        noticeTask = Task {
            try? await Task.sleep(for: Self.noticeLifetime)
            guard !Task.isCancelled else { return }
            notice = nil
        }
    }

    func resetDefaults() {
        loadTask?.cancel()
        noticeTask?.cancel()
        codes = []
        activeClaim = nil
        notice = nil
        error = nil
        lastLoadedAt = nil
        isLoading = false
    }

    func claim(_ code: LicenseCode) async {
        guard pendingActionId == nil else { return }
        pendingActionId = code.id
        notice = nil
        error = nil
        do {
            let result = try await APIClient.shared.claimLicense(id: code.id)
            await load(forceRefresh: true)
            // The claim response carries the code, so the person never has to
            // find a Copy button before pasting it into Photo Mechanic.
            UIPasteboard.general.setObjects(
                [result.code],
                localOnly: false,
                expirationDate: Date().addingTimeInterval(120)
            )
            Haptics.success()
            showNotice("License claimed. Code copied for 2 minutes.")
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
        pendingActionId = nil
    }

    func releaseActiveClaim() async {
        guard let activeClaim, pendingActionId == nil else { return }
        pendingActionId = activeClaim.id
        notice = nil
        error = nil
        do {
            try await APIClient.shared.releaseLicense(id: activeClaim.id)
            await load(forceRefresh: true)
            Haptics.success()
            showNotice("License returned.")
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
        pendingActionId = nil
    }

    func copyActiveCode() {
        guard let activeClaim else { return }
        UIPasteboard.general.setObjects(
            [activeClaim.code],
            localOnly: false,
            expirationDate: Date().addingTimeInterval(120)
        )
        Haptics.success()
        showNotice("Code copied for 2 minutes.")
    }
}


extension LicensesViewModel {
    /// Seats in use on a code. Released claims never count.
    static func activeClaims(of code: LicenseCode) -> [LicenseCodeClaim] {
        code.claims.filter { $0.releasedAt == nil }
    }

    /// The code "Claim a license" fills. Mirrors `handleClaimBest` on the web:
    /// half-used codes first so whole codes stay free, then the longest-lived
    /// expiry (no expiry counts as latest).
    static func bestClaimableCode(in codes: [LicenseCode]) -> LicenseCode? {
        func rank(_ code: LicenseCode) -> Int { code.status == .partial ? 0 : 1 }
        func expiry(_ code: LicenseCode) -> Date {
            LicenseExpiry.calendarDay(from: code.expiresAt) ?? .distantFuture
        }
        return codes
            .filter { ($0.status == .available || $0.status == .partial) && activeClaims(of: $0).count < 2 }
            .sorted { rank($0) != rank($1) ? rank($0) < rank($1) : expiry($0) > expiry($1) }
            .first
    }
}

struct LicensesView: View {
    var wrapsInNavigationStack = true

    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @State private var vm = LicensesViewModel()
    @State private var claimCandidate: LicenseCode?
    @State private var showReturnConfirm = false
    @State private var showHistory = false
    @State private var inspectedCode: LicenseCode?
    @State private var filter: LicensePoolFilter = .all

    private static let webManagementURL = AppEnvironment.url(path: "/licenses")

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var activeCodes: [LicenseCode] {
        vm.codes.filter { $0.status != .retired }
    }

    private var totalSlots: Int { activeCodes.count * 2 }

    private var usedSlots: Int {
        activeCodes.reduce(0) { $0 + min(LicensesViewModel.activeClaims(of: $1).count, 2) }
    }

    private var openSlotCount: Int { max(totalSlots - usedSlots, 0) }

    private var bestCode: LicenseCode? {
        LicensesViewModel.bestClaimableCode(in: vm.codes)
    }

    private var expiringCount: Int {
        activeCodes.filter { LicensePoolFilter.expiring.matches($0) }.count
    }

    private var retiredCount: Int {
        vm.codes.filter { $0.status == .retired }.count
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
            .navigationTitle("Licenses")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await vm.load(forceRefresh: true) }
            .task { await vm.load() }
            // Re-selecting the destination returns it to a first-run state, the
            // same gesture every other tab destination honours.
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 7 else { return }
                claimCandidate = nil
                showReturnConfirm = false
                showHistory = false
                inspectedCode = nil
                filter = .all
                vm.resetDefaults()
                Task { await vm.load() }
            }
            .sheet(isPresented: $showHistory) {
                LicenseHistorySheet()
            }
            .sheet(item: $inspectedCode) { code in
                LicenseCodeSheet(code: vm.codes.first { $0.id == code.id } ?? code, managementURL: Self.webManagementURL)
            }
            .confirmationDialog(
                "Claim Photo Mechanic license?",
                isPresented: claimConfirmBinding,
                titleVisibility: .visible
            ) {
                if let claimCandidate {
                    Button("Claim License") {
                        let code = claimCandidate
                        self.claimCandidate = nil
                        Task { await vm.claim(code) }
                    }
                    .tint(Color.statusText(.green))
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This takes one open slot and copies the code. You can return it at any time.")
            }
            .confirmationDialog(
                "Return Photo Mechanic license?",
                isPresented: $showReturnConfirm,
                titleVisibility: .visible
            ) {
                Button("Return License") {
                    Task { await vm.releaseActiveClaim() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The slot becomes available for someone else.")
            }
    }

    private var claimConfirmBinding: Binding<Bool> {
        Binding(
            get: { claimCandidate != nil },
            set: { isPresented in
                if !isPresented { claimCandidate = nil }
            }
        )
    }

    @ViewBuilder
    private var content: some View {
        if vm.codes.isEmpty && vm.activeClaim == nil && vm.isLoading {
            // Labelled so VoiceOver announces a real status rather than an
            // anonymous spinner, matching the Guides loading state.
            ProgressView("Loading licenses")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = vm.error, vm.codes.isEmpty && vm.activeClaim == nil {
            ContentUnavailableView {
                Label("Couldn't load licenses", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.codes.isEmpty {
            ContentUnavailableView(
                "No licenses",
                systemImage: "key",
                description: Text("No Photo Mechanic license codes are available.")
            )
        } else {
            licenseList
        }
    }

    /// One job per role. A holder sees their license; a student without one sees
    /// a single claim button; staff see the pool as a dense list of codes.
    private var licenseList: some View {
        List {
            primarySection

            if let notice = vm.notice {
                Section {
                    Label(notice, systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Color.statusText(.green))
                }
            }

            if let error = vm.error {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(error, systemImage: "wifi.exclamationmark")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 2)
                }
            }

            if isStaffOrAdmin {
                staffPool
            } else {
                LicenseHoldersSection(codes: vm.codes, currentUserId: session.currentUser?.id)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
    }

    @ViewBuilder
    private var primarySection: some View {
        if let activeClaim = vm.activeClaim {
            Section {
                LicenseHeroCard(
                    claim: activeClaim,
                    isStaffOrAdmin: isStaffOrAdmin,
                    isPending: vm.pendingActionId != nil,
                    onCopy: { vm.copyActiveCode() },
                    onHistory: { showHistory = true },
                    onReturn: { showReturnConfirm = true }
                )
            }
            .listRowBackground(Color.statusBackground(.blue))
        } else if !isStaffOrAdmin {
            Section {
                ClaimLicenseHero(
                    openSlots: openSlotCount,
                    totalSlots: totalSlots,
                    isPending: vm.pendingActionId != nil,
                    onClaim: { claimCandidate = bestCode }
                )
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        }
    }

    @ViewBuilder
    private var staffPool: some View {
        Section {
            LicenseStaffSummary(
                openSlots: openSlotCount,
                totalSlots: totalSlots,
                expiringCount: expiringCount,
                canClaimForMe: vm.activeClaim == nil && bestCode != nil,
                isPending: vm.pendingActionId != nil,
                onClaimForMe: { claimCandidate = bestCode }
            )
        }

        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(LicensePoolFilter.allCases) { item in
                        LicenseFilterChip(title: item.title, isSelected: filter == item) {
                            filter = item
                        }
                    }
                }
            }
            .scrollClipDisabled()
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))

        let rows = vm.codes.enumerated().filter { filter.matches($0.element) }
        Section {
            if rows.isEmpty {
                Text("No codes match this filter.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            } else {
                ForEach(rows, id: \.element.id) { item in
                    Button { inspectedCode = item.element } label: {
                        LicenseCodeRow(code: item.element)
                    }
                    .buttonStyle(.plain)
                }
            }
        } footer: {
            if retiredCount > 0 {
                Text(retiredCount == 1
                     ? "1 retired code is listed for reference and is not counted as open."
                     : "\(retiredCount) retired codes are listed for reference and are not counted as open.")
            }
        }

        Section {
            Link(destination: Self.webManagementURL) {
                SettingsMenuRow(
                    title: "Manage on web",
                    subtitle: "Create, renew, retire, export, and audit license codes.",
                    systemImage: "arrow.up.right.square",
                    tint: Color.statusText(.blue)
                ) {
                    EmptyView()
                }
            }
        }
    }
}

enum LicensePoolFilter: String, CaseIterable, Identifiable {
    case all, available, full, expiring

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .available: "Has open slot"
        case .full: "Full"
        case .expiring: "Expiring"
        }
    }

    func matches(_ code: LicenseCode) -> Bool {
        switch self {
        case .all: return true
        case .available: return code.status == .available || code.status == .partial
        case .full: return code.status == .claimed
        case .expiring:
            guard code.status != .retired,
                  let daysLeft = LicenseExpiry.daysUntil(code.expiresAt) else { return false }
            return daysLeft <= 30
        }
    }
}

private struct LicenseFilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .foregroundStyle(isSelected ? Color.statusText(.blue) : Color.primary)
                .background(
                    isSelected ? Color.statusBackground(.blue) : Color.cardSurface,
                    in: Capsule()
                )
                .overlay {
                    Capsule().strokeBorder(isSelected ? Color.statusText(.blue).opacity(0.4) : Color.hairline, lineWidth: 0.5)
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Used and open slots as a row of capsules: solid blue is in use, light green is open.
private struct LicenseSlotMeter: View {
    let usedSlots: Int
    let totalSlots: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(totalSlots, 1), id: \.self) { index in
                Capsule()
                    .fill(index < usedSlots ? Color.statusText(.blue) : Color.statusText(.green).opacity(0.35))
                    .frame(height: 10)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("License slots")
        .accessibilityValue("\(usedSlots) of \(totalSlots) in use, \(max(totalSlots - usedSlots, 0)) open")
    }
}

/// A student without a license gets one job: claim. The app picks the code.
private struct ClaimLicenseHero: View {
    let openSlots: Int
    let totalSlots: Int
    let isPending: Bool
    let onClaim: () -> Void

    private var hasOpenSlot: Bool { openSlots > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Get a license code")
                    .font(.title2.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Text(hasOpenSlot
                     ? "One license code works on two machines. We pick an open slot for you and copy the code."
                     : "Every slot is in use. Check back after someone returns theirs.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                LicenseSlotMeter(usedSlots: totalSlots - openSlots, totalSlots: totalSlots)
                Text("\(openSlots) of \(totalSlots) slots open")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if hasOpenSlot {
                Button(action: onClaim) {
                    Label("Claim a code", systemImage: "key.horizontal.fill")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(Color.statusText(.green))
                .disabled(isPending)
            }
        }
        .padding(16)
        .background(Color.statusBackground(hasOpenSlot ? .green : .gray), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Color.statusText(hasOpenSlot ? .green : .gray).opacity(0.25), lineWidth: 0.5)
        }
        .padding(.horizontal, 16)
        .accessibilityElement(children: .contain)
    }
}

/// Student view of the pool: who is using Photo Mechanic right now. Names and
/// claim age only; no code strings, no per-code detail, no expiry.
private struct LicenseHoldersSection: View {
    let codes: [LicenseCode]
    let currentUserId: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var holders: [LicenseCodeClaim] {
        codes
            .filter { $0.status != .retired }
            .flatMap(LicensesViewModel.activeClaims(of:))
            .filter { ($0.user?.name.isEmpty == false) }
            .sorted { (parseLicenseDate($0.claimedAt) ?? .distantPast) > (parseLicenseDate($1.claimedAt) ?? .distantPast) }
    }

    var body: some View {
        let holders = holders
        if !holders.isEmpty {
            Section {
                ForEach(holders) { claim in
                    let isYou = claim.userId == currentUserId
                    let age = claimAge(claim.claimedAt)
                    HStack(spacing: 12) {
                        UserAvatarView(name: claim.user?.name ?? "", avatarUrl: claim.user?.avatarUrl, size: 32)
                            .accessibilityHidden(true)
                        if typeSize.isAccessibilitySize {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(claim.user?.name ?? "")
                                    .font(.body)
                                Text([isYou ? "you" : "", age].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        } else {
                            Text(claim.user?.name ?? "")
                                .font(.body)
                                .lineLimit(1)
                            if isYou {
                                Text("you")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Text(age)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(claim.user?.name ?? "")
                    .accessibilityValue([isYou ? "you" : "", age.isEmpty ? "" : "claimed \(age)"]
                        .filter { !$0.isEmpty }.joined(separator: ", "))
                }
            } header: {
                Text("In use now · \(holders.count)")
            }
        }
    }

    private func claimAge(_ raw: String?) -> String {
        guard let date = parseLicenseDate(raw) else { return "" }
        return date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }
}

/// Staff status summary: slot meter, open count, expiring count, and the one
/// action that is theirs when they hold nothing.
private struct LicenseStaffSummary: View {
    let openSlots: Int
    let totalSlots: Int
    let expiringCount: Int
    let canClaimForMe: Bool
    let isPending: Bool
    let onClaimForMe: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    title
                    Spacer(minLength: 8)
                    pill
                }
                VStack(alignment: .leading, spacing: 6) {
                    title
                    pill
                }
            }
            LicenseSlotMeter(usedSlots: totalSlots - openSlots, totalSlots: totalSlots)
            if canClaimForMe {
                Button(action: onClaimForMe) {
                    Label("Claim for me", systemImage: "key.horizontal.fill")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(Color.statusText(.green))
                .disabled(isPending)
            }
        }
        .padding(.vertical, 4)
    }

    private var title: some View {
        Text("\(openSlots) of \(totalSlots) slots open")
            .font(.headline)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private var pill: some View {
        if expiringCount > 0 {
            StatusPill(label: "\(expiringCount) expiring", tone: .orange)
        }
    }
}

/// One row per code: code, label and holder names, two seats, expiry, chevron.
private struct LicenseCodeRow: View {
    let code: LicenseCode

    private var claims: [LicenseCodeClaim] { LicensesViewModel.activeClaims(of: code) }

    private var revealsCode: Bool { !code.code.isEmpty }

    private func name(_ claim: LicenseCodeClaim) -> String {
        if let name = claim.user?.name, !name.isEmpty { return name }
        if let label = claim.occupantLabel, !label.isEmpty { return label }
        return "Unknown"
    }

    /// Holder names when any seat is filled; otherwise the label, or "Open" ("Retired" for a retired code).
    private var subtitle: String {
        if !claims.isEmpty { return claims.map(name).joined(separator: ", ") }
        let label = code.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let state = code.status == .retired ? "Retired" : "Open"
        return label.isEmpty ? state : "\(label) · \(state)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(code.code.isEmpty ? "License" : code.code)
                        .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { seats; status }
                    VStack(alignment: .leading, spacing: 6) { seats; status }
                }
            }
            Spacer(minLength: 6)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
                .frame(minHeight: 28)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .opacity(code.status == .retired ? 0.6 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(code.code.isEmpty ? "License" : code.code)
        .accessibilityValue("\(subtitle), \(min(claims.count, 2)) of 2 slots in use\(statusSpoken)")
        .accessibilityHint("Opens license details")
        .accessibilityAddTraits(.isButton)
        .contextMenu {
            if revealsCode {
                Button {
                    UIPasteboard.general.string = code.code
                } label: {
                    Label("Copy License Code", systemImage: "doc.on.doc")
                }
            }
        }
    }

    private var seats: some View {
        HStack(spacing: 6) {
            ForEach(0..<2, id: \.self) { index in
                seat(index < claims.count ? claims[index] : nil)
            }
        }
        // Avatars are fixed-size discs; capping their initials keeps them inside the circle.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    @ViewBuilder
    private var status: some View {
        if code.status == .retired {
            StatusPill(label: "Retired", tone: .gray)
        } else {
            LicenseExpiryChip(raw: code.expiresAt)
        }
    }

    private var statusSpoken: String {
        code.status == .retired ? ", retired" : ", \(expirySummary(code.expiresAt))"
    }

    @ViewBuilder
    private func seat(_ claim: LicenseCodeClaim?) -> some View {
        if let claim {
            UserAvatarView(name: name(claim), avatarUrl: claim.user?.avatarUrl, size: 28)
        } else {
            Circle()
                .strokeBorder(Color.statusText(.green).opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                .frame(width: 28, height: 28)
        }
    }
}

/// Staff detail for one code: copy it, see both seats, and hand off to the web
/// page for create, renew, retire, and audit.
private struct LicenseCodeSheet: View {
    let code: LicenseCode
    let managementURL: URL
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    private var claims: [LicenseCodeClaim] { LicensesViewModel.activeClaims(of: code) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(code.code.isEmpty ? "Code unavailable" : code.code)
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .textSelection(.enabled)
                    if let label = code.label, !label.isEmpty {
                        LabeledContent("Label", value: label)
                    }
                    if let email = code.accountEmail, !email.isEmpty {
                        LabeledContent("Account", value: email)
                    }
                    LabeledContent("Expires", value: expiryDate(code.expiresAt))
                    if !code.code.isEmpty {
                        Button {
                            UIPasteboard.general.setObjects([code.code], localOnly: false, expirationDate: Date().addingTimeInterval(120))
                            Haptics.success()
                            copied = true
                        } label: {
                            Label(copied ? "Copied for 2 minutes" : "Copy Code", systemImage: "doc.on.doc")
                                .frame(minHeight: 44)
                        }
                    }
                }

                Section("Slots") {
                    ForEach(0..<2, id: \.self) { index in
                        let claim = index < claims.count ? claims[index] : nil
                        HStack(spacing: 10) {
                            if let claim {
                                let name = claim.user?.name ?? claim.occupantLabel ?? "Unknown"
                                UserAvatarView(name: name, avatarUrl: claim.user?.avatarUrl, size: 28)
                                Text(name)
                            } else {
                                Circle()
                                    .strokeBorder(Color.statusText(.green).opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                                    .frame(width: 28, height: 28)
                                Text("Open slot").foregroundStyle(Color.statusText(.green))
                            }
                        }
                        .frame(minHeight: 44)
                        .accessibilityElement(children: .combine)
                    }
                }

                Section {
                    Link(destination: managementURL) {
                        Label("Manage on web", systemImage: "arrow.up.right.square")
                            .frame(minHeight: 44)
                    }
                } footer: {
                    Text("Renew, retire, release a slot, export, and audit on the web page.")
                }
            }
            .navigationTitle("License")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The signed-in person's own license: the code is the whole point, so it is
/// the largest thing on the card and the whole block copies it.
private struct LicenseHeroCard: View {
    let claim: ActiveLicenseClaim
    let isStaffOrAdmin: Bool
    let isPending: Bool
    let onCopy: () -> Void
    let onHistory: () -> Void
    let onReturn: () -> Void

    private var status: (label: String, tone: StatusTone) {
        guard let daysLeft = LicenseExpiry.daysUntil(claim.expiresAt) else { return ("Active", .green) }
        if daysLeft < 0 { return ("Expired", .red) }
        if daysLeft == 0 { return ("Expires today", .orange) }
        if daysLeft <= 30 { return ("\(daysLeft)d left", .orange) }
        return ("Active", .green)
    }

    private var urgentExpiryTone: Color {
        LicenseExpiry.daysUntil(claim.expiresAt).map { $0 <= 30 } == true ? expiryTone(claim.expiresAt) : .primary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Your Photo Mechanic license")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.statusText(.blue))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                StatusPill(label: status.label, tone: status.tone)
            }

            Button(action: onCopy) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(claim.code)
                        .font(.system(.title2, design: .monospaced).weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 5) {
                        Image(systemName: "doc.on.doc")
                        Text("Tap to copy")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color.hairline, lineWidth: 0.5)
                }
                .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("License code \(claim.code)")
            .accessibilityHint("Copies the code")

            HStack(alignment: .top, spacing: 24) {
                fact(isStaffOrAdmin ? "Held" : "Claimed", claimedDate(claim.claimedAt))
                fact("Expires", expiryDate(claim.expiresAt), tone: urgentExpiryTone)
            }

            actions
        }
        .padding(.vertical, 6)
    }

    private var actions: some View {
        VStack(spacing: 4) {
            Button(action: onCopy) {
                HStack(spacing: 6) {
                    Image(systemName: "doc.on.doc")
                    Text("Copy Code")
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .tint(Color.statusText(.blue))

            HStack(spacing: 8) {
                quietAction("History", "clock", action: onHistory)
                quietAction(isStaffOrAdmin ? "Release" : "Return", "rectangle.portrait.and.arrow.right", action: onReturn)
                    .disabled(isPending)
            }
        }
    }

    private func quietAction(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(title)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderless)
        .tint(.secondary)
    }

    private func fact(_ title: String, _ value: String, tone: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(tone)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LicenseExpiryChip: View {
    let raw: String?

    var body: some View {
        if let daysLeft = LicenseExpiry.daysUntil(raw),
           let day = LicenseExpiry.calendarDay(from: raw) {
            let date = day.formatted(date: .abbreviated, time: .omitted)
            if daysLeft < 0 {
                StatusPill(label: "Expired \(date)", tone: .red)
            } else if daysLeft <= 30 {
                StatusPill(label: "\(daysLeft == 0 ? "Expires today" : "\(daysLeft)d left") · \(date)", tone: .orange)
            } else {
                Text("Renews \(date)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The holder's recent claims and returns, from `/api/licenses/my/history`.
private struct LicenseHistorySheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [LicenseHistoryEntry] = []
    @State private var isLoading = true
    @State private var loadFailed = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading history")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if loadFailed {
                    ContentUnavailableView {
                        Label("History couldn't load", systemImage: "exclamationmark.triangle")
                    } actions: {
                        Button("Retry") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if entries.isEmpty {
                    ContentUnavailableView("No license claims yet", systemImage: "clock")
                } else {
                    List {
                        Section {
                            ForEach(entries) { entry in
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(entry.licenseCode.label ?? "Photo Mechanic license")
                                            .font(.subheadline.weight(.medium))
                                        Text(summary(entry))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    StatusPill(label: entry.releasedAt == nil ? "Active" : "Returned",
                                               tone: entry.releasedAt == nil ? .green : .gray)
                                }
                                .frame(minHeight: 44)
                                .accessibilityElement(children: .combine)
                            }
                        } footer: {
                            Text("Your recent Photo Mechanic claims and returns.")
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("License history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func summary(_ entry: LicenseHistoryEntry) -> String {
        let claimed = claimedSummary(entry.claimedAt)
        guard entry.releasedAt != nil else { return claimed }
        return "\(claimed) · \(claimedSummary(entry.releasedAt).replacingOccurrences(of: "Claimed", with: "returned"))"
    }

    private func load() async {
        isLoading = true
        loadFailed = false
        do {
            entries = try await APIClient.shared.myLicenseHistory()
        } catch {
            loadFailed = true
        }
        isLoading = false
    }
}

@MainActor
private func claimedSummary(_ raw: String?) -> String {
    guard let date = parseLicenseDate(raw) else { return "Claimed" }
    return "Claimed \(date.formatted(date: .abbreviated, time: .omitted))"
}

private func claimedDate(_ raw: String?) -> String {
    guard let date = parseLicenseDate(raw) else { return "—" }
    return date.formatted(date: .abbreviated, time: .omitted)
}

private func expiryDate(_ raw: String?) -> String {
    guard let raw, !raw.isEmpty else { return "No expiry set" }
    guard let day = LicenseExpiry.calendarDay(from: raw) else { return "On file" }
    return day.formatted(date: .abbreviated, time: .omitted)
}

/// Expiry dates are calendar dates, not instants.
///
/// `src/lib/license-dates.ts` states the storage contract: an expiry is an
/// annual calendar date encoded at UTC midnight, and readers must take its UTC
/// date parts rather than treat the encoded instant as a local moment. iOS was
/// formatting the raw instant in the device timezone, so anywhere west of UTC
/// every expiry rendered a day early — a 31 Dec license read "Expires Dec 30"
/// in Central — and both the "Expired" copy and the amber/red urgency tone
/// tipped over a full day before the license actually lapsed.
enum LicenseExpiry {
    /// The encoded calendar day, rebuilt in the device's own calendar.
    static func calendarDay(from raw: String?, calendar: Calendar = .current) -> Date? {
        guard let encoded = parseLicenseDate(raw) else { return nil }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let parts = utc.dateComponents([.year, .month, .day], from: encoded)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }

    /// Whole days from today's local calendar day to the expiry day. Negative
    /// once the licence has lapsed. Mirrors `licenseDaysUntilExpiry` on the web.
    static func daysUntil(_ raw: String?, now: Date = Date(), calendar: Calendar = .current) -> Int? {
        guard let expiry = calendarDay(from: raw, calendar: calendar) else { return nil }
        let today = calendar.startOfDay(for: now)
        return calendar.dateComponents([.day], from: today, to: expiry).day
    }
}

private func expirySummary(_ raw: String?) -> String {
    guard let raw, !raw.isEmpty else { return "No expiry date" }
    guard let day = LicenseExpiry.calendarDay(from: raw),
          let daysLeft = LicenseExpiry.daysUntil(raw) else { return "Expiry on file" }
    let formatted = day.formatted(date: .abbreviated, time: .omitted)
    return daysLeft < 0 ? "Expired \(formatted)" : "Expires \(formatted)"
}

@MainActor
private func expiryTone(_ raw: String?) -> Color {
    guard let daysLeft = LicenseExpiry.daysUntil(raw) else { return .secondary }
    if daysLeft < 0 { return Color.statusText(.red) }
    if daysLeft <= 30 { return Color.statusText(.orange) }
    return .secondary
}

private func parseLicenseDate(_ raw: String?) -> Date? {
    guard let raw, !raw.isEmpty else { return nil }
    return LicenseDateFormatters.fractional.date(from: raw) ?? LicenseDateFormatters.standard.date(from: raw)
}

private enum LicenseDateFormatters {
    // Read-only after initialization (formatOptions set once, then only
    // `.date(from:)` is called) — safe to share without actor isolation, and
    // keeps the expiry helpers callable from tests off the main actor. Same
    // treatment as GuideDateFormatters.
    nonisolated(unsafe) static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) static let standard: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
