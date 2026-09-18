import SwiftUI

// MARK: - Reusable avatar

struct AccountAvatar: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.appearsActive) private var appearsActive
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
        // Custom chrome has to dim with the system tab labels when an iPad or
        // resized iPhone window is inactive.
        .opacity(appearsActive ? 1 : 0.5)
    }
}
