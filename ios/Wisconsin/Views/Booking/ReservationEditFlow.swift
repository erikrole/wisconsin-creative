import SwiftUI

/// Phone editor for a reservation. One Save commits the plan, then linked
/// events. Checkout gear still changes only at a kiosk.
struct ReservationEditFlow: View {
    let onSaved: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var baseline: Baseline
    @State private var title: String
    @State private var notes: String
    @State private var locationId: String
    @State private var locationName: String
    @State private var startsAt: Date
    @State private var endsAt: Date
    @State private var lines: [ReservationGearLine]
    @State private var selectedEventIds: [String]
    @State private var eventTitles: [String: String]
    @State private var options: FormOptions?
    @State private var locationsError: String?
    @State private var availability: Availability = .idle
    @State private var availabilityTask: Task<Void, Never>?
    @State private var availabilityGeneration = UUID()
    @State private var isSaving = false
    @State private var error: String?
    @State private var showDiscard = false

    init(booking: Booking, onSaved: @escaping (Booking) -> Void) {
        self.onSaved = onSaved
        _baseline = State(initialValue: Baseline(booking))
        _title = State(initialValue: booking.title)
        _notes = State(initialValue: booking.notes ?? "")
        _locationId = State(initialValue: booking.location.id)
        _locationName = State(initialValue: booking.location.name)
        _startsAt = State(initialValue: booking.startsAt)
        _endsAt = State(initialValue: booking.endsAt)
        _lines = State(initialValue: ReservationGearLine.lines(from: booking))
        _selectedEventIds = State(initialValue: booking.linkedEvents.map(\.id))
        _eventTitles = State(initialValue: Dictionary(booking.linkedEvents.map { ($0.id, $0.summary ?? "Event") }, uniquingKeysWith: { first, _ in first }))
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var titleProblem: String? {
        if trimmedTitle.isEmpty || trimmedTitle.count > BookingEditRules.maxTitleLength {
            return "Name must be between 1 and 500 characters."
        }
        return nil
    }

    private var notesProblem: String? {
        notes.count > BookingEditRules.maxNotesLength ? "Notes must be 10,000 characters or fewer." : nil
    }

    private var windowProblem: String? {
        endsAt <= startsAt ? "Due back has to be after pickup." : nil
    }

    private var currentAssetIds: Set<String> {
        Set(lines.compactMap { $0.kind == .serialized ? $0.id : nil })
    }

    private var currentBulk: [String: Int] {
        Dictionary(uniqueKeysWithValues: lines.compactMap { line -> (String, Int)? in
            guard line.kind == .bulk, let skuId = line.bulkSkuId else { return nil }
            return (skuId, line.quantity)
        })
    }

    private var hasPlanChanges: Bool {
        trimmedTitle != baseline.title
            || notes != baseline.notes
            || locationId != baseline.locationId
            || startsAt != baseline.startsAt
            || endsAt != baseline.endsAt
            || currentAssetIds != baseline.assetIds
            || currentBulk != baseline.bulk
    }

    private var hasEventChanges: Bool {
        Set(selectedEventIds) != baseline.eventIds
    }

    private var hasChanges: Bool { hasPlanChanges || hasEventChanges }

    private var canReadInternalEvents: Bool { session.currentUser?.role != "COLLABORATOR" }

    private var needsAvailability: Bool {
        // Collaborators can edit their own reservations but cannot call the
        // internal availability hint. The mutation still validates allocations.
        guard canReadInternalEvents else { return false }
        return locationId != baseline.locationId || startsAt != baseline.startsAt || endsAt != baseline.endsAt
            || currentAssetIds != baseline.assetIds || currentBulk != baseline.bulk
    }

    private var availabilityKey: String {
        let bulk = currentBulk.keys.sorted().map { "\($0)=\(currentBulk[$0] ?? 0)" }.joined(separator: ",")
        let assets = currentAssetIds.sorted().joined(separator: ",")
        return "\(locationId)|\(startsAt.timeIntervalSinceReferenceDate)|\(endsAt.timeIntervalSinceReferenceDate)|\(assets)|\(bulk)"
    }

    private var canSave: Bool {
        guard hasChanges, !isSaving, titleProblem == nil, notesProblem == nil, windowProblem == nil else { return false }
        guard lines.allSatisfy({ $0.quantity >= max($0.checkedOutQuantity, $0.kind == .bulk ? 1 : 1) }) else { return false }
        if needsAvailability { return availability == .clear }
        return true
    }

    private var primaryTitle: String {
        if needsAvailability, case .failed = availability { return "Check availability" }
        return "Save changes"
    }

    private var primaryEnabled: Bool {
        if isSaving { return false }
        if needsAvailability, case .failed = availability { return true }
        if needsAvailability, case .checking = availability { return false }
        return canSave
    }

    private var locationChoices: [FormOption] {
        let supported = (options?.locations ?? []).filter { location in
            let name = location.name.lowercased()
            return name.contains("camp randall") || name.contains("kohl center")
        }
        if supported.contains(where: { $0.id == locationId }) {
            return supported
        }
        return [FormOption(id: locationId, name: locationName)] + supported
    }

    private var gearSummary: String {
        let count = lines.reduce(0) { total, line in
            total + (line.kind == .bulk ? line.quantity : 1)
        }
        return count == 1 ? "1 item" : "\(count) items"
    }

    private var eventSummary: String {
        if selectedEventIds.isEmpty { return "None" }
        if selectedEventIds.count == 1 {
            return eventTitles[selectedEventIds[0]] ?? "1 event"
        }
        return "\(selectedEventIds.count) events"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $title)
                        .textInputAutocapitalization(.words)
                } header: {
                    Text("Reservation")
                } footer: {
                    if let titleProblem, trimmedTitle.isEmpty || trimmedTitle.count > BookingEditRules.maxTitleLength {
                        Text(titleProblem)
                    }
                }

