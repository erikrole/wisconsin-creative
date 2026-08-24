import SwiftUI

/// Small status pill that mirrors the web `<Badge variant="...">` component.
/// Uses paired bg/text colors from `Color.statusBackground/statusText` so iOS
/// stays visually in sync with the web design tokens.
///
/// Web reference: src/components/ui/badge.tsx + src/lib/status-styles.ts
struct StatusPill: View {
    let label: String
    let tone: StatusTone

    /// When true, applies the same heading-font + tracking treatment that web's
    /// RoleBadge uses. Default off so general status pills (Inactive, Available)
    /// stay calm, matching the web Badge component.
    var emphasized: Bool = false

    var body: some View {
        Text(label)
            .font(emphasized
                ? .caption2.weight(.semibold)
                : .caption2.weight(.medium))
            .tracking(emphasized ? 0.5 : 0.2)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .foregroundStyle(Color.statusText(tone))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.statusBackground(tone), in: Capsule())
    }
}

extension StatusPill {
    /// Convenience for role pills — matches web RoleBadge: capitalized name,
    /// emphasized typography, role→tone via `StatusTone.forRole`.
    static func role(_ role: String) -> some View {
        let displayed = StatusTone.publicDirectoryRole(role)
        StatusPill(
            label: displayed.prefix(1).uppercased() + displayed.dropFirst().lowercased(),
            tone: .forRole(displayed),
            emphasized: true
        )
    }
}
