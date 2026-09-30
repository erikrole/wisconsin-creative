import SwiftUI

// MARK: - Kiosk design tokens
//
// Single source of truth for the kiosk's dark surface scale, hairlines, corner
// radii, text tones, and brand type. Before this file each of the nine kiosk
// screens hand-picked its own near-black background and white-opacity fills
// (12+ ad-hoc values, radii from 9 to 24), which is exactly the route-level
// drift `docs/DESIGN_LANGUAGE.md` warns about. Mirrors how `Core/Brand.swift`
// centralizes the web-facing tokens.
//
// The kiosk is always dark (`KioskShellView` forces `.dark`), so these are
// fixed dark values rather than dynamic light/dark providers. Status and
// section color come from `KioskSection` / `KioskStatus` below; the kiosk no
// longer spends brand red on anything (2026-09-25 redesign).

/// Builds a color from a `#RRGGBB` literal so the tokens below read exactly
/// like the design canvas they were measured from.
private func kioskHex(_ hex: UInt32, opacity: Double = 1) -> Color {
    Color(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        opacity: opacity
    )
}

/// Background and fill elevation scale, from the 2026-09-25 redesign canvas.
/// Solid, flat values: the canvas has no glaze, blur, or translucent white
/// layering, and solid hex keeps two sibling cards from drifting apart when
/// one sits over a different background.
enum KioskSurface {
    /// Full-screen kiosk backdrop. One value for every screen (shell,
    /// activation, sheets) so screens never drift to slightly different blacks.
    static let base = kioskHex(0x0B0B0D)

    /// Large sunken areas -- the panels beside a scan zone. The canvas leaves
    /// them on the base and separates them with a divider.
    static let sunken = kioskHex(0x0B0B0D)

    /// Quiet grouped container (sectioned home lists, empty states).
    static let low = kioskHex(0x131316)

    /// Standard card / row fill.
    static let card = kioskHex(0x131316)

    /// Interactive tile fill (Today tiles, identity cards, numpad keys).
    static let cardRaised = kioskHex(0x18181D)

    /// Secondary button and chip fill.
    static let control = kioskHex(0x1E1E23)

    /// Selected interactive tile. Selection is always a white outline
    /// (`KioskStroke.selected`); the fill only lifts slightly under it.
    static let cardSelected = kioskHex(0x1E1E23)

    /// Avatar / placeholder fill.
    static let placeholder = kioskHex(0x3A3A44)

    /// Raised modal surface -- confirmation cards and sheets.
    static let modal = kioskHex(0x17171B)

    /// A sheet's backdrop panel (B1, A6, H1): one step above the dimmed base.
    static let sheet = kioskHex(0x121215)
}

/// Hairline stroke scale for card/tile separation on the dark base.
enum KioskStroke {
    static let hairline = kioskHex(0x1E1E23)
    static let standard = kioskHex(0x2A2A31)
    static let strong = kioskHex(0x2E2E36)
    /// Selected choices are always a white outline; green never means
    /// "selected".
    static let selected = kioskHex(0xF2F2F4)
    /// Divider lines between rows / panels.
    static let divider = kioskHex(0x1E1E23)
    /// The outline of a still-to-scan checklist circle or battery unit.
    static let pending = kioskHex(0x3A3A42)
}

/// Dimming scrims layered *over* content (full-screen modal backdrops, floating
/// controls on top of the live camera).
enum KioskScrim {
    /// Full-screen backdrop behind a modal/confirmation card.
    static let modal = kioskHex(0x060607, opacity: 0.72)
    /// Floating control pill resting on top of the live camera feed.
    static let control = Color.black.opacity(0.5)
    /// Manual-entry field panel over the camera feed.
    static let field = Color.black.opacity(0.58)
}

/// Corner-radius scale. Buttons are full capsules; these are for surfaces.
enum KioskRadius {
    static let sm: CGFloat = 10   // small rows, asset thumbnails, chips
    static let md: CGFloat = 12   // standard rows, roster tiles
    static let lg: CGFloat = 14   // Today tiles, chips, inputs
    static let xl: CGFloat = 16   // cards and sectioned lists
    static let modal: CGFloat = 28 // confirmation cards and sheets
    static let hero: CGFloat = 22 // the scan stage and hub hero
}

/// Spacing scale. Named rungs replace the drifting per-screen padding combos.
enum KioskSpacing {
    static let xs: CGFloat = 8    // chip gaps, row internals
    static let sm: CGFloat = 12   // intra-card stacks
    static let md: CGFloat = 16   // card padding, grid gutters
    static let lg: CGFloat = 24   // section gaps, panel padding (compact)
    static let xl: CGFloat = 28   // screen margins (the canvas uses 28pt sides)
    /// Below the hidden status bar at the top of every screen.
    static let screenTop: CGFloat = 24
    static let screenBottom: CGFloat = 24
}

