import SwiftUI

struct BookingDetailView: View {
    let bookingId: String

    @State private var booking: Booking?
    @State private var conflicts: [String: AssetConflict] = [:]
    @State private var availabilityError: String?
    @State private var returnInsight = CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCancelConfirm = false
    @State private var showExtend = AppRuntimeMode.CaptureSeed.bookingExtend
    @State private var showEdit = AppRuntimeMode.CaptureSeed.bookingEdit
    @State private var showReservationEdit = false
    @State private var showTransferOwner = false
    @State private var showForceComplete = false
    @State private var showForceCheckout = false
    @State private var showCloseRemaining = false
    @State private var showEvents = false
    @State private var showNudgeConfirm = false
    @State private var showCustodyConfirm = false
    @State private var notice: String?
    @State private var isActioning = false
    @State private var showsBarTitle = false
    /// Web guards this call with an AbortController. Without an equivalent, a
    /// pull-to-refresh mid-flight lets the older availability answer land last
    /// and overwrite the newer one.
    @State private var availabilityRequests = LatestRequestGeneration()
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(ReservationDraftStore.self) private var drafts

    private func hasCapability(_ capability: String) -> Bool {
        guard let user = session.currentUser else { return false }
        return user.role != "COLLABORATOR" || (user.capabilities ?? []).contains(capability)
    }

    private var canEditBooking: Bool {
        guard let booking else { return false }
        return booking.allows("edit") ?? legacyCanEdit(booking)
    }

    private func legacyCanEdit(_ booking: Booking) -> Bool {
        guard let user = session.currentUser else { return false }
        let role = user.role
        if role == "STAFF" || role == "ADMIN" { return true }
        if role == "COLLABORATOR" {
            return hasCapability("RESERVATION_EDIT_OWN")
                && booking.kind == .reservation
                && booking.requester.id == user.id
                && (booking.status == .draft || booking.status == .booked)
        }
        // Students can edit their own bookings while still mutable.
        return booking.requester.id == user.id
            && (booking.status == .draft || booking.status == .booked)
    }

    private func legacyCanAct(on booking: Booking) -> Bool {
        guard let user = session.currentUser else { return false }
        let role = user.role
        if role == "STAFF" || role == "ADMIN" { return true }
        if role == "COLLABORATOR" {
            let canMutate = hasCapability("RESERVATION_EDIT_OWN")
                || hasCapability("RESERVATION_CANCEL_OWN")
                || hasCapability("RESERVATION_EXTEND_OWN")
            return canMutate && booking.kind == .reservation && booking.requester.id == user.id
        }
        return booking.requester.id == user.id
    }

    private var canExtendBooking: Bool {
        guard let booking else { return false }
        let legacyAllowed = legacyCanAct(on: booking)
            && hasCapability("RESERVATION_EXTEND_OWN")
            && (booking.status == .booked || booking.status == .open)
        return booking.allows("extend") ?? legacyAllowed
    }

    private var canCancelBooking: Bool {
        guard let booking else { return false }
        let legacyAllowed = legacyCanAct(on: booking)
            && hasCapability("RESERVATION_CANCEL_OWN")
            && (booking.status == .booked || booking.status == .pendingPickup)
        return booking.allows("cancel") ?? legacyAllowed
    }

    private var canReuseReservationGear: Bool {
        booking?.allows("duplicate") == true
    }

    private var canNudgeBooking: Bool {
        booking?.allows("nudge") == true
    }

    private var canForceComplete: Bool {
        booking?.kind == .checkout && booking?.allows("force-complete") == true
    }

    private var canForceCheckout: Bool {
        booking?.kind == .reservation && booking?.allows("force-checkout") == true
    }

    private var pickupHasStarted: Bool {
        guard let booking, booking.kind == .reservation, booking.status == .booked else { return false }
        if booking.serializedItems.contains(where: { $0.allocationStatus?.lowercased() == "picked_up" }) {
            return true
        }
        if booking.bulkItems.contains(where: { $0.checkedOutQuantity > 0 }) { return true }
        return booking.derivedCheckouts?.isEmpty == false
    }

    private var canCloseRemaining: Bool {
        booking?.allows("close-remaining") == true && pickupHasStarted
    }

    private var canTransferOwner: Bool {
        guard let booking else { return false }
        if let allowed = booking.allows("transfer-owner") { return allowed }
        guard let user = session.currentUser, user.role != "COLLABORATOR" else { return false }
        if booking.custodyScope == "SHARED" { return false }
        let canOwn = user.role == "STAFF" || user.role == "ADMIN" || booking.requester.id == user.id
        return canOwn && [.draft, .booked, .pendingPickup, .open].contains(booking.status)
    }

    private var canManageCustody: Bool {
        booking?.kind == .checkout && booking?.allows("manage-custody") == true
    }

    private var canEditLinkedEvents: Bool {
        canEditBooking && booking?.kind == .checkout
    }

