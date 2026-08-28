import Foundation
import WidgetKit

/// Builds the Home Screen widget snapshot from a loaded dashboard and hands it
/// to the shared container.
///
/// Everything published here is the signed-in user's own work. The dashboard
/// payload is deliberately two-scoped: `myCheckouts` is the caller's, while
/// `overdueCount` and `stats.overdue` are team-wide totals for staff and
/// admins (`totalOverdue` in `/api/dashboard`). A widget renders on a lock
/// screen without unlocking the app, so it reads only the `my`-scoped fields —
/// a personal card must never quietly become a team readout.
enum GearWidgetPublisher {
    static func publish(from dashboard: DashboardData, now: Date = Date()) {
        GearWidgetStore.write(snapshot(from: dashboard, now: now))
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Called at every session boundary. Reloading after the clear is what
    /// makes the Home Screen actually drop the previous account's rows instead
    /// of holding the last rendered timeline.
    static func clear() {
        GearWidgetStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Pure so it can be exercised without a shared container.
    static func snapshot(from dashboard: DashboardData, now: Date = Date()) -> GearWidgetSnapshot {
        let myCheckouts = dashboard.myCheckouts.items
        let calendar = Calendar.current

        let dueBookings = myCheckouts
            .sorted { $0.endsAt < $1.endsAt }
            .prefix(5)
            .map { booking in
                GearWidgetSnapshot.DueBooking(
                    id: booking.id,
                    title: booking.title,
                    endsAt: booking.endsAt,
                    itemCount: booking.itemCount,
                    isOverdue: booking.isOverdue
                )
            }

        let dueToday = myCheckouts.filter {
            !$0.isOverdue && calendar.isDate($0.endsAt, inSameDayAs: now)
        }

        return GearWidgetSnapshot(
            generatedAt: now,
            nextShift: nextShift(from: dashboard.myShifts, now: now),
            dueBookings: Array(dueBookings),
            // `myCheckouts.overdue`, not `dashboard.overdueCount` — see above.
            overdueCount: dashboard.myCheckouts.overdue,
            dueTodayCount: dueToday.count
        )
    }

    /// The next shift that has not already ended, so a widget glanced at
    /// mid-shift still shows the shift you are working rather than skipping to
    /// the following one.
    private static func nextShift(
        from shifts: [DashboardShift],
        now: Date
    ) -> GearWidgetSnapshot.Shift? {
        guard let shift = shifts
            .filter({ $0.endsAt > now })
            .min(by: { $0.startsAt < $1.startsAt })
        else { return nil }

        let gearLabel = shift.gearLabel
        return GearWidgetSnapshot.Shift(
            id: shift.id,
            title: shift.event.summary,
            area: shift.area,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            // Site name only. `DashboardShiftEvent.isHome` is a home/away flag,
            // not a venue, and must never be turned into one.
            locationName: shift.event.locationName,
            gearLabel: gearLabel.isEmpty ? nil : gearLabel
        )
    }
}
