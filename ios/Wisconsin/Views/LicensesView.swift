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
                vm.resetDefaults()
                Task { await vm.load() }
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
                if let claimCandidate {
                    Text("This fills one slot on \(licenseTitle(claimCandidate)).")
                }
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
            Section {
                LicensePoolOverview(
                    hasActiveLicense: vm.activeClaim != nil,
                    openSlotCount: openSlotCount,
                    codeCount: vm.codes.filter { $0.status != .retired }.count
                )
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .listRowBackground(Color.clear)

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

            activeLicenseSection
            licensePoolSection

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
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var activeLicenseSection: some View {
        Section("My License") {
            if let activeClaim = vm.activeClaim {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: "key.fill")
                            .font(.headline)
                            .foregroundStyle(Color.statusText(.blue))
                            .frame(width: 40, height: 40)
                            .background(Color.statusBackground(.blue), in: Circle())

                        VStack(alignment: .leading, spacing: 3) {
                            Text(activeClaim.label?.isEmpty == false ? activeClaim.label! : "Photo Mechanic")
                                .font(.headline)
                            Text(claimedSummary(activeClaim.claimedAt))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 8)

                        StatusPill(label: "Yours", tone: .blue)
                    }

                    Text(activeClaim.code)
                        .font(.system(.body, design: .monospaced).weight(.medium))
                        .textSelection(.enabled)
                        .lineLimit(2)
                        .minimumScaleFactor(0.82)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.cardSurfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                    Label(expirySummary(activeClaim.expiresAt), systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(expiryTone(activeClaim.expiresAt))

                    Divider()

                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) {
                            activeLicenseButtons(activeClaim)
                        }
                        VStack(alignment: .leading, spacing: 10) {
                            activeLicenseButtons(activeClaim)
                        }
                    }
                }
                .padding(.vertical, 6)
                .listRowBackground(Color.statusBackground(.blue))
            } else {
                HStack(spacing: 12) {
                    Image(systemName: "key.slash")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                        .background(Color.cardSurfaceRaised, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("No active license")
                            .font(.headline)
                        Text(openSlotCount > 0 ? "Choose an open slot below when you need one." : "Every shared slot is currently in use.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func activeLicenseButtons(_ activeClaim: ActiveLicenseClaim) -> some View {
        Group {
            Button("Copy Code") {
                vm.copyActiveCode()
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .frame(minHeight: 44)
            .tint(Color.statusText(.blue))

            Button("Return License") {
                showReturnConfirm = true
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .frame(minHeight: 44)
            .disabled(vm.pendingActionId != nil)
        }
    }

    private var retiredCount: Int {
        vm.codes.filter { $0.status == .retired }.count
    }

    private var licensePoolSection: some View {
        Section {
            ForEach(vm.codes) { code in
                LicensePoolRow(
                    code: code,
                    currentUserId: session.currentUser?.id,
                    activeClaimId: vm.activeClaim?.id,
                    canRevealUnclaimedCodes: isStaffOrAdmin,
                    isPending: vm.pendingActionId == code.id
                ) {
                    claimCandidate = code
                }
            }
        } header: {
            Text("License Pool")
        } footer: {
            // Staff and admin receive retired codes from `/api/licenses`, but
            // the capacity summary above deliberately counts only live ones.
            // Without this the header said "across 2 codes" over a list of
            // three rows and left the reader to work out which was which.
            if retiredCount > 0 {
                Text(retiredCount == 1
                     ? "1 retired code is kept for reference. The summary above counts live codes only."
                     : "\(retiredCount) retired codes are kept for reference. The summary above counts live codes only.")
            }
        }
    }
}

private struct LicensePoolOverview: View {
    let hasActiveLicense: Bool
    let openSlotCount: Int
    let codeCount: Int

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: hasActiveLicense ? "checkmark.seal.fill" : "key.horizontal.fill")
                .font(.title2)
                .foregroundStyle(Color.statusText(hasActiveLicense ? .blue : availabilityTone))
                .frame(width: 48, height: 48)
                .background(Color.statusBackground(hasActiveLicense ? .blue : availabilityTone), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(hasActiveLicense ? "Your license is ready" : availabilityTitle)
                    .font(.headline)
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
    }

    private var availabilityTitle: String {
        openSlotCount == 0 ? "All licenses are in use" : "Licenses are available"
    }

    private var summary: String {
        let codeLabel = codeCount == 1 ? "code" : "codes"
        let slotLabel = openSlotCount == 1 ? "slot" : "slots"
        if hasActiveLicense {
            return "Copy your code below. \(openSlotCount) open \(slotLabel) remain across \(codeCount) \(codeLabel)."
        }
        return "\(openSlotCount) open \(slotLabel) across \(codeCount) shared \(codeLabel)."
    }

    private var availabilityTone: StatusTone {
        openSlotCount > 0 ? .green : .gray
    }
}

private struct LicensePoolRow: View {
    let code: LicenseCode
    let currentUserId: String?
    let activeClaimId: String?
    let canRevealUnclaimedCodes: Bool
    let isPending: Bool
    let onClaim: () -> Void

    private var activeClaims: [LicenseCodeClaim] {
        code.claims.filter { $0.releasedAt == nil }
    }

    private var slotCount: Int {
        min(activeClaims.count, 2)
    }

    private var isCurrentHolder: Bool {
        code.id == activeClaimId || activeClaims.contains { claim in
            guard let currentUserId else { return false }
            return claim.userId == currentUserId
        }
    }

    private var canClaim: Bool {
        activeClaimId == nil && (code.status == .available || code.status == .partial) && slotCount < 2
    }

    private var canRevealCode: Bool {
        canRevealUnclaimedCodes || isCurrentHolder
    }

    /// A retired code cannot be claimed by anyone, ever. Occupancy, a claim
    /// affordance, and "hidden until claimed" all describe a future it does not
    /// have, so the row drops to a single honest line.
    private var isRetired: Bool {
        code.status == .retired
    }

    /// The code string is already on screen, larger and selectable, in the
    /// My License card above. Repeating it here bought the reader nothing and
    /// put the same secret on the glass twice.
    private var showsCodeLine: Bool {
        !isRetired && !isCurrentHolder
    }

    /// Every code in the pool normally carries the same annual expiry, so a
    /// per-row date was three identical lines of chrome. Keep the line only
    /// when it has become something to act on.
    private var showsExpiry: Bool {
        guard !isRetired, !isCurrentHolder else { return false }
        guard let daysLeft = LicenseExpiry.daysUntil(code.expiresAt) else { return false }
        return daysLeft <= 30
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: statusSystemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.statusText(statusTone))
                    .frame(width: 36, height: 36)
                    .background(Color.statusBackground(statusTone), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(licenseTitle(code))
                        .font(.headline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)

                    if showsCodeLine {
                        Text(codeDisplay)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(code.code.isEmpty ? .secondary : .primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    } else if isRetired {
                        Text(retiredSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }

                Spacer(minLength: 8)

                // One pill, not two. A row you hold used to carry its open-slot
                // count and a separate "Yours", which read as two competing
                // verdicts on the same row.
                StatusPill(label: isCurrentHolder ? "Yours" : availabilityLabel,
                           tone: isCurrentHolder ? .blue : statusTone)
            }

            if !isRetired {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Label(slotSummary, systemImage: "person.2")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 8)

                    if canClaim {
                        Button("Claim") {
                            onClaim()
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .tint(Color.statusText(.green))
                        .disabled(isPending)
                    }
                }
            }

            if canRevealUnclaimedCodes, !code.code.isEmpty {
                Button("Copy Code", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = code.code
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .frame(minHeight: 44)
                .tint(Color.statusText(.blue))
            }

            if showsExpiry {
                Label(expirySummary(code.expiresAt), systemImage: "calendar")
                    .font(.caption)
                    .foregroundStyle(expiryTone(code.expiresAt))
            }
        }
        .padding(.vertical, 6)
        .opacity(isRetired ? 0.7 : 1)
        // A claimed code exists to be pasted into something else, and the row
        // renders it in a monospaced line you cannot select. Gated on the same
        // `canRevealCode` the visible line is: long press must never surface a
        // code the row is deliberately hiding.
        .contextMenu {
            if canRevealCode, !code.code.isEmpty {
                Button {
                    UIPasteboard.general.string = code.code
                } label: {
                    Label("Copy License Code", systemImage: "doc.on.doc")
                }
            }
        }
    }

    /// Retired rows say the two things that are still true — when it lapsed and
    /// that it is out of service — instead of "No one is using this code",
    /// which reads as an invitation.
    private var retiredSummary: String {
        guard LicenseExpiry.calendarDay(from: code.expiresAt) != nil else { return "No longer claimable" }
        return "\(expirySummary(code.expiresAt)) · No longer claimable"
    }

    private var codeDisplay: String {
        canRevealCode && !code.code.isEmpty ? code.code : "Code hidden until claimed"
    }

    private var slotSummary: String {
        if activeClaims.isEmpty { return "No one is using this code" }
        guard canRevealUnclaimedCodes else {
            return slotCount == 1 ? "1 of 2 slots in use" : "Both slots in use"
        }
        let names = activeClaims.map { claim -> String in
            if let name = claim.user?.name, !name.isEmpty { return name }
            if let label = claim.occupantLabel, !label.isEmpty { return label }
            return "Unknown occupant"
        }
        return "\(slotCount)/2 filled: \(names.joined(separator: ", "))"
    }

    private var statusTone: StatusTone {
        switch code.status {
        case .available: StatusTone.green
        case .partial: StatusTone.blue
        case .claimed: StatusTone.blue
        case .retired: StatusTone.gray
        case .unknown: StatusTone.gray
        }
    }

    private var availabilityLabel: String {
        switch code.status {
        case .available: "2 open"
        case .partial: "1 open"
        case .claimed: "Full"
        case .retired: "Retired"
        case .unknown: "Unknown"
        }
    }

    private var statusSystemImage: String {
        // On a code you hold, the status glyph is about you, not about the
        // remaining capacity — `person.badge.plus` read as "add someone".
        if isCurrentHolder { return "key.fill" }
        switch code.status {
        case .available: return "checkmark"
        case .partial: return "person.badge.plus"
        case .claimed: return "person.2.fill"
        case .retired: return "archivebox.fill"
        case .unknown: return "questionmark"
        }
    }

}

private func licenseTitle(_ code: LicenseCode) -> String {
    if let label = code.label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
        return label
    }
    return "Photo Mechanic"
}

@MainActor
private func claimedSummary(_ raw: String?) -> String {
    guard let date = parseLicenseDate(raw) else { return "Claimed" }
    return "Claimed \(date.formatted(date: .abbreviated, time: .omitted))"
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
