import SwiftUI
import UIKit
import WidgetKit

// MARK: - wc-fresh tokens

// The widget extension compiles only its own sources plus the two shared
// contract files, so `Brand.swift` and `Color.statusText` are out of reach.
// These mirror the web `.wc-fresh` theme (`src/app/globals.css`): a calm blue
// accent, cool surfaces, and red / orange reserved for gear that is late or
// due. In accented and vibrant modes the system owns the palette, so the
// views fall back to a high-contrast primary foreground.
private extension Color {
    /// One token, two appearances. The widget process follows the system trait
    /// collection, so a dynamic `UIColor` is all light and dark mode needs.
    static func fresh(_ light: UInt32, dark: UInt32, darkAlpha: CGFloat = 1) -> Color {
        Color(UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let value = isDark ? dark : light
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: isDark ? darkAlpha : 1
            )
        })
    }

    static let freshAccent = fresh(0x3E63DD, dark: 0x8DA4EF)
    static let freshAccentSoft = fresh(0xEEF2FF, dark: 0x8DA4EF, darkAlpha: 0.14)
    static let freshSurface = fresh(0xFBFBFC, dark: 0x111214)
    static let freshRaised = fresh(0xF4F5F7, dark: 0x1A1B1E)
    static let freshText = fresh(0x1C2024, dark: 0xECECEF)
    static let freshSecondary = fresh(0x60646C, dark: 0xA8AAB2)
    static let widgetRed = fresh(0xC71C2E, dark: 0xFF7A85)
    static let widgetOrange = fresh(0xB8610A, dark: 0xF5A94A)
}

/// Gotham, as the app uses it. `Font.custom` falls back to the system face if
/// the font is missing from the bundle, so a build without it still renders.
private extension Font {
    static func gothamBlack(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("Gotham-Black", size: size, relativeTo: style)
    }

    static func gothamBold(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("Gotham-Bold", size: size, relativeTo: style)
    }
}

private func widgetDisplayColor(_ fullColor: Color, renderingMode: WidgetRenderingMode) -> Color {
    renderingMode == .fullColor ? fullColor : .primary
}

/// The per-sport glyph for a shift, read from the event title the snapshot
/// already carries. Unknown sports fall back to a calendar, so a new sport is
/// never blank or wrong, only plainer.
private func sportGlyph(for title: String) -> String {
    let text = title.lowercased()
    let table: [(String, String)] = [
        ("football", "football.fill"),
        ("hockey", "hockey.puck.fill"),
        ("volleyball", "volleyball.fill"),
        ("basketball", "basketball.fill"),
        ("soccer", "soccerball"),
        ("baseball", "baseball.fill"),
        ("softball", "baseball.fill"),
        ("wrestling", "figure.wrestling"),
        ("swim", "figure.pool.swim"),
        ("diving", "figure.pool.swim"),
        ("tennis", "tennis.racket"),
        ("golf", "figure.golf"),
        ("rowing", "figure.rower"),
        ("crew", "figure.rower"),
        ("cross country", "figure.run"),
        ("track", "figure.run"),
        ("gymnastics", "figure.gymnastics"),
    ]
    return table.first { text.contains($0.0) }?.1 ?? "calendar"
}

/// The countdown as a loud numeral and a quiet unit, the same split the
/// gear-return Live Activity uses ("24" then "min left"), so the Lock Screen,
/// the Dynamic Island and the Home Screen read as one family.
private func countdownParts(until date: Date, from now: Date) -> (value: String, unit: String) {
    let minutes = max(0, Int(date.timeIntervalSince(now) / 60))
    if minutes < 1 { return ("Now", "") }
    if minutes < 60 { return ("\(minutes)", "min") }
    let hours = minutes / 60
    if hours < 24 {
        let rest = minutes % 60
        return (rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m", "")
    }
    return ("\(hours / 24)d", "")
}

/// A snapshot older than this stops being presented as current. The app
/// rewrites on every dashboard load, so crossing this line means the app has
/// not been opened in a long time — not that the numbers are wrong, but that
/// nothing has confirmed them recently enough to shout.
private let stalenessWindow: TimeInterval = 60 * 60 * 12

private struct GearWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: GearWidgetSnapshot?

    var isStale: Bool {
        guard let snapshot else { return true }
        return date.timeIntervalSince(snapshot.generatedAt) > stalenessWindow
    }
}

