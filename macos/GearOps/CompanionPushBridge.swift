import AppKit
import Foundation

enum CompanionPushEvent: Sendable {
    case deviceToken(String)
    case projectionChanged
    case sessionBecameActive
    case openDashboard
    case refreshRequested
    case showMenuBarExtra
}

extension Notification.Name {
    static let gearOpsOpenSettings = Notification.Name("GearOpsOpenSettings")
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
        // last-window lifetime. Dismissing sign-in must not quit the helper,
        // including when the menu-bar extra is hidden and the Dock icon is
        // the remaining native entry point.
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if flag { return true }
        openSettingsFromDock(nil)
        return false
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        // Apple asks menu-bar extras not to be the only way to reach app
        // functionality. This menu exists when the extra is hidden and the
        // Dock icon is the remaining native entry. Quit remains a system item.
        let menu = NSMenu()
        menu.addItem(dockItem("Open Dashboard", #selector(openDashboardFromDock(_:))))
        menu.addItem(dockItem("Refresh", #selector(refreshFromDock(_:))))
        menu.addItem(.separator())
        menu.addItem(dockItem("Show in Menu Bar", #selector(showMenuBarFromDock(_:))))
        menu.addItem(dockItem("Settings…", #selector(openSettingsFromDock(_:))))
        return menu
    }

    private func dockItem(_ title: String, _ selector: Selector) -> NSMenuItem {
        NSMenuItem(title: title, action: selector, keyEquivalent: "")
    }

    @objc private func openSettingsFromDock(_ sender: Any?) {
        NSApplication.shared.activate()
        if let window = NSApplication.shared.windows.first(where: Self.isSettingsWindow) {
            window.makeKeyAndOrderFront(nil)
            return
        }
        // The SwiftUI Window scene registers Settings… on the app menu even
        // before that window has been shown, which is the recovery path when
        // the extra is hidden at launch.
        if let item = Self.settingsMenuItem(), let action = item.action {
            NSApplication.shared.sendAction(action, to: item.target, from: item)
            return
        }
        NotificationCenter.default.post(name: .gearOpsOpenSettings, object: nil)
    }

    @objc private func openDashboardFromDock(_ sender: Any?) {
        CompanionPushBridge.shared.send(.openDashboard)
    }

    @objc private func refreshFromDock(_ sender: Any?) {
        CompanionPushBridge.shared.send(.refreshRequested)
    }

    @objc private func showMenuBarFromDock(_ sender: Any?) {
        CompanionPushBridge.shared.send(.showMenuBarExtra)
    }

    private static func isSettingsWindow(_ window: NSWindow) -> Bool {
        window.identifier?.rawValue == GearOpsWindow.settings
            || window.title.contains("Settings")
    }

    private static func settingsMenuItem() -> NSMenuItem? {
        NSApplication.shared.mainMenu?.items
            .compactMap(\.submenu)
            .flatMap(\.items)
            .first(where: { $0.keyEquivalent == "," && $0.keyEquivalentModifierMask.contains(.command) })
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        GearOpsActivation.applyFromDefaults()
        CompanionBookingNotification.register()
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
