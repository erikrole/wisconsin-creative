import SwiftUI
import TipKit

enum BookingScope: String {
    case mine
    case all
}

private enum BookingListAction: Identifiable {
    case edit(Booking)
    case transfer(Booking)
    case extend(Booking)

    var id: String {
        switch self {
        case .edit(let booking): "edit-\(booking.id)"
        case .transfer(let booking): "transfer-\(booking.id)"
        case .extend(let booking): "extend-\(booking.id)"
        }
    }
}

@MainActor
@Observable
final class BookingsViewModel {
    var bookings: [Booking] = [] {
        didSet {
            sortedBookings = bookings.sorted(by: Self.operationalTimeSort)
        }
    }
    var isLoading = false
    var error: String?
    var pageError: String?
    var searchText = ""
    var hasMore = true
    /// Native list scope. Students, staff, and admins default to All;
    /// collaborators stay on their own gear unless they are in an explicit preview.
    var scope: BookingScope = .all
    var currentUserId: String?
    var currentUserRole = ""

    var mineOnly: Bool {
        get { scope == .mine }
        set { scope = newValue ? .mine : .all }
    }

    private var offset = 0
    private let limit = 30
    private var searchTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?
    private var loadRequests = LatestRequestGeneration()
    private var didApplyUserDefault = false

    var isEmpty: Bool { bookings.isEmpty }

    private(set) var sortedBookings: [Booking] = []

    func applyUserContext(id: String?, role: String?) {
        currentUserId = id
        currentUserRole = role ?? ""
        guard !didApplyUserDefault else { return }
        scope = currentUserRole == "COLLABORATOR" ? .mine : .all
        didApplyUserDefault = true
    }

    func load(reset: Bool = false, clearExistingRows: Bool = false) async {
        if reset {
            // Cancel any in-flight load so a tab switch / refresh wins.
            loadTask?.cancel()
        } else if isLoading {
            // Pagination: ignore if a load is already running.
            return
        }
        let requestToken = loadRequests.begin()
        let task = Task {
            await performLoad(
                reset: reset,
                clearExistingRows: clearExistingRows,
                requestToken: requestToken
            )
        }
        loadTask = task
        await task.value
    }

    private func performLoad(reset: Bool, clearExistingRows: Bool, requestToken: UUID) async {
        if reset {
            offset = 0
            hasMore = true
            pageError = nil
            if clearExistingRows {
                bookings = []
            }
        }
        isLoading = true
        if reset { error = nil }
        defer {
            if loadRequests.owns(requestToken) { isLoading = false }
        }
        do {
            let search = searchText.isEmpty ? nil : searchText
            let requesterId = mineOnly ? currentUserId : nil
            let result = try await fetchBookings(search: search, requesterId: requesterId)
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            if reset {
                bookings = result.data
            } else {
                bookings += result.data
            }
            offset += result.data.count
            hasMore = offset < result.total
            pageError = nil
            if reset && searchText.isEmpty && scope == .all {
                GearStore.shared.seedBookings(result.data)
            }
            await CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts(
                requesterId: currentUserId
            )
        } catch is CancellationError {
            // Superseded by a newer load; leave state alone.
        } catch {
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            if reset {
                self.error = error.localizedDescription
            } else {
                self.pageError = error.localizedDescription
                hasMore = false
            }
        }
    }

    private func fetchBookings(search: String?, requesterId: String?, filter: String? = nil) async throws -> PaginatedResponse<Booking> {
        guard hasMore else {
            return PaginatedResponse(data: [], total: offset, limit: limit, offset: offset)
        }
        return try await APIClient.shared.bookings(
            activeOnly: true,
            search: search,
            requesterId: requesterId,
            filter: filter,
            limit: limit,
            offset: offset
        )
    }

    /// One merged list ordered by the next operational handoff: scheduled
    /// pickup for a reservation, due-back time for gear already checked out.
    private static func operationalTime(for booking: Booking) -> Date {
        booking.kind == .reservation ? booking.startsAt : booking.endsAt
    }

    private static func operationalTimeSort(_ lhs: Booking, _ rhs: Booking) -> Bool {
        let lhsTime = operationalTime(for: lhs)
        let rhsTime = operationalTime(for: rhs)
        if lhsTime != rhsTime { return lhsTime < rhsTime }
        return lhs.id < rhs.id
    }

