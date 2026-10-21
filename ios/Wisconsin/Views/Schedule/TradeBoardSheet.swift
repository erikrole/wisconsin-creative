import SwiftUI

/// One row of the Admin review queue. Trade claims and open-shift requests are
/// two records but one job, so they share a list and one ordering key.
enum TradeReviewItem: Identifiable {
    case request(OpenWorkPickupRequest)
    case trade(ShiftTrade)

    var id: String {
        switch self {
        case .request(let request): "request:\(request.id)"
        case .trade(let trade): "trade:\(trade.id)"
        }
    }

    var effectiveStartsAt: Date {
        switch self {
        case .request(let request): request.shift.effectiveStartsAt
        case .trade(let trade): trade.shiftAssignment.effectiveStartsAt
        }
    }
}

@MainActor
@Observable
final class TradeBoardViewModel {
    private struct Sections {
        var availableOpenShifts: [OpenWorkShift] = []
        var waitingOpenShifts: [OpenWorkShift] = []
        var availableTrades: [ShiftTrade] = []
        var blockedTrades: [ShiftTrade] = []
        var myTrades: [ShiftTrade] = []
        var resolvedTrades: [ShiftTrade] = []
        var postedTrades: [ShiftTrade] = []
        /// Admin-only: claims owed a decision.
        var reviewTrades: [ShiftTrade] = []
        var reviewRequests: [OpenWorkPickupRequest] = []
        /// The two above interleaved by shift start — what the queue renders.
        var reviewQueue: [TradeReviewItem] = []
        /// Student-only: claims this person is waiting on.
        var myPendingClaims: [ShiftTrade] = []
        var myPendingRequests: [OpenWorkPickupRequest] = []
    }

    var trades: [ShiftTrade] = [] {
        didSet { rebuildSections() }
    }
    var openWork = OpenWorkResponse(openShifts: [], pickupRequests: []) {
        didSet { rebuildSections() }
    }
    var total = 0
    var isLoadingTrades = false
    var isLoadingOpenWork = false
    var tradeLoadError: String?
    var openWorkLoadError: String?
    var currentUserId: String = "" {
        didSet { rebuildSections() }
    }
    var currentUserRole: String = "" {
        didSet { rebuildSections() }
    }
    private let pageSize = 30
    private var sections = Sections()
    private var tradeRequests = LatestRequestGeneration()
    private var openWorkRequests = LatestRequestGeneration()

    /// Area filter, matching the web board. Nil means every area.
    var areaFilter: String? {
        didSet {
            guard areaFilter != oldValue else { return }
            Task { await load(forceRefresh: true) }
        }
    }
    /// An Admin review queue makes the 30-row cap far likelier to bite, so the
    /// board can now reach past the first page instead of silently truncating.
    var isLoadingMore = false
    var canLoadMore: Bool { trades.count < total }

    var isStaff: Bool { currentUserRole == "ADMIN" || currentUserRole == "STAFF" }
    var canReview: Bool { currentUserRole == "ADMIN" }
    var availableOpenShifts: [OpenWorkShift] { sections.availableOpenShifts }
    var waitingOpenShifts: [OpenWorkShift] { sections.waitingOpenShifts }
    var availableTrades: [ShiftTrade] { sections.availableTrades }
    var blockedTrades: [ShiftTrade] { sections.blockedTrades }
    var myTrades: [ShiftTrade] { sections.myTrades }
    var resolvedTrades: [ShiftTrade] { sections.resolvedTrades }
    var postedTrades: [ShiftTrade] { sections.postedTrades }
    var reviewTrades: [ShiftTrade] { sections.reviewTrades }
    var reviewRequests: [OpenWorkPickupRequest] { sections.reviewRequests }
    /// Both kinds of pending claim in one chronological queue. Rendering them as
    /// two consecutive groups sorted the trades and the requests separately, so
    /// a request four days out still landed above a claim on tomorrow's shift —
    /// the queue looked ordered without being ordered.
    var reviewQueue: [TradeReviewItem] { sections.reviewQueue }
    var myPendingClaims: [ShiftTrade] { sections.myPendingClaims }
    var myPendingRequests: [OpenWorkPickupRequest] { sections.myPendingRequests }
    var reviewCount: Int { sections.reviewTrades.count + sections.reviewRequests.count }
    var myPendingCount: Int { sections.myPendingClaims.count + sections.myPendingRequests.count }
    var visibleCount: Int {
        sections.availableOpenShifts.count
            + sections.availableTrades.count
            + sections.blockedTrades.count
            + sections.myTrades.count
            + sections.waitingOpenShifts.count
            + sections.postedTrades.count
            + sections.resolvedTrades.count
            + reviewCount
            + myPendingCount
    }
    /// What the person can act on. For Admin that is the review queue: a claim
    /// waiting on them is work, an open shift someone else may take is not.
    var actionableCount: Int {
        if canReview { return reviewCount }
        if isStaff { return 0 }
        return sections.availableOpenShifts.count + sections.availableTrades.count
    }
    var isLoading: Bool { isLoadingTrades || isLoadingOpenWork }
    var hasSourceFailure: Bool { tradeLoadError != nil || openWorkLoadError != nil }
    var allSourcesFailed: Bool { tradeLoadError != nil && openWorkLoadError != nil }
    var error: String? {
        // Both sources often fail with the same sentence; say it once.
        var messages: [String] = []
        for message in [tradeLoadError, openWorkLoadError].compactMap({ $0 }) where !messages.contains(message) {
            messages.append(message)
        }
        return messages.isEmpty ? nil : messages.joined(separator: " ")
    }

    private func rebuildSections() {
        var next = Sections()
        // The server scopes pickupRequests: every row for Admin, only the
        // viewer's own for everyone else.
        if canReview {
            next.reviewRequests = openWork.pickupRequests
        } else {
            next.myPendingRequests = openWork.pickupRequests
        }

        for shift in openWork.openShifts {
            switch shift.action {
            case "claim": next.availableOpenShifts.append(shift)
            case "none": next.waitingOpenShifts.append(shift)
            default: break
            }
        }

        for trade in trades {
            if trade.status == .claimed {
                // A claimed trade is a decision waiting to happen. Admins owe it;
                // the claimer is waiting on it; the poster tracks it in My Posts.
                if canReview {
                    next.reviewTrades.append(trade)
                } else if trade.claimedBy?.id == currentUserId {
                    next.myPendingClaims.append(trade)
                } else if trade.postedBy.id == currentUserId {
                    next.myTrades.append(trade)
                } else {
                    next.postedTrades.append(trade)
                }
            } else if trade.status == .open, trade.postedBy.id != currentUserId {
                let canClaim = trade.viewerCanClaim ?? (!isStaff && trade.viewerAvailabilityContext?.blocking != true)
                if canClaim {
                    next.availableTrades.append(trade)
                } else if !isStaff {
                    next.blockedTrades.append(trade)
                } else {
                    next.postedTrades.append(trade)
                }
            } else if trade.postedBy.id == currentUserId, trade.status == .open {
                next.myTrades.append(trade)
            } else if trade.status == .completed || trade.status == .cancelled {
                next.resolvedTrades.append(trade)
            } else {
                next.postedTrades.append(trade)
            }
        }
        // Urgency is the shift, not the post. A claim filed this morning on a
        // shift tonight outranks one filed last week on a shift in March, so the
        // review queue runs soonest-first rather than in whatever order the two
        // sources happened to return.
        next.reviewTrades.sort { $0.shiftAssignment.effectiveStartsAt < $1.shiftAssignment.effectiveStartsAt }
        next.reviewRequests.sort { $0.shift.effectiveStartsAt < $1.shift.effectiveStartsAt }
        next.reviewQueue = (next.reviewRequests.map(TradeReviewItem.request)
            + next.reviewTrades.map(TradeReviewItem.trade))
            .sorted { $0.effectiveStartsAt < $1.effectiveStartsAt }
        sections = next
    }

