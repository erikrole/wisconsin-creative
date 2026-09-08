import AppKit
import Foundation

enum CompanionPushEvent: Sendable {
    case deviceToken(String)
    case projectionChanged
    case sessionBecameActive
}

final class CompanionPushBridge: Sendable {
    static let shared = CompanionPushBridge()

    let events: AsyncStream<CompanionPushEvent>
    private let continuation: AsyncStream<CompanionPushEvent>.Continuation

    private init() {
        let pair = AsyncStream<CompanionPushEvent>.makeStream(bufferingPolicy: .bufferingNewest(8))
        events = pair.stream
        continuation = pair.continuation
    }

    func send(_ event: CompanionPushEvent) {
        continuation.yield(event)
    }
}

@MainActor
final class GearOpsAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // The Settings Window scene otherwise gives this accessory app a
        // last-window lifetime. Dismissing sign-in must not quit the helper.
        false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.registerForRemoteNotifications()
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(workspaceDidWake),
            name: NSWorkspace.didWakeNotification,
            object: nil
        )
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(workspaceSessionDidBecomeActive),
            name: NSWorkspace.sessionDidBecomeActiveNotification,
            object: NSWorkspace.shared
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    func application(
        _ application: NSApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        CompanionPushBridge.shared.send(.deviceToken(token))
    }

    func application(
        _ application: NSApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Projection delivery remains cached and manual-refreshable when APNs
        // registration is temporarily unavailable.
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        CompanionPushBridge.shared.send(.sessionBecameActive)
    }

    func application(
        _ application: NSApplication,
        didReceiveRemoteNotification userInfo: [String: Any]
    ) {
        guard userInfo["companionProjectionVersion"] != nil else { return }
        CompanionPushBridge.shared.send(.projectionChanged)
    }

    /// A wake is the bounded reliability backstop for an APNs invalidation
    /// throttled while the Mac slept. It replaces background timer polling and
    /// still reads only the accepted external projection route.
    @objc private func workspaceDidWake(_ notification: Notification) {
        CompanionPushBridge.shared.send(.projectionChanged)
    }

    @objc private func workspaceSessionDidBecomeActive(_ notification: Notification) {
        CompanionPushBridge.shared.send(.sessionBecameActive)
    }
}
