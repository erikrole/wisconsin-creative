import SwiftUI
import UIKit

// MARK: - Calendar Subscription

struct ScheduleCalendarSubscriptionSheet: View {
    /// Which step failed, so the card can say so and the main action only
    /// waits on the failure that actually blocks it.
    private enum Failure {
        case load(String)
        case open(String)
        case reset(String)

        var title: String {
            switch self {
            case .load: return "Couldn't check your calendar feed"
            case .open: return "Couldn't open Apple Calendar"
            case .reset: return "Couldn't reset the link"
            }
        }

        var message: String {
            switch self {
            case let .load(message), let .open(message), let .reset(message): return message
            }
        }
    }

    /// A token older than this is re-read before handing it to Calendar, so a
    /// reset on another device cannot leave this one subscribing a dead link.
    private static let tokenFreshness: TimeInterval = 60

    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var lastOpenedAt = 0.0
    /// The raw feed token this device holds (Keychain). The server keeps only
    /// a hash, so a feed can exist without this device knowing its link.
    @State private var token: String?
    @State private var hasServerToken = false
    @State private var tokenLoadedAt: Date?
    @State private var isLoading = true
    @State private var isOpening = false
    @State private var isResetting = false
    @State private var failure: Failure?
    @State private var resetComplete = false
    @State private var showResetConfirmation = false

    /// "Last opened" is per account, not per device, so a different sign-in
    /// never reports someone else's calendar handoff.
    private var lastOpenedKey: String {
        "scheduleCalendarLastOpenedAt." + (session.currentUser?.id ?? "signed-out")
    }

    /// A feed exists but this device doesn't hold its link (it was created
    /// elsewhere, or before this device saved it). Getting one means a reset.
    private var needsNewLink: Bool { token == nil && hasServerToken }

    private var primaryActionTitle: String {
        if token != nil { return "Open Apple Calendar" }
        return hasServerToken ? "Get a New Link" : "Set Up in Apple Calendar"
    }

    private var currentUserId: String? { session.currentUser?.id }

    private func remember(_ newToken: String?) {
        token = newToken
        tokenLoadedAt = .now
        guard let currentUserId else { return }
        if let newToken {
            ShiftCalendarTokenStore.save(newToken, for: currentUserId)
        } else {
            ShiftCalendarTokenStore.remove(for: currentUserId)
        }
    }

