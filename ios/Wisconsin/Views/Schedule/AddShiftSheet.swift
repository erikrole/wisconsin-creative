import SwiftUI

/// STAFF/ADMIN authoring flow for adding one open slot to an event.
struct AddShiftSheet: View {
    let shiftGroupId: String
    let expectedWorkingVersion: Int
    let eventTitle: String
    let defaultStart: Date
    let defaultEnd: Date
    /// All-day events carry no call time, so the custom window is not offered.
    var isAllDay = false
    let onAdded: (WorkingScheduleEditor) -> Void
    /// The crew as it stands, so each area chip can show how full it is.
    var existingShifts: [EventShift] = []
    /// Reloads the crew after another session changed it and returns the new
    /// draft version, so a conflicted add retries once.
    var refreshWorkingVersion: (() async -> Int?)?
    @State private var workingVersionOverride: Int?

    @Environment(\.dismiss) private var dismiss
    @State private var area: ShiftAreaOption
    @State private var workerType: ShiftWorkerOption
    @State private var preset: CallPreset = .event
    @State private var count = 1
    @State private var startsAt: Date
    @State private var endsAt: Date
    @State private var isSubmitting = false
    @State private var error: String?

    init(
        shiftGroupId: String,
        expectedWorkingVersion: Int = 0,
        eventTitle: String,
        defaultStart: Date,
        defaultEnd: Date,
        isAllDay: Bool = false,
        existingShifts: [EventShift] = [],
        onAdded: @escaping (WorkingScheduleEditor) -> Void,
        refreshWorkingVersion: (() async -> Int?)? = nil
    ) {
        self.existingShifts = existingShifts
        // Last area and worker class used: adding crew is repetitive, so start
        // where the last person left off.
        let defaults = UserDefaults.standard
        _area = State(initialValue: defaults.string(forKey: "addShift.lastArea").flatMap(ShiftAreaOption.init(rawValue:)) ?? .video)
        _workerType = State(initialValue: defaults.string(forKey: "addShift.lastWorker").flatMap(ShiftWorkerOption.init(rawValue:)) ?? .student)
        self.shiftGroupId = shiftGroupId
        self.expectedWorkingVersion = expectedWorkingVersion
        self.eventTitle = eventTitle
        self.defaultStart = defaultStart
        self.defaultEnd = defaultEnd
        self.isAllDay = isAllDay
        self.onAdded = onAdded
        self.refreshWorkingVersion = refreshWorkingVersion
        _startsAt = State(initialValue: defaultStart)
        _endsAt = State(initialValue: defaultEnd)
    }

    private var customizeTimes: Bool { preset != .event }

    private func fill(for option: ShiftAreaOption) -> String? {
        let slots = existingShifts.filter { $0.area == option.rawValue }
        guard !slots.isEmpty else { return nil }
        let filled = slots.filter { !$0.assignments.isEmpty }.count
        return "\(filled)/\(slots.count)"
    }