    func retryPage() async {
        pageError = nil
        hasMore = true
        await load()
    }

    func install(_ booking: Booking) {
        bookings = bookings.map { $0.id == booking.id ? booking : $0 }
    }

    func onSearchChange() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await load(reset: true, clearExistingRows: true)
        }
    }

    func resetDefaults() {
        searchTask?.cancel()
        loadTask?.cancel()
        loadRequests.invalidate()
        searchText = ""
        scope = currentUserRole == "COLLABORATOR" ? .mine : .all
        bookings = []
        offset = 0
        hasMore = true
        error = nil
        pageError = nil
        isLoading = false
    }
}

struct BookingsView: View {
    private let newReservationTip = NewReservationTip()
    @State private var vm = BookingsViewModel()
    @State private var presentedAction: BookingListAction?
    @State private var cancelTarget: Booking?
    @State private var navigationPath = NavigationPath()
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(ReservationDraftStore.self) private var drafts

    private var canCreateForOthers: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var canCreate: Bool {
        guard let user = session.currentUser else { return false }
        return user.role != "COLLABORATOR" || (user.capabilities ?? []).contains("RESERVATION_CREATE")
    }

    private var isCollaborator: Bool {
        session.currentUser?.role == "COLLABORATOR"
    }

    private var showsEmptyCreateAction: Bool {
        canCreate
            && vm.isEmpty
            && !vm.isLoading
            && vm.error == nil
            && vm.searchText.isEmpty
            && vm.scope == .all
    }

    private var emptyTitle: String {
        guard vm.searchText.isEmpty else { return "No matches" }
        switch vm.scope {
        case .mine: return "You're all clear"
        case .all: return "No active bookings"
        }
    }

    private var emptyIcon: String {
        guard vm.searchText.isEmpty else { return "magnifyingglass" }
        return vm.scope == .mine ? "checkmark.seal.fill" : "calendar.badge.plus"
    }

    private var emptyTone: StatusTone {
        guard vm.searchText.isEmpty else { return .gray }
        return vm.scope == .mine ? .green : .purple
    }

    private var emptyDescription: String {
        if !vm.searchText.isEmpty { return "No bookings match \"\(vm.searchText)\"." }
        if vm.scope == .mine {
            return "You don't have any active checkouts or reservations."
        }
        return "Create a reservation when you need gear."
    }

    /// Apply a dashboard scope hint. Urgency tiles deliberately land on All.
    private func consumePendingScope() {
        guard let hint = appState.pendingBookingsScope else { return }
        appState.pendingBookingsScope = nil
        if let scope = BookingScope(rawValue: hint), vm.scope != scope {
            vm.scope = scope
        }
    }

    private var searchPrompt: String {
        "Search bookings..."
    }

    private var showsSearch: Bool {
        if !vm.searchText.isEmpty { return true }
        let visibleCount = vm.bookings.count
        return !vm.isLoading && visibleCount > 0 && (visibleCount > 4 || vm.hasMore)
    }

