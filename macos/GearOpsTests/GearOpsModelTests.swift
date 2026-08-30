import Foundation
import XCTest
@testable import GearOps

@MainActor
final class GearOpsModelTests: XCTestCase {
    func testFailedRefreshPreservesLastTrustedCounts() async {
        let client = MockGearOpsClient()
        let defaults = isolatedDefaults()
        let model = GearOpsModel(client: client, defaults: defaults, bookingNotifications: NoopBookingNotifier(), credentialStore: InMemoryCredentialStore(), autoStart: false)

        await model.signIn(email: "admin@wisc.edu", password: "password")
        XCTAssertEqual(model.snapshot?.stats.checkedOut, 12)

        await client.setProjectionError(.network("offline"))
        await model.refresh()

        XCTAssertEqual(model.statusMessage, "Updates are unavailable. Showing the last confirmed data.")
        XCTAssertEqual(model.healthSeverity, .attention)
    }

    func testRestoreRefreshesExternalProjectionImmediately() async {
        let client = MockGearOpsClient()
        let defaults = isolatedDefaults()
        let credentials = InMemoryCredentialStore()
        let original = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        await original.signIn(email: "admin@wisc.edu", password: "password")
        XCTAssertEqual(original.snapshot?.stats.checkedOut, 12)

        await client.setCheckedOut(11)
        let restored = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        await restored.restoreSession()

        XCTAssertEqual(restored.snapshot?.stats.checkedOut, 11)
    }

    func testRestoreRecoversKeychainIdentityWhenPreferencesCacheIsMissing() async {
        let client = MockGearOpsClient()
        let credentials = InMemoryCredentialStore()
        let original = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        await original.signIn(email: "admin@wisc.edu", password: "password")

        await client.setCheckedOut(11)
        let restored = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        XCTAssertNil(restored.user, "the replacement defaults intentionally simulate the crash-lost cache")

        await restored.restoreSession()

        XCTAssertEqual(restored.user?.email, "admin@wisc.edu")
        XCTAssertEqual(restored.snapshot?.stats.checkedOut, 11)
        XCTAssertNil(restored.statusMessage)
    }

    func testRefreshRenewsCredentialBeforeReadingProjection() async {
        let client = MockGearOpsClient()
        let credentials = InMemoryCredentialStore()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")
        await client.setNextRenewedToken("renewed-credential")
        await model.refresh()

        let storedToken = await credentials.loadToken()
        let revokedCredentials = await client.revokedCredentials()
        XCTAssertEqual(storedToken, "renewed-credential")
        XCTAssertEqual(revokedCredentials, ["credential-admin@wisc.edu"])
        XCTAssertEqual(model.user?.email, "admin@wisc.edu")
        XCTAssertEqual(model.snapshot?.stats.checkedOut, 12)
    }

    func testCountPartialFailureDoesNotInstallFallbackZeroes() async {
        let client = MockGearOpsClient()
        let model = GearOpsModel(client: client, defaults: isolatedDefaults(), bookingNotifications: NoopBookingNotifier(), credentialStore: InMemoryCredentialStore(), autoStart: false)

        await model.signIn(email: "admin@wisc.edu", password: "password")
        XCTAssertEqual(model.snapshot?.stats.checkedOut, 12)

        await client.setProjectionError(.network("offline"))
        await model.refresh()

        XCTAssertEqual(model.snapshot?.stats.checkedOut, 12)
        XCTAssertEqual(model.snapshot?.stats.checkedOut, 12)
        XCTAssertEqual(model.statusMessage, "Updates are unavailable. Showing the last confirmed data.")
    }

    func testForbiddenKioskReadIsRestrictedNotCritical() async {
        let client = MockGearOpsClient(kioskAccess: "restricted")
        let model = GearOpsModel(client: client, defaults: isolatedDefaults(), bookingNotifications: NoopBookingNotifier(), credentialStore: InMemoryCredentialStore(), autoStart: false)

        await model.signIn(email: "staff@wisc.edu", password: "password")

        XCTAssertEqual(model.kioskAccess, .restricted)
        XCTAssertEqual(model.healthSeverity, .attention)
    }

    func testFailedKioskAccessIsVisibleAsAttention() async {
        let client = MockGearOpsClient(kioskAccess: "failed")
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )

        await model.signIn(email: "staff@wisc.edu", password: "password")

