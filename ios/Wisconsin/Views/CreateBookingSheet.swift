import SwiftUI
import TipKit

private enum ReservationSetupMode: String, CaseIterable, Identifiable {
    case event = "Event Linked"
    case manual = "Manual"

    var id: String { rawValue }
}

struct CreateBookingSheet: View {
    private let minimizeReservationTip = MinimizeReservationTip()
    private let scanReservationGearTip = ScanReservationGearTip()
    /// The composer lives in `ReservationDraftStore`, not here: minimizing
    /// tears this view down and it has to come back with everything intact.
    @Bindable var vm: CreateBookingViewModel

    @Environment(ReservationDraftStore.self) private var drafts
    @State private var submitError: String?
    @State private var committedOriginalNotice: String?
    @State private var consolidatedBookingId: String?
    @State private var showExitOptions = false
    @State private var showScanner = false
    @State private var showNotesField = false
    @FocusState private var notesFocused: Bool
    @Environment(SessionStore.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(vm: CreateBookingViewModel) {
        self.vm = vm
    }

    /// Event linking reads the live internal event list, which collaborators
    /// cannot see -- their Schedule is the published snapshot. Without a source
    /// to pick from, the composer stays on the manual window.
    private var canLinkEvents: Bool {
        session.currentUser?.role != "COLLABORATOR"
    }

    private var setupMode: ReservationSetupMode {
        guard canLinkEvents else { return .manual }
        return vm.usesEventLinkedSetup ? .event : .manual
    }

    private func loadEventsIfPermitted() async {
        guard canLinkEvents else { return }
        await vm.loadEvents()
    }

    private var step: Int { drafts.step }

    private func setStep(_ value: Int) {
        drafts.step = value
    }

    private var canContinueToGear: Bool {
        vm.isValid
            && (setupMode == .manual || vm.linkedEventCount > 0)
            && (!vm.isReusingGear || (setupMode == .event && vm.linkedEventCount > 0))
            && !vm.hasInvalidReusedEventSelection
    }

    /// Cancel is the deliberate exit. With unsaved work on the table it asks
    /// whether to keep it as a draft; swipe-down never reaches here because
    /// that minimizes. An already-saved draft the user did not touch closes
    /// without deleting anything — backing out of a draft you opened is not a
    /// request to destroy it.
    private func attemptCancel() {
        if vm.isSubmitting { return }
        if vm.hasUnsavedInput {
            showExitOptions = true
        } else if vm.serverDraftId != nil {
            Task { await drafts.closeKeepingDraft() }
        } else {
            Task { await drafts.discard() }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ReservationStepProgress(currentStep: step)
                Group {
                    if step == 1 {
                        detailsForm
                    } else if step == 2 {
                        equipmentPicker
                    } else {
                        reviewStep
                    }
                }
            }
            .navigationTitle(step == 1 ? "New Reservation" : step == 2 ? "Gear" : "Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if step == 1 {
                    Button {
                        setStep(2)
                        Task { await vm.loadAvailableAssets(reset: true) }
                        vm.scheduleConflictCheck()
                    } label: {
                        Label("Choose Gear", systemImage: "shippingbox")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .tint(Color.statusText(.purple))
                    .disabled(!canContinueToGear || vm.isSubmitting)
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.vertical, 10)
                    .background(.bar)
                    .overlay(alignment: .top) { Divider() }
                } else if step == 3 {
                    Button {
                        Task { await create() }
                    } label: {
                        Group {
                            if vm.isSubmitting {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Text("Create Reservation")
                                    .fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .tint(Color.statusText(.purple))
                    .disabled(vm.isSubmitting)
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.vertical, 10)
                    .background(.bar)
                    .overlay(alignment: .top) { Divider() }
                }
            }
            .alert(
                "Couldn't create reservation",
                isPresented: Binding(
                    get: { submitError != nil },
                    set: { if !$0 { submitError = nil } }
                ),
            ) {
                Button("Retry") {
                    submitError = nil
                    Task { await create() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(submitError ?? "")
            }
            .alert(
                "Original reservation created",
                isPresented: Binding(
                    get: { committedOriginalNotice != nil },
                    set: { if !$0 { committedOriginalNotice = nil } }
                )
            ) {
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text(committedOriginalNotice ?? "")
            }
            .alert(
                "Gear added to existing reservation",
                isPresented: Binding(
                    get: { consolidatedBookingId != nil },
                    set: { if !$0 { consolidatedBookingId = nil } }
                )
            ) {
                Button("Done") {
                    guard let bookingId = consolidatedBookingId else { return }
                    consolidatedBookingId = nil
                    drafts.finish(bookingId: bookingId)
                }
            } message: {
                Text("This gear was combined with the reservation already linked to the same event and title.")
            }
            .confirmationDialog(
                "Save this reservation as a draft?",
                isPresented: $showExitOptions,
                titleVisibility: .visible
            ) {
                Button("Save Draft") {
                    Task { await drafts.saveAndClose() }
                }
                .disabled(drafts.isBusy)
                Button("Discard", role: .destructive) {
                    Task { await drafts.discard() }
                }
                .disabled(drafts.isBusy)
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("A saved draft stays in your bookings until you finish or delete it.")
            }
            // Swipe-down minimizes rather than exits, so it must stay enabled;
            // only an in-flight submit is worth blocking.
            .interactiveDismissDisabled(vm.isSubmitting)
            .task {
                async let optionsTask: Void = vm.loadOptions()
                async let eventsTask: Void = loadEventsIfPermitted()
                _ = await (optionsTask, eventsTask)
                applySelfAndLocationDefaults()
                vm.captureBaselineIfNeeded()
            }
            .task(id: step) {
                guard step == 2 else { return }
                await ScanReservationGearTip.openedGearStep.donate()
            }
            .fullScreenCover(isPresented: $showScanner) {
                // Continuous scanning: the scanner stays open after each hit
                // so a shelf of items is one session; feedback shows in-scanner.
                QRScannerSheet(resolve: { match in
                    switch match {
                    case .asset(let assetId):
                        let outcome = await vm.addScannedAsset(id: assetId)
                        return .continueScanning(message: outcome.message, success: outcome.success)
                    case .itemFamily(let family):
                        let outcome = vm.addScannedFamily(family)
                        return .continueScanning(message: outcome.message, success: outcome.success)
                    }
                })
            }
            .onChange(of: vm.options) {
                applySelfAndLocationDefaults()
                vm.captureBaselineIfNeeded()
            }
            .onAppear {
                vm.captureBaselineIfNeeded()
                // Opened as a transition rather than an initial value so the
                // picker's "starts closed" source contract stays literal.
                if AppRuntimeMode.CaptureSeed.createBookingScanner { showScanner = true }
            }
        }
    }

    private func applySelfAndLocationDefaults() {
        // A resumed draft already carries the requester and pickup location it
        // was saved with; re-applying defaults would silently rewrite them.
        guard vm.serverDraftId == nil else { return }
        if let current = session.currentUser,
           vm.options?.users.contains(where: { $0.id == current.id }) == true {
            vm.selectedUserId = current.id
        }
        if vm.selectedLocationId.isEmpty, let defaultLocation = vm.primaryPickupLocations.first {
            vm.selectedLocationId = defaultLocation.id
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { attemptCancel() }
                .disabled(vm.isSubmitting)
        }
        ToolbarItem(placement: .topBarLeading) {
            if step > 1 {
                Button {
                    setStep(step - 1)
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
                .disabled(vm.isSubmitting)
            }
        }
        ToolbarItemGroup(placement: .confirmationAction) {
            if step == 2 {
                // Review lives on the cart bar in step 2; the toolbar slot
                // hosts scan so it's always reachable above the keyboard.
                Button {
                    scanReservationGearTip.invalidate(reason: .actionPerformed)
                    showScanner = true
                } label: {
                    Image(systemName: "barcode.viewfinder")
                        .popoverTip(scanReservationGearTip, arrowEdge: .top)
                }
                .tint(Color.statusText(.purple))
                .accessibilityLabel("Scan equipment")
                .disabled(vm.isSubmitting)
            }
            // Swipe-down does the same thing, but a visible control is what
            // makes "go look something up and come back" discoverable.
            Button {
                minimizeReservationTip.invalidate(reason: .actionPerformed)
                drafts.minimize()
            } label: {
                Image(systemName: "chevron.down")
                    .popoverTip(minimizeReservationTip, arrowEdge: .top)
            }
            .tint(Color.statusText(.purple))
            .accessibilityLabel("Minimize reservation")
            .accessibilityHint("Keeps this reservation open at the bottom of the screen")
            .disabled(vm.isSubmitting)
            // Step 3's primary action is anchored above the sheet edge so it
            // remains available while the user checks the summary.
        }
    }

    @ViewBuilder
    private var detailsForm: some View {
        ScrollView {
            VStack(spacing: 18) {
                if let sourceTitle = vm.reusedGearSourceTitle {
                    FormCard {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Gear copied from \u{201c}\(sourceTitle)\u{201d}")
                                    .font(.subheadline.weight(.semibold))
                                Text("Choose a different event. Availability will be checked again before saving.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
                                .foregroundStyle(Color.statusText(.purple))
                        }
                    }
                }

                if canLinkEvents && !vm.isReusingGear {
                    FormCard {
                        BrandSectionHeader("Set Schedule From")
                        Picker("Schedule source", selection: setupModeBinding) {
                            ForEach(ReservationSetupMode.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                if setupMode == .event {
                    EventSelectionCard(
                        events: vm.events,
                        selectedEvents: vm.linkedEventsForSetup,
                        isLoading: vm.isLoadingEvents,
                        error: vm.eventError,
                        onRetry: { Task { await vm.loadEvents() } },
                        onToggle: { vm.toggleEvent($0) },
                        onRemove: { vm.removeSelectedEvent($0) }
                    )

                    if vm.linkedEventCount > 0 {
                        reservationTitleCard
                            .transition(detailsTransition)
                        scheduleWindowCard
                            .transition(detailsTransition)
                        if vm.hasInvalidReusedEventSelection {
                            Label("Choose a different event when reusing gear", systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(Color.statusText(.orange))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                } else {
                    reservationTitleCard
                        .transition(detailsTransition)
                    scheduleWindowCard
                        .transition(detailsTransition)
                }

                FormCard {
                    BrandSectionHeader("Pickup Location")
                    if vm.isLoadingOptions {
                        ProgressView("Loading pickup locations")
                            .frame(maxWidth: .infinity, minHeight: 32)
                    } else if vm.primaryPickupLocations.isEmpty {
                        Label("Pickup locations are unavailable", systemImage: "exclamationmark.triangle")
                            .font(.subheadline)
                            .foregroundStyle(Color.statusText(.orange))
                    } else {
                        Picker(
                            "Pickup location",
                            selection: Binding(
                                get: { vm.selectedLocationId },
                                set: { vm.setLocationFromUser($0) }
                            )
                        ) {
                            ForEach(vm.primaryPickupLocations) { location in
                                Text(location.name)
                                    .tag(location.id)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                if vm.notes.isEmpty && !showNotesField {
                    Button {
                        showNotesField = true
                        Task {
                            // Focus after the field exists in the hierarchy.
                            try? await Task.sleep(for: .milliseconds(80))
                            notesFocused = true
                        }
                    } label: {
                        FormCard {
                            Label("Add note", systemImage: "square.and.pencil")
                                .font(.body)
                                .foregroundStyle(Color.statusText(.purple))
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    FormCard {
                        TextField("Notes (optional)", text: $vm.notes, axis: .vertical)
                            .lineLimit(3...6)
                            .font(.body)
                            .focused($notesFocused)
                    }
                }

                if let error = vm.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                }
            }
            .padding(20)
            .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: setupMode)
            .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: vm.linkedEventCount)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var reservationTitleCard: some View {
        FormCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Reservation Title")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                TextField(
                    "Reservation name",
                    text: Binding(
                        get: { vm.title },
                        set: { vm.setTitleFromUser($0) }
                    )
                )
                .font(.title3.weight(.semibold))
                .submitLabel(.next)
            }
        }
    }

    private var scheduleWindowCard: some View {
        FormCard {
            BrandSectionHeader("When")
            QuarterHourDatePickerRow(
                label: "Pickup",
                selection: Binding(
                    get: { vm.startsAt },
                    set: { vm.adjustStart(to: $0) }
                )
            )
            Divider().padding(.leading, 4)
            QuarterHourDatePickerRow(
                label: "Return",
                selection: Binding(
                    get: { vm.endsAt },
                    set: { vm.adjustEnd(to: $0) }
                ),
                minimumDate: vm.startsAt
            )
            if vm.endsAt <= vm.startsAt {
                Label("Return must be after pickup", systemImage: "exclamationmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.statusText(.red))
                    .padding(.top, 6)
            }
        }
    }

    private var detailsTransition: AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top))
    }

    private var setupModeBinding: Binding<ReservationSetupMode> {
        Binding(
            get: { setupMode },
            set: { mode in
                vm.usesEventLinkedSetup = mode == .event
                if mode == .manual {
                    vm.unlinkEvents()
                }
                Haptics.selection()
            }
        )
    }

    private var reviewPickupText: String {
        return vm.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
    }

    private var reviewReturnText: String {
        return vm.endsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
    }

    @ViewBuilder
    private var equipmentPicker: some View {
        CreateBookingEquipmentPicker(vm: vm) {
            setStep(3)
        }
    }

    @ViewBuilder
    private var reviewStep: some View {
        ScrollView {
            VStack(spacing: 16) {
                FormCard {
                    HStack(spacing: 12) {
                        StatusRail(tone: .purple)
                        UserAvatarView(
                            name: vm.selectedUser?.name ?? session.currentUser?.name ?? "User",
                            avatarUrl: vm.selectedUser?.avatarUrl ?? session.currentUser?.avatarUrl,
                            size: 46
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(vm.title.isEmpty ? "Review your reservation" : vm.title)
                                .font(.title3.weight(.bold))
                                .lineLimit(2)
                            Text(vm.selectedUser?.name ?? session.currentUser?.name ?? "")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                }

                FormCard {
                    reviewSectionHeader(title: "Schedule", editStep: 1)
                    reviewDetailRow(
                        icon: "arrow.right",
                        tone: .blue,
                        label: "Pickup",
                        value: reviewPickupText
                    )
                    Divider().padding(.leading, 50)
                    reviewDetailRow(
                        icon: "arrow.left",
                        tone: .purple,
                        label: "Return",
                        value: reviewReturnText
                    )
                    Divider().padding(.leading, 50)
                    reviewDetailRow(
                        icon: "mappin.and.ellipse",
                        tone: .gray,
                        label: "Pickup Location",
                        value: vm.selectedLocation?.name ?? ""
                    )
                    if let linked = vm.linkedEventLabel {
                        Divider().padding(.leading, 50)
                        reviewDetailRow(
                            icon: "calendar.badge.checkmark",
                            tone: .green,
                            label: vm.linkedEventCount > 1 ? "Events" : "Event",
                            value: linked
                        )
                    }
                    if !vm.notes.isEmpty {
                        Divider().padding(.leading, 50)
                        reviewDetailRow(
                            icon: "note.text",
                            tone: .gray,
                            label: "Note",
                            value: vm.notes
                        )
                    }
                }

                if !vm.conflictedAssetIds.isEmpty {
                    let count = vm.conflictedAssetIds.count
                    FormCard {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(Color.statusText(.orange))
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Review \(count) gear conflict\(count == 1 ? "" : "s")")
                                    .font(.subheadline.weight(.semibold))
                                Text("Availability is checked again when you create the reservation.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Button("Review Gear") { setStep(2) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .tint(Color.statusText(.orange))
                        }
                    }
                }

                FormCard {
                    reviewSectionHeader(title: "Gear", count: vm.selectedEquipmentCount, editStep: 2)
                    VStack(spacing: 0) {
                        ForEach(Array(vm.selectedAssets.enumerated()), id: \.element.id) { index, asset in
                            if index > 0 { Divider().padding(.leading, 12) }
                            HStack(spacing: 10) {
                                BookingAssetThumbnail(imageUrl: asset.imageUrl, size: 40, cornerRadius: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(asset.itemListPrimaryTitle)
                                        .font(.gothamBold(size: 16))
                                        .lineLimit(1)
                                    if let subtitle = asset.itemListSecondaryTitle {
                                        Text(subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                if vm.conflictedAssetIds.contains(asset.id) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.caption)
                                        .foregroundStyle(Color.statusText(.orange))
                                        .accessibilityLabel("Scheduling conflict")
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                        if !vm.selectedAssets.isEmpty && !vm.selectedBulkSkus.isEmpty {
                            Divider().padding(.leading, 12)
                        }
                        ForEach(Array(vm.selectedBulkSkus.enumerated()), id: \.element.id) { index, sku in
                            if index > 0 { Divider().padding(.leading, 12) }
                            HStack(spacing: 10) {
                                BookingBulkThumbnail(imageUrl: sku.imageUrl, size: 40, cornerRadius: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(sku.name)
                                        .font(.gothamBold(size: 16))
                                        .lineLimit(1)
                                    if showsBulkSubtitle(sku) {
                                        Text(bulkSubtitle(sku))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                Text("×\(vm.quantity(for: sku))")
                                    .font(.subheadline.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private func reviewSectionHeader(title: String, count: Int? = nil, editStep: Int) -> some View {
        HStack {
            Text(title)
                .font(.headline)
            if let count {
                Text("\(count)")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Edit") { setStep(editStep) }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Color.statusText(.purple))
        }
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private func reviewDetailRow(
        icon: String,
        tone: StatusTone,
        label: String,
        value: String
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.statusText(tone))
                .frame(width: 34, height: 34)
                .background(Color.statusBackground(tone), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.weight(.medium))
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
    }

    private func create() async {
        do {
            switch try await vm.submit() {
            case .created(let bookingId):
                Haptics.success()
                drafts.finish(bookingId: bookingId)
            case .consolidated(let bookingId):
                consolidatedBookingId = bookingId
                Haptics.success()
            case .committedOriginal(_, let preservation):
                committedOriginalNotice = preservation.userMessage
                Haptics.warning()
            }
        } catch APIError.conflict(_) {
            setStep(2)
            vm.scheduleConflictCheck()
            Haptics.warning()
        } catch {
            submitError = error.localizedDescription
            Haptics.warning()
        }
    }

    private func bulkSubtitle(_ sku: FormBulkSku) -> String {
        let unit = sku.unit?.isEmpty == false ? " \(sku.unit!)" : ""
        let pickup = sku.trackByNumber ? " · units scan at pickup" : ""
        return "\(sku.availableQuantity) available\(unit)\(pickup)"
    }

    private func showsBulkSubtitle(_ sku: FormBulkSku) -> Bool {
        let productContext = [sku.categoryName, sku.category, sku.name]
            .compactMap { $0 }
            .joined(separator: " ")
        return !productContext.localizedCaseInsensitiveContains("battery")
    }
}

private struct QuarterHourDatePickerRow: View {
    let label: String
    @Binding var selection: Date
    var minimumDate: Date? = nil

    private let hours = Array(0..<24)
    private let minutes = [0, 15, 30, 45]

    private var dateBinding: Binding<Date> {
        Binding(
            get: { selection },
            set: { newDate in
                let calendar = Calendar.current
                let day = calendar.dateComponents([.year, .month, .day], from: newDate)
                let time = calendar.dateComponents([.hour, .minute], from: selection)
                var merged = DateComponents()
                merged.year = day.year
                merged.month = day.month
                merged.day = day.day
                merged.hour = time.hour
                merged.minute = time.minute
                guard let value = calendar.date(from: merged) else { return }
                selection = max(value, minimumDate ?? .distantPast)
            }
        )
    }

    private var hourBinding: Binding<Int> {
        Binding(
            get: { Calendar.current.component(.hour, from: selection) },
            set: { updateTime(hour: $0, minute: Calendar.current.component(.minute, from: selection)) }
        )
    }

    private var minuteBinding: Binding<Int> {
        Binding(
            get: {
                let minute = Calendar.current.component(.minute, from: selection)
                return minutes.min(by: { abs($0 - minute) < abs($1 - minute) }) ?? 0
            },
            set: { updateTime(hour: Calendar.current.component(.hour, from: selection), minute: $0) }
        )
    }

    private func updateTime(hour: Int, minute: Int) {
        let calendar = Calendar.current
        let day = calendar.dateComponents([.year, .month, .day], from: selection)
        var merged = DateComponents()
        merged.year = day.year
        merged.month = day.month
        merged.day = day.day
        merged.hour = hour
        merged.minute = minute
        guard let value = calendar.date(from: merged) else { return }
        selection = max(value, minimumDate ?? .distantPast)
    }

    private func timeLabel(hour: Int, minute: Int) -> String {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: selection)
        components.hour = hour
        components.minute = minute
        let date = Calendar.current.date(from: components) ?? selection
        return date.formatted(date: .omitted, time: .shortened)
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.body)
            Spacer()
            DatePicker(
                "\(label) date",
                selection: dateBinding,
                in: (minimumDate ?? .distantPast)...,
                displayedComponents: .date
            )
            .labelsHidden()
            .fixedSize()

            HStack(spacing: 4) {
                Picker("\(label) hour", selection: hourBinding) {
                    ForEach(hours, id: \.self) { hour in
                        Text(timeLabel(hour: hour, minute: minuteBinding.wrappedValue)).tag(hour)
                    }
                }
                .pickerStyle(.menu)
                .fixedSize()

                Picker("\(label) minute", selection: minuteBinding) {
                    ForEach(minutes, id: \.self) { minute in
                        Text(timeLabel(hour: hourBinding.wrappedValue, minute: minute)).tag(minute)
                    }
                }
                .pickerStyle(.menu)
                .fixedSize()
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
    }
}

private struct ReservationStepProgress: View {
    let currentStep: Int

    private let labels = ["Details", "Gear", "Review"]

    var body: some View {
        HStack(spacing: Brand.Space.sm) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                let step = index + 1
                HStack(spacing: 6) {
                    Image(systemName: step < currentStep ? "checkmark.circle.fill" : "\(step).circle.fill")
                        .foregroundStyle(step <= currentStep ? Color.statusText(.purple) : Color.secondary)
                    Text(label)
                        .font(.caption.weight(step == currentStep ? .semibold : .regular))
                        .foregroundStyle(step == currentStep ? .primary : .secondary)
                }
                if step < labels.count {
                    Rectangle()
                        .fill(step < currentStep ? Color.statusText(.purple).opacity(0.45) : Color.hairline)
                        .frame(height: 1)
                }
            }
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(currentStep) of 3, \(labels[currentStep - 1])")
    }
}