/// Shared layout dimensions that were previously inline magic numbers
/// recomputed per screen.
enum KioskLayout {
    /// Right-hand rail beside a scan zone (checkout items list and the
    /// pickup/return checklist share one width).
    static let sideRail: CGFloat = 430
    /// Checkout-setup form cards.
    static let formMaxWidth: CGFloat = 760
    /// Activation card in the wide layout.
    static let activationCardWidth: CGFloat = 450
    /// Below this width (or at accessibility sizes) two-panel screens stack.
    static let compactBreakpoint: CGFloat = 880
    /// Idle roster panel width: 46% of the screen, clamped so tiles stay
    /// tappable on 11" and the grid doesn't sprawl on 13".
    ///
    /// Widened from 42% when the roster became fit-to-screen. Every extra point
    /// here buys tile width, and tile width is what decides how many columns
    /// the grid can use before names truncate — which is what decides whether
    /// the whole roster fits without scrolling.
    static func rosterWidth(for totalWidth: CGFloat) -> CGFloat {
        min(max(totalWidth * 0.46, 460), 620)
    }

    /// Operator-hub shifts rail. Narrower than the roster: a shift card is one
    /// event title, a time and a button, where a roster tile has to stay a
    /// tappable target for a named person. Bookings keep the majority of the
    /// canvas because they are what most people open the hub for.
    static func shiftsRailWidth(for totalWidth: CGFloat) -> CGFloat {
        min(max(totalWidth * 0.36, 340), 480)
    }
}

/// Foreground text tones on the dark base. Named rungs replace the long tail
/// of `Color.white.opacity(...)` literals for the common cases.
enum KioskText {
    static let primary = kioskHex(0xF2F2F4)
    static let secondary = kioskHex(0xA6A6AE)
    static let tertiary = kioskHex(0x8A8A93)
    static let muted = kioskHex(0x6F6F78)
    /// Text on a white primary pill.
    static let onPrimary = kioskHex(0x0B0B0D)
    /// The count or detail beside a primary pill's label ("3 items").
    static let onPrimaryDetail = kioskHex(0x4A4A55)
}

// MARK: - Card modifier

extension View {
    /// Standard kiosk card treatment: a flat fill and a 1pt stroke of the same
    /// shape. The canvas is flat -- no glaze or gradient stroke -- so depth
    /// comes only from the surface and stroke scales.
    func kioskCard(
        _ fill: Color = KioskSurface.card,
        radius: CGFloat = KioskRadius.xl,
        stroke: Color = KioskStroke.hairline,
        lineWidth: CGFloat = 1
    ) -> some View {
        self
            .background(fill, in: RoundedRectangle(cornerRadius: radius))
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .stroke(stroke, lineWidth: lineWidth)
            )
    }

}

// MARK: - Feedback tone

/// Shared scan/feedback tone used by the in-flow feedback banner and the
/// camera overlay. Each kiosk flow keeps its own domain `ScanFeedback` enum
/// (flow-specific copy) but maps to this for rendering, so the banner looks
/// identical everywhere.
enum KioskBannerTone {
    case success, error, warning

    var color: Color {
        switch self {
        case .success: KioskStatus.ok
        case .error:   KioskStatus.problem
        case .warning: KioskStatus.attention
        }
    }

    var icon: String {
        switch self {
        case .success: "checkmark.circle.fill"
        case .error:   "xmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        }
    }
}

// MARK: - Type

extension Font {
    /// Activation hero title -- the biggest brand moment on the kiosk.
    static func kioskHeroTitle(size: CGFloat = 48) -> Font { .system(size: size, weight: .heavy) }

    /// Flow screen titles (Checkout / Pickup / Return).
    static func kioskScreenTitle(size: CGFloat = 26) -> Font { .system(size: size, weight: .bold) }

    /// Terminal success message.
    static func kioskSuccessTitle(size: CGFloat = 30) -> Font { .system(size: size, weight: .heavy) }
}

/// The kiosk reading order, in one place.
///
/// SF Pro only (2026-09-25 redesign). Nothing on the kiosk renders below
/// 14 pt: students read it from arm's length at a mounted iPad, so the floor
/// is `meta` / `chip` / `overline`, all 14 pt. Sizes are fixed rather than
/// Dynamic Type relative -- the fleet is two managed iPads on one 1180×820pt
/// landscape canvas, and every rung below was measured from that canvas.
enum KioskType {
    // Display rungs -- one per screen at most.

