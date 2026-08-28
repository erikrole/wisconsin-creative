import SwiftUI
import WidgetKit

// The widget extension compiles only its own sources plus the two shared
// contract files, so `Brand.swift` and `Color.statusText` are out of reach.
// These mirror the same taxonomy the app uses: red overdue, orange due soon,
// blue active, purple reserved.
private extension Color {
    static let widgetRed = Color(red: 0.78, green: 0.11, blue: 0.18)
    static let widgetOrange = Color(red: 0.85, green: 0.47, blue: 0.06)
    static let widgetBlue = Color(red: 0.11, green: 0.42, blue: 0.78)
    static let widgetPurple = Color(red: 0.42, green: 0.25, blue: 0.71)
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
        completion(GearWidgetEntry(date: .now, snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GearWidgetEntry>) -> Void) {
        let now = Date()
        let snapshot = GearWidgetStore.read()
        let entry = GearWidgetEntry(date: now, snapshot: snapshot)
        completion(Timeline(entries: [entry], policy: .after(Self.nextRefresh(after: now, snapshot: snapshot))))
    }

    /// Refresh when something on the card would actually change wording — a
    /// shift starting or ending, a booking coming due — and otherwise on a
    /// slow heartbeat. Relative times inside the card update on their own via
    /// `Text(_:style:)`, so this is only about the parts text style can't
    /// re-derive.
    private static func nextRefresh(after now: Date, snapshot: GearWidgetSnapshot?) -> Date {
        let heartbeat = now.addingTimeInterval(60 * 30)
        guard let snapshot else { return heartbeat }
        let boundaries = [snapshot.nextShift?.startsAt, snapshot.nextShift?.endsAt]
            .compactMap { $0 }
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

/// Shown whenever there is no snapshot to read: a fresh install, a signed-out
/// phone, or a build whose profile has no App Group. All three want the same
/// thing from the user, so they get one honest message instead of three.
private struct WidgetPlaceholder: View {
    let systemImage: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct WidgetHeader: View {
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage)
                .font(.caption2.weight(.bold))
            Text(title)
                .font(.caption2.weight(.bold))
                .textCase(.uppercase)
        }
        .foregroundStyle(tint)
        .accessibilityHidden(true)
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

// MARK: - Next Shift

private struct NextShiftWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GearWidgetEntry

    var body: some View {
        Group {
            if let shift = entry.snapshot?.nextShift {
                switch family {
                case .accessoryRectangular: accessoryBody(shift)
                default: cardBody(shift)
                }
            } else if entry.snapshot == nil {
                WidgetPlaceholder(
                    systemImage: "person.crop.circle.badge.questionmark",
                    message: "Open Creative to see your next shift."
                )
            } else {
                WidgetPlaceholder(
                    systemImage: "checkmark.seal",
                    message: "No upcoming shifts."
                )
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(URL(string: "wisconsin://schedule"))
    }

    private func cardBody(_ shift: GearWidgetSnapshot.Shift) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetHeader(title: "Next Shift", systemImage: "calendar", tint: .widgetPurple)

            Text(shift.title)
                .font(.headline)
                .lineLimit(family == .systemSmall ? 2 : 1)
                .minimumScaleFactor(0.85)

            // The relative form keeps counting down without another timeline
            // entry, which is what makes a shift widget worth glancing at.
            Text(shift.startsAt, style: .relative)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.widgetPurple)
                .monospacedDigit()
                .lineLimit(1)

            Text(shift.startsAt, format: .dateTime.weekday(.abbreviated).hour().minute())
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer(minLength: 0)

            detailLine(shift)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .privacySensitive()
    }

    @ViewBuilder
    private func detailLine(_ shift: GearWidgetSnapshot.Shift) -> some View {
        let parts = [shift.area, shift.locationName, shift.gearLabel]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(family == .systemSmall ? 2 : 1)
        }
        if entry.isStale, let generatedAt = entry.snapshot?.generatedAt {
            StaleFooter(generatedAt: generatedAt)
        }
    }

    private func accessoryBody(_ shift: GearWidgetSnapshot.Shift) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("NEXT SHIFT")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Text(shift.title)
                .font(.headline)
                .lineLimit(1)
            Text(shift.startsAt, style: .relative)
                .font(.caption)
                .monospacedDigit()
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .privacySensitive()
    }
}

struct NextShiftWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextShiftWidget", provider: GearWidgetProvider()) { entry in
            NextShiftWidgetView(entry: entry)
        }
        .configurationDisplayName("Next Shift")
        .description("Your next assigned shift, its call window, and whether gear is ready.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - Gear Due

private struct GearDueWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GearWidgetEntry

    private var accent: Color {
        guard let snapshot = entry.snapshot else { return .widgetBlue }
        if snapshot.overdueCount > 0 { return .widgetRed }
        if snapshot.dueTodayCount > 0 { return .widgetOrange }
        return .widgetBlue
    }

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                cardBody(snapshot)
            } else {
                WidgetPlaceholder(
                    systemImage: "bag.badge.questionmark",
                    message: "Open Creative to see gear you have out."
                )
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(URL(string: "wisconsin://bookings"))
    }

    private func cardBody(_ snapshot: GearWidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetHeader(title: "My Gear", systemImage: "bag", tint: accent)

            headline(snapshot)

            if let next = snapshot.dueBookings.first {
                Text(next.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text("Due \(next.endsAt, style: .relative)")
                    .font(.caption)
                    .foregroundStyle(next.isOverdue ? Color.widgetRed : .secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }

            if family == .systemMedium, snapshot.dueBookings.count > 1 {
                Text("\(snapshot.dueBookings.count - 1) more out")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if entry.isStale {
                StaleFooter(generatedAt: snapshot.generatedAt)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .privacySensitive()
    }

    @ViewBuilder
    private func headline(_ snapshot: GearWidgetSnapshot) -> some View {
        if snapshot.overdueCount > 0 {
            countLine(snapshot.overdueCount, noun: "overdue", tint: .widgetRed)
        } else if snapshot.dueTodayCount > 0 {
            countLine(snapshot.dueTodayCount, noun: "due today", tint: .widgetOrange)
        } else if snapshot.dueBookings.isEmpty {
            Text("All clear")
                .font(.headline)
                .foregroundStyle(Color.widgetBlue)
        } else {
            countLine(snapshot.dueBookings.count, noun: "out", tint: .widgetBlue)
        }
    }

    private func countLine(_ count: Int, noun: String, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(count)")
                .font(.title.weight(.bold))
                .monospacedDigit()
            Text(noun)
                .font(.subheadline.weight(.semibold))
        }
        .foregroundStyle(tint)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(count) \(noun)")
    }
}

struct GearDueWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GearDueWidget", provider: GearWidgetProvider()) { entry in
            GearDueWidgetView(entry: entry)
        }
        .configurationDisplayName("My Gear")
        .description("What you have checked out, and what is overdue or due today.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
