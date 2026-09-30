import SwiftUI

// MARK: - Kiosk screen chrome
//
// Screen-level scaffolding shared by every kiosk screen: the ambient backdrop
// behind the shell's screen switch and the standard screen padding. Leaf
// components live in KioskComponents.swift; tokens live in KioskDesign.swift.

/// Ambient full-screen backdrop mounted once in `KioskShellView` behind every
/// screen. Two static gradients over the base color — a faint brand-red wash
/// from the top-leading corner and a bottom vignette — give the whole kiosk
/// depth without blurs, materials, or animation (safe for an always-on display;
/// the red stays ≤ 5% opacity with no hard edges, so there is
/// nothing crisp to burn in).
struct KioskBackdrop: View {
    var body: some View {
        ZStack {
            KioskSurface.base
            RadialGradient(
                colors: [.clear, .clear],
                center: .topLeading,
                startRadius: 0,
                endRadius: 1100
            )
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.25)],
                startPoint: .center,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

// MARK: - Scan screen scaffolding

/// Left column of a scan screen (checkout scan / pickup / return): one
/// section rhythm and screen padding for the header, context, centered scan
/// content, and bottom CTA, replacing per-flow padding drift.
struct KioskScanZoneColumn<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: KioskSpacing.lg) { content() }
            .kioskScreenPadding()
            .frame(maxWidth: .infinity)
    }
}

/// Right-hand rail beside a scan zone — the checkout items list and the
/// pickup/return checklist share one width (`KioskLayout.sideRail`) in wide
/// scenes, then take the full lower pane when the kiosk stacks its layout.
struct KioskSideRail<Content: View>: View {
    var isCompact: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: isCompact ? .infinity : nil)
            .frame(width: isCompact ? nil : KioskLayout.sideRail)
            .background(
                LinearGradient(
                    colors: [Color.white.opacity(0.035), Color.white.opacity(0.015)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
    }
}

/// Keeps operational split screens usable when an iPad scene narrows or
/// rotates. Wide scenes retain the familiar scan/content rail. Compact scenes
/// reserve a lower pane for the rail so the scan controls stay visible above.
struct KioskAdaptiveSplit<Primary: View, Secondary: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var compactSecondaryFraction: CGFloat = 0.36
    @ViewBuilder var primary: (_ isCompact: Bool) -> Primary
    @ViewBuilder var secondary: (_ isCompact: Bool) -> Secondary

    var body: some View {
        GeometryReader { proxy in
            let isCompact = proxy.size.width < KioskLayout.compactBreakpoint || dynamicTypeSize.isAccessibilitySize
            if isCompact {
                VStack(spacing: 0) {
                    primary(true)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Divider().background(KioskStroke.divider)
                    secondary(true)
                        .frame(maxWidth: .infinity)
                        .frame(height: compactSecondaryHeight(for: proxy.size.height))
                }
            } else {
                HStack(spacing: 0) {
                    primary(false)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Divider().background(KioskStroke.divider)
                    secondary(false)
                }
            }
        }
    }

    private func compactSecondaryHeight(for totalHeight: CGFloat) -> CGFloat {
        min(max(totalHeight * compactSecondaryFraction, 200), 340)
    }
}

// MARK: - Screen padding

extension View {
    /// Standard edge padding for a kiosk screen's root content: `xl`
    /// horizontal margins, `screenTop` below the hidden status bar, and
    /// `screenBottom` above the home indicator. Replaces the per-screen
    /// 44/36 / 32 / 24/16 / 32/20/32 padding drift.
    func kioskScreenPadding() -> some View {
        self
            .padding(.horizontal, KioskSpacing.xl)
            .padding(.top, KioskSpacing.screenTop)
            .padding(.bottom, KioskSpacing.screenBottom)
    }
}