    var body: some View {
        // Apple's recommended pattern for binding to an @Observable model.
        @Bindable var vm = vm
        return NavigationStack(path: $navigationPath) {
            VStack(spacing: 0) {
                Group {
                    if let error = vm.error, vm.isEmpty {
                        ContentUnavailableView {
                            Label("Couldn't load bookings", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("Retry") { Task { await vm.load(reset: true, clearExistingRows: true) } }
                                .buttonStyle(.borderedProminent)
                        }
                    } else if vm.isEmpty && vm.isLoading {
                        List {
                            ForEach(0..<8, id: \.self) { _ in
                                BookingRowSkeleton()
                                    .listRowSeparator(.hidden)
                                    .listRowBackground(Color.clear)
                                    .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                            }
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .background(Color(.systemGroupedBackground))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)  // Don't pollute VO with placeholder shapes.
                    } else if vm.isEmpty {
                        ScrollView {
                            BookingEmptyState(
                                icon: emptyIcon,
                                tone: emptyTone,
                                title: emptyTitle,
                                description: emptyDescription
                            ) {
                                emptyStateActions
                            }
                            .frame(maxWidth: 520)
                            .padding(.horizontal, Brand.Space.md)
                            .padding(.top, Brand.Space.lg)
                            .frame(maxWidth: .infinity)
                        }
                    } else {
                        List {
                            BookingListSection(title: "Active", count: vm.sortedBookings.count) {
                                ForEach(vm.sortedBookings) { booking in
                                    bookingRowLink(booking)
                                }
                            }
                            if let pageError = vm.pageError {
                                VStack(spacing: 8) {
                                    Text(pageError)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .multilineTextAlignment(.center)
                                    Button("Retry") { Task { await vm.retryPage() } }
                                        .buttonStyle(.bordered)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                            } else if vm.hasMore {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                                    .listRowSeparator(.hidden)
                                    .listRowBackground(Color.clear)
                                    .task(id: "\(vm.scope.rawValue)-\(vm.bookings.count)") {
                                        await vm.load()
                                    }
                            }
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .background(Color(.systemGroupedBackground))
                    }
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(isCollaborator ? "My Gear" : "Bookings")
            .navigationBarTitleDisplayMode(.inline)
            .modifier(BookingsSearchModifier(isVisible: showsSearch, text: $vm.searchText, prompt: searchPrompt))
            .onChange(of: vm.searchText) { vm.onSearchChange() }
            .onChange(of: vm.scope) { _, _ in
                Haptics.selection()
                Task { await vm.load(reset: true, clearExistingRows: true) }
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !isCollaborator {
                        Button {
                            vm.scope = vm.mineOnly ? .all : .mine
                        } label: {
                            Image(systemName: vm.mineOnly ? "person.crop.circle.fill" : "person.crop.circle")
                        }
                        // Blue for the active filter rather than brand red —
                        // red is reserved for overdue, and this toggle sits
                        // directly above rows that use it.
                        .tint(vm.mineOnly ? Color.statusText(.blue) : Color.primary)
                        .accessibilityLabel(vm.mineOnly ? "Showing my bookings. Show all bookings" : "Show my bookings")
                        .accessibilityValue(vm.mineOnly ? "Mine" : "All")
                    }
                    if canCreate && !showsEmptyCreateAction {
                        Button {
                            newReservationTip.invalidate(reason: .actionPerformed)
                            drafts.start()
                        } label: {
                            Image(systemName: "plus")
                                .popoverTip(newReservationTip, arrowEdge: .top)
                        }
                        // Purple: this creates a reservation, so it carries the
                        // colour of what it produces.
                        .tint(Color.statusText(.purple))
                        .accessibilityLabel("New Reservation")
                    }
                }
            }
            .sheet(item: $presentedAction) { action in
                switch action {
                case .edit(let booking):
                    EditBookingSheet(booking: booking) { updatedBooking in
                        vm.install(updatedBooking)
                    }
                case .transfer(let booking):
                    TransferBookingOwnerSheet(booking: booking) { updatedBooking in
                        vm.install(updatedBooking)
                    }
                case .extend(let booking):
                    ExtendBookingSheet(booking: booking) { updatedBooking in
                        vm.install(updatedBooking)
                    }
                }
            }
            .confirmationDialog(
                "Cancel Reservation",
                isPresented: Binding(
                    get: { cancelTarget != nil },
                    set: { if !$0 { cancelTarget = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Cancel Reservation", role: .destructive) {
                    guard let booking = cancelTarget else { return }
                    cancelTarget = nil
                    Task { await cancelReservation(booking) }
                }
                Button("Keep Reservation", role: .cancel) { cancelTarget = nil }
            } message: {
                Text("This removes the reservation and releases its gear.")
            }
            .refreshable { await vm.load(reset: true) }
            .task {
                vm.applyUserContext(id: session.currentUser?.id, role: session.currentUser?.role)
                consumePendingScope()
                consumePendingAppIntent()
                await vm.load(reset: true)
                consumePendingBookingDetail()
            }
            .onChange(of: appState.pendingBookingsScope) { _, _ in
                consumePendingScope()
            }
            .onChange(of: appState.pendingBookingDetailId) { _, _ in
                consumePendingBookingDetail()
            }
            .onChange(of: appState.pendingAppIntentDestination) { _, _ in
                consumePendingAppIntent()
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 1 else { return }
                navigationPath = NavigationPath()
                vm.resetDefaults()
                Task { await vm.load(reset: true, clearExistingRows: true) }
            }
            .navigationDestination(for: Booking.self) { booking in
                BookingDetailView(bookingId: booking.id)
            }
            .navigationDestination(for: String.self) { id in
                BookingDetailView(bookingId: id)
            }
        }
    }

    private func hasCapability(_ capability: String) -> Bool {
        guard let user = session.currentUser else { return false }
        return user.role != "COLLABORATOR" || (user.capabilities ?? []).contains(capability)
    }

    private func ownsOrManages(_ booking: Booking) -> Bool {
        guard let user = session.currentUser else { return false }
        return user.role == "STAFF" || user.role == "ADMIN" || booking.requester.id == user.id
    }

    private func canEdit(_ booking: Booking) -> Bool {
        if let allowed = booking.allows("edit") { return allowed }
        guard ownsOrManages(booking) else { return false }
        if isCollaborator {
            return booking.kind == .reservation && hasCapability("RESERVATION_EDIT_OWN")
                && [.draft, .booked].contains(booking.status)
        }
        return [.draft, .booked, .pendingPickup, .open].contains(booking.status)
    }

    private func canTransfer(_ booking: Booking) -> Bool {
        if let allowed = booking.allows("transfer-owner") { return allowed }
        return !isCollaborator && ownsOrManages(booking)
            && [.draft, .booked, .pendingPickup, .open].contains(booking.status)
    }

    private func canExtend(_ booking: Booking) -> Bool {
        if let allowed = booking.allows("extend") { return allowed }
        guard ownsOrManages(booking), [.booked, .open].contains(booking.status) else { return false }
        if isCollaborator {
            return booking.kind == .reservation && hasCapability("RESERVATION_EXTEND_OWN")
        }
        return true
    }

    private func canCancelReservation(_ booking: Booking) -> Bool {
        guard booking.kind == .reservation else { return false }
        if let allowed = booking.allows("cancel") { return allowed }
        guard ownsOrManages(booking), [.draft, .booked].contains(booking.status) else { return false }
        return !isCollaborator || hasCapability("RESERVATION_CANCEL_OWN")
    }

    private func bookingRowLink(_ booking: Booking) -> some View {
        BookingRowLink(
            booking: booking,
            canEdit: canEdit(booking),
            canTransfer: canTransfer(booking),
            canExtend: booking.kind == .checkout && canExtend(booking),
            canCancel: canCancelReservation(booking),
            onEdit: { presentedAction = .edit(booking) },
            onTransfer: { presentedAction = .transfer(booking) },
            onExtend: { presentedAction = .extend(booking) },
            onCancel: { cancelTarget = booking }
        )
    }

    private func cancelReservation(_ booking: Booking) async {
        do {
            let cancelled = try await APIClient.shared.cancelBooking(id: booking.id)
            vm.install(cancelled)
            Haptics.success()
        } catch {
            vm.error = error.localizedDescription
            Haptics.warning()
        }
    }

    @ViewBuilder
    private var emptyStateActions: some View {
        if !vm.searchText.isEmpty {
            Button {
                vm.searchText = ""
                Task { await vm.load(reset: true, clearExistingRows: true) }
            } label: {
                Label("Clear Search", systemImage: "xmark.circle")
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
        } else if vm.scope != .all {
            Button {
                vm.scope = .all
                Task { await vm.load(reset: true, clearExistingRows: true) }
            } label: {
                Label("View All Bookings", systemImage: "person.2")
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
            .tint(Color.statusText(.blue))
        } else if canCreate {
            Button {
                newReservationTip.invalidate(reason: .actionPerformed)
                drafts.start()
            } label: {
                Label("New Reservation", systemImage: "plus")
                    .popoverTip(newReservationTip, arrowEdge: .top)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
            .tint(Color.statusText(.purple))
        }
    }

    /// Opens a reservation the app-level composer just created. The list is
    /// refreshed first so returning from the detail view does not show a page
    /// that predates the new row.
    private func consumePendingBookingDetail() {
        guard let bookingId = appState.pendingBookingDetailId else { return }
        appState.pendingBookingDetailId = nil
        Task {
            await vm.load(reset: true, clearExistingRows: true)
            navigationPath.append(bookingId)
        }
    }

    private func consumePendingAppIntent() {
        if appState.consumeAppIntentDestination(.createReservation) {
            if canCreate { drafts.start() }
        } else if appState.consumeAppIntentDestination(.myGear) {
            navigationPath = NavigationPath()
        }
    }
}

private struct BookingEmptyState<Actions: View>: View {
    let icon: String
    let tone: StatusTone
    let title: String
    let description: String
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        VStack(spacing: Brand.Space.md) {
            Image(systemName: icon)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Color.statusText(tone))
                .frame(width: 52, height: 52)
                .background(Color.statusBackground(tone), in: Circle())
                .accessibilityHidden(true)

            VStack(spacing: Brand.Space.xs) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .multilineTextAlignment(.center)
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            actions()
        }
        .brandCard(padding: Brand.Space.xl, radius: Brand.Radius.card, alignment: .center)
        .accessibilityElement(children: .contain)
    }
}

private struct BookingListSection<Content: View>: View {
    let title: String
    let count: Int
    @ViewBuilder let content: () -> Content

    var body: some View {
        Section {
            content()
        } header: {
            HStack(spacing: 6) {
                Text(title)
                Text("\(count)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .textCase(.none)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
    }
}

private struct BookingRowLink: View {
    let booking: Booking
    let canEdit: Bool
    let canTransfer: Bool
    let canExtend: Bool
    let canCancel: Bool
    let onEdit: () -> Void
    let onTransfer: () -> Void
    let onExtend: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            NavigationLink(value: booking) { EmptyView() }.opacity(0)
            BookingRow(booking: booking)
        }
        .contextMenu {
            if canEdit {
                Button(action: onEdit) {
                    Label("Edit Booking", systemImage: "pencil")
                }
            }
            if canTransfer {
                Button(action: onTransfer) {
                    Label("Transfer Ownership", systemImage: "person.2")
                }
            }
            if canExtend {
                Button(action: onExtend) {
                    Label("Extend Return", systemImage: "clock.arrow.circlepath")
                }
            }
            if canCancel {
                Divider()
                Button(role: .destructive, action: onCancel) {
                    Label("Cancel Reservation", systemImage: "xmark.circle")
                }
            }
        }
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
    }
}

private struct BookingsSearchModifier: ViewModifier {
    let isVisible: Bool
    @Binding var text: String
    let prompt: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if isVisible {
            content.searchable(text: $text, prompt: prompt)
        } else {
            content
        }
    }
}

struct BookingRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let booking: Booking

    private func isOverdue(now: Date) -> Bool {
        booking.status == .open && booking.endsAt < now
    }

    /// Pending Pickup is the operational phase of a booked reservation after
    /// its scheduled kiosk handoff time. Custody still starts only at pickup.
    private func isPendingPickup(now: Date) -> Bool {
        booking.kind == .reservation
            && booking.status == .booked
            && booking.startsAt < now
    }

    private var itemCount: Int {
        booking.serializedItems.count + booking.bulkItems.count
    }

    /// The rail and timing color carry the state on their own: blue rail plus
    /// "Due" reads as out, purple rail plus "Pickup" reads as reserved. A
    /// badge restating either is noise, so only the odder statuses get one.
    private func showsStatusBadge(now: Date) -> Bool {
        switch booking.status {
        case .open: booking.kind != .checkout
        case .booked: false
        default: true
        }
    }

    /// Accent tone for the leading bar — overdue shouts red, otherwise the
    /// status' own tone (reservation purple, checkout blue, pickup orange).
    private func accentTone(now: Date) -> StatusTone {
        if isOverdue(now: now) { return .red }
        if isPendingPickup(now: now) { return .orange }
        switch booking.status {
        case .booked: return booking.kind == .reservation ? .purple : .blue
        case .pendingPickup: return .orange
        case .open: return .blue
        default: return .gray
        }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    accessibilityRow(now: context.date)
                } else {
                    compactRow(now: context.date)
                }
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            // Faint red wash so an overdue row reads as different at a glance,
            // rather than only by the hue of its rail and timing text. Deliberately
            // light: a bad week can put several of these on screen at once.
            .background(isOverdue(now: context.date) ? Color.statusBackground(.red) : Color.cardSurface)
            .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                    .strokeBorder(Color.hairline, lineWidth: 0.5)
            )
            .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 3)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(rowAccessibilityLabel(now: context.date))
        }
    }

    private func compactRow(now: Date) -> some View {
        HStack(spacing: 12) {
            StatusRail(tone: accentTone(now: now))
            UserAvatarView(name: booking.requester.name, avatarUrl: booking.requester.avatarUrl, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    bookingTitle.lineLimit(1)
                    Spacer(minLength: 8)
                    if showsStatusBadge(now: now) {
                        statusBadge(now: now)
                    }
                }
                timingLine(now: now, lineLimit: 1)
                metadataLine(lineLimit: 1)
            }
            disclosureIndicator
        }
    }

    private func accessibilityRow(now: Date) -> some View {
        HStack(alignment: .top, spacing: 12) {
            StatusRail(tone: accentTone(now: now))
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    UserAvatarView(name: booking.requester.name, avatarUrl: booking.requester.avatarUrl, size: 40)
                    bookingTitle
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    disclosureIndicator
                }
                if showsStatusBadge(now: now) {
                    statusBadge(now: now)
                }
                timingLine(now: now, lineLimit: nil)
                metadataLine(lineLimit: nil)
            }
        }
    }

    private var bookingTitle: some View {
        Text(booking.title)
            .font(.gothamBold(size: 16))
    }

    private func statusBadge(now: Date) -> some View {
        StatusBadge(status: booking.status, kind: booking.kind, isOverdue: isOverdue(now: now))
    }

    private var disclosureIndicator: some View {
        Image(systemName: "chevron.right")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }

    private func timingLine(now: Date, lineLimit: Int?) -> some View {
        let info = timing(now: now)
        return Text(info.text)
            .font(.caption.weight(.semibold))
            .lineLimit(lineLimit)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(info.urgent ? AnyShapeStyle(Color.statusText(.red)) : AnyShapeStyle(Color.statusText(accentTone(now: now))))
    }

    private func metadataLine(lineLimit: Int?) -> some View {
        HStack(spacing: 4) {
            Text(booking.requester.name)
            Text("·")
            Text(booking.location.name)
            if itemCount > 0 {
                Text("·")
                Text("\(itemCount) item\(itemCount == 1 ? "" : "s")")
                    .monospacedDigit()
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(lineLimit)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// Shared relative-day wording. Urgency lives in the rail and text color,
    /// not a repeated overdue badge or duration.
    private func timing(now: Date) -> (text: String, urgent: Bool) {
        if booking.kind == .checkout {
            switch booking.status {
            case .open:
                return ("Due \(booking.endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))", booking.endsAt < now)
            case .pendingPickup, .booked:
                return ("Pickup \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))", booking.startsAt < now)
            default:
                return ("Due \(booking.endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))", false)
            }
        }
        // "Pickup", not "Starts" — the row's job is to name the next action.
        if isPendingPickup(now: now) {
            return ("Pickup was due \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))", false)
        }
        return ("Pickup \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))", false)
    }

    private func rowAccessibilityLabel(now: Date) -> String {
        var parts: [String] = []
        if isOverdue(now: now) { parts.append("Overdue") }
        if isPendingPickup(now: now) { parts.append("Pending pickup") }
        parts.append(booking.title)
        parts.append(booking.requester.name)
        parts.append(booking.location.name)
        if itemCount > 0 { parts.append("\(itemCount) item\(itemCount == 1 ? "" : "s")") }
        if showsStatusBadge(now: now) {
            parts.append(StatusBadge.label(for: booking.status, kind: booking.kind, isOverdue: isOverdue(now: now)))
        }
        if booking.kind == .checkout {
            parts.append("Due \(booking.endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))")
        } else if isPendingPickup(now: now) {
            parts.append("Pickup was due \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))")
        } else {
            parts.append("Pickup \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))")
        }
        return parts.joined(separator: ", ")
    }
}


struct StatusBadge: View {
    let status: BookingStatus
    var kind: BookingKind = .unknown
    var isOverdue = false

    var body: some View {
        StatusPill(label: Self.label(for: status, kind: kind, isOverdue: isOverdue), tone: tone)
    }

    /// Public static so accessibility-label builders can speak the same
    /// label the visible pill renders, without duplicating the BOOKED-vs-
    /// reservation/checkout split logic.
    static func label(for status: BookingStatus, kind: BookingKind, isOverdue: Bool = false) -> String {
        if isOverdue { return "Overdue" }
        if status == .booked { return "Reserved" }
        if status == .pendingPickup { return "Pending Pickup" }
        if status == .open { return "Checked Out" }
        return status.label
    }

    private var tone: StatusTone {
        if isOverdue { return .red }
        switch status {
        case .draft: return .gray
        case .booked: return .purple
        case .pendingPickup: return .orange
        case .open: return .blue
        case .completed: return .gray
        case .cancelled: return .gray
        case .unknown: return .gray
        }
    }
}
