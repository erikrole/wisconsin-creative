#if DEBUG
import Foundation

/// Debug-only capture fixture. `GEAROPS_FIXTURE=glance` launches the app with
/// a seeded projection, in-memory preferences, and no Keychain, network, or
/// notification access, and presents the popover content in a normal window so
/// review captures are repeatable without a signed-in account.
enum GearOpsFixture {
    static var isActive: Bool {
        ProcessInfo.processInfo.environment["GEAROPS_FIXTURE"] == "glance"
    }

    @MainActor
    static func makeModel() -> GearOpsModel {
        let defaults = UserDefaults(suiteName: "GearOpsFixture.\(UUID().uuidString)")!
        let model = GearOpsModel(
            client: FixtureClient(),
            defaults: defaults,
            bookingNotifications: FixtureNotifier(),
            credentialStore: FixtureCredentialStore(),
            autoStart: false
        )
        model.loadFixture(user: user, projection: projection(anchoredAt: .now))
        return model
    }

    static let user = GearOpsUser(
        id: "fixture-staff",
        name: "Jordan Avery",
        email: "jordan@example.edu",
        role: "STAFF"
    )

    /// Times are anchored to the top of the current hour so two captures in
    /// the same hour render identical operational labels.
    static func projection(anchoredAt now: Date) -> CompanionProjection {
        let calendar = Calendar.current
        let anchor = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        func hours(_ value: Double) -> Date { anchor.addingTimeInterval(value * 3_600) }

        let fieldHouse = OpenBooking.Location(id: "loc-field-house", name: "Field House")
        let videoOffice = OpenBooking.Location(id: "loc-video", name: "Video Office")
        let casey = OpenBooking.Person(id: "p-casey", name: "Casey Lin", avatarUrl: nil)
        let morgan = OpenBooking.Person(id: "p-morgan", name: "Morgan Diaz", avatarUrl: nil)
        let riley = OpenBooking.Person(id: "p-riley", name: "Riley Park", avatarUrl: nil)

        let openBookings = [
            OpenBooking(
                id: "fixture-open-overdue",
                title: "Hockey broadcast kit",
                endsAt: hours(-3),
                refNumber: "CO-1042",
                requester: casey,
                location: fieldHouse,
                serializedItems: [
                    .init(id: "i1", name: "Sony FX6 Camera", assetTag: "CAM-014"),
                    .init(id: "i2", name: "Wireless Lav Kit", assetTag: "AUD-203"),
                ],
                bulkItems: [.init(id: "i3", name: "SDI Cable 25ft", quantity: 4)]
            ),
            OpenBooking(
                id: "fixture-open-today",
                title: "Volleyball media day",
                endsAt: hours(4),
                refNumber: "CO-1051",
                requester: morgan,
                location: videoOffice,
                serializedItems: [.init(id: "i4", name: "Canon R5", assetTag: "CAM-022")],
                bulkItems: []
            ),
            OpenBooking(
                id: "fixture-open-tomorrow",
                title: "Football practice cameras",
                endsAt: hours(27),
                refNumber: "CO-1055",
                requester: riley,
                location: fieldHouse,
                serializedItems: [
                    .init(id: "i5", name: "Sony FX3", assetTag: "CAM-031"),
                    .init(id: "i6", name: "Tripod", assetTag: "SUP-110"),
                ],
                bulkItems: []
            ),
        ]

        let activity = [
            BookingActivitySnapshot(
                id: "fixture-pickup",
                title: "Soccer highlights shoot",
                kind: .reservation,
                status: .booked,
                startsAt: hours(-1),
                endsAt: hours(6),
                updatedAt: hours(-24),
                requester: morgan,
                location: videoOffice,
                serializedItems: [.init(id: "i7", name: "DJI Ronin", assetTag: "SUP-044")]
            ),
        ]

        let kiosks = [
            KioskDevice(
                id: "fixture-kiosk-1",
                name: "Video Office iPad",
                location: .init(id: "loc-video", name: "Video Office"),
                active: true,
                activated: true,
                lastSeenAt: now,
                appVersion: "1.4",
                appBuild: "88",
                osVersion: "26.0",
                deviceModel: "iPad",
                pendingPickupCount: 1,
                openCheckoutCount: 2
            ),
            KioskDevice(
                id: "fixture-kiosk-2",
                name: "Field House iPad",
                location: .init(id: "loc-field-house", name: "Field House"),
                active: true,
                activated: true,
                lastSeenAt: hours(-26),
                appVersion: "1.4",
                appBuild: "88",
                osVersion: "26.0",
                deviceModel: "iPad",
                pendingPickupCount: 0,
                openCheckoutCount: 0
            ),
        ]

        return CompanionProjection(
            version: 1,
            revision: 1,
            generatedAt: now,
            stats: GearOpsStats(checkedOut: openBookings.count, overdue: 1, reserved: 1, dueToday: 1),
            pendingPickupTotal: activity.count,
            openBookings: openBookings,
            bookingActivity: activity,
            kioskDevices: kiosks,
            kioskAccess: "available"
        )
    }
}

private struct FixtureError: Error {}

private actor FixtureClient: GearOpsServing {
    func login(email: String, password: String) async throws -> LoginResponse { throw FixtureError() }
    func renewCompanion(token: String) async throws -> String { throw FixtureError() }
    func companionProjection(token: String) async throws -> CompanionProjection { throw FixtureError() }
    func registerCompanionDevice(_ deviceToken: String, credential: String) async throws {}
    func revokeCompanion(credential: String) async throws {}
}

private actor FixtureCredentialStore: CompanionCredentialStoring {
    func loadToken() async throws -> String? { nil }
    func saveToken(_ token: String) async throws {}
    func loadUser() async throws -> GearOpsUser? { GearOpsFixture.user }
    func saveUser(_ user: GearOpsUser) async throws {}
    func deleteToken() async throws {}
    func deleteToken(ifMatching token: String) async throws {}
    func stageTokenForRevocation(_ token: String) async throws {}
    func loadPendingRevocations() async throws -> [String] { [] }
    func removePendingRevocation(_ token: String) async throws {}
}

private actor FixtureNotifier: BookingNotificationDelivering {
    func requestAuthorization() async {}
    func authorization() async -> BookingNotificationAuthorization { .authorized }
    func deliver(_ change: BookingChange, playsSound: Bool) async {}
    func removeNotifications(identifiers: [String]) async {}
    func clearPrivateNotifications() async {}
}
#endif
