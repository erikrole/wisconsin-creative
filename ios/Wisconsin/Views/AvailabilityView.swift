import SwiftUI

private let availabilityDayNames = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]

private let availabilityShortDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/// Interactive editor for the weekly and one-time scheduling signals used by
/// Schedule assignment, open-shift, and trade eligibility surfaces.
struct AvailabilityView: View {
    let userId: String

    @State private var blocks: [AvailabilityBlock] = []
    @State private var selectedWeekday = Calendar.current.component(.weekday, from: .now) - 1
    @State private var isLoading = true
    @State private var error: String?
    @State private var editorContext: AvailabilityEditorContext?
    @State private var blockPendingDelete: AvailabilityBlock?

    private var selectedDayBlocks: [AvailabilityBlock] {
        blocks.filter { $0.isWeekly && $0.dayOfWeek == selectedWeekday }.sorted(by: sortBlocks)
    }

    private var datedBlocks: [AvailabilityBlock] {
        blocks.filter(\.isDated).sorted(by: sortBlocks)
    }

    var body: some View {
        ScrollView {
            if isLoading && blocks.isEmpty {
                AvailabilityLoadingState()
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            } else {
                LazyVStack(spacing: 16) {
                    if let error {
                        AvailabilityErrorBanner(message: error) {
                            Task { await load() }
                        } onDismiss: {
                            self.error = nil
                        }
                    }

                    availabilityOverview
                    weeklyCanvas
                    exceptionsCard
                    guidanceCard
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("My Availability")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        editorContext = .newWeekly(day: selectedWeekday)
                    } label: {
                        Label("Add Class Schedule…", systemImage: "calendar.badge.clock")
                    }
                    Button {
                        editorContext = .newException(date: .now)
                    } label: {
                        Label("Add Day Away…", systemImage: "calendar.badge.exclamationmark")
                    }
                } label: {
                    Label("Add availability", systemImage: "plus")
                }
                .accessibilityLabel("Add availability")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $editorContext) { context in
            AvailabilityEditorSheet(userId: userId, context: context) { saved in
                upsert(saved)
            }
        }
        .confirmationDialog(
            "Delete availability block?",
            isPresented: deleteConfirmationBinding,
            titleVisibility: .visible,
            presenting: blockPendingDelete
        ) { block in
            Button("Delete \(block.primaryLine)", role: .destructive) {
                Task { await delete(block) }
            }
            Button("Cancel", role: .cancel) {
                blockPendingDelete = nil
            }
        } message: { block in
            Text("Staff will no longer see \(block.primaryLine) when reviewing your availability.")
        }
    }

    private var availabilityOverview: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Your schedule signals")
                        .font(.headline)
                    Text("Add recurring class times, then flag days away as needed.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Image(systemName: "calendar.badge.clock")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.brandPrimary)
                    .accessibilityHidden(true)
            }

