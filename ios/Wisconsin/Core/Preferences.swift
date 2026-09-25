import SwiftUI

// MARK: - Theme override

/// Per-device theme override mirrored from web's `/settings/appearance`.
/// `system` follows the OS preference; `light` / `dark` force a fixed scheme.
enum ThemeChoice: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "System"
        case .light:  "Light"
        case .dark:   "Dark"
        }
    }

    /// `nil` = follow the OS; non-nil = force the corresponding scheme.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light:  .light
        case .dark:   .dark
        }
    }
}

// MARK: - Notification preferences view model

/// Drives the Notifications section in `ProfileView`. Loads the caller's
/// preferences from `/api/me/notification-preferences`, applies optimistic
/// updates locally, and reverts on save failure.
///
/// Against a server that returns the category catalog, every change is a
/// `PATCH` of only the changed field, and categories are Off / Silent /
/// Standard levels. Against an older server (no catalog) the screen falls back
/// to the boolean categories and full-record `PUT` it always used.
@MainActor
@Observable
final class NotificationPrefsViewModel {
    var prefs: NotificationPreferences?
    /// The categories this account's role receives, in display order.
    var catalog: [NotificationCategoryEntry] = []
    var loading: Bool = false
    var saving: Bool = false
    var error: String?

    private var quietHoursSaveTask: Task<Void, Never>?

    /// The server supports per-category levels and quiet hours.
    var supportsLevels: Bool { !catalog.isEmpty }

    /// Quiet hours and levels are evaluated in the app timezone, not the device's.
    static let appTimeZone = TimeZone(identifier: "America/Chicago") ?? .current

    private static let isoWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoBasic: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    func load() async {
        if loading || saving { return }
        let sessionBoundary = authSessionBoundary.capture()
        loading = true
        error = nil
        defer { loading = false }
        do {
            let loaded = try await APIClient.shared.notificationPreferencesWithCatalog()
            guard authSessionBoundary.owns(sessionBoundary) else { return }
            prefs = loaded.data
            catalog = loaded.catalog ?? []
        } catch {
            guard authSessionBoundary.owns(sessionBoundary) else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't load preferences"
        }
    }

    /// Toggle a single channel; reverts on save failure.
    func setChannel(_ channel: Channel, value: Bool) async {
        guard !saving, !loading, var current = prefs else { return }
        let prev = current
        switch channel {
        case .email: current.channels.email = value
        case .push:  current.channels.push  = value
        }
        prefs = current
        let key = channel == .email ? "email" : "push"
        let saved = await save(current, fallbackTo: prev, patch: .init(channels: [key: value]))
        if saved, channel == .push, !value {
            await NotificationSnooze.cancelPending()
        }
    }

    func categoryValue(_ category: Category) -> Bool {
        let categories = prefs?.categories ?? Self.defaultCategories
        switch category {
        case .checkoutDue:      return categories.checkoutDue
        case .checkoutOverdue:  return categories.checkoutOverdue
        case .reservation:      return categories.reservation
        case .licenseExpiry:    return categories.licenseExpiry
        case .schedule:         return categories.schedule
        case .trade:            return categories.trade
        case .gearPrep:         return categories.gearPrep
        }
    }

    /// Toggle a single notification type; reverts on save failure.
    func setCategory(_ category: Category, value: Bool) async {
        guard !saving, !loading, var current = prefs else { return }
        let prev = current
        var categories = current.categories ?? Self.defaultCategories
        switch category {
        case .checkoutDue:      categories.checkoutDue = value
        case .checkoutOverdue:  categories.checkoutOverdue = value
        case .reservation:      categories.reservation = value
        case .licenseExpiry:    categories.licenseExpiry = value
        case .schedule:         categories.schedule = value
        case .trade:            categories.trade = value
        case .gearPrep:         categories.gearPrep = value
        }
        current.categories = categories
        prefs = current
        let saved = await save(current, fallbackTo: prev)
        if saved { await NotificationSnooze.cancelPending() }
    }

    // MARK: Levels

    func level(for entry: NotificationCategoryEntry) -> NotificationPushLevel {
        prefs?.push?[entry.id] ?? entry.defaultLevel
    }

    /// Set one category's push level; reverts on save failure.
    func setLevel(_ level: NotificationPushLevel, for entry: NotificationCategoryEntry) async {
        guard supportsLevels, !saving, !loading, var current = prefs else { return }
        let prev = current
        var push = current.push ?? [:]
        push[entry.id] = level
        current.push = push
        prefs = current
        let saved = await save(current, fallbackTo: prev, patch: .init(push: [entry.id: level]))
        if saved, level == .off { await NotificationSnooze.cancelPending() }
    }

    /// Catalog entries grouped for display, keeping catalog order.
    var categoryGroups: [(id: String, title: String, entries: [NotificationCategoryEntry])] {
        var order: [String] = []
        var byGroup: [String: [NotificationCategoryEntry]] = [:]
        for entry in catalog {
            if byGroup[entry.group] == nil { order.append(entry.group) }
            byGroup[entry.group, default: []].append(entry)
        }
        return order.map { (id: $0, title: Self.groupTitle($0), entries: byGroup[$0] ?? []) }
    }

