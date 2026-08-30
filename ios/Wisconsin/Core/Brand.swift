import SwiftUI
import UIKit

/// Brand color tokens. Use these instead of raw `Color(red:…)` literals so a
/// future tint change flows everywhere.
///
/// `brandPrimary` adapts to light/dark per Apple HIG contrast guidance:
/// - Light mode: `#A00000` — dark maroon, readable on white (≥ 4.5:1).
/// - Dark mode: `#FF3B30` — system-red luminance, meets 4.5:1 on dark bg.
extension Color {
    /// Wisconsin red — primary brand color (used for accents, the W mark, etc.).
    /// Dark-mode adaptive via `UIColor(dynamicProvider:)`.
    static let brandPrimary = Color(UIColor(dynamicProvider: { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 1.0, green: 0.231, blue: 0.188, alpha: 1)
            : UIColor(red: 0.627, green: 0, blue: 0, alpha: 1)
    }))

    /// Static launch base and top stop of the shared splash scene — `#140B10`.
    static let brandSplashTop = Color(red: 0.078, green: 0.043, blue: 0.063)

    /// Mid stop of the shared splash scene — `#22090D`.
    static let brandSplashMid = Color(red: 0.133, green: 0.035, blue: 0.051)

    /// Bottom stop of the shared splash scene — `#3A0509`.
    static let brandSplashBottom = Color(red: 0.227, green: 0.020, blue: 0.035)

    /// Near-black surface — login hero band, dark splash backgrounds.
    static let brandSurface = Color(red: 0.11, green: 0.11, blue: 0.11)

    /// Slightly lighter surface for disabled / secondary surfaces on the dark band.
    static let brandSurfaceDim = Color(red: 0.18, green: 0.18, blue: 0.18)
}

// MARK: - Brand typography (mirrors web Gotham usage in src/app/globals.css)

extension Font {
    /// Gotham Black — the web `PageHeader` title face. Use for headline
    /// moments (scan hero card titles). Falls back to the system heavy
    /// weight if the bundled font fails to register.
    static func gothamBlack(size: CGFloat, relativeTo textStyle: Font.TextStyle? = nil) -> Font {
        let style = textStyle ?? scalableTextStyle(for: size)
        if UIFont(name: "Gotham-Black", size: size) != nil {
            return Font.custom("Gotham-Black", size: size, relativeTo: style)
        }
        return Font.system(style).weight(.heavy)
    }

    /// Gotham Bold — secondary brand emphasis weight.
    static func gothamBold(size: CGFloat, relativeTo textStyle: Font.TextStyle? = nil) -> Font {
        let style = textStyle ?? scalableTextStyle(for: size)
        if UIFont(name: "Gotham-Bold", size: size) != nil {
            return Font.custom("Gotham-Bold", size: size, relativeTo: style)
        }
        return Font.system(style).weight(.bold)
    }

    private static func scalableTextStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case 30...: return .largeTitle
        case 24...: return .title2
        case 20...: return .title3
        case 17...: return .headline
        default: return .body
        }
    }
}

// MARK: - Semantic status palette (mirrors web tokens in src/app/globals.css)
//
// Web uses paired bg/text tokens for status badges:
//   --green / --green-bg / --green-text  (Available)
//   --blue  / --blue-bg  / --blue-text   (Checked out, STAFF)
//   --red   / --red-bg   / --red-text    (Overdue)
//   --purple/ --purple-bg/ --purple-text (Reserved, ADMIN)
//   --orange/ --orange-bg/ --orange-text (Maintenance)
//   --gray  → bg-muted / text-muted-foreground (Retired, Inactive, STUDENT)
//
// iOS picks dark-mode adaptive values per Apple HIG contrast guidance:
// the darker `text` tone is used for typography, the soft `bg` for fills.

/// Semantic status color identity — same vocabulary the web uses.
enum StatusTone: String, CaseIterable {
    case green, blue, red, purple, orange, gray

