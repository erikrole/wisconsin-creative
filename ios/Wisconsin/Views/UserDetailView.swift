import SwiftUI

struct UserDetailView: View {
    let userId: String

    @Environment(SessionStore.self) private var session

    @State private var detail: AppUserDetail?
    @State private var badgeProfile: BadgeProfile?
    @State private var reservations: [Booking] = []
    @State private var checkouts: [Booking] = []
    @State private var shifts: [MyShift] = []
    @State private var pushedBookingId: String?
    @State private var selectedShift: MyShift?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showBadgeGallery = false
    @State private var selectedBadge: UserBadge?

    private var isCollaboratorDirectoryViewer: Bool {
        session.currentUser?.role == "COLLABORATOR" && session.currentUser?.id != userId
    }

    var body: some View {
        Group {
            if isLoading && detail == nil {
                UserDetailSkeleton()
            } else if let error, detail == nil {
                ContentUnavailableView {
                    Label("Couldn't load profile", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let detail {
                ScrollView {
                    VStack(spacing: Brand.Space.sm) {
                        profileHeader(detail)
                        if !isCollaboratorDirectoryViewer {
                            ProfileNextUpCard(
                                checkouts: checkouts,
                                reservations: reservations,
                                shifts: shifts,
                                openBooking: { pushedBookingId = $0 },
                                openShift: { selectedShift = $0 }
                            )
                            ScoreboardLinkCard(userId: detail.id)
                            badgesSection
                        }
                    }
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.vertical, Brand.Space.sm)
                }
                .background(Color(.systemGroupedBackground))
            }
        }
        .navigationTitle(detail?.name ?? "Profile")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(for: String.self) { bookingId in
            BookingDetailView(bookingId: bookingId)
        }
        .navigationDestination(item: $pushedBookingId) { bookingId in
            BookingDetailView(bookingId: bookingId)
        }
        .navigationDestination(item: $selectedShift) { shift in
            EventDetailView(event: shift.asScheduleEvent, myShift: shift, eventWork: nil)
        }
        .sheet(isPresented: $showBadgeGallery) {
            if let badgeProfile {
                BadgeGallerySheet(profile: badgeProfile)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
        }
        .sheet(item: $selectedBadge) { badge in
            BadgeDetailSheet(badge: badge)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private var badgesSection: some View {
        if let badgeProfile {
            BadgeShelfCard(
                profile: badgeProfile,
                openGallery: { showBadgeGallery = true },
                openBadge: { selectedBadge = $0 }
            )
        }
    }

    private func profileHeader(_ detail: AppUserDetail) -> some View {
        // Hero card mirrors ItemDetail's ItemHeroCard: identity leads in Gotham,
        // contact lines are monospaced + actionable, and role/joined read as
        // quiet metadata. Inactive accounts drop the role tone to gray.
        let tone: StatusTone = detail.active ? StatusTone.forRole(detail.role) : .gray
        return FormCard {
            HStack(alignment: .top, spacing: Brand.Space.md) {
                UserAvatarView(
                    name: detail.name,
                    avatarUrl: detail.avatarUrl,
                    size: 64,
                    fallbackBackground: Color.statusBackground(tone),
                    fallbackForeground: Color.statusText(tone),
                    showsBorder: false
                )
                .opacity(detail.active ? 1 : 0.6)

                VStack(alignment: .leading, spacing: 5) {
                    Text(detail.name)
                        .font(.gothamBlack(size: 22))
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    // The standing the Users list leads with. A profile that
                    // skipped it said less about the person than the row you
                    // tapped to reach it. Area is not joined onto this line --
                    // a long job title wraps, and " · Video" starting a line of
                    // its own reads as a rendering fault.
                    if let standing = UserIdentity.standing(
                        role: detail.role,
                        title: detail.title,
                        gradYear: detail.gradYear,
                        studentYearOverride: detail.studentYearOverride
                    ) {
                        Text(standing)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    HStack(spacing: 6) {
                        StatusPill.role(detail.role)
                        if !detail.active {
                            StatusPill(label: "Inactive", tone: .gray)
                        }
                    }
                    if let meta = metaLine(detail) {
                        Text(meta)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(profileAccessibilityLabel(detail))

            // Contact as things you do, not addresses to read -- and only for
            // other people. Offering to email or call yourself is a dead end,
            // and it was the one thing your own profile had that a teammate's
            // needed.
            if detail.id != session.currentUser?.id && (!detail.email.isEmpty || detail.phone?.isEmpty == false) {
                ContactActions(detail: detail)
            }
        }
    }

    /// The two quiet facts, together on one line: which area they work in and
    /// how long they have been here.
    private func metaLine(_ detail: AppUserDetail) -> String? {
        var parts: [String] = []
        if let area = detail.primaryArea, !area.isEmpty { parts.append(area.shiftAreaLabel) }
        if let joined = joinedLabel(detail.createdAt) { parts.append(joined) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }


    private func profileAccessibilityLabel(_ detail: AppUserDetail) -> String {
        var parts: [String] = [detail.name]
        if let standing = UserIdentity.standing(
            role: detail.role,
            title: detail.title,
            gradYear: detail.gradYear,
            studentYearOverride: detail.studentYearOverride
        ) {
            parts.append(standing)
        }
        parts.append(StatusTone.publicDirectoryRole(detail.role).capitalized)
        if !detail.active { parts.append("Inactive") }
        if let joined = joinedLabel(detail.createdAt) { parts.append(joined) }
        return parts.joined(separator: ", ")
    }

    private func joinedLabel(_ createdAt: String?) -> String? {
        guard let createdAt else { return nil }
        let date = ISO8601DateFormatter.gearBadge.date(from: createdAt)
            ?? ISO8601DateFormatter().date(from: createdAt)
        guard let date else { return nil }
        return "Joined \(date.formatted(.dateTime.month(.abbreviated).year()))"
    }

    private func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            if isCollaboratorDirectoryViewer {
                detail = try await APIClient.shared.user(id: userId)
                badgeProfile = nil
                checkouts = []
                reservations = []
                shifts = []
                return
            }
            async let detailTask = APIClient.shared.user(id: userId)
            async let badgeTask = loadBadgeProfileSafely()
            // Active only. The card said "Active Checkouts" while the request
            // asked for every checkout this person had ever made, so a profile
            // routinely listed four rows stamped "Completed" under a heading
            // promising the opposite.
            async let checkoutsTask = APIClient.shared.checkoutsByUser(userId: userId, activeOnly: true, limit: 5)
            async let reservationsTask = APIClient.shared.reservationsByUser(userId: userId, activeOnly: true, limit: 5)
            async let shiftsTask = try? await APIClient.shared.myShifts(userId: userId, limit: 5)
            let (d, b, c, r, s) = try await (detailTask, badgeTask, checkoutsTask, reservationsTask, shiftsTask)
            detail = d
            badgeProfile = b
            checkouts = c.data
            reservations = r.data
            shifts = s ?? []
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadBadgeProfileSafely() async -> BadgeProfile? {
        do {
            return try await APIClient.shared.userBadgeProfile(userId: userId)
        } catch {
            return nil
        }
    }
}

// MARK: - Badge shelf

/// The trophy shelf, shared by the profile you open for someone else and the
/// one you open for yourself. Earned medallions scroll horizontally so the
/// profile stays short; locked badges and progress live in the gallery sheet.
struct BadgeShelfCard: View {
    let profile: BadgeProfile
    let openGallery: () -> Void
    let openBadge: (UserBadge) -> Void

    @State private var tapFeedback = false

    /// How many medals fit before the shelf stops being a glance. Anything past
    /// this lives one tap away behind the overflow tile.
    private static let shelfLimit = 16

    var body: some View {
        if profile.disabled != true {
            FormCard {
                VStack(alignment: .leading, spacing: 12) {
                    header

                    if profile.earnedBadges.isEmpty {
                        emptyShelf
                    } else {
                        shelf
                    }

                    if !liveStreaks.isEmpty {
                        Divider()
                        // A run in force is the most motivating thing this
                        // system knows, and it has been tracked since the
                        // beginning while being shown to nobody.
                        ForEach(liveStreaks) { streak in
                            BadgeStreakRow(streak: streak)
                        }
                    }

                    if let next = closestToEarned {
                        Divider()
                        BadgeProgressRow(badge: next) {
                            tapFeedback.toggle()
                            openBadge(next)
                        }
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Image(systemName: "trophy")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(.orange))
                        .accessibilityHidden(true)
                    Text("Badges")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.04)
                }
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            Button(action: openGallery) {
                Label("See all", systemImage: "square.grid.2x2")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            // Neutral, not brand red: opening a gallery is not
            // urgent and not destructive.
            .tint(Color.primary)
            .accessibilityLabel("See all badges")
        }
        .accessibilityElement(children: .contain)
    }

    /// "12 earned" is the count; the fresh tally is the news. A badge earned
    /// this week is the reason to look at this card at all.
    private var subtitle: String {
        let freshCount = profile.earnedBadges.filter(\.recentlyEarned).count
        guard freshCount > 0 else { return "\(profile.earnedCount) earned" }
        return "\(profile.earnedCount) earned · \(freshCount) new this week"
    }

    private var emptyShelf: some View {
        // A profile with nothing on the shelf used to say only "No badges yet",
        // which reads as a dead end. There is always something in reach, and the
        // closest-to-earned row below says what it is.
        HStack(spacing: 10) {
            Image(systemName: "trophy")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text("No badges yet — they arrive as gear goes out and comes back.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var shelf: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 2) {
                ForEach(shelfBadges) { badge in
                    Button {
                        tapFeedback.toggle()
                        openBadge(badge)
                    } label: {
                        BadgeShelfItem(badge: badge)
                    }
                    .buttonStyle(.plain)
                }
                // The shelf silently dropped everything past the sixteenth
                // badge, so the most decorated profiles were the ones that
                // looked incomplete.
                if overflowCount > 0 {
                    Button(action: openGallery) {
                        BadgeShelfOverflowItem(count: overflowCount)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Newest first. Sorted by the catalog's `sortOrder`, a badge earned this
    /// morning could land fourteenth on a horizontal shelf that shows six --
    /// so the glow marking it as new was scrolled off the screen it was drawn
    /// for.
    private var shelfBadges: [UserBadge] {
        profile.earnedBadges
            .sorted { ($0.awardedDate ?? .distantPast) > ($1.awardedDate ?? .distantPast) }
            .prefix(Self.shelfLimit)
            .map { $0 }
    }

    private var overflowCount: Int {
        max(0, profile.earnedBadges.count - Self.shelfLimit)
    }

    /// The unearned badge this person is nearest to earning. The server already
    /// derives real progress for threshold and streak badges; until now it was
    /// only legible after opening the gallery, so the shelf showed what you had
    /// and never what was within reach.
    ///
    /// Reads the visible collection, not every badge: the server derives real
    /// progress for the hidden easter eggs too, so an unfiltered pick would put
    /// a surprise badge's name and its progress bar on the profile card -- the
    /// most prominent place in the feature to give one away.
    private var closestToEarned: UserBadge? {
        profile.visibleBadges
            .filter(\.hasProgress)
            .max {
                // Ties broken by how few steps are left, so "9 of 10" leads
                // "90 of 100" instead of depending on catalog order.
                if $0.progressFraction != $1.progressFraction {
                    return $0.progressFraction < $1.progressFraction
                }
                return $0.progressRemaining > $1.progressRemaining
            }
    }

    private var liveStreaks: [BadgeStreakSummary] {
        (profile.streaks ?? []).filter(\.isWorthShowing)
    }
}

/// "4 on-time returns in a row · best 7". Current is the number that moves, so
/// it leads; the best is context, not the headline.
private struct BadgeStreakRow: View {
    let streak: BadgeStreakSummary

    private var tone: StatusTone {
        streak.type == "SCAN_CLEAN" ? .green : .blue
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: streak.systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.statusText(tone))
                .frame(width: 18)
                .accessibilityHidden(true)
            // A broken streak still says something worth knowing: what it was.
            Text(streak.current > 0 ? streak.label : "Streak reset")
                .font(.subheadline)
                .foregroundStyle(streak.current > 0 ? .primary : .secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            if streak.longest > streak.current {
                Text("best \(streak.longest)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            streak.current > 0
                ? "\(streak.label), best \(streak.longest)"
                : "Streak reset, best \(streak.longest)"
        )
    }
}

/// "3 of 5 · Gear Regular" with a bar. Only ever rendered for a badge whose
/// progress the server could actually derive.
private struct BadgeProgressRow: View {
    let badge: UserBadge
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text("Closest")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .textCase(.uppercase)
                        .tracking(0.04)
                    Text(badge.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(badge.progressCurrent ?? 0)/\(badge.progressTarget ?? 0)")
                        .font(.caption.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: badge.progressFraction)
                    .tint(badge.rarity.accent)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Closest badge: \(badge.name), \(badge.progressCurrent ?? 0) of \(badge.progressTarget ?? 0)")
    }
}

// MARK: - Contact

/// Email and phone as two equal actions. Neutral-tinted: reaching someone is
/// not a custody state, and blue here collided with the checked-out blue used
/// three rows down.
private struct ContactActions: View {
    let detail: AppUserDetail

    private var phoneURL: URL? {
        guard let phone = detail.phone, !phone.isEmpty else { return nil }
        return URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })")
    }

    var body: some View {
        HStack(spacing: Brand.Space.sm) {
            if let url = URL(string: "mailto:\(detail.email)") {
                Link(destination: url) {
                    ContactActionLabel(systemImage: "envelope.fill", title: "Email")
                }
                .accessibilityLabel("Email \(detail.name) at \(detail.email)")
            }
            if let phoneURL {
                Link(destination: phoneURL) {
                    ContactActionLabel(systemImage: "phone.fill", title: "Call")
                }
                .accessibilityLabel("Call \(detail.name)")
            }
        }
        .padding(.top, 2)
    }
}

private struct ContactActionLabel: View {
    let systemImage: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.caption.weight(.semibold))
                .accessibilityHidden(true)
            Text(title)
                .font(.subheadline.weight(.semibold))
        }
        .foregroundStyle(Color.primary)
        .frame(maxWidth: .infinity, minHeight: 40)
        .background(Color.cardSurfaceRaised, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 0.5))
    }
}

// MARK: - Loading skeleton

private struct UserDetailSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Brand.Space.sm) {
                // Hero card shape
                HStack(alignment: .top, spacing: Brand.Space.md) {
                    Circle()
                        .fill(Color.secondary.opacity(0.15))
                        .frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.secondary.opacity(0.15))
                            .frame(width: 160, height: 16)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.secondary.opacity(0.10))
                            .frame(width: 210, height: 11)
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.secondary.opacity(0.12))
                            .frame(width: 56, height: 16)
                    }
                    Spacer(minLength: 0)
                }
                .brandCard()

                // Two section-card shapes
                ForEach(0..<2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 10) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.secondary.opacity(0.12))
                            .frame(width: 120, height: 10)
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.secondary.opacity(0.08))
                            .frame(height: 52)
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.secondary.opacity(0.08))
                            .frame(height: 52)
                    }
                    .brandCard()
                }
            }
            .padding(.horizontal, Brand.Space.md)
            .padding(.vertical, Brand.Space.sm)
        }
        .background(Color(.systemGroupedBackground))
        .redacted(reason: .placeholder)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Compact medallion-first gallery tile. The artifact leads, the name and one