    func load(forceRefresh: Bool = false) async {
        async let trades: Void = loadTrades(forceRefresh: forceRefresh)
        async let openWork: Void = loadOpenWork(forceRefresh: forceRefresh)
        _ = await (trades, openWork)
    }

    func loadTrades(forceRefresh: Bool = false) async {
        if !forceRefresh, isLoadingTrades { return }
        if forceRefresh {
            // A refresh replaces an in-flight pagination request. Its stale
            // response must not append into the new first page.
            tradeRequests.invalidate()
            isLoadingMore = false
        }
        let requestToken = tradeRequests.begin()
        isLoadingTrades = true
        defer {
            if tradeRequests.owns(requestToken) {
                isLoadingTrades = false
            }
        }
        do {
            let response = try await APIClient.shared.shiftTrades(area: areaFilter, limit: pageSize)
            guard tradeRequests.owns(requestToken), !Task.isCancelled else { return }
            trades = response.data
            total = response.total
            tradeLoadError = nil
        } catch {
            guard tradeRequests.owns(requestToken), !Task.isCancelled else { return }
            tradeLoadError = error.localizedDescription
        }
    }

    func loadMoreTrades() async {
        guard !isLoadingMore, !isLoadingTrades, canLoadMore else { return }
        let requestToken = tradeRequests.begin()
        let offset = trades.count
        isLoadingMore = true
        defer {
            if tradeRequests.owns(requestToken) {
                isLoadingMore = false
            }
        }
        do {
            let response = try await APIClient.shared.shiftTrades(
                area: areaFilter,
                limit: pageSize,
                offset: offset
            )
            guard tradeRequests.owns(requestToken), !Task.isCancelled else { return }
            // Append rather than replace, and drop anything already held: a row
            // resolved between pages would otherwise shift the window and
            // duplicate a trade across them.
            let known = Set(trades.map(\.id))
            trades.append(contentsOf: response.data.filter { !known.contains($0.id) })
            total = response.total
            tradeLoadError = nil
        } catch {
            guard tradeRequests.owns(requestToken), !Task.isCancelled else { return }
            tradeLoadError = error.localizedDescription
        }
    }

    func loadOpenWork(forceRefresh: Bool = false) async {
        if !forceRefresh, isLoadingOpenWork { return }
        let requestToken = openWorkRequests.begin()
        isLoadingOpenWork = true
        defer {
            if openWorkRequests.owns(requestToken) {
                isLoadingOpenWork = false
            }
        }
        do {
            let response = try await APIClient.shared.scheduleOpenWork(area: areaFilter)
            guard openWorkRequests.owns(requestToken), !Task.isCancelled else { return }
            openWork = response
            openWorkLoadError = nil
        } catch {
            guard openWorkRequests.owns(requestToken), !Task.isCancelled else { return }
            openWorkLoadError = error.localizedDescription
        }
    }

    func pickup(id: String) async throws {
        try await APIClient.shared.pickupOpenShift(id: id)
    }

    func claim(id: String) async throws {
        let updated = try await APIClient.shared.claimShiftTrade(id: id)
        if let idx = trades.firstIndex(where: { $0.id == id }) {
            trades[idx] = updated
        }
    }

    func approveTrade(id: String) async throws {
        try await APIClient.shared.approveShiftTrade(id: id)
    }

    func declineTrade(id: String) async throws {
        try await APIClient.shared.declineShiftTrade(id: id)
    }

    func approveRequest(id: String) async throws {
        try await APIClient.shared.approveShift(assignmentId: id)
    }

    func declineRequest(id: String) async throws {
        try await APIClient.shared.declineShift(assignmentId: id)
    }

    func cancel(id: String) async throws {
        let updated = try await APIClient.shared.cancelShiftTrade(id: id)
        if let idx = trades.firstIndex(where: { $0.id == id }) {
            trades[idx] = updated
        }
    }

    func withdrawClaim(id: String) async throws {
        let updated = try await APIClient.shared.withdrawShiftTradeClaim(id: id)
        if let idx = trades.firstIndex(where: { $0.id == id }) {
            trades[idx] = updated
        }
    }

    func withdrawRequest(id: String) async throws {
        try await APIClient.shared.withdrawShiftRequest(id: id)
    }
}

/// The four tabs of the board. Review is Admin-only, matching the web board.
private enum BoardTab: String, Identifiable, CaseIterable {
    case review, available, mine, history

    var id: String { rawValue }
    var label: String {
        switch self {
        case .review: "Review"
        case .available: "Available"
        case .mine: "Mine"
        case .history: "History"
        }
    }
}

private struct BoardNotice: Identifiable {
    enum Tone { case warn, block, info }
    let tone: Tone
    let text: String
    /// The row's one-line version; the detail sheet shows `text` in full.
    var short: String?
    var id: String { text }
}

private struct BoardAction: Identifiable {
    enum Style { case primary, secondary, destructive }
    let id: String
    let label: String
    let busyLabel: String
    let style: Style
    var accessibilityLabel: String?
    let run: () -> Void
}

/// What a row puts at its trailing edge. One compact control, never a
/// full-width button.
private enum BoardTrailing {
    /// "Claim", a small bordered capsule.
    case claim
    /// Decline and Approve as two round icon buttons.
    case review
    /// A tinted status capsule.
    case chip
    /// Secondary text only, for rows nobody can act on.
    case text
}

/// One shift or trade reduced to what a row shows, the same shape the web
/// board's `BoardRow` uses, so both clients read the same sentence.
private struct BoardRowModel: Identifiable {
    let id: String
    let startsAt: Date
    let title: String
    let startText: String
    var endText: String?
    let fullWhen: String
    let area: String
    let venueLabel: String
    let venueColor: Color
    let eventId: String?
    var person: ShiftTradeUser?
    var personLabel = "Posted by"
    var summary: String
    var note: String?
    var notices: [BoardNotice] = []
    var status: (label: String, tone: StatusTone)?
    var muted = false
    var trailing: BoardTrailing = .text
    var actions: [BoardAction] = []
    /// Cancelling your own post.
    var menuAction: BoardAction?

