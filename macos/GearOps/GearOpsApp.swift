import AppKit
import SwiftUI

enum GearOpsWindow {
    static let settings = "settings"
    static let status = "status"
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
                if let count = model.menuBarCount(at: model.labelClock) {
                    Text(count, format: .number)
                        .monospacedDigit()
                }
            }
            .accessibilityLabel(model.menuBarAccessibilityLabel(at: model.labelClock))
        }
        // Bookings, pickups, health, and sign-in are too complex for a flat
        // command menu, which is Apple's documented exception to "display a
        // menu, not a popover" for menu bar extras.
        .menuBarExtraStyle(.window)
        .onChange(of: preferences.showsMenuBarExtra, initial: true) { _, visible in
            GearOpsActivation.apply(showsMenuBarExtra: visible)
        }
        .onChange(of: preferences.usesGlobalShortcut, initial: true) { _, enabled in
            #if DEBUG
            // Capture fixtures run beside the installed app; never take its key.
            if GearOpsFixture.isActive { return }
            #endif
            GlobalShortcut.shared.setEnabled(enabled)
        }

        // The same glance content as the extra, in an ordinary window. The
        // global shortcut and Dock reopen use it when the extra is hidden or
        // macOS has tucked it away for space; capture fixtures present it.
        Window(GearOpsApp.statusWindowTitle, id: GearOpsWindow.status) {
            MenuBarContentView(model: model)
        }
        .windowResizability(.contentSize)
        .defaultLaunchBehavior(GearOpsApp.presentsStatusAtLaunch ? .presented : .suppressed)
        // A login item must not reopen this window unbidden at the next login.
        .restorationBehavior(.disabled)

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
            CommandGroup(after: .appSettings) {
                Button(GearOpsStatusPresenter.menuItemTitle) {
                    NSApplication.shared.activate()
                    openWindow(id: GearOpsWindow.status)
                }
            }
        }
    }

    /// `GEAROPS_FIXTURE=glance` keeps the fixture title so review captures
    /// stay matched to earlier baselines.
    static var statusWindowTitle: String {
        #if DEBUG
        if GearOpsFixture.isActive { return "Wisconsin Creative Fixture" }
        #endif
        return "Wisconsin Creative"
    }

    private static var presentsStatusAtLaunch: Bool {
        #if DEBUG
        return GearOpsFixture.isActive
        #else
        return false
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