/// quiet meta line follow; the description and award note moved into the
/// detail sheet so tiles stay scannable in a grid.
private struct BadgeTile: View {
    let badge: UserBadge

    /// Tiles are laid out on a fixed adaptive grid, so the medal has to give way
    /// as text grows or the name is squeezed into nothing at accessibility
    /// sizes.
    @ScaledMetric(relativeTo: .footnote) private var medallionSize: CGFloat = 48

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .topTrailing) {
                BadgeMedallionView(badge: badge, size: medallionSize)
                if badge.recentlyEarned {
                    BadgeFreshDot()
                        .offset(x: 3, y: -1)
                }
            }
            VStack(spacing: 2) {
                Text(badge.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(badge.earned ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                Text(badge.tileMetaLine)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            if badge.hasProgress {
                ProgressView(value: badge.progressFraction)
                    .tint(badge.rarity.accent)
                    .frame(maxWidth: 88)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(
            badge.earned ? Color(.secondarySystemGroupedBackground) : Color(.secondarySystemGroupedBackground).opacity(0.55),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color(.separator).opacity(badge.earned ? 0.5 : 0.35), lineWidth: 0.5)
        )
        .shadow(color: badge.recentlyEarned ? badge.rarity.accent.opacity(0.20) : .clear, radius: 12, x: 0, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(badge.tileAccessibilityLabel)
        .accessibilityHint("Opens badge details.")
    }
}

/// The "New" marker. A dot rather than a chip: at gallery-tile scale a word
/// costs a line of the badge name, and this sits on a medal that is already
/// glowing.
private struct BadgeFreshDot: View {
    var body: some View {
        Circle()
            .fill(Color.statusText(.green))
            .frame(width: 10, height: 10)
            .overlay(Circle().strokeBorder(Color(.secondarySystemGroupedBackground), lineWidth: 2))
            .accessibilityHidden(true)
    }
}

/// Horizontal-shelf item for the profile card: medallion over a two-line name.
private struct BadgeShelfItem: View {
    let badge: UserBadge

    @ScaledMetric(relativeTo: .caption2) private var medallionSize: CGFloat = 52
    @ScaledMetric(relativeTo: .caption2) private var itemWidth: CGFloat = 82

    var body: some View {
        VStack(spacing: 6) {
            ZStack(alignment: .topTrailing) {
                BadgeMedallionView(badge: badge, size: medallionSize)
                if badge.recentlyEarned {
                    BadgeFreshDot()
                        .offset(x: 3, y: -1)
                }
            }
            Text(badge.name)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
                .lineLimit(2, reservesSpace: true)
        }
        // Grows with Dynamic Type instead of clipping the name into it. The
        // shelf scrolls horizontally, so a wider item costs nothing but scroll.
        .frame(width: itemWidth)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(badge.shelfAccessibilityLabel)
        .accessibilityHint("Opens badge details.")
    }
}

/// The tail of a long shelf: "+7 more", tapping through to the full gallery.
private struct BadgeShelfOverflowItem: View {
    let count: Int

    @ScaledMetric(relativeTo: .caption2) private var medallionSize: CGFloat = 52
    @ScaledMetric(relativeTo: .caption2) private var itemWidth: CGFloat = 82

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(Color.statusBackground(.gray))
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.25), lineWidth: max(1, medallionSize * 0.035))
                Text("+\(count)")
                    .font(.system(size: medallionSize * 0.32, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .frame(width: medallionSize, height: medallionSize)
            Text("more")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(2, reservesSpace: true)
        }
        .frame(width: itemWidth)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(count) more earned \(count == 1 ? "badge" : "badges")")
        .accessibilityHint("Opens the badge gallery.")
    }
}