    /// Claim or Approve: the one action that says yes.
    var yesAction: BoardAction? { actions.first { $0.style == .primary } }
    /// Decline, Cancel post, Withdraw: the actions that say no or take back.
    var noActions: [BoardAction] {
        actions.filter { $0.style != .primary } + (menuAction.map { [$0] } ?? [])
    }
    var allActions: [BoardAction] { actions + (menuAction.map { [$0] } ?? []) }

    /// The one notice worth a third line on the row: something that could
    /// change the decision. Deadlines stay in the detail sheet.
    var rowNotice: BoardNotice? {
        notices.first { $0.tone == .block } ?? notices.first { $0.tone == .warn }
    }

    /// Row chips are short; the sheet keeps the full wording.
    var chipText: String? {
        guard let label = status?.label else { return nil }
        return label == "Waiting on admin" ? "Pending" : label
    }
}

private enum TradeRowMode {
    case claim, blocked, mine, watch, waiting, review, done
}

struct TradeBoardSheet: View {
    /// Same six areas the web board filters on.
    static let areas = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"]

    let myShifts: [MyShift]
    let currentUserId: String
    var currentUserRole: String = ""
    var onTradePosted: ((String) -> Void)? = nil
    var onTradeClaimed: ((String, String) -> Void)? = nil

    @State private var vm = TradeBoardViewModel()
    @State private var showPostSheet = false
    @State private var tradeToConfirm: ShiftTrade?
    @State private var tradeToCancel: ShiftTrade?
    @State private var tradeClaimToWithdraw: ShiftTrade?
    @State private var requestToWithdraw: OpenWorkPickupRequest?
    /// A decline waiting on confirmation. Declining tells a student no, so it
    /// takes a second tap; approve stays one tap.
    @State private var pendingDecline: PendingDecline?
    @State private var openShiftToPickup: OpenWorkShift?
    @State private var selectedTab: BoardTab?
    @State private var detailRowId: String?
    /// Rows with an action in flight. A set, so finishing one row cannot
    /// re-enable another row's buttons while its request is still running.
    @State private var pendingActionIds: Set<String> = []
    @State private var actionError: String?
    @Environment(\.today) private var today
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState: AppState?

