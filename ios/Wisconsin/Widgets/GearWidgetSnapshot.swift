import Foundation

/// What the Home Screen widgets render.
///
/// The widget extension runs in its own process with its own container: no
/// session cookie, no keychain item, no `APIClient`. So it never fetches.
/// Everything it shows is written here by the app after a dashboard load and
/// read back out of the shared App Group container.
///
/// Treat this as a versioned contract between two processes. A widget binary
/// stays on the Home Screen across app updates, so every field added later
/// must decode from an older payload — give new fields defaults rather than
/// making them required.
struct GearWidgetSnapshot: Codable, Equatable, Sendable {
    struct Shift: Codable, Equatable, Sendable {
        let id: String
        /// The published event id is the deep-link identity. `id` is the
        /// person's shift assignment id and cannot be sent to Schedule's
        /// event route.
        let eventId: String?
        let title: String
        let area: String
        let startsAt: Date
        let endsAt: Date
        /// Site name carried by the event. Never derived from `isHome` — the
        /// home/away flag is not a venue (`docs/AREA_SHIFTS.md`), and a widget
        /// that guesses "Camp Randall" from a boolean is worse than a widget
        /// that says nothing.
        let locationName: String?
        /// Pre-resolved gear wording (`DashboardShift.gearLabel`), so the
        /// widget never has to know the gear status vocabulary.
        let gearLabel: String?

        private enum CodingKeys: String, CodingKey {
            case id, eventId, title, area, startsAt, endsAt, locationName, gearLabel
        }

        init(
            id: String,
            title: String,
            area: String,
            startsAt: Date,
            endsAt: Date,
            locationName: String?,
            gearLabel: String?,
            eventId: String? = nil
        ) {
            self.id = id
            self.eventId = eventId
            self.title = title
            self.area = area
            self.startsAt = startsAt
            self.endsAt = endsAt
            self.locationName = locationName
            self.gearLabel = gearLabel
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            eventId = try container.decodeIfPresent(String.self, forKey: .eventId)
            title = try container.decode(String.self, forKey: .title)
            area = try container.decode(String.self, forKey: .area)
            startsAt = try container.decode(Date.self, forKey: .startsAt)
            endsAt = try container.decode(Date.self, forKey: .endsAt)
            locationName = try container.decodeIfPresent(String.self, forKey: .locationName)
            gearLabel = try container.decodeIfPresent(String.self, forKey: .gearLabel)
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encodeIfPresent(eventId, forKey: .eventId)
            try container.encode(title, forKey: .title)
            try container.encode(area, forKey: .area)
            try container.encode(startsAt, forKey: .startsAt)
            try container.encode(endsAt, forKey: .endsAt)
            try container.encodeIfPresent(locationName, forKey: .locationName)
            try container.encodeIfPresent(gearLabel, forKey: .gearLabel)
        }
    }

    struct DueBooking: Codable, Equatable, Sendable {
        let id: String
        let title: String
        let endsAt: Date
        let itemCount: Int
        let isOverdue: Bool
    }

    /// When the app last wrote this. The widget shows staleness rather than
    /// asserting counts it cannot confirm.
    let generatedAt: Date
    let nextShift: Shift?
    /// A bounded cache of upcoming assignments. `nextShift` remains in the
    /// payload for older widget binaries; new timelines resolve this list at
    /// each boundary so an ended shift can advance to the next one.
    let upcomingShifts: [Shift]
    let dueBookings: [DueBooking]
    let overdueCount: Int
    let dueTodayCount: Int

    private enum CodingKeys: String, CodingKey {
        case generatedAt, nextShift, upcomingShifts, dueBookings, overdueCount, dueTodayCount
    }

