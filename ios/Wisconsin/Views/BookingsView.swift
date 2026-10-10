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
        restoredSortOption: BookingSortOption = .operational
    ) {
        currentUserId = id
        currentUserRole = role ?? ""
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
            // Only the unfiltered default list seeds the offline cache. A
            // "Cancelled" or "Mine" page is a slice, and caching it would let
            // the next cold launch open on a subset that looks like the whole
            // list.
            if reset && searchText.isEmpty && scope == .all && statusFilter == .active {
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

    /// One merged list ordered by the next operational handoff: the kiosk
    /// pickup until gear is out, then the due-back time. The same time picks
    /// the row's day group and its time column, so a pending pickup never
    /// sorts by a return date while reading as a pickup.
    private static func operationalTime(for booking: Booking) -> Date {
        booking.nextHandoff
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
        return vm.scope == .mine ? "checkmark.seal.fill" : "calendar.badge.plus"
    }

    private var emptyTone: StatusTone {
        guard vm.searchText.isEmpty else { return .gray }
        if vm.statusFilter != .active { return vm.statusFilter.tone }
        return vm.scope == .mine ? .green : .purple
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

    /// Day groups only make sense when the list is in handoff order and the
    /// rows still have a handoff ahead of them. A title sort, or a filter of
    /// finished bookings, stays one group under the scope's name.
    private var groupsByDay: Bool {
        vm.sortOption == .operational && ![.completed, .cancelled].contains(vm.statusFilter)
    }

    private var listGroups: [BookingListGroup] {
        BookingListGroup.groups(
            for: vm.sortedBookings,
            byDay: groupsByDay,
            flatTitle: sectionTitle,
            now: .now
        )
    }

    private func bookingGroupSection(_ group: BookingListGroup) -> some View {
        let rows = group.bookings
        let showsDay: Bool
        if case .day = group { showsDay = false } else { showsDay = true }
        return Section {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, booking in
                bookingRowLink(
                    booking,
                    position: EventRowGroupPosition(index: index, count: rows.count),
                    showsDay: showsDay
                )
            }
        } header: {
            bookingGroupHeader(group)
                .listRowInsets(EdgeInsets())
        }
        .listSectionSeparator(.hidden)
    }

    @ViewBuilder
    private func bookingGroupHeader(_ group: BookingListGroup) -> some View {
        switch group {
        case .attention(let rows):
            BookingListSection.Header(title: "Needs attention", count: rows.count, tone: .red)
        case .day(let date, let rows):
            ScheduleDateHeader(date: date, eventCount: rows.count, countNoun: ("booking", "bookings"))
        case .flat(let title, let rows):
            BookingListSection.Header(title: title, count: rows.count)
        }
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
                        VStack(spacing: 8) {
                            ProgressView("Loading bookings")
                                .padding(.top, 12)
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
                            .accessibilityHidden(true)  // Placeholder shapes stay decorative.
                        }
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
                            ForEach(listGroups) { group in
                                bookingGroupSection(group)
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
                        .listSectionSpacing(6)
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
                // Leading edge: the root of a NavigationStack has no back
                // button, so the filter sits opposite the create action
                // instead of crowding three icons against the inline title.
                ToolbarItem(placement: .topBarLeading) {
                    bookingsFilterMenu
                }
                if #available(iOS 27.0, *) {
                    if !isCollaborator {
                        ToolbarItem(placement: .topBarTrailing) {
                            bookingsMineToggle
                        }
                        .visibilityPriority(.high)
                    }
                    if canCreate && !showsEmptyCreateAction {
                        ToolbarItem(placement: .topBarPinnedTrailing) {
                            bookingsNewReservationButton
                        }
                    }
                } else {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if !isCollaborator { bookingsMineToggle }
                        if canCreate && !showsEmptyCreateAction { bookingsNewReservationButton }
                    }
                }
            }
            .nativeScrollBarMinimization()
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
                    restoredSortOption: storedSortOption
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
            Image(systemName: isDefaultFiltering
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill")
        }
        .tint(isDefaultFiltering ? Color.primary : Color.statusText(vm.statusFilter.tone))
        .accessibilityLabel("Filter and sort bookings")
        .accessibilityValue("\(vm.statusFilter.label), sorted by \(vm.sortOption.label)")
    }

    private var bookingsMineToggle: some View {
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

    private var bookingsNewReservationButton: some View {
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

    private func bookingRowLink(
        _ booking: Booking,
        position: EventRowGroupPosition,
        showsDay: Bool
    ) -> some View {
        BookingRowLink(
            booking: booking,
            isMine: booking.requester.id == session.currentUser?.id,
            position: position,
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
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
        } else if vm.statusFilter != .active {
            Button {
                vm.statusFilter = .active
                Task { await vm.load(reset: true, clearExistingRows: true) }
            } label: {
                Label("Show Active Bookings", systemImage: "tray.full")
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
            .tint(Color.statusText(.blue))
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

/// Header for a group that is not a single day: the scope's own name on a
/// flat list, or Needs attention above the late rows. Same weight and place as
/// a Schedule day header, so the two kinds of group read as one list.
enum BookingListSection {
    struct Header: View {
        let title: String
        let count: Int
        var tone: StatusTone? = nil

        var body: some View {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title)
                    .font(.title3)
                    .fontWeight(.heavy)
                    .foregroundStyle(tone.map { Color.statusText($0) } ?? Color.primary)
                Text("\(count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
            }
            .lineLimit(1)
            .textCase(nil)
            .padding(.horizontal, 32)
            .padding(.top, 14)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity)
            .background(Color(.systemGroupedBackground))
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("\(title), \(count) booking\(count == 1 ? "" : "s")")
        }
    }
}

private struct BookingRowLink: View {
    let booking: Booking
    let isMine: Bool
    let position: EventRowGroupPosition
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
        ZStack {
            NavigationLink(value: booking) { EmptyView() }.opacity(0)
            BookingRow(booking: booking, showsDay: showsDay)
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
                    onExtend()
                } label: {
                    Label("Extend", systemImage: "clock.arrow.circlepath")
                }
                .tint(Color.statusText(.blue))
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if canEdit {
                Button {
                    onEdit()
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .tint(Color.statusText(.purple))
            }
            if canTransfer {
                Button {
                    onTransfer()
                } label: {
                    Label("Transfer", systemImage: "person.2")
                }
                .tint(Color.statusText(.orange))
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
        // A slice of the group's rounded card, tinted blue when the booking
        // is yours -- the same surface Schedule rows use.
        .listRowSeparator(.hidden)
        .listRowBackground(EventRowBackground(isMine: isMine, position: position))
        .listRowInsets(EdgeInsets(top: 11, leading: 32, bottom: 11, trailing: 32))
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

extension Booking {
    /// The next moment someone has to act on this booking: the kiosk pickup
    /// until the gear is out, then the return. The list sorts, groups, and
    /// labels a row by this one time, so a row never sits under one day's
    /// header while naming another.
    var nextHandoff: Date {
        status == .open ? endsAt : startsAt
    }
}

/// How the Bookings list is cut up on screen. The default handoff order groups
/// by day, with overdue returns and missed pickups pulled into a leading group
/// of their own; any other order or a finished-status filter is one group,
/// because a day header over a title-sorted list would be a lie.
enum BookingListGroup: Identifiable {
    case attention([Booking])
    case day(Date, [Booking])
    case flat(String, [Booking])

    var id: String {
        switch self {
        case .attention: "attention"
        case .day(let date, _): "day-\(date.timeIntervalSinceReferenceDate)"
        case .flat(let title, _): "flat-\(title)"
        }
    }

    var bookings: [Booking] {
        switch self {
        case .attention(let rows), .day(_, let rows), .flat(_, let rows): rows
        }
    }

    /// Late returns and pickups whose time has passed -- the rows someone at
    /// the desk has to chase, whatever day they were due.
    static func isLate(_ booking: Booking, now: Date) -> Bool {
        switch booking.status {
        case .open: booking.endsAt < now
        case .booked, .pendingPickup: booking.startsAt < now
        default: false
        }
    }

    static func groups(
        for bookings: [Booking],
        byDay: Bool,
        flatTitle: String,
        now: Date,
        calendar: Calendar = .current
    ) -> [BookingListGroup] {
        guard byDay else { return bookings.isEmpty ? [] : [.flat(flatTitle, bookings)] }
        var late: [Booking] = []
        var days: [(day: Date, rows: [Booking])] = []
        for booking in bookings {
            if isLate(booking, now: now) {
                late.append(booking)
                continue
            }
            let day = calendar.startOfDay(for: booking.nextHandoff)
            if let last = days.indices.last, days[last].day == day {
                days[last].rows.append(booking)
            } else {
                days.append((day, [booking]))
            }
        }
        var result: [BookingListGroup] = []
        if !late.isEmpty { result.append(.attention(late)) }
        result += days.map { .day($0.day, $0.rows) }
        return result
    }
}

/// One booking in the list: avatar, title, one quiet meta line, and the
/// handoff time trailing. Mirrors the Schedule row -- the group card, the day
/// header, and the time column carry what the old rail, shadow, and dated
/// timing sentence used to.
struct BookingRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let booking: Booking
    /// Under a day header the time column shows only the time. In Needs
    /// attention or a single flat group it has to name the day too.
    var showsDay = false

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
        booking.serializedItems.count + booking.bulkItems.reduce(0) { $0 + $1.plannedQuantity }
    }

    /// Whether the VoiceOver label names the status outright. Open checkouts
    /// and booked rows are already said by their timing sentence.
    private func showsStatusBadge(now: Date) -> Bool {
        switch booking.status {
        case .open: booking.kind != .checkout
        case .booked: false
        default: true
        }
    }

    /// Overdue shouts red, otherwise the status' own tone (reservation purple,
    /// checkout blue, pickup orange).
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
        // Minute cadence, not the midnight `today`: a checkout turns overdue at
        // its due time, mid-afternoon as often as not.
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    accessibilityRow(now: context.date)
                } else {
                    compactRow(now: context.date)
                }
            }
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(rowAccessibilityLabel(now: context.date))
        }
    }

    private func compactRow(now: Date) -> some View {
        HStack(alignment: .top, spacing: 12) {
            // The one state mark: red overdue, orange pickup, purple
            // reserved, blue out -- the rail the list has always used, now
            // inside the day's card instead of on a card of its own.
            StatusRail(tone: accentTone(now: now))
            avatar
            VStack(alignment: .leading, spacing: 3) {
                bookingTitle.lineLimit(2)
                metadataLine(now: now, lineLimit: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            timeColumn(now: now)
        }
    }

    private func accessibilityRow(now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                StatusRail(tone: accentTone(now: now))
                avatar
                bookingTitle
                    .fixedSize(horizontal: false, vertical: true)
            }
            metadataLine(now: now, lineLimit: nil)
            Text(timing(now: now).text)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.statusText(accentTone(now: now)))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var avatar: some View {
        UserAvatarView(name: booking.requester.name, avatarUrl: booking.requester.avatarUrl, size: 32)
            .accessibilityHidden(true)
    }

    private var bookingTitle: some View {
        // Gotham, matching Home's Next Up rows: the two lists name the same
        // work and must not change typeface between them.
        Text(booking.title)
            .font(.gothamBold(size: 16))
    }

    private func metadataLine(now: Date, lineLimit: Int?) -> some View {
        // The state lives on the rail and in the time column; the meta line
        // stays the same two facts on every row.
        var parts: [Text] = [Text(booking.requester.name)]
        if itemCount > 0 {
            parts.append(Text("\(itemCount) item\(itemCount == 1 ? "" : "s")").monospacedDigit())
        }
        let line = parts.dropFirst().reduce(parts[0]) { Text("\($0) · \($1)") }
        return line
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(lineLimit)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Time column

    /// "Due" / "Pickup" under the time, in the state's tone. A late row says
    /// what was missed instead.
    private func actionWord(now: Date) -> String {
        if isOverdue(now: now) { return "Overdue" }
        switch booking.status {
        case .open: return "Due back"
        case .booked where booking.kind == .reservation:
            return booking.startsAt < now ? "Pickup missed" : "Reserved"
        case .booked, .pendingPickup:
            return booking.startsAt < now ? "Pickup missed" : "Awaiting pickup"
        case .completed: return "Returned"
        case .cancelled: return "Cancelled"
        default: return "Starts"
        }
    }

    /// The time alone under a day header; elsewhere the day, unless it is
    /// today, where the time is the more useful fact.
    private func primaryTime(now: Date) -> String {
        let time = booking.nextHandoff.formatted(date: .omitted, time: .shortened)
        guard showsDay else { return time }
        let calendar = Calendar.current
        switch calendar.dayOffset(of: booking.nextHandoff, from: now) {
        case 0: return time
        case -1: return "Yesterday"
        case 1: return "Tomorrow"
        default:
            let sameYear = calendar.component(.year, from: booking.nextHandoff) == calendar.component(.year, from: now)
            return sameYear
                ? booking.nextHandoff.formatted(.dateTime.month(.abbreviated).day())
                : booking.nextHandoff.formatted(.dateTime.month(.abbreviated).day().year())
        }
    }

    private func timeColumn(now: Date) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(primaryTime(now: now))
                .font(.subheadline.weight(.heavy).monospacedDigit())
                .foregroundStyle(Color.primary)
            Text(actionWord(now: now))
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.statusText(accentTone(now: now)))
        }
        .lineLimit(1)
        .fixedSize()
        .padding(.top, 1)
        .accessibilityHidden(true)
    }

    /// Shared relative-day wording, used whole by the accessibility layout
    /// and the VoiceOver label.
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
        parts.append(timing(now: now).text)
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