    var body: some View {
        NavigationStack {
            Group {
                if vm.allSourcesFailed, let error = vm.error, vm.visibleCount == 0 {
                    ContentUnavailableView {
                        Label("Couldn't load the Trade Board", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .buttonStyle(.borderedProminent)
                            .buttonBorderShape(.capsule)
                            .controlSize(.large)
                            .tint(.primary)
                    }
                } else {
                    board
                }
            }
            .navigationTitle("Trade Board")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top) {
                if let actionError {
                    TradeBoardActionErrorBanner(
                        message: actionError,
                        onRefresh: {
                            self.actionError = nil
                            Task { await vm.load(forceRefresh: true) }
                        },
                        onDismiss: { self.actionError = nil }
                    )
                }
            }
            .onChange(of: actionError) { _, message in
                if let message {
                    AccessibilityNotification.Announcement(message).post()
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .tint(.primary)
                        .accessibilityLabel("Close")
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Area", selection: Binding(
                            get: { vm.areaFilter ?? "" },
                            set: { vm.areaFilter = $0.isEmpty ? nil : $0 }
                        )) {
                            Text("All areas").tag("")
                            ForEach(TradeBoardSheet.areas, id: \.self) { area in
                                Text(area.shiftAreaLabel).tag(area)
                            }
                        }
                    } label: {
                        Image(systemName: vm.areaFilter == nil
                            ? "line.3.horizontal.decrease.circle"
                            : "line.3.horizontal.decrease.circle.fill")
                    }
                    .tint(.primary)
                    .accessibilityLabel(vm.areaFilter.map { "Filtering by \($0.shiftAreaLabel)" } ?? "Filter by area")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showPostSheet = true } label: { Image(systemName: "plus") }
                        .tint(Color.brandPrimary)
                        .accessibilityLabel("Post trade")
                }
            }
            .task {
                vm.currentUserId = currentUserId
                vm.currentUserRole = currentUserRole
                await vm.load()
            }
            .refreshable { await vm.load(forceRefresh: true) }
            .navigationDestination(isPresented: $showPostSheet) {
                PostTradeSheet(myShifts: myShifts, wrapsInNavigationStack: false) { posted in
                    onTradePosted?(posted.area)
                    Task { await vm.load() }
                }
            }
            .sheet(isPresented: Binding(
                get: { detailRow != nil },
                set: { if !$0 { detailRowId = nil } }
            )) {
                if let row = detailRow {
                    TradeBoardDetailSheet(
                        row: row,
                        busyIds: pendingActionIds,
                        showsAdminNote: !vm.isStaff,
                        onAction: { action in
                            detailRowId = nil
                            action.run()
                        },
                        onOpenEvent: row.eventId.map { id in
                            {
                                detailRowId = nil
                                appState?.pendingPushEventId = id
                                dismiss()
                            }
                        }
                    )
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                }
            }
            .confirmationDialog("Claim shift?", isPresented: Binding(
                get: { tradeToConfirm != nil },
                set: { if !$0 { tradeToConfirm = nil } }
            ), titleVisibility: .visible) {
                Button("Claim Shift") { claimConfirmedTrade() }
                Button("Cancel", role: .cancel) { tradeToConfirm = nil }
            } message: {
                Text("An admin reviews this before you're on the schedule.")
            }
            .confirmationDialog("Claim shift?", isPresented: Binding(
                get: { openShiftToPickup != nil },
                set: { if !$0 { openShiftToPickup = nil } }
            ), titleVisibility: .visible) {
                Button("Claim Shift") { pickupConfirmedOpenShift() }
                Button("Cancel", role: .cancel) { openShiftToPickup = nil }
            } message: {
                Text("An admin reviews this before you're on the schedule.")
            }
            .confirmationDialog("Remove trade post?", isPresented: Binding(
                get: { tradeToCancel != nil },
                set: { if !$0 { tradeToCancel = nil } }
            ), titleVisibility: .visible) {
                Button("Cancel Trade", role: .destructive) { cancelConfirmedTrade() }
                Button("Keep Posted", role: .cancel) { tradeToCancel = nil }
            } message: {
                Text(cancelDialogMessage)
            }
            .confirmationDialog("Withdraw claim?", isPresented: Binding(
                get: { tradeClaimToWithdraw != nil },
                set: { if !$0 { tradeClaimToWithdraw = nil } }
            ), titleVisibility: .visible) {
                Button("Withdraw Claim", role: .destructive) { withdrawConfirmedClaim() }
                Button("Keep Claim", role: .cancel) { tradeClaimToWithdraw = nil }
            } message: {
                Text("This removes your pending claim and returns the post to the Trade Board.")
            }
            .confirmationDialog("Withdraw request?", isPresented: Binding(
                get: { requestToWithdraw != nil },
                set: { if !$0 { requestToWithdraw = nil } }
            ), titleVisibility: .visible) {
                Button("Withdraw Request", role: .destructive) { withdrawConfirmedRequest() }
                Button("Keep Request", role: .cancel) { requestToWithdraw = nil }
            } message: {
                Text("This removes your pending request. You will no longer be considered for this shift.")
            }
            .confirmationDialog(pendingDecline?.title ?? "", isPresented: Binding(
                get: { pendingDecline != nil },
                set: { if !$0 { pendingDecline = nil } }
            ), titleVisibility: .visible) {
                if let decline = pendingDecline {
                    Button("Decline", role: .destructive) {
                        review(id: decline.id, run: decline.run)
                        pendingDecline = nil
                    }
                }
                Button("Keep Reviewing", role: .cancel) { pendingDecline = nil }
            } message: {
                Text("They'll be told the request was declined.")
            }
        }
    }

    /// Cancelling a claimed post drops someone else's pending claim. Saying only
    /// that the shift stays yours hides the half of this that lands on another
    /// person.
    private var cancelDialogMessage: String {
        let base = "Canceling removes the post; the shift stays assigned to you."
        guard let trade = tradeToCancel, trade.status == .claimed else { return base }
        let claimer = trade.claimedBy?.name ?? "The claimer"
        return "\(base) \(claimer)'s pending claim is cancelled too."
    }

    // MARK: Tabs

    /// Review is Admin-only: it is the one tab that lets a person decide on
    /// someone else's claim.
    private var tabs: [BoardTab] {
        (vm.canReview ? [.review] : []) + [.available, .mine, .history]
    }

    private var activeTab: BoardTab {
        let fallback: BoardTab = vm.canReview && vm.reviewCount > 0 ? .review : .available
        guard let selectedTab, tabs.contains(selectedTab) else { return fallback }
        return selectedTab
    }

    private var tabSelection: Binding<BoardTab> {
        Binding(get: { activeTab }, set: { selectedTab = $0 })
    }

    /// The count lives in a line at the top of the list, not in the tab
    /// titles: a system segmented control carries plain words.
    private func summaryLine(for tab: BoardTab, rowCount: Int) -> String? {
        guard rowCount > 0 else { return nil }
        switch tab {
        case .review: return "\(vm.reviewCount) waiting on you"
        case .available:
            let n = availableItems.count
            if n == 0 { return nil }
            if vm.isStaff { return "\(n) open across the team" }
            return "\(n) \(n == 1 ? "shift" : "shifts") you can pick up"
        case .mine: return "\(rowCount) in motion"
        case .history: return nil
        }
    }

    private var board: some View {
        let rows = vm.isLoading && vm.visibleCount == 0 ? [] : rows(for: activeTab)
        let isPlaceholder = vm.isLoading && vm.visibleCount == 0
        return List {
            if let tradeLoadError = vm.tradeLoadError {
                Section {
                    TradeBoardSourceErrorRow(
                        title: "Trade posts are unavailable",
                        detail: tradeLoadError,
                        retry: { Task { await vm.loadTrades() } }
                    )
                }
            }

            if let openWorkLoadError = vm.openWorkLoadError {
                Section {
                    TradeBoardSourceErrorRow(
                        title: "Open Student slots are unavailable",
                        detail: openWorkLoadError,
                        retry: { Task { await vm.loadOpenWork() } }
                    )
                }
            }

            if isPlaceholder {
                Section {
                    ForEach(Self.placeholderRows) { row in
                        TradeBoardRow(row: row, busyIds: [])
                    }
                }
                .redacted(reason: .placeholder)
                .disabled(true)
            } else if rows.isEmpty {
                if !vm.hasSourceFailure {
                    Section { emptyState(for: activeTab) }
                        .listRowBackground(Color.clear)
                }
            } else {
                ForEach(Array(dayGroups(rows).enumerated()), id: \.element.id) { index, group in
                    Section {
                        ForEach(group.rows) { row in
                            boardRow(row)
                        }
                    } header: {
                        VStack(alignment: .leading, spacing: 10) {
                            if index == 0, let summary = summaryLine(for: activeTab, rowCount: rows.count) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(summary)
                                        .font(.subheadline)
                                        .foregroundStyle(Color(.secondaryLabel))
                                    if activeTab == .available, !vm.isStaff {
                                        Text("An admin approves every change before it reaches the schedule.")
                                            .font(.footnote)
                                            .foregroundStyle(Color(.secondaryLabel))
                                    }
                                }
                            }
                            Text(group.label(today: today))
                        }
                        .textCase(nil)
                    }
                }
            }

            if activeTab == .available, vm.openWork.openShiftsTruncated || vm.openWork.pickupRequestsTruncated {
                Text("Showing the first 100 open slots. Narrow by area to see the rest.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }

            if vm.canLoadMore {
                Section {
                    Button {
                        Task { await vm.loadMoreTrades() }
                    } label: {
                        HStack(spacing: 8) {
                            if vm.isLoadingMore { ProgressView().controlSize(.small) }
                            Text("Load more trades")
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .disabled(vm.isLoadingMore)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .sensoryFeedback(.selection, trigger: activeTab)
        .safeAreaInset(edge: .top, spacing: 0) {
            // The list's own background, so the picker sits on the page
            // rather than on a band of its own.
            tabPicker
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .background(Color(.systemGroupedBackground))
        }
    }

    private var tabPickerContent: some View {
        Picker("Trade Board", selection: tabSelection) {
            ForEach(tabs) { tab in
                Text(tab.label).tag(tab)
            }
        }
    }

    /// Segmented where four words fit, a menu where large text would not.
    @ViewBuilder
    private var tabPicker: some View {
        if dynamicTypeSize.isAccessibilitySize {
            tabPickerContent.pickerStyle(.menu).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        } else {
            tabPickerContent.pickerStyle(.segmented).frame(minHeight: 44)
        }
    }

    /// Swipe and long-press carry the same actions the row's control does, in
    /// the places iOS people already look for them.
    private func boardRow(_ row: BoardRowModel) -> some View {
        TradeBoardRow(row: row, busyIds: pendingActionIds)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
            .contentShape(Rectangle())
            .onTapGesture { detailRowId = row.id }
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Shows details")
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                if let yes = row.yesAction {
                    Button(action: yes.run) { Text(yes.label) }
                        .tint(row.trailing == .review ? .green : Color.brandPrimary)
                        .disabled(pendingActionIds.contains(yes.id))
                }
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                ForEach(row.noActions) { action in
                    Button(role: .destructive, action: action.run) { Text(action.label) }
                        .disabled(pendingActionIds.contains(action.id))
                }
            }
            .contextMenu {
                ForEach(row.allActions) { action in
                    Button(role: action.style == .primary ? nil : .destructive, action: action.run) {
                        Text(action.label)
                    }
                    .disabled(pendingActionIds.contains(action.id))
                }
            }
    }

    @ViewBuilder
    private func emptyState(for tab: BoardTab) -> some View {
        switch tab {
        case .review:
            ContentUnavailableView(
                "All caught up",
                systemImage: "checkmark.circle",
                description: Text("Claims and requests that need a decision land here, soonest shift first.")
            )
        case .available:
            ContentUnavailableView(
                "Nothing to pick up",
                systemImage: "arrow.triangle.2.circlepath",
                description: Text("Open shifts and trades from your area show up here the moment they are posted.")
            )
        case .mine:
            ContentUnavailableView {
                Label("Nothing in motion", systemImage: "person.crop.circle.badge.checkmark")
            } description: {
                Text("Shifts you post, and claims you are waiting on, are tracked here.")
            } actions: {
                Button("Post a Shift") { showPostSheet = true }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .tint(Color.brandPrimary)
            }
        case .history:
            ContentUnavailableView(
                "No history yet",
                systemImage: "clock.arrow.circlepath",
                description: Text("Completed and cancelled trades appear here.")
            )
        }
    }

    /// Stand-ins for the redacted loading list.
    private static let placeholderRows: [BoardRowModel] = (0..<5).map { index in
        BoardRowModel(
            id: "placeholder-\(index)",
            startsAt: .now,
            title: "Football vs Placeholder",
            startText: "6:00 PM",
            endText: "10:00 PM",
            fullWhen: "",
            area: "Video",
            venueLabel: "Home",
            venueColor: .gray,
            eventId: nil,
            person: nil,
            summary: "Someone can't work this",
            trailing: .claim
        )
    }

    // MARK: Rows

    /// Trade posts and unassigned slots answer the same question for a student
    /// ("what could I pick up?"), so they share one list ordered by start time.
    private enum AvailableItem: Identifiable {
        case trade(ShiftTrade)
        case open(OpenWorkShift)

        var id: String {
            switch self {
            case .trade(let trade): "trade-\(trade.id)"
            case .open(let item): "open-\(item.id)"
            }
        }

        var startsAt: Date {
            switch self {
            case .trade(let trade): trade.shiftAssignment.shift.effectiveStartsAt
            case .open(let item): item.shift.effectiveStartsAt
            }
        }
    }

    private var availableItems: [AvailableItem] {
        (vm.availableTrades.map(AvailableItem.trade) + vm.availableOpenShifts.map(AvailableItem.open))
            .sorted { $0.startsAt < $1.startsAt }
    }

    private var detailRow: BoardRowModel? {
        guard let detailRowId else { return nil }
        return BoardTab.allCases.lazy.compactMap { tab in
            rows(for: tab).first { $0.id == detailRowId }
        }.first
    }

    private func rows(for tab: BoardTab) -> [BoardRowModel] {
        switch tab {
        case .review:
            // Already interleaved and ordered by shift start in the model.
            return vm.reviewQueue.map { item in
                switch item {
                case .request(let request): requestRow(request, review: true)
                case .trade(let trade): tradeRow(trade, .review)
                }
            }
        case .available:
            var all: [BoardRowModel] = []
            for item in availableItems {
                switch item {
                case .trade(let trade): all.append(tradeRow(trade, .claim))
                case .open(let open): all.append(openShiftRow(open))
                }
            }
            all += vm.waitingOpenShifts.map(openShiftRow)
            all += vm.blockedTrades.map { tradeRow($0, .blocked) }
            if vm.isStaff {
                all += vm.postedTrades.map { tradeRow($0, .watch) }
            }
            return all.sorted { $0.startsAt < $1.startsAt }
        case .mine:
            let all = vm.myTrades.map { tradeRow($0, .mine) }
                + vm.myPendingClaims.map { tradeRow($0, .waiting) }
                + vm.myPendingRequests.map { requestRow($0, review: false) }
            return all.sorted { $0.startsAt < $1.startsAt }
        case .history:
            return vm.resolvedTrades.map { tradeRow($0, .done) }
                .sorted { $0.startsAt > $1.startsAt }
        }
    }

    private func action(
        _ id: String,
        _ label: String,
        _ busyLabel: String,
        _ style: BoardAction.Style,
        accessibilityLabel: String? = nil,
        run: @escaping () -> Void
    ) -> BoardAction {
        BoardAction(id: id, label: label, busyLabel: busyLabel, style: style,
                    accessibilityLabel: accessibilityLabel, run: run)
    }

    private func availabilityNotices(_ context: ShiftAvailabilityContext?) -> [BoardNotice] {
        guard let context else { return [] }
        return [BoardNotice(tone: context.blocking ? .block : .warn, text: "\(context.label). \(context.detail)", short: context.label)]
    }

    private func deadlineNotices(_ deadline: Date?) -> [BoardNotice] {
        guard let deadline else { return [] }
        return [BoardNotice(
            tone: .info,
            text: "Auto-approval check by \(deadline.formatted(date: .abbreviated, time: .shortened))."
        )]
    }

    private func baseRow(
        id: String,
        shift: ShiftTradeShift,
        personalStartsAt: Date?,
        personalEndsAt: Date?,
        person: ShiftTradeUser?,
        summary: String
    ) -> BoardRowModel {
        let parts = shift.timeParts(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt)
        return BoardRowModel(
            id: id,
            startsAt: shift.boardStart(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt),
            title: shift.displayTitle,
            startText: parts.start,
            endText: parts.end,
            fullWhen: shift.fullWhen(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt),
            area: shift.area.shiftAreaLabel,
            venueLabel: shift.classificationLabel,
            venueColor: shift.classificationColor,
            eventId: shift.shiftGroup?.event?.id,
            person: person,
            summary: summary
        )
    }

    private func tradeRow(_ trade: ShiftTrade, _ mode: TradeRowMode) -> BoardRowModel {
        let shift = trade.shiftAssignment.shift
        let assignment = trade.shiftAssignment
        let poster = trade.postedBy.name
        var row = baseRow(
            id: "trade:\(trade.id):\(mode)",
            shift: shift,
            personalStartsAt: assignment.callStartsAt,
            personalEndsAt: assignment.callEndsAt,
            person: trade.postedBy,
            summary: ""
        )
        row.note = trade.notes.flatMap { $0.isEmpty ? nil : $0 }
        switch mode {
        case .claim:
            row.summary = "\(poster) can't work this"
            row.notices = availabilityNotices(trade.viewerAvailabilityContext)
            row.trailing = .claim
            row.actions = [action(trade.id, "Claim", "Claiming…", .primary,
                                  accessibilityLabel: "Claim \(poster)'s shift") { tradeToConfirm = trade }]
        case .blocked:
            row.summary = "\(poster) can't work this"
            row.muted = true
            row.trailing = .text
            row.status = ("Can't claim", .gray)
            if trade.viewerAvailabilityContext != nil {
                row.notices = availabilityNotices(trade.viewerAvailabilityContext)
            } else if let reason = trade.viewerClaimReason {
                row.notices = [BoardNotice(tone: .info, text: reason)]
            }
        case .mine:
            let claimed = trade.status == .claimed
            row.person = trade.claimedBy ?? trade.postedBy
            row.personLabel = claimed ? "Claimed by" : "Posted by"
            row.summary = claimed
                ? "\(trade.claimedBy?.name ?? "Someone") claimed it. Waiting on an admin"
                : "Posted. You keep the shift until someone claims it and an admin approves"
            row.trailing = .chip
            row.status = claimed ? ("Claimed", .orange) : ("Open", .green)
            row.menuAction = action(trade.id, "Cancel post", "Cancelling…", .destructive,
                                    accessibilityLabel: "Cancel post") { tradeToCancel = trade }
        case .watch:
            row.summary = trade.claimedBy.map { "\(poster) → \($0.name)" } ?? "Posted by \(poster)"
            row.trailing = .chip
            row.status = (trade.status.label, trade.status.tone)
            row.notices = availabilityNotices(trade.claimedByAvailabilityContext)
        case .waiting:
            row.summary = "Your claim on \(poster)'s shift"
            row.trailing = .chip
            row.status = ("Waiting on admin", .orange)
            row.notices = deadlineNotices(trade.reviewAutoApprovesAt)
            row.actions = [action("withdraw-claim:\(trade.id)", "Withdraw claim", "Withdrawing…", .destructive) {
                tradeClaimToWithdraw = trade
            }]
        case .review:
            let claimer = trade.claimedBy?.name ?? "Someone"
            row.person = trade.claimedBy ?? trade.postedBy
            row.personLabel = "Requested by"
            row.summary = "\(claimer) wants \(poster)'s shift"
            row.trailing = .review
            row.notices = availabilityNotices(trade.claimedByAvailabilityContext) + deadlineNotices(trade.reviewAutoApprovesAt)
            row.actions = [
                action(trade.id, "Approve", "Approving…", .primary,
                       accessibilityLabel: "Approve trade for \(trade.claimedBy?.name ?? "the claimer")") {
                    review(id: trade.id) { try await vm.approveTrade(id: trade.id) }
                },
                action("decline:\(trade.id)", "Decline", "Declining…", .destructive,
                       accessibilityLabel: "Decline trade for \(trade.claimedBy?.name ?? "the claimer")") {
                    pendingDecline = PendingDecline(id: trade.id, who: trade.claimedBy?.name) {
                        try await vm.declineTrade(id: trade.id)
                    }
                },
            ]
        case .done:
            row.summary = trade.claimedBy.map { "\(poster) → \($0.name)" } ?? "Posted by \(poster)"
            row.trailing = .text
            row.status = (trade.status.label, trade.status.tone)
            row.muted = true
        }
        return row
    }

    private func openShiftRow(_ item: OpenWorkShift) -> BoardRowModel {
        let claimable = item.action == "claim"
        let warning = claimable
            ? (item.availabilityContext == nil ? item.advisoryConflictNote ?? item.warnings.first?.label : nil)
            : (item.reason.isEmpty ? item.advisoryConflictNote ?? item.warnings.first?.label : item.reason)
        var row = baseRow(
            id: "open:\(item.id)",
            shift: item.shift,
            personalStartsAt: nil,
            personalEndsAt: nil,
            person: nil,
            summary: item.requestCount > 0
                ? "Open slot · \(item.requestCount) \(item.requestCount == 1 ? "request" : "requests") so far"
                : "Open slot nobody holds yet"
        )
        row.muted = !claimable
        row.trailing = claimable ? .claim : .text
        row.status = claimable ? nil : ("Can't claim", .gray)
        if let warning {
            row.notices.append(BoardNotice(tone: claimable ? .warn : .info, text: warning))
        }
        if claimable {
            row.notices += availabilityNotices(item.availabilityContext)
            row.actions = [action(item.id, "Claim", "Claiming…", .primary,
                                  accessibilityLabel: "Claim open slot") { openShiftToPickup = item }]
        }
        return row
    }

    private func requestRow(_ request: OpenWorkPickupRequest, review: Bool) -> BoardRowModel {
        var row = baseRow(
            id: "request:\(request.id):\(review ? "review" : "waiting")",
            shift: request.shift,
            personalStartsAt: nil,
            personalEndsAt: nil,
            person: request.user,
            summary: review ? "\(request.user.name) wants this open slot" : "Your request for this open slot"
        )
        row.personLabel = review ? "Requested by" : "Requested by"
        row.trailing = review ? .review : .chip
        row.status = review ? nil : ("Waiting on admin", .orange)
        if let note = request.conflictNote, !note.isEmpty {
            row.notices.append(BoardNotice(tone: .warn, text: note))
        }
        row.notices += deadlineNotices(request.reviewAutoApprovesAt)
        if review {
            row.actions = [
                action(request.id, "Approve", "Approving…", .primary,
                       accessibilityLabel: "Approve request from \(request.user.name)") {
                    self.review(id: request.id) { try await vm.approveRequest(id: request.id) }
                },
                action("decline:\(request.id)", "Decline", "Declining…", .destructive,
                       accessibilityLabel: "Decline request from \(request.user.name)") {
                    pendingDecline = PendingDecline(id: request.id, who: request.user.name) {
                        try await vm.declineRequest(id: request.id)
                    }
                },
            ]
        } else {
            row.actions = [action("withdraw-request:\(request.id)", "Withdraw request", "Withdrawing…", .destructive) {
                requestToWithdraw = request
            }]
        }
        return row
    }

    /// Rows are already in order, so a new day starts a new group.
    private func dayGroups(_ rows: [BoardRowModel]) -> [BoardDayGroup] {
        let calendar = Calendar.current
        var groups: [BoardDayGroup] = []
        for row in rows {
            let day = calendar.startOfDay(for: row.startsAt)
            if let last = groups.last, last.day == day {
                groups[groups.count - 1].rows.append(row)
            } else {
                groups.append(BoardDayGroup(day: day, rows: [row]))
            }
        }
        return groups
    }

    // MARK: Actions

    /// One executor for every board action. The row is busy only while its
    /// own request runs, and the board reloads afterwards whether the action
    /// succeeded or not, so a row someone else already resolved disappears
    /// instead of staying tappable with a stale button.
    private func runAction(
        _ actionId: String,
        _ operation: @escaping () async throws -> Void,
        onSuccess: @escaping () -> Void = {},
        finally: @escaping () -> Void = {}
    ) {
        guard pendingActionIds.insert(actionId).inserted else { return }
        Task {
            defer {
                pendingActionIds.remove(actionId)
                finally()
            }
            do {
                try await operation()
                Haptics.success()
                onSuccess()
            } catch APIError.conflict(let message) {
                actionError = message.isEmpty ? "This was already resolved. The board has been refreshed." : message
                Haptics.warning()
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
            await vm.load(forceRefresh: true)
        }
    }

    private func pickupConfirmedOpenShift() {
        guard let item = openShiftToPickup else { return }
        runAction(item.id, { try await vm.pickup(id: item.id) }, onSuccess: {
            let when = item.shift.effectiveStartsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            onTradeClaimed?(item.shift.area, when)
        }, finally: { openShiftToPickup = nil })
    }

    private func claimConfirmedTrade() {
        guard let trade = tradeToConfirm else { return }
        runAction(trade.id, { try await vm.claim(id: trade.id) }, onSuccess: {
            let when = trade.shiftAssignment.shift.effectiveStartsAt
                .formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            onTradeClaimed?(trade.shiftAssignment.shift.area, when)
        }, finally: { tradeToConfirm = nil })
    }

    /// All four review decisions.
    private func review(id: String, run: @escaping () async throws -> Void) {
        runAction(id, run)
    }

    private func cancelConfirmedTrade() {
        guard let trade = tradeToCancel else { return }
        runAction(trade.id, { try await vm.cancel(id: trade.id) }, finally: { tradeToCancel = nil })
    }

    private func withdrawConfirmedClaim() {
        guard let trade = tradeClaimToWithdraw else { return }
        runAction("withdraw-claim:\(trade.id)", { try await vm.withdrawClaim(id: trade.id) }, finally: { tradeClaimToWithdraw = nil })
    }

    private func withdrawConfirmedRequest() {
        guard let request = requestToWithdraw else { return }
        runAction("withdraw-request:\(request.id)", { try await vm.withdrawRequest(id: request.id) }, finally: { requestToWithdraw = nil })
    }
}

private struct PendingDecline {
    let id: String
    let who: String?
    let run: () async throws -> Void

    var title: String {
        guard let who, !who.isEmpty else { return "Decline this request?" }
        return "Decline \(who)'s request?"
    }
}

private struct BoardDayGroup: Identifiable {
    let day: Date
    var rows: [BoardRowModel]

    var id: Date { day }

    /// "Today · Thu, Oct 22", "Tomorrow · Fri, Oct 23", then the weekday and
    /// date. Keyed to the environment day, not the wall clock, so the label
    /// rolls over at midnight.
    func label(today: Date) -> String {
        let base = day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        switch Calendar.current.dayOffset(of: day, from: today) {
        case 0: return "Today · \(base)"
        case 1: return "Tomorrow · \(base)"
        default: return base
        }
    }
}

// MARK: Views

/// One row, built like the Schedule rows it sits beside: a fixed time column
/// aligned to the title's first line, the event and one clean secondary line,
/// an optional notice line, and a single compact control at the trailing edge.
/// The day is the section header, so the row does not repeat it.
private struct TradeBoardRow: View {
    let row: BoardRowModel
    let busyIds: Set<String>
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var timeColumn: CGFloat = 62

    private var isAX: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        Group {
            if isAX {
                VStack(alignment: .leading, spacing: 8) {
                    timeStack
                    details
                    trailing
                }
            } else {
                HStack(alignment: .center, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        timeStack
                            .frame(width: timeColumn, alignment: .leading)
                        details
                    }
                    trailing
                }
            }
        }
        .opacity(row.muted ? 0.6 : 1)
    }

    private var timeStack: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(row.startText)
                .font(.subheadline.weight(.semibold))
            if let end = row.endText {
                Text(end)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .monospacedDigit()
        .accessibilityHidden(true)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(row.title)
                .font(.headline)
                .lineLimit(isAX ? 3 : 1)
                .truncationMode(.tail)
            Text("\(row.area) \u{00B7} \(row.summary)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(isAX ? 4 : 2)
            if let notice = row.rowNotice {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .accessibilityHidden(true)
                    Text(notice.short ?? notice.text)
                        .lineLimit(isAX ? 3 : 2)
                }
                .font(.caption)
                .foregroundStyle(notice.tone == .block ? Color.statusText(.red) : Color.statusText(.orange))
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var trailing: some View {
        switch row.trailing {
        case .claim:
            if let claim = row.yesAction {
                let isBusy = busyIds.contains(claim.id)
                Button(action: claim.run) {
                    HStack(spacing: 4) {
                        if isBusy { ProgressView().controlSize(.mini) }
                        Text(isBusy ? claim.busyLabel : claim.label)
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 2)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(Color.brandPrimary)
                .disabled(isBusy)
                .accessibilityLabel(claim.accessibilityLabel ?? claim.label)
            }
        case .review:
            HStack(spacing: 0) {
                ForEach(row.noActions) { decline in
                    RoundIconButton(action: decline, symbol: "xmark", isApprove: false, isBusy: busyIds.contains(decline.id))
                }
                if let approve = row.yesAction {
                    RoundIconButton(action: approve, symbol: "checkmark", isApprove: true, isBusy: busyIds.contains(approve.id))
                }
            }
        case .chip:
            if let text = row.chipText, let status = row.status {
                Label {
                    Text(text)
                } icon: {
                    if text == "Pending" { Image(systemName: "clock.fill") }
                }
                .labelStyle(ChipLabelStyle())
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.statusText(status.tone))
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(Color.statusBackground(status.tone), in: Capsule())
                .fixedSize()
            }
        case .text:
            if let status = row.status {
                Text(status.label)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
        }
    }
}

private struct ChipLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

/// 34pt on screen, 44pt to hit, 10pt between the two.
private struct RoundIconButton: View {
    let action: BoardAction
    let symbol: String
    let isApprove: Bool
    let isBusy: Bool

    var body: some View {
        Button(action: action.run) {
            ZStack {
                Circle().fill(isApprove ? Color.green : Color(.tertiarySystemFill))
                if isBusy {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(isApprove ? Color.white : Color.secondary)
                }
            }
            .frame(width: 34, height: 34)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .disabled(isBusy)
        .accessibilityLabel(action.accessibilityLabel ?? action.label)
    }
}

private struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// The full story for one row as a native grouped list, with the actions in a
/// bar at the bottom, where a thumb already is.
private struct TradeBoardDetailSheet: View {
    let row: BoardRowModel
    let busyIds: Set<String>
    let showsAdminNote: Bool
    let onAction: (BoardAction) -> Void
    let onOpenEvent: (() -> Void)?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title)
                            .font(.gothamBold(size: 22))
                        Text(row.fullWhen)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 4, trailing: 4))
                }

                Section {
                    LabeledContent("Area") {
                        HStack(spacing: 6) {
                            Circle().fill(row.venueColor).frame(width: 8, height: 8)
                                .accessibilityHidden(true)
                            Text("\(row.area) \u{00B7} \(row.venueLabel)")
                        }
                    }
                    if let person = row.person {
                        LabeledContent(row.personLabel) {
                            HStack(spacing: 8) {
                                UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 24)
                                    .accessibilityHidden(true)
                                Text(person.name)
                            }
                        }
                    }
                    if let status = row.status {
                        LabeledContent("Status") {
                            Text(status.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.statusText(status.tone))
                        }
                    }
                    if let note = row.note {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Note")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text("\u{201C}\(note)\u{201D}")
                        }
                    }
                    if let onOpenEvent {
                        Button(action: onOpenEvent) {
                            HStack {
                                Text("Open event")
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(minHeight: 32)
                        }
                        .tint(.primary)
                    }
                } footer: {
                    Text(row.summary)
                }

                if !row.notices.isEmpty {
                    Section {
                        ForEach(row.notices) { notice in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: notice.tone == .info ? "info.circle" : "exclamationmark.triangle.fill")
                                    .accessibilityHidden(true)
                                Text(notice.text)
                            }
                            .font(.subheadline)
                            .foregroundStyle(notice.tone == .block ? Color.statusText(.red)
                                : notice.tone == .warn ? Color.statusText(.orange) : Color.secondary)
                        }
                    }
                }

            }
            .listSectionSpacing(.compact)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) { actionBar }
        }
        // Opaque, so nothing from the board bleeds through the glass.
        .presentationBackground(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private var actionBar: some View {
        if !row.allActions.isEmpty {
            VStack(spacing: 8) {
                if showsAdminNote, row.trailing == .claim {
                    Text("An admin reviews this before you're on the schedule.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if row.trailing == .review {
                    HStack(spacing: 10) {
                        ForEach(row.noActions) { actionButton($0, bordered: true) }
                        if let yes = row.yesAction { actionButton(yes, bordered: false) }
                    }
                } else {
                    ForEach(row.allActions.filter { $0.style == .primary } + row.allActions.filter { $0.style != .primary }) {
                        actionButton($0, bordered: $0.style != .primary)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color(.systemGroupedBackground))
        }
    }

    @ViewBuilder
    private func actionButton(_ action: BoardAction, bordered: Bool) -> some View {
        let isBusy = busyIds.contains(action.id)
        let tint: Color = action.style == .primary
            ? (row.trailing == .review ? .green : Color.brandPrimary)
            : (action.style == .destructive ? .red : Color.primary)
        let button = Button(role: action.style == .destructive ? .destructive : nil) {
            onAction(action)
        } label: {
            HStack(spacing: 6) {
                if isBusy { ProgressView().controlSize(.small) }
                Text(isBusy ? action.busyLabel : action.label)
            }
            .frame(maxWidth: .infinity, minHeight: 28)
        }
        if bordered {
            button.buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.large)
                .tint(tint).disabled(isBusy)
        } else {
            button.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.large)
                .tint(tint).disabled(isBusy)
        }
    }
}

private struct TradeBoardActionErrorBanner: View {
    let message: String
    let onRefresh: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.semibold))
                .accessibilityHidden(true)

            Text(message)
                .font(.footnote.weight(.medium))
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 8)

            Button("Refresh", action: onRefresh)
                .font(.footnote.weight(.semibold))

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Dismiss trade board error")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: 12))
        .foregroundStyle(Color.statusText(.red))
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
    }
}