    /// Directory chips show Staff for Admins so operator rank is not advertised.
    static func publicDirectoryRole(_ role: String) -> String {
        role == "ADMIN" ? "STAFF" : role
    }

    /// Maps a role string to the same tone the web's `RoleBadge` uses.
    static func forRole(_ role: String) -> StatusTone {
        switch publicDirectoryRole(role) {
        case "STAFF": return .blue
        case "STUDENT": return .gray
        default: return .gray
        }
    }
}

/// The five semantic chart roles from docs/COLOR_SYSTEM.md, mirroring web's
/// `--chart-1` through `--chart-5`.
///
/// These exist because a chart fill is not text. `StatusTone`'s text colors
/// carry typography contrast, so filling a donut wedge or a bar with one reads
/// far heavier than the same status does on web — obvious in light mode. Use
/// `Color.chartFill(_:)` for anything the chart paints, and keep `statusText`
/// for the numbers beside it.
enum ChartRole {
    /// Checked out, active use, checkout trends.
    case active
    /// Available inventory, successful scans.
    case available
    /// Reserved or claimed inventory.
    case reserved
    /// Pending pickup and maintenance.
    case waiting
    /// Overdue and failed scans.
    case problem
    /// Retired or unknown states.
    case neutral
}

extension Color {
    /// Fill color for a chart role. Values are sRGB conversions of the web
    /// OKLCH tokens; the source oklch() sits beside each pair so the two stay
    /// auditable when the palette moves.
    static func chartFill(_ role: ChartRole) -> Color {
        func adaptive(
            light: (Double, Double, Double),
            dark: (Double, Double, Double)
        ) -> Color {
            Color(UIColor(dynamicProvider: { trait in
                let c = trait.userInterfaceStyle == .dark ? dark : light
                return UIColor(red: c.0, green: c.1, blue: c.2, alpha: 1)
            }))
        }

        switch role {
        case .active: // oklch(0.580 0.150 260) / oklch(0.720 0.095 260) — web --chart-1
            return adaptive(light: (0.258, 0.470, 0.822), dark: (0.508, 0.649, 0.880))
        case .available: // oklch(0.580 0.119 145) / oklch(0.720 0.147 145) — web --chart-2
            return adaptive(light: (0.282, 0.551, 0.297), dark: (0.388, 0.738, 0.408))
        case .reserved: // oklch(0.580 0.169 295) / oklch(0.720 0.106 295) — web --chart-3
            return adaptive(light: (0.516, 0.376, 0.823), dark: (0.664, 0.592, 0.879))
        case .waiting: // oklch(0.580 0.093 55) / oklch(0.720 0.116 55) — web --chart-4
            return adaptive(light: (0.646, 0.419, 0.258), dark: (0.864, 0.565, 0.354))
        case .problem: // oklch(0.580 0.153 25) / oklch(0.720 0.113 25) — web --chart-5
            return adaptive(light: (0.771, 0.306, 0.290), dark: (0.889, 0.532, 0.504))
        case .neutral: // mirrors web --text-muted
            return Color.secondary
        }
    }
}

