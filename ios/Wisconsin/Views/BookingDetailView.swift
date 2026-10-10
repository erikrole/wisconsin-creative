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
    @State private var isActioning = false
    /// The header card already names the booking; the bar repeats it only
    /// once that card has scrolled out of view.
    @State private var headerScrolledAway = false
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
                ScrollView {
                    LazyVStack(spacing: Brand.Space.md) {
                        BookingDetailsSection(booking: booking)

                        // Gear first: what is out, or about to be, is what
                        // people open a booking to check.
                        if !booking.serializedItems.isEmpty || !booking.bulkItems.isEmpty {
                            FormCard {
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
                        }

                        FormCard {
                            BookingOverviewSection(
                                booking: booking,
                                returnInsight: returnInsight
                            )
                        }
                        if let errorMsg = error {
                            Text(errorMsg)
                                .font(.footnote)
                                .foregroundStyle(Color.statusText(.red))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.top, Brand.Space.sm)
                    .padding(.bottom, Brand.Space.lg)
                }
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.contentInsets.top > 80
                } action: { _, scrolledAway in
                    withAnimation(.easeInOut(duration: 0.15)) { headerScrolledAway = scrolledAway }
                }
                .background(Color(.systemGroupedBackground))
            }
        }
        .navigationTitle(booking?.title ?? "Booking")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(booking?.title ?? "Booking")
                    .font(.headline)
                    .lineLimit(1)
                    .opacity(booking == nil || headerScrolledAway ? 1 : 0)
                    .accessibilityHidden(booking != nil && !headerScrolledAway)
            }
            // A word, not a pencil: "Edit" is the system's own label for
            // changing what is on screen, and it reads the same in every role.
            if canEditBooking {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { showEdit = true }
                        .fontWeight(.semibold)
                        .accessibilityLabel("Edit booking details")
                }
            }
            if canReuseReservationGear {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { reuseReservationGear() } label: {
                            Label("Re-reserve for Another Event", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("More booking actions")
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if canExtendBooking || canCancelBooking {
                BookingActionBar(
                    isActioning: isActioning,
                    onExtend: canExtendBooking ? { showExtend = true } : nil,
                    onCancel: canCancelBooking ? { showCancelConfirm = true } : nil
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
        .confirmationDialog("Cancel Booking", isPresented: $showCancelConfirm, titleVisibility: .visible) {
            Button("Cancel Booking", role: .destructive) {
                Task { await cancelBooking() }
            }
            Button("Keep Booking", role: .cancel) {}
        } message: {
            Text("This cannot be undone.")
        }
    }

    private func loadBooking() async {
        isLoading = true
        error = nil
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

    /// Reservation purple, checkout blue -- the booking's own color.
    private var kindTone: StatusTone {
        booking.kind == .reservation ? .purple : .blue
    }

    private func factRow<Content: View>(_ title: String, @ViewBuilder value: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Brand.Space.sm) {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: Brand.Space.md)
            value()
                .font(.subheadline.weight(.medium))
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }

    /// Who the booking belongs to, with Transfer on the same row when allowed,
    /// so the owner is named once rather than in a header and a button.
    private var ownerRow: some View {
        HStack(spacing: Brand.Space.sm) {
            UserAvatarView(name: ownerName, avatarUrl: ownerAvatarURL, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(ownerName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                if canTransfer {
                    Text("Transfer Ownership")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(.blue))
                } else {
                    Text("Owner")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if canTransfer {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .brandCard()
    }

    @ViewBuilder
    private var ownerCard: some View {
        if canTransfer {
            Button { showTransfer = true } label: { ownerRow }
                .buttonStyle(.plain)
                .accessibilityLabel("Owner \(ownerName). Transfer Ownership")
        } else {
            ownerRow
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Brand.Space.md) {
                    FormCard {
                        VStack(alignment: .leading, spacing: Brand.Space.sm) {
                            BrandSectionHeader("Booking Name")
                            // A visible field, so the name reads as editable
                            // rather than as a second title.
                            HStack(spacing: 8) {
                                TextField("Booking name", text: $title)
                                    .font(.body.weight(.semibold))
                                    .textInputAutocapitalization(.words)
                                    .submitLabel(.done)
                                    .accessibilityLabel("Booking name")
                                if !title.isEmpty {
                                    Button { title = "" } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.tertiary)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Clear booking name")
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 11)
                            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
                        }
                    }

                    FormCard {
                        VStack(alignment: .leading, spacing: 0) {
                            BrandSectionHeader("Return")
                                .padding(.bottom, Brand.Space.xs)
                            // Label-leading, value-trailing, as on Booking detail.
                            factRow("Pickup") {
                                Text(booking.startsAt.operationalDateTimeLabel(now: today))
                            }
                            Divider()
                            factRow("Due back") {
                                Text(chipDayTime(endsAt))
                                    .foregroundStyle(Color.statusText(kindTone))
                            }
                            DayTimeChipPicker(
                                selection: $endsAt,
                                minimum: booking.startsAt,
                                tint: Color.statusText(kindTone)
                            )
                            .padding(.top, 4)
                            .padding(.bottom, 8)

                            availabilityMessage
                        }
                    }

                    ownerCard

                    Text("Gear and pickup details stay read-only on your phone. Physical handoff and returns remain kiosk workflows.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Brand.Space.xs)

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, Brand.Space.xs)
                    }
                }
                .padding(Brand.Space.md)
            }
            .background(Color(.systemGroupedBackground))
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
            ScrollView {
                VStack(spacing: Brand.Space.md) {
                    VStack(spacing: Brand.Space.sm) {
                        Image(systemName: "person.2.fill")
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(Color.statusText(.blue))
                            .frame(width: 54, height: 54)
                            .background(Color.statusBackground(.blue), in: Circle())
                        Text("Choose a new owner")
                            .font(.title3.weight(.bold))
                        Text("They'll become responsible for \(booking.title) and receive its booking updates.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .brandCard()

                    FormCard {
                        VStack(spacing: 0) {
                            ownerRow(label: "Current", name: booking.requester.name, avatarURL: booking.requester.avatarUrl)
                            Divider().padding(.leading, 48)
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
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(Brand.Space.md)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Transfer Ownership")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
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
            if label == "New Owner" {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 10)
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

private struct BookingDetailsSection: View {
    let booking: Booking

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            HStack(alignment: .center, spacing: 12) {
                StatusRail(tone: tone(now: context.date))
                UserAvatarView(
                    name: booking.requester.name,
                    avatarUrl: booking.requester.avatarUrl,
                    size: 52
                )
                VStack(alignment: .leading, spacing: 3) {
                    Text(booking.title)
                        .font(.gothamBold(size: 24))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(requesterLine)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text(timingLabel(now: context.date))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(tone(now: context.date)))
                        .contentTransition(.numericText())
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .contain)
        }
        .brandCard()
    }

    private var itemCount: Int {
        booking.serializedItems.count + booking.bulkItems.reduce(0) { $0 + $1.plannedQuantity }
    }

    /// Requester and how much gear, the same meta line the list row carries.
    private var requesterLine: String {
        guard itemCount > 0 else { return booking.requester.name }
        return "\(booking.requester.name) · \(itemCount) item\(itemCount == 1 ? "" : "s")"
    }

    private func pickupIsLate(now: Date) -> Bool {
        let awaitingPickup = booking.status == .pendingPickup || booking.status == .booked
        return awaitingPickup && booking.startsAt < now
    }

    private func tone(now: Date) -> StatusTone {
        if booking.status == .open {
            return Date.bookingUrgency(startsAt: booking.startsAt, endsAt: booking.endsAt, now: now).tone
        }
        if booking.status == .pendingPickup || (booking.kind == .checkout && booking.status == .booked) {
            return Date.startCountdown(for: booking.startsAt, now: now).tone
        }
        // A reservation whose pickup has passed reads orange, as it does on
        // the list's rail.
        if booking.status == .booked && pickupIsLate(now: now) { return .orange }
        switch booking.status {
        case .booked: return .purple
        case .draft, .completed, .cancelled, .unknown: return .gray
        case .pendingPickup: return .orange
        case .open: return .blue
        }
    }

    /// "<State> · <when>", using the list's state words (Due back, Overdue,
    /// Awaiting pickup, Pickup missed, Reserved) so a row and its detail
    /// describe a booking the same way.
    private func timingLabel(now: Date) -> String {
        switch booking.status {
        case .open:
            let label = Date.countdownLabel(for: booking.endsAt, now: now)
            if label.hasPrefix("OVERDUE BY ") {
                return "Overdue · by \(label.dropFirst("OVERDUE BY ".count))"
            }
            return "Due back · in \(label.dropFirst("DUE BACK IN ".count))"
        case .pendingPickup:
            return checkoutPickupLabel(now: now)
        case .booked:
            if booking.kind == .checkout {
                return checkoutPickupLabel(now: now)
            }
            if pickupIsLate(now: now) {
                let pickup = Date.startCountdown(for: booking.startsAt, now: now)
                return "Pickup missed · \(pickup.body) late"
            }
            return "Reserved · pickup \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))"
        case .draft: return "Draft · finish before pickup"
        case .completed: return "Returned"
        case .cancelled: return "Cancelled"
        case .unknown: return "Booking status unavailable"
        }
    }

    private func checkoutPickupLabel(now: Date) -> String {
        let pickup = Date.startCountdown(for: booking.startsAt, now: now)
        if pickup.isLate {
            return pickup.body == "less than a minute"
                ? "Awaiting pickup · due now"
                : "Pickup missed · \(pickup.body) late"
        }
        return "Awaiting pickup · in \(pickup.body)"
    }
}

private struct BookingOverviewSection: View {
    @Environment(\.today) private var today
    let booking: Booking
    let returnInsight: CheckoutReturnInsight

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandSectionHeader("Schedule")
                .padding(.bottom, Brand.Space.xs)

            let eventSummaries = booking.linkedEvents.compactMap { $0.summary?.nonBlankText }
            if !eventSummaries.isEmpty {
                overviewRow(title: eventSummaries.count == 1 ? "Event" : "Events") {
                    VStack(alignment: .trailing, spacing: 4) {
                        ForEach(Array(eventSummaries.enumerated()), id: \.offset) { _, summary in
                            Text(summary)
                        }
                    }
                }
                rowDivider
            }

            overviewRow(title: "Pickup") {
                Text(detailDate(booking.startsAt))
            }

            rowDivider

            overviewRow(title: "Return") {
                Text(detailDate(booking.endsAt))
            }
            if returnInsight.hasUpcomingNeed {
                Text(returnInsight.nextNeedAt.map { "Needed again \($0.operationalDateTimeLabel(now: today, capitalizesRelativeDay: false)). Extend only to a return time by then." } ?? "Needed again soon. Choose an earlier return time when extending.")
                    .font(.caption)
                    .foregroundStyle(Color.statusText(.orange))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 9)
            }

            // Only once there is something to say: an unrecorded kiosk is the
            // normal state until pickup, not a fact worth a row.
            if let kiosk = booking.pickupKioskDevice {
                rowDivider
                overviewRow(title: "Pickup Kiosk") {
                    Text("\(kiosk.name), \(kiosk.location.name)")
                }
            }
        }
    }

    /// Label leading, value trailing -- the Settings row shape, so the card
    /// reads as a short list of facts rather than a stack of captioned blocks.
    private func overviewRow<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Brand.Space.sm) {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: Brand.Space.md)
            content()
                .font(.subheadline.weight(.medium))
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }

    private var rowDivider: some View {
        Divider()
    }

    private func detailDate(_ date: Date) -> String {
        date.operationalDateTimeLabel(now: today)
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
        VStack(alignment: .leading, spacing: Brand.Space.xs) {
            BrandSectionHeader(title: "Gear") {
                // Units, not lines: the header above counts "6 items" for two
                // cameras and four batteries, and this has to agree.
                Text("\(serializedItems.count + bulkItems.reduce(0) { $0 + $1.plannedQuantity })")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if let availabilityError {
                HStack(alignment: .top, spacing: 8) {
                    Label(availabilityError, systemImage: "wifi.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.orange))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if let onRetryAvailability {
                        Button("Retry", action: onRetryAvailability)
                            .font(.caption.weight(.semibold))
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            }
            // One run of rows with the Schedule card's dividers and rhythm,
            // thumbnails on the same leading edge as the header.
            ForEach(Array(serializedItems.enumerated()), id: \.element.id) { index, item in
                if index > 0 { gearDivider }
                serializedRow(item)
            }
            ForEach(Array(bulkItems.enumerated()), id: \.element.id) { index, item in
                if index > 0 || !serializedItems.isEmpty { gearDivider }
                bulkRow(item)
            }
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
            if conflict != nil {
                StatusPill(label: "Conflict", tone: .red, emphasized: true)
            }
            if isReturned {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.statusText(.green))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, isReturned ? Brand.Space.xs : 0)
        .padding(.vertical, 8)
        .background(isReturned ? Color.statusBackground(.green) : Color.clear, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
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
        .padding(.horizontal, isReturned ? Brand.Space.xs : 0)
        .padding(.vertical, 8)
        .background(isReturned ? Color.statusBackground(.green) : Color.clear, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(bulkRowAccessibilityLabel(item: item, quantity: item.plannedQuantity, units: units, isReturned: isReturned))
    }

    /// Starts past the thumbnail, under the item name.
    private var gearDivider: some View {
        Divider().padding(.leading, 50)
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

/// The booking's two actions, pinned above the tab bar. Extend is the
/// everyday one and gets the filled button; Cancel sits beside it, smaller and
/// outlined, and still asks before it does anything. Alone, either one spans
/// the bar.
private struct BookingActionBar: View {
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    let isActioning: Bool
    let onExtend: (() -> Void)?
    let onCancel: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            if let onCancel {
                Button(role: .destructive, action: onCancel) {
                    Label(onExtend == nil ? "Cancel Booking" : "Cancel", systemImage: "xmark")
                        .frame(maxWidth: onExtend == nil ? .infinity : nil)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(Color.statusText(.red))
                .accessibilityLabel(isActioning ? "Cancelling booking" : "Cancel Booking")
            }
            if let onExtend {
                Button(action: onExtend) {
                    Label("Extend Return Date", systemImage: "clock.arrow.circlepath")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        // The dark-mode blue fill is bright; a white label on
                        // it fails contrast, so the label follows the token
                        // made for status-filled controls.
                        .foregroundStyle(Color.statusControlForeground(.blue, contrast: colorSchemeContrast))
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(Color.statusText(.blue))
                .accessibilityLabel("Extend Return Date")
            }
        }
        .disabled(isActioning)
        .lineLimit(1)
        .padding(.horizontal, Brand.Space.md)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
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