private struct TradeBoardSourceErrorRow: View {
    let title: String
    let detail: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.statusText(.orange))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            Button("Retry", action: retry)
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
        .padding(14)
        .background(Color.statusBackground(.orange), in: RoundedRectangle(cornerRadius: 16))
    }
}

private extension ShiftTradeShift {
    var displayTitle: String {
        shiftGroup?.event?.compactTitle ?? "Open Shift"
    }

    /// A poster's personal call window beats the slot's, as it does everywhere
    /// the server decides; away and neutral Student rows still show the event
    /// window.
    private func window(personalStartsAt: Date?, personalEndsAt: Date?) -> (Date, Date) {
        let usesEventWindow = displayStartsAt != effectiveStartsAt
        let startsAt = usesEventWindow ? displayStartsAt : (personalStartsAt ?? displayStartsAt)
        let endsAt = usesEventWindow ? displayEndsAt : (personalEndsAt ?? displayEndsAt)
        return (startsAt, endsAt)
    }

    private var allDayStartsAt: Date? {
        guard let event = shiftGroup?.event, event.allDay == true else { return nil }
        return event.startsAt
    }

    /// The date the row is filed under. An all-day event is a date: it is
    /// stored at UTC midnight, so it is read in UTC, not shifted a day.
    func boardStart(personalStartsAt: Date?, personalEndsAt: Date?) -> Date {
        if let allDay = allDayStartsAt {
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
            let parts = utc.dateComponents([.year, .month, .day], from: allDay)
            return Calendar.current.date(from: parts) ?? allDay
        }
        return window(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt).0
    }

