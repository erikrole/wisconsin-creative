import XCTest
import SwiftUI
@testable import Wisconsin

@MainActor
private final class InboxStub: NotificationInboxAPI {
    var rows: [AppNotification] = []
    var offsets: [Int] = []
    var failRead = false
    var loseMutationResponse = false
    var holdMutation = false
    var mutation: CheckedContinuation<Void, Never>?
    var markCount = 0
    var undoBatches: [[String]] = []
    var page: NotificationsResponse?

    func notifications(unreadOnly: Bool, limit: Int, offset: Int) async throws -> NotificationsResponse {
        offsets.append(offset)
        if failRead { throw URLError(.notConnectedToInternet) }
        if let page { return page }
        return NotificationsResponse(data: Array(rows.dropFirst(offset).prefix(limit)), total: rows.count,
                                     limit: limit, offset: offset, unreadCount: rows.filter(\.isUnread).count)
    }
    func markNotificationRead(id: String) async throws {
        markCount += 1
        if holdMutation { await withCheckedContinuation { mutation = $0 } }
        rows = rows.map { row in
            AppNotification(id: row.id, type: row.type, title: row.title, body: row.body,
                            readAt: row.id == id ? Date() : row.readAt, createdAt: row.createdAt, payload: row.payload)
        }
        if loseMutationResponse { throw URLError(.networkConnectionLost) }
    }
    func markAllNotificationsRead() async throws -> [String] { rows.map(\.id) }
    func markNotificationsUnread(ids: [String]) async throws { undoBatches.append(ids) }
}

@MainActor
final class NotificationInboxTests: XCTestCase {
    private func row(_ id: String) -> AppNotification {
        AppNotification(id: id, type: "shift_time_changed", title: "Your call time changed",
                        body: "Football vs. Northern State: arrive at Camp Randall Stadium Gate 3 at 4:30 PM. Check the published event for your assignment and equipment pickup details.",
                        readAt: nil, createdAt: Date(), payload: nil)
    }

    func testLostMutationResponseRereadsCommittedState() async {
        let api = InboxStub()
        api.rows = [row("one")]
        api.loseMutationResponse = true
        let vm = NotificationsViewModel(api: api, refreshUnread: {})
        await vm.load()
        await vm.markRead(id: "one")
        XCTAssertFalse(vm.notifications[0].isUnread)
        XCTAssertEqual(vm.unreadCount, 0)
        XCTAssertNotNil(vm.actionError)
    }

    func testDuplicateMutationAndRefreshCannotOvertakePendingWrite() async {
        let api = InboxStub()
        api.rows = [row("one")]
        api.holdMutation = true
        let vm = NotificationsViewModel(api: api, refreshUnread: {})
        await vm.load()
        let first = Task { await vm.markRead(id: "one") }
        while api.mutation == nil { await Task.yield() }
        await vm.markRead(id: "one")
        await vm.load(forceRefresh: true)
        XCTAssertEqual(api.markCount, 1)
        XCTAssertEqual(api.offsets, [0])
        XCTAssertTrue(vm.notifications[0].isUnread)
        api.mutation?.resume()
        await first.value
        XCTAssertFalse(vm.notifications[0].isUnread)
    }

    func testFailedRefreshRetainsRowsAndReportsFailure() async {
        let api = InboxStub()
        api.rows = [row("one")]
        let vm = NotificationsViewModel(api: api, refreshUnread: {})
        await vm.load()
        api.failRead = true
        await vm.load(forceRefresh: true)
        XCTAssertEqual(vm.notifications.map(\.id), ["one"])
        XCTAssertNotNil(vm.error)
    }

    func testOverlappingPagesKeepUniqueRowsAndAdvanceServerOffset() async {
        let api = InboxStub()
        api.page = NotificationsResponse(data: [row("one"), row("two")], total: 6, limit: 2, offset: 0, unreadCount: 6)
        let vm = NotificationsViewModel(api: api, refreshUnread: {})
        await vm.load()
        api.page = NotificationsResponse(data: [row("two"), row("three")], total: 6, limit: 2, offset: 2, unreadCount: 6)
        await vm.loadMore()
        await vm.loadMore()
        XCTAssertEqual(vm.notifications.map(\.id), ["one", "two", "three"])
        XCTAssertEqual(api.offsets, [0, 2, 4])
    }

    func testLargeInboxUndoRespectsAPIRequestLimit() async {
        let api = InboxStub()
        api.rows = (0..<1001).map { row(String($0)) }
        let vm = NotificationsViewModel(api: api, refreshUnread: {})
        await vm.load()
        await vm.markAllRead()
        await vm.undoLastMarkAll()
        XCTAssertEqual(api.undoBatches.map(\.count), [500, 500, 1])
        XCTAssertEqual(Set(api.undoBatches.flatMap { $0 }).count, 1001)
    }

