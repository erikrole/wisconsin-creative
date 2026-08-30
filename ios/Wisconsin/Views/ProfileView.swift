import SwiftUI
import TipKit
import UIKit
import UserNotifications

// MARK: - Profile

struct ProfileView: View {
    /// Home pushes Profile into its existing navigation path. The default keeps
    /// the standalone wrapper used by the performance harness and any future
    /// callers that present Profile as a root destination.
    var wrapsInNavigationStack = true
    /// A scene-restored command can enter Profile and continue to the exact
    /// Settings destination the user requested.
    var initialDestination: ProfileDestination? = nil
    private let myAvailabilityTip = MyAvailabilityTip()
    @Environment(SessionStore.self) private var session
    @Environment(ProfileCompletionStore.self) private var profileCompletion
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showPushPrompt = false
    @State private var prefsVM = NotificationPrefsViewModel()
    @State private var pushAuth: UNAuthorizationStatus = .notDetermined
    @State private var ownDetail: AppUserDetail?
    @State private var ownBadges: BadgeProfile?
    @State private var ownCheckouts: [Booking] = []
    @State private var ownReservations: [Booking] = []
    @State private var ownShifts: [MyShift] = []
    @State private var showBadgeGallery = false
    @State private var selectedBadge: UserBadge?
    @State private var pushedBookingId: String?
    @State private var selectedShift: MyShift?
    @State private var pushedInitialDestination: ProfileDestination?

