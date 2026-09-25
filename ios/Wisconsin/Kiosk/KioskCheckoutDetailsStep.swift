import SwiftUI

// MARK: - New checkout, step 1 (redesign D2, D3, I6)
//
// What it's for on the left (your shifts, or something else), when it's back
// on the right (day chips, time chips, a "Back by" summary, Other date). Details
// come before scanning so every scan is checked against the right return time.

struct KioskCheckoutDetailsStep: View {
    let events: [KioskCheckoutEvent]
    let isLoadingEvents: Bool
    @Binding var isLinkedToEvent: Bool
    @Binding var selectedEventId: String?
    @Binding var customPurpose: String
    @Binding var dueBackAt: Date
    @Binding var focusedField: KioskCheckoutFocusedField?
    let canContinue: Bool
    let blockingRequirement: String?
    let onContinue: () -> Void

    @State private var showOtherDate = false

    private var shifts: [KioskCheckoutEvent] { events.filter(\.isMyShift) }
    private var otherEvents: [KioskCheckoutEvent] { events.filter { !$0.isMyShift } }
    private var selectedEvent: KioskCheckoutEvent? {
        guard isLinkedToEvent, let selectedEventId else { return nil }
        return events.first { $0.id == selectedEventId }
    }

    var body: some View {
        HStack(spacing: 0) {
            purposeColumn
                .padding(.leading, KioskSpacing.xl)
                .padding(.trailing, KioskSpacing.lg)
                .frame(width: 500)
                .frame(maxHeight: .infinity, alignment: .top)
            Rectangle().fill(KioskStroke.divider).frame(width: 1)
            returnColumn
                .padding(.leading, KioskSpacing.lg)
                .padding(.trailing, KioskSpacing.xl)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(.top, 20)
        .padding(.bottom, KioskSpacing.screenBottom)
        .overlay {
            if showOtherDate {
                KioskOtherDateSheet(
                    initial: dueBackAt,
                    onCancel: { showOtherDate = false },
                    onUse: { date in
                        dueBackAt = date
                        showOtherDate = false
                    }
                )
                .transition(.opacity)
            }
        }
    }

    // MARK: What's this for?

    private var purposeColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("What's this for?")
                    .font(KioskType.heroAction)
                    .foregroundStyle(KioskText.primary)
                if isLoadingEvents && events.isEmpty {
                    KioskSkeletonBox(cornerRadius: KioskRadius.lg).frame(height: 60)
                }
                if !shifts.isEmpty {
                    KioskSectionHeader(title: "Your shifts")
                    ForEach(shifts) { event in eventRow(event) }
                }
                if !otherEvents.isEmpty {
                    KioskSectionHeader(title: shifts.isEmpty ? "Events" : "Other events")
                    ForEach(otherEvents.prefix(4)) { event in eventRow(event) }
                }
                KioskSectionHeader(title: "Something else")
                purposeField
                KioskKeyboardTip(isFieldFocused: focusedField == .customPurpose)
            }
            .padding(.top, 4)
        }
        .scrollIndicators(.hidden)
    }

    private func eventRow(_ event: KioskCheckoutEvent) -> some View {
        let isSelected = isLinkedToEvent && selectedEventId == event.id
        return Button {
            if isSelected {
                isLinkedToEvent = false
                selectedEventId = nil
            } else {
                selectedEventId = event.id
                isLinkedToEvent = true
                focusedField = nil
            }
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    if isSelected {
                        Circle().fill(KioskText.primary)
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(KioskText.onPrimary)
                    } else {
                        Circle().strokeBorder(KioskStroke.pending, lineWidth: 2)
                    }
                }
                .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(event.title)
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    Text(KioskCheckoutEventFormat.subtitle(event))
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.tertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 60)
            .kioskCard(isSelected ? KioskSurface.cardSelected : KioskSurface.cardRaised,
                       radius: KioskRadius.lg,
                       stroke: isSelected ? KioskStroke.selected : KioskStroke.standard)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var purposeField: some View {
        let isFocused = focusedField == .customPurpose
        return KioskNativeTextField(
            placeholder: "Name it: practice, shoot, project",
            text: Binding(
                get: { customPurpose },
                set: { value in
                    customPurpose = value
                    if !value.trimmingCharacters(in: .whitespaces).isEmpty {
                        isLinkedToEvent = false
                        selectedEventId = nil
                    }
                }
            ),
            isFocused: Binding(
                get: { focusedField == .customPurpose },
                set: { focusedField = $0 ? .customPurpose : nil }
            ),
            fontSize: 16,
            fontWeight: .medium
        )
        .padding(.horizontal, 16)
        .frame(height: 60)
        .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.lg,
                   stroke: isFocused || (!isLinkedToEvent && !customPurpose.isEmpty) ? KioskStroke.selected : KioskStroke.standard)
    }

    // MARK: When's it back?

    private var returnColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("When's it back?")
                .font(KioskType.heroAction)
                .foregroundStyle(KioskText.primary)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(dayChoices, id: \.self) { day in
                    choiceChip(
                        title: dayTitle(day),
                        detail: dayDetail(day),
                        isSelected: Calendar.current.isDate(day, inSameDayAs: dueBackAt)
                    ) { selectDay(day) }
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(timeChoices, id: \.date) { choice in
                    choiceChip(
                        title: choice.title,
                        detail: choice.note,
                        isSelected: abs(choice.date.timeIntervalSince(dueBackAt)) < 60
                    ) { dueBackAt = choice.date }
                }
            }
            backBySummary
            Spacer(minLength: 8)
            if let blockingRequirement, !canContinue {
                Text(blockingRequirement)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                    .frame(maxWidth: .infinity)
            }
            KioskPrimaryPill(title: "Continue to scan", isEnabled: canContinue, action: onContinue)
        }
        .padding(.top, 4)
    }

    private func choiceChip(title: String, detail: String?, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(title)
                    .font(KioskType.rowTitle)
                    .foregroundStyle(isSelected ? KioskText.onPrimary : KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let detail {
                    Text(detail)
                        .font(KioskType.chip)
                        .foregroundStyle(isSelected ? KioskText.onPrimaryDetail : KioskText.tertiary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .kioskCard(isSelected ? KioskText.primary : KioskSurface.cardRaised,
                       radius: KioskRadius.lg,
                       stroke: isSelected ? KioskText.primary : KioskStroke.standard)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityLabel([title, detail].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var backBySummary: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("BACK BY")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskText.tertiary)
                Text(KioskDueCopy.relative(dueBackAt))
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                Text(dueBackAt.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
            }
            Spacer(minLength: 8)
            Button("Other date") { showOtherDate = true }
                .kioskButtonRole(.quiet)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .kioskCard(Color(red: 0x0E / 255, green: 0x0E / 255, blue: 0x10 / 255))
    }

    // MARK: Choices

    private var dayChoices: [Date] {
        let today = Calendar.current.startOfDay(for: Date())
        return (0..<4).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: today) }
    }

    private func dayTitle(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInTomorrow(day) { return "Tomorrow" }
        return day.formatted(.dateTime.weekday(.abbreviated))
    }

    private func dayDetail(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) || calendar.isDateInTomorrow(day) {
            return day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        return day.formatted(.dateTime.month(.abbreviated).day())
    }

    /// Keeps the chosen time of day on the new day, then clamps to the future.
    private func selectDay(_ day: Date) {
        let calendar = Calendar.current
        let time = calendar.dateComponents([.hour, .minute], from: dueBackAt)
        var candidate = calendar.date(bySettingHour: time.hour ?? 17, minute: time.minute ?? 0, second: 0, of: day) ?? day
        if candidate <= Date() {
            candidate = KioskQuarterHour.roundedUp(Date().addingTimeInterval(60 * 60))
        }
        dueBackAt = candidate
    }

    private struct TimeChoice {
        let date: Date
        let title: String
        let note: String?
    }

    /// With a linked event: around 90 minutes after it ends, then the next
    /// morning, noon, and evening. Without one: the usual return times on the
    /// chosen day.
    private var timeChoices: [TimeChoice] {
        let calendar = Calendar.current
        let now = Date()
        func time(_ date: Date) -> String { date.formatted(.dateTime.hour().minute()) }
        if let event = selectedEvent, let end = event.endsAt ?? Optional(event.startsAt.addingTimeInterval(2 * 3600)) {
            let suggested = KioskQuarterHour.roundedUp(end.addingTimeInterval(KioskCheckoutDefaults.linkedEventReturnBuffer))
            var choices: [TimeChoice] = [-90, -60, -30, 0, 30].compactMap { minutes in
                let date = suggested.addingTimeInterval(TimeInterval(minutes * 60))
                guard date > now else { return nil }
                return TimeChoice(date: date, title: time(date), note: minutes == 0 ? "90 min after" : nil)
            }
            let nextDay = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: suggested) ?? suggested)
            for hour in [9, 12, 17] where choices.count < 8 {
                if let date = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: nextDay) {
                    choices.append(TimeChoice(date: date, title: "\(date.formatted(.dateTime.weekday(.abbreviated))) \(time(date))", note: nil))
                }
            }
            return choices
        }
        let day = calendar.startOfDay(for: dueBackAt)
        return [9, 12, 15, 17, 19, 21, 22, 23].compactMap { hour in
            guard let date = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day), date > now else { return nil }
            return TimeChoice(date: date, title: time(date), note: nil)
        }
    }
}

