import Combine
import SwiftUI
import UIKit

/// The calendar day the app is currently living in, as an observable
/// dependency.
///
/// `Calendar.isDateInToday` and friends read the wall clock, but SwiftUI only
/// re-runs a body when one of its inputs changes. A row whose inputs are just
/// `date` therefore keeps whatever "Today"/"Tomorrow" it computed before
/// midnight: an app left open overnight showed Friday's events under
/// "Tomorrow" on Friday morning. Views that label or filter by the current day
/// read `\.today` instead, so the midnight rollover re-renders them.
private struct TodayKey: EnvironmentKey {
    /// Computed, not stored, so previews and views outside a provider never
    /// freeze on the day the key was first touched.
    static var defaultValue: Date { Calendar.current.startOfDay(for: .now) }
}

extension EnvironmentValues {
    /// Start of the current local day. Provided at each app root by
    /// `providesCurrentDay()`.
    var today: Date {
        get { self[TodayKey.self] }
        set { self[TodayKey.self] = newValue }
    }
}

extension Calendar {
    /// Whole calendar days from `reference`'s day to `date`'s day: 0 is the
    /// same day, 1 is the next day, -1 is the previous day. Pass the
    /// environment's `today` as `reference` rather than reading the clock.
    func dayOffset(of date: Date, from reference: Date) -> Int {
        dateComponents([.day], from: startOfDay(for: reference), to: startOfDay(for: date)).day ?? 0
    }
}

private struct CurrentDayProvider: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    @State private var today = Calendar.current.startOfDay(for: .now)

    func body(content: Content) -> some View {
        content
            .environment(\.today, today)
            .onReceive(
                NotificationCenter.default.publisher(for: .NSCalendarDayChanged)
                    .merge(with: NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification))
                    .receive(on: RunLoop.main)
            ) { _ in refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { refresh() }
            }
    }

    /// Publishes only a real change so an unchanged day never invalidates the
    /// whole tree.
    private func refresh() {
        let current = Calendar.current.startOfDay(for: .now)
        if current != today { today = current }
    }
}

extension View {
    /// Keeps `\.today` current across midnight, clock, time-zone, and DST
    /// changes, and when the scene returns to the foreground.
    func providesCurrentDay() -> some View {
        modifier(CurrentDayProvider())
    }
}