    private static let manageAccountURL = AppEnvironment.baseURL
    private static let iosSettingsURL = URL(string: UIApplication.openSettingsURLString)!

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "ADMIN" || role == "STAFF"
    }

    private var isStudentWorker: Bool {
        if session.currentUser?.staffingType == "ST" { return true }
        return session.currentUser?.staffingType == nil && (session.currentUser?.role ?? "") == "STUDENT"
    }

    private var profileTitle: String {
        session.currentUser?.name.split(separator: " ").first.map(String.init) ?? "Profile"
    }

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack {
                profileContent
            }
        } else {
            profileContent
        }
    }

    private var profileContent: some View {
            List {
                headerSection
                nextUpSection
                scoreboardSection
                badgeSection
                profileCompletionSection
                scheduleSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle(profileTitle)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showPushPrompt) {
                PushPrePromptView()
                    .presentationDetents([.fraction(0.62), .large])
                    .presentationDragIndicator(.visible)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(value: ProfileDestination.settings) {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .navigationDestination(for: ProfileDestination.self) { dest in
                destinationView(for: dest)
            }
            .navigationDestination(item: $pushedBookingId) { bookingId in
                BookingDetailView(bookingId: bookingId)
            }
            .navigationDestination(item: $selectedShift) { shift in
                EventDetailView(event: shift.asScheduleEvent, myShift: shift, eventWork: nil)
            }
            .navigationDestination(item: $pushedInitialDestination) { destination in
                destinationView(for: destination)
            }
        // Settings surfaces use a neutral control tint (matching the web's
        // near-black accent) so toggles, buttons, and links don't inherit the
        // brand red and read destructive. Red here stays reserved for
        // genuinely destructive/urgent states (Sign Out, errors, overdue).
        .tint(.primary)
        .task { await prefsVM.load() }
        .task { await refreshPushAuth() }
        .task { await loadOwnProfile() }
        .sheet(isPresented: $showBadgeGallery) {
            if let ownBadges {
                BadgeGallerySheet(profile: ownBadges)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
        }
        .sheet(item: $selectedBadge) { badge in
            BadgeDetailSheet(badge: badge)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await refreshPushAuth() }
            }
        }
        .onAppear {
            if pushedInitialDestination == nil {
                pushedInitialDestination = initialDestination
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var headerSection: some View {
        Section {
            profileIdentity
                .padding(.vertical, 6)
        }
        .listRowBackground(Color(.secondarySystemGroupedBackground))
    }

    @ViewBuilder
    private var profileIdentity: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 12) {
                    AccountAvatar(size: 58)
                    StatusPill.role(session.currentUser?.role ?? "")
                }
                Text(session.currentUser?.name ?? "Account")
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                if let standing = ownStanding {
                    Text(standing)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            HStack(spacing: 14) {
                AccountAvatar(size: 58)
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.currentUser?.name ?? "Account")
                        .font(.title3.weight(.semibold))
                    // Your own standing, the same line everyone else's profile
                    // leads with. This card used to put your email address here
                    // in monospace -- the one fact you already know.
                    if let standing = ownStanding {
                        Text(standing)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 12)
                StatusPill.role(session.currentUser?.role ?? "")
            }
        }
    }

    private var ownStanding: String? {
        guard let detail = ownDetail else { return nil }
        return UserIdentity.line(
            role: detail.role,
            title: detail.title,
            gradYear: detail.gradYear,
            studentYearOverride: detail.studentYearOverride,
            primaryArea: detail.primaryArea
        )
    }

    /// The same Next Up a teammate's profile shows, built from your own work.
    /// Your profile and theirs are the same three blocks in the same order --
    /// who they are, what is coming, what they have earned.
    @ViewBuilder
    private var nextUpSection: some View {
        Section {
            ProfileNextUpCard(
                checkouts: ownCheckouts,
                reservations: ownReservations,
                shifts: ownShifts,
                openBooking: { pushedBookingId = $0 },
                openShift: { selectedShift = $0 }
            )
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    /// Your own season record. This is a list row rather than a card: a
    /// NavigationLink row already draws the system chevron and standard insets,
    /// which the hand-built card label was duplicating and then losing its
    /// padding to `listRowInsets(EdgeInsets())`.
    @ViewBuilder
    private var scoreboardSection: some View {
        if let userId = session.currentUser?.id {
            Section {
                NavigationLink {
                    ScoreboardView(userId: userId)
                } label: {
                    SettingsMenuRow(
                        title: "Scoreboard",
                        subtitle: ScoreboardLink.subtitle,
                        systemImage: "trophy",
                        tint: Color.statusText(.orange)
                    ) {
                        EmptyView()
                    }
                }
                .accessibilityHint(ScoreboardLink.hint)
            }
        }
    }

    /// Your own trophy shelf. Recognition was visible on every profile except
    /// the one belonging to the person who earned it.
    @ViewBuilder
    private var badgeSection: some View {
        if let ownBadges, ownBadges.disabled != true {
            Section {
                BadgeShelfCard(
                    profile: ownBadges,
                    openGallery: { showBadgeGallery = true },
                    openBadge: { selectedBadge = $0 }
                )
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
    }

    private func loadOwnProfile() async {
        guard let id = session.currentUser?.id else { return }
        async let detailTask = try? await APIClient.shared.user(id: id)
        async let badgeTask = try? await APIClient.shared.userBadgeProfile(userId: id)
        async let checkoutsTask = try? await APIClient.shared.checkoutsByUser(userId: id, activeOnly: true, limit: 5)
        async let reservationsTask = try? await APIClient.shared.reservationsByUser(userId: id, activeOnly: true, limit: 5)
        async let shiftsTask = try? await APIClient.shared.myShifts(limit: 5)
        let (detail, badges, checkouts, reservations, shifts) = await (detailTask, badgeTask, checkoutsTask, reservationsTask, shiftsTask)
        ownDetail = detail
        ownBadges = badges
        ownCheckouts = checkouts?.data ?? []
        ownReservations = reservations?.data ?? []
        ownShifts = shifts ?? []
    }

    @ViewBuilder
    private var profileCompletionSection: some View {
        if let user = session.currentUser, profileCompletion.hasIncompleteProfile(for: user.id) {
            Section {
                Button {
                    dismiss()
                    profileCompletion.presentManually(for: user.id)
                } label: {
                    SettingsMenuRow(
                        title: "Complete profile",
                        subtitle: "Review your missing contact, Wiscard, apparel, or photo details.",
                        systemImage: "person.crop.circle.badge.checkmark",
                        tint: Color.statusText(.orange)
                    ) {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the profile completion steps")
            } header: {
                Text("Account")
            }
        }
    }

    @ViewBuilder
    private var scheduleSection: some View {
        Section {
            NavigationLink(value: ProfileDestination.upcomingShifts) {
                SettingsMenuRow(
                    title: "Upcoming shifts",
                    subtitle: appState.myShiftCount == 1 ? "1 shift on deck" : "\(appState.myShiftCount) shifts on deck",
                    systemImage: "calendar",
                    tint: Color.statusText(.blue)
                ) {
                    SettingsCountBadge(
                        value: appState.myShiftCount,
                        tone: appState.myShiftCount > 0 ? .blue : .gray
                    )
                }
            }
            NavigationLink(value: ProfileDestination.overdueBookings) {
                SettingsMenuRow(
                    title: "Overdue bookings",
                    subtitle: appState.overdueCount == 1 ? "1 checkout needs attention" : "\(appState.overdueCount) checkouts need attention",
                    systemImage: "exclamationmark.triangle",
                    tint: appState.overdueCount > 0 ? Color.statusText(.red) : Color.secondary
                ) {
                    SettingsCountBadge(
                        value: appState.overdueCount,
                        tone: appState.overdueCount > 0 ? .red : .gray
                    )
                }
            }
            if isStudentWorker {
                NavigationLink(value: ProfileDestination.availability) {
                    SettingsMenuRow(
                        title: "My Availability",
                        subtitle: "Add unavailable times so staff can schedule around them.",
                        systemImage: "calendar.badge.clock",
                        tint: Color.statusText(.green)
                    ) {
                        EmptyView()
                    }
                    .popoverTip(myAvailabilityTip, arrowEdge: .bottom)
                }
            }
        } header: {
            Text("Schedule")
        } footer: {
            if isStudentWorker {
                Text("Availability blocks are advisory. Staff can still override after confirming.")
            }
        }
    }

    private func refreshPushAuth() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        pushAuth = settings.authorizationStatus
    }

    @ViewBuilder
    private func destinationView(for destination: ProfileDestination) -> some View {
        switch destination {
        case .settings:
            SettingsView(prefsVM: prefsVM, pushAuth: pushAuth)
        case .upcomingShifts:
            ProfilePlaceholderView(destination: destination)
        case .overdueBookings:
            if isStaffOrAdmin {
                OverdueReportView()
            } else {
                ProfilePlaceholderView(destination: destination)
            }
        case .availability:
            AvailabilityView(userId: session.currentUser?.id ?? "")
                .onAppear {
                    myAvailabilityTip.invalidate(reason: .actionPerformed)
                }
        case .notifications:
            NotificationSettingsView(
                prefsVM: prefsVM,
                pushAuth: $pushAuth,
                iosSettingsURL: Self.iosSettingsURL,
                showPushPrompt: { showPushPrompt = true }
            )
        case .accountSecurity:
            AccountSecuritySettingsView(manageAccountURL: Self.manageAccountURL)
        }
    }
}

struct SettingsMenuRow<Trailing: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: String
    let subtitle: String?
    let systemImage: String
    let tint: Color
    let trailing: () -> Trailing

    init(
        title: String,
        subtitle: String? = nil,
        systemImage: String,
        tint: Color,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.tint = tint
        self.trailing = trailing
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    SettingsRowIcon(systemImage: systemImage, tint: tint)
                    rowCopy
                    trailing()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                HStack(spacing: 12) {
                    SettingsRowIcon(systemImage: systemImage, tint: tint)
                    rowCopy
                    Spacer(minLength: 12)
                    trailing()
                }
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var rowCopy: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct SettingsRowIcon: View {
    let systemImage: String
    let tint: Color

    @ScaledMetric(relativeTo: .subheadline) private var iconSize: CGFloat = 34

    private var renderedSize: CGFloat { min(iconSize, 44) }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: renderedSize * 0.24, style: .continuous)
                .fill(tint.opacity(0.14))
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
        }
        .frame(width: renderedSize, height: renderedSize)
        .accessibilityHidden(true)
    }
}

private struct SettingsCountBadge: View {
    let value: Int
    let tone: StatusTone

    var body: some View {
        Text("\(value)")
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(Color.statusText(tone))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.statusBackground(tone), in: Capsule())
    }
}

// MARK: - Profile destinations

enum ProfileDestination: Hashable {
    case settings
    case upcomingShifts
    case overdueBookings
    case availability
    case notifications
    case accountSecurity
}

private struct ProfilePlaceholderView: View {
    let destination: ProfileDestination

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var systemImage: String {
        switch destination {
        case .upcomingShifts:
            "calendar"
        case .overdueBookings:
            "calendar.badge.exclamationmark"
        default:
            "lock"
        }
    }

    private var title: String {
        switch destination {
        case .upcomingShifts:
            "My Shifts"
        case .overdueBookings:
            "Overdue"
        default:
            "Unavailable"
        }
    }

    private var message: String {
        switch destination {
        case .upcomingShifts:
            "Open the Schedule tab to see your shifts."
        case .overdueBookings:
            "Open the Bookings tab to see overdue items."
        default:
            "This page is not available for your role on this device."
        }
    }
}
