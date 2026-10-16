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
            _ = try await APIClient.shared.claimLicense(id: code.id)
            await load(forceRefresh: true)
            Haptics.success()
            showNotice("License claimed. Use Copy Code when you’re ready.")
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

struct LicensesView: View {
    var wrapsInNavigationStack = true

    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @State private var vm = LicensesViewModel()
    @State private var claimCandidate: LicenseCode?
    @State private var showReturnConfirm = false
    @State private var showHistory = false
    @State private var filter: LicensePoolFilter = .all

    private static let webManagementURL = AppEnvironment.url(path: "/licenses")

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var openSlotCount: Int {
        vm.codes.reduce(into: 0) { total, code in
            guard code.status != .retired else { return }
            let activeClaims = code.claims.filter { $0.releasedAt == nil }.count
            total += max(0, 2 - min(activeClaims, 2))
        }
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
                filter = .all
                vm.resetDefaults()
                Task { await vm.load() }
            }
            .sheet(isPresented: $showHistory) {
                LicenseHistorySheet()
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
                Text("This fills one slot on one code. You can return it at any time.")
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

    private var licenseList: some View {
        List {
            // One job per role: a holder sees their license first; everyone
            // else sees a single "ready to claim" prompt.
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
            } else {
                Section {
                    LicenseClaimPrompt(openSlotCount: openSlotCount)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

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

            poolHeader
            pool

            if isStaffOrAdmin {
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
                } footer: {
                    if retiredCount > 0 {
                        Text(retiredCount == 1
                             ? "1 retired code is listed for reference and is not counted as open."
                             : "\(retiredCount) retired codes are listed for reference and are not counted as open.")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var retiredCount: Int {
        vm.codes.filter { $0.status == .retired }.count
    }

    /// Filters answer a manager's questions ("which codes can I fill?", "what
    /// lapses soon?"). A student has one question, answered by the open cards.
    private var poolHeader: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text("License pool")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)

                if isStaffOrAdmin {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(LicensePoolFilter.allCases) { item in
                                LicenseFilterChip(
                                    title: item.title,
                                    isSelected: filter == item
                                ) {
                                    filter = item
                                }
                            }
                        }
                    }
                    .scrollClipDisabled()
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 0, trailing: 4))
    }

    private var filteredCodes: [(offset: Int, code: LicenseCode)] {
        Array(vm.codes.enumerated())
            .filter { _, code in isStaffOrAdmin ? filter.matches(code) : true }
            .map { (offset: $0.offset, code: $0.element) }
    }

    @ViewBuilder
    private var pool: some View {
        if filteredCodes.isEmpty {
            Section {
                Text("No codes match this filter.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        } else {
            ForEach(filteredCodes, id: \.code.id) { item in
                Section {
                    LicensePoolCard(
                        code: item.code,
                        position: item.offset + 1,
                        currentUserId: session.currentUser?.id,
                        activeClaim: vm.activeClaim,
                        isStaffOrAdmin: isStaffOrAdmin,
                        isPending: vm.pendingActionId == item.code.id
                    ) {
                        claimCandidate = item.code
                    }
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

/// The one prompt a person without a license needs before the pool.
private struct LicenseClaimPrompt: View {
    let openSlotCount: Int

    private var hasOpenSlot: Bool { openSlotCount > 0 }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: hasOpenSlot ? "key.horizontal.fill" : "key.slash")
                .font(.title2)
                .foregroundStyle(Color.statusText(hasOpenSlot ? .green : .gray))
                .frame(width: 48, height: 48)
                .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(hasOpenSlot
                     ? "\(openSlotCount) \(openSlotCount == 1 ? "slot" : "slots") ready to claim"
                     : "No open slots right now")
                    .font(.headline)
                Text(hasOpenSlot
                     ? "Pick any open card below. One code activates two machines."
                     : "Every slot is in use. Check back after someone returns theirs.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color.statusBackground(hasOpenSlot ? .green : .gray), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.statusText(hasOpenSlot ? .green : .gray).opacity(0.25), lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One code with its two activation seats. Holder names stay visible to
/// everyone the API names them to, and a full code is never dimmed or hidden:
/// the page is a view of who holds what, not just a list of what is free.
private struct LicensePoolCard: View {
    let code: LicenseCode
    let position: Int
    let currentUserId: String?
    let activeClaim: ActiveLicenseClaim?
    let isStaffOrAdmin: Bool
    let isPending: Bool
    let onClaim: () -> Void

    private var activeClaims: [LicenseCodeClaim] {
        code.claims.filter { $0.releasedAt == nil }
    }

    private func isOwnClaim(_ claim: LicenseCodeClaim) -> Bool {
        if let activeClaim, claim.id == activeClaim.claimId { return true }
        guard let currentUserId, let userId = claim.userId else { return false }
        return userId == currentUserId
    }

    private var isOwn: Bool {
        activeClaim?.id == code.id || activeClaims.contains(where: isOwnClaim)
    }

    private var isRetired: Bool { code.status == .retired }

    private var claimable: Bool {
        (code.status == .available || code.status == .partial) && activeClaims.count < 2
    }

    private var canClaim: Bool { claimable && activeClaim == nil }

    /// Staff see every code. A student sees only their own; the rest read as a
    /// label or "License N", never a masked string that looks like a code.
    private var revealsCode: Bool {
        (isStaffOrAdmin || isOwn) && !code.code.isEmpty
    }

    private var trimmedLabel: String? {
        guard let label = code.label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty else { return nil }
        return label
    }

    private var title: String {
        revealsCode ? code.code : (trimmedLabel ?? "License \(position)")
    }

    private var status: (label: String, tone: StatusTone) {
        if isOwn { return ("Yours", .blue) }
        switch code.status {
        case .available: return ("Open", .green)
        case .partial: return ("1 slot left", .green)
        case .claimed: return ("Full", .gray)
        case .retired: return ("Retired", .gray)
        case .unknown: return ("Unknown", .gray)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    if revealsCode {
                        Text(title)
                            .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                        if let trimmedLabel {
                            Text(trimmedLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text(title)
                            .font(.headline)
                            .lineLimit(2)
                    }
                    if isStaffOrAdmin, let email = code.accountEmail, !email.isEmpty {
                        Text(email)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                StatusPill(label: status.label, tone: status.tone)
            }

            VStack(spacing: 6) {
                ForEach(0..<2, id: \.self) { index in
                    LicenseSlotSeat(
                        claim: index < activeClaims.count ? activeClaims[index] : nil,
                        slotNumber: index + 1,
                        isStaffOrAdmin: isStaffOrAdmin,
                        isOwn: index < activeClaims.count && isOwnClaim(activeClaims[index])
                    )
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("\(min(activeClaims.count, 2)) of 2 slots in use")

            footer
        }
        .padding(.vertical, 4)
        .opacity(isRetired ? 0.7 : 1)
        // A staff member copies a code from the card; a long press does the
        // same. Gated on `revealsCode`, so the gesture never surfaces a code the
        // card is deliberately hiding.
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

    @ViewBuilder
    private var footer: some View {
        let showsExpiry = isStaffOrAdmin && !isRetired && code.expiresAt != nil
        let showsHint = !canClaim && !isRetired && (isOwn || claimable)
        let showsCopy = isStaffOrAdmin && revealsCode
        if showsExpiry || showsHint || showsCopy || canClaim {
            HStack(spacing: 8) {
                if showsExpiry {
                    LicenseExpiryChip(raw: code.expiresAt)
                } else if showsHint {
                    Text(isOwn ? "Your license" : "Return yours to switch")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                if showsCopy {
                    Button {
                        UIPasteboard.general.string = code.code
                    } label: {
                        Label("Copy Code", systemImage: "doc.on.doc")
                            .labelStyle(.iconOnly)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.borderless)
                    .tint(Color.statusText(.blue))
                    .accessibilityLabel("Copy license code")
                }

                if canClaim {
                    Button("Claim") {
                        onClaim()
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .frame(minHeight: 44)
                    .tint(Color.statusText(.green))
                    .disabled(isPending)
                    .accessibilityLabel("Claim \(trimmedLabel ?? "License \(position)")")
                }
            }
        }
    }
}

/// One seat of the two-machine activation: filled with the holder, or a dashed
/// outline that says it is open.
private struct LicenseSlotSeat: View {
    let claim: LicenseCodeClaim?
    let slotNumber: Int
    let isStaffOrAdmin: Bool
    let isOwn: Bool

    private var holderName: String? {
        guard let claim else { return nil }
        if let name = claim.user?.name, !name.isEmpty { return name }
        if isStaffOrAdmin, let label = claim.occupantLabel, !label.isEmpty { return label }
        return nil
    }

    var body: some View {
        HStack(spacing: 10) {
            if let claim {
                if let holderName {
                    UserAvatarView(name: holderName, avatarUrl: claim.user?.avatarUrl, size: 28)
                } else {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .background(Color.cardSurfaceRaised, in: Circle())
                }
                Text(holderName ?? "In use")
                    .font(.subheadline.weight(isOwn ? .semibold : .regular))
                    .foregroundStyle(holderName == nil ? .secondary : .primary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if isOwn {
                    Text("you")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if isStaffOrAdmin, claim.userId == nil {
                    StatusPill(label: "unknown", tone: .gray)
                }
            } else {
                Circle()
                    .strokeBorder(Color.statusText(.green).opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                    .frame(width: 28, height: 28)
                Text("Open slot")
                    .font(.subheadline)
                    .foregroundStyle(Color.statusText(.green))
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(claim == nil ? Color.clear : Color.cardSurfaceRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            if claim == nil {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.statusText(.green).opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            } else if isOwn {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.statusText(.blue).opacity(0.5), lineWidth: 1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(claim == nil
            ? "Slot \(slotNumber), open"
            : "Slot \(slotNumber), \(holderName ?? "in use")\(isOwn ? ", you" : "")")
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
