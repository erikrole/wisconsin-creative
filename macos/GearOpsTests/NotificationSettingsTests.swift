import XCTest
@testable import GearOps

@MainActor
final class NotificationSettingsTests: XCTestCase {
    private func isolatedDefaults() -> UserDefaults {
        let suite = "NotificationSettingsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    func testEveryCategoryIsAllowedBeforeTheUserChoosesAnything() {
        let settings = NotificationSettingsStore(defaults: isolatedDefaults())

        XCTAssertTrue(settings.isEnabled)
        for category in BookingChangeCategory.allCases {
            XCTAssertTrue(settings.allows(category), "\(category) should default to on")
        }
        XCTAssertEqual(settings.summary, "Alerting on all booking changes")
    }

    func testMutingOneCategoryLeavesTheRestAlone() {
        let settings = NotificationSettingsStore(defaults: isolatedDefaults())

        settings.setCategory(.other, enabled: false)

        XCTAssertFalse(settings.allows(.other))
        XCTAssertTrue(settings.allows(.checkout))
        XCTAssertEqual(settings.enabledCategoryCount, BookingChangeCategory.allCases.count - 1)
        XCTAssertEqual(
            settings.summary,
            "Alerting on \(BookingChangeCategory.allCases.count - 1) of \(BookingChangeCategory.allCases.count) change types"
        )
    }

    func testMasterSwitchSuppressesEverythingWithoutLosingCategoryChoices() {
        let settings = NotificationSettingsStore(defaults: isolatedDefaults())
        settings.setCategory(.checkIn, enabled: false)

        settings.isEnabled = false
        XCTAssertFalse(settings.allows(.checkout))
        XCTAssertEqual(settings.summary, "Booking alerts are off")

        settings.isEnabled = true
        XCTAssertTrue(settings.allows(.checkout))
        XCTAssertFalse(settings.allows(.checkIn), "per-category choice must survive the master switch")
    }

    func testChoicesSurviveRelaunch() {
        let defaults = isolatedDefaults()
        let first = NotificationSettingsStore(defaults: defaults)
        first.setCategory(.timeChange, enabled: false)
        first.setCategory(.reservation, enabled: false)

        let restored = NotificationSettingsStore(defaults: defaults)

        XCTAssertFalse(restored.allows(.timeChange))
        XCTAssertFalse(restored.allows(.reservation))
        XCTAssertTrue(restored.allows(.checkout))
        XCTAssertTrue(restored.isEnabled)
    }

    /// A category added in a later build must not inherit an older user's
    /// stored set as an implicit denial.
    func testUnknownStoredCategoryIsIgnoredRatherThanBlockingDelivery() {
        let defaults = isolatedDefaults()
        let payload = #"{"isEnabled":true,"disabledCategories":["categoryFromTheFuture"]}"#
        defaults.set(Data(payload.utf8), forKey: "GearOpsNotificationPreferencesV1")

        let settings = NotificationSettingsStore(defaults: defaults)

        XCTAssertEqual(settings.enabledCategoryCount, BookingChangeCategory.allCases.count)
    }

    func testDetectorClassifiesEachTransition() {
        func category(from previous: BookingStatus?, to current: BookingStatus) -> BookingChangeCategory? {
            BookingChangeDetector.change(
                from: previous.map { snapshot(status: $0) },
                to: snapshot(status: current)
            )?.category
        }

        XCTAssertEqual(category(from: .draft, to: .booked), .reservation)
        XCTAssertEqual(category(from: .booked, to: .pendingPickup), .pickupReady)
        XCTAssertEqual(category(from: .pendingPickup, to: .open), .checkout)
        XCTAssertEqual(category(from: .open, to: .completed), .checkIn)
        XCTAssertEqual(category(from: .booked, to: .cancelled), .cancellation)
    }

    func testExtensionAndReturnTimeEditsAreTimeChanges() {
        let previous = snapshot(status: .open)
        let extended = snapshot(status: .open, endsAt: previous.endsAt.addingTimeInterval(3600))
        let pulledIn = snapshot(status: .open, endsAt: previous.endsAt.addingTimeInterval(-3600))

        XCTAssertEqual(BookingChangeDetector.change(from: previous, to: extended)?.category, .timeChange)
        XCTAssertEqual(BookingChangeDetector.change(from: previous, to: extended)?.statusLabel, "Extended")
        XCTAssertEqual(BookingChangeDetector.change(from: previous, to: pulledIn)?.category, .timeChange)
    }

