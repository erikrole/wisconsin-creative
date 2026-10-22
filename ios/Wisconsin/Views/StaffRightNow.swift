import SwiftUI

// MARK: - Model

/// `GET /api/users/{id}/right-now`: what is happening with one person today.
struct RightNowPayload: Codable {
    struct NextShift: Codable {
        let summary: String
        let location: String?
        let area: String
        let startsAt: String
        let endsAt: String
        let live: Bool
    }

    struct Holding: Codable, Identifiable {
        let id: String
        let title: String
        let dueAt: String
        let overdue: Bool
    }

    struct WeekShift: Codable, Identifiable {
        let summary: String
        let area: String
        let startsAt: String
        let endsAt: String
        var id: String { "\(startsAt)-\(summary)" }
    }

    struct Performance: Codable {
        let checkouts: Int
        let onTimeRate: Int?
    }

    let nextShift: NextShift?
    let holding: [Holding]
    let week: [WeekShift]
    let performance: Performance
}

// MARK: - Staff palette

/// Web staff redesign tokens. Kept here so the roster and the profile agree.
enum StaffPalette {
    static let accent = Color(red: 0x3e / 255, green: 0x63 / 255, blue: 0xdd / 255)

    static func areaColor(_ area: String?) -> Color {
        switch area {
        case "VIDEO": Color(red: 0x3e / 255, green: 0x63 / 255, blue: 0xdd / 255)
        case "PHOTO": Color(red: 0x8e / 255, green: 0x4e / 255, blue: 0xc6 / 255)
        case "GRAPHICS": Color(red: 0xd6 / 255, green: 0x40 / 255, blue: 0x9f / 255)
        case "SOCIAL": Color(red: 0x12 / 255, green: 0xa5 / 255, blue: 0x94 / 255)
        case "COMMS": Color(red: 0xe5 / 255, green: 0xa2 / 255, blue: 0x00 / 255)
        case "LIVE_PRODUCTION": Color(red: 0xf7 / 255, green: 0x68 / 255, blue: 0x08 / 255)
        default: Color(red: 0x8b / 255, green: 0x8d / 255, blue: 0x98 / 255)
        }
    }
}

@MainActor
private enum RightNowDates {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let plain = ISO8601DateFormatter()

    static func parse(_ value: String) -> Date? {
        withFraction.date(from: value) ?? plain.date(from: value)
    }

    static let dayTime: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d jmm")
        return f
    }()
    static let day: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return f
    }()
    static let time: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("jmm")
        return f
    }()

    static func dayTime(_ value: String) -> String {
        parse(value).map { dayTime.string(from: $0) } ?? ""
    }

    static func range(_ start: String, _ end: String) -> String {
        guard let s = parse(start), let e = parse(end) else { return "" }
        return "\(time.string(from: s)) – \(time.string(from: e))"
    }
}

// MARK: - Right now row

/// The unearned badge closest to done, if any is at least started.
func nearestBadge(in profile: BadgeProfile?) -> UserBadge? {
    var best: UserBadge?
    var bestRatio = 0.0
    for badge in profile?.badges ?? [] {
        guard !badge.earned, badge.active,
              let target = badge.progressTarget, target > 0,
              let current = badge.progressCurrent, current > 0 else { continue }
        let ratio = Double(current) / Double(target)
        if ratio < 1, ratio > bestRatio {
            best = badge
            bestRatio = ratio
        }
    }
    return best
}

private struct RightNowTile: View {
    enum Tone {
        case green, blue, amber

        var background: Color {
            switch self {
            case .green: Color(red: 0xe6 / 255, green: 0xf6 / 255, blue: 0xeb / 255)
            case .blue: Color(red: 0xe8 / 255, green: 0xee / 255, blue: 0xff / 255)
            case .amber: Color(red: 0xff / 255, green: 0xf1 / 255, blue: 0xd6 / 255)
            }
        }

        var foreground: Color {
            switch self {
            case .green: Color(red: 0x1b / 255, green: 0x6e / 255, blue: 0x47 / 255)
            case .blue: Color(red: 0x2f / 255, green: 0x4b / 255, blue: 0xb0 / 255)
            case .amber: Color(red: 0x8a / 255, green: 0x52 / 255, blue: 0x00 / 255)
            }
        }
    }

