import SwiftUI

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
        /// Staff-only: claims owed a decision.
        var reviewTrades: [ShiftTrade] = []
        var reviewRequests: [OpenWorkPickupRequest] = []
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

    /// Area filter, matching the web board. Nil means every area.
    var areaFilter: String? {
        didSet {
            guard areaFilter != oldValue else { return }
            Task { await load() }
        }
    }
    /// A staff review queue makes the 30-row cap far likelier to bite, so the
    /// board can now reach past the first page instead of silently truncating.
    var isLoadingMore = false
    var canLoadMore: Bool { trades.count < total }

    var isStaff: Bool { currentUserRole == "ADMIN" || currentUserRole == "STAFF" }
    var availableOpenShifts: [OpenWorkShift] { sections.availableOpenShifts }
    var waitingOpenShifts: [OpenWorkShift] { sections.waitingOpenShifts }
    var availableTrades: [ShiftTrade] { sections.availableTrades }
    var blockedTrades: [ShiftTrade] { sections.blockedTrades }
    var myTrades: [ShiftTrade] { sections.myTrades }
    var resolvedTrades: [ShiftTrade] { sections.resolvedTrades }
    var postedTrades: [ShiftTrade] { sections.postedTrades }
    var reviewTrades: [ShiftTrade] { sections.reviewTrades }
    var reviewRequests: [OpenWorkPickupRequest] { sections.reviewRequests }
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
    /// What the person can act on. For staff that is the review queue: a claim
    /// waiting on them is work, an open shift someone else may take is not.
    var actionableCount: Int {
        isStaff
            ? reviewCount
            : sections.availableOpenShifts.count + sections.availableTrades.count
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
        // The server scopes pickupRequests: every row for staff, only their own
        // for a student.
        if isStaff {
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
                // A claimed trade is a decision waiting to happen. Staff owe it;
                // the claimer is waiting on it; the poster tracks it in My Posts.
                if isStaff {
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
        sections = next
    }

    func load() async {
        async let trades: Void = loadTrades()
        async let openWork: Void = loadOpenWork()
        _ = await (trades, openWork)
    }

    func loadTrades() async {
        guard !isLoadingTrades else { return }
        isLoadingTrades = true
        defer { isLoadingTrades = false }
        do {
            let response = try await APIClient.shared.shiftTrades(area: areaFilter, limit: pageSize)
            trades = response.data
            total = response.total
            tradeLoadError = nil
        } catch {
            tradeLoadError = error.localizedDescription
        }
    }

    func loadMoreTrades() async {
        guard !isLoadingMore, !isLoadingTrades, canLoadMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let response = try await APIClient.shared.shiftTrades(
                area: areaFilter,
                limit: pageSize,
                offset: trades.count
            )
            // Append rather than replace, and drop anything already held: a row
            // resolved between pages would otherwise shift the window and
            // duplicate a trade across them.
            let known = Set(trades.map(\.id))
            trades.append(contentsOf: response.data.filter { !known.contains($0.id) })
            total = response.total
            tradeLoadError = nil
        } catch {
            tradeLoadError = error.localizedDescription
        }
    }

    func loadOpenWork() async {
        guard !isLoadingOpenWork else { return }
        isLoadingOpenWork = true
        defer { isLoadingOpenWork = false }
        do {
            openWork = try await APIClient.shared.scheduleOpenWork(area: areaFilter)
            openWorkLoadError = nil
        } catch {
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
    @State private var openShiftToPickup: OpenWorkShift?
    @State private var mineOnly = false
    @State private var showBlocked = false
    @State private var showHistory = false
    @State private var pendingActionId: String?
    @State private var actionError: String?
    @State private var actionErrorHaptic = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.visibleCount == 0 {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.allSourcesFailed, let error = vm.error, vm.visibleCount == 0 {
                    ContentUnavailableView {
                        Label("Couldn't load the Trade Board", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: {
                        Button("Retry") { Task { await vm.load() } }
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
                            Task { await vm.load() }
                        },
                        onDismiss: { self.actionError = nil }
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
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
                            set: { mineOnly = $0; Haptics.selection() }
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
            .refreshable { await vm.load() }
            .sheet(isPresented: $showPostSheet) {
                PostTradeSheet(myShifts: myShifts) { posted in
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
                Text("Staff review this before you're on the schedule.")
            }
            .confirmationDialog(pickupDialogTitle, isPresented: Binding(
                get: { openShiftToPickup != nil },
                set: { if !$0 { openShiftToPickup = nil } }
            ), titleVisibility: .visible) {
                Button("Claim Shift") { pickupConfirmedOpenShift() }
                Button("Cancel", role: .cancel) { openShiftToPickup = nil }
            } message: {
                Text("Staff review this before you're on the schedule.")
            }
            .confirmationDialog(cancelDialogTitle, isPresented: Binding(
                get: { tradeToCancel != nil },
                set: { if !$0 { tradeToCancel = nil } }
            ), titleVisibility: .visible) {
                Button("Cancel Trade", role: .destructive) { cancelConfirmedTrade() }
                Button("Keep Posted", role: .cancel) { tradeToCancel = nil }
            } message: {
                Text("Canceling removes the post; the shift stays assigned to you.")
            }
            .sensoryFeedback(.error, trigger: actionErrorHaptic)
        }
    }

    private var cancelDialogTitle: String {
        guard let trade = tradeToCancel else { return "Cancel trade?" }
        return "Cancel \(trade.shiftAssignment.shift.area.shiftAreaLabel) trade?"
    }

    private var claimDialogTitle: String {
        guard let trade = tradeToConfirm else { return "Claim shift?" }
        return "Claim \(trade.shiftAssignment.shift.area.shiftAreaLabel) shift from \(trade.postedBy.name)?"
    }

    private var pickupDialogTitle: String {
        guard let item = openShiftToPickup else { return "Claim shift?" }
        return "Claim \(item.shift.area.shiftAreaLabel) shift?"
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
                    onToggleMine: {
                        mineOnly.toggle()
                        Haptics.selection()
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
            if vm.reviewCount > 0 {
                Section {
                    ForEach(vm.reviewRequests) { request in
                        PickupRequestRow(
                            request: request,
                            isReview: true,
                            isActioning: pendingActionId == request.id,
                            approveAction: { review(id: request.id) { try await vm.approveRequest(id: request.id) } },
                            declineAction: { review(id: request.id) { try await vm.declineRequest(id: request.id) } }
                        )
                        .tradeBoardCardRow()
                    }
                    ForEach(vm.reviewTrades) { trade in
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
                } header: {
                    TradeSectionHeader(
                        title: "Staff Review",
                        subtitle: "Students are waiting. Nothing moves until you decide."
                    )
                }
            }

            if vm.myPendingCount > 0 {
                Section {
                    ForEach(vm.myPendingRequests) { request in
                        PickupRequestRow(request: request, isReview: false, isActioning: false)
                            .tradeBoardCardRow()
                    }
                    ForEach(vm.myPendingClaims) { trade in
                        TradeRow(
                            trade: trade,
                            context: .waitingOnStaff,
                            isActioning: false,
                            action: nil,
                            cancelAction: nil
                        )
                        .tradeBoardCardRow()
                    }
                } header: {
                    TradeSectionHeader(
                        title: "Waiting on Staff",
                        subtitle: "You're not on the schedule until these are approved."
                    )
                }
            }

            if !vm.availableOpenShifts.isEmpty || !vm.availableTrades.isEmpty {
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
                    TradeSectionHeader(title: "Available Now", subtitle: "Claiming sends this to staff for approval.")
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
                actionErrorHaptic &+= 1
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
                actionErrorHaptic &+= 1
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
                actionErrorHaptic &+= 1
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
                actionErrorHaptic &+= 1
                Haptics.warning()
            }
            tradeToCancel = nil
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
    /// Staff and students are counting different things. For staff the number is
    /// claims owed a decision; describing those as shifts they can claim was
    /// worse than saying nothing, because the words contradicted the buttons
    /// directly below them.
    let isStaff: Bool
    let onToggleMine: () -> Void

    private var summaryTone: StatusTone {
        if !isComplete { return .orange }
        return actionableCount > 0 ? .purple : .green
    }

    private var summaryIcon: String {
        if !isComplete { return "exclamationmark.triangle.fill" }
        if actionableCount == 0 { return "checkmark" }
        return isStaff ? "checklist" : "arrow.left.arrow.right"
    }

    private var summaryTitle: String {
        if mineOnly { return "Your trade posts" }
        if !isComplete { return "Coverage is incomplete" }
        if actionableCount == 0 { return isStaff ? "Nothing to review" : "Coverage is clear" }
        if isStaff {
            return "\(actionableCount) \(actionableCount == 1 ? "claim" : "claims") to review"
        }
        return "\(actionableCount) \(actionableCount == 1 ? "shift" : "shifts") available"
    }

    private var summaryDetail: String {
        if mineOnly { return "\(myPostCount) active \(myPostCount == 1 ? "post" : "posts")" }
        if !isComplete { return "Refresh the unavailable source before relying on this board" }
        if actionableCount == 0 {
            return isStaff ? "No claims are waiting on you" : "Open shifts and trades you can claim now"
        }
        return isStaff
            ? "Students are waiting on your decision"
            : "Open shifts and trades you can claim now"
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
        case "claim": "Staff review this before you're on the schedule."
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
    /// Staff owe this claim a decision.
    case review
    /// The viewer claimed it and is waiting.
    case waitingOnStaff

    func consequence(for trade: ShiftTrade) -> String {
        switch self {
        case .availableNow:
            return "Claiming sends this to staff; the shift stays with its owner until they approve."
        case .review:
            return "Nothing changes on the schedule until you approve or decline."
        case .waitingOnStaff:
            return "Waiting for staff to approve your claim."
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
    var approveAction: (() -> Void)?
    var declineAction: (() -> Void)?

    private var shift: ShiftTradeShift { trade.shiftAssignment.shift }
    private var badge: String {
        switch context {
        case .blocked: "Blocked"
        case .review: "Needs review"
        case .waitingOnStaff: "Waiting"
        default: trade.status.label
        }
    }
    private var tone: StatusTone {
        switch context {
        case .blocked: return StatusTone.red
        case .review, .waitingOnStaff: return StatusTone.orange
        default: return trade.status.tone
        }
    }
    private var availabilityContext: ShiftAvailabilityContext? {
        if context == .blocked { return trade.viewerAvailabilityContext }
        if context == .review { return trade.claimedByAvailabilityContext }
        if context == .posted, trade.status == .claimed { return trade.claimedByAvailabilityContext }
        return nil
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

                if context == .waitingOnStaff {
                    Text(context.consequence(for: trade))
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
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }
}

/// A student's claim on an open slot, shown to staff as work and to the student
/// as something they are waiting on.
private struct PickupRequestRow: View {
    let request: OpenWorkPickupRequest
    let isReview: Bool
    let isActioning: Bool
    var approveAction: (() -> Void)?
    var declineAction: (() -> Void)?

    private var shift: ShiftTradeShift { request.shift }

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
                    Text("Waiting for staff to approve your request.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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
    var effectiveStartsAt: Date { callStartsAt ?? startsAt }
    var effectiveEndsAt: Date { callEndsAt ?? endsAt }
    var timeRange: String {
        "\(effectiveStartsAt.formatted(date: .abbreviated, time: .shortened)) - \(effectiveEndsAt.formatted(date: .omitted, time: .shortened))"
    }
    var displayTitle: String {
        shiftGroup?.event?.compactTitle ?? "Open Shift"
    }
    var dateTimeLine: String {
        let day = effectiveStartsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        let start = effectiveStartsAt.formatted(date: .omitted, time: .shortened)
        let end = effectiveEndsAt.formatted(date: .omitted, time: .shortened)
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