extension Color {
    /// Foreground/text color for a status tone — matches web `--{tone}-text`.
    static func statusText(_ tone: StatusTone) -> Color {
        switch tone {
        case .green:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.32, green: 0.85, blue: 0.45, alpha: 1)
                : UIColor(red: 0.086, green: 0.639, blue: 0.290, alpha: 1) // #16a34a
            }))
        case .blue:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.65, blue: 1.0, alpha: 1)
                : UIColor(red: 0.149, green: 0.388, blue: 0.922, alpha: 1) // #2563eb
            }))
        case .red:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.40, blue: 0.40, alpha: 1)
                : UIColor(red: 0.863, green: 0.149, blue: 0.149, alpha: 1) // #dc2626
            }))
        case .purple:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.70, green: 0.55, blue: 1.0, alpha: 1)
                : UIColor(red: 0.486, green: 0.227, blue: 0.929, alpha: 1) // #7c3aed
            }))
        case .orange:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.70, blue: 0.30, alpha: 1)
                : UIColor(red: 0.851, green: 0.467, blue: 0.024, alpha: 1) // #d97706
            }))
        case .gray:
            return Color.secondary
        }
    }

    /// Foreground for compact controls whose fill is a status-text color. In
    /// dark mode the status palette intentionally becomes bright so it can
    /// read on a dark surface; white labels on that same bright fill would
    /// then fail contrast. The high-contrast branch keeps the relationship
    /// explicit for Increase Contrast instead of inheriting a platform guess.
    static func statusControlForeground(_ tone: StatusTone, contrast: ColorSchemeContrast = .standard) -> Color {
        Color(UIColor(dynamicProvider: { traits in
            if traits.userInterfaceStyle == .dark {
                return contrast == .increased
                    ? UIColor.black
                    : UIColor(white: 0.04, alpha: 1)
            }
            return UIColor.white
        }))
    }

    /// The personal-marker accent: favourite stars, default-traveller stars.
    /// Deliberately outside `StatusTone` — a marker says "you flagged this",
    /// not "this is in state X", so it must never be mistaken for a status.
    /// Matches web's `--yellow-text` in both themes.
    static let marker = Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.980, green: 0.800, blue: 0.082, alpha: 1) // #facc15
        : UIColor(red: 0.792, green: 0.541, blue: 0.016, alpha: 1) // #ca8a04
    }))

    /// Background fill for a status tone — matches web `--{tone}-bg`.
    /// Dark-mode mixes the text color at low alpha so contrast holds.
    static func statusBackground(_ tone: StatusTone) -> Color {
        switch tone {
        case .green:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.32, green: 0.85, blue: 0.45, alpha: 0.18)
                : UIColor(red: 0.941, green: 0.992, blue: 0.957, alpha: 1) // #f0fdf4
            }))
        case .blue:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.65, blue: 1.0, alpha: 0.18)
                : UIColor(red: 0.937, green: 0.965, blue: 1.0, alpha: 1) // #eff6ff
            }))
        case .red:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.40, blue: 0.40, alpha: 0.18)
                : UIColor(red: 0.996, green: 0.949, blue: 0.949, alpha: 1) // #fef2f2
            }))
        case .purple:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.70, green: 0.55, blue: 1.0, alpha: 0.18)
                : UIColor(red: 0.961, green: 0.953, blue: 1.0, alpha: 1) // #f5f3ff
            }))
        case .orange:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.70, blue: 0.30, alpha: 0.18)
                : UIColor(red: 1.0, green: 0.969, blue: 0.929, alpha: 1) // #fff7ed
            }))
        case .gray:
            return Color.secondary.opacity(0.12)
        }
    }

    /// Compact icon tile fill for status summaries. Stronger than
    /// `statusBackground` because the tile is small and otherwise washes out.
    static func statusIconBackground(_ tone: StatusTone) -> Color {
        switch tone {
        case .orange:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.70, blue: 0.30, alpha: 0.28)
                : UIColor(red: 1.0, green: 0.929, blue: 0.835, alpha: 1) // #ffedd5
            }))
        default:
            return statusBackground(tone)
        }
    }
}

// MARK: - Design system foundation
//
// A small, consistent layout vocabulary so screens share the same rhythm and
// card treatment instead of re-deriving padding/radius per view. Pairs with the
// native iOS 26 Liquid Glass controls (`.buttonStyle(.glass/.glassProminent)`,
// material-backed floating controls) the app already uses.

/// Layout tokens — use instead of raw point literals so spacing stays in step.
enum Brand {
    /// Spacing scale (points). `md` is the default gutter.
    enum Space {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let xl: CGFloat = 28
        static let xxl: CGFloat = 40
    }

    /// Corner-radius scale. `card` is the default container radius.
    enum Radius {
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let card: CGFloat = 20
        static let lg: CGFloat = 26
    }
}

extension Color {
    /// Standard elevated card surface — adapts to light/dark and reads correctly
    /// on a grouped background.
    static let cardSurface = Color(.secondarySystemGroupedBackground)

