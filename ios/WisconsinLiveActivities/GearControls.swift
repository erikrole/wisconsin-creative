import AppIntents
import SwiftUI
import WidgetKit

/// Control Center / Lock Screen buttons for the three field actions people
/// reach for without opening the app. Each opens a custom URL that the main
/// app parses through `GearTrackerRouteParser`, so capability gating, sign-in
/// recovery, and mutation refusal stay on one path.
///
/// These never write. Scan looks up; My Gear and Reserve open existing
/// surfaces. Custody still starts at the kiosk.
struct ScanGearControl: ControlWidget {
    static let kind = "com.erikrole.Wisconsin.control.scan"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "wisconsin://scan")!)) {
                Label("Scan Gear", systemImage: "barcode.viewfinder")
            }
        }
        .displayName("Scan Gear")
        .description("Look up gear by barcode or QR code.")
    }
}

struct MyGearControl: ControlWidget {
    static let kind = "com.erikrole.Wisconsin.control.myGear"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "wisconsin://bookings")!)) {
                Label("My Gear", systemImage: "bag")
            }
        }
        .displayName("My Gear")
        .description("Open checkouts and reservations.")
    }
}

struct ReserveGearControl: ControlWidget {
    static let kind = "com.erikrole.Wisconsin.control.reserve"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "wisconsin://reserve")!)) {
                Label("New Reservation", systemImage: "plus.circle")
            }
        }
        .displayName("New Reservation")
        .description("Reserve gear for a later pickup.")
    }
}
