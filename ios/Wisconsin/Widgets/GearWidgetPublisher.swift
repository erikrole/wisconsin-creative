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
            .prefix(20)
            .map { booking in
                GearWidgetSnapshot.DueBooking(
                    id: booking.id,
                    title: booking.title,
                    endsAt: booking.endsAt,
                    itemCount: booking.itemCount,
                    isOverdue: booking.isOverdue
                )
            }

        let upcomingShifts = dashboard.myShifts
            .filter { $0.endsAt > now }
            .sorted {
                if $0.startsAt != $1.startsAt { return $0.startsAt < $1.startsAt }
                return $0.id < $1.id
            }
            .prefix(5)
            .map { shift in
                GearWidgetSnapshot.Shift(
                    id: shift.id,
                    title: shift.event.summary,
                    area: shift.area,
                    startsAt: shift.startsAt,
                    endsAt: shift.endsAt,
                    locationName: shift.event.locationName,
                    gearLabel: shift.gearLabel.isEmpty ? nil : shift.gearLabel,
                    eventId: shift.event.id
                )
            }

        let dueToday = myCheckouts.filter {
            !$0.isOverdue && calendar.isDate($0.endsAt, inSameDayAs: now)
        }

        return GearWidgetSnapshot(
            generatedAt: now,
            nextShift: upcomingShifts.first,
            dueBookings: Array(dueBookings),
            // `myCheckouts.overdue`, not `dashboard.overdueCount` — see above.
            overdueCount: dashboard.myCheckouts.overdue,
            dueTodayCount: dueToday.count,
            upcomingShifts: Array(upcomingShifts)
        )
    }
}