    let tone: Tone
    let symbol: String
    let label: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tone.foreground)
                .frame(width: 40, height: 40)
                .background(tone.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .font(.caption2.weight(.heavy))
                    .tracking(0.6)
                    .foregroundStyle(tone.foreground)
                Text(title)
                    .font(.gothamBold(size: 16))
                    .lineLimit(2)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.md)
        .accessibilityElement(children: .combine)
    }
}

/// Top of a staff profile: Right now tiles, This week, Performance. A tile
/// only appears when there is something to say, and the whole block collapses
/// when there is nothing, matching the web Overview.
struct StaffRightNowSection: View {
    let payload: RightNowPayload?
    let badgeProfile: BadgeProfile?
    let openSchedule: () -> Void
    let openBooking: (String) -> Void

    var body: some View {
        if let payload, hasContent(payload) {
            VStack(spacing: Brand.Space.sm) {
                tiles(payload)
                if showCards(payload) {
                    weekCard(payload)
                    performanceCard(payload)
                }
            }
        }
    }

    private var earnedCount: Int { badgeProfile?.earnedBadges.count ?? 0 }

    private func showCards(_ p: RightNowPayload) -> Bool {
        !p.week.isEmpty || p.performance.checkouts > 0 || earnedCount > 0
    }

    private func hasContent(_ p: RightNowPayload) -> Bool {
        p.nextShift != nil || !p.holding.isEmpty || nearestBadge(in: badgeProfile) != nil || showCards(p)
    }

    @ViewBuilder
    private func tiles(_ p: RightNowPayload) -> some View {
        if let shift = p.nextShift {
            Button(action: openSchedule) {
                RightNowTile(
                    tone: .green,
                    symbol: "calendar",
                    label: shift.live ? "On shift now" : "Next shift",
                    title: shift.summary,
                    detail: [RightNowDates.dayTime(shift.startsAt), shift.location]
                        .compactMap { $0 }
                        .filter { !$0.isEmpty }
                        .joined(separator: " · ")
                )
            }
            .buttonStyle(.plain)
        }
        if let first = p.holding.first {
            Button { openBooking(first.id) } label: {
                RightNowTile(
                    tone: .blue,
                    symbol: "camera",
                    label: "Holding",
                    title: p.holding.count > 1
                        ? "\(first.title) and \(p.holding.count - 1) more"
                        : first.title,
                    detail: "\(first.overdue ? "Overdue" : "Due") \(RightNowDates.dayTime(first.dueAt))"
                )
            }
            .buttonStyle(.plain)
        }
        if let badge = nearestBadge(in: badgeProfile),
           let current = badge.progressCurrent, let target = badge.progressTarget {
            RightNowTile(
                tone: .amber,
                symbol: "rosette",
                label: "Almost there",
                title: badge.name,
                detail: "\(current) of \(target)"
            )
        }
    }

    private func weekCard(_ p: RightNowPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("This week")
                    .font(.gothamBold(size: 17))
                Spacer()
                Button("Open schedule", action: openSchedule)
                    .font(.footnote.weight(.bold))
                    .tint(Color(red: 0x2f / 255, green: 0x4b / 255, blue: 0xb0 / 255))
            }
            if p.week.isEmpty {
                Text("No shifts in the next 7 days.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(p.week.enumerated()), id: \.element.id) { index, shift in
                        HStack(alignment: .top, spacing: 10) {
                            Circle()
                                .fill(StaffPalette.areaColor(shift.area))
                                .frame(width: 10, height: 10)
                                .padding(.top, 5)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(shift.summary)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                                Text("\(RightNowDates.parse(shift.startsAt).map { RightNowDates.day.string(from: $0) } ?? "") · \(RightNowDates.range(shift.startsAt, shift.endsAt))")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .combine)
                        if index < p.week.count - 1 { Divider() }
                    }
                }
            }
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }

    private func performanceCard(_ p: RightNowPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Performance")
                .font(.gothamBold(size: 17))
            HStack(alignment: .top, spacing: 8) {
                stat(p.performance.onTimeRate.map { "\($0)%" } ?? "—", "On-time returns")
                stat("\(p.performance.checkouts)", "Checkouts")
                stat("\(earnedCount)", "Badges earned")
            }
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.gothamBlack(size: 24))
                .monospacedDigit()
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
