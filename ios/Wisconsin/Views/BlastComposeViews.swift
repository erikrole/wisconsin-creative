import SwiftUI

// MARK: - Compose

/// The event a blast is locked to when it starts from Event detail's "Message Crew".
struct BlastEventChoice: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let startsAt: Date

    init(id: String, title: String, startsAt: Date) {
        self.id = id
        self.title = title
        self.startsAt = startsAt
    }

    init(event: ScheduleEvent) {
        self.init(id: event.id, title: scheduleEventDisplayTitle(event), startsAt: event.startsAt)
    }

    var label: String {
        "\(title) · \(startsAt.formatted(.dateTime.month(.abbreviated).day()))"
    }
}

/// Staff and admins send a blast from the phone: a push plus a banner each
/// recipient acknowledges. Mirrors the web compose dialog
/// (src/app/(app)/blasts/_components/ComposeBlastDialog.tsx) for the two
/// targets that matter in the field: an event's crew and area groups.
struct ComposeBlastSheet: View {
    /// Set when the sheet opens from an event; the audience is that event's crew.
    var lockedEvent: BlastEventChoice?
    var onSent: (SentBlastReceipt) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss

    private enum Audience: String, CaseIterable, Identifiable {
        case eventCrew = "Event crew"
        case groups = "Groups"
        var id: String { rawValue }
    }

    private enum PreviewState: Equatable {
        case idle
        case loading
        case ready(BlastPreview)
        case failed(String)
    }

    /// Hours until the banner stops showing. "Never" is deliberate, not the default.
    private static let expiryOptions: [(hours: Int?, label: String)] = [
        (4, "4 hours"), (12, "12 hours"), (24, "24 hours"), (72, "3 days"), (nil, "Never"),
    ]
    private static let areas = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"]
    private static let workerTypes: [(code: String, label: String)] = [("FT", "Staff"), ("ST", "Students")]

    @State private var title = ""
    @State private var message = ""
    @State private var severity: BlastSeverity = .info
    @State private var expiryHours: Int? = 24
    @State private var audience: Audience = .eventCrew
    @State private var eventId = ""
    @State private var areas: Set<String> = []
    @State private var workerTypes: Set<String> = []
    @State private var events: [BlastEventChoice] = []
    @State private var eventsError: String?
    @State private var preview: PreviewState = .idle
    @State private var isSending = false
    @State private var sendError: String?
    @State private var confirmingSend = false