            ViewThatFits {
                HStack(spacing: 8) { availabilitySummaryItems }
                VStack(spacing: 8) { availabilitySummaryItems }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private var availabilitySummaryItems: some View {
        AvailabilitySummaryPill(
            title: "Time off",
            value: blocks.filter(\.isApprovedTimeOff).count,
            tone: .red
        )
        AvailabilitySummaryPill(
            title: "Advisory",
            value: blocks.filter(\.isAdvisory).count,
            tone: .orange
        )
        AvailabilitySummaryPill(
            title: "Preferred",
            value: blocks.filter(\.isPreference).count,
            tone: .green
        )
    }

    private var weeklyCanvas: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Weekly class schedule")
                    .font(.headline)
                Spacer()
                Text("Repeats every week")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            AvailabilityWeekStrip(
                selectedDay: $selectedWeekday,
                blocks: blocks.filter(\.isWeekly)
            )

            Divider()

            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(availabilityDayNames[selectedWeekday])
                        .font(.headline)
                    Text(selectedDayBlocks.isEmpty ? "No scheduling signals" : "\(selectedDayBlocks.count) saved \(selectedDayBlocks.count == 1 ? "window" : "windows")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    editorContext = .newWeekly(day: selectedWeekday)
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .buttonStyle(.bordered)
                .tint(Color.brandPrimary)
                .controlSize(.small)
            }

            if selectedDayBlocks.isEmpty {
                AvailabilityOpenDayState(day: availabilityDayNames[selectedWeekday]) {
                    editorContext = .newWeekly(day: selectedWeekday)
                }
            } else {
                VStack(spacing: 10) {
                    ForEach(selectedDayBlocks) { block in
                        AvailabilityBlockCard(
                            block: block,
                            onEdit: { editorContext = .edit(block) },
                            onDelete: { blockPendingDelete = block }
                        )
                    }
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    private var exceptionsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("One-off days and ranges")
                        .font(.headline)
                    Text("Trips, visitors, appointments, and other days away")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    editorContext = .newException(date: .now)
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .tint(Color.brandPrimary)
                .accessibilityLabel("Add day away")
            }

            if datedBlocks.isEmpty {
                Text("No one-time exceptions added.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 10) {
                    ForEach(datedBlocks) { block in
                        AvailabilityBlockCard(
                            block: block,
                            onEdit: { editorContext = .edit(block) },
                            onDelete: { blockPendingDelete = block }
                        )
                    }
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    private var guidanceCard: some View {
        Label {
            Text("Approved time off blocks shift pickup and trade actions. Other signals help staff schedule with better context.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } icon: {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(Color.statusText(.blue))
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 12)
    }

    private func sortBlocks(_ lhs: AvailabilityBlock, _ rhs: AvailabilityBlock) -> Bool {
        let lhsDate = lhs.dateValue ?? ""
        let rhsDate = rhs.dateValue ?? ""
        if lhsDate != rhsDate { return lhsDate < rhsDate }
        if lhs.startsAt != rhs.startsAt { return lhs.startsAt < rhs.startsAt }
        return lhs.endsAt < rhs.endsAt
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            blocks = try await APIClient.shared.availabilityBlocks(userId: userId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func upsert(_ block: AvailabilityBlock) {
        if let index = blocks.firstIndex(where: { $0.id == block.id }) {
            blocks[index] = block
        } else {
            blocks.append(block)
        }
        if let day = block.dayOfWeek { selectedWeekday = day }
    }

    private func delete(_ block: AvailabilityBlock) async {
        do {
            try await APIClient.shared.deleteAvailabilityBlock(userId: userId, blockId: block.id)
            blocks.removeAll { $0.id == block.id }
            blockPendingDelete = nil
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            blockPendingDelete = nil
            Haptics.warning()
        }
    }

    private var deleteConfirmationBinding: Binding<Bool> {
        Binding(
            get: { blockPendingDelete != nil },
            set: { if !$0 { blockPendingDelete = nil } }
        )
    }
}

private struct AvailabilityLoadingState: View {
    var body: some View {
        VStack(spacing: 16) {
            ForEach([120, 260, 150], id: \.self) { height in
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(.secondarySystemGroupedBackground))
                    .frame(height: CGFloat(height))
                    .overlay(alignment: .topLeading) {
                        VStack(alignment: .leading, spacing: 10) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color(.tertiarySystemFill))
                                .frame(width: 140, height: 18)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color(.tertiarySystemFill))
                                .frame(width: 220, height: 12)
                        }
                        .padding(16)
                    }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading availability")
    }
}

private struct AvailabilityWeekStrip: View {
    @Binding var selectedDay: Int
    let blocks: [AvailabilityBlock]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { day in
                let dayBlocks = blocks.filter { $0.dayOfWeek == day }
                Button {
                    selectedDay = day
                    Haptics.selection()
                } label: {
                    VStack(spacing: 7) {
                        Text(availabilityShortDayNames[day])
                            .font(.caption2.weight(.semibold))
                        ZStack {
                            Circle()
                                .fill(day == selectedDay ? Color.brandPrimary : Color(.tertiarySystemFill))
                            Text("\(dayBlocks.count)")
                                .font(.caption.weight(.bold).monospacedDigit())
                                .foregroundStyle(day == selectedDay ? Color.white : Color.primary)
                        }
                        .frame(width: 30, height: 30)
                    }
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(availabilityDayNames[day]), \(dayBlocks.count) availability \(dayBlocks.count == 1 ? "window" : "windows")")
                .accessibilityAddTraits(day == selectedDay ? .isSelected : [])
            }
        }
    }
}

private struct AvailabilitySummaryPill: View {
    let title: String
    let value: Int
    let tone: StatusTone

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(Color.statusText(tone))
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text("\(value)")
                .font(.caption.weight(.bold).monospacedDigit())
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Color.statusBackground(tone), in: Capsule())
    }
}

private struct AvailabilityOpenDayState: View {
    let day: String
    let onAdd: () -> Void

    var body: some View {
        Button(action: onAdd) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(.green))
                VStack(alignment: .leading, spacing: 2) {
                    Text("No limits saved")
                        .font(.subheadline.weight(.semibold))
                    Text("Add a preferred or unavailable window for \(day).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(12)
            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

private struct AvailabilityBlockCard: View {
    let block: AvailabilityBlock
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onEdit) {
                HStack(alignment: .top, spacing: 12) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.statusText(block.intentMetadata.tone))
                        .frame(width: 4)
                        .padding(.vertical, 2)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(block.primaryLine)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                            Spacer(minLength: 8)
                            Text(block.intentMetadata.label)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Color.statusText(block.intentMetadata.tone))
                        }
                        Text(block.secondaryLine)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let statusLine = block.statusLine {
                            Text(statusLine)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Color.statusText(block.statusTone))
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Menu {
                Button("Edit…", systemImage: "pencil", action: onEdit)
                Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 36, height: 44)
            }
            .accessibilityLabel("Actions for \(block.primaryLine)")
        }
        .padding(12)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .contain)
    }
}