/// One provider for both widgets — they read the same snapshot and want the
/// same refresh boundaries, so splitting them would only let the two drift out
/// of sync on screen.
private struct GearWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> GearWidgetEntry {
        GearWidgetEntry(date: .now, snapshot: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (GearWidgetEntry) -> Void) {
        let snapshot = context.isPreview ? .preview : GearWidgetStore.read()
        completion(GearWidgetEntry(date: .now, snapshot: snapshot?.resolved(at: .now)))
    }

    /// Entries every five minutes for the next two hours, so the countdown
    /// numeral (which is text, not a live timer) is never more than five
    /// minutes behind. Past that the timeline asks to be rebuilt, or sooner if
    /// a shift or booking crosses a boundary.
    func getTimeline(in context: Context, completion: @escaping (Timeline<GearWidgetEntry>) -> Void) {
        let now = Date()
        let snapshot = GearWidgetStore.read()
        let entries = stride(from: 0, through: 120, by: 5).map { minutes -> GearWidgetEntry in
            let date = now.addingTimeInterval(TimeInterval(minutes * 60))
            return GearWidgetEntry(date: date, snapshot: snapshot?.resolved(at: date))
        }
        let horizon = entries.last?.date ?? now
        let next = Self.nextRefresh(after: now, snapshot: snapshot)
        completion(Timeline(entries: entries, policy: .after(max(horizon, min(next, horizon)))))
    }

    /// Refresh when something on the card would actually change wording — a
    /// shift starting or ending, a booking coming due — and otherwise on a
    /// slow heartbeat.
    private static func nextRefresh(after now: Date, snapshot: GearWidgetSnapshot?) -> Date {
        let heartbeat = now.addingTimeInterval(60 * 30)
        guard let snapshot else { return heartbeat }
        let shifts = snapshot.upcomingShifts.isEmpty
            ? snapshot.nextShift.map { [$0] } ?? []
            : snapshot.upcomingShifts
        let boundaries = shifts.flatMap { [$0.startsAt, $0.endsAt] }
            + snapshot.dueBookings.map(\.endsAt)
        let next = boundaries.filter { $0 > now }.min()
        return min(next ?? heartbeat, heartbeat)
    }
}

private extension GearWidgetSnapshot {
    /// Gallery and placeholder content. Deliberately generic — the widget
    /// gallery is rendered before the user picks the widget, so it must not
    /// show anyone's real shift.
    static let preview = GearWidgetSnapshot(
        generatedAt: .now,
        nextShift: Shift(
            id: "preview",
            title: "Volleyball vs. Minnesota",
            area: "Video",
            startsAt: .now.addingTimeInterval(60 * 90),
            endsAt: .now.addingTimeInterval(60 * 300),
            locationName: "UW Field House",
            gearLabel: "Gear ready"
        ),
        dueBookings: [
            DueBooking(
                id: "preview-1",
                title: "Sideline kit",
                endsAt: .now.addingTimeInterval(60 * 200),
                itemCount: 4,
                isOverdue: false
            )
        ],
        overdueCount: 0,
        dueTodayCount: 1
    )
}

// MARK: - Shared chrome

/// The cool surface behind every widget. In accented and vibrant modes the
/// system draws its own material instead.
private struct FreshBackground: View {
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        if renderingMode == .fullColor {
            Color.freshSurface
        } else {
            Color.clear
        }
    }
}

