import SwiftUI

// MARK: - Reusable avatar

struct AccountAvatar: View {
    @Environment(SessionStore.self) private var session
    let size: CGFloat

    var body: some View {
        UserAvatarView(
            name: session.currentUser?.name ?? "",
            avatarUrl: session.currentUser?.avatarUrl,
            size: size,
            fallbackBackground: Color.brandPrimary.opacity(0.15),
            fallbackForeground: Color.brandPrimary,
            showsBorder: false
        )
    }
}
