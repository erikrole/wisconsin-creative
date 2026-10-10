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
/// time: Today, Tomorrow or another date; then up to three suggested times or
/// Custom. A Latest chip appears when something else needs the gear.
///
/// Anything the chips don't cover -- another day, or a time off the
/// suggestions -- goes through one sheet, reached from either "Other date" or
/// "Custom", with the calendar and a quarter-hour time together. Each chip
/// then shows what was picked there ("Mon, Oct 12", "4:45 PM"), so the row
/// always reads as the current answer. Nothing earlier than `minimum` or later
/// than `latest` is offered.
struct DayTimeChipPicker: View {
    @Binding var selection: Date
    let minimum: Date
    var latest: Date? = nil
    var tint: Color = Color.statusText(.blue)
    @State private var showsCustom = false
    @State private var pickedCustom = false

    private static let timeChoices: [(hour: Int, minute: Int)] = [
        (9, 0), (12, 0), (15, 0), (17, 0), (20, 0), (22, 0),
    ]

    private var calendar: Calendar { .current }
    private var selectedDay: Date { calendar.startOfDay(for: selection) }
    private var today: Date { calendar.startOfDay(for: Date()) }
    private var tomorrow: Date { calendar.date(byAdding: .day, value: 1, to: today) ?? today }
    private var isOtherDay: Bool { selectedDay != today && selectedDay != tomorrow }

    /// Other date only when a day past tomorrow is actually reachable.
    private var allowsOtherDate: Bool {
        guard let latest else { return true }
        let dayAfterTomorrow = calendar.date(byAdding: .day, value: 1, to: tomorrow) ?? tomorrow
        return latest >= dayAfterTomorrow
    }

    private func isAllowed(day: Date) -> Bool {
        day >= calendar.startOfDay(for: minimum) && (latest.map { day <= $0 } ?? true)
    }

    /// Up to three times on the chosen day. A starting value nobody picked --
    /// the booking's current due time, a default -- takes its place among
    /// them in order, so Custom only ever means "what I chose myself".
    private var suggestedTimes: [Date] {
        let valid = Self.timeChoices.compactMap {
            calendar.date(bySettingHour: $0.hour, minute: $0.minute, second: 0, of: selectedDay)
        }
        .filter { time in time > max(minimum, Date()) && (latest.map { time <= $0 } ?? true) }
        var picks = Array(valid.prefix(3))
        let startsOffGrid = !pickedCustom && selection > minimum && !isLatestSelected
            && calendar.isDate(selection, inSameDayAs: selectedDay) && !picks.contains(selection)
        if startsOffGrid {
            if picks.count == 3 { picks.removeLast() }
            picks.append(selection)
            picks.sort()
        }
        return picks
    }

    private var isLatestSelected: Bool { latest.map { selection == $0 } ?? false }

    /// A time no suggestion or Latest accounts for was picked in the sheet.
    /// At `minimum` nothing has been picked yet (Extend opens on the current
    /// due time), so Custom stays unselected there.
    private var isCustomTime: Bool {
        selection > minimum && !isLatestSelected && !suggestedTimes.contains(selection)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                dayChip("Today", day: today)
                dayChip("Tomorrow", day: tomorrow)
                ChipButton(
                    title: isOtherDay ? selection.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) : "Other date",
                    isSelected: isOtherDay,
                    tint: tint
                ) { showsCustom = true }
                .disabled(!allowsOtherDate && !isOtherDay)
                .opacity(allowsOtherDate || isOtherDay ? 1 : 0.4)
                .accessibilityLabel(isOtherDay ? "Other date, \(selection.formatted(date: .complete, time: .omitted))" : "Other date")
            }

            if let latest, latest > minimum {
                ChipButton(title: "Latest: \(chipDayTime(latest))", isSelected: isLatestSelected, tint: tint) {
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
                ChipButton(
                    title: isCustomTime ? selection.formatted(.dateTime.hour().minute()) : "Custom",
                    systemImage: isCustomTime ? nil : "clock",
                    detail: isCustomTime ? "Custom" : nil,
                    isSelected: isCustomTime,
                    tint: tint
                ) { showsCustom = true }
                .accessibilityLabel(isCustomTime ? "Custom time, \(selection.formatted(date: .omitted, time: .shortened))" : "Custom time")
            }
        }
        .sheet(isPresented: $showsCustom) {
            DayTimeCustomSheet(selection: $selection, minimum: minimum, latest: latest, tint: tint) {
                pickedCustom = true
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

    /// Moving the day keeps the time of day, and never lands at or before `minimum`.
    private func pickDay(_ day: Date) {
        let time = calendar.dateComponents([.hour, .minute], from: selection)
        guard let moved = calendar.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: 0, of: calendar.startOfDay(for: day)) else { return }
        var picked = max(moved, QuarterHour.roundedUp(minimum.addingTimeInterval(60)))
        if let latest { picked = min(picked, latest) }
        selection = picked
    }
}

/// The one place for a day or time the chips don't offer: a calendar and a
/// quarter-hour time, edited as a draft and applied with Done. Done stays off
/// until the draft is inside the allowed window, and the reason is said.
private struct DayTimeCustomSheet: View {
    @Binding var selection: Date
    let minimum: Date
    var latest: Date?
    let tint: Color
    let onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: Date

    init(selection: Binding<Date>, minimum: Date, latest: Date?, tint: Color, onDone: @escaping () -> Void) {
        _selection = selection
        self.minimum = minimum
        self.latest = latest
        self.tint = tint
        self.onDone = onDone
        // Start on something Done will accept: the current pick when it is
        // valid, otherwise the first quarter hour after `minimum`.
        // The time row moves in quarter hours, so the draft starts on one;
        // otherwise the row would show 3:30 while the summary said 3:38.
        var start = QuarterHour.roundedUp(selection.wrappedValue)
        if start <= minimum { start = QuarterHour.roundedUp(minimum.addingTimeInterval(60)) }
        if let latest { start = min(start, latest) }
        _draft = State(initialValue: start)
    }

    private var calendar: Calendar { .current }

    private var dayRange: ClosedRange<Date> {
        let start = calendar.startOfDay(for: max(minimum, Date()))
        let end = latest ?? calendar.date(byAdding: .year, value: 1, to: start) ?? start
        return start...max(start, end)
    }

    private var problem: String? {
        if draft <= minimum { return "Pick a time after \(chipDayTime(minimum))." }
        if let latest, draft > latest { return "The latest is \(chipDayTime(latest))." }
        return nil
    }

    /// The calendar edits only the day; the time row edits only the time.
    private var dayBinding: Binding<Date> {
        Binding(get: { draft }, set: { day in
            let time = calendar.dateComponents([.hour, .minute], from: draft)
            draft = calendar.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: 0,
                                  of: calendar.startOfDay(for: day)) ?? draft
        })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    DatePicker("Day", selection: dayBinding, in: dayRange, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .tint(tint)

                    HStack {
                        Text("Time")
                            .font(.body.weight(.semibold))
                        Spacer()
                        QuarterHourTimePicker(selection: $draft, minimumDate: nil, tint: tint,
                                              accessibilityLabel: "Time, 15-minute increments")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))

                    if let problem {
                        Label(problem, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.statusText(.red))
                    } else {
                        Text(chipDayTime(draft))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Pick a date and time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        selection = draft
                        onDone()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(problem != nil)
                }
            }
        }
        .presentationDetents([.large])
    }
}