    private var target: BlastTarget? {
        let candidate: BlastTarget
        if let lockedEvent {
            candidate = .eventCrew(eventId: lockedEvent.id)
        } else if audience == .eventCrew {
            candidate = .eventCrew(eventId: eventId)
        } else {
            candidate = .groups(
                areas: Self.areas.filter(areas.contains),
                workerTypes: Self.workerTypes.map(\.code).filter(workerTypes.contains)
            )
        }
        return candidate.isComplete ? candidate : nil
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedMessage: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var reachCount: Int? {
        if case .ready(let preview) = preview { return preview.count }
        return nil
    }

    private var canSend: Bool {
        !isSending && !trimmedTitle.isEmpty && !trimmedMessage.isEmpty && (reachCount ?? 0) > 0
    }

    var body: some View {
        NavigationStack {
            Form {
                messageSection
                deliverySection
                audienceSection
                reachSection
                if let sendError {
                    Section {
                        Text(sendError)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
            }
            .navigationTitle(lockedEvent == nil ? "New Blast" : "Message Crew")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button("Send") { confirmingSend = true }
                            .disabled(!canSend)
                    }
                }
            }
            .confirmationDialog(
                sendConfirmationTitle,
                isPresented: $confirmingSend,
                titleVisibility: .visible
            ) {
                Button("Send Blast") { Task { await send() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Everyone gets a push and a banner to acknowledge. You can cancel the banner later, but pushes already delivered stay delivered.")
            }
            .interactiveDismissDisabled(isSending || !trimmedTitle.isEmpty || !trimmedMessage.isEmpty)
            .task {
                guard lockedEvent == nil else { return }
                await loadEvents()
#if DEBUG
                // Capture seeds: fill the form the way a person would, so the
                // reach preview runs through the real request path.
                switch ProcessInfo.processInfo.environment["GT_BLAST_VIEW"] {
                case "compose-crew":
                    title = "Call time moved to 4:00"
                    message = "Be at gate 3 by 4:00 instead of 4:30."
                    severity = .warning
                    if let first = events.first { eventId = first.id }
                case "compose-groups":
                    title = "Batteries back on the shelf"
                    message = "Please return numbered batteries after your shoot."
                    audience = .groups
                    areas = ["VIDEO", "PHOTO"]
                    workerTypes = ["ST"]
                default: break
                }
#endif
            }
            .task(id: target) {
                await refreshPreview()
            }
        }
    }

    private var sendConfirmationTitle: String {
        let count = reachCount ?? 0
        return "Send to \(count) \(count == 1 ? "person" : "people")?"
    }

    // MARK: Sections

    private var messageSection: some View {
        Section {
            TextField("Title", text: $title, prompt: Text("Call time moved"))
                .textInputAutocapitalization(.sentences)
                .onChange(of: title) { _, value in
                    if value.count > 120 { title = String(value.prefix(120)) }
                }
            TextField("Message", text: $message, prompt: Text("Be at gate 3 by 4:00 instead of 4:30."), axis: .vertical)
                .lineLimit(3...8)
                .onChange(of: message) { _, value in
                    if value.count > 1000 { message = String(value.prefix(1000)) }
                }
        } footer: {
            if message.count > 800 {
                Text("\(message.count) of 1,000 characters")
                    .monospacedDigit()
            }
        }
    }

    private var deliverySection: some View {
        Section {
            Picker("Severity", selection: $severity) {
                Text("Info").tag(BlastSeverity.info)
                Text("Warning").tag(BlastSeverity.warning)
                Text("Urgent").tag(BlastSeverity.urgent)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            Picker("Banner expires", selection: $expiryHours) {
                ForEach(Self.expiryOptions, id: \.label) { option in
                    Text(option.label).tag(option.hours)
                }
            }
        }
    }

    @ViewBuilder
    private var audienceSection: some View {
        if let lockedEvent {
            Section {
                LabeledContent("Crew of", value: lockedEvent.label)
            } header: {
                Text("Who gets this")
            } footer: {
                Text("Everyone on this event's published crew.")
            }
        } else {
            Section {
                Picker("Audience", selection: $audience) {
                    ForEach(Audience.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if audience == .eventCrew {
                    eventPicker
                } else {
                    ForEach(Self.areas, id: \.self) { area in
                        checkRow(area.shiftAreaLabel, isOn: areas.contains(area)) {
                            areas.formSymmetricDifference([area])
                        }
                    }
                }
            } header: {
                Text("Who gets this")
            } footer: {
                if audience == .eventCrew {
                    Text("Everyone on the event's published crew.")
                }
            }

            if audience == .groups {
                Section {
                    ForEach(Self.workerTypes, id: \.code) { type in
                        checkRow(type.label, isOn: workerTypes.contains(type.code)) {
                            workerTypes.formSymmetricDifference([type.code])
                        }
                    }
                } footer: {
                    Text("Reaches anyone in a picked area, narrowed to staff or students if you pick one. Sport groups and picking people one by one are on the web.")
                }
            }
        }
    }

    @ViewBuilder
    private var eventPicker: some View {
        if let eventsError, events.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(eventsError)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Try Again") { Task { await loadEvents() } }
            }
        } else {
            Picker("Event", selection: $eventId) {
                Text(events.isEmpty ? "Loading events…" : "Choose an event").tag("")
                ForEach(events) { event in
                    Text(event.label).tag(event.id)
                }
            }
            .pickerStyle(.navigationLink)
        }
    }

    private func checkRow(_ label: String, isOn: Bool, toggle: @escaping () -> Void) -> some View {
        Button {
            toggle()
            Haptics.selection()
        } label: {
            HStack {
                Text(label)
                    .foregroundStyle(.primary)
                Spacer()
                if isOn {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    @ViewBuilder
    private var reachSection: some View {
        Section {
            switch preview {
            case .idle:
                Text("Pick who gets this to see how many people it reaches.")
                    .foregroundStyle(.secondary)
            case .loading:
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Checking who this reaches…")
                        .foregroundStyle(.secondary)
                }
            case .failed(let message):
                Text(message)
                    .foregroundStyle(.secondary)
            case .ready(let preview):
                VStack(alignment: .leading, spacing: 4) {
                    Text(preview.count == 0
                         ? "Reaches nobody yet"
                         : "Reaches \(preview.count) \(preview.count == 1 ? "person" : "people")")
                        .font(.headline)
                        .monospacedDigit()
                    if !preview.summary.isEmpty {
                        Text(preview.summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if !preview.users.isEmpty {
                        Text(Self.nameList(preview.users))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    static func nameList(_ people: [BlastPerson], limit: Int = 12) -> String {
        let names = people.prefix(limit).map(\.name)
        let rest = people.count - names.count
        return rest > 0 ? names.joined(separator: ", ") + " and \(rest) more" : names.joined(separator: ", ")
    }

    // MARK: Loading and sending

    private func loadEvents() async {
        eventsError = nil
        do {
            let upcoming = try await APIClient.shared.calendarEvents(includePast: false, limit: 60)
            events = upcoming.map(BlastEventChoice.init(event:))
        } catch is CancellationError {
            return
        } catch {
            eventsError = "Couldn't load events. \((error as? APIError)?.errorDescription ?? error.localizedDescription)"
        }
    }

    /// Debounced dry run. Nobody should send something that can't be recalled
    /// without first seeing exactly who it reaches.
    private func refreshPreview() async {
        guard let target else {
            preview = .idle
            return
        }
        preview = .loading
        do {
            try await Task.sleep(for: .milliseconds(300))
            let result = try await APIClient.shared.previewBlast(target: target)
            preview = .ready(result)
        } catch is CancellationError {
            return
        } catch {
            preview = .failed((error as? APIError)?.errorDescription ?? "Couldn't check who this reaches.")
        }
    }

    private func send() async {
        guard let target, canSend else { return }
        isSending = true
        sendError = nil
        defer { isSending = false }
        do {
            let receipt = try await APIClient.shared.sendBlast(
                title: trimmedTitle,
                body: trimmedMessage,
                severity: severity,
                expiresAt: expiryHours.map { Date().addingTimeInterval(TimeInterval($0) * 3_600) },
                target: target
            )
            Haptics.success()
            onSent(receipt)
            dismiss()
        } catch {
            Haptics.error()
            sendError = (error as? APIError)?.errorDescription ?? "Couldn't send that blast. Try again."
        }
    }
}

// MARK: - Sent blasts

struct SentBlastsRoute: Hashable {}

struct SentBlastRoute: Hashable {
    let id: String
}

/// The team's sent blasts with acknowledgement progress. Staff and admins only;
/// `GET /api/blasts` refuses everyone else.
struct SentBlastsView: View {
    @State private var blasts: [SentBlast] = []
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        content
            .navigationTitle("Sent")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await load() }
            .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if blasts.isEmpty && isLoading {
            ProgressView("Loading sent blasts")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if blasts.isEmpty, let error {
            ContentUnavailableView {
                Label("Couldn't load sent blasts", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if blasts.isEmpty {
            ContentUnavailableView {
                Label("Nothing sent yet", systemImage: "megaphone")
            } description: {
                Text("Blasts the team sends show up here with who has acknowledged them.")
            }
        } else {
            List {
                if let error {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(blasts) { blast in
                    NavigationLink(value: SentBlastRoute(id: blast.id)) {
                        SentBlastRow(blast: blast)
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            blasts = try await APIClient.shared.sentBlasts()
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct SentBlastRow: View {
    let blast: SentBlast

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                StatusPill(label: blast.severity.blastLabel, tone: blast.severity.blastTone)
                Spacer(minLength: 8)
                if let sentAt = blast.sentAt {
                    Text(sentAt, format: .relative(presentation: .named, unitsStyle: .abbreviated))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Text(blast.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            Text(progressLine)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .lineLimit(1)
            if let summary = blast.targetSummary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var progressLine: String {
        if blast.isCancelled { return "Cancelled" }
        return "\(blast.acknowledgedCount) of \(blast.recipientCount) acknowledged"
    }
}

/// Who has and hasn't acknowledged one blast, with Cancel. Un-acknowledged
/// people come first because the question on game day is who still needs a call.
struct SentBlastDetailView: View {
    let id: String

    @State private var detail: SentBlastDetail?
    @State private var error: String?
    @State private var actionError: String?
    @State private var confirmingCancel = false
    @State private var isCancelling = false

    var body: some View {
        content
            .navigationTitle("Blast")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await load() }
            .task(id: id) { await load() }
            .confirmationDialog(
                "Cancel this blast?",
                isPresented: $confirmingCancel,
                titleVisibility: .visible
            ) {
                Button("Cancel Blast", role: .destructive) { Task { await cancel() } }
                Button("Keep It", role: .cancel) {}
            } message: {
                Text("The banner goes away on everyone's next refresh. Pushes already delivered stay delivered.")
            }
    }

    @ViewBuilder
    private var content: some View {
        if let detail {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        StatusPill(label: detail.blast.severity.blastLabel, tone: detail.blast.severity.blastTone)
                        Text(detail.blast.title)
                            .font(.title3.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(detail.blast.body)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                        Text(metaLine(detail.blast))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                if !detail.waiting.isEmpty, !detail.blast.isCancelled {
                    Section("Waiting · \(detail.waiting.count)") {
                        ForEach(detail.waiting) { recipient in
                            Text(recipient.user.name)
                        }
                    }
                }
                if !detail.acknowledged.isEmpty {
                    Section("Acknowledged · \(detail.acknowledged.count)") {
                        ForEach(detail.acknowledged) { recipient in
                            LabeledContent(recipient.user.name) {
                                if let at = recipient.acknowledgedAt {
                                    Text(at, format: .dateTime.hour().minute())
                                }
                            }
                        }
                    }
                }
                if !detail.addedSinceSend.isEmpty, !detail.blast.isCancelled {
                    Section {
                        Text(ComposeBlastSheet.nameList(detail.addedSinceSend))
                    } header: {
                        Text("Joined since it was sent")
                    } footer: {
                        Text("They didn't get this one. Send a new blast to reach them.")
                    }
                }
                if let actionError {
                    Section {
                        Text(actionError)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
                if !detail.blast.isCancelled {
                    Section {
                        Button("Cancel Blast", role: .destructive) { confirmingCancel = true }
                            .disabled(isCancelling)
                    }
                }
            }
            .listStyle(.insetGrouped)
        } else if let error {
            ContentUnavailableView {
                Label("Couldn't load this blast", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func metaLine(_ blast: SentBlast) -> String {
        var parts: [String] = []
        if let name = blast.createdBy?.name { parts.append("Sent by \(name)") }
        if let sentAt = blast.sentAt { parts.append(sentAt.formatted(date: .abbreviated, time: .shortened)) }
        if blast.isCancelled { parts.append("Cancelled") }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            detail = try await APIClient.shared.sentBlastDetail(id: id)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func cancel() async {
        isCancelling = true
        actionError = nil
        defer { isCancelling = false }
        do {
            try await APIClient.shared.cancelBlast(id: id)
            Haptics.success()
            await load()
        } catch {
            Haptics.error()
            actionError = (error as? APIError)?.errorDescription ?? "Couldn't cancel. Try again."
        }
    }
}