                Section("Notes") {
                    TextField("Add a note", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                    if let notesProblem {
                        Text(notesProblem)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }

                Section("Pickup location") {
                    if locationChoices.isEmpty {
                        Text(locationName)
                    } else {
                        Picker("Pickup location", selection: $locationId) {
                            ForEach(locationChoices) { location in
                                Text(location.name).tag(location.id)
                            }
                        }
                    }
                    if let locationsError {
                        Text(locationsError)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                        Button("Retry") { Task { await loadLocations() } }
                    }
                }

                Section("Pickup") {
                    DayTimeChipPicker(
                        selection: $startsAt,
                        minimum: min(baseline.startsAt, Date()),
                        tint: Color.statusText(.purple)
                    )
                }

                Section("Due back") {
                    DayTimeChipPicker(
                        selection: $endsAt,
                        minimum: startsAt,
                        tint: Color.statusText(.purple)
                    )
                    if let windowProblem {
                        Text(windowProblem)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }

                Section {
                    NavigationLink {
                        ReservationGearEditor(lines: $lines, locationId: locationId)
                    } label: {
                        LabeledContent("Gear", value: gearSummary)
                    }
                    if canReadInternalEvents {
                    NavigationLink {
                        BookingEventChooser(
                            selectedIds: $selectedEventIds,
                            titles: $eventTitles,
                            currentEvents: baseline.events
                        )
                        .navigationTitle("Events")
                        .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        LabeledContent("Events", value: eventSummary)
                    }
                    }
                }
            }
            .disabled(isSaving)
            .navigationTitle("Edit Reservation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { requestDismiss() }
                        .disabled(isSaving)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    if let status = availabilityStatus {
                        Text(status.message)
                            .font(.footnote)
                            .foregroundStyle(status.color)
                    }
                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                    Button {
                        Task { await primaryAction() }
                    } label: {
                        Group {
                            if isSaving || (needsAvailability && availability == .checking) {
                                ProgressView()
                            } else {
                                Text(primaryTitle).fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .tint(Color.statusText(.purple))
                    .disabled(!primaryEnabled)
                    .accessibilityLabel(primaryTitle)
                }
                .padding(.horizontal, Brand.Space.md)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(.ultraThinMaterial)
            }
            .interactiveDismissDisabled(hasChanges || isSaving)
            .confirmationDialog("Discard edits?", isPresented: $showDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
            .task {
                scheduleAvailabilityCheck()
                await loadLocations()
            }
            .onChange(of: availabilityKey) { _, _ in scheduleAvailabilityCheck() }
            .onDisappear {
                availabilityTask?.cancel()
                availabilityGeneration = UUID()
            }
        }
    }

    private var availabilityStatus: (message: String, color: Color)? {
        guard needsAvailability else { return nil }
        switch availability {
        case .idle, .clear:
            return nil
        case .checking:
            return ("Checking gear availability…", .secondary)
        case .blocked(let message):
            return (message, Color.statusText(.red))
        case .failed(let message):
            return (message, Color.statusText(.orange))
        }
    }

    private func requestDismiss() {
        if hasChanges { showDiscard = true } else { dismiss() }
    }

    private func loadLocations() async {
        do {
            options = try await APIClient.shared.formOptions()
            locationsError = nil
            if let match = options?.locations.first(where: { $0.id == locationId }) {
                locationName = match.name
            }
        } catch {
            locationsError = error.localizedDescription
        }
    }

    private func scheduleAvailabilityCheck(immediate: Bool = false) {
        availabilityTask?.cancel()
        let generation = UUID()
        availabilityGeneration = generation
        let key = availabilityKey
        guard needsAvailability, windowProblem == nil else {
            availability = .idle
            return
        }
        availability = .checking
        availabilityTask = Task {
            if !immediate { try? await Task.sleep(for: .milliseconds(350)) }
            guard !Task.isCancelled else { return }
            await runAvailabilityCheck(generation: generation, key: key)
        }
    }

    private func runAvailabilityCheck(generation: UUID, key: String) async {
        let remainingAssets = lines.compactMap { line -> String? in
            guard line.kind == .serialized, !line.isPickedUp else { return nil }
            return line.id
        }
        let remainingBulk = lines.compactMap { line -> BulkReservationRequest? in
            guard line.kind == .bulk, let skuId = line.bulkSkuId else { return nil }
            let remaining = line.quantity - line.checkedOutQuantity
            guard remaining > 0 else { return nil }
            return BulkReservationRequest(bulkSkuId: skuId, quantity: remaining)
        }
        let outcome = await APIClient.shared.checkAvailabilityOutcome(
            locationId: locationId,
            serializedAssetIds: remainingAssets,
            startsAt: startsAt,
            endsAt: endsAt,
            excludeBookingId: baseline.id,
            bookingKind: .reservation,
            bulkItems: remainingBulk
        )
        guard availabilityGeneration == generation, availabilityKey == key, !Task.isCancelled else { return }
        if let result = outcome.result {
            availability = result.isAvailable
                ? .clear
                : .blocked("Some of this gear isn't available for that window.")
        } else {
            availability = .failed(outcome.errorMessage ?? "Availability could not be checked.")
        }
    }

    private func primaryAction() async {
        if needsAvailability, case .failed = availability {
            scheduleAvailabilityCheck(immediate: true)
            return
        }
        await save()
    }

    private func save() async {
        guard canSave, !isSaving else { return }
        isSaving = true
        error = nil
        var desired = baseline
        desired.title = trimmedTitle
        desired.notes = notes
        desired.locationId = locationId
        desired.startsAt = startsAt
        desired.endsAt = endsAt
        desired.assetIds = currentAssetIds
        desired.bulk = currentBulk
        desired.eventIds = Set(selectedEventIds)
        let savePlan = hasPlanChanges
        let saveEvents = hasEventChanges
        let requestedBulk = bulkPayload
        var committed: Booking?
        do {
            var updatedAt = baseline.updatedAt
            if savePlan {
                let saved = try await APIClient.shared.updateReservation(
                    id: baseline.id,
                    title: desired.title != baseline.title ? desired.title : nil,
                    notes: desired.notes != baseline.notes ? desired.notes : nil,
                    locationId: desired.locationId != baseline.locationId ? desired.locationId : nil,
                    startsAt: desired.startsAt != baseline.startsAt ? desired.startsAt : nil,
                    endsAt: desired.endsAt != baseline.endsAt ? desired.endsAt : nil,
                    serializedAssetIds: desired.assetIds != baseline.assetIds ? desired.assetIds.sorted() : nil,
                    bulkItems: desired.bulk != baseline.bulk ? requestedBulk : nil,
                    updatedAt: updatedAt
                )
                committed = saved
                updatedAt = saved.updatedAt
                // Acknowledge only the values sent. If event linking fails,
                // retry it against this new version without repeating the plan.
                let previousEventIds = baseline.eventIds
                baseline = desired
                baseline.eventIds = previousEventIds
                baseline.updatedAt = saved.updatedAt
            }
            if saveEvents {
                let saved = try await APIClient.shared.updateBookingEvents(
                    id: baseline.id,
                    eventIds: desired.eventIds.sorted(),
                    updatedAt: updatedAt
                )
                committed = saved
                baseline.eventIds = desired.eventIds
                baseline.updatedAt = saved.updatedAt
            }
            if let committed { onSaved(committed) }
            Haptics.success()
            dismiss()
        } catch {
            if let committed { onSaved(committed) }
            self.error = committed == nil
                ? error.localizedDescription
                : "Reservation saved. Event changes still need saving. \(error.localizedDescription)"
            Haptics.warning()
            isSaving = false
        }
    }

    private var bulkPayload: [BulkReservationRequest] {
        lines.compactMap { line in
            guard line.kind == .bulk, let skuId = line.bulkSkuId else { return nil }
            return BulkReservationRequest(bulkSkuId: skuId, quantity: line.quantity)
        }
    }
}

private struct Baseline {
    let id: String
    var title: String
    var notes: String
    var locationId: String
    var startsAt: Date
    var endsAt: Date
    var assetIds: Set<String>
    var bulk: [String: Int]
    var eventIds: Set<String>
    var updatedAt: Date?
    var events: [BookingEvent]

    init(_ booking: Booking) {
        id = booking.id
        title = booking.title
        notes = booking.notes ?? ""
        locationId = booking.location.id
        startsAt = booking.startsAt
        endsAt = booking.endsAt
        let gear = ReservationGearLine.lines(from: booking)
        assetIds = Set(gear.compactMap { $0.kind == .serialized ? $0.id : nil })
        bulk = Dictionary(uniqueKeysWithValues: gear.compactMap { line -> (String, Int)? in
            guard line.kind == .bulk, let skuId = line.bulkSkuId else { return nil }
            return (skuId, line.quantity)
        })
        eventIds = Set(booking.linkedEvents.map(\.id))
        updatedAt = booking.updatedAt
        events = booking.linkedEvents
    }
}

private enum Availability: Equatable {
    case idle
    case checking
    case clear
    case blocked(String)
    case failed(String)
}

struct ReservationGearLine: Identifiable, Equatable {
    enum Kind: Equatable { case serialized, bulk }
    let id: String
    var kind: Kind
    var title: String
    var subtitle: String?
    var isPickedUp: Bool
    var checkedOutQuantity: Int
    var quantity: Int

    var bulkSkuId: String? {
        guard kind == .bulk else { return nil }
        return String(id.dropFirst("bulk:".count))
    }

    var canRemove: Bool { !isPickedUp && checkedOutQuantity == 0 }

    static func lines(from booking: Booking) -> [ReservationGearLine] {
        booking.serializedItems.map { item in
            ReservationGearLine(
                id: item.assetId,
                kind: .serialized,
                title: item.asset.itemListPrimaryTitle,
                subtitle: item.asset.itemListSecondaryTitle,
                isPickedUp: item.allocationStatus?.lowercased() == "picked_up",
                checkedOutQuantity: 0,
                quantity: 1
            )
        } + booking.bulkItems.map { item in
            ReservationGearLine(
                id: "bulk:\(item.bulkSku.id)",
                kind: .bulk,
                title: item.itemListPrimaryTitle,
                subtitle: item.itemListSecondaryTitle,
                isPickedUp: false,
                checkedOutQuantity: item.checkedOutQuantity,
                quantity: max(item.plannedQuantity, max(item.checkedOutQuantity, 1))
            )
        }
    }
}

private struct ReservationGearEditor: View {
    @Binding var lines: [ReservationGearLine]
    let locationId: String

    @State private var query = ""
    @State private var hits: [GearHit] = []
    @State private var searchError: String?
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    private struct GearHit: Identifiable {
        let id: String
        let title: String
        let subtitle: String?
        let isBulk: Bool
    }

    var body: some View {
        List {
            Section("On this reservation") {
                if lines.isEmpty {
                    Text("Nothing selected yet.")
                        .foregroundStyle(.secondary)
                }
                ForEach($lines) { $line in
                    lineRow($line)
                        .swipeActions {
                            if line.canRemove {
                                Button("Remove", role: .destructive) {
                                    lines.removeAll { $0.id == line.id }
                                }
                            }
                        }
                        .accessibilityAction(named: "Remove") {
                            guard line.canRemove else { return }
                            lines.removeAll { $0.id == line.id }
                        }
                }
            }
            if let searchError {
                Section {
                    Text(searchError)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }
            }
            if isSearching {
                Section { ProgressView("Searching") }
            } else if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Section("Results") {
                    if hits.isEmpty && searchError == nil {
                        Text("No equipment matches.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(hits) { hit in
                        Button { add(hit) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(hit.title).foregroundStyle(.primary)
                                    if let subtitle = hit.subtitle {
                                        Text(subtitle)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer(minLength: 0)
                                if lines.contains(where: { $0.id == hit.id }) {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.statusText(.purple))
                                        .accessibilityHidden(true)
                                } else {
                                    Image(systemName: "plus")
                                        .foregroundStyle(.secondary)
                                        .accessibilityHidden(true)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(lines.contains(where: { $0.id == hit.id }) && !hit.isBulk)
                        .accessibilityLabel(hit.isBulk ? "Add \(hit.title)" : "Add \(hit.title)")
                    }
                }
            } else {
                Section {
                    Text("Search to add a camera, lens, or supply.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Gear")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Search equipment")
        .onChange(of: query) { _, _ in scheduleSearch() }
        .onChange(of: locationId) { _, _ in scheduleSearch() }
        .onDisappear { searchTask?.cancel() }
    }

    @ViewBuilder
    private func lineRow(_ line: Binding<ReservationGearLine>) -> some View {
        if line.wrappedValue.kind == .bulk {
            let floor = max(line.wrappedValue.checkedOutQuantity, 1)
            Stepper(value: line.quantity, in: floor...BookingEditRules.maxBulkQuantity) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.wrappedValue.title)
                    Text(line.wrappedValue.checkedOutQuantity > 0
                         ? "\(line.wrappedValue.quantity) reserved, \(line.wrappedValue.checkedOutQuantity) picked up"
                         : "\(line.wrappedValue.quantity)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.wrappedValue.title)
                if line.wrappedValue.isPickedUp {
                    Text("Picked up")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if let subtitle = line.wrappedValue.subtitle {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(minHeight: 44, alignment: .leading)
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            hits = []
            isSearching = false
            searchError = nil
            return
        }
        isSearching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await search(trimmed)
        }
    }

    private func search(_ query: String) async {
        do {
            let response = try await APIClient.shared.assets(search: query, locationId: locationId, limit: 30)
            guard !Task.isCancelled else { return }
            let assets = response.data.compactMap { asset -> GearHit? in
                guard !Self.isHidden(asset.category?.name) else { return nil }
                return GearHit(
                    id: asset.id,
                    title: asset.itemListPrimaryTitle,
                    subtitle: asset.itemListSecondaryTitle,
                    isBulk: false
                )
            }
            let supplies = response.bulkItems.compactMap { family -> GearHit? in
                guard !Self.isHidden(family.category) else { return nil }
                return GearHit(
                    id: "bulk:\(family.id)",
                    title: family.name,
                    subtitle: family.locationName,
                    isBulk: true
                )
            }
            hits = assets + supplies
            searchError = nil
        } catch {
            guard !Task.isCancelled else { return }
            searchError = error.localizedDescription
            hits = []
        }
        isSearching = false
    }

    private func add(_ hit: GearHit) {
        searchError = nil
        if hit.isBulk {
            if let index = lines.firstIndex(where: { $0.id == hit.id }) {
                guard lines[index].quantity < BookingEditRules.maxBulkQuantity else { return }
                lines[index].quantity += 1
            } else {
                guard lines.filter({ $0.kind == .bulk }).count < BookingEditRules.maxBulkLines else {
                    searchError = "A reservation can include at most 50 supply lines."
                    return
                }
                lines.append(ReservationGearLine(
                    id: hit.id,
                    kind: .bulk,
                    title: hit.title,
                    subtitle: hit.subtitle,
                    isPickedUp: false,
                    checkedOutQuantity: 0,
                    quantity: 1
                ))
            }
        } else {
            guard !lines.contains(where: { $0.id == hit.id }) else { return }
            guard lines.filter({ $0.kind == .serialized }).count < BookingEditRules.maxSerializedItems else {
                searchError = "A reservation can include at most 500 items."
                return
            }
            lines.append(ReservationGearLine(
                id: hit.id,
                kind: .serialized,
                title: hit.title,
                subtitle: hit.subtitle,
                isPickedUp: false,
                checkedOutQuantity: 0,
                quantity: 1
            ))
        }
        Haptics.selection()
    }

    private static func isHidden(_ name: String?) -> Bool {
        guard let name else { return false }
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value.contains("attachment") || value.contains("accessor")
    }
}
