import SwiftUI

/// Lightweight transient banner used for non-intrusive feedback (e.g. a
/// failed-but-recoverable API call). Prefer this over `.alert` per HIG —
/// alerts are reserved for situations the user must respond to immediately.
///
/// Usage:
/// ```swift
/// @State private var toast: Toast?
///
/// .toast($toast)
/// ```
/// Set `toast = Toast(message: "…", icon: "checkmark.circle.fill")` to show.
/// Auto-dismisses after `dismissAfter` seconds.
struct Toast: Equatable {
    let message: String
    let icon: String
    var role: Role = .info

    enum Role: Equatable {
        case info, success, error
    }
}

extension View {
    /// Presents a transient toast at the bottom safe area. Auto-dismisses
    /// after `dismissAfter` seconds.
    func toast(_ binding: Binding<Toast?>, dismissAfter: TimeInterval = 2.5) -> some View {
        modifier(ToastModifier(toast: binding, dismissAfter: dismissAfter))
    }
}

private struct ToastModifier: ViewModifier {
    @Binding var toast: Toast?
    let dismissAfter: TimeInterval
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let toast {
                    ToastView(toast: toast)
                        .padding(.bottom, 24)
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : .spring(duration: 0.3), value: toast)
            .onChange(of: toast) { _, newToast in
                guard let newToast else { return }
                AccessibilityNotification.Announcement(newToast.message).post()
                Task {
                    try? await Task.sleep(for: .seconds(dismissAfter))
                    if toast == newToast { toast = nil }
                }
            }
    }
}

private struct ToastView: View {
    let toast: Toast

    private var iconColor: Color {
        switch toast.role {
        case .info: Color.statusText(.blue)
        case .success: Color.statusText(.green)
        case .error: Color.statusText(.red)
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.icon)
                .foregroundStyle(iconColor)
                .accessibilityHidden(true)
            Text(toast.message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}
