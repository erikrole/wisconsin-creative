import AppKit
import SwiftUI

enum ExtraKey: Equatable {
    case up
    case down
    case select
    case cancel
}

/// Bridges the extra's hosting window to SwiftUI: each presentation (the
/// window becoming key) and unmodified navigation keys pressed while it is key.
/// SwiftUI's `onAppear` does not reliably fire per presentation for a
/// window-style menu bar extra, and a focused text field consumes arrow keys
/// before `onKeyPress` sees them, so both come from AppKit here.
struct ExtraWindowEvents: NSViewRepresentable {
    var onBecomeKey: () -> Void
    /// Returns true when the key was handled and must not reach the field.
    var onKey: (ExtraKey) -> Bool

    func makeNSView(context: Context) -> ExtraWindowEventsView {
        let view = ExtraWindowEventsView()
        view.onBecomeKey = onBecomeKey
        view.onKey = onKey
        return view
    }

    func updateNSView(_ nsView: ExtraWindowEventsView, context: Context) {
        nsView.onBecomeKey = onBecomeKey
        nsView.onKey = onKey
    }
}

@MainActor
final class ExtraWindowEventsView: NSView {
    var onBecomeKey: (() -> Void)?
    var onKey: ((ExtraKey) -> Bool)?

    private var keyObserver: NSObjectProtocol?
    private var keyMonitor: Any?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stopObserving()
        guard let window else { return }

        keyObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeKeyNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.onBecomeKey?() }
        }
        if window.isKeyWindow { onBecomeKey?() }

        let windowNumber = window.windowNumber
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.windowNumber == windowNumber,
                  event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty,
                  let key = Self.key(for: event.keyCode) else { return event }
            let handled = MainActor.assumeIsolated { self?.onKey?(key) ?? false }
            return handled ? nil : event
        }
    }

    private func stopObserving() {
        if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyObserver = nil
        keyMonitor = nil
    }

    private nonisolated static func key(for keyCode: UInt16) -> ExtraKey? {
        switch keyCode {
        case 125: .down
        case 126: .up
        case 36, 76: .select // Return, keypad Enter
        case 53: .cancel // Escape
        default: nil
        }
    }
}