        XCTAssertEqual(model.kioskAccess, .failed)
        XCTAssertEqual(model.kioskHealthSeverity, .attention)
        XCTAssertEqual(model.kioskStatusSummary, "Could not refresh")
        XCTAssertEqual(model.healthSeverity, .attention)
    }

    func testCustodyCountUsesProjectionStatistic() async {
        let model = GearOpsModel(
            client: MockGearOpsClient(),
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")

        XCTAssertEqual(model.custodyCount, 12)
        XCTAssertEqual(model.menuBarAccessibilityLabel, "Wisconsin Creative, 12 active checkouts, healthy")
    }

    func testInvalidProjectionPreservesTrustedData() async {
        let client = MockGearOpsClient()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await model.signIn(email: "admin@wisc.edu", password: "password")

        let duplicate = makeBookingActivity(id: "booking-1")
        await client.setNextProjection(makeProjection(activities: [duplicate, duplicate], checkedOut: 99))
        await model.refresh()

        XCTAssertEqual(model.snapshot?.stats.checkedOut, 12)
        XCTAssertEqual(model.activeBookingActivity.count, 1)
        XCTAssertEqual(model.statusMessage, "Updates are unavailable. Showing the last confirmed data.")
    }

    func testDashboardEnvelopeDecodesOperationalLanes() throws {
        let json = """
        {
          "data": {
            "role": "ADMIN",
            "stats": { "checkedOut": 12, "overdue": 2, "reserved": 8, "dueToday": 4 },
            "overdueCount": 2,
            "pendingPickupTotal": 1
          },
          "partialFailures": []
        }
        """

        let decoded = try JSONDecoder().decode(DashboardStatsEnvelope.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.data.stats.checkedOut, 12)
        XCTAssertEqual(decoded.data.pendingPickupTotal, 1)
    }

    func testCompanionProjectionDecodesServerDateShape() throws {
        let json = """
        {
          "data": {
            "version": 1,
            "generatedAt": "2026-08-09T18:00:00.000Z",
            "stats": { "checkedOut": 1, "overdue": 0, "reserved": 0, "dueToday": 0 },
            "pendingPickupTotal": 0,
            "openBookings": [],
            "bookingActivity": [],
            "kioskDevices": [],
            "kioskAccess": "available"
          }
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let decoded = try decoder.decode(CompanionProjectionEnvelope.self, from: Data(json.utf8))

        XCTAssertEqual(decoded.data.version, 1)
        XCTAssertEqual(decoded.data.generatedAt.formatted(.iso8601), "2026-08-09T18:00:00Z")
    }

    func testCompanionProjectionClientUsesAuthenticatedGET() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProjectionGETURLProtocol.self]
        let client = GearOpsClient(
            baseURL: URL(string: "https://companion.test")!,
            sessionConfiguration: configuration
        )

        let projection = try await client.companionProjection(token: "test-credential")

        XCTAssertEqual(projection.stats.checkedOut, 1)
        XCTAssertEqual(projection.kioskAccess, "restricted")
    }

    func testFailedOpenBookingRefreshPreservesVisibleRows() async {
        let client = MockGearOpsClient()
        let model = GearOpsModel(client: client, defaults: isolatedDefaults(), bookingNotifications: NoopBookingNotifier(), credentialStore: InMemoryCredentialStore(), autoStart: false)

        await model.signIn(email: "admin@wisc.edu", password: "password")
        XCTAssertEqual(model.openBookings.map(\.title), ["Camera checkout"])

        await client.setProjectionError(.network("offline"))
        await model.refresh()

        XCTAssertEqual(model.openBookings.map(\.title), ["Camera checkout"])
        XCTAssertEqual(model.openBookingTotal, 1)
    }

    func testBookingNotificationBaselineIsQuietThenDeliversTransition() async {
        let client = MockGearOpsClient()
        let notifications = RecordingBookingNotifier()
        await client.setBookingActivity(makeBookingActivity(status: .booked), changed: false)
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: notifications,
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")
        let baselineChanges = await notifications.deliveredChanges()
        XCTAssertEqual(baselineChanges, [])

        await client.setBookingActivity(makeBookingActivity(status: .open), changed: true)
        await model.refresh()

        let deliveredTitles = await notifications.deliveredChanges().map(\.bookingTitle)
        XCTAssertEqual(deliveredTitles, ["Camera checkout"])
    }

    func testPendingPickupLaneIncludesDueReservationsAndStagedCheckouts() async {
        let client = MockGearOpsClient()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        await client.setBookingActivities([
            makeBookingActivity(id: "future", status: .booked, kind: .reservation, startsAt: now.addingTimeInterval(60)),
            makeBookingActivity(id: "due", status: .booked, kind: .reservation, startsAt: now.addingTimeInterval(-60)),
            makeBookingActivity(id: "staged", status: .pendingPickup, kind: .checkout, startsAt: now.addingTimeInterval(-120)),
        ])
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")

        XCTAssertEqual(model.pendingPickupBookings(at: now).map(\.id), ["staged", "due"])
    }

    func testSnapshotFreshnessUsesCompactElapsedTime() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        let snapshot = GearOpsSnapshot(
            stats: GearOpsStats(checkedOut: 1, overdue: 0, reserved: 0, dueToday: 0),
            pendingPickupTotal: 0,
            receivedAt: now.addingTimeInterval(-125),
            partialFailures: []
        )

        XCTAssertEqual(snapshot.freshnessLabel(at: now), "Updated 2m ago")
    }

    func testKeychainFailurePreservesCachedOperations() async {
        let client = MockGearOpsClient()
        let defaults = isolatedDefaults()
        let original = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await original.signIn(email: "admin@wisc.edu", password: "password")

        let restored = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: ThrowingCredentialStore(),
            autoStart: false
        )
        await restored.restoreSession()

        XCTAssertEqual(restored.user?.email, "admin@wisc.edu")
        XCTAssertEqual(restored.snapshot?.stats.checkedOut, 12)
        XCTAssertEqual(
            restored.statusMessage,
            "Secure credential access is unavailable. Showing the last confirmed data."
        )
    }

    func testRepeatedMissingCredentialReadsNeverTurnRestartIntoLogout() async {
        let client = MockGearOpsClient()
        let defaults = isolatedDefaults()
        let original = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await original.signIn(email: "admin@wisc.edu", password: "password")

        let restored = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await restored.restoreSession()

        XCTAssertEqual(restored.user?.email, "admin@wisc.edu")
        XCTAssertEqual(restored.snapshot?.stats.checkedOut, 12)
        XCTAssertEqual(
            restored.statusMessage,
            "Saved session is temporarily unavailable. Showing the last confirmed data."
        )

        await restored.restoreSession()

        XCTAssertEqual(restored.user?.email, "admin@wisc.edu")
        XCTAssertEqual(restored.snapshot?.stats.checkedOut, 12)
        XCTAssertEqual(
            restored.statusMessage,
            "Saved session is temporarily unavailable. Showing the last confirmed data."
        )
    }

    func testSignOutClearsLocalStateBeforeRemoteRevocationCompletes() async {
        let client = SuspendedGearOpsClient()
        let credentials = InMemoryCredentialStore()
        let defaults = isolatedDefaults()
        let model = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        await model.signIn(email: "first@wisc.edu", password: "password")
        await client.suspendNextRevocation()

        let signOut = Task { await model.signOut() }
        await client.waitUntilRevocationIsPending()

        let storedToken = await credentials.loadToken()
        let storedUser = await credentials.loadUser()
        XCTAssertNil(model.user)
        XCTAssertNil(model.snapshot)
        XCTAssertNil(defaults.data(forKey: "GearOpsCachedStateV1"))
        XCTAssertNil(storedToken)
        XCTAssertNil(storedUser)

        await model.signIn(email: "second@wisc.edu", password: "password")
        XCTAssertNil(model.user)

        await client.finishRevocation()
        await signOut.value

        await model.signIn(email: "second@wisc.edu", password: "password")
        XCTAssertEqual(model.user?.email, "second@wisc.edu")
    }

    func testSignOutSurfacesPersistentKeychainDeletionFailure() async {
        let credentials = DeleteFailingCredentialStore()
        let model = GearOpsModel(
            client: MockGearOpsClient(),
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        XCTAssertEqual(model.menuBarSymbol, "shippingbox")
        await model.signIn(email: "admin@wisc.edu", password: "password")

        await model.signOut()

        let deletionAttempts = await credentials.deletionAttempts()
        XCTAssertNil(model.user)
        XCTAssertEqual(deletionAttempts, 2)
        XCTAssertEqual(
            model.statusMessage,
            "Signed out locally. The saved companion credential could not be removed. Try signing out again."
        )
    }

    func testFailedRemoteRevocationIsRetriedFromPendingKeychainSlot() async {
        let client = MockGearOpsClient()
        let credentials = InMemoryCredentialStore()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        await model.signIn(email: "admin@wisc.edu", password: "password")
        await client.setRevocationError(.network("offline"))

        await model.signOut()

        let stagedTokens = await credentials.loadPendingRevocations()
        let activeToken = await credentials.loadToken()
        XCTAssertEqual(stagedTokens, ["credential-admin@wisc.edu"])
        XCTAssertNil(activeToken)

        await client.setRevocationError(nil)
        let retryingModel = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: true
        )
        _ = retryingModel
        for _ in 0..<100 {
            let pending = await credentials.loadPendingRevocations()
            if pending.isEmpty { break }
            await Task.yield()
        }

        let remaining = await credentials.loadPendingRevocations()
        XCTAssertTrue(remaining.isEmpty)
    }

    func testOldRefreshSuccessCannotOverwriteNewSession() async {
        let client = SuspendedGearOpsClient()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await model.signIn(email: "first@wisc.edu", password: "password")
        await client.suspendNextProjection()
        let oldRefresh = Task { await model.refresh() }
        await client.waitUntilProjectionIsPending()

        await model.signOut()
        await model.signIn(email: "second@wisc.edu", password: "password")
        await client.finishProjection(with: makeProjection(
            checkedOut: 99,
            generatedAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))
        await oldRefresh.value

        XCTAssertEqual(model.user?.email, "second@wisc.edu")
        XCTAssertEqual(model.snapshot?.stats.checkedOut, 22)
    }

    func testOldUnauthorizedRefreshCannotDeleteNewSession() async {
        let client = SuspendedGearOpsClient()
        let credentials = InMemoryCredentialStore()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: credentials,
            autoStart: false
        )
        await model.signIn(email: "first@wisc.edu", password: "password")
        await client.suspendNextProjection()
        let oldRefresh = Task { await model.refresh() }
        await client.waitUntilProjectionIsPending()

        await model.signOut()
        await model.signIn(email: "second@wisc.edu", password: "password")
        await client.failProjectionAsUnauthorized()
        await oldRefresh.value

        let storedToken = await credentials.loadToken()
        XCTAssertEqual(model.user?.email, "second@wisc.edu")
        XCTAssertEqual(storedToken, "credential-second@wisc.edu")
    }

    func testSameTimestampChangedProjectionStillInstalls() async {
        let client = MockGearOpsClient()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await model.signIn(email: "admin@wisc.edu", password: "password")

        await client.setCheckedOut(99, advanceRevision: false)
        await model.refresh()

        XCTAssertEqual(model.snapshot?.stats.checkedOut, 99)
    }

    func testRefreshRequestedWhileBusyRunsImmediatelyAfterCurrentRequest() async {
        let client = SuspendedGearOpsClient()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await model.signIn(email: "first@wisc.edu", password: "password")
        await client.suspendNextProjection()
        let firstRefresh = Task { await model.refresh() }
        await client.waitUntilProjectionIsPending()

        await client.setNextProjection(makeProjection(
            checkedOut: 44,
            revision: 44,
            generatedAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))
        await model.refresh()
        await client.finishProjection(with: makeProjection(
            checkedOut: 11,
            revision: 11,
            generatedAt: Date(timeIntervalSince1970: 1_800_000_100)
        ))
        await firstRefresh.value

        XCTAssertEqual(model.snapshot?.stats.checkedOut, 44)
    }

    func testSuspendedNotificationAuthorizationDoesNotBlockSignIn() async {
        let client = SuspendedGearOpsClient()
        let notifications = SuspendedBookingNotifier()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: notifications,
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await notifications.suspendNextAuthorization()
        let signIn = Task { await model.signIn(email: "first@wisc.edu", password: "password") }
        await signIn.value
        await notifications.waitUntilAuthorizationIsPending()

        XCTAssertFalse(model.isSigningIn)
        XCTAssertEqual(model.user?.email, "first@wisc.edu")

        await model.signOut()
        await notifications.finishAuthorization()
    }

    func testDeviceTokenRegistersAgainAfterReEnrollment() async {
        let client = MockGearOpsClient()
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await model.receiveDeviceToken("apns-token")
        await model.signIn(email: "first@wisc.edu", password: "password")
        await client.waitForRegistrations(count: 1)
        await model.signOut()
        await model.signIn(email: "second@wisc.edu", password: "password")
        await client.waitForRegistrations(count: 2)

        let registeredCredentials = await client.registeredCredentials()
        XCTAssertEqual(
            registeredCredentials,
            ["credential-first@wisc.edu", "credential-second@wisc.edu"]
        )
    }

    func testMenuBarSymbolTracksHealth() async {
        let model = GearOpsModel(
            client: MockGearOpsClient(),
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )
        await model.signIn(email: "admin@wisc.edu", password: "password")
        XCTAssertEqual(model.menuBarSymbol, "shippingbox.fill")

        model.statusMessage = "Offline"
        XCTAssertEqual(model.menuBarSymbol, "shippingbox.and.arrow.backward.fill")

        model.snapshot = nil
        XCTAssertEqual(model.menuBarSymbol, "exclamationmark.triangle.fill")
    }

    func testIdleKioskDoesNotEscalateHealth() async {
        let client = MockGearOpsClient()
        await client.setKioskDevices([
            makeKiosk(id: "idle", lastSeenAt: Date.now.addingTimeInterval(-60 * 60)),
        ])
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")

        XCTAssertEqual(model.healthSeverity, .healthy)
        XCTAssertEqual(model.healthLabel, "Healthy")
    }

    func testMutedCategoryIsNotDeliveredButStillAdvancesTheBaseline() async {
        let client = MockGearOpsClient()
        let notifications = RecordingBookingNotifier()
        let defaults = isolatedDefaults()
        let settings = NotificationSettingsStore(defaults: defaults)
        settings.setCategory(.checkout, enabled: false)
        await client.setBookingActivity(makeBookingActivity(status: .booked), changed: false)
        let model = GearOpsModel(
            client: client,
            defaults: defaults,
            bookingNotifications: notifications,
            credentialStore: InMemoryCredentialStore(),
            notificationSettings: settings,
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")

        await client.setBookingActivity(makeBookingActivity(status: .open), changed: true)
        await model.refresh()
        var delivered = await notifications.deliveredChanges()
        XCTAssertEqual(delivered, [], "a muted category must not alert")

        // The muted transition still became the baseline, so the next change is
        // compared against OPEN rather than replaying the checkout.
        await client.setBookingActivity(makeBookingActivity(status: .completed), changed: true)
        await model.refresh()
        delivered = await notifications.deliveredChanges()
        XCTAssertEqual(delivered.map(\.category), [.checkIn])
    }

    func testMonitoredKiosksPutFailuresFirst() async {
        let client = MockGearOpsClient()
        let now = Date.now
        await client.setKioskDevices([
            makeKiosk(id: "online", lastSeenAt: now.addingTimeInterval(-60)),
            makeKiosk(id: "inactive", active: false, lastSeenAt: now),
            makeKiosk(id: "stale", lastSeenAt: now.addingTimeInterval(-60 * 60)),
            makeKiosk(id: "offline", lastSeenAt: now.addingTimeInterval(-25 * 60 * 60)),
        ])
        let model = GearOpsModel(
            client: client,
            defaults: isolatedDefaults(),
            bookingNotifications: NoopBookingNotifier(),
            credentialStore: InMemoryCredentialStore(),
            autoStart: false
        )

        await model.signIn(email: "admin@wisc.edu", password: "password")

        XCTAssertEqual(model.monitoredKioskDevices.map(\.id), ["offline", "online", "stale", "inactive"])
    }

    private func isolatedDefaults() -> UserDefaults {
        let suite = "GearOpsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

}

private final class ProjectionGETURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let isExpectedRequest = request.httpMethod == "GET"
            && request.url?.path == "/api/companion/projection"
            && request.value(forHTTPHeaderField: "Authorization") == "Bearer test-credential"
        let statusCode = isExpectedRequest ? 200 : 405
        let data = Data("""
        {
          "data": {
            "version": 1,
            "generatedAt": "2026-08-12T12:00:00.000Z",
            "stats": { "checkedOut": 1, "overdue": 0, "reserved": 0, "dueToday": 0 },
            "pendingPickupTotal": 0,
            "openBookings": [],
            "bookingActivity": [],
            "kioskDevices": [],
            "kioskAccess": "restricted"
          }
        }
        """.utf8)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private actor MockGearOpsClient: GearOpsServing {
    private var projectionError: GearOpsClientError?
    private var revocationError: GearOpsClientError?
    private var nextRenewedToken: String?
    private var nextProjection: CompanionProjection?
    private var activities = [makeBookingActivity()]
    private var kioskDevices: [KioskDevice] = []
    private var checkedOut = 12
    private var revision = 0
    private var registrations: [String] = []
    private var revocations: [String] = []
    private let kioskAccess: String

    init(kioskAccess: String = "available") {
        self.kioskAccess = kioskAccess
    }

    func setProjectionError(_ error: GearOpsClientError?) {
        projectionError = error
    }

    func setRevocationError(_ error: GearOpsClientError?) {
        revocationError = error
    }

    func setNextRenewedToken(_ token: String?) {
        nextRenewedToken = token
    }

    func setBookingActivity(_ activity: BookingActivitySnapshot, changed: Bool) {
        activities = [activity]
        if changed { revision += 1 }
    }

    func setBookingActivities(_ activities: [BookingActivitySnapshot]) {
        self.activities = activities
        revision += 1
    }

    func setCheckedOut(_ checkedOut: Int, advanceRevision: Bool = true) {
        self.checkedOut = checkedOut
        if advanceRevision { revision += 1 }
    }

    func setKioskDevices(_ kioskDevices: [KioskDevice]) {
        self.kioskDevices = kioskDevices
        revision += 1
    }

    func setNextProjection(_ projection: CompanionProjection) {
        nextProjection = projection
    }

    func login(email: String, password: String) async throws -> LoginResponse {
        LoginResponse(
            user: GearOpsUser(
                id: "user-1",
                name: "Erik Role",
                email: email,
                role: kioskAccess == "restricted" ? "STAFF" : "ADMIN"
            ),
            companionToken: "credential-\(email)",
            companionProjection: makeProjection(
                activities: activities,
                kioskDevices: kioskDevices,
                kioskAccess: kioskAccess,
                checkedOut: checkedOut,
                generatedAt: Date(timeIntervalSince1970: 1_800_000_000 + Double(revision))
            )
        )
    }

    func renewCompanion(token: String) async throws -> String {
        let renewed = nextRenewedToken ?? token
        nextRenewedToken = nil
        return renewed
    }

    func companionProjection(token: String) async throws -> CompanionProjection {
        if let projectionError { throw projectionError }
        if let nextProjection {
            self.nextProjection = nil
            return nextProjection
        }
        return makeProjection(
            activities: activities,
            kioskDevices: kioskDevices,
            kioskAccess: kioskAccess,
            checkedOut: checkedOut,
            generatedAt: Date(timeIntervalSince1970: 1_800_000_000 + Double(revision))
        )
    }

    func registerCompanionDevice(_ deviceToken: String, credential: String) async throws {
        registrations.append(credential)
    }
    func revokeCompanion(credential: String) async throws {
        revocations.append(credential)
        if let revocationError { throw revocationError }
    }
    func registeredCredentials() -> [String] { registrations }
    func revokedCredentials() -> [String] { revocations }

    func waitForRegistrations(count: Int) async {
        while registrations.count < count {
            await Task.yield()
        }
    }
}

private actor InMemoryCredentialStore: CompanionCredentialStoring {
    private var token: String?
    private var user: GearOpsUser?
    private var pending: [String] = []

    func loadToken() -> String? { token }
    func saveToken(_ token: String) { self.token = token }
    func loadUser() -> GearOpsUser? { user }
    func saveUser(_ user: GearOpsUser) { self.user = user }
    func deleteToken() {
        token = nil
        user = nil
    }
    func deleteToken(ifMatching token: String) {
        if self.token == token {
            self.token = nil
            user = nil
        }
    }
    func stageTokenForRevocation(_ token: String) { pending.append(token) }
    func loadPendingRevocations() -> [String] { pending }
    func removePendingRevocation(_ token: String) { pending.removeAll { $0 == token } }
}

private enum TestCredentialError: Error {
    case unavailable
}

private actor ThrowingCredentialStore: CompanionCredentialStoring {
    func loadToken() throws -> String? { throw TestCredentialError.unavailable }
    func saveToken(_ token: String) throws {}
    func loadUser() throws -> GearOpsUser? { throw TestCredentialError.unavailable }
    func saveUser(_ user: GearOpsUser) throws {}
    func deleteToken() {}
    func deleteToken(ifMatching token: String) throws {}
    func stageTokenForRevocation(_ token: String) throws {}
    func loadPendingRevocations() throws -> [String] { [] }
    func removePendingRevocation(_ token: String) throws {}
}

private actor DeleteFailingCredentialStore: CompanionCredentialStoring {
    private var token: String?
    private var user: GearOpsUser?
    private var attempts = 0

    func loadToken() -> String? { token }
    func saveToken(_ token: String) { self.token = token }
    func loadUser() -> GearOpsUser? { user }
    func saveUser(_ user: GearOpsUser) { self.user = user }
    func deleteToken() throws {
        attempts += 1
        throw TestCredentialError.unavailable
    }
    func deleteToken(ifMatching token: String) throws {
        attempts += 1
        throw TestCredentialError.unavailable
    }
    func stageTokenForRevocation(_ token: String) throws {}
    func loadPendingRevocations() throws -> [String] { [] }
    func removePendingRevocation(_ token: String) throws {}
    func deletionAttempts() -> Int { attempts }
}

private actor SuspendedGearOpsClient: GearOpsServing {
    private var shouldSuspendLogin = false
    private var loginContinuation: CheckedContinuation<LoginResponse, Error>?
    private var pendingLoginResponse: LoginResponse?
    private var shouldSuspendProjection = false
    private var projectionContinuation: CheckedContinuation<CompanionProjection, Error>?
    private var shouldSuspendRevocation = false
    private var revocationContinuation: CheckedContinuation<Void, Never>?
    private var nextProjection: CompanionProjection?

    func suspendNextLogin() {
        shouldSuspendLogin = true
    }

    func waitUntilLoginIsPending() async {
        while loginContinuation == nil {
            await Task.yield()
        }
    }

    func finishLogin() {
        guard let pendingLoginResponse else { return }
        loginContinuation?.resume(returning: pendingLoginResponse)
        loginContinuation = nil
        self.pendingLoginResponse = nil
    }

    func suspendNextProjection() {
        shouldSuspendProjection = true
    }

    func waitUntilProjectionIsPending() async {
        while projectionContinuation == nil {
            await Task.yield()
        }
    }

    func finishProjection(with projection: CompanionProjection) {
        projectionContinuation?.resume(returning: projection)
        projectionContinuation = nil
    }

    func failProjectionAsUnauthorized() {
        projectionContinuation?.resume(throwing: GearOpsClientError.unauthorized)
        projectionContinuation = nil
    }

    func setNextProjection(_ projection: CompanionProjection) {
        nextProjection = projection
    }

    func suspendNextRevocation() {
        shouldSuspendRevocation = true
    }

    func waitUntilRevocationIsPending() async {
        while revocationContinuation == nil {
            await Task.yield()
        }
    }

    func finishRevocation() {
        revocationContinuation?.resume()
        revocationContinuation = nil
    }

    func login(email: String, password: String) async throws -> LoginResponse {
        let isSecondAccount = email == "second@wisc.edu"
        let response = LoginResponse(
            user: GearOpsUser(
                id: isSecondAccount ? "user-2" : "user-1",
                name: isSecondAccount ? "Second User" : "First User",
                email: email,
                role: "ADMIN"
            ),
            companionToken: "credential-\(email)",
            companionProjection: makeProjection(
                checkedOut: isSecondAccount ? 22 : 11,
                generatedAt: Date(timeIntervalSince1970: isSecondAccount ? 1_800_000_200 : 1_800_000_100)
            )
        )
        if shouldSuspendLogin {
            shouldSuspendLogin = false
            pendingLoginResponse = response
            return try await withCheckedThrowingContinuation { continuation in
                loginContinuation = continuation
            }
        }
        return response
    }

    func renewCompanion(token: String) async throws -> String { token }

    func companionProjection(token: String) async throws -> CompanionProjection {
        if shouldSuspendProjection {
            shouldSuspendProjection = false
            return try await withCheckedThrowingContinuation { continuation in
                projectionContinuation = continuation
            }
        }
        if let nextProjection {
            self.nextProjection = nil
            return nextProjection
        }
        return makeProjection(
            checkedOut: token == "credential-second@wisc.edu" ? 22 : 11,
            generatedAt: Date(timeIntervalSince1970: token == "credential-second@wisc.edu" ? 1_800_000_200 : 1_800_000_100)
        )
    }

    func registerCompanionDevice(_ deviceToken: String, credential: String) async throws {}

    func revokeCompanion(credential: String) async throws {
        guard shouldSuspendRevocation else { return }
        shouldSuspendRevocation = false
        await withCheckedContinuation { continuation in
            revocationContinuation = continuation
        }
    }
}

private actor NoopBookingNotifier: BookingNotificationDelivering {
    func requestAuthorization() async {}
    func authorization() async -> BookingNotificationAuthorization { .authorized }
    func deliver(_ change: BookingChange, playsSound: Bool) async {}
    func clearPrivateNotifications() async {}
}

private actor RecordingBookingNotifier: BookingNotificationDelivering {
    private var changes: [BookingChange] = []

    func requestAuthorization() async {}
    func authorization() async -> BookingNotificationAuthorization { .authorized }
    func deliver(_ change: BookingChange, playsSound: Bool) async { changes.append(change) }
    func deliveredChanges() -> [BookingChange] { changes }
    func clearPrivateNotifications() async {}
}

private actor SuspendedBookingNotifier: BookingNotificationDelivering {
    private var shouldSuspendAuthorization = false
    private var authorizationContinuation: CheckedContinuation<Void, Never>?

    func suspendNextAuthorization() {
        shouldSuspendAuthorization = true
    }

    func waitUntilAuthorizationIsPending() async {
        while authorizationContinuation == nil {
            await Task.yield()
        }
    }

    func finishAuthorization() {
        authorizationContinuation?.resume()
        authorizationContinuation = nil
    }

    func authorization() async -> BookingNotificationAuthorization { .authorized }

    func requestAuthorization() async {
        guard shouldSuspendAuthorization else { return }
        shouldSuspendAuthorization = false
        await withCheckedContinuation { continuation in
            authorizationContinuation = continuation
        }
    }

    func deliver(_ change: BookingChange, playsSound: Bool) async {}
    func clearPrivateNotifications() async {}
}

private func makeOpenBooking() -> OpenBooking {
    OpenBooking(
        id: "booking-1",
        title: "Camera checkout",
        endsAt: Date(timeIntervalSince1970: 1_800_000_000),
        refNumber: "C-001",
        requester: .init(id: "user-1", name: "Erik Role", avatarUrl: nil),
        location: .init(id: "location-1", name: "Kohl Center"),
        serializedItems: [.init(id: "allocation-1")],
        bulkItems: []
    )
}

private func makeBookingActivity(
    id: String = "booking-1",
    status: BookingStatus = .open,
    kind: BookingKind = .checkout,
    startsAt: Date = Date(timeIntervalSince1970: 1_799_000_000),
    endsAt: Date = Date(timeIntervalSince1970: 1_800_000_000),
    updatedAt: Date = Date(timeIntervalSince1970: 1_700_000_000)
) -> BookingActivitySnapshot {
    BookingActivitySnapshot(
        id: id,
        title: "Camera checkout",
        kind: kind,
        status: status,
        startsAt: startsAt,
        endsAt: endsAt,
        updatedAt: updatedAt,
        requester: .init(id: "user-1", name: "Erik Role", avatarUrl: nil),
        location: .init(id: "location-1", name: "Kohl Center")
    )
}

private func makeProjection(
    version: Int = 1,
    activities: [BookingActivitySnapshot] = [makeBookingActivity()],
    kioskDevices: [KioskDevice] = [],
    kioskAccess: String = "available",
    checkedOut: Int = 12,
    revision: Int? = 1,
    generatedAt: Date = Date(timeIntervalSince1970: 1_800_000_000)
) -> CompanionProjection {
    CompanionProjection(
        version: version,
        revision: revision,
        generatedAt: generatedAt,
        stats: GearOpsStats(checkedOut: checkedOut, overdue: 2, reserved: 8, dueToday: 4),
        pendingPickupTotal: 1,
        openBookings: [makeOpenBooking()],
        bookingActivity: activities,
        kioskDevices: kioskDevices,
        kioskAccess: kioskAccess
    )
}

private func makeKiosk(
    id: String,
    active: Bool = true,
    activated: Bool = true,
    lastSeenAt: Date?
) -> KioskDevice {
    KioskDevice(
        id: id,
        name: id.capitalized,
        location: .init(id: "location-1", name: "Video Office"),
        active: active,
        activated: activated,
        lastSeenAt: lastSeenAt,
        appVersion: "1.0",
        appBuild: "1",
        osVersion: "26.0",
        deviceModel: "iPad",
        pendingPickupCount: 0,
        openCheckoutCount: 0
    )
}
