import SwiftUI

/// The shared splash scene behind LoginView and PasswordSetupView. This is
/// sign-in content, not the system launch screen.
struct BrandSplashScene: View {
    var accentOpacity = 1.0

    /// Crimson glow — web `rgba(196, 18, 48, 0.55)`.
    private static let crimson = Color(red: 0.769, green: 0.071, blue: 0.188)
    /// Ember glow — web `rgba(160, 0, 0, 0.65)`.
    private static let ember = Color(red: 0.627, green: 0, blue: 0)

    var body: some View {
        ZStack {
            Color.brandSplashTop

            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: Color.brandSplashMid.opacity(0.85), location: 0.5),
                        .init(color: .brandSplashBottom, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )

                GeometryReader { geo in
                    ZStack {
                        RadialGradient(
                            colors: [Self.crimson.opacity(0.55), .clear],
                            center: UnitPoint(x: 0.15, y: 0),
                            startRadius: 0,
                            endRadius: geo.size.height * 0.9
                        )
                        RadialGradient(
                            colors: [Self.ember.opacity(0.65), .clear],
                            center: UnitPoint(x: 0.9, y: 1),
                            startRadius: 0,
                            endRadius: geo.size.height * 0.8
                        )
                        RadialGradient(
                            colors: [Self.crimson.opacity(0.18), .clear],
                            center: UnitPoint(x: 0.5, y: 0.45),
                            startRadius: 0,
                            endRadius: geo.size.height * 0.55
                        )
                    }
                }
            }
            .opacity(accentOpacity)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// The brand lockup shared by LoginView and PasswordSetupView.
struct BrandSplashLockup: View {
    var subtitle: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            Image("Badgers")
                .resizable()
                .scaledToFit()
                .frame(width: 80, height: 80)
                .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
                .accessibilityHidden(true)
                .padding(.bottom, 14)

            Text("Wisconsin Creative")
                .font(.gothamBlack(size: 26, relativeTo: .title2))
                .kerning(-0.4)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.45), radius: 8, y: 2)

            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.65))
                    .padding(.top, 4)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(subtitle.map { "Wisconsin Creative. \($0)" } ?? "Wisconsin Creative")
    }
}

extension View {
    /// Frosted material plus a white wash so the card reads as a light surface
    /// (web: rgba(255,255,255,0.88) + blur), not a pink one — the material
    /// alone soaks up too much of the red scene. Pins light tokens even though
    /// the surrounding splash is dark.
    func brandLoginCardChrome() -> some View {
        self
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                            .fill(Color.white.opacity(0.58))
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [.white.opacity(0.7), .white.opacity(0.22)],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            )
            .environment(\.colorScheme, .light)
            .shadow(color: Color(.sRGBLinear, white: 0, opacity: 0.35), radius: 20, y: 10)
    }
}

/// Quiet restore state shown only while the app has no optimistic session
/// snapshot and is validating `/me`. Matches the system launch frame and
/// Home's grouped background so launch is continuity, not a splash. Progress
/// appears only when validation takes long enough to need an explanation.
struct LaunchView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var restoreProgress: RestoreProgress = .hidden

    private enum RestoreProgress {
        case hidden
        case checking
        case stillChecking

        var label: String? {
            switch self {
            case .hidden: nil
            case .checking: "Checking your session"
            case .stillChecking: "Still checking your session"
            }
        }
    }

    private var accessibilityStatus: String {
        restoreProgress.label ?? "Opening Wisconsin Creative"
    }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground)

            if let progressLabel = restoreProgress.label {
                HStack(spacing: 9) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.secondary)
                        .accessibilityHidden(true)

                    Text(progressLabel)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .background(.fill.tertiary, in: Capsule())
                .transition(.opacity)
                .accessibilityHidden(true)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityStatus)
        .task {
            do {
                try await Task.sleep(for: .milliseconds(650))
            } catch {
                return
            }
            revealProgress(.checking)
            AccessibilityNotification.Announcement("Checking your session").post()

            do {
                try await Task.sleep(for: .seconds(3.35))
            } catch {
                return
            }
            revealProgress(.stillChecking)
            AccessibilityNotification.Announcement("Still checking your session").post()
        }
    }

    private func revealProgress(_ progress: RestoreProgress) {
        if reduceMotion {
            restoreProgress = progress
        } else {
            withAnimation(.easeIn(duration: 0.2)) {
                restoreProgress = progress
            }
        }
    }
}