    /// Opening without a known token would mint a new one and silently break
    /// an existing subscription, so an unfinished status check blocks it.
    private var loadFailed: Bool {
        if case .load = failure { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statusCard
                    explanationCard
                    if token != nil || hasServerToken {
                        securityCard
                    }
                    if let failure {
                        calendarErrorCard(failure)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Shift Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isOpening || isResetting)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    if needsNewLink {
                        showResetConfirmation = true
                    } else {
                        Task { await openCalendar() }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if isOpening {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: token == nil ? "calendar.badge.plus" : "arrow.up.forward.app")
                        }
                        Text(primaryActionTitle)
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.purple))
                .controlSize(.large)
                .disabled(isLoading || isOpening || isResetting || loadFailed)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .task {
                lastOpenedAt = UserDefaults.standard.double(forKey: lastOpenedKey)
                await loadStatus()
            }
            .confirmationDialog(
                "Reset private calendar link?",
                isPresented: $showResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset Link", role: .destructive) {
                    Task { await resetLink() }
                }
                Button("Keep Current Link", role: .cancel) {}
            } message: {
                Text("Existing calendar subscriptions will stop updating. You'll need to subscribe again with the new link.")
            }
            .interactiveDismissDisabled(isOpening || isResetting)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var statusCard: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: token == nil ? "calendar.badge.plus" : "calendar.badge.checkmark")
                .font(.title2)
                .foregroundStyle(Color.statusText(token == nil ? .purple : .green))
                .frame(width: 46, height: 46)
                .background(Color.statusBackground(token == nil ? .purple : .green), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                if isLoading {
                    Text("Checking your calendar feed")
                        .font(.headline)
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text(token != nil ? "Private feed ready" : hasServerToken ? "Feed active elsewhere" : "Ready to set up")
                        .font(.headline)
                    Text(statusDetail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if resetComplete {
                        Text("Link reset. Subscribe again, then remove the old calendar in Settings > Calendar > Accounts > Subscribed Calendars.")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.statusText(.purple))
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var explanationCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("How it works", systemImage: "arrow.triangle.2.circlepath")
                .font(.headline)
                .foregroundStyle(.primary)

            calendarExplanationRow("Shows your published shifts from a month ago to a year ahead. Shifts you've posted for trade start with 🔁.")
            calendarExplanationRow("Wisconsin Creative updates the feed when your assignment or call time changes.")
            calendarExplanationRow("Apple Calendar controls when subscribed calendars refresh.")
            calendarExplanationRow("Editing a calendar event does not change your official Schedule assignment.")
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var securityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Private Feed Link")
                .font(.headline)
            Text("Treat this link like a password. Reset it if it was shared or if an old calendar should stop receiving updates.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 16) {
                // Google Calendar and Outlook subscribe by URL rather than
                // webcal://, so the link itself is shareable too.
                if let token, let feedURL = feedURL(for: token) {
                    ShareLink(item: feedURL) {
                        Label("Share Link", systemImage: "square.and.arrow.up")
                    }
                    .disabled(isResetting || isOpening)
                }
                Button("Reset Private Link", role: .destructive) {
                    showResetConfirmation = true
                }
                .disabled(isResetting || isOpening)
            }
            .font(.subheadline.weight(.medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private func calendarExplanationRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Color.statusText(.purple))
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func calendarErrorCard(_ failure: Failure) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
            VStack(alignment: .leading, spacing: 4) {
                Text(failure.title)
                    .font(.subheadline.weight(.semibold))
                Text(failure.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            // Only a failed status check needs its own retry; open and reset
            // failures retry from their own buttons.
            if loadFailed {
                Button("Retry") { Task { await loadStatus() } }
                    .font(.caption.weight(.semibold))
                    .disabled(isLoading || isOpening || isResetting)
            }
        }
        .padding(14)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
    }

    private var statusDetail: String {
        if needsNewLink {
            return "Your feed was set up on another device. For security its link is only shown once, so get a new link to subscribe here. The old one stops updating."
        }
        guard lastOpenedAt > 0 else {
            return token == nil ? "Create a private feed and hand it to Apple Calendar." : "Open Apple Calendar to subscribe with this feed."
        }
        let date = Date(timeIntervalSince1970: lastOpenedAt)
        return "Apple Calendar last opened \(date.formatted(.relative(presentation: .named)))."
    }

    private func feedURL(for token: String) -> URL? {
        URL(string: "https://\(AppEnvironment.activeAPIHost)/api/shifts/ics/\(token)")
    }

    private func loadStatus() async {
        guard !isOpening, !isResetting else { return }
        isLoading = true
        failure = nil
        defer { isLoading = false }
        do {
            let saved = currentUserId.flatMap { ShiftCalendarTokenStore.token(for: $0) }
            let status = try await APIClient.shared.icsTokenStatus(checking: saved)
            hasServerToken = status.hasToken
            if let serverToken = status.token {
                // A pre-hashing token, returned once as the server upgrades it.
                remember(serverToken)
            } else if status.hasToken, let saved, status.matches != false {
                token = saved
                tokenLoadedAt = .now
            } else {
                // No feed, or this device's link was reset elsewhere.
                remember(nil)
            }
        } catch {
            failure = .load(error.localizedDescription)
        }
    }

    private func openCalendar() async {
        guard !isOpening, !isResetting else { return }
        isOpening = true
        failure = nil
        defer { isOpening = false }
        do {
            if let local = token, Date.now.timeIntervalSince(tokenLoadedAt ?? .distantPast) > Self.tokenFreshness {
                let status = try await APIClient.shared.icsTokenStatus(checking: local)
                hasServerToken = status.hasToken
                if status.matches == false {
                    remember(nil)
                    failure = .open("This link was reset on another device. Get a new link to subscribe here.")
                    return
                }
                tokenLoadedAt = .now
            }
            let activeToken: String
            if let token {
                activeToken = token
            } else {
                activeToken = try await APIClient.shared.generateICSToken()
                remember(activeToken)
                hasServerToken = true
            }
            guard let url = AppEnvironment.webcalURL(path: "/api/shifts/ics/\(activeToken)") else {
                failure = .open("The calendar link couldn't be created.")
                return
            }
            guard await UIApplication.shared.open(url) else {
                failure = .open("Apple Calendar didn't open. Try again from this screen.")
                return
            }
            lastOpenedAt = Date.now.timeIntervalSince1970
            UserDefaults.standard.set(lastOpenedAt, forKey: lastOpenedKey)
            resetComplete = false
            Haptics.success()
        } catch {
            failure = .open(error.localizedDescription)
            Haptics.warning()
        }
    }

    private func resetLink() async {
        guard !isResetting, !isOpening else { return }
        isResetting = true
        failure = nil
        defer { isResetting = false }
        do {
            remember(try await APIClient.shared.generateICSToken())
            hasServerToken = true
            lastOpenedAt = 0
            UserDefaults.standard.removeObject(forKey: lastOpenedKey)
            resetComplete = true
            Haptics.success()
        } catch {
            failure = .reset(error.localizedDescription)
            Haptics.warning()
        }
    }
}
