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
    var actionLabel: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
            Text(message)
                .font(.footnote.weight(.medium))
                .lineLimit(2)
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