    /// The home clock: 72 pt bold with tabular digits. Seconds use
    /// `displayClockSeconds`; the colon stays white.
    static let displayClock = Font.system(size: 72, weight: .bold).monospacedDigit()
    static let displayClockSeconds = Font.system(size: 72, weight: .regular).monospacedDigit()
    static let displayClockMeridiem = Font.system(size: 32, weight: .semibold)
    /// Overnight standby clock.
    static let standbyClock = Font.system(size: 132, weight: .heavy).monospacedDigit()
    static let standbyMeridiem = Font.system(size: 46, weight: .bold)

    /// A task or hub header's title ("New checkout", "Harper L.").
    static let taskTitle = Font.system(size: 56, weight: .bold)
    /// The scan stage's confirmation headline ("AUD-031 added").
    static let stageTitle = Font.system(size: 34, weight: .heavy)
    /// A sheet or confirmation card title.
    static let sheetTitle = Font.system(size: 28, weight: .heavy)

    /// Screen-owning title on screens that have not moved to the task header.
    static let screenTitle = Font.system(size: 26, weight: .bold)

    /// The identity moment: a person's name on the hub or a sheet.
    static let identity = Font.system(size: 34, weight: .bold)

    /// A number that is the point of its tile.
    static let metric = Font.system(size: 40, weight: .heavy).monospacedDigit()

    /// The hub's "Check out gear" hero label.
    static let heroAction = Font.system(size: 26, weight: .heavy)

    /// A white primary pill's label ("Check out").
    static let primaryLabel = Font.system(size: 22, weight: .heavy)

    /// Header clock beside Back.
    static let headerClock = Font.system(size: 22, weight: .semibold).monospacedDigit()

    // Content rungs.

    /// Section owner inside a panel.
    static let sectionTitle = Font.system(size: 17, weight: .bold)

    /// A card's title (a booking on the hub, the context card).
    static let cardTitle = Font.system(size: 17, weight: .bold)

    /// Header subtitle ("Harper L. · step 2 of 2").
    static let headerDetail = Font.system(size: 17, weight: .semibold)

    /// Primary line of a row -- an item tag, a booking on home.
    static let rowTitle = Font.system(size: 16, weight: .bold)

    /// Hero action label, larger than a normal row because it is the one thing
    /// the screen wants tapped.
    static let actionTitle = Font.system(size: 20, weight: .bold)

    /// Button label on secondary pills.
    static let buttonLabel = Font.system(size: 16, weight: .semibold)

    /// Supporting line under a title.
    static let rowDetail = Font.system(size: 15)

    /// Body prose in empty states and explanations.
    static let body = Font.system(size: 16)

    /// Meta line: names, counts, due times under a row. The floor.
    static let meta = Font.system(size: 14)

    /// All-caps overline above a group ("OVERDUE", "TAKING OUT").
    /// Pair with `.tracking(KioskType.overlineTracking)`.
    static let overline = Font.system(size: 14, weight: .bold)
    /// 0.12 em at 14 pt.
    static let overlineTracking: CGFloat = 1.7

    /// Chip, badge, and timestamp text.
    static let chip = Font.system(size: 14, weight: .semibold)

    /// Emphasized chip text (a due time, a count that matters).
    static let chipStrong = Font.system(size: 14, weight: .bold)

    /// Tag and code values.
    static let code = Font.system(size: 14, weight: .semibold, design: .monospaced)

    /// Kept for existing call sites; now the same 14 pt floor as `chip`.
    static let micro = Font.system(size: 14, weight: .semibold)
}

// MARK: - Section color

/// What a surface is *doing*, which decides its color everywhere.
///
/// green = taking out, amber = coming back, blue = picking up,
/// violet = shared custody, red = real problems only (blocked, overdue,
/// missing). Selection is never colored; it is a white outline.
enum KioskSection {
    case takingOut, comingBack, pickingUp, shared, problem

    /// Solid accent: check circles, filled battery units, dots.
    var accent: Color {
        switch self {
        case .takingOut: kioskHex(0x3FBF74)
        case .comingBack: kioskHex(0xF0A43A)
        case .pickingUp: kioskHex(0x5B8CFF)
        case .shared: kioskHex(0x8F7CF0)
        case .problem: kioskHex(0xE5484D)
        }
    }

    /// Accent readable as text on the dark base.
    var text: Color {
        switch self {
        case .takingOut: kioskHex(0x7FD6A1)
        case .comingBack: kioskHex(0xF5C27A)
        case .pickingUp: kioskHex(0x9DB8FF)
        case .shared: kioskHex(0xC9B8FF)
        case .problem: kioskHex(0xFF8A8E)
        }
    }

