import SwiftUI

func chipDayTitle(_ day: Date, calendar: Calendar = .current, now: Date = .now) -> String {
    if calendar.dayOffset(of: day, from: now) == 0 { return "Today" }
    if calendar.dayOffset(of: day, from: now) == 1 { return "Tomorrow" }
    return day.formatted(.dateTime.weekday(.abbreviated))
}

/// "Today 8:15 PM", the one phrasing every date chip surface uses.
func chipDayTime(_ date: Date, calendar: Calendar = .current) -> String {
    "\(chipDayTitle(date, calendar: calendar)) \(date.formatted(.dateTime.hour().minute()))"
}

/// Single-tap day or time choice. A picked chip is solid, like the kiosk's.
struct ChipButton: View {
    let title: String
    var systemImage: String? = nil
    var detail: String? = nil
    let isSelected: Bool
    var tint: Color = Color.statusText(.blue)
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 1) {
                if let systemImage {
                    Label(title, systemImage: systemImage).font(.subheadline.weight(.semibold))
                } else {
                    Text(title).font(.subheadline.weight(.semibold))
                }
                if let detail {
                    Text(detail).font(.caption2).opacity(0.75)
                }
            }
            .foregroundStyle(isSelected ? Color.white : Color.primary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                isSelected ? tint : Color(.tertiarySystemFill),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

/// The kiosk's return-time picker for the iPhone, kept to one decision at a
/// time: Today, Tomorrow or another date; then three suggested times or the
/// quarter-hour wheel. A Latest chip appears when something else needs the gear.
/// Nothing earlier than `minimum` or later than `latest` is offered.
struct DayTimeChipPicker: View {
    @Binding var selection: Date
    let minimum: Date
    var latest: Date? = nil
    var tint: Color = Color.statusText(.blue)

    private static let timeChoices: [(hour: Int, minute: Int)] = [
        (9, 0), (12, 0), (15, 0), (17, 0), (20, 0), (22, 0),
    ]

    private var calendar: Calendar { .current }
    private var selectedDay: Date { calendar.startOfDay(for: selection) }
    private var today: Date { calendar.startOfDay(for: Date()) }
    private var tomorrow: Date { calendar.date(byAdding: .day, value: 1, to: today) ?? today }
    private var isOtherDay: Bool { selectedDay != today && selectedDay != tomorrow }

    private func isAllowed(day: Date) -> Bool {
        day >= calendar.startOfDay(for: minimum) && (latest.map { day <= $0 } ?? true)
    }

    private var suggestedTimes: [Date] {
        let valid = Self.timeChoices.compactMap {
            calendar.date(bySettingHour: $0.hour, minute: $0.minute, second: 0, of: selectedDay)
        }
        .filter { time in time > max(minimum, Date()) && (latest.map { time <= $0 } ?? true) }
        var picks = Array(valid.prefix(3))
        let selectionIsValid = selection > minimum && calendar.isDate(selection, inSameDayAs: selectedDay)
            && (latest.map { selection <= $0 } ?? true)
        if selectionIsValid, !picks.contains(selection) {
            if picks.count == 3 { picks.removeLast() }
            picks.append(selection)
            picks.sort()
        }
        return picks
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                dayChip("Today", day: today)
                dayChip("Tomorrow", day: tomorrow)
                otherDateChip
            }

            if let latest, latest > minimum {
                ChipButton(title: "Latest: \(chipDayTime(latest))", isSelected: selection == latest, tint: tint) {
                    selection = latest
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2), spacing: 8) {
                ForEach(suggestedTimes, id: \.self) { time in
                    ChipButton(
                        title: time.formatted(.dateTime.hour().minute()),
                        isSelected: selection == time,
                        tint: tint
                    ) { selection = time }
                }
                wheelChip
            }
        }
    }

    @ViewBuilder
    private func dayChip(_ title: String, day: Date) -> some View {
        ChipButton(
            title: title,
            isSelected: selectedDay == day,
            tint: tint
        ) { pickDay(day) }
        .disabled(!isAllowed(day: day))
        .opacity(isAllowed(day: day) ? 1 : 0.4)
    }

    /// The compact `DatePicker` always draws its own date text, so when this
    /// chip isn't the active choice the picker is made near-invisible (still
    /// tappable) and an "Other date" label sits in its place.
    private var otherDateChip: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(isOtherDay ? tint : Color(.tertiarySystemFill))
            if !isOtherDay {
                Text("Other date")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .allowsHitTesting(false)
            }
            DatePicker(
                "Date",
                selection: Binding(get: { selection }, set: { pickDay($0) }),
                in: calendar.startOfDay(for: max(minimum, Date()))...,
                displayedComponents: .date
            )
            .labelsHidden()
            .tint(isOtherDay ? .white : tint)
            .colorScheme(isOtherDay ? .dark : .light)
            .opacity(isOtherDay ? 1 : 0.015)
        }
        .frame(maxWidth: .infinity, minHeight: 48)
    }

    private var wheelChip: some View {
        HStack(spacing: 6) {
            Image(systemName: "clock")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            QuarterHourTimePicker(selection: $selection, minimumDate: minimum, tint: tint,
                                  accessibilityLabel: "Custom time, 15-minute increments")
        }
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
    }

    /// Moving the day keeps the time of day, and never lands at or before `minimum`.
    private func pickDay(_ day: Date) {
        let time = calendar.dateComponents([.hour, .minute], from: selection)
        guard let moved = calendar.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: 0, of: calendar.startOfDay(for: day)) else { return }
        selection = max(moved, QuarterHour.roundedUp(minimum.addingTimeInterval(60)))
    }
}