/// A small rounded tile holding an accent glyph, the same soft-accent chip the
/// web uses for icons.
private struct SoftTile: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let systemImage: String
    var size: CGFloat = 30
    var tint: Color = .freshAccent

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.46, weight: .bold))
            .foregroundStyle(renderingMode == .fullColor ? tint : .primary)
            .frame(width: size, height: size)
            .background(
                renderingMode == .fullColor ? Color.freshAccentSoft : Color.primary.opacity(0.12),
                in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// Shown whenever there is no snapshot to read, or nothing to show: a fresh
/// install, a signed-out phone, a quiet week. Calm and plain, one soft glyph
/// and one honest sentence.
private struct WidgetPlaceholder: View {
    let systemImage: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SoftTile(systemImage: systemImage, size: 32)
            Text(message)
                .font(.gothamBold(13, relativeTo: .footnote))
                .foregroundStyle(Color.freshSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct WidgetHeader: View {
    let title: String
    let systemImage: String
    let tint: Color
    /// Off where a `SoftTile` already carries the glyph beside it.
    var showsIcon = true

    var body: some View {
        HStack(spacing: 5) {
            if showsIcon {
                Image(systemName: systemImage)
                    .font(.caption2.weight(.bold))
            }
            Text(title)
                .font(.gothamBlack(10, relativeTo: .caption2))
                .tracking(0.6)
                .textCase(.uppercase)
        }
        .foregroundStyle(tint)
        .accessibilityHidden(true)
        .widgetAccentable()
    }
}

private struct StaleFooter: View {
    let generatedAt: Date

    var body: some View {
        Text("Updated \(generatedAt, style: .relative) ago")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .lineLimit(1)
    }
}

/// Compact one-line empty state for the Lock Screen and inline families,
/// which have no room for the Home Screen placeholder's icon-and-sentence.
private struct AccessoryEmpty: View {
    let systemImage: String
    let text: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .lineLimit(1)
    }
}

/// A single tap target into Scan, offered where there is room for a footer.
/// A `Link` rather than an intent button: Scan only opens the app's lookup
/// screen (see `ScanGearControl`), so there is nothing to run in the widget
/// process and the capability gate stays in `GearTrackerRouteParser`.
private struct ScanLink: View {
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        Link(destination: URL(string: "wisconsin://scan")!) {
            Label("Scan gear", systemImage: "barcode.viewfinder")
                .font(.gothamBold(12, relativeTo: .caption))
                .foregroundStyle(renderingMode == .fullColor ? Color.freshAccent : .primary)
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .background(
                    renderingMode == .fullColor ? Color.freshAccentSoft : Color.primary.opacity(0.12),
                    in: Capsule()
                )
        }
    }
}

/// "Today" and "Tomorrow" as a soft pill, since those are the days that matter
/// at a glance; any other day is a plain weekday.
private struct DayChip: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let date: Date

    private var phrase: (text: String, isNear: Bool) {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return ("Today", true) }
        if calendar.isDateInTomorrow(date) { return ("Tomorrow", true) }
        return (date.formatted(.dateTime.weekday(.abbreviated)).uppercased(), false)
    }

    var body: some View {
        let phrase = phrase
        if phrase.isNear {
            Text(phrase.text)
                .font(.gothamBlack(9, relativeTo: .caption2))
                .foregroundStyle(renderingMode == .fullColor ? Color.freshAccent : .primary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    renderingMode == .fullColor ? Color.freshAccentSoft : Color.primary.opacity(0.12),
                    in: Capsule()
                )
        } else {
            Text(phrase.text)
                .font(.gothamBold(9, relativeTo: .caption2))
                .foregroundStyle(Color.freshSecondary)
        }
    }
}

// MARK: - Next Shift

