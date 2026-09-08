import SwiftUI

/// Single banner style used across the app — network status, refresh failures,
/// session warnings. Embed wherever you need it via `.overlay(alignment: .top)`
/// or the dedicated tab-bar banner mount in `AppTabView`.
struct BannerView: View {
    enum Severity {
        case info
        case warning
        case error

        var background: AnyShapeStyle {
            switch self {
            case .info:    return AnyShapeStyle(.regularMaterial)
            case .warning: return AnyShapeStyle(Color.statusText(.orange).gradient)
            case .error:   return AnyShapeStyle(Color.statusText(.red).gradient)
            }
        }

        var foreground: Color {
            switch self {
            case .info: return .primary
            case .warning, .error: return .white
            }
        }
    }

    let severity: Severity
    let message: String
    let systemImage: String
    var messageLineLimit: Int? = 2
    var actionLabel: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
            Text(message)
                .font(.footnote.weight(.medium))
                .lineLimit(messageLineLimit)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 8)
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .font(.footnote.weight(.semibold))
                    .tint(severity == .info ? Color.brandPrimary : .white)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(severity.background, in: RoundedRectangle(cornerRadius: 12))
        .foregroundStyle(severity.foreground)
        .padding(.horizontal, 12)
        .shadow(color: Color.primary.opacity(0.08), radius: 8, y: 2)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// Persistent action feedback mounted outside scrolling form content. It does
/// not compete with a confirmation dialog for a modal presentation slot.
struct ActionErrorBanner: View {
    let title: String
    let message: String
    var actionLabel: String? = nil
    var action: (() -> Void)? = nil
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
            Text(message)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                if let actionLabel, let action {
                    Button(actionLabel, action: action)
                        .frame(minHeight: 44)
                }
                Spacer()
                Button("Dismiss", action: onDismiss)
                    .frame(minHeight: 44)
            }
            .font(.footnote.weight(.semibold))
        }
        .foregroundStyle(Color.statusText(.red))
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
        .accessibilityElement(children: .contain)
        .onAppear { announce() }
        .onChange(of: message) { _, _ in announce() }
    }

    private func announce() {
        AccessibilityNotification.Announcement("\(title). \(message)").post()
    }
}
