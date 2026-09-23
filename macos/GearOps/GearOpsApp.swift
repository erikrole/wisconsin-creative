import AppKit
import SwiftUI

enum GearOpsWindow {
    static let settings = "settings"
    static let fixture = "fixture"
}

@main
struct GearOpsApp: App {
    @NSApplicationDelegateAdaptor(GearOpsAppDelegate.self) private var appDelegate
    @State private var model = GearOpsApp.makeModel()
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        @Bindable var preferences = model.appPreferences

        MenuBarExtra(isInserted: $preferences.showsMenuBarExtra) {
            MenuBarContentView(model: model)
        } label: {
            // Template (black/clear) SF Symbol so the system can tint it for
            // light/dark menu bars and the selected state. Apple asks extras
            // not to animate and to stay recognizable; health does not swap
            // the glyph. The optional count stays a static numeral.
            HStack(spacing: 4) {
                Image(systemName: model.menuBarSymbol)
                    .symbolRenderingMode(.monochrome)
                if model.appPreferences.showsMenuBarCount, let count = model.custodyCount {
                    Text(count, format: .number)
                        .monospacedDigit()
                }
            }
            .accessibilityLabel(model.menuBarAccessibilityLabel)
        }
        // Bookings, pickups, health, and sign-in are too complex for a flat
        // command menu, which is Apple's documented exception to "display a
        // menu, not a popover" for menu bar extras.
        .menuBarExtraStyle(.window)
        .onChange(of: preferences.showsMenuBarExtra, initial: true) { _, visible in
            GearOpsActivation.apply(showsMenuBarExtra: visible)
        }

        // Not a `Settings` scene: an accessory app never activates itself, so
        // the settings window opened behind every other window and read as
        // "nothing happened". `SettingsLink(preAction:)`, which exists to fix
        // exactly that, is not in this SDK. An explicit window lets the menu
        // activate the app first and then order this window front.
        Window("Wisconsin Creative Settings", id: GearOpsWindow.settings) {
            GearOpsSettingsView(model: model)
        }
        .windowResizability(.contentSize)
        .defaultPosition(.center)

        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    NSApplication.shared.activate()
                    openWindow(id: GearOpsWindow.settings)
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }

        #if DEBUG
        // Capture surface for `GEAROPS_FIXTURE=glance`: the popover content in
        // an ordinary window, since a menu bar extra cannot be opened by script.
        Window("Wisconsin Creative Fixture", id: GearOpsWindow.fixture) {
            MenuBarContentView(model: model)
        }
        .windowResizability(.contentSize)
        .defaultLaunchBehavior(GearOpsFixture.isActive ? .presented : .suppressed)
        #endif
    }

    @MainActor
    private static func makeModel() -> GearOpsModel {
        #if DEBUG
        if GearOpsFixture.isActive { return GearOpsFixture.makeModel() }
        #endif
        return GearOpsModel()
    }
}
