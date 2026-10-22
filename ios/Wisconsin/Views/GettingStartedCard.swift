import SwiftUI

/// Where a "where do I start" row lands. Shared by the Welcome finish screen
/// and the Home Getting started card so both open the same screens.
enum StarterDestination {
    case schedule
    case gear
    case guides
    case notifications
    case availability

    @MainActor
    func open(in appState: AppState) {
        switch self {
        case .schedule:
            appState.selectedTab = 4
        case .gear:
            appState.selectedTab = 1
        case .guides:
            appState.pendingBrowseDestination = "guides"
            appState.selectedTab = 2
        case .availability:
            appState.pendingSettingsDestination = .availability
            appState.pendingSettingsRoute = true
        case .notifications:
            // Navigates to the settings screen only; the permission prompt
            // stays an explicit tap there, never an automatic side effect.
            appState.pendingSettingsDestination = .notifications
            appState.pendingSettingsRoute = true
        }
    }
}

/// Which Getting started rows a student has handled, kept per user on this
/// device. Holds row ids and a dismissed flag only, never profile values.
struct GettingStartedProgress: Codable, Equatable {
    var done: Set<String> = []
    var dismissed = false

    /// Same quiet window as the web card.
    static let windowDays = 14

    private static func key(for userId: String) -> String { "WisconsinGettingStarted.\(userId)" }

    static func load(for userId: String) -> GettingStartedProgress {
        guard let data = UserDefaults.standard.data(forKey: key(for: userId)),
              let saved = try? JSONDecoder().decode(GettingStartedProgress.self, from: data)
        else { return GettingStartedProgress() }
        return saved
    }

    func save(for userId: String) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: Self.key(for: userId))
    }

    /// True while a student's account is inside the first-weeks window.
    static func isInWindow(role: String, accountCreatedAt: String?, now: Date = Date()) -> Bool {
        guard role == "STUDENT", let accountCreatedAt, let created = parse(accountCreatedAt) else { return false }
        let age = now.timeIntervalSince(created) / 86_400
        return age >= 0 && age <= Double(windowDays)
    }

    private static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    /// Any "cannot work" block, weekly (class, job) or dated (days away), matching `isUnavailableBlock` on the web.
    static func hasUnavailableTime(in blocks: [AvailabilityBlock]) -> Bool {
        blocks.contains { ($0.intent ?? "CANNOT_WORK") == "CANNOT_WORK" }
    }
}

/// Loads and holds the checklist state. Owned by Home so the loading task
/// runs even while the card itself renders nothing.
@MainActor
@Observable
final class GettingStartedModel {
    private(set) var progress: GettingStartedProgress?
    private(set) var hasUnavailableTime = false
    private var userId: String?

    func load(for user: CurrentUser, completionStore: ProfileCompletionStore) async {
        guard user.role == "STUDENT", !user.isReadOnlyRolePreview,
              GettingStartedProgress.isInWindow(role: user.role, accountCreatedAt: user.accountCreatedAt)
        else {
            progress = nil
            return
        }
        userId = user.id
        progress = GettingStartedProgress.load(for: user.id)
        guard progress?.dismissed == false else { return }
        await completionStore.load(for: user)
        await reloadAvailability()
    }

    func reloadAvailability() async {
        guard let userId, progress?.dismissed == false else { return }
        if let blocks = try? await APIClient.shared.availabilityBlocks(userId: userId) {
            hasUnavailableTime = GettingStartedProgress.hasUnavailableTime(in: blocks)
        }
    }

    func mark(_ id: String) {
        guard let userId, var next = progress else { return }
        next.done.insert(id)
        progress = next
        next.save(for: userId)
    }

    func dismiss() {
        guard let userId, var next = progress else { return }
        next.dismissed = true
        progress = next
        next.save(for: userId)
    }
}

/// Quiet first-weeks checklist on Home. Every row is optional; nothing here
/// blocks the app, and it goes away on its own after two weeks.
struct GettingStartedCard: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(ProfileCompletionStore.self) private var completionStore

    let model: GettingStartedModel
    @State private var showAvailability = false

    private struct Row: Identifiable {
        let id: String
        let title: String
        let done: Bool
        let action: () -> Void
    }

    private var profileDone: Bool { completionStore.response?.completion.profileComplete == true }

    private var rows: [Row] {
        guard let user = session.currentUser, let progress = model.progress else { return [] }
        return [
            Row(id: "profile", title: "Finish your profile", done: profileDone) {
                completionStore.presentManually(for: user.id)
            },
            Row(id: "availability", title: "Add when you can’t work", done: model.hasUnavailableTime || progress.done.contains("availability")) {
                showAvailability = true
            },
            Row(id: "schedule", title: "Check the schedule", done: progress.done.contains("schedule")) {
                handled("schedule", then: .schedule)
            },
            Row(id: "guides", title: "Read the guides", done: progress.done.contains("guides")) {
                handled("guides", then: .guides)
            },
            Row(id: "notifications", title: "Turn on shift reminders", done: progress.done.contains("notifications")) {
                handled("notifications", then: .notifications)
            },
        ]
    }

    var body: some View {
        let rows = rows
        if let progress = model.progress, !progress.dismissed, !rows.allSatisfy(\.done) {
            card(rows)
                .sheet(isPresented: $showAvailability, onDismiss: { Task { await model.reloadAvailability() } }) {
                    NavigationStack {
                        AvailabilityView(userId: session.currentUser?.id ?? "")
                            .toolbar {
                                ToolbarItem(placement: .confirmationAction) {
                                    Button("Done") { showAvailability = false }
                                }
                            }
                    }
                }
        }
    }

    private func card(_ rows: [Row]) -> some View {
        let remaining = rows.filter { !$0.done }.count
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    FlatSectionTitle("Getting started")
                    Text(remaining == 1 ? "One thing left." : "\(remaining) things to look at in your first weeks.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button(action: model.dismiss) {
                    Image(systemName: "xmark")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, -10)
                .padding(.trailing, -12)
                .accessibilityLabel("Hide getting started")
            }
            .padding(.bottom, 8)
            ForEach(rows) { row in
                Divider().overlay(Color.flatDivider)
                Button(action: row.action) {
                    HStack(spacing: 12) {
                        Image(systemName: row.done ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(row.done ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                            .accessibilityHidden(true)
                        Text(row.title)
                            .font(.body.weight(row.done ? .regular : .semibold))
                            .foregroundStyle(row.done ? .secondary : .primary)
                            .strikethrough(row.done)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(row.done ? "Done" : "")
            }
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
        .accessibilityElement(children: .contain)
    }

    private func handled(_ id: String, then destination: StarterDestination) {
        model.mark(id)
        destination.open(in: appState)
    }
}
