import SwiftUI
import UIKit

// MARK: - Flat surfaces
//
// The adaptive form of the kiosk surface language, for screens that follow the
// system appearance (Home today; the other tabs next). Dark mode uses the
// kiosk's own hex values; light mode uses the system grouped surfaces, so a
// flat card still sits correctly on `systemGroupedBackground`.
//
// Cards are a solid fill and a 1pt hairline. No shadow, blur, tint wash, or
// gradient. `AuthPalette` is the fixed-dark sibling for the sign-in pages;
// `tests/ios-flat-surface.test.ts` keeps both tied to `KioskDesign.swift`.

private func flatHex(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
    UIColor(
        red: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: alpha
    )
}

extension Color {
    /// Standard card fill: kiosk `card` in dark, the grouped surface in light.
    static let flatCard = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? flatHex(0x131316) : .secondarySystemGroupedBackground
    })

    /// A control or nested surface one step above `flatCard`.
    static let flatRaised = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? flatHex(0x18181D) : .tertiarySystemGroupedBackground
    })

    /// Card outline: kiosk `standard` stroke in dark.
    static let flatStroke = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? flatHex(0x2A2A31) : UIColor.black.withAlphaComponent(0.07)
    })

    /// Row divider inside a card: kiosk `divider` in dark.
    static let flatDivider = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? flatHex(0x1E1E23) : UIColor.black.withAlphaComponent(0.08)
    })
}

private struct FlatCardModifier: ViewModifier {
    let padding: CGFloat
    let radius: CGFloat
    let alignment: Alignment

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: alignment)
            .background(Color.flatCard, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Color.flatStroke, lineWidth: 1)
            )
    }
}

extension View {
    /// A flat card: solid fill, 1pt hairline, nothing else.
    func flatCard(
        padding: CGFloat = Brand.Space.md,
        radius: CGFloat = Brand.Radius.md,
        alignment: Alignment = .leading
    ) -> some View {
        modifier(FlatCardModifier(padding: padding, radius: radius, alignment: alignment))
    }
}

/// Heavy section title shared by flat screens.
struct FlatSectionTitle: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 20, weight: .heavy))
            .foregroundStyle(.primary)
            .accessibilityAddTraits(.isHeader)
    }
}