private struct AvailabilityErrorBanner: View {
    let message: String
    let onRetry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
            Text(message)
                .font(.footnote)
                .lineLimit(2)
            Spacer(minLength: 8)
            Button("Retry", action: onRetry)
                .font(.footnote.weight(.semibold))
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Dismiss availability error")
        }
        .padding(12)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct AvailabilityEditorContext: Identifiable {
    let id: String
    let block: AvailabilityBlock?
    let suggestedKind: AvailabilityEditorKind
    let suggestedDay: Int
    let suggestedDate: Date

    static func newWeekly(day: Int) -> Self {
        Self(id: UUID().uuidString, block: nil, suggestedKind: .weekly, suggestedDay: day, suggestedDate: .now)
    }

    static func newException(date: Date) -> Self {
        Self(
            id: UUID().uuidString,
            block: nil,
            suggestedKind: .adHoc,
            suggestedDay: Calendar.current.component(.weekday, from: date) - 1,
            suggestedDate: date
        )
    }

    static func edit(_ block: AvailabilityBlock) -> Self {
        Self(
            id: block.id,
            block: block,
            suggestedKind: block.isDated ? .adHoc : .weekly,
            suggestedDay: block.dayOfWeek ?? 1,
            suggestedDate: block.parsedDate ?? .now
        )
    }
}

private struct AvailabilityEditorSheet: View {
    let userId: String
    let context: AvailabilityEditorContext
    let onSaved: (AvailabilityBlock) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind: AvailabilityEditorKind
    @State private var intent: AvailabilityEditorIntent
    @State private var dayOfWeek: Int
    @State private var date: Date
    @State private var dateEnd: Date
    @State private var isDateRange: Bool
    @State private var allDay: Bool
    @State private var startMinutes: Int
    @State private var endMinutes: Int
    @State private var label: String
    @State private var usesTermDates: Bool
    @State private var termStartDate: Date
    @State private var termEndDate: Date
    @State private var semesterLabel: String
    @State private var isSaving = false
    @State private var error: String?

    init(userId: String, context: AvailabilityEditorContext, onSaved: @escaping (AvailabilityBlock) -> Void) {
        self.userId = userId
        self.context = context
        self.onSaved = onSaved
        let block = context.block
        _kind = State(initialValue: block?.editorKind ?? context.suggestedKind)
        _intent = State(initialValue: block?.editorIntent ?? .cannotWork)
        _dayOfWeek = State(initialValue: block?.dayOfWeek ?? context.suggestedDay)
        _date = State(initialValue: block?.parsedDate ?? context.suggestedDate)
        _dateEnd = State(initialValue: block?.parsedDateEndsOn ?? block?.parsedDate ?? context.suggestedDate)
        _isDateRange = State(initialValue: {
            guard let start = block?.parsedDate, let end = block?.parsedDateEndsOn else { return false }
            return !Calendar.current.isDate(start, inSameDayAs: end)
        }())
        _allDay = State(initialValue: block?.allDay == true)
        _startMinutes = State(initialValue: Self.minutes(block?.startsAt) ?? 9 * 60)
        _endMinutes = State(initialValue: Self.minutes(block?.endsAt) ?? 10 * 60)
        _label = State(initialValue: block?.label ?? "")
        _usesTermDates = State(initialValue: block?.semesterStartsOn != nil || block?.semesterEndsOn != nil)
        _termStartDate = State(initialValue: block?.parsedSemesterStart ?? context.suggestedDate)
        _termEndDate = State(initialValue: block?.parsedSemesterEnd ?? Calendar.current.date(byAdding: .month, value: 4, to: context.suggestedDate) ?? context.suggestedDate)
        _semesterLabel = State(initialValue: block?.semesterLabel ?? "")
    }

