import SwiftUI

/// STAFF/ADMIN authoring flow for adding one open slot to an event.
struct AddShiftSheet: View {
    let shiftGroupId: String
    let expectedWorkingVersion: Int
    let eventTitle: String
    let defaultStart: Date
    let defaultEnd: Date
    let onAdded: (WorkingScheduleEditor) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var area: ShiftAreaOption = .video
    @State private var workerType: ShiftWorkerOption = .student
    @State private var customizeTimes = false
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
        onAdded: @escaping (WorkingScheduleEditor) -> Void
    ) {
        self.shiftGroupId = shiftGroupId
        self.expectedWorkingVersion = expectedWorkingVersion
        self.eventTitle = eventTitle
        self.defaultStart = defaultStart
        self.defaultEnd = defaultEnd
        self.onAdded = onAdded
        _startsAt = State(initialValue: defaultStart)
        _endsAt = State(initialValue: defaultEnd)
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
                        scheduleCard
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
                        Text("Add \(area.label) Shift")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.purple))
                .controlSize(.large)
                .disabled(isSubmitting || !hasValidWindow)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .interactiveDismissDisabled(isSubmitting)
        }
        .presentationDetents([.large])
        .onChange(of: workerType) { _, next in
            if next == .fullTime { customizeTimes = false }
        }
    }

    private var contextCard: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.statusText(.purple))
                .frame(width: 4, height: 54)

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
                    Button {
                        withAnimation(.easeInOut(duration: 0.16)) { area = option }
                        Haptics.selection()
                    } label: {
                        Label(option.label, systemImage: option.systemImage)
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(area == option ? Color.statusText(.purple) : .secondary)
                    .background(
                        area == option ? Color.statusBackground(.purple) : Color.clear,
                        in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                    )
                    .accessibilityAddTraits(area == option ? .isSelected : [])
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
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Call Window")
                        .font(.headline)
                    Text(customizeTimes ? "Custom for this shift" : "Uses the configured call time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Toggle("Custom call window", isOn: $customizeTimes)
                    .labelsHidden()
                    .tint(Color.statusText(.purple))
                    .accessibilityLabel("Custom call window")
            }

            if customizeTimes {
                Divider()
                ShiftDateTimeRow(label: "Call", systemImage: "arrow.right", date: $startsAt)
                Divider()
                ShiftDateTimeRow(label: "End", systemImage: "arrow.left", date: $endsAt)

                if !hasValidWindow {
                    Label("End time must be after call time.", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.red))
                }
            } else {
                Label(defaultWindowText, systemImage: defaultsToAllDayWindow ? "calendar" : "clock")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .onChange(of: customizeTimes) { _, isCustom in
            if isCustom {
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
        do {
            let editor = try await APIClient.shared.addWorkingScheduleSlot(
                shiftGroupId: shiftGroupId,
                expectedVersion: expectedWorkingVersion,
                area: area.rawValue,
                workerType: workerType.rawValue,
                callStartsAt: workerType == .student && customizeTimes ? startsAt : nil,
                callEndsAt: workerType == .student && customizeTimes ? endsAt : nil
            )
            Haptics.success()
            onAdded(editor)
            dismiss()
        } catch {
            self.error = error.localizedDescription
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

struct ShiftDateTimeRow: View {
    let label: String
    let systemImage: String
    @Binding var date: Date

    private let hours = Array(0..<24)
    private let minutes = [0, 15, 30, 45]

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .frame(width: 22)
                .foregroundStyle(Color.statusText(.purple))
                .accessibilityHidden(true)
            Text(label)
                .font(.subheadline.weight(.semibold))
            Spacer()
            DatePicker("\(label) date", selection: $date, displayedComponents: .date)
                .labelsHidden()
            HStack(spacing: 4) {
                Picker("\(label) hour", selection: hourSelection) {
                    ForEach(hours, id: \.self) { hour in
                        Text(timeLabel(hour: hour, minute: minuteSelection.wrappedValue)).tag(hour)
                    }
                }
                .pickerStyle(.menu)
                .fixedSize()

                Picker("\(label) minute", selection: minuteSelection) {
                    ForEach(minutes, id: \.self) { minute in
                        Text(timeLabel(hour: hourSelection.wrappedValue, minute: minute)).tag(minute)
                    }
                }
                .pickerStyle(.menu)
                .fixedSize()
            }
            .tint(Color.statusText(.purple))
        }
    }

    private var hourSelection: Binding<Int> {
        Binding(
            get: { Calendar.current.component(.hour, from: date) },
            set: { updateTime(hour: $0, minute: Calendar.current.component(.minute, from: date)) }
        )
    }

    private var minuteSelection: Binding<Int> {
        Binding(
            get: {
                let minute = Calendar.current.component(.minute, from: date)
                return minutes.min(by: { abs($0 - minute) < abs($1 - minute) }) ?? 0
            },
            set: { updateTime(hour: Calendar.current.component(.hour, from: date), minute: $0) }
        )
    }

    private func updateTime(hour: Int, minute: Int) {
        let calendar = Calendar.current
        date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date) ?? date
    }

    private func timeLabel(hour: Int, minute: Int) -> String {
        let calendar = Calendar.current
        let value = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date) ?? date
        return value.formatted(date: .omitted, time: .shortened)
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