    /// A slightly raised surface for nested tiles inside a card.
    static let cardSurfaceRaised = Color(.tertiarySystemGroupedBackground)

    /// Hairline stroke tuned for card and divider edges.
    static let hairline = Color(.separator).opacity(0.5)
}

// MARK: - Card surface

private struct BrandCardModifier: ViewModifier {
    var padding: CGFloat
    var radius: CGFloat
    var fill: Color
    var stroke: Bool
    var alignment: Alignment

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: alignment)
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                if stroke {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(Color.hairline, lineWidth: 0.5)
                }
            }
    }
}

extension View {
    /// Wraps content in the app's standard card: continuous radius, hairline
    /// edge, and a soft shadow. One source of truth for every card surface.
    func brandCard(
        padding: CGFloat = Brand.Space.md,
        radius: CGFloat = Brand.Radius.card,
        fill: Color = .cardSurface,
        stroke: Bool = true,
        alignment: Alignment = .leading
    ) -> some View {
        modifier(BrandCardModifier(padding: padding, radius: radius, fill: fill, stroke: stroke, alignment: alignment))
    }

    /// Tint for a list-screen toolbar control (favorites, status filter, sort).
    ///
    /// These controls sit directly above rows where green, orange, blue, and red
    /// mean something exact about custody, so a control painted from the status
    /// palette claims a meaning it does not have -- an orange star is not
    /// awaiting pickup. Colour here answers one question only: is this control
    /// doing something right now? Off is `.secondary`, on is `.primary`, the
    /// same neutral control accent `docs/COLOR_SYSTEM.md` gives the
    /// Profile/Settings stack and the web's `--accent`.
    func listControlTint(isActive: Bool) -> some View {
        tint(isActive ? Color.primary : Color.secondary)
    }
}

// MARK: - Active control bar

/// Names what a list's toolbar controls have actually done to the list, with a
/// single Clear action. Lives in list content rather than a safe-area inset: a
/// conditional inset makes the navigation bar drop its large title.
///
/// Shared by every list that puts its controls in the toolbar, so "what is this
/// list showing right now" is answered the same way on each of them.
struct ActiveControlBar: View {
    let summary: String
    let clear: () -> Void

    var body: some View {
        HStack(spacing: Brand.Space.sm) {
            Text(summary)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button("Clear") {
                clear()
            }
            .font(.footnote.weight(.semibold))
            .tint(Color.primary)
        }
        .frame(minHeight: 36)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Showing \(summary)")
    }
}

// MARK: - Section header

/// Consistent section header used above grouped card stacks. Optional subtitle,
/// leading SF Symbol, and a trailing accessory (e.g. a "See all" button).
struct BrandSectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    var systemImage: String? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Brand.Space.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.brandPrimary)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: Brand.Space.sm)
            trailing()
        }
        .accessibilityElement(children: .combine)
        // Lets VoiceOver's rotor jump between sections. Event detail's private
        // clone of this header carried the trait and the shared one didn't, so
        // adopting the shared component would otherwise have been a quiet
        // accessibility regression on that screen.
        .accessibilityAddTraits(.isHeader)
    }
}

extension BrandSectionHeader where Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil, systemImage: String? = nil) {
        self.init(title: title, subtitle: subtitle, systemImage: systemImage, trailing: { EmptyView() })
    }
}

// MARK: - Zoomable image viewer

/// Full-screen pinch/double-tap photo viewer shared by every hero image
/// (scan result sheet, item detail). Lets staff check cosmetic condition
/// without squinting at a small tile. Tap the backdrop or the close button
/// to dismiss.
struct ZoomableImageViewer: View {
    let url: URL
    let photoLabel: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1
    @State private var retryID = UUID()