    private static func groupTitle(_ group: String) -> String {
        switch group {
        case "gear": "Gear"
        case "schedule": "Schedule"
        case "account": "Account"
        case "admin": "Admin"
        default: group.capitalized
        }
    }

    // MARK: Quiet hours

    /// Applies a quiet-hours edit immediately and saves it shortly after the
    /// last change, so scrolling a time wheel sends one request, not dozens.
    func updateQuietHours(_ change: (inout NotificationQuietHours) -> Void, debounce: Bool = false) {
        guard supportsLevels, var current = prefs, var quiet = current.quietHours else { return }
        change(&quiet)
        guard quiet != current.quietHours else { return }
        current.quietHours = quiet
        prefs = current

        quietHoursSaveTask?.cancel()
        quietHoursSaveTask = Task { [weak self] in
            if debounce {
                try? await Task.sleep(for: .milliseconds(700))
            }
            guard !Task.isCancelled else { return }
            await self?.saveQuietHours()
        }
    }

    private func saveQuietHours() async {
        // Wait out an in-flight save rather than dropping the edit.
        while saving {
            try? await Task.sleep(for: .milliseconds(100))
            if Task.isCancelled { return }
        }
        guard let current = prefs, let quiet = current.quietHours else { return }
        await save(current, fallbackTo: current, patch: .init(quietHours: quiet))
    }

    /// "HH:mm" in the app timezone, as a `Date` today for a time picker.
    static func quietHoursDate(_ time: String) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = appTimeZone
        let parts = time.split(separator: ":").compactMap { Int($0) }
        let hour = parts.first ?? 0
        let minute = parts.count > 1 ? parts[1] : 0
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }

    static func quietHoursTime(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = appTimeZone
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }

    func pause(for seconds: TimeInterval) async {
        await pause(until: Date().addingTimeInterval(seconds))
    }

    func pause(until: Date) async {
        guard !saving, !loading, var current = prefs, until > Date() else { return }
        let prev = current
        let stamp = Self.isoWithFractional.string(from: until)
        current.pausedUntil = stamp
        prefs = current
        let saved = await save(current, fallbackTo: prev, patch: .init(pausedUntil: .some(stamp)))
        if saved {
            await NotificationSnooze.cancelPending()
        }
    }

    func resume() async {
        guard !saving, !loading, var current = prefs else { return }
        let prev = current
        current.pausedUntil = nil
        prefs = current
        await save(current, fallbackTo: prev, patch: .init(pausedUntil: .some(nil)))
    }

    /// 7:00 AM tomorrow on this device, the "until morning" pause.
    static func tomorrowMorning(from now: Date = Date(), calendar: Calendar = .current) -> Date {
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        return calendar.date(bySettingHour: 7, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }

    /// Resolves the stored `pausedUntil` ISO string to a `Date` if it's still in
    /// the future. Returns nil for already-elapsed or missing values.
    var pausedUntilDate: Date? {
        guard let s = prefs?.pausedUntil else { return nil }
        let parsed = Self.isoWithFractional.date(from: s) ?? Self.isoBasic.date(from: s)
        guard let d = parsed, d > Date() else { return nil }
        return d
    }

    var isPaused: Bool { pausedUntilDate != nil }

    enum Channel { case email, push }

    enum Category { case checkoutDue, checkoutOverdue, reservation, licenseExpiry, schedule, trade, gearPrep }

    private static let defaultCategories = NotificationPreferences.Categories(
        checkoutDue: true,
        checkoutOverdue: true,
        reservation: true,
        licenseExpiry: true,
        schedule: true,
        trade: true,
        gearPrep: true
    )

    /// Saves `next`. With a catalog-aware server only `patch` is sent and the
    /// server's merged result is adopted; otherwise the whole record is `PUT`.
    @discardableResult
    private func save(
        _ next: NotificationPreferences,
        fallbackTo prev: NotificationPreferences,
        patch: NotificationPreferencesPatch? = nil
    ) async -> Bool {
        let sessionBoundary = authSessionBoundary.capture()
        error = nil
        saving = true
        defer { saving = false }
        do {
            if supportsLevels, let patch {
                let merged = try await APIClient.shared.patchNotificationPreferences(patch)
                guard authSessionBoundary.owns(sessionBoundary) else { return false }
                // A newer local edit (quiet-hours typing) wins over this echo.
                if prefs == next { prefs = merged.data }
                if let catalog = merged.catalog { self.catalog = catalog }
            } else {
                try await APIClient.shared.updateNotificationPreferences(next)
                guard authSessionBoundary.owns(sessionBoundary) else { return false }
            }
            return true
        } catch {
            guard authSessionBoundary.owns(sessionBoundary) else { return false }
            // The server may have committed before the response was lost.
            // Prefer an authoritative read; retain the prior display only if offline.
            let confirmed = try? await APIClient.shared.notificationPreferencesWithCatalog()
            guard authSessionBoundary.owns(sessionBoundary) else { return false }
            prefs = confirmed?.data ?? prev
            self.error = (error as? APIError)?.errorDescription ?? "Couldn't save"
            Haptics.error()
            return false
        }
    }
}
