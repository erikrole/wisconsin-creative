import SwiftUI

enum GearOpsWindow {
    static let settings = "settings"
}

@main
struct GearOpsApp: App {
    @NSApplicationDelegateAdaptor(GearOpsAppDelegate.self) private var appDelegate
    @State private var model = GearOpsModel()
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        @Bindable var preferences = model.appPreferences

        MenuBarExtra(isInserted: $preferences.showsMenuBarExtra) {
            MenuBarContentView(model: model)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: model.menuBarSymbol)
                if model.appPreferences.showsMenuBarCount, let count = model.custodyCount {
                    Text(count, format: .number)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
            }
            .accessibilityLabel(model.menuBarAccessibilityLabel)
        }
        .menuBarExtraStyle(.window)

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
                    openWindow(id: GearOpsWindow.settings)
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}