    func testMetadataEditIsAnOtherUpdate() {
        let previous = snapshot(status: .open)
        let renamed = snapshot(status: .open, title: "Renamed booking")

        XCTAssertEqual(BookingChangeDetector.change(from: previous, to: renamed)?.category, .other)
    }

    private func snapshot(
        status: BookingStatus,
        title: String = "Camera checkout",
        endsAt: Date = Date(timeIntervalSince1970: 1_800_000_000)
    ) -> BookingActivitySnapshot {
        BookingActivitySnapshot(
            id: "booking-1",
            title: title,
            kind: .checkout,
            status: status,
            startsAt: Date(timeIntervalSince1970: 1_799_000_000),
            endsAt: endsAt,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000),
            requester: .init(id: "user-1", name: "Erik Role", avatarUrl: nil),
            location: .init(id: "location-1", name: "Kohl Center")
        )
    }
}

@MainActor
final class AppPreferencesTests: XCTestCase {
    private func isolatedDefaults() -> UserDefaults {
        let suite = "AppPreferencesTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    func testMenuBarCountIsOnByDefaultAndPersists() {
        let defaults = isolatedDefaults()
        let first = AppPreferencesStore(defaults: defaults)
        XCTAssertTrue(first.showsMenuBarCount)

        first.showsMenuBarCount = false

        XCTAssertFalse(AppPreferencesStore(defaults: defaults).showsMenuBarCount)
    }

    func testAlertSoundIsOffByDefaultAndPersists() {
        let defaults = isolatedDefaults()
        let first = NotificationSettingsStore(defaults: defaults)
        XCTAssertFalse(first.playsSound, "alerts stay silent unless the user opts in")

        first.playsSound = true

        let restored = NotificationSettingsStore(defaults: defaults)
        XCTAssertTrue(restored.playsSound)
        XCTAssertTrue(restored.isEnabled)
    }

    /// Preferences written before the sound option existed must decode without
    /// losing the categories stored alongside them.
    func testPreferencesStoredBeforeTheSoundOptionStillDecode() {
        let defaults = isolatedDefaults()
        let legacy = #"{"isEnabled":true,"disabledCategories":["checkIn"]}"#
        defaults.set(Data(legacy.utf8), forKey: "GearOpsNotificationPreferencesV1")

        let settings = NotificationSettingsStore(defaults: defaults)

        XCTAssertFalse(settings.playsSound)
        XCTAssertFalse(settings.allows(.checkIn))
        XCTAssertTrue(settings.allows(.checkout))
    }

    func testLoginItemStateMapsApprovalAndAbsenceDistinctly() {
        XCTAssertTrue(LoginItemState.enabled.isOn)
        XCTAssertTrue(LoginItemState.requiresApproval.isOn)
        XCTAssertTrue(LoginItemState.requiresApproval.canChange)
        XCTAssertFalse(LoginItemState.unavailable.canChange)
        XCTAssertNil(LoginItemState.enabled.detail)
        XCTAssertNil(LoginItemState.disabled.detail)
        XCTAssertNotNil(LoginItemState.requiresApproval.detail)
        XCTAssertNotNil(LoginItemState.unavailable.detail)
    }

    func testMenuBarExtraStaysVisibleByDefaultAndPersists() {
        let defaults = isolatedDefaults()
        let first = AppPreferencesStore(defaults: defaults)
        XCTAssertTrue(first.showsMenuBarExtra)
        XCTAssertTrue(AppPreferencesStore.showsMenuBarExtra(in: defaults))

        first.showsMenuBarExtra = false

        XCTAssertFalse(AppPreferencesStore(defaults: defaults).showsMenuBarExtra)
        XCTAssertFalse(AppPreferencesStore.showsMenuBarExtra(in: defaults))
    }

    func testLegacyPreferencesKeepTheMenuBarExtraVisible() {
        let defaults = isolatedDefaults()
        let legacy = #"{"showsMenuBarCount":false}"#
        defaults.set(Data(legacy.utf8), forKey: "GearOpsAppPreferencesV1")

        XCTAssertTrue(AppPreferencesStore(defaults: defaults).showsMenuBarExtra)
        XCTAssertFalse(AppPreferencesStore(defaults: defaults).showsMenuBarCount)
    }
}