    /// The scan stage and tinted card background.
    var stageFill: Color {
        switch self {
        case .takingOut: kioskHex(0x121A15)
        case .comingBack: kioskHex(0x1A1710)
        case .pickingUp: kioskHex(0x10141F)
        case .shared: kioskHex(0x14121A)
        case .problem: kioskHex(0x1A1314)
        }
    }

    var stageStroke: Color {
        switch self {
        case .takingOut: kioskHex(0x1F3B2A)
        case .comingBack: kioskHex(0x4A3D22)
        case .pickingUp: kioskHex(0x233257)
        case .shared: kioskHex(0x2B2640)
        case .problem: kioskHex(0x4A2226)
        }
    }

    /// Quiet text on a tinted stage (the Undo label).
    var stageSecondary: Color {
        switch self {
        case .takingOut: kioskHex(0xB9E8C9)
        case .comingBack: kioskHex(0xF5D9A8)
        case .pickingUp: kioskHex(0xC9D6FF)
        case .shared: kioskHex(0xD9D0FF)
        case .problem: kioskHex(0xFF8A8E)
        }
    }
}

// MARK: - Status language

/// One meaning per color, kiosk-wide. Values come from `KioskSection` so a
/// status and the flow it belongs to can never disagree.
enum KioskStatus {
    /// Available / accepted. Also: scanner armed.
    static let ok = KioskSection.takingOut.text

    /// An `OPEN` checkout that is simply out. Neutral: being out is normal,
    /// not a state that needs a color.
    static let active = KioskText.secondary

    /// Reserved / ready to pick up.
    static let scheduled = KioskSection.pickingUp.text

    /// Shared custody (travel cases).
    static let shared = KioskSection.shared.text

    /// Coming back: due today, waiting, needs attention.
    static let attention = KioskSection.comingBack.text

    /// Real problems only: overdue, blocked, missing, errors.
    static let problem = KioskSection.problem.text

    /// The dot beside a checkout that is out and due later.
    static let neutralDot = kioskHex(0x4A4A55)

    /// Custody urgency for an `OPEN` checkout: neutral while it is simply out,
    /// amber on the day it is due, red once it is past due.
    static func custody(isOverdue: Bool, dueAt: Date) -> Color {
        if isOverdue { return problem }
        return Calendar.current.isDateInToday(dueAt) ? attention : active
    }
}

/// Affiliation marking — who a person is, not what a piece of gear is doing.
/// A ring on the portrait, and nothing else; still spoken via `UserRow`'s
/// accessibility label.
enum KioskAffiliation {
    static let ring = KioskText.tertiary
}

// MARK: - Button hierarchy

/// What a button is *for*, so call sites stop choosing a style and a tint.
///
/// The one action a screen exists for is a solid white pill. Everything else
/// is a quiet dark pill. Red is for confirming something destructive, inside
/// a confirmation, never beside a primary action.
enum KioskButtonRole {
    /// The one action the screen is for. Solid white pill, dark label.
    case primary
    /// A supporting action -- Edit, Camera, Back. Dark pill with a stroke.
    case secondary
    /// Lowest emphasis: Remove on a row, Paste code. Outline only.
    case quiet
    /// Confirms a destructive choice inside a confirmation (Discard).
    case destructive
}

/// The kiosk's single pill button style.
struct KioskPillButtonStyle: ButtonStyle {
    let role: KioskButtonRole
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(KioskType.buttonLabel)
            .foregroundStyle(foreground)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .background(fill, in: Capsule())
            .overlay(Capsule().stroke(stroke, lineWidth: 1))
            .contentShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.78 : 1) : 0.4)
    }

    private var fill: Color {
        switch role {
        case .primary: KioskText.primary
        case .secondary: KioskSurface.control
        case .quiet: .clear
        case .destructive: KioskSection.problem.accent
        }
    }

    private var stroke: Color {
        switch role {
        case .primary: KioskText.primary
        case .secondary, .quiet: KioskStroke.strong
        case .destructive: KioskSection.problem.accent
        }
    }

    private var foreground: Color {
        switch role {
        case .primary, .destructive: KioskText.onPrimary
        case .secondary: KioskText.primary
        case .quiet: KioskText.secondary
        }
    }
}

extension View {
    /// Applies the kiosk button hierarchy.
    func kioskButtonRole(_ role: KioskButtonRole) -> some View {
        buttonStyle(KioskPillButtonStyle(role: role))
    }
}
