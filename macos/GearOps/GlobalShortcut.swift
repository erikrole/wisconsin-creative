import AppKit
import Carbon.HIToolbox

/// ⌃⌥⌘G from any app. Carbon's hot-key registration is the one system API that
/// needs no Accessibility permission; an `NSEvent` global monitor would.
@MainActor
final class GlobalShortcut {
    static let shared = GlobalShortcut()
    static let displayString = "⌃⌥⌘G"

    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?

    private init() {}

    func setEnabled(_ enabled: Bool) {
        enabled ? register() : unregister()
    }

    private func register() {
        guard hotKey == nil else { return }
        if handler == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { GearOpsStatusPresenter.toggle() }
                }
                return noErr
            }, 1, &spec, nil, &handler)
        }
        // 'WCst' identifies this app's only hot key.
        let id = EventHotKeyID(signature: 0x5743_7374, id: 1)
        let modifiers = UInt32(cmdKey | optionKey | controlKey)
        RegisterEventHotKey(UInt32(kVK_ANSI_G), modifiers, id, GetApplicationEventTarget(), 0, &hotKey)
    }

    private func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
    }
}

/// Opens the status surface from outside the extra: the global shortcut and a
/// Dock reopen. When the extra is on screen, its own item is clicked so the
/// popover behaves exactly as if the user had clicked it. When macOS has
/// tucked the extra away, or the user hid it, the same content opens in the
/// Status window instead, closing the "no visible entry point" gap.
@MainActor
enum GearOpsStatusPresenter {
    static let menuItemTitle = "Wisconsin Creative Status"

    static func toggle() {
        if let window = statusWindow(), window.isVisible {
            if window.isKeyWindow {
                window.orderOut(nil)
            } else {
                NSApplication.shared.activate()
                window.makeKeyAndOrderFront(nil)
            }
            return
        }
        if clickVisibleStatusItem() { return }
        showWindow()
    }

    static func showWindow() {
        NSApplication.shared.activate()
        if let window = statusWindow() {
            window.makeKeyAndOrderFront(nil)
            return
        }
        // The SwiftUI Window scene registers its command before the window
        // exists, the same recovery path the Dock uses for Settings.
        let item = NSApplication.shared.mainMenu?.items
            .compactMap(\.submenu)
            .flatMap(\.items)
            .first(where: { $0.title == menuItemTitle })
        if let item, let action = item.action {
            NSApplication.shared.sendAction(action, to: item.target, from: item)
        }
    }

    /// SwiftUI may suffix a `Window` scene's identifier, so match the prefix
    /// and fall back to the exact title, as the Dock's Settings lookup does.
    private static func statusWindow() -> NSWindow? {
        NSApplication.shared.windows.first {
            $0.identifier?.rawValue.hasPrefix(GearOpsWindow.status) == true
                || $0.title == GearOpsApp.statusWindowTitle
        }
    }

    /// The extra's status item lives in a system-owned window. Clicking its
    /// button is the only public way to open a SwiftUI `MenuBarExtra`; when the
    /// window is off screen (macOS hid the extra), fall back to the Status window.
    private static func clickVisibleStatusItem() -> Bool {
        guard let window = NSApplication.shared.windows.first(where: {
            $0.className.contains("StatusBarWindow") && $0.isVisible
                && $0.occlusionState.contains(.visible) && $0.screen != nil
        }),
              let button = window.contentView.flatMap(findButton) else { return false }
        button.performClick(nil)
        return true
    }

    private static func findButton(in view: NSView) -> NSButton? {
        if let button = view as? NSButton { return button }
        for subview in view.subviews {
            if let button = findButton(in: subview) { return button }
        }
        return nil
    }
}
