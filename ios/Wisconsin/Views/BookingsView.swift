import SwiftUI
import TipKit

enum BookingScope: String {
    case mine
    case all
}

/// Status scope for the native Bookings list (GAP-34). Web splits this across
/// an active/past segmented control plus a status dropdown
/// (`src/app/(app)/bookings/page.tsx`); a phone gets one flat list of the
/// scopes people actually triage by, with the two date-derived ones the web
/// desk reaches through its own filters.
enum BookingStatusFilter: String, CaseIterable, Identifiable {
    case active
    case overdue
    case dueToday
    case reserved
    case pendingPickup
    case checkedOut
    case completed
    case cancelled

    var id: String { rawValue }

    /// Product language, not enum language: the row badges already say
    /// "Reserved" and "Checked Out" rather than BOOKED and OPEN.
    var label: String {
        switch self {
        case .active: "Active"
        case .overdue: "Overdue"
        case .dueToday: "Due Today"
        case .reserved: "Reserved"
        case .pendingPickup: "Pending Pickup"
        case .checkedOut: "Checked Out"
        case .completed: "Completed"
        case .cancelled: "Cancelled"
        }
    }

    var systemImage: String {
        switch self {
        case .active: "tray.full"
        case .overdue: "exclamationmark.triangle"
        case .dueToday: "clock"
        case .reserved: "calendar"
        case .pendingPickup: "shippingbox"
        case .checkedOut: "arrow.up.forward.square"
        case .completed: "checkmark.circle"
        case .cancelled: "xmark.circle"
        }
    }

    /// Matches the tone the same state carries on a row rail, so the filter
    /// menu and the list agree on what red and purple mean.
    var tone: StatusTone {
        // Explicit `return` per the StatusTone convention `BookingRow.accentTone`
        // already follows — the implicit form reads as a raw SwiftUI color to
        // the drift check (R7).
        switch self {
        case .active: return .blue
        case .overdue: return .red
        case .dueToday, .pendingPickup: return .orange
        case .reserved: return .purple
        case .checkedOut: return .blue
        case .completed, .cancelled: return .gray
        }
    }

    /// `/api/bookings` request shape. The route treats `active`, `past`, and
    /// `status` as one scope selector and applies `filter` on top, so overdue
    /// and due-today stay date filters over the operational statuses rather
    /// than statuses of their own.
    var query: (activeOnly: Bool, pastOnly: Bool, status: BookingStatus?, filter: String?) {
        switch self {
        case .active: (activeOnly: true, pastOnly: false, status: nil, filter: nil)
        case .overdue: (activeOnly: true, pastOnly: false, status: nil, filter: "overdue")
        case .dueToday: (activeOnly: true, pastOnly: false, status: nil, filter: "due-today")
        case .reserved: (activeOnly: false, pastOnly: false, status: .booked, filter: nil)
        case .pendingPickup: (activeOnly: false, pastOnly: false, status: .pendingPickup, filter: nil)
        case .checkedOut: (activeOnly: false, pastOnly: false, status: .open, filter: nil)
        case .completed: (activeOnly: false, pastOnly: false, status: .completed, filter: nil)
        case .cancelled: (activeOnly: false, pastOnly: false, status: .cancelled, filter: nil)
        }
    }
}

/// Ordering for the native Bookings list (GAP-34). Every key here exists in
/// the server's `BOOKING_SORT_MAP`; an unmapped key would fall through to
/// `startsAt desc` silently, which is the failure
/// `tests/ios-booking-list-sort-contract.test.ts` exists to catch.
enum BookingSortOption: String, CaseIterable, Identifiable {
    case operational
    case dueLatest
    case titleAZ
    case titleZA

    var id: String { rawValue }

    var label: String {
        switch self {
        case .operational: "Next Handoff"
        case .dueLatest: "Due Latest"
        case .titleAZ: "Title A–Z"
        case .titleZA: "Title Z–A"
        }
    }

