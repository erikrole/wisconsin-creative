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
        let message = [tradeLoadError, openWorkLoadError].compactMap { $0 }.joined(separator: " ")
        return message.isEmpty ? nil : message
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
        await load()
    }

    func claim(id: String) async throws {
        let updated = try await APIClient.shared.claimShiftTrade(id: id)
        if let idx = trades.firstIndex(where: { $0.id == id }) {
            trades[idx] = updated
        }
        await load()
    }

    func approveTrade(id: String) async throws {
        _ = try await APIClient.shared.approveShiftTrade(id: id)
        await load()
    }

    func declineTrade(id: String) async throws {
        _ = try await APIClient.shared.declineShiftTrade(id: id)
        await load()
    }

    func approveRequest(id: String) async throws {
        try await APIClient.shared.approveShift(assignmentId: id)
        await load()
    }

    func declineRequest(id: String) async throws {
        try await APIClient.shared.declineShift(assignmentId: id)
        await load()
    }

    func cancel(id: String) async throws {
        let updated = try await APIClient.shared.cancelShiftTrade(id: id)
        if let idx = trades.firstIndex(where: { $0.id == id }) {
            trades[idx] = updated
        }
        await load()
    }

    func withdrawClaim(id: String) async throws {
        let updated = try await APIClient.shared.withdrawShiftTradeClaim(id: id)
        if let idx = trades.firstIndex(where: { $0.id == id }) {
            trades[idx] = updated
        }
        await load()
    }

    func withdrawRequest(id: String) async throws {
        try await APIClient.shared.withdrawShiftRequest(id: id)
        await load()
    }
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
    @State private var openShiftToPickup: OpenWorkShift?
    @State private var mineOnly = false
    @State private var showBlocked = false
    @State private var showHistory = false
    @State private var pendingActionId: String?
    @State private var actionError: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.visibleCount == 0 {
                    ProgressView("Loading Trade Board")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.allSourcesFailed, let error = vm.error, vm.visibleCount == 0 {
                    ContentUnavailableView {
                        Label("Couldn't load the Trade Board", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    tradeList
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
                    Button("Close") { dismiss() }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
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
                        Divider()
                        Toggle(isOn: Binding(
                            get: { mineOnly },
                            set: { mineOnly = $0 }
                        )) {
                            Label("My posts only", systemImage: "person.crop.circle")
                        }
                    } label: {
                        Image(systemName: (vm.areaFilter == nil && !mineOnly)
                            ? "line.3.horizontal.decrease.circle"
                            : "line.3.horizontal.decrease.circle.fill")
                            .frame(width: 36, height: 36)
                    }
                    .foregroundStyle((vm.areaFilter == nil && !mineOnly) ? Color.primary : Color.brandPrimary)
                    .accessibilityLabel(vm.areaFilter.map { "Filtering by \($0.shiftAreaLabel)" } ?? "Filter")

                    Button {
                        showPostSheet = true
                    } label: {
                        Image(systemName: "plus")
                            .frame(width: 36, height: 36)
                    }
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
            .confirmationDialog(claimDialogTitle, isPresented: Binding(
                get: { tradeToConfirm != nil },
                set: { if !$0 { tradeToConfirm = nil } }
            ), titleVisibility: .visible) {
                Button("Claim Shift") { claimConfirmedTrade() }
                Button("Cancel", role: .cancel) { tradeToConfirm = nil }
            } message: {
                Text("An admin reviews this before you're on the schedule.")
            }
            .confirmationDialog(pickupDialogTitle, isPresented: Binding(
                get: { openShiftToPickup != nil },
                set: { if !$0 { openShiftToPickup = nil } }
            ), titleVisibility: .visible) {
                Button("Claim Shift") { pickupConfirmedOpenShift() }
                Button("Cancel", role: .cancel) { openShiftToPickup = nil }
            } message: {
                Text("An admin reviews this before you're on the schedule.")
            }
            .confirmationDialog(cancelDialogTitle, isPresented: Binding(
                get: { tradeToCancel != nil },
                set: { if !$0 { tradeToCancel = nil } }
            ), titleVisibility: .visible) {
                Button("Cancel Trade", role: .destructive) { cancelConfirmedTrade() }
                Button("Keep Posted", role: .cancel) { tradeToCancel = nil }
            } message: {
                Text(cancelDialogMessage)
            }
            .confirmationDialog(withdrawClaimDialogTitle, isPresented: Binding(
                get: { tradeClaimToWithdraw != nil },
                set: { if !$0 { tradeClaimToWithdraw = nil } }
            ), titleVisibility: .visible) {
                Button("Withdraw Claim", role: .destructive) { withdrawConfirmedClaim() }
                Button("Keep Claim", role: .cancel) { tradeClaimToWithdraw = nil }
            } message: {
                Text("This removes your pending claim and returns the post to the Trade Board.")
            }
            .confirmationDialog(withdrawRequestDialogTitle, isPresented: Binding(
                get: { requestToWithdraw != nil },
                set: { if !$0 { requestToWithdraw = nil } }
            ), titleVisibility: .visible) {
                Button("Withdraw Request", role: .destructive) { withdrawConfirmedRequest() }
                Button("Keep Request", role: .cancel) { requestToWithdraw = nil }
            } message: {
                Text("This removes your pending request. You will no longer be considered for this shift.")
            }
        }
    }

    private var cancelDialogTitle: String {
        "Remove trade post?"
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

    private var claimDialogTitle: String {
        "Claim shift?"
    }

    private var pickupDialogTitle: String {
        "Claim shift?"
    }

    private var withdrawClaimDialogTitle: String {
        "Withdraw claim?"
    }

    private var withdrawRequestDialogTitle: String {
        "Withdraw request?"
    }

    private var tradeList: some View {
        List {
            Section {
                TradeBoardSummaryCard(
                    actionableCount: vm.actionableCount,
                    myPostCount: vm.myTrades.count,
                    mineOnly: mineOnly,
                    isComplete: !vm.hasSourceFailure,
                    isStaff: vm.isStaff,
                    isReviewer: vm.canReview,
                    onToggleMine: {
                        mineOnly.toggle()
                    }
                )
            }
            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            if let tradeLoadError = vm.tradeLoadError {
                Section {
                    TradeBoardSourceErrorRow(
                        title: "Trade posts are unavailable",
                        detail: tradeLoadError,
                        retry: { Task { await vm.loadTrades() } }
                    )
                }
                .tradeBoardCardRow()
            }

            if let openWorkLoadError = vm.openWorkLoadError {
                Section {
                    TradeBoardSourceErrorRow(
                        title: "Open Student slots are unavailable",
                        detail: openWorkLoadError,
                        retry: { Task { await vm.loadOpenWork() } }
                    )
                }
                .tradeBoardCardRow()
            }

            if mineOnly {
                myPostsContent
            } else {
                availableContent
            }

            if vm.canLoadMore && !mineOnly {
                Section {
                    Button {
                        Task { await vm.loadMoreTrades() }
                    } label: {
                        HStack(spacing: 8) {
                            if vm.isLoadingMore { ProgressView().controlSize(.small) }
                            Text("Load more trades")
                                .font(.subheadline.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(vm.isLoadingMore)
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            if vm.visibleCount == 0 && !vm.hasSourceFailure {
                Section {
                    ContentUnavailableView(
                        "No open shifts",
                        systemImage: "arrow.triangle.2.circlepath",
                        description: Text("Open shifts and trade posts will appear here when coverage changes.")
                    )
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private var availableContent: some View {
            if vm.canReview, vm.reviewCount > 0 {
                Section {
                    ForEach(vm.reviewQueue) { item in
                        switch item {
                        case .request(let request):
                            PickupRequestRow(
                                request: request,
                                isReview: true,
                                isActioning: pendingActionId == request.id,
                                approveAction: { review(id: request.id) { try await vm.approveRequest(id: request.id) } },
                                declineAction: { review(id: request.id) { try await vm.declineRequest(id: request.id) } }
                            )
                            .tradeBoardCardRow()
                        case .trade(let trade):
                            TradeRow(
                                trade: trade,
                                context: .review,
                                isActioning: pendingActionId == trade.id,
                                action: nil,
                                cancelAction: nil,
                                approveAction: { review(id: trade.id) { try await vm.approveTrade(id: trade.id) } },
                                declineAction: { review(id: trade.id) { try await vm.declineTrade(id: trade.id) } }
                            )
                            .tradeBoardCardRow()
                        }
                    }
                } header: {
                    TradeSectionHeader(
                        title: "Admin Review",
                        subtitle: "Students are waiting. Nothing moves until you decide."
                    )
                }
            }

            if vm.myPendingCount > 0 {
                Section {
                    ForEach(vm.myPendingRequests) { request in
                        PickupRequestRow(
                            request: request,
                            isReview: false,
                            isActioning: pendingActionId == "withdraw-request:\(request.id)",
                            withdrawAction: { requestToWithdraw = request }
                        )
                            .tradeBoardCardRow()
                    }
                    ForEach(vm.myPendingClaims) { trade in
                        TradeRow(
                            trade: trade,
                            context: .waitingOnAdmin,
                            isActioning: pendingActionId == "withdraw-claim:\(trade.id)",
                            action: nil,
                            cancelAction: nil,
                            withdrawAction: { tradeClaimToWithdraw = trade }
                        )
                        .tradeBoardCardRow()
                    }
                } header: {
                    TradeSectionHeader(
                        title: "Waiting on Admin",
                        subtitle: "You're not on the schedule until these are approved."
                    )
                }
            }

            if !vm.availableTrades.isEmpty {
                Section {
                    ForEach(vm.availableTrades) { trade in
                        TradeRow(
                            trade: trade,
                            context: .availableNow,
                            isActioning: pendingActionId == trade.id,
                            action: { tradeToConfirm = trade },
                            cancelAction: nil
                        )
                        .tradeBoardCardRow()
                    }
                } header: {
                    TradeSectionHeader(
                        title: "Trade Posts",
                        subtitle: "Shifts another student posted for coverage. Claiming sends the trade to an admin."
                    )
                }
            }

            if !vm.availableOpenShifts.isEmpty {
                Section {
                    ForEach(vm.availableOpenShifts) { item in
                        OpenWorkShiftRow(
                            item: item,
                            context: .availableNow,
                            isActioning: pendingActionId == item.id
                        ) {
                            openShiftToPickup = item
                        }
                        .tradeBoardCardRow()
                    }
                } header: {
                    TradeSectionHeader(
                        title: "Open Shifts",
                        subtitle: "Unassigned Student slots. Claiming sends a pickup request to an admin."
                    )
                }
            }

            if !vm.waitingOpenShifts.isEmpty || !vm.blockedTrades.isEmpty {
                Section {
                    DisclosureGroup(isExpanded: $showBlocked) {
                        VStack(spacing: 10) {
                            ForEach(vm.waitingOpenShifts) { item in
                                OpenWorkShiftRow(item: item, context: .waiting, isActioning: false, action: nil)
                            }
                            ForEach(vm.blockedTrades) { trade in
                                TradeRow(trade: trade, context: .blocked, isActioning: false, action: nil, cancelAction: nil)
                            }
                        }
                        .padding(.top, 10)
                    } label: {
                        Label("Waiting or Blocked", systemImage: "clock.badge.exclamationmark")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .tradeBoardCardRow()
            }

            if vm.isStaff, !vm.postedTrades.isEmpty {
                Section {
                    ForEach(vm.postedTrades) { trade in
                        TradeRow(trade: trade, context: .posted, isActioning: false, action: nil, cancelAction: nil)
                            .tradeBoardCardRow()
                    }
                } header: {
                    TradeSectionHeader(title: "Posted Trades", subtitle: "Coverage context across the team.")
                }
            }

            if !vm.resolvedTrades.isEmpty {
                Section {
                    DisclosureGroup(isExpanded: $showHistory) {
                        VStack(spacing: 10) {
                            ForEach(vm.resolvedTrades) { trade in
                                TradeRow(trade: trade, context: .resolved, isActioning: false, action: nil, cancelAction: nil)
                            }
                        }
                        .padding(.top, 10)
                    } label: {
                        Label("Resolved", systemImage: "clock.arrow.circlepath")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .tradeBoardCardRow()
            }
    }

    @ViewBuilder
    private var myPostsContent: some View {
        if vm.myTrades.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("No shifts posted", systemImage: "person.crop.circle.badge.checkmark")
                } description: {
                    Text("Post one of your upcoming shifts when you need someone else to cover it.")
                } actions: {
                    Button("Post a Shift") { showPostSheet = true }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.brandPrimary)
                }
            }
            .listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(vm.myTrades) { trade in
                    TradeRow(
                        trade: trade,
                        context: .myPost,
                        isActioning: pendingActionId == trade.id,
                        action: nil,
                        cancelAction: { tradeToCancel = trade }
                    )
                    .tradeBoardCardRow()
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            tradeToCancel = trade
                        } label: {
                            Label("Cancel Trade", systemImage: "xmark")
                        }
                        .accessibilityLabel("Cancel trade")
                    }
                }
            } header: {
                TradeSectionHeader(title: "My Posts", subtitle: "Canceling a post keeps the shift assigned to you.")
            }
        }
    }

    private func pickupConfirmedOpenShift() {
        guard let item = openShiftToPickup else { return }
        pendingActionId = item.id
        Task {
            defer { pendingActionId = nil }
            do {
                try await vm.pickup(id: item.id)
                Haptics.success()
                let when = item.shift.effectiveStartsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
                onTradeClaimed?(item.shift.area, when)
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
            openShiftToPickup = nil
        }
    }

    private func claimConfirmedTrade() {
        guard let trade = tradeToConfirm else { return }
        pendingActionId = trade.id
        Task {
            defer { pendingActionId = nil }
            do {
                try await vm.claim(id: trade.id)
                Haptics.success()
                let when = trade.shiftAssignment.shift.effectiveStartsAt
                    .formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
                onTradeClaimed?(trade.shiftAssignment.shift.area, when)
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
            tradeToConfirm = nil
        }
    }

    /// One executor for all four review decisions. Each re-loads the board, so a
    /// row someone else already resolved disappears instead of failing on tap.
    private func review(id: String, run: @escaping () async throws -> Void) {
        pendingActionId = id
        Task {
            defer { pendingActionId = nil }
            do {
                try await run()
                Haptics.success()
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
        }
    }

    private func cancelConfirmedTrade() {
        guard let trade = tradeToCancel else { return }
        pendingActionId = trade.id
        Task {
            defer { pendingActionId = nil }
            do {
                try await vm.cancel(id: trade.id)
                Haptics.success()
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
            tradeToCancel = nil
        }
    }

    private func withdrawConfirmedClaim() {
        guard let trade = tradeClaimToWithdraw else { return }
        let actionId = "withdraw-claim:\(trade.id)"
        pendingActionId = actionId
        Task {
            defer { pendingActionId = nil }
            do {
                try await vm.withdrawClaim(id: trade.id)
                Haptics.success()
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
            tradeClaimToWithdraw = nil
        }
    }

    private func withdrawConfirmedRequest() {
        guard let request = requestToWithdraw else { return }
        let actionId = "withdraw-request:\(request.id)"
        pendingActionId = actionId
        Task {
            defer { pendingActionId = nil }
            do {
                try await vm.withdrawRequest(id: request.id)
                Haptics.success()
            } catch {
                actionError = error.localizedDescription
                Haptics.warning()
            }
            requestToWithdraw = nil
        }
    }

}

private struct TradeSectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(subtitle)
                .font(.caption)
                .fontWeight(.regular)
                .textCase(nil)
                .foregroundStyle(.secondary)
        }
    }
}

private struct TradeBoardSummaryCard: View {
    let actionableCount: Int
    let myPostCount: Int
    let mineOnly: Bool
    let isComplete: Bool
    /// Reviewers and students are counting different things. For Admin the
    /// number is claims owed a decision; describing those as shifts they can claim was
    /// worse than saying nothing, because the words contradicted the buttons
    /// directly below them.
    let isStaff: Bool
    let isReviewer: Bool
    let onToggleMine: () -> Void

    private var summaryTone: StatusTone {
        if !isComplete { return .orange }
        return actionableCount > 0 ? .purple : .green
    }

    private var summaryIcon: String {
        if !isComplete { return "exclamationmark.triangle.fill" }
        if actionableCount == 0 { return "checkmark" }
        return isReviewer ? "checklist" : "arrow.left.arrow.right"
    }

    private var summaryTitle: String {
        if mineOnly { return "Your trade posts" }
        if !isComplete { return "Coverage is incomplete" }
        if actionableCount == 0 {
            if isReviewer { return "Nothing to review" }
            return isStaff ? "Trade Board overview" : "Coverage is clear"
        }
        if isReviewer {
            return "\(actionableCount) \(actionableCount == 1 ? "claim" : "claims") to review"
        }
        return "\(actionableCount) \(actionableCount == 1 ? "opportunity" : "opportunities") available"
    }

    private var summaryDetail: String {
        if mineOnly { return "\(myPostCount) active \(myPostCount == 1 ? "post" : "posts")" }
        if !isComplete { return "Refresh the unavailable source before relying on this board" }
        if actionableCount == 0 {
            if isReviewer { return "No claims are waiting on you" }
            return isStaff ? "Open shifts and trade posts across the team" : "Trade posts and open shifts are listed separately below"
        }
        return isReviewer
            ? "Students are waiting on your decision"
            : "Trade posts and open shifts are listed separately below"
    }

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 13)
                    .fill(Color.statusBackground(summaryTone))
                Image(systemName: summaryIcon)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Color.statusText(summaryTone))
            }
            .frame(width: 46, height: 46)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(summaryTitle)
                    .font(.headline)
                Text(summaryDetail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Button(action: onToggleMine) {
                Image(systemName: mineOnly ? "arrow.left.arrow.right" : "person.crop.circle")
                    .frame(width: 38, height: 38)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.circle)
            .tint(mineOnly ? Color.brandPrimary : Color.primary)
            .accessibilityLabel(mineOnly ? "Show available shifts" : "Show my trade posts")
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}

private enum OpenWorkRowContext: Equatable {
    case availableNow
    case waiting

    var badge: String {
        switch self {
        case .availableNow: "Open"
        case .waiting: "Not available"
        }
    }

    var tone: StatusTone {
        switch self {
        case .availableNow:
            return StatusTone.green
        case .waiting:
            return StatusTone.gray
        }
    }
}

private struct OpenWorkShiftRow: View {
    let item: OpenWorkShift
    let context: OpenWorkRowContext
    let isActioning: Bool
    var action: (() -> Void)?

    private var shift: ShiftTradeShift { item.shift }
    private var consequence: String {
        switch item.action {
        case "claim": "An admin reviews this before you're on the schedule."
        default: item.reason
        }
    }
    private var warning: String? {
        item.availabilityContext == nil ? item.advisoryConflictNote ?? item.warnings.first?.label : nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(shift.classificationColor)
                .frame(width: 4, height: 76)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                rowHeader(title: shift.displayTitle, badge: context.badge, tone: context.tone)

                Text(shift.dateTimeLine)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.statusText(.blue))

                HStack(spacing: 6) {
                    Text(shift.area.shiftAreaLabel)
                    Text("·")
                    Text(shift.classificationLabel)
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if let warning {
                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.orange))
                } else if context == .waiting {
                    Text(consequence)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let availabilityContext = item.availabilityContext {
                    ShiftAvailabilityContextNote(context: availabilityContext)
                }

                if let action {
                    Button(action: action) {
                        HStack(spacing: 7) {
                            if isActioning { ProgressView().controlSize(.small) }
                            Text("Claim shift")
                                .font(.subheadline.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.brandPrimary)
                    .controlSize(.small)
                    .frame(minHeight: 44)
                    .disabled(isActioning)
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }
}

private enum TradeRowContext: Equatable {
    case availableNow
    case blocked
    case myPost
    case posted
    case resolved
    /// Admins owe this claim a decision.
    case review
    /// The viewer claimed it and is waiting.
    case waitingOnAdmin

    func consequence(for trade: ShiftTrade) -> String {
        switch self {
        case .availableNow:
            return "Claiming sends this to an admin; the shift stays with its owner until approval."
        case .review:
            return "Nothing changes on the schedule until you approve or decline."
        case .waitingOnAdmin:
            return "Waiting for an admin to approve your claim."
        case .blocked:
            return trade.viewerAvailabilityContext?.detail ?? "This shift is not available with your current schedule."
        case .myPost:
            return "Canceling removes the post; the shift stays assigned to you."
        case .posted:
            return trade.status.label
        case .resolved:
            return trade.status.label
        }
    }
}

private struct TradeRow: View {
    let trade: ShiftTrade
    let context: TradeRowContext
    let isActioning: Bool
    var action: (() -> Void)?
    var cancelAction: (() -> Void)?
    var withdrawAction: (() -> Void)?
    var approveAction: (() -> Void)?
    var declineAction: (() -> Void)?

    private var shift: ShiftTradeShift { trade.shiftAssignment.shift }
    private var badge: String {
        switch context {
        case .blocked: "Blocked"
        case .review: "Needs review"
        case .waitingOnAdmin: "Waiting"
        default: trade.status.label
        }
    }
    private var tone: StatusTone {
        switch context {
        case .blocked: return StatusTone.red
        case .review, .waitingOnAdmin: return StatusTone.orange
        default: return trade.status.tone
        }
    }
    private var availabilityContext: ShiftAvailabilityContext? {
        if context == .blocked { return trade.viewerAvailabilityContext }
        if context == .review { return trade.claimedByAvailabilityContext }
        if context == .posted, trade.status == .claimed { return trade.claimedByAvailabilityContext }
        return nil
    }

    private var reviewDeadlineLine: String? {
        guard context == .review || context == .waitingOnAdmin,
              let deadline = trade.reviewAutoApprovesAt else { return nil }
        return "Auto-approval check by \(deadline.formatted(date: .abbreviated, time: .shortened))."
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(shift.classificationColor)
                .frame(width: 4, height: 76)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                rowHeader(title: shift.displayTitle, badge: badge, tone: tone)

                Text(shift.dateTimeLine)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.statusText(.blue))

                Text("\(shift.area.shiftAreaLabel) · \(shift.classificationLabel) · Posted by \(trade.postedBy.name)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let claimedBy = trade.claimedBy {
                    Text("Claimed by \(claimedBy.name)")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.orange))
                }

                if let notes = trade.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if let availabilityContext {
                    ShiftAvailabilityContextNote(context: availabilityContext)
                } else if context == .blocked, let reason = trade.viewerClaimReason {
                    Label(reason, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.orange))
                }

                if context == .waitingOnAdmin {
                    Text(context.consequence(for: trade))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let reviewDeadlineLine {
                    Text(reviewDeadlineLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 8) {
                    if let action {
                        Button(action: action) {
                            HStack(spacing: 7) {
                                if isActioning { ProgressView().controlSize(.small) }
                                Text("Claim this shift")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.brandPrimary)
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .disabled(isActioning)
                    }

                    if let approveAction {
                        Button(action: approveAction) {
                            HStack(spacing: 7) {
                                if isActioning { ProgressView().controlSize(.small) }
                                Text("Approve")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.statusText(.green))
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .disabled(isActioning)
                        .accessibilityLabel("Approve trade for \(trade.claimedBy?.name ?? "the claimer")")
                    }

                    if let declineAction {
                        Button(action: declineAction) {
                            Text("Decline")
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .disabled(isActioning)
                        .accessibilityLabel("Decline trade for \(trade.claimedBy?.name ?? "the claimer")")
                    }

                    if let cancelAction {
                        Button(role: .destructive, action: cancelAction) {
                            Text("Cancel post")
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .disabled(isActioning)
                    }

                    if let withdrawAction {
                        Button(role: .destructive, action: withdrawAction) {
                            Text("Withdraw claim")
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .disabled(isActioning)
                    }
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }
}

/// A student's claim on an open slot, shown to Admin as work and to the student
/// as something they are waiting on.
private struct PickupRequestRow: View {
    let request: OpenWorkPickupRequest
    let isReview: Bool
    let isActioning: Bool
    var approveAction: (() -> Void)?
    var declineAction: (() -> Void)?
    var withdrawAction: (() -> Void)?

    private var shift: ShiftTradeShift { request.shift }
    private var reviewDeadlineLine: String? {
        guard let deadline = request.reviewAutoApprovesAt else { return nil }
        return "Auto-approval check by \(deadline.formatted(date: .abbreviated, time: .shortened))."
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(shift.classificationColor)
                .frame(width: 4, height: 76)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                rowHeader(
                    title: shift.displayTitle,
                    badge: isReview ? "Needs review" : "Waiting",
                    tone: .orange
                )

                Text(shift.dateTimeLine)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.statusText(.blue))

                Text(isReview
                    ? "\(shift.area.shiftAreaLabel) · \(request.user.name) wants this slot"
                    : "\(shift.area.shiftAreaLabel) · \(shift.classificationLabel)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let note = request.conflictNote, !note.isEmpty {
                    Label(note, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.statusText(.orange))
                }

                if !isReview {
                    Text("Waiting for an admin to approve your request.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let reviewDeadlineLine {
                        Text(reviewDeadlineLine)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let withdrawAction {
                        Button(role: .destructive, action: withdrawAction) {
                            HStack(spacing: 7) {
                                if isActioning { ProgressView().controlSize(.small) }
                                Text("Withdraw request")
                                    .font(.subheadline.weight(.medium))
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .frame(minHeight: 44)
                        .disabled(isActioning)
                    }
                }

                if isReview {
                    HStack(spacing: 8) {
                        if let approveAction {
                            Button(action: approveAction) {
                                HStack(spacing: 7) {
                                    if isActioning { ProgressView().controlSize(.small) }
                                    Text("Approve")
                                        .font(.subheadline.weight(.semibold))
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Color.statusText(.green))
                            .controlSize(.small)
                            .frame(minHeight: 44)
                            .disabled(isActioning)
                            .accessibilityLabel("Approve request from \(request.user.name)")
                        }
                        if let declineAction {
                            Button(action: declineAction) {
                                Text("Decline")
                                    .font(.subheadline.weight(.medium))
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(minHeight: 44)
                            .disabled(isActioning)
                            .accessibilityLabel("Decline request from \(request.user.name)")
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }
}

private func rowHeader(title: String, badge: String, tone: StatusTone) -> some View {
    HStack(alignment: .top) {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .lineLimit(2)
        Spacer(minLength: 8)
        Text(badge)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Color.statusText(tone))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.statusBackground(tone), in: Capsule())
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

private struct ShiftAvailabilityContextNote: View {
    let context: ShiftAvailabilityContext

    private var tone: StatusTone {
        switch context.state {
        case "blocked": .red
        case "preferred": .green
        default: .orange
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: context.blocking ? "exclamationmark.triangle.fill" : "calendar.badge.clock")
                .font(.caption)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.label)
                    .font(.caption.weight(.semibold))
                Text(context.detail)
                    .font(.caption)
            }
        }
        .foregroundStyle(Color.statusText(tone))
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.statusBackground(tone), in: RoundedRectangle(cornerRadius: 10))
    }
}

private extension ShiftTradeShift {
    var timeRange: String {
        "\(displayStartsAt.formatted(date: .abbreviated, time: .shortened)) - \(displayEndsAt.formatted(date: .omitted, time: .shortened))"
    }
    var displayTitle: String {
        shiftGroup?.event?.compactTitle ?? "Open Shift"
    }
    var dateTimeLine: String {
        let day = displayStartsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        let start = displayStartsAt.formatted(date: .omitted, time: .shortened)
        let end = displayEndsAt.formatted(date: .omitted, time: .shortened)
        return "\(day) · \(start) to \(end)"
    }
    var classificationLabel: String {
        switch shiftGroup?.event?.isHome {
        case true: "Home"
        case false: "Away"
        case nil: "Neutral or non-game"
        }
    }
    var classificationColor: Color {
        venueRailColor(isHome: shiftGroup?.event?.isHome)
    }
}

private extension View {
    func tradeBoardCardRow() -> some View {
        listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
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