    private var hasValidWindow: Bool {
        workerType == .fullTime || !customizeTimes || endsAt > startsAt
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    contextCard
                    slotCard
                    if workerType == .student {
                        if !isAllDay { scheduleCard }
                    } else {
                        staffScheduleCard
                    }

                    if let error {
                        authoringError(message: error)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Add Shift")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSubmitting)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await submit() }
                } label: {
                    HStack(spacing: 8) {
                        if isSubmitting {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "plus")
                        }
                        Text(count == 1 ? "Add \(area.label) Shift" : "Add \(count) \(area.label) Shifts")
                            .font(.headline)
                    }
                    .foregroundStyle(isSubmitting || hasValidWindow ? Color.white : Color.secondary)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(
                        hasValidWindow ? Color.statusText(.purple) : Color(.tertiarySystemFill),
                        in: RoundedRectangle(cornerRadius: 16)
                    )
                }
                .buttonStyle(.plain)
                .disabled(isSubmitting || !hasValidWindow)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .interactiveDismissDisabled(isSubmitting)
        }
        .presentationDetents([.large])
        .onChange(of: workerType) { _, next in
            if next == .fullTime { preset = .event }
        }
    }

    private var contextCard: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(eventTitle)
                    .font(.headline)
                    .lineLimit(2)
                Text(defaultWindowText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var slotCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Open Slot")
                .font(.headline)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(ShiftAreaOption.allCases, id: \.self) { option in
                    ChipButton(
                        title: option.label,
                        systemImage: option.systemImage,
                        detail: fill(for: option),
                        isSelected: area == option,
                        tint: Color.statusText(.purple)
                    ) {
                        withAnimation(.easeInOut(duration: 0.16)) { area = option }
                        Haptics.selection()
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Worker Class")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Picker("Worker class", selection: $workerType) {
                    ForEach(ShiftWorkerOption.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            Divider()

            HStack {
                Text("How many")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                ReservationQuantityStepper(
                    value: count,
                    range: 1...6,
                    label: "Number of slots",
                    onIncrement: { count = min(6, count + 1) },
                    onDecrement: { count = max(1, count - 1) }
                )
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Call Window")
                    .font(.headline)
                Text(preset == .event ? "Uses the configured call time" : "Custom for this shift")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(CallPreset.allCases, id: \.self) { option in
                    ChipButton(
                        title: option.title,
                        isSelected: preset == option,
                        tint: Color.statusText(.purple)
                    ) {
                        preset = option
                        Haptics.selection()
                    }
                }
            }

            if preset == .custom {
                Divider()
                ShiftDateTimeRow(label: "Call", systemImage: "arrow.right", date: $startsAt)
                Divider()
                ShiftDateTimeRow(label: "End", systemImage: "arrow.left", date: $endsAt)

                if !hasValidWindow {
                    Label("End time must be after call time.", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.red))
                }
            } else if let lead = preset.leadMinutes {
                Label(
                    "\(shortDate(defaultStart)) · \(roundedToQuarterHour(defaultStart.addingTimeInterval(-Double(lead) * 60)).formatted(date: .omitted, time: .shortened)) to \(defaultEnd.formatted(date: .omitted, time: .shortened))",
                    systemImage: "clock"
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            } else {
                Label(defaultWindowText, systemImage: defaultsToAllDayWindow ? "calendar" : "clock")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .onChange(of: preset) { _, next in
            if let lead = next.leadMinutes {
                startsAt = roundedToQuarterHour(defaultStart.addingTimeInterval(-Double(lead) * 60))
                endsAt = roundedToQuarterHour(defaultEnd)
            } else if next == .custom, startsAt == defaultStart {
                startsAt = roundedToQuarterHour(defaultStart)
                endsAt = roundedToQuarterHour(defaultEnd)
            }
        }
    }

    private var staffScheduleCard: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text("Event time").font(.headline)
                Text("Staff and collaborators do not have a separate call time.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "calendar.badge.clock")
                .foregroundStyle(Color.statusText(.purple))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private func authoringError(message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
            VStack(alignment: .leading, spacing: 4) {
                Text("Couldn't add shift")
                    .font(.subheadline.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Dismiss") { error = nil }
                .font(.caption.weight(.semibold))
        }
        .padding(14)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
    }

    private func submit() async {
        guard !isSubmitting, hasValidWindow else { return }
        isSubmitting = true
        error = nil
        defer { isSubmitting = false }
        var version = workingVersionOverride ?? expectedWorkingVersion
        var canRetryConflict = refreshWorkingVersion != nil
        var lastEditor: WorkingScheduleEditor?
        var added = 0

        /// One slot, retrying once if another session moved the crew version.
        func addOne() async throws -> WorkingScheduleEditor {
            while true {
                do {
                    return try await APIClient.shared.addWorkingScheduleSlot(
                        shiftGroupId: shiftGroupId,
                        expectedVersion: version,
                        area: area.rawValue,
                        workerType: workerType.rawValue,
                        callStartsAt: workerType == .student && customizeTimes ? startsAt : nil,
                        callEndsAt: workerType == .student && customizeTimes ? endsAt : nil
                    )
                } catch APIError.conflict {
                    // Another session edited the crew: retry once against
                    // the new version, then surface a second conflict.
                    guard canRetryConflict, let refreshWorkingVersion,
                          let refreshed = await refreshWorkingVersion() else { throw APIError.conflict("Someone else changed this crew. Close this sheet and try again.") }
                    canRetryConflict = false
                    version = refreshed
                    workingVersionOverride = refreshed
                }
            }
        }

        do {
            for _ in 0..<count {
                let editor = try await addOne()
                lastEditor = editor
                version = editor.workingVersion
                added += 1
            }
            UserDefaults.standard.set(area.rawValue, forKey: "addShift.lastArea")
            UserDefaults.standard.set(workerType.rawValue, forKey: "addShift.lastWorker")
            Haptics.success()
            if let lastEditor { onAdded(lastEditor) }
            dismiss()
        } catch {
            // Slots already added stay added: hand the crew back so the screen
            // shows them, and say how far this got.
            if let lastEditor { onAdded(lastEditor) }
            self.error = added > 0
                ? "Added \(added) of \(count). \(error.localizedDescription)"
                : error.localizedDescription
            Haptics.warning()
        }
    }

    private var defaultsToAllDayWindow: Bool {
        let calendar = Calendar.current
        return calendar.compare(defaultStart, to: calendar.startOfDay(for: defaultStart), toGranularity: .minute) == .orderedSame
            && calendar.compare(defaultEnd, to: calendar.startOfDay(for: defaultEnd), toGranularity: .minute) == .orderedSame
            && defaultEnd > defaultStart
    }

    private var defaultWindowText: String {
        if defaultsToAllDayWindow {
            let inclusiveEnd = Calendar.current.date(byAdding: .day, value: -1, to: defaultEnd) ?? defaultEnd
            if Calendar.current.isDate(defaultStart, inSameDayAs: inclusiveEnd) {
                return "All day · \(shortDate(defaultStart))"
            }
            return "All day · \(shortDate(defaultStart)) to \(shortDate(inclusiveEnd))"
        }
        return "\(shortDate(defaultStart)) · \(defaultStart.formatted(date: .omitted, time: .shortened)) to \(defaultEnd.formatted(date: .omitted, time: .shortened))"
    }

    private func shortDate(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.component(.year, from: date) == calendar.component(.year, from: .now) {
            return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
    }

    private func roundedToQuarterHour(_ date: Date) -> Date {
        let interval = 15.0 * 60.0
        return Date(timeIntervalSince1970: (date.timeIntervalSince1970 / interval).rounded() * interval)
    }
}

enum CallPreset: CaseIterable {
    case event, before30, before60, before120, custom

    var title: String {
        switch self {
        case .event: "Event time"
        case .before30: "30 min before"
        case .before60: "1 hr before"
        case .before120: "2 hr before"
        case .custom: "Custom"
        }
    }

    var leadMinutes: Int? {
        switch self {
        case .before30: 30
        case .before60: 60
        case .before120: 120
        default: nil
        }
    }
}

struct ShiftDateTimeRow: View {
    let label: String
    let systemImage: String
    @Binding var date: Date

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .frame(width: 22)
                .foregroundStyle(Color.statusText(.purple))
                .accessibilityHidden(true)
            Text(label)
                .font(.subheadline.weight(.semibold))
            Spacer(minLength: 8)
            QuarterHourDateTimeControls(
                label: label,
                selection: $date,
                tint: Color.statusText(.purple)
            )
        }
    }
}

enum ShiftAreaOption: String, CaseIterable {
    case video = "VIDEO"
    case photo = "PHOTO"
    case graphics = "GRAPHICS"
    case social = "SOCIAL"
    case comms = "COMMS"
    // The server's `ShiftArea` enum and the web's `AREA_LABELS` both carry this
    // one; the native picker stopped at Comms, so a Live Production shift could
    // not be created from the app at all.
    case liveProduction = "LIVE_PRODUCTION"

    var label: String {
        switch self {
        case .video: "Video"
        case .photo: "Photo"
        case .graphics: "Graphics"
        case .social: "Social"
        case .comms: "Comms"
        case .liveProduction: "Live Production"
        }
    }

    var systemImage: String {
        switch self {
        case .video: "video.fill"
        case .photo: "camera.fill"
        case .graphics: "paintbrush.fill"
        case .social: "person.2.fill"
        case .comms: "wave.3.right"
        case .liveProduction: "dot.radiowaves.left.and.right"
        }
    }
}

enum ShiftWorkerOption: String, CaseIterable {
    case student = "ST"
    case fullTime = "FT"

    var label: String {
        switch self {
        case .student: "Student"
        case .fullTime: "Staff"
        }
    }
}
