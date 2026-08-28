import UIKit
import UserNotifications

enum PushTokenStorage {
    static let currentTokenKey = "WisconsinCurrentAPNsToken"
    private static let registrationAllowedKey = "WisconsinAPNsRegistrationAllowed"

    static var registrationAllowed: Bool {
        get { UserDefaults.standard.bool(forKey: registrationAllowedKey) }
        set { UserDefaults.standard.set(newValue, forKey: registrationAllowedKey) }
    }
}

@MainActor
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        GearTrackerNotificationCategory.register()
        return true
    }

    /// Home Screen quick actions. Deliberately not read out of
    /// `launchOptions[.shortcutItem]`, which is deprecated as of iOS 26 in
    /// favour of the UIScene lifecycle — with no scene delegate of our own,
    /// UIKit routes the shortcut here in both the cold and warm cases, and
    /// `GearTrackerAppIntentHandoff` holds it until `AppTabView` appears.
    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(GearTrackerQuickAction.handle(shortcutItem))
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .all
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard PushTokenStorage.registrationAllowed else { return }
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: PushTokenStorage.currentTokenKey)
        Task { @MainActor in
            let mutation = pushCredentialMutations.enqueue {
                guard PushTokenStorage.registrationAllowed else { return }
                do {
                    try await APIClient.shared.registerDeviceToken(hex)
                    guard PushTokenStorage.registrationAllowed else { return }
                    sharedAppState?.pushRegistrationState = .registered
                } catch {
                    guard PushTokenStorage.registrationAllowed else { return }
                    sharedAppState?.pushRegistrationState = .failed
                    print("[APNS] Device token registration failed: \(error.localizedDescription)")
                }
            }
            await mutation.value
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        guard PushTokenStorage.registrationAllowed else { return }
        sharedAppState?.pushRegistrationState = .failed
        print("[APNS] Registration failed: \(error.localizedDescription)")
    }

    /// Delivered banners sit in the system Notification Center forever unless
    /// something removes them — APNs has no built-in expiry for already-shown
    /// notifications. Called on every foreground so stale booking/trade
    /// alerts don't pile up indefinitely once their content is no longer
    /// relevant.
    static let staleDeliveredNotificationAge: TimeInterval = 24 * 60 * 60

    static func pruneStaleDeliveredNotifications() async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        let staleIds = delivered
            .filter { Date().timeIntervalSince($0.date) > staleDeliveredNotificationAge }
            .map(\.request.identifier)
        guard !staleIds.isEmpty else { return }
        center.removeDeliveredNotifications(withIdentifiers: staleIds)
    }

    /// Prevents a delayed APNs callback from re-registering a token after the
    /// authenticated session ends, and removes notification content that may
    /// identify the previous user.
    @MainActor
    static func clearRemoteNotificationsForSignedOutUser() {
        PushTokenStorage.registrationAllowed = false
        UserDefaults.standard.removeObject(forKey: PushTokenStorage.currentTokenKey)
        UIApplication.shared.unregisterForRemoteNotifications()

        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()
        Task { try? await center.setBadgeCount(0) }
        sharedAppState?.pushRegistrationState = .unknown
    }
}

// UNUserNotificationCenterDelegate's methods aren't @MainActor in their
// protocol declaration, but UNUserNotificationCenter always calls its
// delegate on the main thread in practice. @preconcurrency tells the
// compiler to trust that instead of requiring a nonisolated conformance.
extension AppDelegate: @preconcurrency UNUserNotificationCenterDelegate {
    // Show banner + sound when notification arrives in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        guard PushTokenStorage.registrationAllowed else {
            completionHandler([])
            return
        }
        completionHandler([.banner, .sound, .badge])
    }

    // User tapped notification (foreground or background)
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        guard PushTokenStorage.registrationAllowed else {
            completionHandler()
            return
        }
        let notificationBoundary = authSessionBoundary.capture()
        let userInfo = response.notification.request.content.userInfo

        // A dismissal is not a destination. Only delivered when a category opts
        // into `.customDismissAction`, which none of ours do — guarded anyway,
        // because the fallthrough below would otherwise treat it as a tap.
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier else {
            completionHandler()
            return
        }

        switch GearTrackerNotificationAction(rawValue: response.actionIdentifier) {
        case .snooze:
            // Entirely on-device: nothing to route, nothing to write. The
            // payload is lifted off the notification here, on the delegate's
            // actor, because `UNNotification` cannot cross into the task.
            let snooze = NotificationSnooze.Payload(notification: response.notification)
            Task {
                await NotificationSnooze.schedule(snooze)
                completionHandler()
            }
            return

        case .acknowledgeBlast:
            guard let blastId = userInfo["blastId"] as? String else {
                completionHandler()
                return
            }
            Task { @MainActor in
                defer { completionHandler() }
                guard PushTokenStorage.registrationAllowed,
                      authSessionBoundary.owns(notificationBoundary) else { return }
                // Idempotent server-side, so a double press costs nothing. A
                // failure is swallowed on purpose: there is no surface left to
                // show a retry on, and the in-app banner will still be there.
                try? await APIClient.shared.acknowledgeBlast(id: blastId)
            }
            return

        case .view, .none:
            // `.view` and the default tap mean the same thing: open the thing
            // the notification is about.
            break
        }

        routeNotificationDestination(userInfo: userInfo, notificationBoundary: notificationBoundary)
        completionHandler()
    }

    /// One routing path for a tapped notification and for every `.foreground`
    /// action, so an action can never reach a destination a tap could not.
    private func routeNotificationDestination(
        userInfo: [AnyHashable: Any],
        notificationBoundary: UUID
    ) {
        if let blastId = userInfo["blastId"] as? String {
            Task { @MainActor in
                guard PushTokenStorage.registrationAllowed,
                      authSessionBoundary.owns(notificationBoundary) else { return }
                sharedAppState?.pendingPushBlastId = blastId
            }
        } else if let bookingId = userInfo["bookingId"] as? String {
            Task { @MainActor in
                guard PushTokenStorage.registrationAllowed,
                      authSessionBoundary.owns(notificationBoundary) else { return }
                sharedAppState?.pendingPushBookingId = bookingId
            }
        } else if let eventId = userInfo["eventId"] as? String {
            Task { @MainActor in
                guard PushTokenStorage.registrationAllowed,
                      authSessionBoundary.owns(notificationBoundary) else { return }
                sharedAppState?.pendingPushEventId = eventId
            }
        }
    }
}