// MARK: - Due-time copy

enum KioskDueCopy {
    /// "Today at 6:00 PM", "Tomorrow at 11:00 PM", "Sat at 9:00 AM",
    /// "Tue, Sep 29 at 12:00 PM".
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        let time = date.formatted(.dateTime.hour().minute())
        if calendar.isDate(date, inSameDayAs: now) { return "Today at \(time)" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow at \(time)" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if (0..<7).contains(days) { return "\(date.formatted(.dateTime.weekday(.abbreviated))) at \(time)" }
        return "\(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) at \(time)"
    }

    /// "Due tomorrow at 11:00 PM".
    static func due(_ date: Date) -> String {
        let text = relative(date)
        return "Due " + text.prefix(1).lowercased() + text.dropFirst()
    }
}

// MARK: - Keyboard tip (I6)

/// Inline under the focused field while a scanner is paired and the
/// on-screen keyboard hasn't appeared; never a centered popup.
struct KioskKeyboardTip: View {
    let isFieldFocused: Bool
    @State private var keyboardVisible = false

    var body: some View {
        Group {
            if isFieldFocused && !keyboardVisible {
                HStack(spacing: 10) {
                    Image(systemName: "keyboard")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(KioskText.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("The scanner is acting as the keyboard")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(KioskText.primary)
                        Text("Double-tap its trigger to type here.")
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.tertiary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.lg, stroke: KioskStroke.strong)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
    }
}

// MARK: - Other date (D3)

struct KioskOtherDateSheet: View {
    let initial: Date
    let onCancel: () -> Void
    let onUse: (Date) -> Void

    @State private var day: Date
    @State private var hour: Int

    init(initial: Date, onCancel: @escaping () -> Void, onUse: @escaping (Date) -> Void) {
        self.initial = initial
        self.onCancel = onCancel
        self.onUse = onUse
        _day = State(initialValue: initial)
        _hour = State(initialValue: Calendar.current.component(.hour, from: initial))
    }

    private let hours = [9, 11, 12, 13, 15, 17, 19, 21]

    private var chosen: Date {
        Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
    }

    var body: some View {
        KioskSheetScreen(onDismiss: onCancel, contextWidth: 520) {
            DatePicker("Return date", selection: $day, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(KioskText.primary)
        } choice: {
            Text("Pick a date")
                .font(KioskType.heroAction)
                .foregroundStyle(KioskText.primary)
            Text("For anything past the next few days.")
                .font(KioskType.body)
                .foregroundStyle(KioskText.tertiary)
            KioskSectionHeader(title: "Time")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2), spacing: 8) {
                ForEach(hours, id: \.self) { value in
                    let date = Calendar.current.date(bySettingHour: value, minute: 0, second: 0, of: day) ?? day
                    KioskChoiceChip(title: date.formatted(.dateTime.hour().minute()), isSelected: hour == value) {
                        hour = value
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text("BACK BY")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskText.tertiary)
                Text(KioskDueCopy.relative(chosen))
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
            }
            KioskPrimaryPill(title: "Use this date", isEnabled: chosen > Date(), height: 64) { onUse(chosen) }
        }
    }
}
