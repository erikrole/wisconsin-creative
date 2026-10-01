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
    /// False until the person taps a return time (no default; Erik, 2026-10-01).
    var hasChosenReturn: Binding<Bool> = .constant(true)
    @Binding var focusedField: KioskCheckoutFocusedField?
    let canContinue: Bool
    let blockingRequirement: String?
    var continueTitle: String = "Continue to scan"
    /// Checkout opens on the person's next shift; the pickup editor already
    /// has its own linked event or name and passes false.
    let onContinue: () -> Void

    @State private var showOtherDate = KioskCaptureSeed.otherDate
    /// How far the software keyboard reaches up into the purpose column, in
    /// points. Zero whenever no software keyboard is on screen (including
    /// when a paired scanner is acting as the hardware keyboard).
    @State private var keyboardOverlap: CGFloat = 0
    @State private var purposeColumnBottom: CGFloat = 0
    @State private var showsPurposeField = false

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
                        hasChosenReturn.wrappedValue = true
                        showOtherDate = false
                    }
                )
                .transition(.opacity)
            }
        }
    }

    /// The event's end plus the usual buffer, on the quarter hour; nil when
    /// that time has already passed.
    static func suggestedReturn(for event: KioskCheckoutEvent) -> Date? {
        KioskCheckoutDefaults.dueBackDate(afterEventEndsAt: event.endsAt ?? event.startsAt.addingTimeInterval(2 * 3600))
    }

    private static func displayTitle(_ event: KioskCheckoutEvent) -> String {
        kioskEventDisplayTitle(event.title, sportCode: event.sportCode)
    }

    private static func isSport(_ event: KioskCheckoutEvent) -> Bool {
        !(event.sportCode?.trimmingCharacters(in: .whitespaces).isEmpty ?? true)
    }

    // MARK: What's this for?

    /// The "Something else" field sits under Your shifts, which on the
    /// 820 pt landscape kiosk can still be where the software keyboard lands.
    /// SwiftUI's own keyboard avoidance could not help: the right column's
    /// chips and Continue pill are taller than the space left above the keys,
    /// so the step overflowed (pushing the header off the top) instead of
    /// shrinking this scroll view, and the native text field was never
    /// scrolled into view anyway. So the step opts out of keyboard avoidance
    /// (see `KioskShellView`), and this column alone shortens its viewport
    /// by the keyboard's measured overlap and scrolls the field to sit
    /// directly above the keys.
    private static let purposeFieldID = "checkout-purpose-field"

    private var purposeColumn: some View {
        ScrollViewReader { proxy in
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
                somethingElse
                if !otherEvents.isEmpty {
                    KioskSectionHeader(title: shifts.isEmpty ? "Events" : "Other events")
                    ForEach(otherEvents.prefix(4)) { event in eventRow(event) }
                }
            }
            .padding(.top, 4)
            .padding(.bottom, KioskSpacing.md)
        }
        .scrollIndicators(.hidden)
        .padding(.bottom, keyboardOverlap)
        .onChange(of: focusedField) { _, field in
            if field == .customPurpose { revealPurposeField(proxy) }
        }
        .onChange(of: keyboardOverlap) { _, _ in
            if focusedField == .customPurpose { revealPurposeField(proxy) }
        }
        }
        .background(
            GeometryReader { geometry in
                Color.clear
                    .onAppear { purposeColumnBottom = geometry.frame(in: .global).maxY }
                    .onChange(of: geometry.frame(in: .global).maxY) { _, maxY in purposeColumnBottom = maxY }
            }
        )
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            keyboardOverlap = Self.overlap(keyboardTop: frame.minY, columnBottom: purposeColumnBottom)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardOverlap = 0
        }
    }

    /// The keyboard's end frame is in screen coordinates, which match SwiftUI's
    /// global space for the full-screen kiosk window. Keep a small gap so the
    /// field's card edge never touches the keys.
    private static func overlap(keyboardTop: CGFloat, columnBottom: CGFloat) -> CGFloat {
        guard columnBottom > 0 else { return 0 }
        let reach = columnBottom - keyboardTop
        return reach > 0 ? reach + KioskSpacing.sm : 0
    }

    private func revealPurposeField(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo(Self.purposeFieldID, anchor: .bottom)
        }
    }

    /// A compact row until tapped; then the typed field, focused.
    @ViewBuilder
    private var somethingElse: some View {
        if showsPurposeField || focusedField == .customPurpose || !customPurpose.isEmpty {
            KioskSectionHeader(title: "Something else")
            purposeField
                .id(Self.purposeFieldID)
            KioskKeyboardTip(isFieldFocused: focusedField == .customPurpose)
        } else {
            Button {
                showsPurposeField = true
                focusedField = .customPurpose
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(KioskText.secondary)
                        .frame(width: 22, height: 22)
                    Text("Something else…")
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.lg, stroke: KioskStroke.standard)
            }
            .buttonStyle(KioskPressStyle())
        }
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
                    Text(Self.displayTitle(event))
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
                        isSelected: hasChosenReturn.wrappedValue && abs(choice.date.timeIntervalSince(dueBackAt)) < 60
                    ) {
                        dueBackAt = choice.date
                        hasChosenReturn.wrappedValue = true
                    }
                }
            }
            backBySummary
            if let blockingRequirement, !canContinue {
                Text(blockingRequirement)
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                    .frame(maxWidth: .infinity)
            }
            KioskPrimaryPill(title: continueTitle, isEnabled: canContinue, action: onContinue)
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
    }

    /// What it's for, shown inside the Back by card ("FB vs Michigan State").
    private var choiceName: String? {
        if let selectedEvent { return Self.displayTitle(selectedEvent) }
        return customPurpose.trimmingCharacters(in: .whitespaces).nonBlankText
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
                Text(hasChosenReturn.wrappedValue ? KioskDueCopy.relative(dueBackAt) : "Pick a return time")
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(hasChosenReturn.wrappedValue ? KioskText.primary : KioskText.tertiary)
                // The day chips already show the date; name what it's for instead.
                Text(choiceName ?? dueBackAt.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
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

    /// With a linked event: "After the game" (or event) first, about 90
    /// minutes after it ends, then the usual return times on the chosen day.
    /// Without one: the usual return times alone.
    private var timeChoices: [TimeChoice] {
        let calendar = Calendar.current
        let now = Date()
        func time(_ date: Date) -> String { date.formatted(.dateTime.hour().minute()) }
        let day = calendar.startOfDay(for: dueBackAt)
        var fixed = [9, 12, 15, 17, 19, 21, 22, 23].compactMap { hour -> TimeChoice? in
            guard let date = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day), date > now else { return nil }
            return TimeChoice(date: date, title: time(date), note: nil)
        }
        guard let event = selectedEvent, let suggested = Self.suggestedReturn(for: event) else { return fixed }
        let eventEnd = event.endsAt ?? event.startsAt.addingTimeInterval(2 * 3600)
        fixed.removeAll { $0.date <= eventEnd }
        let after = TimeChoice(
            date: suggested,
            title: Self.isSport(event) ? "After the game" : "After the event",
            note: "~" + time(suggested)
        )
        fixed.removeAll { abs($0.date.timeIntervalSince(suggested)) < 60 }
        return [after] + fixed.prefix(7)
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
        "Due " + midSentence(date)
    }

    /// "tomorrow at 11:00 PM", for use after other words.
    static func midSentence(_ date: Date) -> String {
        // Only relative words drop their capital ("today", "tomorrow");
        // weekdays and months keep it ("Sat at 4:00 PM").
        let text = relative(date)
        for word in ["Today", "Tonight", "Tomorrow"] where text.hasPrefix(word) {
            return word.lowercased() + text.dropFirst(word.count)
        }
        return text
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

/// Canvas D3: a month grid on the left (past days dimmed, today ringed, the
/// chosen day solid white) and time chips on the right. Replaces the native
/// graphical picker, which ignored the kiosk's type scale and selection style.
struct KioskOtherDateSheet: View {
    let initial: Date
    let onCancel: () -> Void
    let onUse: (Date) -> Void

    @State private var day: Date
    @State private var hour: Int
    @State private var monthStart: Date

    init(initial: Date, onCancel: @escaping () -> Void, onUse: @escaping (Date) -> Void) {
        self.initial = initial
        self.onCancel = onCancel
        self.onUse = onUse
        let calendar = Calendar.current
        _day = State(initialValue: calendar.startOfDay(for: initial))
        let initialHour = calendar.component(.hour, from: initial)
        _hour = State(initialValue: Self.hours.contains(initialHour) ? initialHour : 12)
        _monthStart = State(initialValue: Self.startOfMonth(initial))
    }

    static let hours = [9, 11, 12, 13, 15, 17, 19, 21]

    private var chosen: Date {
        Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
    }

    var body: some View {
        KioskSheetScreen(onDismiss: onCancel, contextWidth: 400, height: 620) {
            KioskMonthGrid(monthStart: $monthStart, selectedDay: $day)
        } choice: {
            Text("When will it be back?")
                .font(KioskType.heroAction)
                .foregroundStyle(KioskText.primary)
            Text("Pick the day and time you'll return the gear.")
                .font(.system(size: 15))
                .foregroundStyle(KioskText.secondary)
            Text("RETURN TIME")
                .font(KioskType.overline)
                .tracking(KioskType.overlineTracking)
                .foregroundStyle(KioskText.tertiary)
                .padding(.horizontal, 2)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(Self.hours, id: \.self) { value in
                    let date = Calendar.current.date(bySettingHour: value, minute: 0, second: 0, of: day) ?? day
                    KioskTimeChip(
                        title: date.formatted(.dateTime.hour().minute()),
                        isSelected: hour == value,
                        isEnabled: date > Date()
                    ) { hour = value }
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("BACK BY")
                    .font(KioskType.overline)
                    .tracking(KioskType.overlineTracking)
                    .foregroundStyle(KioskText.tertiary)
                Text(chosen.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) + " at " + chosen.formatted(.dateTime.hour().minute()))
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .kioskCard(Color(red: 0x0E / 255, green: 0x0E / 255, blue: 0x10 / 255))
            Spacer(minLength: 8)
            KioskPrimaryPill(title: "Set return date", isEnabled: chosen > Date(), height: 64) { onUse(chosen) }
        }
    }

    static func startOfMonth(_ date: Date) -> Date {
        let calendar = Calendar.current
        return calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }
}

/// A 52pt-tall time chip with the canvas's 14pt corners; solid white when chosen.
private struct KioskTimeChip: View {
    let title: String
    let isSelected: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(isSelected ? KioskText.onPrimary : (isEnabled ? KioskText.primary : KioskText.muted))
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(isSelected ? KioskText.primary : KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
                .overlay(RoundedRectangle(cornerRadius: KioskRadius.lg).stroke(isSelected ? KioskStroke.selected : KioskStroke.standard, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: KioskRadius.lg))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

/// Six weeks from the Sunday on or before the first of `monthStart`. Days
/// before today are dimmed and can't be chosen; today carries a thin ring; the
/// first of the next month is labelled with its month so a grid that runs
/// into October reads correctly.
struct KioskMonthGrid: View {
    @Binding var monthStart: Date
    @Binding var selectedDay: Date

    private var calendar: Calendar { Calendar.current }
    private var today: Date { calendar.startOfDay(for: Date()) }

    private var days: [Date?] {
        let weekday = calendar.component(.weekday, from: monthStart) - calendar.firstWeekday
        let leading = (weekday + 7) % 7
        let count = calendar.range(of: .day, in: .month, for: monthStart)?.count ?? 30
        var cells: [Date?] = Array(repeating: nil, count: leading)
        for offset in 0..<count {
            cells.append(calendar.date(byAdding: .day, value: offset, to: monthStart))
        }
        // Finish the last week with the next month's first days.
        var next = calendar.date(byAdding: .month, value: 1, to: monthStart) ?? monthStart
        while cells.count % 7 != 0 {
            cells.append(next)
            next = calendar.date(byAdding: .day, value: 1, to: next) ?? next
        }
        return cells
    }

    private var title: String {
        monthStart.formatted(.dateTime.month(.wide).year())
    }

    private var canGoBack: Bool { monthStart > KioskOtherDateSheet.startOfMonth(today) }

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                monthButton("chevron.left", label: "Previous month", enabled: canGoBack) { step(-1) }
                Spacer()
                Text(title)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                Spacer()
                monthButton("chevron.right", label: "Next month", enabled: true) { step(1) }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 6) {
                ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                    Text(symbol)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(KioskText.tertiary)
                }
                ForEach(Array(days.enumerated()), id: \.offset) { _, date in
                    if let date { dayCell(date) } else { Color.clear.frame(height: 52) }
                }
            }
        }
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let first = calendar.firstWeekday - 1
        return Array(symbols[first...] + symbols[..<first])
    }

    private func dayCell(_ date: Date) -> some View {
        let isPast = date < today
        let isSelected = calendar.isDate(date, inSameDayAs: selectedDay)
        let isToday = calendar.isDate(date, inSameDayAs: today)
        let isNextMonth = !calendar.isDate(date, equalTo: monthStart, toGranularity: .month)
        return Button {
            selectedDay = date
        } label: {
            VStack(spacing: 0) {
                if isNextMonth && calendar.component(.day, from: date) == 1 {
                    Text(date.formatted(.dateTime.month(.abbreviated)).uppercased())
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(isSelected ? KioskText.onPrimaryDetail : KioskText.tertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Text("\(calendar.component(.day, from: date))")
                    .font(.system(size: 17, weight: .bold).monospacedDigit())
            }
            .foregroundStyle(isSelected ? KioskText.onPrimary : (isPast ? KioskText.onPrimaryDetail : KioskText.primary))
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(isSelected ? KioskText.primary : Color.clear, in: Capsule())
            .overlay(Capsule().stroke(isToday && !isSelected ? KioskText.muted : Color.clear, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isPast)
        .accessibilityLabel(date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private func monthButton(_ symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(enabled ? KioskText.primary : KioskText.muted)
                .frame(width: 44, height: 44)
                .background(KioskSurface.control, in: Circle())
                .overlay(Circle().stroke(KioskStroke.strong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func step(_ months: Int) {
        monthStart = calendar.date(byAdding: .month, value: months, to: monthStart) ?? monthStart
    }
}