    func testBlastPayloadDecodesWithoutLosingItsDestination() throws {
        let payload = try JSONDecoder().decode(NotificationPayload.self, from: Data(#"{"blastId":"blast-one"}"#.utf8))
        XCTAssertEqual(payload.blastId, "blast-one")
        XCTAssertNil(payload.effectiveBookingId)
    }

    func testRepeatedSnoozeHasOneStableIdentifier() {
        XCTAssertEqual(NotificationSnooze.reminderIdentifier(for: "original"), "gt-snooze-original")
        XCTAssertEqual(NotificationSnooze.reminderIdentifier(for: "gt-snooze-gt-snooze-original"), "gt-snooze-original")
    }

    func testReadingClearsTheMatchingNotificationCenterAlert() async {
        let api = InboxStub()
        api.rows = [row("one"), row("two")]
        var cleared: [Set<String>?] = []
        let vm = NotificationsViewModel(api: api, refreshUnread: {}, clearDelivered: { cleared.append($0) })
        await vm.load()

        await vm.markRead(id: "one")
        XCTAssertEqual(cleared, [["one"]])

        await vm.markAllRead()
        XCTAssertEqual(cleared.count, 2)
        XCTAssertNil(cleared[1], "Mark All Read clears every delivered alert")
    }

    func testInboxRecoveryCapture() async throws {
        let api = InboxStub()
        api.rows = [row("one"), row("two")]
        let vm = NotificationsViewModel(api: api, refreshUnread: {})
        await vm.load()
        api.failRead = true
        await vm.load(forceRefresh: true)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        let controller = UIHostingController(rootView: NotificationsSheet(vm: vm).environment(\.dynamicTypeSize, .xxxLarge))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        try await Task.sleep(for: .milliseconds(300))
        controller.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "inbox-refresh-recovery-large-text"
        attachment.lifetime = .keepAlways
        add(attachment)
        window.isHidden = true
    }
}

final class NotificationPreferenceLevelTests: XCTestCase {
    private func json(_ patch: NotificationPreferencesPatch) throws -> [String: Any] {
        let data = try JSONEncoder().encode(patch)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testPatchSendsOnlyTheChangedField() throws {
        let body = try json(.init(push: ["schedule": .silent]))
        XCTAssertEqual(Set(body.keys), ["push"])
        XCTAssertEqual((body["push"] as? [String: String])?["schedule"], "silent")
    }

    func testResumeSendsAnExplicitNullPause() throws {
        let body = try json(.init(pausedUntil: .some(nil)))
        XCTAssertTrue(body.keys.contains("pausedUntil"))
        XCTAssertTrue(body["pausedUntil"] is NSNull)
    }

    func testDecodesLevelsAndToleratesUnknownOnes() throws {
        let data = Data(#"{"pausedUntil":null,"channels":{"email":true,"push":true},"push":{"trade":"silent","future":"loud"},"quietHours":{"enabled":true,"start":"22:00","end":"07:00","days":[0,6],"allowUrgent":false}}"#.utf8)
        let prefs = try JSONDecoder().decode(NotificationPreferences.self, from: data)
        XCTAssertEqual(prefs.push?["trade"], .silent)
        XCTAssertEqual(prefs.push?["future"], .standard)
        XCTAssertEqual(prefs.quietHours?.days, [0, 6])
        XCTAssertEqual(prefs.quietHours?.allowUrgent, false)
    }

    @MainActor
    func testQuietHoursTimesRoundTripInCentralTime() {
        for time in ["00:00", "07:30", "22:00", "23:59"] {
            let date = NotificationPrefsViewModel.quietHoursDate(time)
            XCTAssertEqual(NotificationPrefsViewModel.quietHoursTime(date), time)
        }
    }

    @MainActor
    func testTomorrowMorningIsSevenAmTheNextDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Chicago"))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 9, day: 23, hour: 23, minute: 15)))
        let morning = NotificationPrefsViewModel.tomorrowMorning(from: now, calendar: calendar)
        let parts = calendar.dateComponents([.day, .hour, .minute], from: morning)
        XCTAssertEqual(parts.day, 24)
        XCTAssertEqual(parts.hour, 7)
        XCTAssertEqual(parts.minute, 0)
    }
}

final class NotificationQuickActionTests: XCTestCase {
    func testReviewDecisionPrefersTheTradeOverItsAssignment() {
        XCTAssertEqual(ReviewDecisionTarget(userInfo: ["tradeId": "t1", "assignmentId": "a1"]), .trade("t1"))
        XCTAssertEqual(ReviewDecisionTarget(userInfo: ["assignmentId": "a1"]), .shiftRequest("a1"))
        XCTAssertNil(ReviewDecisionTarget(userInfo: ["eventId": "e1"]))
    }

    func testEveryCategoryButBlastsOffersMarkAsReadOrADecision() {
        XCTAssertEqual(GearTrackerNotificationAction.decline.action.options.contains(.destructive), true)
        XCTAssertEqual(GearTrackerNotificationAction.approve.action.options.contains(.authenticationRequired), false)
    }
}
