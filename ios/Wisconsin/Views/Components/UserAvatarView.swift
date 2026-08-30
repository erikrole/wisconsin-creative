import SwiftUI

/// Circular user avatar with an initials fallback while the image loads
/// or when no photo is set. Shared by user lists, pickers, and form rows.
struct UserAvatarView: View {
    let name: String
    let avatarUrl: String?
    var size: CGFloat = 36
    var fallbackBackground: Color = Color.brandPrimary.opacity(0.12)
    var fallbackForeground: Color = Color.brandPrimary
    var showsBorder = true
    @ScaledMetric(relativeTo: .caption2) private var minimumInitialsSize: CGFloat = 11

    var body: some View {
        if let urlString = avatarUrl, !urlString.isEmpty, let url = URL(string: urlString) {
            // Initials sit underneath as the placeholder; the cached, downsampled
            // photo fades in on top and persists across reloads. Plain AsyncImage
            // re-fetched on every list refresh and flickered back to initials.
            ZStack {
                initialsCircle
                CachedThumbnail(url: url, size: size)
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay {
                if showsBorder {
                    Circle().strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5)
                }
            }
        } else {
            initialsCircle
        }
    }

    private var initialsCircle: some View {
        ZStack {
            Circle()
                .fill(fallbackBackground)
                .frame(width: size, height: size)
            Text(initials.isEmpty ? "?" : initials)
                .font(.system(size: max(size * 0.36, minimumInitialsSize), weight: .semibold))
                .foregroundStyle(fallbackForeground)
        }
        .overlay {
            if showsBorder {
                Circle().strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5)
            }
        }
    }

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}
