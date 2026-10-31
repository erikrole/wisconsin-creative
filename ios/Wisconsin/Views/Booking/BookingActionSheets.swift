import SwiftUI

/// Checkout and reservation actions that match the web booking page menu.
/// Each sheet has one confirm action. Gear custody stays at the kiosk.

struct BookingReasonSheet: View {
    let title: String
    let message: String
    let confirmTitle: String
    let placeholder: String
    let onConfirm: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var isSaving = false
    @State private var error: String?
    @State private var showDiscard = false

    private var trimmedReason: String {
        reason.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var reasonProblem: String? {
        guard !trimmedReason.isEmpty else { return nil }
        if trimmedReason.count < BookingEditRules.minReasonLength {
            return "Reason must be at least 10 characters"
        }
        if trimmedReason.count > BookingEditRules.maxReasonLength {
            return "Reason must be 1,000 characters or fewer."
        }
        return nil
    }

    private var canConfirm: Bool {
        !isSaving && !trimmedReason.isEmpty && reasonProblem == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    TextField(placeholder, text: $reason, axis: .vertical)
                        .lineLimit(3...6)
                } footer: {
                    if let reasonProblem {
                        Text(reasonProblem)
                    }
                }
                if let error {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { requestDismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await confirm() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text(confirmTitle).fontWeight(.semibold)
                        }
                    }
                    .disabled(!canConfirm)
                }
            }
            .interactiveDismissDisabled(isSaving || !trimmedReason.isEmpty)
            .confirmationDialog("Discard this reason?", isPresented: $showDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
    }

    private func requestDismiss() {
        if trimmedReason.isEmpty { dismiss() } else { showDiscard = true }
    }

    private func confirm() async {
        guard canConfirm else { return }
        isSaving = true
        error = nil
        do {
            try await onConfirm(trimmedReason)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
            isSaving = false
        }
    }
}

struct CloseRemainingSheet: View {
    let booking: Booking
    let onConfirm: (String?) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var isSaving = false
    @State private var error: String?
    @State private var showDiscard = false

    private var trimmedNote: String {
        note.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var noteProblem: String? {
        trimmedNote.count > BookingEditRules.maxReasonLength
            ? "Note must be 1,000 characters or fewer."
            : nil
    }

    private var remainingSummary: String {
        var parts: [String] = []
        for item in booking.serializedItems where item.allocationStatus?.lowercased() != "picked_up" {
            parts.append(item.asset.itemListPrimaryTitle)
        }
        for item in booking.bulkItems {
            let left = item.plannedQuantity - item.checkedOutQuantity
            if left > 0 {
                parts.append("\(left) × \(item.bulkSku.name)")
            }
        }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(remainingSummary.isEmpty
                         ? "Nothing is left to release. This marks the reservation complete so it stops showing as an open pickup."
                         : "This releases \(remainingSummary) back to the shelf and marks the reservation complete. Gear that was already picked up stays on its checkout.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    TextField("Note (optional)", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                } footer: {
                    if let noteProblem {
                        Text(noteProblem)
                    }
                }
                if let error {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
            }
            .navigationTitle("Close reservation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { requestDismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await confirm() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Close reservation").fontWeight(.semibold)
                        }
                    }
                    .disabled(isSaving || noteProblem != nil)
                }
            }
            .interactiveDismissDisabled(isSaving || !trimmedNote.isEmpty)
            .confirmationDialog("Discard this note?", isPresented: $showDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
    }

    private func requestDismiss() {
        if trimmedNote.isEmpty { dismiss() } else { showDiscard = true }
    }

    private func confirm() async {
        guard !isSaving, noteProblem == nil else { return }
        isSaving = true
        error = nil
        do {
            try await onConfirm(trimmedNote.isEmpty ? nil : trimmedNote)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
            isSaving = false
        }
    }
}

struct BookingEventsSheet: View {
    let booking: Booking
    let onSaved: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedIds: [String]
    @State private var titles: [String: String]
    @State private var isSaving = false
    @State private var error: String?
    @State private var showDiscard = false

    init(booking: Booking, onSaved: @escaping (Booking) -> Void) {
        self.booking = booking
        self.onSaved = onSaved
        _selectedIds = State(initialValue: booking.linkedEvents.map(\.id))
        _titles = State(initialValue: Dictionary(booking.linkedEvents.map { ($0.id, $0.summary ?? "Event") }, uniquingKeysWith: { first, _ in first }))
    }

    private var originalIds: Set<String> { Set(booking.linkedEvents.map(\.id)) }

    private var hasChanges: Bool { Set(selectedIds) != originalIds }

    var body: some View {
        NavigationStack {
            BookingEventChooser(
                selectedIds: $selectedIds,
                titles: $titles,
                currentEvents: booking.linkedEvents
            )
            .disabled(isSaving)
            .navigationTitle("Linked events")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges { showDiscard = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Save").fontWeight(.semibold)
                        }
                    }
                    .disabled(!hasChanges || isSaving || selectedIds.count > BookingEditRules.maxLinkedEvents)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Brand.Space.md)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial)
                }
            }
            .interactiveDismissDisabled(isSaving || hasChanges)
            .confirmationDialog("Discard event changes?", isPresented: $showDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
    }

    private func save() async {
        guard hasChanges, !isSaving else { return }
        let requestedIds = uniqueIds(selectedIds)
        isSaving = true
        error = nil
        do {
            let updated = try await APIClient.shared.updateBookingEvents(
                id: booking.id,
                eventIds: requestedIds,
                updatedAt: booking.updatedAt
            )
            Haptics.success()
            onSaved(updated)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
            isSaving = false
        }
    }
}