struct BadgeGallerySheet: View {
    let profile: BadgeProfile
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var filter: BadgeGalleryFilter = .all
    @State private var selectedBadge: UserBadge?
    @State private var tapFeedback = false

    private var filteredBadges: [UserBadge] {
        profile.visibleBadges.filter { badge in
            switch filter {
            case .all: true
            case .earned: badge.earned
            case .locked: !badge.earned
            case .manual: badge.isManualRecognition
            case .rare: badge.rarity == .rare || badge.rarity == .legendary
            }
        }
    }

    /// Same five shelves as the web badges tab. Counts come from the whole
    /// visible collection; only the tile grid respects the active filter.
    private var sections: [BadgeGallerySection] {
        let filtered = filteredBadges
        return BadgeCollection.allCases.compactMap { collection in
            let collectionBadges = profile.visibleBadges.filter { $0.primaryCollection == collection }
            let displayBadges = filtered
                .filter { $0.primaryCollection == collection }
                .sorted { a, b in
                    if a.earned != b.earned { return a.earned }
                    return (a.awardedDate ?? .distantPast) > (b.awardedDate ?? .distantPast)
                }
            guard !displayBadges.isEmpty else { return nil }
            return BadgeGallerySection(
                collection: collection,
                badges: displayBadges,
                earnedCount: collectionBadges.filter(\.earned).count,
                totalCount: collectionBadges.count
            )
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    gallerySummary
                    filterChips

                    if sections.isEmpty {
                        ContentUnavailableView(
                            "No \(filter.title.lowercased()) badges",
                            systemImage: filter == .locked ? "lock" : "trophy",
                            description: Text("Try another gallery filter.")
                        )
                        .frame(maxWidth: .infinity, minHeight: 220)
                    } else {
                        ForEach(sections) { section in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Image(systemName: section.collection.systemImage)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                        .accessibilityHidden(true)
                                    Text(section.collection.title)
                                        .font(.subheadline.weight(.semibold))
                                    Spacer(minLength: 8)
                                    Text(section.collection.countsTowardCompletion
                                        ? "\(section.earnedCount)/\(section.totalCount) earned"
                                        : "\(section.earnedCount) earned")
                                        .font(.caption2.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                                .accessibilityElement(children: .combine)

                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                                    ForEach(section.badges) { badge in
                                        Button {
                                            tapFeedback.toggle()
                                            selectedBadge = badge
                                        } label: {
                                            BadgeTile(badge: badge)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                    }

                    if profile.hiddenSurpriseCount > 0 && (filter == .all || filter == .locked) {
                        HiddenSurpriseCard(count: profile.hiddenSurpriseCount)
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Badge Gallery")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(item: $selectedBadge) { badge in
            BadgeDetailSheet(badge: badge)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    /// Mirrors the web tab's summary band: completion leads with a bar, then the
    /// three counts that explain it. The old middle cell read "Gallery" over the
    /// number of visible badges -- a total that answered no question anyone had,
    /// while "how many are left" went unanswered.
    private var gallerySummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(profile.completionPercent)%")
                        .font(.system(.largeTitle, design: .default, weight: .semibold))
                        .monospacedDigit()
                    Text("of automatic goals")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                ProgressView(value: Double(profile.completionPercent), total: 100)
                    .tint(Color.brandPrimary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(profile.completionPercent) percent of automatic goals complete")

            HStack(spacing: 8) {
                BadgeSummaryCell(value: "\(profile.earnedCount)", label: "Earned")
                BadgeSummaryCell(value: "\(profile.goalsRemainingCount)", label: "Goals left")
                if profile.hiddenSurpriseCount > 0 {
                    BadgeSummaryCell(value: "\(profile.hiddenSurpriseCount)", label: "Hidden")
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// The shared `FilterChip`, not a local capsule. The hand-rolled version
    /// this replaces was a 40pt target painted from `Color.accentColor`, and it
    /// never told VoiceOver which filter was active -- `FilterChip` carries the
    /// 44pt minimum and the `.isSelected` trait for every other filter strip in
    /// the app.
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(BadgeGalleryFilter.allCases) { item in
                    FilterChip(
                        label: item.title,
                        systemImage: item.systemImage,
                        isOn: filter == item,
                        tone: .blue
                    ) {
                        guard filter != item else { return }
                        tapFeedback.toggle()
                        if reduceMotion {
                            filter = item
                        } else {
                            withAnimation(.snappy(duration: 0.18)) { filter = item }
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }

}

struct BadgeDetailSheet: View {
    let badge: UserBadge
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    hero
                    detailGrid

                    if badge.hasProgress {
                        progressCard
                    }

                    if hasRecognitionNote {
                        recognitionCard
                    }

                    if !badge.earned && !badge.hasProgress {
                        // The one thing a locked badge with no measurable
                        // progress can still say: it is reachable, and how.
                        Label(
                            badge.trigger == "manual"
                                ? "Unlocks when a staff member recognises the work."
                                : "Unlocks from a qualifying gear or shift workflow.",
                            systemImage: "lock"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 2)
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Badge")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            BadgeMedallionView(badge: badge, size: 72)
            VStack(alignment: .leading, spacing: 8) {
                // Chips wrap rather than clip. A recently earned manual award of
                // a retired definition carries four of them, and on a narrow
                // phone the fixed row simply cut the last one off.
                HStack(spacing: 6) {
                    BadgeStatusChip(badge: badge)
                    if badge.recentlyEarned {
                        BadgeChip(text: "New", tone: .green)
                    }
                    // Nothing is deleted from the catalog -- retirement is
                    // `active = false` -- so an earned badge can outlive the goal
                    // it came from. Web says so and the phone did not.
                    if badge.isRetiredAward {
                        BadgeChip(text: "Retired", tone: .gray)
                    }
                    Text(badge.rarity.title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(badge.rarity.accent)
                }
                Text(badge.name)
                    .font(.title2.weight(.bold))
                    .textSelection(.enabled)
                Text(badge.description)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                // Rarity was an adjective with nothing behind it. The holder
                // count is the fact it is computed from, and the API has been
                // serving it all along.
                if let holdersLine = badge.holdersLine {
                    Text(holdersLine)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
    }

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Progress")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(badge.progressCurrent ?? 0)/\(badge.progressTarget ?? 0)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: badge.progressFraction)
                .tint(badge.rarity.accent)
            if badge.progressRemaining > 0 && badge.progressRemaining != .max {
                Text("\(badge.progressRemaining) to go")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Progress, \(badge.progressCurrent ?? 0) of \(badge.progressTarget ?? 0)")
    }

    private var hasRecognitionNote: Bool {
        (badge.note?.isEmpty == false) || (badge.awardedByName?.isEmpty == false)
    }

    /// The note and who wrote it. The attribution was served on every award row
    /// and dropped on the floor here, so a Staff Picks badge that someone chose
    /// to give you arrived on the phone unsigned.
    private var recognitionCard: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(badge.rarity.accent.opacity(0.7))
                .frame(width: 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Label("Award note", systemImage: "checkmark.seal")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.3)
                if let note = badge.note, !note.isEmpty {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let awardedBy = badge.awardedByName, !awardedBy.isEmpty {
                    Text("— \(awardedBy)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }

    private var detailGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
            BadgeDetailMetric(label: "Category", value: badge.category.displayCategory)
            // Not "Not earned" -- the Earned metric beside it already says that,
            // and repeating it wasted the one slot that could explain how the
            // badge is come by at all.
            BadgeDetailMetric(label: "Source", value: badge.sourceText)
            BadgeDetailMetric(label: "Earned", value: badge.earnedDateText)
        }
    }
}

private struct BadgeSummaryCell: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.title3.weight(.bold))
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

private struct BadgeDetailMetric: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Shaped medallions (web BadgeMedallion parity)

/// The medal itself, at every size the badge page draws one.
///
/// This is the celebration popup's artwork, scaled down: a rarity-tinted
/// gradient disc under a white glyph, with a soft accent shadow. It used to be
/// a pale wash behind a tinted glyph, which meant the badge you had just
/// watched land as a solid coloured medal turned into a faint outline the
/// moment you went to look at it on your shelf. Locked badges keep the quiet
/// treatment -- an unearned medal should not shine.
private struct BadgeMedallionView: View {
    let badge: UserBadge
    let size: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var celebrate = false

    var body: some View {
        ZStack {
            // The celebration's halo, kept for the week a badge is new. On a
            // dense gallery grid every medal wearing one would just be haze.
            if badge.recentlyEarned {
                Circle()
                    .fill(badge.rarity.accentBackground)
                    .frame(width: size * 1.16, height: size * 1.16)
                    .blur(radius: size * 0.08)
            }

            if badge.earned {
                Circle()
                    .fill(badge.rarity.accent.gradient)
                // A hairline of light along the rim, so the disc reads as struck
                // metal rather than a flat swatch.
                Circle()
                    .strokeBorder(.white.opacity(0.28), lineWidth: max(1, size * 0.035))
            } else {
                // One medallion shape for every badge. The per-badge silhouettes
                // this replaces -- coin, hex, shield, stack -- were drawn from
                // hand-plotted paths, and `stack` in particular rendered as a
                // notched square behind an offset second square, which read as a
                // clipping fault rather than a medal.
                Circle()
                    .fill(Color.statusBackground(.gray))
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.25), lineWidth: max(1, size * 0.035))
            }

            // A locked badge keeps its own icon, dimmed. Every locked badge used
            // to draw `lock.fill`, which told you a badge existed but never what
            // it was -- the same "one glyph repeated" problem the icon map had,
            // just confined to the half of the shelf you have not earned yet.
            // What it takes is the reason to go get it.
            Image(systemName: BadgeArtwork.symbolName(for: badge.icon))
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(badge.earned ? AnyShapeStyle(.white) : AnyShapeStyle(Color.secondary))
                .opacity(badge.earned ? 1 : 0.55)
                // Driven by state, not by `recentlyEarned`. A symbol effect only
                // fires when its value *changes*, and `recentlyEarned` is derived
                // from the award date, so it held one value for the whole life of
                // the view and the bounce never played once.
                .symbolEffect(.bounce, options: .nonRepeating, value: celebrate)
        }
        .frame(width: size, height: size)
        .shadow(
            color: badge.earned ? badge.rarity.accent.opacity(badge.recentlyEarned ? 0.38 : 0.22) : .clear,
            radius: badge.recentlyEarned ? size * 0.22 : size * 0.12,
            x: 0,
            y: size * 0.06
        )
        .accessibilityHidden(true)
        .onAppear {
            guard badge.recentlyEarned, !reduceMotion, !celebrate else { return }
            celebrate = true
        }
    }
}

// MARK: - Award collections (web shelf parity)

/// The five award shelves shared with the web badges tab, in display order.
private enum BadgeCollection: String, CaseIterable, Identifiable {
    case gearFlow, reliability, scans, teamwork, staffPicks

    var id: String { rawValue }

    var title: String {
        switch self {
        case .gearFlow: "Gear Flow"
        case .reliability: "Reliability"
        case .scans: "Legacy Scan Awards"
        case .teamwork: "Teamwork"
        case .staffPicks: "Staff Picks"
        }
    }

    var systemImage: String {
        switch self {
        case .gearFlow: "shippingbox"
        case .reliability: "clock.badge.checkmark"
        case .scans: "qrcode.viewfinder"
        case .teamwork: "person.2"
        case .staffPicks: "sparkles"
        }
    }

    var countsTowardCompletion: Bool {
        self != .scans && self != .staffPicks
    }
}

private struct BadgeGallerySection: Identifiable {
    let collection: BadgeCollection
    let badges: [UserBadge]
    let earnedCount: Int
    let totalCount: Int

    var id: String { collection.id }
}

/// One chip shape for every badge state, so Earned, New, and Retired cannot
/// drift into three different pill treatments.
private struct BadgeChip: View {
    let text: String
    let tone: StatusTone

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color.statusBackground(tone), in: Capsule())
            .foregroundStyle(Color.statusText(tone))
    }
}

private struct BadgeStatusChip: View {
    let badge: UserBadge

    private var tone: StatusTone {
        guard badge.earned else { return .gray }
        return badge.source == "MANUAL" ? .purple : .green
    }

    private var label: String {
        guard badge.earned else { return "Locked" }
        return badge.source == "MANUAL" ? "Manual" : "Earned"
    }

    var body: some View {
        BadgeChip(text: label, tone: tone)
    }
}

private struct HiddenSurpriseCard: View {
    let count: Int

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.headline)
                .foregroundStyle(Color.statusText(.purple))
                .frame(width: 42, height: 42)
                .background(Color.statusBackground(.purple), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("Surprise badges")
                    .font(.subheadline.weight(.semibold))
                Text("\(count) hidden \(count == 1 ? "badge is" : "badges are") waiting for the right moment.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}

private enum BadgeGalleryFilter: String, CaseIterable, Identifiable {
    case all, earned, locked, manual, rare

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .earned: "Earned"
        case .locked: "Locked"
        case .manual: "Manual"
        case .rare: "Rare"
        }
    }

    var systemImage: String {
        switch self {
        case .all: "square.grid.2x2"
        case .earned: "checkmark.seal"
        case .locked: "lock"
        case .manual: "hand.thumbsup"
        case .rare: "sparkles"
        }
    }
}

/// The awards that stay out of the locked grid until they are earned, so a
/// surprise is still a surprise. This must stay equal to `HIDDEN_BADGE_KEYS` in
/// `src/lib/badges/display.ts`: it had fallen five keys behind, which spoiled
/// every v7 easter egg on iOS, undercounted the hidden tally, and made the same
/// user's completion percentage disagree with the web tab.
/// `tests/ios-badge-icon-coverage.test.ts` guards the two lists against drifting
/// apart again.
private let hiddenBadgeKeys: Set<String> = [
    "above_and_beyond",
    "event_hero",
    "clean_loop",
    "go_to_bed",
    "old_faithful",
    "battery_run",
    "buzzer_beater",
    "take_thirteen",
    "holiday_hours",
    "oops_damaged",
    "oops_missing",
    "running_late",
    "due_date_dancer",
    "calendar_tetris",
    "midnight_oil",
    "weekend_warrior",
    "leap_day",
]

private let legendaryBadgeKeys: Set<String> = [
    "above_and_beyond",
    "category_collector",
    "checkout_100",
]

private let rareBadgeKeys: Set<String> = [
    "event_hero",
    "clean_loop",
    "perfect_handoff",
    "full_kit_no_misses",
    "semester_streak",
    "reliable_regular",
    "go_to_bed",
]

private let uncommonBadgeKeys: Set<String> = [
    "clutch_cover",
    "rookie_run",
    "zero_errors",
    "streak_on_time_5",
    "streak_shifts_5",
]

private extension BadgeProfile {
    var visibleBadges: [UserBadge] {
        badges.filter { badge in
            badge.earned || (badge.active && !hiddenBadgeKeys.contains(badge.key))
        }
    }

    var hiddenSurpriseCount: Int {
        badges.filter { !$0.earned && $0.active && hiddenBadgeKeys.contains($0.key) }.count
    }

    /// The automatic goals completion is measured against. Manual recognition,
    /// hidden surprises, and retired history are all excluded, so no amount of
    /// staff generosity or easter-egg hoarding moves the number, and a retired
    /// badge nobody can earn any more cannot hold it down.
    var automaticGoals: [UserBadge] {
        badges.filter {
            $0.active && !$0.isManualRecognition && !hiddenBadgeKeys.contains($0.key)
        }
    }

    var goalsEarnedCount: Int { automaticGoals.filter(\.earned).count }

    var goalsRemainingCount: Int { max(0, automaticGoals.count - goalsEarnedCount) }

    var completionPercent: Int {
        let goals = automaticGoals
        guard !goals.isEmpty else { return 0 }
        return Int((Double(goalsEarnedCount) / Double(goals.count) * 100).rounded())
    }
}

private extension UserBadge {
    var isManualRecognition: Bool {
        source == "MANUAL" || (kind == "RULE" && trigger == "manual")
    }

    /// Mirrors the web tab's `primaryCollectionKey`: every badge lives on one
    /// shelf, while automatic milestones follow their earning workflow.
    var primaryCollection: BadgeCollection {
        if isManualRecognition { return .staffPicks }
        if category == "MILESTONE" && trigger == "checkout:opened" { return .gearFlow }
        if category == "MILESTONE" && trigger == "shift:completed" { return .teamwork }
        if category == "MILESTONE" { return .staffPicks }
        switch category {
        case "CHECKOUT": return .gearFlow
        case "ON_TIME": return .reliability
        case "SCAN": return .scans
        case "TRADE", "SHIFT": return .teamwork
        default: break
        }
        if key.contains("streak") || key.contains("reliable") || key.contains("zero_errors") { return .reliability }
        return .gearFlow
    }

    /// One quiet line under the tile name: earned date, progress, requirement,
    /// or how the badge unlocks.
    var tileMetaLine: String {
        if earned { return earnedDateText }
        if hasProgress { return "\(progressCurrent ?? 0)/\(progressTarget ?? 0)" }
        if let threshold, threshold > 0 { return "\(threshold) required" }
        return trigger == "manual" ? "Staff recognition" : "Locked"
    }

    /// The server computes rarity from how many people actually hold a badge,
    /// so prefer its answer. The local key lists below are the same
    /// difficulty-based guess the server falls back to for a badge nobody has
    /// earned yet, kept only so an older payload still renders.
    var rarity: BadgeRarity {
        if let served = servedRarity.flatMap(BadgeRarity.init(serverValue:)) { return served }
        if legendaryBadgeKeys.contains(key) { return .legendary }
        if rareBadgeKeys.contains(key) || (threshold ?? 0) >= 50 { return .rare }
        if key.hasPrefix("custom_") { return .uncommon }
        if uncommonBadgeKeys.contains(key) || (threshold ?? 0) >= 10 || (kind == "RULE" && trigger == "manual") {
            return .uncommon
        }
        return .common
    }

    var hasProgress: Bool {
        !earned && progressCurrent != nil && progressTarget != nil && (progressTarget ?? 0) > 0
    }

    var progressFraction: Double {
        guard hasProgress, let current = progressCurrent, let target = progressTarget, target > 0 else { return 0 }
        return min(1, Double(current) / Double(target))
    }

    /// How many more it takes. Used to break ties between two badges sitting at
    /// the same percentage.
    var progressRemaining: Int {
        guard hasProgress, let current = progressCurrent, let target = progressTarget else { return .max }
        return max(0, target - current)
    }

    /// An earned award whose definition has since been retired. Nothing is ever
    /// deleted from the catalog -- retirement is `active = false` -- so these
    /// stay on the shelf, and saying so is the difference between a piece of
    /// history and a goal someone might chase.
    var isRetiredAward: Bool { earned && !active }

    /// How scarce this badge actually is, in people rather than adjectives.
    /// Rarity is computed from exactly this number, and printing only the
    /// adjective asked people to trust a word with nothing behind it.
    var holdersLine: String? {
        guard let holders, holders > 0 else { return nil }
        return holders == 1 ? "1 person has this" : "\(holders) people have this"
    }

    /// How this badge is come by. Answers the same question whether or not it
    /// has been earned yet.
    var sourceText: String {
        if source == "MANUAL" { return "Manual award" }
        return trigger == "manual" ? "Staff award" : "Automatic"
    }

    var statusWord: String {
        if !earned { return "locked" }
        return source == "MANUAL" ? "awarded by staff" : "earned"
    }

    var tileAccessibilityLabel: String {
        var parts = [name, statusWord, tileMetaLine]
        if recentlyEarned { parts.insert("new", at: 1) }
        if isRetiredAward { parts.append("retired") }
        return parts.joined(separator: ", ")
    }

    /// The shelf only ever holds earned badges, but it used to say so in a
    /// hardcoded string that skipped both the fresh state and manual awards.
    var shelfAccessibilityLabel: String {
        var parts = [name]
        if recentlyEarned { parts.append("new") }
        parts.append(statusWord)
        if let earnedOn = awardedDate {
            parts.append(earnedOn.formatted(date: .abbreviated, time: .omitted))
        }
        return parts.joined(separator: ", ")
    }

    var recentlyEarned: Bool {
        guard earned, let date = awardedDate else { return false }
        let age = Date().timeIntervalSince(date)
        return age >= 0 && age <= 7 * 86_400
    }

    var awardedDate: Date? {
        guard let awardedAt else { return nil }
        return ISO8601DateFormatter.gearBadge.date(from: awardedAt)
            ?? ISO8601DateFormatter().date(from: awardedAt)
    }

    var earnedDateText: String {
        guard let date = awardedDate else { return earned ? "Earned" : "Not earned yet" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

private extension ISO8601DateFormatter {
    // Read-only after initialization (formatOptions set once, then only
    // `.date(from:)` is called) — safe to share without actor isolation.
    // `UserBadge` is a plain data model, not MainActor-bound, so this avoids
    // forcing the whole model into MainActor isolation for one cached formatter.
    nonisolated(unsafe) static let gearBadge: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension String {
    var displayCategory: String {
        switch self {
        case "CHECKOUT": "Checkout"
        case "ON_TIME": "On-time returns"
        case "SCAN": "Legacy scans"
        case "TRADE": "Trades"
        case "SHIFT": "Shifts"
        case "STREAK": "Streaks"
        case "MILESTONE": "Milestones"
        default: lowercased().replacingOccurrences(of: "_", with: " ")
        }
    }
}

// MARK: - Previews

#if DEBUG

/// Sample badge data for the canvas.
///
/// The badge page can only be reached behind a signed-in session against a live
/// API, which made every visual change to it a build-sign-in-navigate round
/// trip and left native visual acceptance open as a release gate. These build
/// the profile payload directly so the shelf, the gallery, and the detail sheet
/// can be checked in light and dark from the canvas.
///
/// Deliberately built through the memberwise initialiser rather than decoded
/// from a JSON literal: a new field on `UserBadge` then breaks this file at
/// compile time, which is the moment to decide how the badge page should show
/// it.
///
/// Internal rather than private, and DEBUG-only, so a test-target harness can
/// host these in a `UIHostingController` and capture the badge surfaces without
/// a signed-in session. That is how this pass was visually accepted.
enum BadgePreviewData {
    static func badge(
        key: String,
        name: String,
        description: String = "Sample badge description for the canvas.",
        icon: String = "Trophy",
        category: String = "CHECKOUT",
        kind: String = "COUNT",
        trigger: String = "checkout:opened",
        threshold: Int? = nil,
        active: Bool = true,
        earned: Bool = false,
        daysAgo: Int? = nil,
        source: String? = nil,
        note: String? = nil,
        awardedByName: String? = nil,
        progress: (current: Int, target: Int)? = nil,
        rarity: String = "Common",
        holders: Int = 12
    ) -> UserBadge {
        UserBadge(
            id: key,
            key: key,
            name: name,
            description: description,
            icon: icon,
            category: category,
            kind: kind,
            trigger: trigger,
            threshold: threshold,
            ruleKey: nil,
            active: active,
            sortOrder: 0,
            earned: earned,
            awardedAt: daysAgo.map {
                ISO8601DateFormatter.gearBadge.string(
                    from: Date().addingTimeInterval(-Double($0) * 86_400)
                )
            },
            source: source,
            note: note,
            awardedByName: awardedByName,
            progressCurrent: progress?.current,
            progressTarget: progress?.target,
            servedRarity: rarity,
            holders: holders
        )
    }

    /// A profile with something on every branch the page can draw: a fresh
    /// award, a manual award with a note, a retired badge that outlived its
    /// goal, measurable progress, and a hidden surprise that must stay out of
    /// both the grid and the closest-to-earned row.
    static var populated: BadgeProfile {
        BadgeProfile(
            userId: "preview-user",
            peerVisible: true,
            earnedCount: 5,
            totalCount: 9,
            badges: [
                badge(
                    key: "above_and_beyond",
                    name: "Above and Beyond",
                    description: "Memorable help that made the operation better.",
                    icon: "Trophy",
                    category: "MILESTONE",
                    kind: "RULE",
                    trigger: "manual",
                    earned: true,
                    daysAgo: 2,
                    source: "MANUAL",
                    note: "Stayed through the weather delay and reset the entire sideline kit solo.",
                    awardedByName: "Dana Whitfield",
                    rarity: "Legendary",
                    holders: 2
                ),
                badge(
                    key: "checkout_25",
                    name: "Gear Regular",
                    description: "Opened 25 checkouts.",
                    icon: "PackageCheck",
                    threshold: 25,
                    earned: true,
                    daysAgo: 40,
                    source: "AUTO",
                    rarity: "Rare",
                    holders: 4
                ),
                badge(
                    key: "on_time_10",
                    name: "Always On Time",
                    description: "Ten on-time returns.",
                    icon: "Clock3",
                    category: "ON_TIME",
                    trigger: "checkout:returned",
                    threshold: 10,
                    earned: true,
                    daysAgo: 90,
                    source: "AUTO",
                    rarity: "Uncommon",
                    holders: 9
                ),
                badge(
                    key: "first_checkout",
                    name: "First Checkout",
                    description: "Opened a first checkout.",
                    icon: "PackageOpen",
                    threshold: 1,
                    earned: true,
                    daysAgo: 220,
                    source: "AUTO",
                    rarity: "Common",
                    holders: 28
                ),
                badge(
                    key: "scan_25",
                    name: "Scan Veteran",
                    description: "A retired scan goal, kept because the award is real history.",
                    icon: "ScanLine",
                    category: "SCAN",
                    trigger: "scan:success",
                    threshold: 25,
                    active: false,
                    earned: true,
                    daysAgo: 300,
                    source: "AUTO",
                    rarity: "Uncommon",
                    holders: 10
                ),
                badge(
                    key: "deep_inventory",
                    name: "Deep Inventory",
                    description: "Twenty-five different serialized items handled.",
                    icon: "Boxes",
                    threshold: 25,
                    progress: (18, 25),
                    rarity: "Rare",
                    holders: 3
                ),
                badge(
                    key: "regular_rotation",
                    name: "Regular Rotation",
                    description: "Checkouts across six different weeks.",
                    icon: "CalendarRange",
                    threshold: 6,
                    progress: (5, 6),
                    rarity: "Uncommon",
                    holders: 7
                ),
                badge(
                    key: "under_the_lights",
                    name: "Under the Lights",
                    description: "Eight shifts that ran to 10 p.m. or later.",
                    icon: "MoonStar",
                    category: "SHIFT",
                    trigger: "shift:completed",
                    threshold: 8,
                    rarity: "Rare",
                    holders: 3
                ),
                // Hidden. Must not appear in the gallery grid, must not be
                // chosen as the closest-to-earned row, and must not move the
                // completion percentage -- even though the server derives real
                // progress for it.
                badge(
                    key: "old_faithful",
                    name: "Old Faithful",
                    description: "The same item checked out twenty-five times.",
                    icon: "Repeat2",
                    threshold: 25,
                    progress: (24, 25),
                    rarity: "Legendary",
                    holders: 1
                ),
            ],
            disabled: false,
            streaks: [
                BadgeStreakSummary(type: "ON_TIME_RETURN", current: 6, longest: 11, lastEventAt: nil),
            ]
        )
    }

    static var empty: BadgeProfile {
        BadgeProfile(
            userId: "preview-user",
            peerVisible: true,
            earnedCount: 0,
            totalCount: 2,
            badges: [
                badge(
                    key: "first_checkout",
                    name: "First Checkout",
                    icon: "PackageOpen",
                    threshold: 1,
                    progress: (0, 1)
                ),
            ],
            disabled: false,
            streaks: []
        )
    }
}

#Preview("Badge shelf") {
    ScrollView {
        VStack(spacing: Brand.Space.sm) {
            BadgeShelfCard(profile: BadgePreviewData.populated, openGallery: {}, openBadge: { _ in })
            BadgeShelfCard(profile: BadgePreviewData.empty, openGallery: {}, openBadge: { _ in })
        }
        .padding(Brand.Space.md)
    }
    .background(Color(.systemGroupedBackground))
}

#Preview("Badge gallery") {
    BadgeGallerySheet(profile: BadgePreviewData.populated)
}

#Preview("Badge detail — manual award") {
    BadgeDetailSheet(badge: BadgePreviewData.populated.badges[0])
}

#Preview("Badge detail — locked with progress") {
    BadgeDetailSheet(badge: BadgePreviewData.populated.badges[5])
}

#endif