    private var timeOptions: [Int] {
        Array(Set(Array(stride(from: 0, through: 23 * 60 + 45, by: 15)) + [startMinutes, endMinutes])).sorted()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Signal") {
                    Picker("Type", selection: $intent) {
                        ForEach(AvailabilityEditorIntent.allCases) { option in
                            Label(option.label, systemImage: option.systemImage).tag(option)
                        }
                    }
                    Text(intent.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("When") {
                    Picker("Repeats", selection: kindSelection) {
                        ForEach(AvailabilityEditorKind.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)

                    if kind == .weekly {
                        Picker("Day", selection: $dayOfWeek) {
                            ForEach(0..<7, id: \.self) { Text(availabilityDayNames[$0]).tag($0) }
                        }
                    } else {
                        DatePicker("From", selection: $date, displayedComponents: .date)
                        Toggle("Multiple days", isOn: $isDateRange)
                        if isDateRange {
                            DatePicker("Through", selection: $dateEnd, displayedComponents: .date)
                        }
                        Toggle("All day", isOn: $allDay)
                        if allDay {
                            Text(intent.allDayDetail)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if kind == .weekly || !allDay {
                    Section("Time") {
                        Picker("Starts", selection: $startMinutes) {
                            ForEach(timeOptions, id: \.self) { minutes in
                                Text(Self.timeLabel(minutes)).tag(minutes)
                            }
                        }
                        Picker("Ends", selection: $endMinutes) {
                            ForEach(timeOptions, id: \.self) { minutes in
                                Text(Self.timeLabel(minutes)).tag(minutes)
                            }
                        }
                    }
                }

                if kind == .weekly {
                    Section {
                        Toggle("Limit to term dates", isOn: $usesTermDates)
                        if usesTermDates {
                            TextField("Term name (optional)", text: $semesterLabel)
                            DatePicker("Starts", selection: $termStartDate, displayedComponents: .date)
                            DatePicker("Ends", selection: $termEndDate, displayedComponents: .date)
                        }
                    } header: {
                        Text("Class term (optional)")
                    } footer: {
                        Text("Use this when the class only blocks work during a specific semester or session.")
                    }
                }

                Section {
                    TextField(intent.labelPlaceholder, text: $label)
                } footer: {
                    if kind == .weekly {
                        Text(usesTermDates ? "Repeats every \(availabilityDayNames[dayOfWeek]) during the selected term." : "Repeats every \(availabilityDayNames[dayOfWeek]) until you remove it.")
                    } else if isDateRange {
                        Text("Applies to every selected date in the range.")
                    } else {
                        Text("Applies only to the selected date.")
                    }
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
            }
            .navigationTitle(context.block == nil ? (kind == .weekly ? "Add Class Schedule" : "Add Day Away") : "Edit Availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text(context.block == nil ? "Add" : "Save").fontWeight(.semibold)
                        }
                    }
                    .tint(Color.brandPrimary)
                    .disabled(isSaving)
                }
            }
            .interactiveDismissDisabled(isSaving)
            .onChange(of: startMinutes) { _, newValue in
                adjustEndTime(after: newValue)
            }
            .onChange(of: date) { _, newValue in
                if dateEnd < newValue {
                    dateEnd = newValue
                }
            }
            .onChange(of: termStartDate) { _, newValue in
                if termEndDate < newValue {
                    termEndDate = newValue
                }
            }
        }
    }

    private var kindSelection: Binding<AvailabilityEditorKind> {
        Binding(
            get: { kind },
            set: { newValue in
                kind = newValue
                if newValue == .weekly {
                    isDateRange = false
                    allDay = false
                }
            }
        )
    }

    private func adjustEndTime(after newValue: Int) {
        guard endMinutes <= newValue else { return }
        let proposedEnd = newValue + 60
        let latestEnd = 23 * 60 + 45
        endMinutes = proposedEnd > latestEnd ? latestEnd : proposedEnd
    }

    private func save() async {
        guard allDay || startMinutes < endMinutes else {
            error = "Start time must be before end time"
            Haptics.warning()
            return
        }
        if kind == .adHoc && isDateRange && dateEnd < date {
            error = "The through date must be on or after the from date"
            Haptics.warning()
            return
        }
        if kind == .weekly && usesTermDates && termEndDate < termStartDate {
            error = "The term end date must be on or after the start date"
            Haptics.warning()
            return
        }
        isSaving = true
        error = nil
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSemesterLabel = semesterLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let startsAt = kind == .adHoc && allDay ? "00:00" : Self.hhmm(startMinutes)
        let endsAt = kind == .adHoc && allDay ? "23:59" : Self.hhmm(endMinutes)
        let startDate = kind == .adHoc ? Self.yyyyMMdd(date) : nil
        let endDate = kind == .adHoc ? Self.yyyyMMdd(isDateRange ? dateEnd : date) : nil
        let termLabel = kind == .weekly && usesTermDates && !trimmedSemesterLabel.isEmpty ? trimmedSemesterLabel : nil
        let termStart = kind == .weekly && usesTermDates ? Self.yyyyMMdd(termStartDate) : nil
        let termEnd = kind == .weekly && usesTermDates ? Self.yyyyMMdd(termEndDate) : nil
        do {
            let saved: AvailabilityBlock
            if let block = context.block {
                saved = try await APIClient.shared.updateAvailabilityBlock(
                    userId: userId,
                    blockId: block.id,
                    kind: kind.rawValue,
                    intent: intent.rawValue,
                    dayOfWeek: dayOfWeek,
                    date: startDate,
                    dateEndsOn: endDate,
                    allDay: kind == .adHoc && allDay,
                    startsAt: startsAt,
                    endsAt: endsAt,
                    label: trimmed.isEmpty ? nil : trimmed,
                    semesterLabel: termLabel,
                    semesterStartsOn: termStart,
                    semesterEndsOn: termEnd
                )
            } else {
                saved = try await APIClient.shared.createAvailabilityBlock(
                    userId: userId,
                    kind: kind.rawValue,
                    intent: intent.rawValue,
                    dayOfWeek: dayOfWeek,
                    date: startDate,
                    dateEndsOn: endDate,
                    allDay: kind == .adHoc && allDay,
                    startsAt: startsAt,
                    endsAt: endsAt,
                    label: trimmed.isEmpty ? nil : trimmed,
                    semesterLabel: termLabel,
                    semesterStartsOn: termStart,
                    semesterEndsOn: termEnd
                )
            }
            onSaved(saved)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        isSaving = false
    }

    private static func minutes(_ value: String?) -> Int? {
        guard let value else { return nil }
        let parts = value.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    private static func hhmm(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    private static func timeLabel(_ minutes: Int) -> String {
        let date = Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: .now) ?? .now
        return date.formatted(date: .omitted, time: .shortened)
    }

    private static func yyyyMMdd(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private enum AvailabilityEditorKind: String, CaseIterable, Identifiable {
    case weekly = "WEEKLY"
    case adHoc = "AD_HOC"

    var id: String { rawValue }
    var label: String { self == .weekly ? "Weekly" : "One-time" }
}

private enum AvailabilityEditorIntent: String, CaseIterable, Identifiable {
    case cannotWork = "CANNOT_WORK"
    case prefer = "PREFER"
    case dislike = "DISLIKE"
    case timeOff = "TIME_OFF"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .cannotWork: "Cannot work"
        case .prefer: "Prefer"
        case .dislike: "Avoid if possible"
        case .timeOff: "Time off"
        }
    }

    var detail: String {
        switch self {
        case .cannotWork: "Warns staff that you are unavailable during this window."
        case .prefer: "Helps staff spot shifts you would like to work."
        case .dislike: "Marks this window as less ideal without blocking assignment."
        case .timeOff: "Requests time off. Approved time off blocks pickup and trade actions."
        }
    }

    var allDayDetail: String {
        switch self {
        case .cannotWork: "Use this for travel, visitors, or any day you cannot work at all."
        case .prefer: "Marks the entire day as preferred when staff are choosing coverage."
        case .dislike: "Marks the entire day as less ideal without blocking assignment."
        case .timeOff: "Requests the entire day off for staff review."
        }
    }

    var labelPlaceholder: String {
        switch self {
        case .cannotWork: "Label (optional), e.g. CHEM 101"
        case .prefer: "Label (optional), e.g. Prefer photo shifts"
        case .dislike: "Label (optional), e.g. Lab conflict"
        case .timeOff: "Reason (optional), e.g. Family trip"
        }
    }

    var systemImage: String {
        switch self {
        case .cannotWork: "calendar.badge.exclamationmark"
        case .prefer: "checkmark.circle"
        case .dislike: "exclamationmark.triangle"
        case .timeOff: "hand.raised"
        }
    }
}

private struct AvailabilityIntentMetadata {
    let label: String
    let tone: StatusTone
}

private extension AvailabilityBlock {
    var normalizedKind: String { kind ?? "WEEKLY" }
    var normalizedIntent: String { intent ?? "CANNOT_WORK" }
    var normalizedStatus: String { status ?? "APPROVED" }
    var editorKind: AvailabilityEditorKind { normalizedKind == "AD_HOC" ? .adHoc : .weekly }
    var editorIntent: AvailabilityEditorIntent { AvailabilityEditorIntent(rawValue: normalizedIntent) ?? .cannotWork }

    var isWeekly: Bool { normalizedKind != "AD_HOC" && dayOfWeek != nil }
    var isDated: Bool { normalizedKind == "AD_HOC" || dateValue != nil }
    var isApprovedTimeOff: Bool { normalizedIntent == "TIME_OFF" && normalizedStatus == "APPROVED" }
    var isPreference: Bool { normalizedIntent == "PREFER" }

    var isAdvisory: Bool {
        normalizedIntent == "CANNOT_WORK" || normalizedIntent == "DISLIKE" ||
            (normalizedIntent == "TIME_OFF" && normalizedStatus == "PENDING")
    }

    var intentMetadata: AvailabilityIntentMetadata {
        switch normalizedIntent {
        case "PREFER": AvailabilityIntentMetadata(label: "Prefer", tone: .green)
        case "DISLIKE": AvailabilityIntentMetadata(label: "Avoid", tone: .orange)
        case "TIME_OFF": AvailabilityIntentMetadata(label: "Time off", tone: statusTone)
        default: AvailabilityIntentMetadata(label: "Cannot work", tone: .orange)
        }
    }

    var statusTone: StatusTone {
        switch normalizedStatus {
        case "APPROVED": normalizedIntent == "TIME_OFF" ? .red : .green
        case "PENDING": .orange
        default: .gray
        }
    }

    var primaryLine: String {
        if let label, !label.isEmpty { return label }
        return intentMetadata.label
    }

    var secondaryLine: String {
        var parts: [String] = []
        if let displayDateRange { parts.append(displayDateRange) }
        if normalizedAllDay {
            parts.append("All day")
        } else {
            parts.append("\(displayTime(startsAt)) to \(displayTime(endsAt))")
        }
        if let semesterLabel, !semesterLabel.isEmpty { parts.append(semesterLabel) }
        return parts.joined(separator: " · ")
    }

    var statusLine: String? {
        guard normalizedIntent == "TIME_OFF" else { return nil }
        return switch normalizedStatus {
        case "APPROVED": "Approved time off"
        case "PENDING": "Pending staff review"
        case "DENIED": "Denied"
        default: nil
        }
    }

    var dateValue: String? {
        guard let date, !date.isEmpty else { return nil }
        return date.count >= 10 ? String(date.prefix(10)) : date
    }

    var dateEndValue: String? {
        guard let dateEndsOn, !dateEndsOn.isEmpty else { return dateValue }
        return dateEndsOn.count >= 10 ? String(dateEndsOn.prefix(10)) : dateEndsOn
    }

    var normalizedAllDay: Bool { allDay == true }

    private func parsedDateValue(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(value.prefix(10)))
    }

    var parsedDate: Date? {
        parsedDateValue(dateValue)
    }

    var parsedDateEndsOn: Date? {
        parsedDateValue(dateEndValue)
    }

    var parsedSemesterStart: Date? {
        parsedDateValue(semesterStartsOn)
    }

    var parsedSemesterEnd: Date? {
        parsedDateValue(semesterEndsOn)
    }

    var displayDate: String? {
        guard let parsedDate else { return dateValue }
        return formatDisplayDate(parsedDate)
    }

    var displayDateRange: String? {
        guard let parsedDate else { return dateValue }
        guard let parsedDateEndsOn,
              !Calendar.current.isDate(parsedDate, inSameDayAs: parsedDateEndsOn)
        else { return formatDisplayDate(parsedDate) }
        return "\(formatDisplayDate(parsedDate)) – \(formatDisplayDate(parsedDateEndsOn))"
    }

    private func formatDisplayDate(_ date: Date) -> String {
        if Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: .now) {
            return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
    }

    private func displayTime(_ value: String) -> String {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2,
              let date = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: .now)
        else { return value }
        return date.formatted(date: .omitted, time: .shortened)
    }
}