    var serverKey: String {
        switch self {
        case .operational: "endsAt"
        case .dueLatest: "endsAt_desc"
        case .titleAZ: "title"
        case .titleZA: "title_desc"
        }
    }

    /// Only the default refines the server order locally, mixing reservation
    /// pickup times into a due-date stream. Every explicit choice is already
    /// ordered across the whole result set by the server.
    var sortsLocally: Bool { self == .operational }
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
    /// Status scope and ordering (GAP-34). Both persist across launches from
    /// the view's `@AppStorage` mirrors — a filter you have to re-pick every
    /// time is a filter you stop using.
    var statusFilter: BookingStatusFilter = .active
    var sortOption: BookingSortOption = .operational
    var currentUserId: String?
    var currentUserRole = ""
    /// Collaborators granted TEAM_GEAR_VIEW can read everyone's bookings.
    var seesTeamGear = false
    /// A private collaborator is pinned to their own gear with no Mine toggle.
    var pinsToOwnGear: Bool { currentUserRole == "COLLABORATOR" && !seesTeamGear }

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

    /// Restores the persisted list preferences on first appearance. Scope is
    /// the one value the role can override: a private collaborator is pinned
    /// to their own gear regardless of what they last chose on another
    /// account or before a role change.
    func applyUserContext(
        id: String?,
        role: String?,
        restoredScope: BookingScope = .all,
        restoredStatusFilter: BookingStatusFilter = .active,
        restoredSortOption: BookingSortOption = .operational,
        seesTeamGear: Bool = false
    ) {
        currentUserId = id
        currentUserRole = role ?? ""
        self.seesTeamGear = seesTeamGear
        guard !didApplyUserDefault else { return }
        scope = currentUserRole == "COLLABORATOR" ? .mine : restoredScope
        statusFilter = restoredStatusFilter
        sortOption = restoredSortOption
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
            applyServerOrderIfNeeded()
            offset += result.data.count
            hasMore = offset < result.total
            pageError = nil
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

    private func fetchBookings(search: String?, requesterId: String?) async throws -> PaginatedResponse<Booking> {
        guard hasMore else {
            return PaginatedResponse(data: [], total: offset, limit: limit, offset: offset)
        }
        let query = statusFilter.query
        return try await APIClient.shared.bookings(
            activeOnly: query.activeOnly,
            pastOnly: query.pastOnly,
            status: query.status,
            search: search,
            requesterId: requesterId,
            filter: query.filter,
            sort: sortOption.serverKey,
            limit: limit,
            offset: offset
        )
    }

    /// `bookings.didSet` re-sorts every loaded page by its next operational
    /// handoff, which is the right default for a merged pickup/due queue. An
    /// explicit sort choice is already applied by the server across the whole
    /// result set, so re-sorting the loaded prefix locally would fight it —
    /// and the rows it would bury are exactly the ones the user sorted to
    /// find.
    func applyServerOrderIfNeeded() {
        guard !sortOption.sortsLocally else { return }
        sortedBookings = bookings
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
        applyServerOrderIfNeeded()
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
        statusFilter = .active
        sortOption = .operational
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
    // Persisted list preferences (GAP-34). The view model stays the source of
    // truth for the session; these mirror it so the next launch opens on the
    // scope the user actually works in.
    @AppStorage("bookingsScope") private var storedScope: BookingScope = .all
    @AppStorage("bookingsStatusFilter") private var storedStatusFilter: BookingStatusFilter = .active
    @AppStorage("bookingsSortOption") private var storedSortOption: BookingSortOption = .operational
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(ReservationDraftStore.self) private var drafts
    @Environment(NetworkMonitor.self) private var network

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
            && vm.statusFilter == .active
    }

    private var emptyTitle: String {
        guard vm.searchText.isEmpty else { return "No matches" }
        if vm.statusFilter != .active { return "No \(vm.statusFilter.label.lowercased()) bookings" }
        switch vm.scope {
        case .mine: return "You're all clear"
        case .all: return "No active bookings"
        }
    }

    private var emptyIcon: String {
        guard vm.searchText.isEmpty else { return "magnifyingglass" }
        if vm.statusFilter != .active { return vm.statusFilter.systemImage }
        return vm.scope == .mine ? "checkmark.circle" : "calendar.badge.plus"
    }

    private var emptyDescription: String {
        if !vm.searchText.isEmpty { return "No bookings match \"\(vm.searchText)\"." }
        if vm.statusFilter != .active {
            let scopeSuffix = vm.scope == .mine ? " of yours" : ""
            return "Nothing\(scopeSuffix) is \(vm.statusFilter.label.lowercased()) right now."
        }
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

    /// One merged section for both kinds, named for the scope on screen.
    /// Checkouts and reservations never split into separate sections.
    private var sectionTitle: String {
        vm.statusFilter == .active ? "Active" : vm.statusFilter.label
    }

    private var isDefaultFiltering: Bool {
        vm.statusFilter == .active && vm.sortOption == .operational
    }

    private var showsSearch: Bool {
        if !vm.searchText.isEmpty { return true }
        let visibleCount = vm.bookings.count
        return visibleCount > 0 && (visibleCount > 4 || vm.hasMore)
    }

    var body: some View {
        // Apple's recommended pattern for binding to an @Observable model.
        @Bindable var vm = vm
        return NavigationStack(path: $navigationPath) {
            Group {
                if let error = vm.error, vm.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn't load bookings", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await vm.load(reset: true, clearExistingRows: true) } }
                            .buttonStyle(.borderedProminent)
                            .tint(.green)
                    }
                } else if vm.isEmpty && vm.isLoading {
                    loadingList
                } else if vm.isEmpty {
                    emptyState
                } else {
                    bookingList
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if !vm.pinsToOwnGear { scopePicker }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(isCollaborator ? "My Gear" : "Bookings")
            .navigationBarTitleDisplayMode(.inline)
            .modifier(BookingsSearchModifier(isVisible: showsSearch, text: $vm.searchText, prompt: searchPrompt))
            .onChange(of: vm.searchText) { vm.onSearchChange() }
            .onChange(of: vm.scope) { _, scope in
                storedScope = scope
                Task { await vm.load(reset: true, clearExistingRows: true) }
            }
            .onChange(of: vm.statusFilter) { _, filter in
                storedStatusFilter = filter
                Task { await vm.load(reset: true, clearExistingRows: true) }
            }
            .onChange(of: vm.sortOption) { _, option in
                storedSortOption = option
                // Re-order what is already on screen before the refetch lands,
                // so the list responds to the tap instead of the round trip.
                vm.applyServerOrderIfNeeded()
                Task { await vm.load(reset: true, clearExistingRows: true) }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    bookingsFilterMenu
                }
                if canCreate && !showsEmptyCreateAction {
                    if #available(iOS 27.0, *) {
                        ToolbarItem(placement: .topBarPinnedTrailing) {
                            bookingsNewReservationButton
                        }
                        .visibilityPriority(.high)
                    } else {
                        ToolbarItem(placement: .topBarTrailing) {
                            bookingsNewReservationButton
                        }
                    }
                }
            }
            .nativeScrollBarMinimization()
            .sheet(item: $presentedAction) { action in
                switch action {
                case .edit(let booking):
                    if booking.kind == .reservation {
                        ReservationEditFlow(booking: booking) { updatedBooking in
                            vm.install(updatedBooking)
                        }
                    } else {
                        EditBookingSheet(booking: booking) { updatedBooking in
                            vm.install(updatedBooking)
                        }
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
                item: $cancelTarget,
                titleVisibility: .visible
            ) { booking in
                Button("Cancel Reservation", role: .destructive) {
                    Task { await cancelReservation(booking) }
                }
            } message: { _ in
                Text("This removes the reservation and releases its gear.")
            }
            // See HomeView: refetch when signal returns, only for the tab the
            // user is actually looking at. Existing rows are kept so a
            // reconnection never blanks a list that was readable a moment ago.
            .onChange(of: network.reconnectionToken) { _, _ in
                guard appState.selectedTab == 1 else { return }
                Task { await vm.load(reset: true) }
            }
            .refreshable { await vm.load(reset: true) }
            .task {
                vm.applyUserContext(
                    id: session.currentUser?.id,
                    role: session.currentUser?.role,
                    restoredScope: storedScope,
                    restoredStatusFilter: storedStatusFilter,
                    restoredSortOption: storedSortOption,
                    seesTeamGear: (session.currentUser?.capabilities ?? []).contains("TEAM_GEAR_VIEW")
                )
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

    /// The scope the list is showing, in words. A bare icon hid the filter
    /// entirely; the current status reads as the title of the menu instead.
    private var bookingsFilterMenu: some View {
        Menu {
            Picker("Show", selection: $vm.statusFilter) {
                ForEach(BookingStatusFilter.allCases) { filter in
                    Label(filter.label, systemImage: filter.systemImage)
                        .tag(filter)
                }
            }
            .pickerStyle(.inline)

            Picker("Sort", selection: $vm.sortOption) {
                ForEach(BookingSortOption.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Label {
                Text(vm.statusFilter.label)
            } icon: {
                Image(systemName: isDefaultFiltering
                    ? "line.3.horizontal.decrease"
                    : "line.3.horizontal.decrease.circle.fill")
            }
        }
        .accessibilityLabel("Filter and sort bookings")
        .accessibilityValue("\(vm.statusFilter.label), sorted by \(vm.sortOption.label)")
    }

    /// Everyone's bookings or just yours, as a system segmented control at the
    /// top of the page.
    private var scopePicker: some View {
        Picker("Bookings", selection: $vm.scope) {
            Text("Everyone").tag(BookingScope.all)
            Text("Mine").tag(BookingScope.mine)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, Brand.Space.xs)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGroupedBackground))
        .sensoryFeedback(.selection, trigger: vm.scope)
    }

    private var bookingsNewReservationButton: some View {
        Button {
            newReservationTip.invalidate(reason: .actionPerformed)
            drafts.start()
        } label: {
            Image(systemName: "plus")
                .popoverTip(newReservationTip, arrowEdge: .top)
        }
        .accessibilityLabel("New Reservation")
    }

    // MARK: List states

    private var loadingList: some View {
        List {
            Section {
                ForEach(0..<6, id: \.self) { _ in
                    BookingRowSkeleton()
                }
            }
        }
        .listStyle(.insetGrouped)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading bookings")
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(emptyTitle, systemImage: emptyIcon)
        } description: {
            Text(emptyDescription)
        } actions: {
            emptyStateActions
        }
    }

    private var bookingList: some View {
        let now = Date()
        let groups = bookingGroups(now: now)
        let overdueCount = vm.sortedBookings.filter { $0.isOverdue(now: now) }.count
        return List {
            if overdueCount > 0 && vm.statusFilter != .overdue {
                Text("\(overdueCount) overdue")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.statusText(.red))
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 16))
            }
            ForEach(groups) { group in
                BookingListSection(title: group.title, isUrgent: group.isUrgent) {
                    ForEach(group.bookings) { booking in
                        bookingRowLink(booking, showsDay: group.showsDay)
                    }
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
                .listRowBackground(Color.clear)
            } else if vm.hasMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .task(id: "\(vm.scope.rawValue)-\(vm.bookings.count)") {
                        await vm.load()
                    }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
    }

    /// Day sections for the default handoff order, so the list answers "what
    /// is due when" the way a calendar does. Anything late sits first under
    /// its own heading. An explicit sort or a closed scope is one plain
    /// section, because day headings over a title sort would lie.
    private func bookingGroups(now: Date) -> [BookingGroup] {
        let rows = vm.sortedBookings
        let closed = vm.statusFilter == .completed || vm.statusFilter == .cancelled
        guard vm.sortOption == .operational, !closed else {
            return [BookingGroup(id: "all", title: sectionTitle, isUrgent: false, showsDay: true, bookings: rows)]
        }
        var late: [Booking] = []
        var waiting: [Booking] = []
        var days: [BookingGroup] = []
        for booking in rows {
            if booking.isOverdue(now: now) {
                late.append(booking)
            } else if booking.isWaitingOnPickup(now: now) {
                waiting.append(booking)
            } else {
                let time = booking.kind == .reservation ? booking.startsAt : booking.endsAt
                let title = time.operationalDayLabel(now: now)
                if let last = days.last, last.title == title {
                    days[days.count - 1].bookings.append(booking)
                } else {
                    days.append(BookingGroup(id: "day-\(days.count)-\(title)", title: title, isUrgent: false, showsDay: false, bookings: [booking]))
                }
            }
        }
        var groups: [BookingGroup] = []
        if !late.isEmpty {
            groups.append(BookingGroup(id: "overdue", title: "Overdue", isUrgent: true, showsDay: true, bookings: late))
        }
        if !waiting.isEmpty {
            groups.append(BookingGroup(id: "waiting", title: "Waiting on pickup", isUrgent: false, showsDay: true, bookings: waiting))
        }
        return groups + days
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

    private func bookingRowLink(_ booking: Booking, showsDay: Bool) -> some View {
        BookingRowLink(
            booking: booking,
            showsRequester: vm.scope == .all,
            showsDay: showsDay,
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
        } else if vm.statusFilter != .active {
            Button {
                vm.statusFilter = .active
                Task { await vm.load(reset: true, clearExistingRows: true) }
            } label: {
                Label("Show Active Bookings", systemImage: "tray.full")
            }
            .buttonStyle(.bordered)
        } else if vm.scope != .all {
            Button {
                vm.scope = .all
                Task { await vm.load(reset: true, clearExistingRows: true) }
            } label: {
                Label("View All Bookings", systemImage: "person.2")
            }
            .buttonStyle(.bordered)
        } else if canCreate {
            Button {
                newReservationTip.invalidate(reason: .actionPerformed)
                drafts.start()
            } label: {
                Label("New Reservation", systemImage: "plus")
                    .popoverTip(newReservationTip, arrowEdge: .top)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
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

struct BookingGroup: Identifiable {
    let id: String
    let title: String
    let isUrgent: Bool
    /// Rows under a day heading drop the day from their own line.
    let showsDay: Bool
    var bookings: [Booking]
}

extension Booking {
    func isOverdue(now: Date) -> Bool {
        status == .open && endsAt < now
    }

    /// Pending Pickup is the operational phase of a booked reservation after
    /// its scheduled kiosk handoff time. Custody still starts only at pickup.
    func isWaitingOnPickup(now: Date) -> Bool {
        kind == .reservation && status == .booked && startsAt < now
    }
}

private struct BookingListSection<Content: View>: View {
    let title: String
    let isUrgent: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        Section {
            content()
        } header: {
            Text(title)
                .textCase(nil)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isUrgent ? Color.statusText(.red) : Color(.secondaryLabel))
        }
    }
}

private struct BookingRowLink: View {
    let booking: Booking
    let showsRequester: Bool
    let showsDay: Bool
    let canEdit: Bool
    let canTransfer: Bool
    let canExtend: Bool
    let canCancel: Bool
    let onEdit: () -> Void
    let onTransfer: () -> Void
    let onExtend: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationLink(value: booking) {
            BookingRow(booking: booking, showsRequester: showsRequester, showsDay: showsDay)
        }
        // The same actions the context menu carries, one swipe away. Long-press
        // is discoverable only once you know it is there; a swipe is the list
        // gesture people already try. `allowsFullSwipe` stays off on both edges
        // so no booking is cancelled or extended by an over-travelled thumb.
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if canCancel {
                Button(role: .destructive) {
                    Haptics.warning()
                    onCancel()
                } label: {
                    Label("Cancel", systemImage: "xmark.circle")
                }
            }
            if canExtend {
                Button {
                    Haptics.selection()
                    onExtend()
                } label: {
                    Label("Extend", systemImage: "clock.arrow.circlepath")
                }
                .tint(.green)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if canEdit {
                Button {
                    Haptics.selection()
                    onEdit()
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .tint(.gray)
            }
            if canTransfer {
                Button {
                    Haptics.selection()
                    onTransfer()
                } label: {
                    Label("Transfer", systemImage: "person.2")
                }
                .tint(.gray)
            }
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
        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 12))
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

/// One quiet row: what it is, when it moves next, and who has it. Red is
/// reserved for gear that is late; every other state is plain text, because
/// the day heading above the row already says where it sits.
struct BookingRow: View {
    let booking: Booking
    var showsRequester = true
    var showsDay = true

    private var itemCount: Int {
        booking.serializedItems.count + booking.bulkItems.reduce(0) { $0 + $1.plannedQuantity }
    }

    var body: some View {
        // Re-evaluates on the minute so "Due" flips to overdue without a refresh.
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let now = context.date
            let info = timing(now: now)
            VStack(alignment: .leading, spacing: 3) {
                Text(booking.title)
                    .font(.gothamBold(size: 16))
                    .lineLimit(2)
                Text(info.text)
                    .font(.subheadline)
                    .foregroundStyle(info.urgent ? AnyShapeStyle(Color.statusText(.red)) : AnyShapeStyle(Color(.secondaryLabel)))
                    .lineLimit(2)
                Text(metadata)
                    .font(.footnote)
                    .foregroundStyle(Color(.tertiaryLabel))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(rowAccessibilityLabel(now: now))
        }
    }

    private var metadata: String {
        var parts: [String] = []
        if showsRequester { parts.append(booking.requester.name) }
        parts.append(booking.location.name)
        if itemCount > 0 { parts.append("\(itemCount) item\(itemCount == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    private func when(_ date: Date, now: Date) -> String {
        showsDay
            ? date.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
            : date.gearTime
    }

    /// "Pickup", not "Starts": the row's job is to name the next action.
    private func timing(now: Date) -> (text: String, urgent: Bool) {
        switch booking.status {
        case .completed:
            return ("Returned \(when(booking.endsAt, now: now))", false)
        case .cancelled:
            return ("Cancelled", false)
        case .draft:
            return ("Draft for \(when(booking.startsAt, now: now))", false)
        case .open:
            let late = booking.endsAt < now
            return ("\(late ? "Was due" : "Due") \(when(booking.endsAt, now: now))", late)
        case .pendingPickup, .booked, .unknown:
            if booking.isWaitingOnPickup(now: now) {
                return ("Pickup was due \(when(booking.startsAt, now: now))", false)
            }
            return ("Pickup \(when(booking.startsAt, now: now))", booking.kind == .checkout && booking.startsAt < now)
        }
    }

    private func rowAccessibilityLabel(now: Date) -> String {
        var parts: [String] = []
        if booking.isOverdue(now: now) { parts.append("Overdue") }
        if booking.isWaitingOnPickup(now: now) { parts.append("Waiting on pickup") }
        parts.append(booking.title)
        parts.append(timing(now: now).text)
        if showsRequester { parts.append(booking.requester.name) }
        parts.append(booking.location.name)
        if itemCount > 0 { parts.append("\(itemCount) item\(itemCount == 1 ? "" : "s")") }
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