    /// Just the times: the day is the row's date tile and group header.
    func timesLine(personalStartsAt: Date?, personalEndsAt: Date?) -> String {
        if allDayStartsAt != nil { return "All day" }
        let (startsAt, endsAt) = window(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt)
        let start = startsAt.formatted(date: .omitted, time: .shortened)
        let end = endsAt.formatted(date: .omitted, time: .shortened)
        return "\(start) to \(end)"
    }

    /// Start and end as separate strings for the row's time column.
    func timeParts(personalStartsAt: Date?, personalEndsAt: Date?) -> (start: String, end: String?) {
        if allDayStartsAt != nil { return ("All day", nil) }
        let (startsAt, endsAt) = window(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt)
        return (startsAt.formatted(date: .omitted, time: .shortened), endsAt.formatted(date: .omitted, time: .shortened))
    }

    /// "Friday, Oct 23 \u{00B7} 6:00 \u{2013} 10:00 PM" for the detail sheet, the shared
    /// AM/PM said once.
    func fullWhen(personalStartsAt: Date?, personalEndsAt: Date?) -> String {
        let day = boardStart(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt)
            .formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        let parts = timeParts(personalStartsAt: personalStartsAt, personalEndsAt: personalEndsAt)
        guard let end = parts.end else { return "\(day) \u{00B7} All day" }
        return "\(day) \u{00B7} \(Self.timeRange(parts.start, end))"
    }