    init(url: URL, photoLabel: String = "Item photo") {
        self.url = url
        self.photoLabel = photoLabel
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black
                .ignoresSafeArea()
                .onTapGesture { dismiss() }

            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(min(max(scale * pinch, 1), 5))
                        .accessibilityLabel(photoLabel)
                        .accessibilityValue(scaleDescription)
                        .accessibilityAdjustableAction { direction in
                            switch direction {
                            case .increment: setScale(scale + 0.5)
                            case .decrement: setScale(scale - 0.5)
                            @unknown default: break
                            }
                        }
                        .gesture(
                            MagnificationGesture()
                                .updating($pinch) { value, state, _ in state = value }
                                .onEnded { value in
                                    setScale(scale * value)
                                }
                        )
                        .onTapGesture(count: 2) {
                            setScale(scale > 1 ? 1 : 2.5)
                        }
                case .failure:
                    VStack(spacing: 12) {
                        Image(systemName: "photo.badge.exclamationmark")
                            .font(.system(size: 44))
                            .foregroundStyle(.secondary)
                        Text("Photo unavailable")
                            .font(.headline)
                            .foregroundStyle(.white)
                        Button("Retry") { retryID = UUID() }
                            .buttonStyle(.borderedProminent)
                            .tint(.white)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(photoLabel) unavailable")
                default:
                    ProgressView("Loading photo")
                        .tint(.white)
                        .foregroundStyle(.white)
                }
            }
            .id(retryID)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Close photo")
            .padding(.trailing, 20)
            .padding(.top, 8)

            VStack {
                Spacer()
                HStack(spacing: 8) {
                    Button { setScale(scale - 0.5) } label: {
                        Label("Zoom out", systemImage: "minus")
                    }
                    Button { setScale(1) } label: {
                        Label("Reset zoom", systemImage: "arrow.counterclockwise")
                    }
                    Button { setScale(scale + 0.5) } label: {
                        Label("Zoom in", systemImage: "plus")
                    }
                }
                .buttonStyle(.bordered)
                .tint(.white)
                .controlSize(.large)
                .padding(.bottom, 24)
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
    }

    private var scaleDescription: String {
        "\(Int(scale * 100)) percent zoom"
    }

    private func setScale(_ next: CGFloat) {
        let bounded = min(max(next, 1), 5)
        if reduceMotion {
            scale = bounded
        } else {
            withAnimation(.easeOut(duration: 0.2)) { scale = bounded }
        }
    }
}

// MARK: - Status rail

/// The leading accent rail shared by list/queue rows (Bookings cards, dashboard
/// "Next Up" rows). A rounded 4pt bar tinted by status tone; stretches to the
/// row's height so it sits inset from rounded card corners. One source of truth
/// for rail width/radius/color across screens.
struct StatusRail: View {
    let color: Color

    /// Tinted by a semantic status tone (the common case).
    init(tone: StatusTone) { self.color = Color.statusText(tone) }

    /// Tinted by an explicit color, for rails that aren't status-driven
    /// (e.g. the schedule's home/away/my-shift accent).
    init(color: Color) { self.color = color }

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(color)
            .frame(width: 4)
            .accessibilityHidden(true)
    }
}

// MARK: - Filter chip

/// A selectable pill used for filter/scope strips. Replaces the ad-hoc
/// `.background(.regularMaterial, in: Capsule())` chips scattered across views.
struct FilterChip: View {
    let label: String
    var systemImage: String? = nil
    var isOn: Bool
    var tone: StatusTone = .blue
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.caption.weight(.semibold))
                }
                Text(label)
                    .font(.subheadline.weight(.medium))
            }
            .foregroundStyle(isOn ? Color.statusText(tone) : Color.primary)
            .padding(.horizontal, Brand.Space.md)
            .frame(minHeight: 44)
            .background {
                if isOn {
                    Capsule().fill(Color.statusBackground(tone))
                    Capsule().strokeBorder(Color.statusText(tone).opacity(0.35), lineWidth: 1)
                } else {
                    // A defined surface + hairline so an unselected chip still
                    // reads as a tappable pill on the grouped background, instead
                    // of dissolving into faint floating text.
                    Capsule().fill(Color(.secondarySystemBackground))
                    Capsule().strokeBorder(Color.primary.opacity(0.12), lineWidth: 1)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}
