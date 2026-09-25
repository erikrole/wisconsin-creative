import SwiftUI
import UIKit

/// Single source of truth for haptic feedback across the app.
/// Use over raw `UINotificationFeedbackGenerator` / `.sensoryFeedback` in new code.
enum HapticsPreference {
    static let key = "WisconsinHapticsEnabled"

    static var isEnabled: Bool {
        guard UserDefaults.standard.object(forKey: key) != nil else { return true }
        return UserDefaults.standard.bool(forKey: key)
    }
}

enum Haptics {
    /// Confirmation of a successful mutation (booking created, trade claimed, etc.).
    @MainActor static func success() {
        guard HapticsPreference.isEnabled else { return }
        let gen = UINotificationFeedbackGenerator()
        gen.notificationOccurred(.success)
    }

    /// Surfaced error or warning.
    @MainActor static func error() {
        guard HapticsPreference.isEnabled else { return }
        let gen = UINotificationFeedbackGenerator()
        gen.notificationOccurred(.error)
    }

    /// Warning / non-blocking notice.
    @MainActor static func warning() {
        guard HapticsPreference.isEnabled else { return }
        let gen = UINotificationFeedbackGenerator()
        gen.notificationOccurred(.warning)
    }

    /// Selection change — toggles, segmented controls, picker rows.
    @MainActor static func selection() {
        guard HapticsPreference.isEnabled else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    /// A deliberate threshold crossed during a gesture, such as pulling past
    /// the top of Schedule into earlier weeks. Heavier than `selection()` so
    /// it reads as a boundary rather than a tick.
    @MainActor static func threshold() {
        guard HapticsPreference.isEnabled else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

}
