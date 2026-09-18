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

    private var showsPlanDetails: Bool {
        setupMode == .manual || vm.linkedEventCount > 0
    }

    private var continueBlockedReason: String? {
        guard !canContinueToGear, !vm.isSubmitting else { return nil }
        if setupMode == .event && vm.linkedEventCount == 0 {
            return "Choose an event to continue."
        }
        if vm.hasInvalidReusedEventSelection {
            return "Choose a different event when re-reserving."
        }
        if vm.endsAt <= vm.startsAt {
            return "Return must be after pickup."
        }
        if vm.selectedLocationId.isEmpty {
            return vm.isLoadingOptions
                ? "Loading pickup locations…"
                : "Choose a pickup location to continue."
        }
        if vm.title.trimmingCharacters(in: .whitespaces).isEmpty {
            return "Name this reservation to continue."
        }
        if vm.selectedUserId.isEmpty {
            return "Couldn't identify the requester."
        }
        return nil
    }

    private var showsGamedayKit: Bool {
        !vm.selectedLocationId.isEmpty
            && (vm.kitsLoading || vm.kitsLoadError != nil || !vm.kits.isEmpty)
    }

    private var selectedKit: BookingKitOption? {
        vm.kits.first(where: { $0.id == vm.selectedKitId })
    }

    private func goToStep(_ value: Int) {
        guard value >= 1, value < step, !vm.isSubmitting else { return }
        setStep(value)
        Haptics.selection()
    }

    private func continueToGear() {
        guard canContinueToGear, !vm.isSubmitting else { return }
        setStep(2)
        Task { await vm.loadAvailableAssets(reset: true) }
        vm.scheduleConflictCheck()
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
            Group {
                if step == 2 {
                    equipmentPicker
                        .safeAreaInset(edge: .top, spacing: 0) {
                            ReservationStepProgress(currentStep: step, onSelect: goToStep)
                        }
                } else {
                    VStack(spacing: 0) {
                        ReservationStepProgress(currentStep: step, onSelect: goToStep)
                        if step == 1 {
                            detailsForm
                        } else {
                            reviewStep
                        }
                    }
                }
            }
            .navigationTitle(step == 1 ? "New Reservation" : step == 2 ? "Gear" : "Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if step == 1 {
                    detailsFooter
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
                await vm.loadKits()
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
        if #available(iOS 27.0, *) {
            ToolbarItemGroup(placement: .confirmationAction) {
                trailingToolbarActions
            }
            .visibilityPriority(.high)
        } else {
            ToolbarItemGroup(placement: .confirmationAction) {
                trailingToolbarActions
            }
        }
    }

    @ViewBuilder
    private var trailingToolbarActions: some View {
        if step == 2 {
            if vm.showsBrowseCategoryFilter {
                Picker(selection: browseCategorySelection) {
                    Text("All").tag(String?.none)
                    ForEach(vm.browseCategories, id: \.self) { category in
                        Text(category).tag(Optional(category))
                    }
                } label: {
                    Label(
                        vm.browseCategoryFilter ?? "All",
                        systemImage: vm.browseCategoryFilter == nil
                            ? "line.3.horizontal.decrease"
                            : "line.3.horizontal.decrease.circle.fill"
                    )
                }
                .pickerStyle(.menu)
                .listControlTint(isActive: vm.browseCategoryFilter != nil)
                .accessibilityLabel("Filter equipment, \(vm.browseCategoryFilter ?? "All")")
            }
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

    private var browseCategorySelection: Binding<String?> {
        Binding(
            get: { vm.browseCategoryFilter },
            set: { value in
                vm.browseCategoryFilter = value
                Haptics.selection()
            }
        )
    }

    @ViewBuilder
    private var detailsFooter: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let continueBlockedReason {
                Text(continueBlockedReason)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(continueBlockedReason)
            }
            Button(action: continueToGear) {
                Label("Choose Gear", systemImage: "shippingbox")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(Color.statusText(.purple))
            .disabled(!canContinueToGear || vm.isSubmitting)
            .accessibilityHint(continueBlockedReason ?? "Opens equipment selection")
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    @ViewBuilder
    private var detailsForm: some View {
        ScrollView {
            VStack(spacing: Brand.Space.md) {
                if let sourceTitle = vm.reusedGearSourceTitle {
                    FormCard {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Copied from \u{201c}\(sourceTitle)\u{201d}")
                                    .font(.subheadline.weight(.semibold))
                                Text("Choose this week’s event. Pickup and return follow the same timing as last time, and availability is checked again before saving.")
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
                        if setupMode == .event {
                            Divider().padding(.leading, 4)
                            EventSelectionCard(
                                events: vm.events,
                                selectedEvents: vm.linkedEventsForSetup,
                                isLoading: vm.isLoadingEvents,
                                error: vm.eventError,
                                usesFormCard: false,
                                onRetry: { Task { await vm.loadEvents() } },
                                onToggle: { vm.toggleEvent($0) },
                                onRemove: { vm.removeSelectedEvent($0) }
                            )
                        }
                    }
                } else if setupMode == .event {
                    EventSelectionCard(
                        events: vm.events,
                        selectedEvents: vm.linkedEventsForSetup,
                        isLoading: vm.isLoadingEvents,
                        error: vm.eventError,
                        onRetry: { Task { await vm.loadEvents() } },
                        onToggle: { vm.toggleEvent($0) },
                        onRemove: { vm.removeSelectedEvent($0) }
                    )
                }

                if showsPlanDetails {
                    reservationPlanCard
                        .transition(detailsTransition)
                    if setupMode == .event, vm.hasInvalidReusedEventSelection {
                        Label("Choose a different event when re-reserving", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.orange))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    pickupAndKitCard

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
                }

                if let error = vm.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                }
            }
            .padding(Brand.Space.lg)
            .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: setupMode)
            .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: vm.linkedEventCount)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var reservationPlanCard: some View {
        FormCard {
            reservationTitleCard
            Divider().padding(.leading, 4)
            scheduleWindowCard
        }
    }

    private var pickupAndKitCard: some View {
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

            if showsGamedayKit {
                Divider().padding(.leading, 4)
                BrandSectionHeader("Gameday Kit")
                if vm.kitsLoading && vm.kits.isEmpty {
                    ProgressView("Loading kits")
                        .frame(maxWidth: .infinity, minHeight: 32)
                } else if let kitsLoadError = vm.kitsLoadError {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(kitsLoadError, systemImage: "exclamationmark.triangle")
                            .font(.subheadline)
                            .foregroundStyle(Color.statusText(.orange))
                        Button("Retry") { Task { await vm.loadKits() } }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Picker(
                            "Gameday kit",
                            selection: Binding(
                                get: { vm.selectedKitId },
                                set: { vm.selectKit($0) }
                            )
                        ) {
                            Text("None").tag("")
                            ForEach(vm.kits) { kit in
                                Text(vm.kitPickerLabel(kit)).tag(kit.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(Color.statusText(.purple))
                        if selectedKit != nil {
                            Text("Adds cameras, lenses, and batteries. The reservation keeps the event name.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var reservationTitleCard: some View {
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

    private var scheduleWindowCard: some View {
        VStack(alignment: .leading, spacing: 8) {
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
                    .padding(.top, 2)
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
        vm.startsAt.operationalDateTimeLabel()
    }

    private var reviewReturnText: String {
        vm.endsAt.operationalDateTimeLabel()
    }

    @ViewBuilder
    private var equipmentPicker: some View {
        CreateBookingEquipmentPicker(vm: vm) {
            setStep(3)
        }
    }

    @ViewBuilder
    private var reviewStep: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    UserAvatarView(
                        name: vm.selectedUser?.name ?? session.currentUser?.name ?? "User",
                        avatarUrl: vm.selectedUser?.avatarUrl ?? session.currentUser?.avatarUrl,
                        size: 44
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(reviewDisplayTitle)
                            .font(.headline)
                            .lineLimit(2)
                        Text(vm.selectedUser?.name ?? session.currentUser?.name ?? "")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
            }

            Section {
                LabeledContent("Pickup", value: reviewPickupText)
                LabeledContent("Return", value: reviewReturnText)
                LabeledContent("Pickup Location", value: vm.selectedLocation?.name ?? "")
                if let linked = vm.linkedEventLabel {
                    LabeledContent {
                        Text(linked)
                    } label: {
                        Label(
                            vm.linkedEventCount > 1 ? "Events" : "Event",
                            systemImage: "calendar.badge.checkmark"
                        )
                    }
                }
                if let kit = selectedKit {
                    LabeledContent("Gameday Kit", value: vm.kitPickerLabel(kit))
                }
                if !vm.notes.isEmpty {
                    LabeledContent("Note", value: vm.notes)
                }
            } header: {
                reviewSectionHeader(title: "Schedule", editStep: 1)
            }

            if vm.selectedConflictCount > 0 {
                let count = vm.selectedConflictCount
                Section {
                    Button("Review Gear") { setStep(2) }
                } header: {
                    Label(
                        "Remove \(count) conflict\(count == 1 ? "" : "s") before creating.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                }
            }

            Section {
                ForEach(vm.selectedAssets) { asset in
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
                            if let caption = vm.availabilityCaption(for: asset.id) {
                                Text(caption.text)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(Color.statusText(caption.tone))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                ForEach(vm.selectedBulkSkus) { sku in
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
                }
            } header: {
                reviewSectionHeader(title: "Gear", count: vm.selectedEquipmentCount, editStep: 2)
            }
        }
        .tint(Color.statusText(.purple))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var reviewDisplayTitle: String {
        if vm.linkedEventCount == 1, let linked = vm.linkedEventLabel {
            return linked
        }
        let title = vm.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { return "Review your reservation" }
        return title.bookingMatchupPrimary
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
                .textCase(.none)
        }
        .textCase(.none)
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

    private let quarterHours = Array(0..<96)

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

    private var quarterBinding: Binding<Int> {
        Binding(
            get: {
                let components = Calendar.current.dateComponents([.hour, .minute], from: selection)
                let minutes = (components.hour ?? 0) * 60 + (components.minute ?? 0)
                return min(95, max(0, Int((Double(minutes) / 15).rounded())))
            },
            set: { quarter in
                let calendar = Calendar.current
                let day = calendar.dateComponents([.year, .month, .day], from: selection)
                var merged = DateComponents()
                merged.year = day.year
                merged.month = day.month
                merged.day = day.day
                merged.hour = (quarter * 15) / 60
                merged.minute = (quarter * 15) % 60
                guard let value = calendar.date(from: merged) else { return }
                selection = max(value, minimumDate ?? .distantPast)
            }
        )
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            controls(showsLabel: true)
            VStack(alignment: .leading, spacing: 8) {
                Text(label)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                controls(showsLabel: false)
            }
        }
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func controls(showsLabel: Bool) -> some View {
        HStack(spacing: 8) {
            if showsLabel {
                Text(label)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                Spacer(minLength: 8)
            }
            DatePicker(
                "\(label) date",
                selection: dateBinding,
                displayedComponents: .date
            )
            .labelsHidden()
            .fixedSize()
            .tint(Color.statusText(.purple))

            Picker("\(label) time", selection: quarterBinding) {
                ForEach(quarterHours, id: \.self) { quarter in
                    Text(timeLabel(for: quarter)).tag(quarter)
                }
            }
            .pickerStyle(.menu)
            .fixedSize()
            .tint(Color.statusText(.purple))

            if !showsLabel {
                Spacer(minLength: 0)
            }
        }
    }

    private func timeLabel(for quarter: Int) -> String {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: .now)
        let date = calendar.date(byAdding: .minute, value: quarter * 15, to: start) ?? start
        return date.formatted(date: .omitted, time: .shortened)
    }
}

private struct ReservationStepProgress: View {
    let currentStep: Int
    var onSelect: (Int) -> Void

    private let labels = ["Details", "Gear", "Review"]

    var body: some View {
        HStack(spacing: Brand.Space.sm) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                let step = index + 1
                stepControl(step: step, title: label)
                if step < labels.count {
                    Rectangle()
                        .fill(step < currentStep ? Color.statusText(.purple).opacity(0.45) : Color.hairline)
                        .frame(height: 1)
                        .accessibilityHidden(true)
                }
            }
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func stepControl(step: Int, title: String) -> some View {
        if step < currentStep {
            Button {
                onSelect(step)
            } label: {
                stepLabel(step: step, title: title)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(title), completed")
            .accessibilityHint("Goes back to \(title)")
        } else {
            stepLabel(step: step, title: title)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(step == currentStep ? "\(title), current step" : "\(title), not started")
        }
    }

    private func stepLabel(step: Int, title: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: step < currentStep ? "checkmark.circle.fill" : "\(step).circle.fill")
                .foregroundStyle(step <= currentStep ? Color.statusText(.purple) : Color.secondary)
            Text(title)
                .font(.caption.weight(step == currentStep ? .semibold : .regular))
                .foregroundStyle(step == currentStep ? .primary : .secondary)
        }
        .frame(minHeight: 28)
        .contentShape(Rectangle())
    }
}