    /// "7:00 PM", "11:00 PM" becomes "7:00 \u{2013} 11:00 PM"; mixed meridiems keep both.
    static func timeRange(_ start: String, _ end: String) -> String {
        func split(_ text: String) -> (String, String) {
            guard let index = text.lastIndex(where: { $0 == " " || $0 == "\u{202F}" }) else { return (text, "") }
            return (String(text[..<index]), String(text[text.index(after: index)...]))
        }
        let (startClock, startSuffix) = split(start)
        let (endClock, endSuffix) = split(end)
        if !startSuffix.isEmpty, startSuffix == endSuffix {
            return "\(startClock) \u{2013} \(endClock) \(endSuffix)"
        }
        return "\(start) \u{2013} \(end)"
    }

    var classificationLabel: String {
        guard let event = shiftGroup?.event else { return "Neutral or non-game" }
        switch event.venue {
        case .home: return "Home"
        case .away: return "Away"
        case .neutral: return "Neutral"
        case .nonGame: return "Non-game"
        }
    }
    var classificationColor: Color {
        guard let event = shiftGroup?.event else { return venueRailColor(isHome: nil) }
        return Color.statusText(venueTone(event.venue))
    }
}

private extension ShiftTradeStatus {
    var tone: StatusTone {
        switch self {
        case .open:
            return StatusTone.green
        case .claimed:
            return StatusTone.orange
        case .approved:
            return StatusTone.orange
        case .completed:
            return StatusTone.gray
        case .cancelled, .expired, .unknown:
            return StatusTone.gray
        }
    }
}

