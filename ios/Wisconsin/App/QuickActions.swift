import UIKit

/// Home Screen long-press shortcuts.
///
/// These reuse `GearTrackerAppIntentDestination` rather than inventing a second
/// routing vocabulary: the destinations are already capability-gated in
/// `AppTabView.routePendingAppIntent()`, so a shortcut can never open a surface
/// the signed-in role may not see.
///
/// The list is built dynamically rather than declared in `Info.plist`. A static
/// list would show every collaborator a Scan and a New Reservation shortcut
/// that silently do nothing when the router declines them — worse than not
/// offering the shortcut at all.
enum GearTrackerQuickAction: String, CaseIterable {
    case scan = "com.erikrole.Wisconsin.shortcut.scan"
    case myGear = "com.erikrole.Wisconsin.shortcut.myGear"
    case todaySchedule = "com.erikrole.Wisconsin.shortcut.todaySchedule"
    case createReservation = "com.erikrole.Wisconsin.shortcut.createReservation"

    var destination: GearTrackerAppIntentDestination {
        switch self {
        case .scan: .scan
        case .myGear: .myGear
        case .todaySchedule: .todaySchedule
        case .createReservation: .createReservation
        }
    }

    /// The capability `AppTabView` checks before routing this destination.
    /// Kept in step with `routePendingAppIntent()`; if the two disagree the
    /// shortcut becomes a dead end.
    var requiredCapability: String {
        switch self {
        case .scan: "GEAR_CATALOG_VIEW"
        case .myGear: "MY_GEAR_VIEW"
        case .todaySchedule: "PUBLISHED_SCHEDULE_VIEW"
        case .createReservation: "RESERVATION_CREATE"
        }
    }

    var title: String {
        switch self {
        case .scan: "Scan"
        case .myGear: "My Gear"
        case .todaySchedule: "Schedule"
        case .createReservation: "New Reservation"
        }
    }

    var subtitle: String {
        switch self {
        case .scan: "Look up gear by tag"
        case .myGear: "Checkouts and reservations"
        case .todaySchedule: "Your shifts"
        case .createReservation: "Reserve gear for later"
        }
    }

    /// State-aware subtitle, drawn from the snapshot the widgets already read.
    ///
    /// The Home Screen menu is glanced at before the app opens, so the most
    /// useful thing it can say is the count you would otherwise open the app to
    /// find. Falls back to the static wording whenever there is nothing
    /// noteworthy — a subtitle that reads "0 overdue" is worse than one that
    /// describes the destination.
    func subtitle(for snapshot: GearWidgetSnapshot) -> String {
        switch self {
        case .myGear:
            if snapshot.overdueCount > 0 {
                return "\(snapshot.overdueCount) overdue"
            }
            if snapshot.dueTodayCount > 0 {
                return "\(snapshot.dueTodayCount) due today"
            }
            return subtitle
        case .todaySchedule:
            guard let shift = snapshot.nextShift else { return subtitle }
            return "Next: \(shift.startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
        case .scan, .createReservation:
            return subtitle
        }
    }

    var symbolName: String {
        switch self {
        case .scan: "barcode.viewfinder"
        case .myGear: "bag"
        case .todaySchedule: "calendar"
        case .createReservation: "plus.circle"
        }
    }

    func shortcutItem(subtitle overrideSubtitle: String? = nil) -> UIApplicationShortcutItem {
        UIApplicationShortcutItem(
            type: rawValue,
            localizedTitle: title,
            localizedSubtitle: overrideSubtitle ?? subtitle,
            icon: UIApplicationShortcutIcon(systemImageName: symbolName),
            userInfo: nil
        )
    }

    /// Same rule as `AppTabView.hasCapability`: only collaborators are
    /// capability-scoped; every other role has the full set.
    private func isAvailable(to user: CurrentUser) -> Bool {
        guard user.role == "COLLABORATOR" else { return true }
        return (user.capabilities ?? []).contains(requiredCapability)
    }

    /// Rebuilt whenever the signed-in identity changes. Signing out clears the
    /// menu — a shortcut is a hint about what the phone's owner can do, and it
    /// must not survive their session.
    @MainActor
    static func refresh(for user: CurrentUser?) {
        guard let user else {
            UIApplication.shared.shortcutItems = []
            return
        }
        UIApplication.shared.shortcutItems = allCases
            .filter { $0.isAvailable(to: user) }
            .map { $0.shortcutItem() }
    }

    /// Re-labels the existing menu from the current snapshot.
    ///
    /// Deliberately maps over what is already installed rather than rebuilding
    /// from `allCases`: the role filter that produced that list is the single
    /// source of truth for which shortcuts exist, and a refresh must not be
    /// able to reintroduce one the role filter removed.
    @MainActor
    static func refreshSubtitles(from snapshot: GearWidgetSnapshot) {
        let existing = UIApplication.shared.shortcutItems ?? []
        guard !existing.isEmpty else { return }
        UIApplication.shared.shortcutItems = existing.map { item in
            guard let action = GearTrackerQuickAction(rawValue: item.type) else { return item }
            return action.shortcutItem(subtitle: action.subtitle(for: snapshot))
        }
    }

    /// Routes through the App Intents handoff, which already solves the hard
    /// half of this: on a cold launch the destination is held until
    /// `AppTabView` appears, and on a warm launch it routes immediately.
    /// Returns whether the shortcut was recognised.
    @MainActor
    @discardableResult
    static func handle(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
        guard let action = GearTrackerQuickAction(rawValue: shortcutItem.type) else { return false }
        GearTrackerAppIntentHandoff.shared.request(action.destination)
        return true
    }
}