    private var usesActionMenu: Bool {
        [
            canEditBooking,
            canReuseReservationGear,
            canNudgeBooking,
            canForceComplete,
            canForceCheckout,
            canCloseRemaining,
            canTransferOwner,
            canManageCustody,
            canEditLinkedEvents,
        ].filter { $0 }.count > 1
    }

    var body: some View {
        Group {
            if isLoading && booking == nil {
                BookingDetailSkeleton()
            } else if let error, booking == nil {
                ContentUnavailableView {
                    Label("Couldn't load booking", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await loadBooking() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if let booking {
                List {
                    BookingHeroSection(booking: booking)

                    BookingTimelineSection(
                        booking: booking,
                        returnInsight: returnInsight
                    )

                    BookingAboutSection(booking: booking)

                    if !booking.serializedItems.isEmpty || !booking.bulkItems.isEmpty {
                        EquipmentSection(
                            serializedItems: booking.serializedItems,
                            bulkItems: booking.bulkItems,
                            conflicts: conflicts,
                            bookingStatus: booking.status,
                            availabilityError: availabilityError,
                            bookingStartsAt: booking.startsAt,
                            bookingEndsAt: booking.endsAt,
                            onRetryAvailability: { Task { await loadConflicts(for: booking) } }
                        )
                    }
                    if BookingActivityAccess.canRead(role: session.currentUser?.role) {
                        Section {
                            NavigationLink {
                                BookingActivityView(bookingId: booking.id)
                            } label: {
                                Label("Activity", systemImage: "clock.arrow.circlepath")
                                    .frame(minHeight: 44, alignment: .leading)
                            }
                            .accessibilityLabel("Activity")
                            .accessibilityHint("Shows what changed on this booking")
                        }
                    }
                    if canCancelBooking {
                        ActionsSection(
                            isActioning: isActioning,
                            onCancel: { showCancelConfirm = true }
                        )
                    }
                    if error != nil || notice != nil {
                        Section {
                            if let errorMsg = error {
                                Text(errorMsg)
                                    .font(.footnote)
                                    .foregroundStyle(Color.statusText(.red))
                            }
                            if let notice {
                                Text(notice)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .listRowBackground(Color.clear)
                    }
                }
                .listStyle(.insetGrouped)
                .listSectionSpacing(Brand.Space.md)
                // The hero already shows the name, so the bar only picks it up
                // once the hero has scrolled away.
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.contentInsets.top > 96
                } action: { _, scrolledPastHero in
                    withAnimation(.easeInOut(duration: 0.2)) { showsBarTitle = scrolledPastHero }
                }
            }
        }
        .navigationTitle(booking?.title ?? "Booking")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(booking?.title ?? "Booking")
                    .font(.headline)
                    .lineLimit(1)
                    .opacity(showsBarTitle || booking == nil ? 1 : 0)
                    .accessibilityAddTraits(.isHeader)
            }
            if usesActionMenu {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        bookingActionMenu
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Booking actions")
                }
            } else if canEditBooking {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { beginEdit() } label: {
                        Label("Edit Details", systemImage: "pencil")
                            .frame(minHeight: 44)
                    }
                    .accessibilityLabel("Edit booking details")
                }
            } else if canReuseReservationGear {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { reuseReservationGear() } label: {
                        Label("Re-reserve", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                            .frame(minHeight: 44)
                    }
                    .accessibilityLabel("Re-reserve for another event")
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if canExtendBooking {
                BookingExtendBar(
                    isActioning: isActioning,
                    onExtend: { showExtend = true }
                )
            }
        }
        .task {
            await loadBooking()
            // A confirmation dialog needs a state transition, not a true
            // initial value, so the cancel capture flips it after the booking
            // it describes has actually loaded.
            if AppRuntimeMode.CaptureSeed.bookingCancel { showCancelConfirm = true }
        }
        .refreshable { await loadBooking() }
        .sheet(isPresented: $showExtend) {
            if let booking {
                ExtendBookingSheet(booking: booking) { updatedBooking in
                    install(updatedBooking)
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let booking {
                EditBookingSheet(booking: booking) { updatedBooking in
                    install(updatedBooking)
                }
            }
        }
        .sheet(isPresented: $showReservationEdit) {
            if let booking {
                ReservationEditFlow(booking: booking) { updatedBooking in
                    install(updatedBooking)
                }
            }
        }
        .sheet(isPresented: $showTransferOwner) {
            if let booking {
                TransferBookingOwnerSheet(booking: booking) { updatedBooking in
                    install(updatedBooking)
                }
            }
        }
        .sheet(isPresented: $showForceComplete) {
            if let booking {
                BookingReasonSheet(
                    title: "Close without scan?",
                    message: "Use this only when an admin has physically verified every item is back. The checkout will close and the exception will be recorded in history.",
                    confirmTitle: "Close checkout",
                    placeholder: "Example: Scanner offline. All gear was verified on the shelf."
                ) { reason in
                    let updated = try await APIClient.shared.forceCompleteCheckout(id: booking.id, reason: reason)
                    install(updated)
                }
            }
        }
        .sheet(isPresented: $showForceCheckout) {
            if let booking {
                BookingReasonSheet(
                    title: "Force checkout?",
                    message: "Use this only when an admin has physically verified the handoff. This bypasses kiosk scan verification, opens checkout custody for the remaining gear, and records the exception in history.",
                    confirmTitle: "Force checkout",
                    placeholder: "Example: Kiosk unavailable. The handoff was verified by an admin."
                ) { reason in
                    let updated = try await APIClient.shared.forceCheckoutReservation(id: booking.id, reason: reason)
                    install(updated)
                }
            }
        }
        .sheet(isPresented: $showCloseRemaining) {
            if let booking {
                CloseRemainingSheet(booking: booking) { note in
                    let updated = try await APIClient.shared.closeReservationRemaining(id: booking.id, reason: note)
                    install(updated)
                }
            }
        }
        .sheet(isPresented: $showEvents) {
            if let booking {
                BookingEventsSheet(booking: booking) { updatedBooking in
                    install(updatedBooking)
                }
            }
        }
        .confirmationDialog("Cancel Booking", isPresented: $showCancelConfirm, titleVisibility: .visible) {
            Button("Cancel Booking", role: .destructive) {
                Task { await cancelBooking() }
            }
            Button("Keep Booking", role: .cancel) {}
        } message: {
            Text("This cannot be undone.")
        }
        .confirmationDialog("Nudge borrower?", isPresented: $showNudgeConfirm, titleVisibility: .visible) {
            Button("Send nudge") { Task { await nudgeBorrower() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Send a reminder about this overdue checkout.")
        }
        .confirmationDialog(
            booking?.custodyScope == "SHARED" ? "Make this a personal checkout?" : "Make this a shared checkout?",
            isPresented: $showCustodyConfirm,
            titleVisibility: .visible
        ) {
            Button(booking?.custodyScope == "SHARED" ? "Make personal" : "Make shared") {
                Task { await toggleCustody() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(booking?.custodyScope == "SHARED"
                 ? "This checkout will belong to its requester again."
                 : "Shared checkouts belong to the travel case, not one person.")
        }
    }

    @ViewBuilder
    private var bookingActionMenu: some View {
        if canEditBooking {
            Button { beginEdit() } label: {
                Label("Edit Details", systemImage: "pencil")
            }
            .accessibilityLabel("Edit booking details")
            .disabled(isActioning)
        }
        if canNudgeBooking {
            Button { showNudgeConfirm = true } label: {
                Label("Nudge borrower", systemImage: "bell")
            }
            .disabled(isActioning)
        }
        if canForceComplete {
            Button { showForceComplete = true } label: {
                Label("Close without scan", systemImage: "checkmark.shield")
            }
            .disabled(isActioning)
        }
        if canForceCheckout {
            Button { showForceCheckout = true } label: {
                Label("Force checkout", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
            }
            .disabled(isActioning)
        }
        if canCloseRemaining {
            Button { showCloseRemaining = true } label: {
                Label("Close without remaining gear", systemImage: "archivebox")
            }
            .disabled(isActioning)
        }
        if canTransferOwner {
            Button { showTransferOwner = true } label: {
                Label("Transfer Ownership", systemImage: "person.2")
            }
            .disabled(isActioning)
        }
        if canManageCustody {
            Button { showCustodyConfirm = true } label: {
                Label(
                    booking?.custodyScope == "SHARED" ? "Make personal checkout" : "Make shared checkout",
                    systemImage: "person.2.badge.gearshape"
                )
            }
            .disabled(isActioning)
        }
        if canEditLinkedEvents {
            Button { showEvents = true } label: {
                Label("Edit linked events", systemImage: "calendar")
            }
            .disabled(isActioning)
        }
        if canReuseReservationGear {
            Button { reuseReservationGear() } label: {
                Label("Re-reserve for Another Event", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
            }
            .disabled(isActioning)
        }
    }

    private func beginEdit() {
        guard let booking else { return }
        if booking.kind == .reservation {
            showReservationEdit = true
        } else {
            showEdit = true
        }
    }

    private func loadBooking() async {
        isLoading = true
        error = nil
        notice = nil
        do {
            let loaded = try await APIClient.shared.booking(id: bookingId)
            booking = loaded
            isLoading = false
            await loadConflicts(for: loaded)
            await loadReturnInsight(for: loaded)
            await reconcileLiveActivity(afterLoading: loaded)
        } catch {
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    /// Surface per-item scheduling conflicts on active bookings, mirroring the
    /// web Equipment tab. A failed refresh never clears an existing result or
    /// makes the booking look clear; server enforcement remains authoritative.
    private func loadConflicts(for booking: Booking) async {
        guard session.currentUser?.role != "COLLABORATOR" else {
            conflicts = [:]
            availabilityError = nil
            return
        }
        let activeStatuses: Set<BookingStatus> = [.draft, .booked, .pendingPickup, .open]
        guard activeStatuses.contains(booking.status), !booking.serializedItems.isEmpty else {
            conflicts = [:]
            availabilityError = nil
            return
        }
        let requestToken = availabilityRequests.begin()
        let outcome = await APIClient.shared.checkAvailabilityOutcome(
            locationId: booking.location.id,
            serializedAssetIds: booking.serializedItems.map(\.assetId),
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            excludeBookingId: booking.id,
            bookingKind: booking.kind
        )
        guard availabilityRequests.owns(requestToken) else { return }
        if let result = outcome.result {
            conflicts = result.conflictsByAssetId
            availabilityError = nil
        } else {
            availabilityError = outcome.errorMessage ?? "Availability could not be refreshed. Try again."
        }
    }

    private func loadReturnInsight(for booking: Booking) async {
        guard session.currentUser?.role != "COLLABORATOR" else {
            returnInsight = CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
            return
        }
        guard booking.kind == .checkout, booking.status == .open else {
            returnInsight = CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
            return
        }
        returnInsight = await APIClient.shared.checkoutReturnInsight(for: booking)
    }

    private func reconcileLiveActivity(afterLoading booking: Booking) async {
        if booking.kind == .checkout, booking.status != .open {
            await CheckoutReturnLiveActivityManager.shared.endAll()
        } else {
            await CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts(
                requesterId: session.currentUser?.id
            )
        }
    }

    private func install(_ updatedBooking: Booking) {
        booking = updatedBooking
        error = nil
        Task {
            await loadConflicts(for: updatedBooking)
            await loadReturnInsight(for: updatedBooking)
            await reconcileLiveActivity(afterLoading: updatedBooking)
        }
    }

    private func cancelBooking() async {
        if isActioning { return }
        isActioning = true
        do {
            let cancelled = try await APIClient.shared.cancelBooking(id: bookingId)
            booking = cancelled
            conflicts = [:]
            availabilityError = nil
            returnInsight = CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
            await reconcileLiveActivity(afterLoading: cancelled)
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        isActioning = false
    }

    private func reuseReservationGear() {
        guard let booking else { return }
        isActioning = true
        Task {
            do {
                let plan = try await APIClient.shared.bookingReusePlan(id: booking.id)
                let composer = CreateBookingViewModel()
                composer.prefillForReuse(from: plan)
                drafts.start(composer)
                Haptics.selection()
            } catch {
                self.error = error.localizedDescription
                Haptics.warning()
            }
            isActioning = false
        }
    }

    private func nudgeBorrower() async {
        if isActioning { return }
        isActioning = true
        defer { isActioning = false }
        do {
            let alreadyNudged = try await APIClient.shared.nudgeCheckout(id: bookingId)
            notice = alreadyNudged ? "Already nudged this hour." : "Reminder sent."
            error = nil
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            notice = nil
            Haptics.warning()
        }
    }

    private func toggleCustody() async {
        guard let booking, let updatedAt = booking.updatedAt else {
            error = "Refresh this checkout before changing custody."
            return
        }
        if isActioning { return }
        isActioning = true
        defer { isActioning = false }
        do {
            let next = booking.custodyScope == "SHARED" ? "PERSON" : "SHARED"
            let updated = try await APIClient.shared.updateCheckoutCustody(
                id: booking.id,
                custodyScope: next,
                updatedAt: updatedAt
            )
            install(updated)
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }

}

// MARK: - Edit and ownership sheets

private enum ReturnAvailabilityState: Equatable {
    case unchanged
    case checking
    case available
    case unavailable(String)
    case failed
}

struct EditBookingSheet: View {
    @Environment(\.today) private var today
    let booking: Booking
    let onSaved: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var title: String
    @State private var endsAt: Date
    @State private var ownerName: String
    @State private var ownerAvatarURL: String?
    @State private var availability: ReturnAvailabilityState = .unchanged
    @State private var isSaving = false
    @State private var error: String?
    @State private var showDiscardConfirm = false
    @State private var showTransfer = false
    @State private var didTransfer = false
    @State private var showsReturnCalendar = AppRuntimeMode.CaptureSeed.bookingEdit

    init(booking: Booking, onSaved: @escaping (Booking) -> Void) {
        self.booking = booking
        self.onSaved = onSaved
        _title = State(wrappedValue: booking.title)
        _endsAt = State(wrappedValue: booking.endsAt)
        _ownerName = State(wrappedValue: booking.requester.name)
        _ownerAvatarURL = State(wrappedValue: booking.requester.avatarUrl)
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasChanges: Bool {
        trimmedTitle != booking.title || endsAt != booking.endsAt
    }

    private var canTransfer: Bool {
        guard let user = session.currentUser, user.role != "COLLABORATOR" else { return false }
        let canOwn = user.role == "STAFF" || user.role == "ADMIN" || booking.requester.id == user.id
        return canOwn && [.draft, .booked, .pendingPickup, .open].contains(booking.status)
    }

    private var canSave: Bool {
        guard hasChanges, !trimmedTitle.isEmpty, endsAt > booking.startsAt, !isSaving else { return false }
        switch availability {
        case .checking, .unavailable: return endsAt == booking.endsAt
        case .unchanged, .available, .failed: return true
        }
    }

    /// Why Save is off, so a grayed-out button never has to be guessed at.
    private var saveBlocker: String? {
        guard hasChanges, !isSaving else { return nil }
        if trimmedTitle.isEmpty { return "Give the booking a name to save." }
        if endsAt <= booking.startsAt { return "The return has to be after pickup." }
        if case .checking = availability, endsAt != booking.endsAt { return "Checking the new return time…" }
        if case .unavailable = availability, endsAt != booking.endsAt { return "Pick a return time when the gear is free." }
        return nil
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Booking name", text: $title)
                        .font(.gothamBold(size: 18))
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                        .accessibilityLabel("Booking name")
                } header: {
                    Text("Name")
                }

                Section {
                    LabeledContent("Pickup") {
                        Text(booking.startsAt.operationalDateTimeLabel(now: today))
                            .multilineTextAlignment(.trailing)
                    }
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { showsReturnCalendar.toggle() }
                    } label: {
                        LabeledContent("Due back") {
                            Text(endsAt.operationalDateTimeLabel(now: today))
                                .foregroundStyle(showsReturnCalendar ? Color.statusText(.blue) : Color.primary)
                                .multilineTextAlignment(.trailing)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(showsReturnCalendar ? "Hides the calendar" : "Shows a calendar to change the return")
                    if showsReturnCalendar {
                        ReturnTimeCalendar(
                            selection: $endsAt,
                            minimum: QuarterHour.roundedUp(booking.startsAt.addingTimeInterval(15 * 60))
                        )
                    }
                } header: {
                    Text("When")
                } footer: {
                    availabilityMessage
                }

                if canTransfer {
                    Section {
                        Button { showTransfer = true } label: {
                            HStack(spacing: Brand.Space.sm) {
                                UserAvatarView(name: ownerName, avatarUrl: ownerAvatarURL, size: 40)
                                Text(ownerName)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text("Transfer")
                                    .foregroundStyle(.secondary)
                                Image(systemName: "chevron.right")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        // Plain so the row reads as a row, not red link text.
                        .buttonStyle(.plain)
                        .accessibilityLabel("Owner, \(ownerName). Transfer Ownership")
                    } header: {
                        Text("Owner")
                    }
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(Brand.Space.md)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let saveBlocker {
                    Text(saveBlocker)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(.bar)
                }
            }
            .navigationTitle("Edit Booking")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges { showDiscardConfirm = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if isSaving { ProgressView().controlSize(.small) }
                        else { Text("Save").fontWeight(.semibold) }
                    }
                    .disabled(!canSave)
                }
            }
            .task(id: endsAt) { await checkAvailability() }
            .navigationDestination(isPresented: $showTransfer) {
                TransferBookingOwnerSheet(booking: booking, wrapsInNavigationStack: false) { transferred in
                    ownerName = transferred.requester.name
                    ownerAvatarURL = transferred.requester.avatarUrl
                    didTransfer = true
                    onSaved(transferred)
                }
            }
            .onChange(of: showTransfer) { _, isPresented in
                if !isPresented && didTransfer { dismiss() }
            }
            .interactiveDismissDisabled(hasChanges || isSaving)
            .confirmationDialog("Discard changes?", isPresented: $showDiscardConfirm, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
    }

    @ViewBuilder
    private var availabilityMessage: some View {
        switch availability {
        case .unchanged:
            EmptyView()
        case .checking:
            Label("Checking gear availability…", systemImage: "clock")
                .foregroundStyle(.secondary)
        case .available:
            Label("This return time works", systemImage: "checkmark.circle.fill")
                .foregroundStyle(Color.statusText(.green))
        case .unavailable(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
        case .failed:
            Label("Availability will be checked again when you save.", systemImage: "wifi.exclamationmark")
                .foregroundStyle(Color.statusText(.orange))
        }
    }

    private func checkAvailability() async {
        guard endsAt != booking.endsAt, endsAt > booking.startsAt else {
            availability = .unchanged
            return
        }
        availability = .checking
        do {
            try await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            let result = try await APIClient.shared.bookingAvailability(for: booking, endsAt: endsAt)
            guard !Task.isCancelled else { return }
            availability = result.isAvailable ? .available : .unavailable(result.issueSummary)
        } catch is CancellationError {
            return
        } catch {
            availability = .failed
        }
    }

    private func save() async {
        guard canSave else { return }
        isSaving = true
        error = nil
        do {
            let updatedBooking = try await APIClient.shared.updateBooking(
                id: booking.id,
                title: trimmedTitle != booking.title ? trimmedTitle : nil,
                endsAt: endsAt != booking.endsAt ? endsAt : nil,
                updatedAt: booking.updatedAt
            )
            Haptics.success()
            onSaved(updatedBooking)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        isSaving = false
    }
}

struct TransferBookingOwnerSheet: View {
    let booking: Booking
    let wrapsInNavigationStack: Bool
    let onTransferred: (Booking) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var options: FormOptions?
    @State private var selectedUserId = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var error: String?

    init(
        booking: Booking,
        wrapsInNavigationStack: Bool = true,
        onTransferred: @escaping (Booking) -> Void
    ) {
        self.booking = booking
        self.wrapsInNavigationStack = wrapsInNavigationStack
        self.onTransferred = onTransferred
    }

    private var eligibleUsers: [FormUser] {
        (options?.users ?? []).filter { $0.id != booking.requester.id }
    }

    private var selectedUser: FormUser? {
        eligibleUsers.first { $0.id == selectedUserId }
    }

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack {
                transferContent
            }
        } else {
            transferContent
        }
    }

    private var transferContent: some View {
            List {
                Section {
                    ownerRow(label: "Current", name: booking.requester.name, avatarURL: booking.requester.avatarUrl)
                    if isLoading {
                        HStack { ProgressView(); Text("Loading people…").foregroundStyle(.secondary); Spacer() }
                            .padding(.vertical, 12)
                    } else {
                        NavigationLink {
                            RequesterPickerView(
                                users: eligibleUsers,
                                currentUserId: session.currentUser?.id,
                                selection: $selectedUserId
                            )
                        } label: {
                            ownerRow(
                                label: "New Owner",
                                name: selectedUser?.name ?? "Select person",
                                avatarURL: selectedUser?.avatarUrl
                            )
                        }
                    }
                } header: {
                    Text("Choose a new owner")
                } footer: {
                    Text("They'll become responsible for \(booking.title) and receive its booking updates.")
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Transfer Ownership")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Pushed from Edit, the back button already leaves; a second
                // Cancel crowded the bar and squeezed the title.
                if wrapsInNavigationStack {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }.disabled(isSaving)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await transfer() } } label: {
                        if isSaving { ProgressView().controlSize(.small) }
                        else { Text("Transfer").fontWeight(.semibold) }
                    }
                    .disabled(selectedUserId.isEmpty || isSaving)
                }
            }
            .task { await loadPeople() }
            .interactiveDismissDisabled(isSaving)
    }

    private func ownerRow(label: String, name: String, avatarURL: String?) -> some View {
        HStack(spacing: Brand.Space.sm) {
            UserAvatarView(name: name, avatarUrl: avatarURL, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
            }
            Spacer()
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private func loadPeople() async {
        do {
            options = try await APIClient.shared.formOptions()
        } catch {
            self.error = "Couldn't load people. Try again."
        }
        isLoading = false
    }

    private func transfer() async {
        guard !selectedUserId.isEmpty else { return }
        isSaving = true
        error = nil
        do {
            let transferred = try await APIClient.shared.transferBookingOwner(
                id: booking.id,
                targetUserId: selectedUserId,
                updatedAt: booking.updatedAt
            )
            Haptics.success()
            onTransferred(transferred)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
        isSaving = false
    }
}

// MARK: - Sub-sections

/// Status, name and timing. The status word carries the screen's one accent;
/// everything else stays in the system's primary and secondary text.
private struct BookingHeroSection: View {
    let booking: Booking

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let now = context.date
            let tone = booking.detailTone(now: now)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.statusText(tone))
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(booking.detailStatusWord(now: now))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.statusText(tone))
                    if let timing = timingLabel(now: now) {
                        Text("· \(timing)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText())
                    }
                }
                .accessibilityElement(children: .combine)
                Text(booking.title)
                    .font(.gothamBold(size: 28))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 0, trailing: 4))
    }

    private func timingLabel(now: Date) -> String? {
        switch booking.status {
        case .open:
            let label = Date.countdownLabel(for: booking.endsAt, now: now)
            if label.hasPrefix("OVERDUE BY ") {
                return "\(label.dropFirst("OVERDUE BY ".count)) late"
            }
            return "due in \(label.dropFirst("DUE BACK IN ".count))"
        case .pendingPickup, .booked:
            let pickup = Date.startCountdown(for: booking.startsAt, now: now)
            if pickup.isLate {
                return pickup.body == "less than a minute" ? "pickup due now" : "pickup \(pickup.body) late"
            }
            return "pickup in \(pickup.body)"
        case .draft: return "not submitted yet"
        case .completed, .cancelled, .unknown: return nil
        }
    }
}

/// Pickup and return side by side, like a trip. While gear is out a thin bar
/// shows how much of the window has passed, in the booking's status color.
private struct BookingTimelineSection: View {
    @Environment(\.today) private var today
    let booking: Booking
    let returnInsight: CheckoutReturnInsight

    var body: some View {
        Section {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                let now = context.date
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        endpoint(label: startLabel, date: booking.startsAt, alignment: .leading)
                        Spacer(minLength: Brand.Space.md)
                        Image(systemName: "arrow.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .padding(.top, 22)
                            .accessibilityHidden(true)
                        Spacer(minLength: Brand.Space.md)
                        endpoint(label: endLabel, date: booking.endsAt, alignment: .trailing)
                    }
                    if booking.status == .open {
                        progressBar(now: now)
                    }
                }
                .padding(.vertical, 6)
            }

            if returnInsight.hasUpcomingNeed {
                Label {
                    Text(nextNeedMessage)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "calendar.badge.exclamationmark")
                }
                .font(.subheadline)
                .foregroundStyle(Color.statusText(.orange))
            }
        }
    }

    private var startLabel: String {
        booking.status == .open || booking.status == .completed ? "Picked up" : "Pickup"
    }

    private var endLabel: String {
        booking.status == .completed ? "Returned by" : "Due back"
    }

    private func endpoint(label: String, date: Date, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(date.operationalDayLabel(now: today))
                .font(.subheadline)
                .foregroundStyle(.primary)
            Text(date.gearTime)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(.primary)
        }
        .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(date.operationalDateTimeLabel(now: today))")
    }

    private func progressBar(now: Date) -> some View {
        let span = booking.endsAt.timeIntervalSince(booking.startsAt)
        let elapsed = now.timeIntervalSince(booking.startsAt)
        let fraction = span > 0 ? min(max(elapsed / span, 0), 1) : 1
        return GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.tertiarySystemFill))
                Capsule()
                    .fill(Color.statusText(booking.detailTone(now: now)))
                    .frame(width: max(proxy.size.width * fraction, 4))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }

    /// Names the booking waiting on this gear when the server says which one,
    /// so the warning reads as a person's plan rather than a vague limit.
    private var nextNeedMessage: String {
        guard let nextNeedAt = returnInsight.nextNeedAt else {
            return "Needed again soon. Choose an earlier return time when extending."
        }
        let when = nextNeedAt.operationalDateTimeLabel(now: today, capitalizesRelativeDay: false)
        if let title = returnInsight.nextNeedTitle {
            return "\(title) needs this gear \(when). Extend only to a return time by then."
        }
        return "Needed again \(when). Extend only to a return time by then."
    }
}

/// Who it belongs to, plus the event and notes when they add something the
/// name doesn't already say.
private struct BookingAboutSection: View {
    let booking: Booking

    private var eventSummaries: [String] {
        booking.linkedEvents.compactMap { $0.summary?.nonBlankText }
            .filter { $0.caseInsensitiveCompare(booking.title) != .orderedSame }
    }

    var body: some View {
        Section {
            HStack(spacing: Brand.Space.sm) {
                UserAvatarView(
                    name: booking.requester.name,
                    avatarUrl: booking.requester.avatarUrl,
                    size: 40
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(booking.requester.name)
                        .font(.body.weight(.semibold))
                    Text(booking.location.name)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)

            ForEach(Array(eventSummaries.enumerated()), id: \.offset) { _, summary in
                Label(summary, systemImage: "calendar")
            }

            if let kiosk = booking.pickupKioskDevice {
                Label("Picked up at \(kiosk.name)", systemImage: "qrcode.viewfinder")
            }

            if let notes = booking.notes?.nonBlankText {
                Label {
                    Text(notes)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "text.alignleft")
                }
            }
        }
    }
}

private extension Booking {
    /// One tone for the whole detail screen, matching the list row colors:
    /// red late, orange missed pickup, blue out, purple reserved.
    func detailTone(now: Date) -> StatusTone {
        switch status {
        case .open:
            return endsAt <= now ? .red : .blue
        case .pendingPickup:
            return startsAt < now ? .orange : .purple
        case .booked:
            return kind == .checkout && startsAt < now ? .orange : .purple
        case .draft, .completed, .cancelled, .unknown:
            return .gray
        }
    }

    func detailStatusWord(now: Date) -> String {
        switch status {
        case .open: return endsAt <= now ? "Overdue" : "Checked out"
        case .pendingPickup: return "Waiting on pickup"
        case .booked: return kind == .checkout ? "Waiting on pickup" : "Reserved"
        case .draft: return "Draft"
        case .completed: return kind == .checkout ? "Returned" : "Complete"
        case .cancelled: return "Cancelled"
        case .unknown: return "Booking"
        }
    }
}

/// Single gear list mirroring the web booking detail: serialized gear
/// first, then bulk items, under one header whose count is the combined total.
private struct EquipmentSection: View {
    let serializedItems: [BookingSerializedItem]
    let bulkItems: [BookingBulkItem]
    let conflicts: [String: AssetConflict]
    let bookingStatus: BookingStatus
    let availabilityError: String?
    let bookingStartsAt: Date
    let bookingEndsAt: Date
    let onRetryAvailability: (() -> Void)?

    var body: some View {
        Section {
            if let availabilityError {
                HStack(alignment: .top, spacing: 8) {
                    Label(availabilityError, systemImage: "wifi.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.orange))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if let onRetryAvailability {
                        Button("Retry", action: onRetryAvailability)
                            .font(.footnote.weight(.semibold))
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
            }
            ForEach(serializedItems) { item in
                serializedRow(item)
            }
            ForEach(bulkItems) { item in
                bulkRow(item)
            }
        } header: {
            Text("Gear · \(serializedItems.count + bulkItems.count)")
        }
    }

    @ViewBuilder
    private func serializedRow(_ item: BookingSerializedItem) -> some View {
        let conflict = conflicts[item.assetId]
        let isReturned = bookingStatus == .open && item.allocationStatus?.lowercased() == "returned"
        HStack(spacing: 10) {
            AssetThumbnail(imageUrl: item.asset.imageUrl, size: 40)
                .opacity(isReturned ? 0.55 : 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.asset.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                if let subtitle = item.asset.itemListSecondaryTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let conflict {
                    Text(conflictMessage(conflict))
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(.red))
                        .lineLimit(2)
                }
            }
            .opacity(isReturned ? 0.55 : 1)
            Spacer()
            if isReturned {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.statusText(.green))
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel(item: item, conflict: conflict, isReturned: isReturned))
    }

    @ViewBuilder
    private func bulkRow(_ item: BookingBulkItem) -> some View {
        let units = item.assignedUnitNumbers
        let isReturned = bookingStatus == .open
            && item.checkedOutQuantity > 0
            && item.checkedInQuantity >= item.checkedOutQuantity
        HStack(spacing: 10) {
            BookingBulkThumbnail(imageUrl: item.bulkSku.imageUrl, size: 40, cornerRadius: 6)
                .opacity(isReturned ? 0.55 : 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.itemListPrimaryTitle)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                if let subtitle = item.itemListSecondaryTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .opacity(isReturned ? 0.55 : 1)
            Spacer()
            if isReturned {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.statusText(.green))
                    .accessibilityHidden(true)
            } else {
                Text("×\(item.plannedQuantity)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(bulkRowAccessibilityLabel(item: item, quantity: item.plannedQuantity, units: units, isReturned: isReturned))
    }

    private func bulkRowAccessibilityLabel(item: BookingBulkItem, quantity: Int, units: [Int], isReturned: Bool) -> String {
        var label = "\(item.itemListPrimaryTitle), quantity \(quantity)"
        if let subtitle = item.itemListSecondaryTitle {
            label += ", \(subtitle)"
        }
        if !units.isEmpty {
            label += ", units " + units.map(String.init).joined(separator: ", ")
        }
        if isReturned { label += ", returned" }
        return label
    }

    private func rowAccessibilityLabel(item: BookingSerializedItem, conflict: AssetConflict?, isReturned: Bool) -> String {
        var parts: [String] = []
        if isReturned { parts.append("Returned") }
        if conflict != nil { parts.append("Conflict") }
        parts.append(item.asset.itemListPrimaryTitle)
        if let subtitle = item.asset.itemListSecondaryTitle { parts.append(subtitle) }
        if let conflict {
            parts.append(conflictMessage(conflict))
        }
        return parts.joined(separator: ", ")
    }

    private func conflictMessage(_ conflict: AssetConflict) -> String {
        let title = conflict.conflictingBookingTitle.map { "Conflict with \($0)" } ?? "Scheduling conflict"
        guard let startsAt = conflict.startsAt, let endsAt = conflict.endsAt else {
            return "\(title); choose another item or change the dates."
        }
        let window = "\(startsAt.gearShort) – \(endsAt.gearShort)"
        let buffer: TimeInterval = 60 * 60
        if startsAt >= bookingEndsAt {
            return "\(title) (\(window)); return by \(startsAt.addingTimeInterval(-buffer).gearShort)."
        }
        if endsAt <= bookingStartsAt {
            return "\(title) (\(window)); available after \(endsAt.addingTimeInterval(buffer).gearShort)."
        }
        return "\(title) (\(window)); choose another item or change the dates."
    }
}

private struct ActionsSection: View {
    let isActioning: Bool
    let onCancel: () -> Void

    var body: some View {
        Section {
            Button(role: .destructive) {
                onCancel()
            } label: {
                Group {
                    if isActioning {
                        ProgressView()
                    } else {
                        Text("Cancel Booking")
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .disabled(isActioning)
            .accessibilityLabel(isActioning ? "Cancelling booking" : "Cancel Booking")
        }
    }
}

/// The one primary action on the screen, in the same green as Claim.
private struct BookingExtendBar: View {
    let isActioning: Bool
    let onExtend: () -> Void

    var body: some View {
        Button {
            onExtend()
        } label: {
            Text("Extend Return")
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .tint(.green)
        .disabled(isActioning)
        .accessibilityLabel("Extend Return")
        .padding(.horizontal, Brand.Space.md)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }
}

// MARK: - Shared

struct ScalePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}
