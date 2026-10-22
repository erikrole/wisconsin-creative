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

/// Inline month calendar plus a 15-minute time row, the way Calendar expands
/// an event's Ends row. Days outside `minimum...latest` can't be picked, and
/// the time is clamped into the same window.
struct ReturnTimeCalendar: View {
    @Binding var selection: Date
    let minimum: Date
    var latest: Date? = nil
    /// Callers pass the app's tint; the kiosk target has no `brandPrimary`.
    var tint: Color? = nil

    /// Where the time buttons are centered. Set when the picker appears or
    /// the day changes, never on a button tap, so buttons don't shift under
    /// the finger.
    @State private var anchor: Date?

    private var calendar: Calendar { .current }

    private var dayRange: ClosedRange<Date> {
        let lower = calendar.startOfDay(for: minimum)
        return lower...max(latest ?? .distantFuture, lower)
    }

    private var isSingleDay: Bool {
        latest.map { calendar.isDate($0, inSameDayAs: minimum) } ?? false
    }

    private var dayBinding: Binding<Date> {
        Binding(
            get: { selection },
            set: { newDay in
                let time = calendar.dateComponents([.hour, .minute], from: selection)
                guard let moved = calendar.date(
                    bySettingHour: time.hour ?? 0,
                    minute: time.minute ?? 0,
                    second: 0,
                    of: calendar.startOfDay(for: newDay)
                ) else { return }
                selection = clamped(moved)
                anchor = selection
            }
        )
    }

    private var timeBinding: Binding<Date> {
        Binding(get: { selection }, set: { selection = clamped($0) })
    }

    private func clamped(_ date: Date) -> Date {
        let value = QuarterHour.clamped(date, minimum: minimum)
        guard let latest else { return value }
        return min(value, latest)
    }

    var body: some View {
        VStack(spacing: 0) {
            // When the window closes the same day, a month grid only shows
            // one tappable date, so just the time row is offered.
            if !isSingleDay {
                DatePicker("Return day", selection: dayBinding, in: dayRange, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    // Set on the picker itself; relying on inheritance drew the
                    // picked day black in Extend.
                    .tint(tint)
                Divider()
            }
            HStack {
                Text("Time")
                Spacer()
                // Fallback for any quarter hour the shortcuts below don't cover.
                QuarterHourTimePicker(
                    selection: timeBinding,
                    minimumDate: minimum,
                    tint: tint,
                    accessibilityLabel: "Return time, 15-minute increments"
                )
            }
            .padding(.top, 6)
            if !quickTimes.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(quickTimes, id: \.self) { time in
                        quickTimeButton(time)
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .tint(tint)
        .onAppear { if anchor == nil { anchor = selection } }
    }

    private static let quickHours: [(hour: Int, minute: Int)] = [
        (9, 0), (12, 0), (15, 0), (17, 0), (20, 0), (22, 0),
    ]

    /// One-tap times on the picked day, six at most. Later days get the usual
    /// handoff hours; when the window starts or ends that day, the next
    /// half hours inside it are offered instead, so a short window still has
    /// real choices around the current pick. The latest allowed time is
    /// always one of them.
    private var quickTimes: [Date] {
        let day = calendar.startOfDay(for: selection)
        let center = anchor.flatMap { calendar.isDate($0, inSameDayAs: selection) ? $0 : nil } ?? selection
        let earliest = QuarterHour.roundedUp(minimum)
        let isTight = calendar.isDate(earliest, inSameDayAs: day)
            || latest.map { calendar.isDate($0, inSameDayAs: day) } == true
        var times: [Date]
        if isTight {
            // Centered a little before the current pick, so the times shown
            // are the ones near what's set rather than the start of the window.
            let step = TimeInterval(30 * 60)
            let start = max(earliest, day, center.addingTimeInterval(-3 * step))
            let firstHalfHour = Date(timeIntervalSinceReferenceDate: ceil(start.timeIntervalSinceReferenceDate / step) * step)
            times = (0..<12).map { firstHalfHour.addingTimeInterval(Double($0) * step) }
        } else {
            times = Self.quickHours.compactMap {
                calendar.date(bySettingHour: $0.hour, minute: $0.minute, second: 0, of: day)
            }
        }
        times = times.filter { time in
            calendar.isDate(time, inSameDayAs: day)
                && time >= earliest
                && (latest.map { time <= $0 } ?? true)
        }
        times = Array(times.prefix(6))
        if let latest, calendar.isDate(latest, inSameDayAs: day), latest >= earliest, !times.contains(latest) {
            if times.count == 6 { times.removeLast() }
            times.append(latest)
        }
        return times.sorted()
    }

    @ViewBuilder
    private func quickTimeButton(_ time: Date) -> some View {
        let isSelected = selection == time
        // Full-width labels so every capsule in the grid is the same size.
        let label = Text(time.formatted(.dateTime.hour().minute()))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity)
        if isSelected {
            Button { selection = time } label: { label }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .accessibilityAddTraits(.isSelected)
        } else {
            Button {
                selection = time
                Haptics.selection()
            } label: { label }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
            // Unpicked times stay neutral so only the choice carries color.
            .tint(.secondary)
            .foregroundStyle(.primary)
        }
    }
}