    init(
        generatedAt: Date,
        nextShift: Shift?,
        dueBookings: [DueBooking],
        overdueCount: Int,
        dueTodayCount: Int,
        upcomingShifts: [Shift] = []
    ) {
        let cachedShifts = upcomingShifts.isEmpty
            ? nextShift.map { [$0] } ?? []
            : upcomingShifts
        self.generatedAt = generatedAt
        self.nextShift = nextShift ?? cachedShifts.first
        self.upcomingShifts = cachedShifts
        self.dueBookings = dueBookings
        self.overdueCount = overdueCount
        self.dueTodayCount = dueTodayCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try container.decode(Date.self, forKey: .generatedAt)
        let storedNextShift = try container.decodeIfPresent(Shift.self, forKey: .nextShift)
        let storedUpcomingShifts = try container.decodeIfPresent([Shift].self, forKey: .upcomingShifts) ?? []
        upcomingShifts = storedUpcomingShifts.isEmpty
            ? storedNextShift.map { [$0] } ?? []
            : storedUpcomingShifts
        nextShift = storedNextShift ?? upcomingShifts.first
        dueBookings = try container.decode([DueBooking].self, forKey: .dueBookings)
        overdueCount = try container.decode(Int.self, forKey: .overdueCount)
        dueTodayCount = try container.decode(Int.self, forKey: .dueTodayCount)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(generatedAt, forKey: .generatedAt)
        try container.encodeIfPresent(nextShift, forKey: .nextShift)
        try container.encode(upcomingShifts, forKey: .upcomingShifts)
        try container.encode(dueBookings, forKey: .dueBookings)
        try container.encode(overdueCount, forKey: .overdueCount)
        try container.encode(dueTodayCount, forKey: .dueTodayCount)
    }

    /// Re-resolves only values that are functions of the timeline date. The
    /// widget cannot fetch, but it can correctly move cached shifts and due
    /// bookings across known time boundaries without preserving stale claims.
    func resolved(at date: Date) -> GearWidgetSnapshot {
        let shifts = upcomingShifts.isEmpty
            ? nextShift.map { [$0] } ?? []
            : upcomingShifts
        let next = shifts
            .filter { $0.endsAt > date }
            .min { lhs, rhs in
                if lhs.startsAt != rhs.startsAt { return lhs.startsAt < rhs.startsAt }
                return lhs.id < rhs.id
            }
        let bookings = dueBookings
            .sorted { $0.endsAt < $1.endsAt }
            .map { booking in
                DueBooking(
                    id: booking.id,
                    title: booking.title,
                    endsAt: booking.endsAt,
                    itemCount: booking.itemCount,
                    isOverdue: booking.endsAt < date
                )
            }
        let overdue = bookings.filter(\.isOverdue).count
        let dueToday = bookings.filter {
            !$0.isOverdue && Calendar.current.isDate($0.endsAt, inSameDayAs: date)
        }.count

        return GearWidgetSnapshot(
            generatedAt: generatedAt,
            nextShift: next,
            dueBookings: bookings,
            overdueCount: overdue,
            dueTodayCount: dueToday,
            upcomingShifts: shifts
        )
    }

    static let empty = GearWidgetSnapshot(
        generatedAt: .distantPast,
        nextShift: nil,
        dueBookings: [],
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingShifts: []
    )
}

/// Shared App Group container for the app → widget handoff.
enum GearWidgetStore {
    /// Must match `com.apple.security.application-groups` on both the app and
    /// the widget extension. A build whose profile lacks the group still runs;
    /// the widgets just render their signed-out placeholder.
    static let appGroupIdentifier = "group.com.erikrole.Wisconsin"

    private static let snapshotKey = "gearWidgetSnapshot.v1"

    /// `nil` when the App Group is not provisioned for this build. Every
    /// caller degrades instead of trapping — a missing entitlement must never
    /// be able to crash the host app.
    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    static func write(_ snapshot: GearWidgetSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let defaults = sharedDefaults,
              let data = try? encoder.encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
    }

    static func read() -> GearWidgetSnapshot? {
        guard let defaults = sharedDefaults,
              let data = defaults.data(forKey: snapshotKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(GearWidgetSnapshot.self, from: data)
    }

    /// Cleared at every session boundary. A signed-out phone must never leave
    /// the previous account's shift and gear sitting on the Home Screen after
    /// the next widget refresh, even though this operational data is allowed
    /// to remain visible on an already-unlocked or glanceable surface.
    static func clear() {
        sharedDefaults?.removeObject(forKey: snapshotKey)
    }
}