struct BookingEventChooser: View {
    @Binding var selectedIds: [String]
    @Binding var titles: [String: String]
    let currentEvents: [BookingEvent]

    @State private var rows: [EventRow] = []
    @State private var query = ""
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var limitMessage: String?

    private struct EventRow: Identifiable {
        let id: String
        let title: String
        let when: String
    }

    private var visibleRows: [EventRow] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return rows }
        return rows.filter { $0.title.lowercased().contains(trimmed) || $0.when.lowercased().contains(trimmed) }
    }

    var body: some View {
        List {
            if let limitMessage {
                Section {
                    Text(limitMessage)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.orange))
                }
            }
            if isLoading && rows.isEmpty {
                Section {
                    ProgressView("Loading events")
                }
            } else if let loadError, rows.isEmpty {
                Section {
                    Text(loadError)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                    Button("Retry") { Task { await load() } }
                }
            } else if visibleRows.isEmpty {
                Section {
                    Text(query.isEmpty ? "No upcoming events." : "No events match.")
                        .foregroundStyle(.secondary)
                }
            } else {
                Section {
                    ForEach(visibleRows) { row in
                        Button { toggle(row) } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.title)
                                        .foregroundStyle(.primary)
                                    Text(row.when)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                if selectedIds.contains(row.id) {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.statusText(.purple))
                                        .accessibilityHidden(true)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(row.title)
                        .accessibilityAddTraits(selectedIds.contains(row.id) ? .isSelected : [])
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Search events")
        .task { await load() }
    }

    private func toggle(_ row: EventRow) {
        if let index = selectedIds.firstIndex(of: row.id) {
            selectedIds.remove(at: index)
            limitMessage = nil
            return
        }
        guard selectedIds.count < BookingEditRules.maxLinkedEvents else {
            limitMessage = "A booking may link at most 5 events."
            return
        }
        selectedIds.append(row.id)
        titles[row.id] = row.title
        limitMessage = nil
        Haptics.selection()
    }

    private func load() async {
        isLoading = true
        loadError = nil
        let seeded = currentEvents.map {
            EventRow(id: $0.id, title: $0.summary ?? "Event", when: "Already linked")
        }
        if rows.isEmpty { rows = seeded }
        do {
            let start = Date()
            let end = start.addingTimeInterval(120 * 24 * 60 * 60)
            let events = try await APIClient.shared.allCalendarEvents(
                includePast: false,
                window: DateInterval(start: start, end: end),
                pageSize: 200
            )
            var merged: [EventRow] = []
            var seen = Set<String>()
            for event in events {
                guard seen.insert(event.id).inserted else { continue }
                merged.append(EventRow(id: event.id, title: event.summary, when: Self.when(event)))
                titles[event.id] = event.summary
            }
            for row in seeded where seen.insert(row.id).inserted {
                merged.insert(row, at: 0)
                titles[row.id] = row.title
            }
            rows = merged
        } catch {
            loadError = error.localizedDescription
            if rows.isEmpty { rows = seeded }
        }
        isLoading = false
    }

    private static func when(_ event: ScheduleEvent) -> String {
        if event.allDay {
            return event.startsAt.formatted(date: .abbreviated, time: .omitted)
        }
        return event.startsAt.formatted(date: .abbreviated, time: .shortened)
    }
}

func uniqueIds(_ ids: [String]) -> [String] {
    var seen = Set<String>()
    return ids.filter { seen.insert($0).inserted }
}


/// Admin-only: pick one available numbered item to put on an active checkout.
/// The item goes out now and is due back with the checkout.
struct AddCheckoutItemSheet: View {
    let bookingId: String
    let onAdded: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [CheckoutAddCandidate]?
    @State private var addingId: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }
                ForEach(results ?? []) { asset in
                    Button {
                        Task { await add(asset) }
                    } label: {
                        HStack(spacing: 10) {
                            AssetThumbnail(imageUrl: asset.imageUrl, size: 40)
                            // Tag first, like the checkout's own gear list.
                            VStack(alignment: .leading, spacing: 2) {
                                // Concrete colors: inside a Button, `.primary`
                                // and `.secondary` resolve to the red tint.
                                Text(asset.assetTag)
                                    .font(.gothamBold(size: 16))
                                    .foregroundStyle(Color.primary)
                                    .lineLimit(1)
                                if let name = asset.name.nonBlankText, !name.isSameListText(as: asset.assetTag) {
                                    Text(name)
                                        .font(.caption)
                                        .foregroundStyle(Color.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            if addingId == asset.id { ProgressView() }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(addingId != nil)
                }
            }
            .overlay {
                if results == nil {
                    ProgressView()
                } else if results?.isEmpty == true {
                    ContentUnavailableView("No available items", systemImage: "shippingbox")
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search by name or tag")
            .navigationTitle("Add to this checkout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            // Re-runs on every keystroke and cancels the previous run, so the
            // sleep is the debounce.
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                do {
                    let found = try await APIClient.shared.availableAssetsForCheckout(
                        search: query.trimmingCharacters(in: .whitespacesAndNewlines)
                    )
                    guard !Task.isCancelled else { return }
                    results = found
                    error = nil
                } catch {
                    guard !Task.isCancelled else { return }
                    if results == nil { results = [] }
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func add(_ asset: CheckoutAddCandidate) async {
        addingId = asset.id
        error = nil
        do {
            let updated = try await APIClient.shared.addCheckoutItem(bookingId: bookingId, assetId: asset.id)
            onAdded(updated)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        addingId = nil
    }
}
