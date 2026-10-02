import SwiftUI

// MARK: - Auth surface tokens
//
// The sign-in family (Login, Set your password, the can't-reach launch state)
// follows the kiosk's visual language: flat solid surfaces, hairline strokes,
// a white primary pill, white selection outlines. The crimson scene behind it
// stays; nothing on top of it is frosted, translucent, or red.
//
// `Kiosk/**` is excluded from this target, so the values are mirrored from
// `Kiosk/KioskDesign.swift` rather than imported. `tests/ios-auth-design.test.ts`
// fails if the two drift.

private func authHex(_ hex: UInt32) -> Color {
    Color(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255
    )
}

enum AuthPalette {
    static let base = authHex(0x0B0B0D)
    static let card = authHex(0x131316)
    static let field = authHex(0x18181D)
    static let control = authHex(0x1E1E23)
    static let strokeHairline = authHex(0x1E1E23)
    static let strokeStandard = authHex(0x2A2A31)
    static let strokeStrong = authHex(0x2E2E36)
    static let selected = authHex(0xF2F2F4)
    static let textPrimary = authHex(0xF2F2F4)
    static let textSecondary = authHex(0xA6A6AE)
    static let textTertiary = authHex(0x8A8A93)
    static let onPrimary = authHex(0x0B0B0D)
}

enum AuthButtonRole {
    /// The one action the screen is for: solid white pill, dark label.
    case primary
    /// A supporting action: dark pill with a stroke.
    case secondary
}

/// Mirrors `KioskPillButtonStyle` at a phone-sized 52pt target.
///
/// `adaptive` is for surfaces that follow the system appearance (the launch
/// screen shares Home's grouped background), where the kiosk's fixed dark
/// values would not read. The pill keeps the same shape and inversion.
struct AuthPillButtonStyle: ButtonStyle {
    let role: AuthButtonRole
    var adaptive = false
    @Environment(\.isEnabled) private var isEnabled

    private var fill: Color {
        if !isEnabled, role == .primary, !adaptive { return AuthPalette.control }
        return switch (role, adaptive) {
        case (.primary, false): AuthPalette.textPrimary
        case (.primary, true): Color(.label)
        case (.secondary, false): AuthPalette.control
        case (.secondary, true): Color(.secondarySystemFill)
        }
    }

    private var stroke: Color {
        if !isEnabled, role == .primary, !adaptive { return AuthPalette.strokeStandard }
        return switch (role, adaptive) {
        case (.primary, false): AuthPalette.textPrimary
        case (.primary, true): Color(.label)
        case (.secondary, false): AuthPalette.strokeStrong
        case (.secondary, true): Color(.separator)
        }
    }

    private var foreground: Color {
        if !isEnabled, role == .primary, !adaptive { return AuthPalette.textTertiary }
        return switch (role, adaptive) {
        case (.primary, false): AuthPalette.onPrimary
        case (.primary, true): Color(.systemBackground)
        case (.secondary, false): AuthPalette.textPrimary
        case (.secondary, true): Color(.label)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(fill, in: Capsule())
            .overlay(Capsule().stroke(stroke, lineWidth: 1))
            .contentShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.78 : 1) : (role == .primary && !adaptive ? 1 : 0.4))
    }
}

extension View {
    func authButton(_ role: AuthButtonRole, adaptive: Bool = false) -> some View {
        buttonStyle(AuthPillButtonStyle(role: role, adaptive: adaptive))
    }

    /// Solid field surface; focus is a white outline, like kiosk selection.
    func authFieldChrome(isFocused: Bool) -> some View {
        background(
            RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                .fill(AuthPalette.field)
                .strokeBorder(
                    isFocused ? AuthPalette.selected : AuthPalette.strokeStandard,
                    lineWidth: isFocused ? 1.5 : 1
                )
                .animation(.easeOut(duration: 0.15), value: isFocused)
        )
    }
}

/// A labelled field on the auth surface. The caller supplies the control and
/// its focus state; the label, surface, and focus outline stay uniform.
struct AuthLabeledField<Control: View>: View {
    let title: String
    let isFocused: Bool
    @ViewBuilder var control: Control

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AuthPalette.textPrimary)
            control
                .foregroundStyle(AuthPalette.textPrimary)
                .padding(.horizontal, 14)
                .frame(minHeight: 52)
                .authFieldChrome(isFocused: isFocused)
        }
    }
}

/// Inline error or notice on the auth card.
struct AuthInlineMessage: View {
    let text: String
    let systemImage: String
    let tone: StatusTone

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.footnote.weight(.medium))
            .foregroundStyle(Color.statusText(tone))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(AuthPalette.field, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
                    .strokeBorder(Color.statusText(tone).opacity(0.35), lineWidth: 1)
            )
    }
}

/// The kiosk-dark page shared by Login and Set your password: flat #0B0B0D, a
/// left-aligned header (mark, title, one line), the form straight on the
/// surface, and a quiet footer pinned to the bottom. No card, scene, or glass.
struct AuthScreen<Content: View, Footer: View>: View {
    let title: String
    let subtitle: String
    /// Sheets opened from sign-in drop the mark; the page behind carries it.
    var showsMark = true
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    var body: some View {
        ZStack {
            AuthPalette.base.ignoresSafeArea()

            GeometryReader { geo in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if showsMark {
                            Image("Badgers")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 52, height: 52)
                                .accessibilityHidden(true)
                                .padding(.top, 28)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text(title)
                                .font(.system(size: 34, weight: .heavy))
                                .foregroundStyle(AuthPalette.textPrimary)
                                .accessibilityAddTraits(.isHeader)
                            Text(subtitle)
                                .font(.body)
                                .foregroundStyle(AuthPalette.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, showsMark ? 20 : 8)

                        content
                            .padding(.top, 32)

                        Spacer(minLength: 32)

                        footer
                            .font(.footnote)
                            .foregroundStyle(AuthPalette.textTertiary)
                            .padding(.bottom, 16)
                    }
                    .padding(.horizontal, 24)
                    .frame(maxWidth: 480, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geo.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .preferredColorScheme(.dark)
    }
}
