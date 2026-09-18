import AppKit
import SwiftUI

/// Login palette shared with the web `login-bg`/`login-card` rules and the iOS
/// `BrandSplashScene`, so all three sign-in surfaces read as one product.
enum BrandPalette {
    /// Web `#140b10`.
    static let splashTop = Color(red: 0.078, green: 0.043, blue: 0.063)
    /// Web `#22090d`.
    static let splashMid = Color(red: 0.133, green: 0.035, blue: 0.051)
    /// Web `#3a0509`.
    static let splashBottom = Color(red: 0.227, green: 0.020, blue: 0.035)
    /// Web `rgba(196, 18, 48, 0.55)`.
    static let crimson = Color(red: 0.769, green: 0.071, blue: 0.188)
    /// Web `rgba(160, 0, 0, 0.65)`.
    static let ember = Color(red: 0.627, green: 0, blue: 0)
    /// Web `#c41230`, the focus and primary-action accent.
    static let accent = Color(red: 0.769, green: 0.071, blue: 0.188)
}

/// The dark crimson scene the sign-in lockup and card float over. Mirrors the
/// web `.login-bg` layering: a diagonal base with two radial glows.
struct BrandSplashScene: View {
    var body: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: BrandPalette.splashTop, location: 0),
                    .init(color: BrandPalette.splashMid, location: 0.5),
                    .init(color: BrandPalette.splashBottom, location: 1),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            GeometryReader { geo in
                ZStack {
                    RadialGradient(
                        colors: [BrandPalette.crimson.opacity(0.55), .clear],
                        center: UnitPoint(x: 0.15, y: 0),
                        startRadius: 0,
                        endRadius: geo.size.height * 0.9
                    )
                    RadialGradient(
                        colors: [BrandPalette.ember.opacity(0.65), .clear],
                        center: UnitPoint(x: 0.9, y: 1),
                        startRadius: 0,
                        endRadius: geo.size.height * 0.8
                    )
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Icon, wordmark, and subtitle. Sits on the scene rather than inside the card,
/// matching the web and iOS lockups.
struct BrandSplashLockup: View {
    var subtitle: String?

    var body: some View {
        VStack(spacing: 0) {
            WisconsinCreativeIcon(size: 56)
                .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
                .padding(.bottom, 12)

            Text("Wisconsin Creative")
                .font(.system(size: 22, weight: .heavy, design: .default))
                .kerning(-0.4)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.45), radius: 8, y: 2)

            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.65))
                    .padding(.top, 3)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(subtitle.map { "Wisconsin Creative. \($0)" } ?? "Wisconsin Creative")
    }
}

/// The light material card. Web renders this with `data-theme="light"`, so the
/// contents stay dark-on-light regardless of the surrounding appearance.
struct BrandLoginCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .environment(\.colorScheme, .light)
            .padding(16)
            .background {
                // Web pairs 88% white with `backdrop-filter: blur(24px) saturate(150%)`.
                // A material alone reads gray over this scene, so the material
                // supplies the depth and a near-opaque white supplies the value.
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(.white.opacity(0.9))
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [.white.opacity(0.65), .white.opacity(0.25)],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            }
            .shadow(color: .black.opacity(0.45), radius: 24, y: 12)
            .shadow(color: .black.opacity(0.30), radius: 8, y: 4)
    }
}

enum StatusTone: String, Sendable {
    case blue, red, orange, purple, gray
}

enum Brand {
    enum Radius {
        static let md: CGFloat = 16
    }
}

extension Color {
    static let cardSurface = Color(nsColor: .controlBackgroundColor)
    static let hairline = Color(nsColor: .separatorColor).opacity(0.5)

    static func statusText(_ tone: StatusTone) -> Color {
        switch tone {
        case .blue: adaptive(light: (0.149, 0.388, 0.922), dark: (0.40, 0.65, 1.0))
        case .red: adaptive(light: (0.863, 0.149, 0.149), dark: (1.0, 0.40, 0.40))
        case .orange: adaptive(light: (0.851, 0.467, 0.024), dark: (1.0, 0.70, 0.30))
        case .purple: adaptive(light: (0.486, 0.227, 0.929), dark: (0.70, 0.55, 1.0))
        case .gray: Color.secondary
        }
    }

    static func statusBackground(_ tone: StatusTone) -> Color {
        switch tone {
        case .blue: adaptive(light: (0.937, 0.965, 1.0), dark: (0.40, 0.65, 1.0), darkAlpha: 0.18)
        case .red: adaptive(light: (0.996, 0.949, 0.949), dark: (1.0, 0.40, 0.40), darkAlpha: 0.18)
        case .orange: adaptive(light: (1.0, 0.969, 0.929), dark: (1.0, 0.70, 0.30), darkAlpha: 0.18)
        case .purple: adaptive(light: (0.961, 0.953, 1.0), dark: (0.70, 0.55, 1.0), darkAlpha: 0.18)
        case .gray: Color.secondary.opacity(0.12)
        }
    }

    private static func adaptive(
        light: (CGFloat, CGFloat, CGFloat),
        dark: (CGFloat, CGFloat, CGFloat),
        lightAlpha: CGFloat = 1,
        darkAlpha: CGFloat = 1
    ) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let pair = isDark ? dark : light
            return NSColor(
                srgbRed: pair.0,
                green: pair.1,
                blue: pair.2,
                alpha: isDark ? darkAlpha : lightAlpha
            )
        })
    }
}

/// Same 4pt leading rail the iOS booking cards use.
struct StatusRail: View {
    let tone: StatusTone

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color.statusText(tone))
            .frame(width: 4)
            .accessibilityHidden(true)
    }
}