private struct NextShiftWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.showsWidgetContainerBackground) private var showsWidgetContainerBackground
    let entry: GearWidgetEntry

    private var accent: Color {
        widgetDisplayColor(.freshAccent, renderingMode: renderingMode)
    }

    private var upcoming: [GearWidgetSnapshot.Shift] {
        (entry.snapshot?.upcomingShifts ?? [])
            .filter { $0.endsAt > entry.date }
            .sorted { $0.startsAt < $1.startsAt }
    }

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circularBody
            case .accessoryInline: inlineBody
            default: homeBody
            }
        }
        .containerBackground(for: .widget) { FreshBackground() }
        .widgetURL(scheduleURL(for: entry.snapshot?.nextShift))
    }

    @ViewBuilder
    private var homeBody: some View {
        if let shift = entry.snapshot?.nextShift {
            switch family {
            case .accessoryRectangular: accessoryBody(shift)
            case .systemMedium: listBody(rows: 3, showsScan: false)
            case .systemLarge: listBody(rows: 6, showsScan: true)
            case .systemSmall where !showsWidgetContainerBackground: backgroundRemovedBody(shift)
            default: cardBody(shift)
            }
        } else if entry.snapshot == nil {
            WidgetPlaceholder(
                systemImage: "person.crop.circle.badge.questionmark",
                message: "Open Creative to see your next shift."
            )
        } else {
            WidgetPlaceholder(
                systemImage: "calendar.badge.checkmark",
                message: "No shifts this week. Enjoy the breather."
            )
        }
    }

    @ViewBuilder
    private var circularBody: some View {
        if let shift = entry.snapshot?.nextShift {
            let parts = countdownParts(until: shift.startsAt, from: entry.date)
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: sportGlyph(for: shift.title))
                        .font(.system(size: 11, weight: .bold))
                    Text(parts.value)
                        .font(.gothamBlack(16, relativeTo: .headline))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if !parts.unit.isEmpty {
                        Text(parts.unit)
                            .font(.system(size: 9, weight: .semibold))
                    }
                }
                .widgetAccentable()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Next shift \(shift.title)")
            .accessibilityValue(Text(shift.startsAt, format: .dateTime.weekday().hour().minute()))
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: entry.snapshot == nil ? "calendar.badge.questionmark" : "checkmark")
                    .font(.title3)
            }
            .accessibilityLabel(entry.snapshot == nil ? "Open Creative to see your next shift" : "No shifts this week")
        }
    }

    @ViewBuilder
    private var inlineBody: some View {
        if let shift = entry.snapshot?.nextShift {
            Label {
                Text("\(shift.title) \(shift.startsAt, format: .dateTime.hour().minute())")
            } icon: {
                Image(systemName: sportGlyph(for: shift.title))
            }
        } else {
            AccessoryEmpty(
                systemImage: "calendar",
                text: entry.snapshot == nil ? "Open Creative for shifts" : "No shifts this week"
            )
        }
    }

    /// "in 1h 34m", the same compact form as the Next Shift numeral. Computed
    /// from the entry date, which the timeline advances every five minutes.
    private func headerCountdown(to date: Date) -> String {
        let parts = countdownParts(until: date, from: entry.date)
        if parts.value == "Now" { return "starting now" }
        return "in \(parts.value)\(parts.unit.isEmpty ? "" : " \(parts.unit)")"
    }

    /// The agenda layout: a sport tile, the event, and when. Rows are capped by
    /// height, not by data, so Medium shows three and Large six.
    private func listBody(rows: Int, showsScan: Bool) -> some View {
        let shifts = Array(upcoming.prefix(rows))
        let compact = family == .systemMedium
        return VStack(alignment: .leading, spacing: compact ? 6 : 10) {
            // The countdown rides the header so every title gets the full row.
            HStack(alignment: .firstTextBaseline) {
                WidgetHeader(title: "Shifts", systemImage: "calendar", tint: accent)
                Spacer(minLength: 8)
                if let next = shifts.first {
                    Text(headerCountdown(to: next.startsAt))
                        .font(.gothamBold(10, relativeTo: .caption2))
                        .foregroundStyle(Color.freshSecondary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: compact ? 6 : 12) {
                ForEach(Array(shifts.enumerated()), id: \.element.id) { index, shift in
                    shiftRow(shift, isNext: index == 0)
                }
            }
            Spacer(minLength: 0)
            if family == .systemLarge, shifts.count < 6, let gear = gearSummary {
                gear
            }
            if (entry.isStale && entry.snapshot != nil) || showsScan {
                HStack {
                    if entry.isStale, let generatedAt = entry.snapshot?.generatedAt {
                        StaleFooter(generatedAt: generatedAt)
                    }
                    Spacer(minLength: 0)
                    if showsScan { ScanLink() }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func shiftRow(_ shift: GearWidgetSnapshot.Shift, isNext: Bool) -> some View {
        HStack(spacing: 10) {
            SoftTile(systemImage: sportGlyph(for: shift.title), size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(shift.title)
                    .font(.gothamBold(13, relativeTo: .subheadline))
                    .foregroundStyle(Color.freshText)
                    .lineLimit(1)
                let parts = [shift.area, shift.locationName].compactMap { $0 }.filter { !$0.isEmpty }
                if !parts.isEmpty {
                    Text(parts.joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(Color.freshSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                DayChip(date: shift.startsAt)
                Text(shift.startsAt, format: .dateTime.hour().minute())
                    .font(.gothamBold(13, relativeTo: .subheadline))
                    .monospacedDigit()
                    .lineLimit(1)
                    .foregroundStyle(isNext ? accent : Color.freshText)
            }
            // Fixed to the time's own width: a "7:30 PM" that wraps onto two
            // lines is worse than a title that truncates a character sooner.
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    /// One compact line of gear state for the Large layout's spare room, in
    /// place of a blank band. Nothing at all when the person has no gear out.
    private var gearSummary: AnyView? {
        guard let snapshot = entry.snapshot, !snapshot.dueBookings.isEmpty else { return nil }
        let (count, noun, tint): (Int, String, Color) = {
            if snapshot.overdueCount > 0 { return (snapshot.overdueCount, "overdue", .widgetRed) }
            if snapshot.dueTodayCount > 0 { return (snapshot.dueTodayCount, "due today", .widgetOrange) }
            return (snapshot.dueBookings.count, "out", .freshAccent)
        }()
        return AnyView(
            Link(destination: URL(string: "wisconsin://bookings")!) {
                HStack(spacing: 8) {
                    SoftTile(systemImage: "bag", size: 24)
                    Text("My gear")
                        .font(.gothamBold(12, relativeTo: .caption))
                        .foregroundStyle(Color.freshText)
                    Spacer(minLength: 8)
                    Text("\(count) \(noun)")
                        .font(.gothamBlack(12, relativeTo: .caption))
                        .foregroundStyle(widgetDisplayColor(tint, renderingMode: renderingMode))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(
                    renderingMode == .fullColor ? Color.freshRaised : Color.primary.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
            }
        )
    }

    private func cardBody(_ shift: GearWidgetSnapshot.Shift) -> some View {
        let parts = countdownParts(until: shift.startsAt, from: entry.date)
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                SoftTile(systemImage: sportGlyph(for: shift.title), size: 24)
                WidgetHeader(title: "Next shift", systemImage: "calendar", tint: accent, showsIcon: false)
            }

            Text(shift.title)
                .font(.gothamBold(14, relativeTo: .subheadline))
                .foregroundStyle(Color.freshText)
                .lineLimit(2)
                // Wrap to a second line instead of shrinking or truncating.
                .fixedSize(horizontal: false, vertical: family == .systemSmall)

            Spacer(minLength: 0)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(parts.value)
                    .font(.gothamBlack(28, relativeTo: .title))
                    .foregroundStyle(accent)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if !parts.unit.isEmpty {
                    Text(parts.unit)
                        .font(.gothamBold(12, relativeTo: .caption))
                        .foregroundStyle(Color.freshSecondary)
                }
            }
            .widgetAccentable()

            detailLine(shift)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// StandBy and CarPlay can remove the container background. Use one large
    /// fact and one supporting line at those distances instead of squeezing
    /// the handheld card's secondary metadata into the same space.
    private func backgroundRemovedBody(_ shift: GearWidgetSnapshot.Shift) -> some View {
        let parts = countdownParts(until: shift.startsAt, from: entry.date)
        return VStack(alignment: .leading, spacing: 2) {
            WidgetHeader(title: "Next shift", systemImage: sportGlyph(for: shift.title), tint: accent)
            Text(shift.title)
                .font(.gothamBold(14, relativeTo: .headline))
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(parts.value)
                    .font(.gothamBlack(26, relativeTo: .title))
                    .foregroundStyle(accent)
                    .lineLimit(1)
                Text(parts.unit)
                    .font(.gothamBold(12, relativeTo: .caption))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func detailLine(_ shift: GearWidgetSnapshot.Shift) -> some View {
        let when = shift.startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        Text(when)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Color.freshSecondary)
            .lineLimit(1)
        if let place = shift.locationName, !place.isEmpty {
            Text(place)
                .font(.caption2)
                .foregroundStyle(Color.freshSecondary)
                .lineLimit(1)
        }
        if entry.isStale, let generatedAt = entry.snapshot?.generatedAt {
            StaleFooter(generatedAt: generatedAt)
        }
    }

    private func accessoryBody(_ shift: GearWidgetSnapshot.Shift) -> some View {
        let parts = countdownParts(until: shift.startsAt, from: entry.date)
        return VStack(alignment: .leading, spacing: 1) {
            Label("NEXT SHIFT", systemImage: sportGlyph(for: shift.title))
                .font(.gothamBlack(10, relativeTo: .caption2))
                .foregroundStyle(.secondary)
                .widgetAccentable()
            Text(shift.title)
                .font(.gothamBold(14, relativeTo: .headline))
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(parts.value)
                    .font(.gothamBlack(15, relativeTo: .headline))
                    .monospacedDigit()
                if !parts.unit.isEmpty {
                    Text(parts.unit)
                        .font(.caption2.weight(.semibold))
                }
            }
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func scheduleURL(for shift: GearWidgetSnapshot.Shift?) -> URL? {
        guard let eventId = shift?.eventId, !eventId.isEmpty else {
            return URL(string: "wisconsin://schedule")
        }
        var components = URLComponents()
        components.scheme = "wisconsin"
        components.host = "schedule"
        components.path = "/\(eventId)"
        return components.url
    }
}

struct NextShiftWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextShiftWidget", provider: GearWidgetProvider()) { entry in
            NextShiftWidgetView(entry: entry)
        }
        .configurationDisplayName("Next Shift")
        .description("See your next assigned shift, call window, and gear readiness.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Gear Due

private struct GearDueWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.showsWidgetContainerBackground) private var showsWidgetContainerBackground
    let entry: GearWidgetEntry

    /// Red only when something is late, orange when something is due today,
    /// and the calm accent blue the rest of the time. Never red by default.
    private var accent: Color {
        guard let snapshot = entry.snapshot else {
            return widgetDisplayColor(.freshAccent, renderingMode: renderingMode)
        }
        if snapshot.overdueCount > 0 {
            return widgetDisplayColor(.widgetRed, renderingMode: renderingMode)
        }
        if snapshot.dueTodayCount > 0 {
            return widgetDisplayColor(.widgetOrange, renderingMode: renderingMode)
        }
        return widgetDisplayColor(.freshAccent, renderingMode: renderingMode)
    }

    private var outNow: [GearWidgetSnapshot.DueBooking] {
        (entry.snapshot?.dueBookings ?? []).sorted { $0.endsAt < $1.endsAt }
    }

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circularBody
            case .accessoryInline: inlineBody
            case .accessoryRectangular: rectangularBody
            default: homeBody
            }
        }
        .containerBackground(for: .widget) { FreshBackground() }
        .widgetURL(bookingURL(for: entry.snapshot))
    }

    @ViewBuilder
    private var homeBody: some View {
        if let snapshot = entry.snapshot {
            switch family {
            case .systemMedium: mediumBody(snapshot)
            case .systemLarge: largeBody(snapshot)
            case .systemSmall where !showsWidgetContainerBackground: backgroundRemovedBody(snapshot)
            default: cardBody(snapshot)
            }
        } else {
            WidgetPlaceholder(
                systemImage: "bag.badge.questionmark",
                message: "Open Creative to see gear you have out."
            )
        }
    }

    /// The number that matters most right now: overdue beats due-today beats
    /// simply out, the same precedence as `headline`.
    private func lead(_ snapshot: GearWidgetSnapshot) -> (count: Int, noun: String) {
        if snapshot.overdueCount > 0 { return (snapshot.overdueCount, "overdue") }
        if snapshot.dueTodayCount > 0 { return (snapshot.dueTodayCount, "due today") }
        return (snapshot.dueBookings.count, "out")
    }

    @ViewBuilder
    private var circularBody: some View {
        if let snapshot = entry.snapshot {
            let lead = lead(snapshot)
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: snapshot.overdueCount > 0 ? "exclamationmark.circle" : "bag")
                        .font(.system(size: 11, weight: .bold))
                    Text("\(lead.count)")
                        .font(.gothamBlack(20, relativeTo: .title3))
                        .monospacedDigit()
                }
                .widgetAccentable()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(lead.count) \(lead.noun)")
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "bag.badge.questionmark").font(.title3)
            }
            .accessibilityLabel("Open Creative to see gear you have out")
        }
    }

    @ViewBuilder
    private var inlineBody: some View {
        if let snapshot = entry.snapshot {
            let lead = lead(snapshot)
            if snapshot.dueBookings.isEmpty {
                AccessoryEmpty(systemImage: "checkmark.circle", text: "All gear returned")
            } else {
                Label("\(lead.count) \(lead.noun)", systemImage: snapshot.overdueCount > 0 ? "exclamationmark.circle" : "bag")
            }
        } else {
            AccessoryEmpty(systemImage: "bag", text: "Open Creative for gear")
        }
    }

    @ViewBuilder
    private var rectangularBody: some View {
        if let snapshot = entry.snapshot {
            VStack(alignment: .leading, spacing: 1) {
                Label("MY GEAR", systemImage: "bag")
                    .font(.gothamBlack(10, relativeTo: .caption2))
                    .foregroundStyle(.secondary)
                    .widgetAccentable()
                if let next = outNow.first {
                    let lead = lead(snapshot)
                    Text("\(lead.count) \(lead.noun)")
                        .font(.gothamBold(15, relativeTo: .headline))
                        .lineLimit(1)
                    Text("\(next.title) · \(next.isOverdue ? "was due" : "due") \(next.endsAt, format: .dateTime.hour().minute())")
                        .font(.caption)
                        .monospacedDigit()
                        .lineLimit(1)
                } else {
                    Text("All gear's back")
                        .font(.gothamBold(15, relativeTo: .headline))
                    Text("Nothing out")
                        .font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            AccessoryEmpty(systemImage: "bag", text: "Open Creative for gear")
        }
    }

    /// Summary on the left, the soonest-due rows on the right. Medium has no
    /// room for a footer, so Scan stays on the large layout.
    private func mediumBody(_ snapshot: GearWidgetSnapshot) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                WidgetHeader(title: "My gear", systemImage: "bag", tint: widgetDisplayColor(.freshAccent, renderingMode: renderingMode))
                headline(snapshot)
                Spacer(minLength: 0)
                if entry.isStale { StaleFooter(generatedAt: snapshot.generatedAt) }
            }
            .frame(width: 110, alignment: .leading)
            Divider()
            bookingRows(limit: 3, spacing: 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func largeBody(_ snapshot: GearWidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            WidgetHeader(title: "My gear", systemImage: "bag", tint: widgetDisplayColor(.freshAccent, renderingMode: renderingMode))
            headline(snapshot)
            bookingRows(limit: 5, spacing: 12)
            Spacer(minLength: 0)
            HStack {
                if entry.isStale { StaleFooter(generatedAt: snapshot.generatedAt) }
                Spacer(minLength: 0)
                ScanLink()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func bookingRows(limit: Int, spacing: CGFloat) -> some View {
        let rows = Array(outNow.prefix(limit))
        if rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SoftTile(systemImage: "checkmark", size: 28)
                Text("Nothing is due back.")
                    .font(.gothamBold(12, relativeTo: .caption))
                    .foregroundStyle(Color.freshSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: spacing) {
                ForEach(rows, id: \.id) { booking in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(booking.title)
                            .font(.gothamBold(13, relativeTo: .subheadline))
                            .foregroundStyle(Color.freshText)
                            .lineLimit(1)
                        // A clock time, not a ticking relative one: the row
                        // is rarely re-rendered, and "41 min, 43 sec" both
                        // truncates and is stale a second later.
                        HStack(spacing: 4) {
                            Text("Due")
                            Text(booking.endsAt, format: .dateTime.hour().minute()).monospacedDigit()
                            Spacer(minLength: 4)
                            Text("\(booking.itemCount) \(booking.itemCount == 1 ? "item" : "items")")
                        }
                        .font(.caption)
                        .foregroundStyle(
                            booking.isOverdue
                                ? widgetDisplayColor(.widgetRed, renderingMode: renderingMode)
                                : Color.freshSecondary
                        )
                        .lineLimit(1)
                    }
                }
                if outNow.count > limit {
                    Text("\(outNow.count - limit) more out")
                        .font(.caption2)
                        .foregroundStyle(Color.freshSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func cardBody(_ snapshot: GearWidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                SoftTile(systemImage: "bag", size: 24)
                WidgetHeader(title: "My gear", systemImage: "bag", tint: widgetDisplayColor(.freshAccent, renderingMode: renderingMode), showsIcon: false)
            }

            headline(snapshot)

            if let next = snapshot.dueBookings.first {
                Text(next.title)
                    .font(.gothamBold(13, relativeTo: .subheadline))
                    .foregroundStyle(Color.freshText)
                    .lineLimit(1)
                Text("\(next.isOverdue ? "Overdue since" : "Due") \(next.endsAt, format: .dateTime.hour().minute())")
                    .font(.caption)
                    .foregroundStyle(
                        next.isOverdue
                            ? widgetDisplayColor(.widgetRed, renderingMode: renderingMode)
                            : Color.freshSecondary
                    )
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }

            Spacer(minLength: 0)

            if entry.isStale {
                StaleFooter(generatedAt: snapshot.generatedAt)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func backgroundRemovedBody(_ snapshot: GearWidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetHeader(title: "My gear", systemImage: "bag", tint: accent)

            headline(snapshot)

            if let next = snapshot.dueBookings.first {
                Text(next.title)
                    .font(.gothamBold(12, relativeTo: .caption))
                    .lineLimit(1)
                Text("\(next.isOverdue ? "Overdue since" : "Due") \(next.endsAt, format: .dateTime.hour().minute())")
                    .font(.caption2)
                    .foregroundStyle(
                        next.isOverdue
                            ? widgetDisplayColor(.widgetRed, renderingMode: renderingMode)
                            : .secondary
                    )
                    .monospacedDigit()
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func headline(_ snapshot: GearWidgetSnapshot) -> some View {
        if snapshot.overdueCount > 0 {
            countLine(snapshot.overdueCount, noun: "overdue", tint: .widgetRed)
        } else if snapshot.dueTodayCount > 0 {
            countLine(snapshot.dueTodayCount, noun: "due today", tint: .widgetOrange)
        } else if snapshot.dueBookings.isEmpty {
            Label("All gear's back", systemImage: "checkmark.circle.fill")
                .font(.gothamBold(14, relativeTo: .headline))
                .foregroundStyle(widgetDisplayColor(.freshAccent, renderingMode: renderingMode))
        } else {
            countLine(snapshot.dueBookings.count, noun: "out", tint: .freshAccent)
        }
    }

    /// A loud numeral and a quiet noun, the same split as the Next Shift
    /// countdown and the Live Activity.
    private func countLine(_ count: Int, noun: String, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(count)")
                .font(.gothamBlack(30, relativeTo: .title))
                .monospacedDigit()
                .foregroundStyle(widgetDisplayColor(tint, renderingMode: renderingMode))
            Text(noun)
                .font(.gothamBold(12, relativeTo: .caption))
                .foregroundStyle(Color.freshSecondary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .widgetAccentable()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(count) \(noun)")
    }

    private func bookingURL(for snapshot: GearWidgetSnapshot?) -> URL {
        guard let bookingId = snapshot?.dueBookings.first?.id,
              !bookingId.isEmpty else {
            return URL(string: "wisconsin://bookings")!
        }

        var components = URLComponents()
        components.scheme = "wisconsin"
        components.host = "booking"
        components.path = "/\(bookingId)"
        return components.url ?? URL(string: "wisconsin://bookings")!
    }
}

struct GearDueWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GearDueWidget", provider: GearWidgetProvider()) { entry in
            GearDueWidgetView(entry: entry)
        }
        .configurationDisplayName("My Gear")
        .description("Check what you have out, including overdue and due-today gear.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
