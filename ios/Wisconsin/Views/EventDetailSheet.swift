import SwiftUI

/// Bridges server-backed Schedule history into the system undo manager. The
/// manager remains the owner of three-finger/shake and keyboard dispatch; the
/// target only registers the inverse operation and lets the server decide
/// whether the expected version is still current.
@MainActor
private final class ScheduleWorkingCopyUndoCoordinator: NSObject {
    typealias Action = @MainActor () async -> Bool

    private(set) var hasUndoAction = false
    private(set) var hasRedoAction = false

    func clear(manager: UndoManager?) {
        guard let manager else { return }
        manager.removeAllActions(withTarget: self)
        hasUndoAction = false
        hasRedoAction = false
    }

    func registerCommand(
        label: String,
        manager: UndoManager?,
        undo: @escaping Action,
        redo: @escaping Action
    ) {
        guard let manager else { return }
        manager.registerUndo(withTarget: self) { [weak self] _ in
            self?.perform(
                label: label,
                manager: manager,
                action: undo,
                inverse: redo,
                inverseMenuTitle: "Redo (label)"
            )
        }
        manager.setActionName("Undo (label)")
        hasUndoAction = true
        hasRedoAction = false
    }

    private func perform(
        label: String,
        manager: UndoManager,
        action: @escaping Action,
        inverse: @escaping Action,
        inverseMenuTitle: String
    ) {
        manager.registerUndo(withTarget: self) { [weak self] _ in
            self?.perform(
                label: label,
                manager: manager,
                action: inverse,
                inverse: action,
                inverseMenuTitle: "Undo (label)"
            )
        }
        manager.setActionName(inverseMenuTitle)
        if inverseMenuTitle.hasPrefix("Redo") {
            hasUndoAction = false
            hasRedoAction = true
        } else {
            hasUndoAction = true
            hasRedoAction = false
        }

        Task { @MainActor [weak self] in
            guard let self else { return }
            if !(await action()) {
                self.clear(manager: manager)
            }
        }
    }
}

// MARK: - View Model

@MainActor
@Observable
final class EventDetailViewModel {
    let event: ScheduleEvent
    let myShift: MyShift?

    var shiftGroup: EventShiftGroup? {
        didSet { shiftsByArea = Self.makeShiftsByArea(from: workingEditor?.eventShifts() ?? shiftGroup?.shifts ?? []) }
    }
    var workingEditor: WorkingScheduleEditor? {
        didSet {
            shiftsByArea = Self.makeShiftsByArea(from: workingEditor?.eventShifts() ?? shiftGroup?.shifts ?? [])
        }
    }
    /// Starts `true`, before `.task` has fired.
    ///
    /// At `false` the very first render fell through to the `shiftGroup == nil`
    /// branch, so every open of a staffed event flashed "No crew scheduled" and
    /// a prominent "Set up crew" button for at least one frame — the console
    /// answering "is this ready?" with the wrong answer before it had asked.
    /// All three house detail views start `true` for the same reason.
    var isLoading = true
    var error: String?
    /// False until the first `load()` settles, so the crew region can tell
    /// "nothing here yet" from "genuinely no crew".
    private(set) var hasLoaded = false
    private var loadsWorkingCopy = false

    /// Set when the staff draft overlay failed but the published roster loaded.
    /// Kept apart from `error`, which blanks the crew section.
    var workingCopyError: String?
    /// A system undo/redo failure is kept with the working-copy state so the
    /// same retryable error surface is used for buttons, keyboard, and the
    /// three-finger/shake route.
    var workingHistoryError: String?
    var lastWorkingHistoryAction: String?
    private var isPerformingHistoryAction = false

    init(event: ScheduleEvent, myShift: MyShift?) {
        self.event = event
        self.myShift = myShift
    }

    var workingVersion: Int { workingEditor?.workingVersion ?? 0 }
    var hasUnpublishedChanges: Bool { workingEditor?.hasUnpublishedChanges == true }
    var workingChangeSummary: String { workingEditor?.changes.summary ?? "No pending changes" }
    var displayedShifts: [EventShift] { workingEditor?.eventShifts() ?? shiftGroup?.shifts ?? [] }

    /// Reentrancy is guarded separately from `isLoading`, which is now a display
    /// state that starts `true`. Guarding on `isLoading` itself would have made
    /// the very first `load()` return immediately and never fetch anything.
    private var isFetching = false
    private var loadRequests = LatestRequestGeneration()

    func load(includeWorkingCopy: Bool? = nil, forceRefresh: Bool = false) async {
        if !forceRefresh, isFetching { return }
        isFetching = true
        if let includeWorkingCopy { loadsWorkingCopy = includeWorkingCopy }
        let shouldLoadWorkingCopy = includeWorkingCopy ?? loadsWorkingCopy
        let requestToken = loadRequests.begin()
        isLoading = true
        error = nil
        workingHistoryError = nil
        defer {
            if loadRequests.owns(requestToken) {
                isFetching = false
                isLoading = false
                hasLoaded = true
            }
        }
        do {
            let group = try await APIClient.shared.shiftGroup(eventId: event.id)
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            shiftGroup = group
            workingCopyError = nil
            if shouldLoadWorkingCopy, let group {
                // The working copy is a staff draft overlay on a roster that has
                // already loaded, and `displayedShifts` falls back to the
                // published shifts without it. Losing it must not blank the crew
                // everyone came here to read -- the Schedule list learned the
                // same lesson with its separate `refreshError`.
                do {
                    let editor = try await APIClient.shared.workingScheduleEditor(shiftGroupId: group.id)
                    guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
                    workingEditor = editor
                } catch is CancellationError {
                    guard loadRequests.owns(requestToken) else { return }
                    workingEditor = nil
                } catch {
                    guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
                    workingEditor = nil
                    workingCopyError = error.localizedDescription
                }
            } else {
                guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
                workingEditor = nil
            }
        } catch APIError.unauthorized {
            // SessionStore handles the global routing on 401.
            return
        } catch {
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    private static let areaOrder = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS"]

    private(set) var shiftsByArea: [(area: String, shifts: [EventShift])] = []

    private static func makeShiftsByArea(from shifts: [EventShift]) -> [(area: String, shifts: [EventShift])] {
        guard !shifts.isEmpty else { return [] }
        var byArea: [String: [EventShift]] = [:]
        for shift in shifts {
            byArea[shift.area, default: []].append(shift)
        }
        return byArea
            .sorted {
                let ai = Self.areaOrder.firstIndex(of: $0.key) ?? Int.max
                let bi = Self.areaOrder.firstIndex(of: $1.key) ?? Int.max
                return ai < bi
            }
            .map { (area: $0.key, shifts: $0.value.sorted { $0.startsAt < $1.startsAt }) }
    }

    func shift(containingAssignmentId assignmentId: String) -> EventShift? {
        displayedShifts.first { shift in
            shift.assignments.contains { $0.id == assignmentId }
        }
    }

    func performWorkingHistoryAction(_ action: String) async -> Bool {
        guard !isPerformingHistoryAction,
              let groupId = shiftGroup?.id,
              workingEditor?.hasWorkingCopy == true else { return false }
        isPerformingHistoryAction = true
        lastWorkingHistoryAction = action
        defer { isPerformingHistoryAction = false }
        do {
            let editor = action == "redo"
                ? try await APIClient.shared.redoWorkingSchedule(
                    shiftGroupId: groupId,
                    expectedVersion: workingVersion
                )
                : try await APIClient.shared.undoWorkingSchedule(
                    shiftGroupId: groupId,
                    expectedVersion: workingVersion
                )
            workingEditor = editor
            workingHistoryError = nil
            Haptics.success()
            return true
        } catch {
            workingHistoryError = error.localizedDescription
            Haptics.error()
            return false
        }
    }
}

// MARK: - Confirmable actions

/// Every action on this screen that asks before it acts.
///
/// These were five separate `@State` targets, each with its own
/// `confirmationDialog` and its own hand-rolled `Binding(get:set:)`. Only one
/// can ever be presented, so they are one value with five cases: the dialog
/// becomes a single call site, and adding a confirmable action means adding a
/// case rather than another dialog and another piece of state.
enum EventConfirmation: Identifiable {
    case claim(EventShift)
    case cancelTrade(ShiftAssignmentRecord)
    case unassign(ShiftAssignmentRecord)
    case delete(EventShift)
    case revertWorkingSchedule

    var id: String {
        switch self {
        case .claim(let shift): "claim-\(shift.id)"
        case .cancelTrade(let assignment): "cancel-trade-\(assignment.id)"
        case .unassign(let assignment): "unassign-\(assignment.id)"
        case .delete(let shift): "delete-\(shift.id)"
        case .revertWorkingSchedule: "revert-working-schedule"
        }
    }

    var title: String {
        switch self {
        case .claim: "Claim shift?"
        case .cancelTrade: "Remove from Trade Board?"
        case .unassign: "Remove assignment?"
        case .delete: "Delete shift?"
        case .revertWorkingSchedule: "Revert pending changes?"
        }
    }

    var confirmTitle: String {
        switch self {
        case .claim: "Claim shift"
        case .cancelTrade: "Remove from Trade Board"
        case .unassign: "Remove assignment"
        case .delete: "Delete shift"
        case .revertWorkingSchedule: "Revert"
        }
    }

    /// The cancel button says what keeping the status quo means, rather than a
    /// uniform "Cancel" that reads ambiguously next to "Remove from Trade Board".
    var cancelTitle: String {
        switch self {
        case .cancelTrade: "Keep it posted"
        case .unassign: "Keep"
        default: "Cancel"
        }
    }

    var isDestructive: Bool {
        switch self {
        case .claim: false
        case .cancelTrade: false
        case .unassign, .delete, .revertWorkingSchedule: true
        }
    }
}

// MARK: - Detail

struct EventDetailView: View {
    let event: ScheduleEvent
    let myShift: MyShift?
    let eventWork: DashboardEventWork?
    @Environment(SessionStore.self) private var session
    @Environment(\.undoManager) private var undoManager

    @State private var vm: EventDetailViewModel
    @State private var assignTarget: EventShift?
    @State private var replaceTarget: EventShift?
    @State private var postTradeTarget: TradePostCandidate?
    @State private var editTimesTarget: EventShift?
    @State private var confirmation: EventConfirmation?
    @State private var showAllCallTimes = false
    @State private var showAddShift = false
    @State private var isCreatingGroup = false
    @State private var isDiscarding = false
    @State private var actionError: String?
    @State private var actionErrorTitle = "Couldn't update event"
    @State private var actionRetry: (() -> Void)?
    @State private var undoCoordinator = ScheduleWorkingCopyUndoCoordinator()
    @State private var seededSystemUndo = false

    init(event: ScheduleEvent, myShift: MyShift?, eventWork: DashboardEventWork? = nil) {
        self.event = event
        self.myShift = myShift
        self.eventWork = eventWork
        _vm = State(initialValue: EventDetailViewModel(event: event, myShift: myShift))
    }

    private var canManageShifts: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var canReviewClaims: Bool {
        (session.currentUser?.role ?? "") == "ADMIN"
    }

    private var isStudent: Bool {
        (session.currentUser?.role ?? "") == "STUDENT"
    }

    /// Staff can still inspect and edit the stored Student call window. For a
    /// student-facing detail sheet, only Home and non-game events expose it.
    private var studentCallTimeAllowed: Bool {
        canManageShifts || event.venue == .home || event.venue == .nonGame
    }

    private var eventContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Brand.Space.md) {
                eventHeader
                if showsYourEventSection {
                    assignmentSection
                }
                if showsOpenShiftSection {
                    openShiftSection
                }
                crewSection
                crewNotesSection
            }
            .padding(.horizontal, Brand.Space.md)
            .padding(.top, Brand.Space.sm)
            // Clears the primary action bar.
            .padding(.bottom, 88)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var confirmationPresentedBinding: Binding<Bool> {
        Binding(
            get: { confirmation != nil },
            set: { if !$0 { confirmation = nil } }
        )
    }

    private var actionErrorPresentedBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: {
                if !$0 {
                    actionError = nil
                    actionRetry = nil
                }
            }
        )
    }

    private var eventBaseView: some View {
        eventContent
            // A hand-rolled `.principal` item stood in for this, which meant the
            // system never owned the title: no large-title collapse, no automatic
            // back-button labelling, and a font the platform didn't pick.
            .navigationTitle("Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { addShiftToolbarButton }
                if hasOverflowActions {
                    ToolbarItem(placement: .topBarTrailing) { overflowMenu }
                }
            }
            .safeAreaInset(edge: .bottom) { primaryActionBar }
            .task {
                await vm.load(includeWorkingCopy: canManageShifts)
                seedSystemUndoIfNeeded()
            }
            .task(id: vm.workingEditor?.autoReleaseAt) {
                guard let releaseAt = vm.workingEditor?.autoReleaseAt else { return }
                let delay = max(0, releaseAt.timeIntervalSinceNow) + 1
                try? await Task.sleep(for: .seconds(delay))
                if !Task.isCancelled { await vm.load() }
            }
            .refreshable { await vm.load(forceRefresh: true) }
            .onChange(of: vm.workingEditor?.hasWorkingCopy) { _, hasWorkingCopy in
                if hasWorkingCopy != true {
                    undoCoordinator.clear(manager: undoManager)
                    seededSystemUndo = false
                }
            }
    }

    private var eventPresentedView: some View {
        eventBaseView
            .sheet(item: $assignTarget) { shift in
                assignStudentSheet(for: shift)
            }
            .sheet(item: $replaceTarget) { shift in
                replacePersonSheet(for: shift)
            }
            .sheet(isPresented: $showAddShift) {
                if let group = vm.shiftGroup {
                    AddShiftSheet(
                        shiftGroupId: group.id,
                        expectedWorkingVersion: vm.workingVersion,
                        eventTitle: scheduleEventDisplayTitle(event),
                        defaultStart: vm.workingEditor?.defaultWindow?.startsAt ?? event.startsAt,
                        defaultEnd: vm.workingEditor?.defaultWindow?.endsAt ?? event.endsAt,
                        onAdded: { editor in
                            acceptWorkingScheduleEditor(editor)
                        }
                    )
                }
            }
            .sheet(item: $editTimesTarget) { shift in
                EditShiftTimesSheet(
                    shift: shift,
                    eventTitle: scheduleEventDisplayTitle(event)
                ) { newStart, newEnd in
                    await updateShiftTimes(shift, startsAt: newStart, endsAt: newEnd)
                }
            }
            .sheet(isPresented: $showAllCallTimes) {
                if let shift = vm.displayedShifts.first(where: { $0.workerType == "ST" }), let editor = vm.workingEditor {
                    EditShiftTimesSheet(
                        shift: shift,
                        eventTitle: scheduleEventDisplayTitle(event),
                        scope: .allAssigned,
                        defaultStart: editor.defaultWindow?.startsAt ?? event.startsAt,
                        defaultEnd: editor.defaultWindow?.endsAt ?? event.endsAt
                    ) { newStart, newEnd in
                        await updateAllShiftTimes(startsAt: newStart, endsAt: newEnd)
                    }
                }
            }
            .navigationDestination(item: $postTradeTarget) { candidate in
                PostTradeSheet(candidate: candidate, wrapsInNavigationStack: false) { _ in
                    Task { await vm.load() }
                }
            }
    }

    private var eventConfirmedView: some View {
        eventPresentedView
            // One dialog for every confirmable action. This was five separate
            // `confirmationDialog`s, each bound through a hand-rolled
            // `Binding(get:set:)` against its own `@State` target, each repeating
            // the same nil-out-on-dismiss dance. The action-error alert below stays
            // separate — it reports a failure rather than confirming an intent.
            .confirmationDialog(
                confirmation?.title ?? "",
                isPresented: confirmationPresentedBinding,
                titleVisibility: .visible,
                presenting: confirmation
            ) { pending in
                confirmationActions(for: pending)
            } message: { pending in
                confirmationMessageView(for: pending)
            }
    }

    private var eventErrorView: some View {
        eventConfirmedView
            .alert(
                actionErrorTitle,
                isPresented: actionErrorPresentedBinding
            ) {
                actionErrorActions
            } message: {
                Text(actionError ?? "")
            }
    }

    @ViewBuilder
    private func confirmationActions(for pending: EventConfirmation) -> some View {
        Button(pending.confirmTitle, role: pending.isDestructive ? .destructive : nil) {
            perform(pending)
        }
        Button(pending.cancelTitle, role: .cancel) { confirmation = nil }
    }

    @ViewBuilder
    private func confirmationMessageView(for pending: EventConfirmation) -> some View {
        if let message = message(for: pending) {
            Text(message)
        }
    }

    @ViewBuilder
    private var actionErrorActions: some View {
        if let retry = actionRetry {
            Button("Retry") { retry() }
        }
        Button("Cancel", role: .cancel) {}
    }

    var body: some View {
        eventErrorView
    }

    // MARK: - Action handlers

    private func acceptWorkingScheduleEditor(_ editor: WorkingScheduleEditor) {
        vm.workingEditor = editor
        vm.workingHistoryError = nil
        vm.workingCopyError = nil
        guard editor.hasWorkingCopy else {
            undoCoordinator.clear(manager: undoManager)
            seededSystemUndo = false
            return
        }
        guard let label = editor.historyAction?.label ?? editor.undoLabel else { return }
        registerSystemUndo(label: label)
    }

    /// Restore one server history entry for a newly opened draft so the system
    /// undo manager can receive the same three-finger/shake and keyboard input
    /// as an edit made during this presentation.
    private func seedSystemUndoIfNeeded() {
        guard !seededSystemUndo, let editor = vm.workingEditor else { return }
        seededSystemUndo = true
        guard editor.hasWorkingCopy, editor.hasUndo else { return }
        if let label = editor.undoLabel {
            registerSystemUndo(label: label)
        }
    }

    private func registerSystemUndo(label: String) {
        let model = vm
        undoCoordinator.registerCommand(
            label: label,
            manager: undoManager,
            undo: { [weak model] in
                guard let model else { return false }
                return await model.performWorkingHistoryAction("undo")
            },
            redo: { [weak model] in
                guard let model else { return false }
                return await model.performWorkingHistoryAction("redo")
            }
        )
    }

    private func requestWorkingHistoryAction(_ action: String) {
        guard vm.workingEditor?.hasWorkingCopy == true else { return }
        if action == "undo", undoCoordinator.hasUndoAction {
            undoManager?.undo()
            return
        }
        if action == "redo", undoCoordinator.hasRedoAction {
            undoManager?.redo()
            return
        }

        // A draft may have been opened after a previous session's undo stack
        // was persisted. The server remains authoritative, so the visible
        // button still works even when the hosting scene has no seeded action.
        Task { @MainActor in
            let succeeded = await vm.performWorkingHistoryAction(action)
            if succeeded {
                undoCoordinator.clear(manager: undoManager)
                seededSystemUndo = false
                seedSystemUndoIfNeeded()
            }
        }
    }

    private func assignStudentSheet(for shift: EventShift) -> some View {
        let workingCopyShiftGroupId = canManageShifts ? vm.shiftGroup?.id : nil
        let expectedWorkingVersion = canManageShifts ? vm.workingVersion : nil
        return AssignStudentSheet(
            shiftId: shift.id,
            workingCopyShiftGroupId: workingCopyShiftGroupId,
            expectedWorkingVersion: expectedWorkingVersion,
            shiftArea: shift.area,
            shiftWorkerType: shift.workerType,
            shiftStartsAt: shift.startsAt,
            shiftEndsAt: shift.endsAt,
            eventTitle: scheduleEventDisplayTitle(event),
            sportCode: event.sportCode,
            onAssigned: { editor in
                acceptWorkingScheduleEditor(editor)
            }
        )
    }

    private func replacePersonSheet(for shift: EventShift) -> some View {
        let targetWorkerType = shift.workerType == "FT" ? "ST" : "FT"
        let currentWorkerName = shift.assignments.first?.user.name ?? "assigned worker"
        return AssignStudentSheet(
            shiftId: shift.id,
            workingCopyShiftGroupId: vm.shiftGroup?.id,
            expectedWorkingVersion: vm.workingVersion,
            shiftArea: shift.area,
            shiftWorkerType: shift.workerType,
            shiftStartsAt: shift.startsAt,
            shiftEndsAt: shift.endsAt,
            eventTitle: scheduleEventDisplayTitle(event),
            sportCode: event.sportCode,
            replacementWorkerType: targetWorkerType,
            replacingUserName: currentWorkerName,
            onAssigned: { editor in
                acceptWorkingScheduleEditor(editor)
            }
        )
    }

    /// Runs the confirmed action and clears the dialog. Every case dismisses the
    /// same way, which is what five separate dialogs each had to remember.
    private func perform(_ pending: EventConfirmation) {
        confirmation = nil
        switch pending {
        case .claim(let shift):
            Task { await claimShift(shift) }
        case .cancelTrade(let assignment):
            Task { await removeTradeFromBoard(assignment) }
        case .unassign(let assignment):
            Task { await unassign(assignment) }
        case .delete(let shift):
            Task { await deleteShift(shift) }
        case .revertWorkingSchedule:
            Task { await discardWorkingSchedule() }
        }
    }

    /// The consequence, in the caller's own terms. Nil where the title already
    /// says everything (removing one named person from one shift).
    private func message(for pending: EventConfirmation) -> String? {
        switch pending {
        case .claim:
            return "An admin reviews this before you're on the schedule."
        case .cancelTrade(let assignment):
            let owner = assignment.user.id == session.currentUser?.id
                ? "You stay"
                : "\(assignment.user.name) stays"
            return "The post is withdrawn. \(owner) on the shift."
        case .unassign:
            return nil
        case .delete(let shift):
            return shift.assignments.isEmpty
                ? "This cannot be undone."
                : "This shift has someone assigned. They'll be removed too."
        case .revertWorkingSchedule:
            return "The pending crew edits for this event will be removed. Workers will keep seeing the current schedule."
        }
    }

    private func presentActionError(
        title: String,
        error: Error,
        retry: @escaping () async -> Void
    ) {
        actionErrorTitle = title
        actionError = error.localizedDescription
        actionRetry = { Task { await retry() } }
        Haptics.error()
    }

    private func removeTradeFromBoard(_ assignment: ShiftAssignmentRecord) async {
        guard let trade = assignment.activeTrade else { return }
        do {
            _ = try await APIClient.shared.cancelShiftTrade(id: trade.id)
            Haptics.success()
            await vm.load()
        } catch {
            presentActionError(title: "Couldn't remove trade post", error: error) {
                await removeTradeFromBoard(assignment)
            }
        }
    }

    private func claimShift(_ shift: EventShift) async {
        do {
            try await APIClient.shared.pickupOpenShift(id: shift.id)
            Haptics.success()
            await vm.load()
        } catch {
            presentActionError(title: "Couldn't claim shift", error: error) {
                await claimShift(shift)
            }
        }
    }

    private func unassign(_ assignment: ShiftAssignmentRecord) async {
        do {
            guard let groupId = vm.shiftGroup?.id,
                  let shift = vm.shift(containingAssignmentId: assignment.id) else {
                throw APIError.serverError("Crew is unavailable. Refresh and try again.")
            }
            let editor = try await APIClient.shared.unassignWorkingScheduleSlot(
                shiftGroupId: groupId,
                expectedVersion: vm.workingVersion,
                slotKey: shift.id
            )
            Haptics.success()
            acceptWorkingScheduleEditor(editor)
        } catch {
            presentActionError(title: "Couldn't remove assignment", error: error) {
                await unassign(assignment)
            }
        }
    }

    private func approveRequest(_ assignment: ShiftAssignmentRecord) async {
        do {
            try await APIClient.shared.approveShift(assignmentId: assignment.id)
            Haptics.success()
            await vm.load()
        } catch {
            presentActionError(title: "Couldn't approve request", error: error) {
                await approveRequest(assignment)
            }
        }
    }

    private func declineRequest(_ assignment: ShiftAssignmentRecord) async {
        do {
            try await APIClient.shared.declineShift(assignmentId: assignment.id)
            Haptics.success()
            await vm.load()
        } catch {
            presentActionError(title: "Couldn't decline request", error: error) {
                await declineRequest(assignment)
            }
        }
    }

    private func deleteShift(_ shift: EventShift) async {
        guard let groupId = vm.shiftGroup?.id else { return }
        do {
            let editor = try await APIClient.shared.removeWorkingScheduleSlot(
                shiftGroupId: groupId,
                expectedVersion: vm.workingVersion,
                slotKey: shift.id
            )
            Haptics.success()
            acceptWorkingScheduleEditor(editor)
        } catch {
            presentActionError(title: "Couldn't delete shift", error: error) {
                await deleteShift(shift)
            }
        }
    }

    private func updateShiftTimes(_ shift: EventShift, startsAt: Date, endsAt: Date) async -> String? {
        do {
            guard let groupId = vm.shiftGroup?.id else { return "Crew is unavailable. Refresh and try again." }
            let editor = try await APIClient.shared.setWorkingScheduleCallWindow(
                shiftGroupId: groupId,
                expectedVersion: vm.workingVersion,
                slotKey: shift.id,
                callStartsAt: startsAt,
                callEndsAt: endsAt
            )
            Haptics.success()
            acceptWorkingScheduleEditor(editor)
            return nil
        } catch {
            Haptics.error()
            return error.localizedDescription
        }
    }

    private func updateAllShiftTimes(startsAt: Date, endsAt: Date) async -> String? {
        do {
            guard let groupId = vm.shiftGroup?.id else { return "Crew is unavailable. Refresh and try again." }
            let editor = try await APIClient.shared.setWorkingScheduleCallWindowForAll(
                shiftGroupId: groupId,
                expectedVersion: vm.workingVersion,
                callStartsAt: startsAt,
                callEndsAt: endsAt
            )
            Haptics.success()
            acceptWorkingScheduleEditor(editor)
            return nil
        } catch {
            Haptics.error()
            return error.localizedDescription
        }
    }

    private func duplicateShift(_ shift: EventShift) async {
        guard let groupId = vm.shiftGroup?.id else { return }
        do {
            let editor = try await APIClient.shared.addWorkingScheduleSlot(
                shiftGroupId: groupId,
                expectedVersion: vm.workingVersion,
                area: shift.area,
                workerType: shift.workerType,
                callStartsAt: shift.callStartsAt,
                callEndsAt: shift.callEndsAt
            )
            Haptics.success()
            acceptWorkingScheduleEditor(editor)
        } catch {
            presentActionError(title: "Couldn't duplicate shift", error: error) {
                await duplicateShift(shift)
            }
        }
    }

    private func discardWorkingSchedule() async {
        guard !isDiscarding,
              let groupId = vm.shiftGroup?.id,
              vm.hasUnpublishedChanges else { return }
        isDiscarding = true
        defer { isDiscarding = false }
        do {
            let editor = try await APIClient.shared.discardWorkingSchedule(
                shiftGroupId: groupId,
                expectedVersion: vm.workingVersion
            )
            Haptics.success()
            acceptWorkingScheduleEditor(editor)
        } catch {
            presentActionError(title: "Couldn't revert schedule changes", error: error) {
                await self.discardWorkingSchedule()
            }
        }
    }

    private var callTime: Date? {
        if event.displayAllDay || myShift?.workerType == "FT" { return nil }
        return eventWork?.shift.callStartsAt ?? myShift?.callStartsAt
    }

    private var eventHasEnded: Bool { event.timeState == .past }

    /// `ScheduleEvent.status` was decoded and read nowhere in the whole iOS app,
    /// so a cancelled event looked exactly like a confirmed one.
    private var eventIsCancelled: Bool {
        event.status.uppercased() == "CANCELLED"
    }

    /// Only worth a card while the shift is still ahead of you. It used to
    /// survive past the event to keep gear links reachable; with gear gone,
    /// a finished shift has nothing left to say.
    private var showsYourEventSection: Bool {
        (eventWork != nil || myShift != nil) && !eventHasEnded
    }

    private var claimableStudentShifts: [EventShift] {
        guard isStudent, myShift == nil, !eventHasEnded else { return [] }
        return vm.displayedShifts.filter {
            $0.workerType == "ST"
                && $0.isOpen
                && $0.viewerRequest == nil
                && $0.startsAt > Date()
        }
    }

    private var pendingStudentClaimShifts: [EventShift] {
        guard isStudent, myShift == nil, !eventHasEnded else { return [] }
        return vm.displayedShifts.filter {
            $0.workerType == "ST"
                && $0.isOpen
                && $0.viewerRequest?.status == "REQUESTED"
                && $0.startsAt > Date()
        }
    }

    private var showsOpenShiftSection: Bool {
        !claimableStudentShifts.isEmpty || !pendingStudentClaimShifts.isEmpty
    }

    /// Your own shift on this event: when to report and which area. Gear used to
    /// live here too — booking links, readiness tone, and a prefilled composer
    /// CTA. It moved out wholesale: this screen is a staffing console, and gear
    /// is Bookings' job. See `docs/AREA_SHIFTS.md`.
    private var assignmentSection: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            BrandSectionHeader("Your Shift", systemImage: "person.crop.circle.badge.checkmark")

            VStack(alignment: .leading, spacing: 12) {
                if let callTime {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        detailLine(
                            icon: "clock.fill",
                            title: callTimeTitle(callTime, now: context.date),
                            subtitle: assignmentTimeSubtitle(now: context.date),
                            tone: .blue
                        )
                    }
                } else if let area = assignmentArea {
                    detailLine(
                        icon: "person.fill.checkmark",
                        title: area,
                        subtitle: "Assigned to this event",
                        tone: .blue
                    )
                }
            }
            // The same blue the Schedule list row uses to mark your own shift,
            // and the same one `ShiftRow` already uses on the roster row. The
            // detail screen was the only surface not making that agreement.
            .brandCard(fill: Color.statusBackground(.blue))
        }
    }

    private var openShiftSection: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            BrandSectionHeader("Open Shifts", systemImage: "person.badge.plus")
            if !claimableStudentShifts.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(claimableStudentShifts.enumerated()), id: \.element.id) { index, shift in
                        Button {
                            confirmation = .claim(shift)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "hand.raised.fill")
                                    .foregroundStyle(Color.statusText(.purple))
                                    .frame(width: 24)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(shift.area.shiftAreaLabel)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                    if !event.displayAllDay {
                                        Text("\(shift.effectiveStartsAt.formatted(date: .omitted, time: .shortened)) to \(shift.effectiveEndsAt.formatted(date: .omitted, time: .shortened))")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                Text("Claim")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color.statusText(.purple))
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < claimableStudentShifts.count - 1 {
                            Divider().padding(.leading, 36)
                        }
                    }
                }
                .brandCard()
            }

            if !pendingStudentClaimShifts.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(pendingStudentClaimShifts.enumerated()), id: \.element.id) { index, shift in
                        HStack(spacing: 12) {
                            Image(systemName: "clock.badge.checkmark")
                                .foregroundStyle(Color.statusText(.orange))
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(shift.area.shiftAreaLabel)
                                    .font(.subheadline.weight(.semibold))
                                if !event.displayAllDay {
                                    Text("\(shift.effectiveStartsAt.formatted(date: .omitted, time: .shortened)) to \(shift.effectiveEndsAt.formatted(date: .omitted, time: .shortened))")
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Text("Awaiting approval")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.statusText(.orange))
                        }
                        .padding(.vertical, 12)
                        if index < pendingStudentClaimShifts.count - 1 {
                            Divider().padding(.leading, 36)
                        }
                    }
                }
                .brandCard(fill: Color.statusBackground(.orange))
            }
        }
    }

    /// Adding a slot is a screen-level action, so it sits in the navigation bar
    /// like every other add on iOS.
    ///
    /// It spent two rounds homeless in the content column: first sharing the
    /// Crew header with the title and coverage pill (too narrow — its sibling
    /// wrapped to three lines), then on its own full-width line beside an empty
    /// gutter, attached to nothing. The toolbar is where it belonged.
    @ViewBuilder
    private var addShiftToolbarButton: some View {
        if canManageShifts, vm.shiftGroup != nil {
            Button {
                showAddShift = true
            } label: {
                Label("Add Shift", systemImage: "plus")
            }
            .accessibilityLabel("Add shift")
        }
    }

    /// Sharing and copying are available to every viewer; staff-only commands
    /// are added inside the same menu when their capabilities apply. Keeping
    /// the entry point visible preserves a direct route to Share Event instead
    /// of hiding it behind the event card's long press.
    private var hasOverflowActions: Bool { true }

    @ViewBuilder
    private var overflowMenu: some View {
        Menu {
            Section {
                ShareLink(item: eventShareText) {
                    Label("Share Event", systemImage: "square.and.arrow.up")
                }
                Button {
                    UIPasteboard.general.string = eventShareText
                    Haptics.success()
                } label: {
                    Label("Copy Event Details", systemImage: "doc.on.doc")
                }
            }
            if canEditCallWindow {
                Section {
                    Button {
                        showAllCallTimes = true
                    } label: {
                        Label("Set Student Call Time…", systemImage: "person.2")
                    }
                }
            }
            if canManageShifts, vm.hasUnpublishedChanges {
                Section {
                    Button(role: .destructive) {
                        confirmation = .revertWorkingSchedule
                    } label: {
                        Label("Revert Pending Changes", systemImage: "arrow.uturn.backward")
                    }
                }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
        .accessibilityLabel("More event actions")
    }

    // MARK: - Primary action

    /// Open slots in the order the roster shows them, so "next open slot" means
    /// the next one the eye would land on rather than an arbitrary one.
    private var openSlotsInRosterOrder: [EventShift] {
        vm.shiftsByArea.flatMap { $0.shifts }.filter(\.isOpen)
    }

    /// The one dominant action, in the house pattern's single bottom bar.
    ///
    /// The screen's job is getting an event from 0/5 to 5/5, and every other
    /// route to that made you scroll and aim at a specific row. There is at most
    /// one of these at a time; when the event is fully staffed the bar is gone
    /// and the coverage pill is the whole answer.
    private enum PrimaryAction {
        case setUpCrew
        case assign(EventShift, openCount: Int)
        case claim(EventShift)

        var title: String {
            switch self {
            case .setUpCrew: "Set up crew"
            case .assign(_, let openCount): openCount == 1 ? "Assign — 1 open" : "Assign — \(openCount) open"
            case .claim: "Claim shift"
            }
        }

        var systemImage: String {
            switch self {
            case .setUpCrew: "person.2.badge.plus"
            case .assign: "person.badge.plus"
            case .claim: "hand.raised.fill"
            }
        }
    }

    private var primaryAction: PrimaryAction? {
        // A cancelled event should not be staffed; the hero says why.
        guard !eventIsCancelled, !eventHasEnded else { return nil }
        if canManageShifts {
            if vm.shiftGroup == nil { return vm.isLoading ? nil : .setUpCrew }
            guard let next = openSlotsInRosterOrder.first else { return nil }
            return .assign(next, openCount: openSlotsInRosterOrder.count)
        }
        if let claimable = claimableStudentShifts.first { return .claim(claimable) }
        return nil
    }

    @ViewBuilder
    private var primaryActionBar: some View {
        if let primaryAction {
            Button {
                switch primaryAction {
                case .setUpCrew:
                    Task { await createShiftGroup() }
                case .assign(let shift, _):
                    assignTarget = shift
                case .claim(let shift):
                    confirmation = .claim(shift)
                }
            } label: {
                HStack(spacing: 8) {
                    if isCreatingGroup {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: primaryAction.systemImage)
                    }
                    Text(primaryAction.title).fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Color.statusText(.purple))
            .disabled(isCreatingGroup)
            .padding(.horizontal, Brand.Space.md)
            .padding(.vertical, Brand.Space.sm)
            .background(.bar)
        }
    }

    private var studentShifts: [EventShift] {
        vm.displayedShifts.filter { $0.workerType == "ST" }
    }

    /// The call window every Student slot shares, or nil when they differ.
    ///
    /// In practice a whole event is called at one time — "Set Student call time"
    /// exists to set them together — so the window was identical on every
    /// Student row and printed once per row, in the leftmost column, three or
    /// four times down the screen.
    private var sharedStudentCallWindow: (start: Date, end: Date)? {
        guard studentCallTimeAllowed, !event.displayAllDay, let first = studentShifts.first else { return nil }
        let start = first.effectiveStartsAt
        let end = first.effectiveEndsAt
        let uniform = studentShifts.allSatisfy {
            $0.effectiveStartsAt == start && $0.effectiveEndsAt == end
        }
        return uniform ? (start, end) : nil
    }

    /// True once the call window is stated once for the whole crew, which is
    /// what lets the rows drop their call column.
    private var callWindowIsHoisted: Bool {
        studentCallTimeAllowed && !event.displayAllDay && !studentShifts.isEmpty && sharedStudentCallWindow != nil
    }

    private var callWindowSummary: String {
        guard let window = sharedStudentCallWindow else { return "Students · mixed call times" }
        let start = window.start.formatted(date: .omitted, time: .shortened)
        let end = window.end.formatted(date: .omitted, time: .shortened)
        return "Students \(start) – \(end)"
    }

    private var canEditCallWindow: Bool {
        canManageShifts && vm.workingEditor != nil && callWindowIsHoisted
    }

    /// Today: "Call time at 3:30 PM" (countdown lives in the subtitle).
    /// Another day: "Call time Tue at 3:30 PM" — no countdown noise days out.
    private func callTimeTitle(_ callTime: Date, now: Date) -> String {
        let clock = callTime.formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDate(callTime, inSameDayAs: now) {
            return callTime < now ? "Call time was \(clock)" : "Call time at \(clock)"
        }
        return "Call time \(callTime.formatted(.dateTime.weekday(.abbreviated))) at \(clock)"
    }

    private var assignmentArea: String? {
        let raw = eventWork?.shift.area ?? myShift?.area
        return raw?.shiftAreaLabel
    }

    private var assignmentEndsAt: Date? {
        eventWork?.shift.endsAt ?? myShift?.endsAt
    }

    private func assignmentTimeSubtitle(now: Date) -> String {
        var parts: [String] = []
        if let area = assignmentArea { parts.append(area) }
        if let endsAt = assignmentEndsAt {
            parts.append("Until \(endsAt.formatted(date: .omitted, time: .shortened))")
        }
        if let callTime, Calendar.current.isDate(callTime, inSameDayAs: now) {
            parts.append(callTime.formatted(.relative(presentation: .named)))
        }
        return parts.joined(separator: " · ")
    }

    private func detailLine(icon: String, title: String, subtitle: String, tone: StatusTone, showsChevron: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.statusText(tone))
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
    }

    // MARK: - Event Header

    /// Reads the event's resolved calendar days, not its raw timestamps.
    ///
    /// An imported all-day event is stored at UTC midnight, so formatting
    /// `startsAt` locally printed the day *before* the one the Schedule list --
    /// which groups by `spannedDays` -- had just shown for the same row. The
    /// span end is already exclusive-adjusted, so the local `endRef` step-back
    /// this used to do is now the model's job.
    private var eventDateText: String {
        guard event.isMultiDay else {
            return detailDateLabel(event.displayStartDay, abbreviatedWeekday: false)
        }
        let start = detailDateLabel(event.displayStartDay, abbreviatedWeekday: true)
        let end = detailDateLabel(event.displayEndDay, abbreviatedWeekday: true)
        return "\(start) – \(end)"
    }

    private func detailDateLabel(_ date: Date, abbreviatedWeekday: Bool) -> String {
        let calendar = Calendar.current
        let includesYear = calendar.component(.year, from: date) != calendar.component(.year, from: .now)
        if calendar.isDateInToday(date) {
            return "Today, \(date.formatted(.dateTime.month(abbreviatedWeekday ? .abbreviated : .wide).day()))"
        }
        if calendar.isDateInTomorrow(date) {
            return "Tomorrow, \(date.formatted(.dateTime.month(abbreviatedWeekday ? .abbreviated : .wide).day()))"
        }
        if abbreviatedWeekday {
            return includesYear
                ? date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
                : date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        return includesYear
            ? date.formatted(.dateTime.weekday(.wide).month(.wide).day().year())
            : date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    /// Times read as a same-day range; for multi-day they're labeled so they
    /// don't look like one continuous block on a single day.
    private var eventTimeText: String {
        let start = event.startsAt.formatted(.dateTime.hour().minute())
        let end = event.endsAt.formatted(.dateTime.hour().minute())
        return event.isMultiDay ? "Starts \(start) · ends \(end)" : "\(start) – \(end)"
    }

    private var eventTypeLabel: String {
        // Same resolved venue the rail beside it and the Schedule row use, so
        // a row listed as Neutral cannot open onto a header reading Home.
        switch event.venue {
        case .home: return "Home"
        case .away: return "Away"
        case .neutral: return "Neutral"
        case .nonGame: return "Non-game"
        }
    }

    /// Sport for the header eyebrow, or nil when the title already carries it.
    /// `scheduleEventDisplayTitle` leads opponent events with the sport, so an
    /// unconditional eyebrow printed "Women's Soccer · Home" directly above
    /// "Women's Soccer vs BYU" — the sport twice, in the two largest type sizes
    /// on the card. Non-game events keep the eyebrow, since their summary title
    /// rarely names the sport.
    private var eyebrowSportLabel: String? {
        guard let sport = sportLabel(event.sportCode) else { return nil }
        return scheduleEventDisplayTitle(event).hasPrefix(sport) ? nil : sport
    }

    /// How far out the event is, for events close enough that the answer changes
    /// what you do about them. "0/5 filled" in red says a crew is missing but not
    /// whether that is a crisis or next month's problem; "in 3 days" is what
    /// makes the red mean something.
    ///
    /// Today and tomorrow already read that way in `eventDateText`, so they are
    /// left alone rather than restated, and anything past two weeks out is not
    /// urgent enough to spend a line on.
    private var eventCountdownText: String? {
        let calendar = Calendar.current
        // Same resolved day `eventDateText` prints, so "Tomorrow, Jun 17" and
        // "in 2 days" can never disagree about which day the event is on.
        let eventDay = event.displayStartDay
        guard !eventHasEnded,
              !calendar.isDateInToday(eventDay),
              !calendar.isDateInTomorrow(eventDay) else { return nil }
        let today = calendar.startOfDay(for: .now)
        guard let days = calendar.dateComponents([.day], from: today, to: eventDay).day,
              days > 1, days <= 14 else { return nil }
        return "in \(days) days"
    }

    /// The staffing answer, in the hero, for everyone.
    ///
    /// Coverage was a small pill in a section header and staff-only — while the
    /// Schedule *list* row showed a coverage chip to every role. So the surface
    /// with the most room and the most reason to answer "is this ready?" was the
    /// one hiding it. Suppressed while loading rather than flashing "No crew set
    /// up" at a staffed event.
    @ViewBuilder
    private var readinessLine: some View {
        if !vm.isLoading, !eventIsCancelled {
            HStack(spacing: 8) {
                if let coverage = vm.shiftGroup?.coverage, coverage.total > 0 {
                    CoverageChip(coverage: coverage, showsLabel: true)
                }
                Text(crewReadinessSummary(vm.shiftGroup?.coverage))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 2)
            .accessibilityElement(children: .combine)
        }
    }

    private var eventRailColor: Color {
        venueRailColor(for: event)
    }

    private var eventVenueName: String? {
        scheduleEventVenueName(event)
    }

    /// The event as something you can paste into a message to a crew member.
    private var eventShareText: String {
        var lines = [scheduleEventDisplayTitle(event)]
        lines.append(event.displayAllDay ? "\(eventDateText) · All day" : "\(eventDateText) · \(eventTimeText)")
        if let eventVenueName { lines.append(eventVenueName) }
        return lines.joined(separator: "\n")
    }

    /// Long-pressing the event card. HIG asks for the few actions actually
    /// relevant to the object under the finger; here that is passing the event
    /// along to someone, which is the one thing this card holds that you cannot
    /// get at any other way.
    @ViewBuilder
    private var eventHeaderContextMenu: some View {
        ShareLink(item: eventShareText) {
            Label("Share Event", systemImage: "square.and.arrow.up")
        }
        Button {
            UIPasteboard.general.string = eventShareText
            Haptics.success()
        } label: {
            Label("Copy Event Details", systemImage: "doc.on.doc")
        }
    }

    private var eventHeader: some View {
        HStack(alignment: .top, spacing: 14) {
            StatusRail(color: eventRailColor)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    if let eyebrowSportLabel {
                        Text(eyebrowSportLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text("·").foregroundStyle(.tertiary)
                    }
                    Text(eventTypeLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(eventRailColor)
                    if eventIsCancelled {
                        Text("Cancelled")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.statusBackground(.red), in: Capsule())
                            .foregroundStyle(Color.statusText(.red))
                    }
                    // The Schedule row already answers "is this happening right
                    // now" before you tap it. Cancelled outranks both: a
                    // cancelled event is not under way whatever the clock says.
                    if !eventIsCancelled {
                        switch event.timeState {
                        case .live:
                            Text("NOW")
                                .font(.caption2.weight(.heavy))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.brandPrimary, in: Capsule())
                                .foregroundStyle(.white)
                        case .past:
                            Text("Ended")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        case .upcoming:
                            EmptyView()
                        }
                    }
                }

                Text(scheduleEventDisplayTitle(event))
                    .font(.gothamBlack(size: 26))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 6) {
                    Label {
                        HStack(spacing: 6) {
                            Text(eventDateText)
                            if let countdown = eventCountdownText {
                                Text("·").foregroundStyle(.tertiary)
                                Text(countdown).foregroundStyle(.secondary)
                            }
                        }
                    } icon: {
                        Image(systemName: event.isMultiDay ? "calendar.day.timeline.left" : "calendar")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)

                    Label(event.displayAllDay ? "All day" : eventTimeText, systemImage: "clock")
                        .font(.subheadline)
                        .foregroundStyle(
                            event.timeState == .live && !eventIsCancelled
                                ? Color.brandPrimary
                                : Color.secondary
                        )

                    if let eventVenueName {
                        Label(eventVenueName, systemImage: "mappin.and.ellipse")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    readinessLine
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .brandCard()
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
        .contextMenu { eventHeaderContextMenu }
    }

    // MARK: - Crew Section

    /// Header, then roster. The call window rides in the header's own subtitle
    /// slot and Add Shift moved to the toolbar, so nothing floats between the
    /// two on a line of its own any more.
    private var crewSection: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            // Coverage answers "is this event ready?", so it belongs in the hero
            // where that question is asked, not tucked into a section header
            // halfway down.
            BrandSectionHeader(
                "Crew",
                subtitle: callWindowIsHoisted ? callWindowSummary : nil,
                systemImage: "person.2.fill"
            )
            if canManageShifts, vm.hasUnpublishedChanges {
                workingScheduleReviewCard
            }
            crewBody
        }
    }

    private var crewNotes: String? {
        guard let notes = vm.shiftGroup?.notes?.trimmingCharacters(in: .whitespacesAndNewlines),
              !notes.isEmpty else { return nil }
        return notes
    }

    /// `EventShiftGroup.notes` arrives on every load and was rendered nowhere.
    /// On a staffing console this is where "wear blacks, park in Lot 60" lives —
    /// exactly the kind of instruction that otherwise gets passed around in a
    /// side channel the app can't see.
    @ViewBuilder
    private var crewNotesSection: some View {
        if let crewNotes {
            VStack(alignment: .leading, spacing: Brand.Space.sm) {
                BrandSectionHeader("Notes", systemImage: "note.text")
                Text(crewNotes)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .brandCard()
            }
        }
    }

    private var workingScheduleReviewCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "pencil.and.list.clipboard")
                    .foregroundStyle(Color.statusText(.orange))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Pending schedule changes")
                        .font(.subheadline.weight(.semibold))
                    Text(vm.workingChangeSummary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // How many people this actually touches — the fact that decides
                    // whether reverting is safe. It was decoded and never shown.
                    if let affected = vm.workingEditor?.affectedWorkerCount, affected > 0 {
                        Text(affected == 1 ? "1 worker affected" : "\(affected) workers affected")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.statusText(.orange))
                    }
                    if let error = vm.workingEditor?.autoReleaseError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(Color.statusText(.red))
                    } else if let releaseAt = vm.workingEditor?.autoReleaseAt {
                        Text("Workers see this at \(releaseAt.formatted(date: .omitted, time: .shortened)). Editing again restarts the 10-minute timer.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let historyError = vm.workingHistoryError {
                Label("Couldn't update schedule history", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.statusText(.red))
                Text(historyError)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let action = vm.lastWorkingHistoryAction {
                    Button("Retry") { requestWorkingHistoryAction(action) }
                        .font(.caption.weight(.semibold))
                }
            }

            HStack(spacing: 8) {
                Button {
                    requestWorkingHistoryAction("undo")
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .keyboardShortcut("z", modifiers: .command)
                .disabled(vm.workingEditor?.hasUndo != true)
                .accessibilityLabel(vm.workingEditor?.undoLabel.map { "Undo \($0)" } ?? "Undo")

                Button {
                    requestWorkingHistoryAction("redo")
                } label: {
                    Label("Redo", systemImage: "arrow.uturn.forward")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .keyboardShortcut("z", modifiers: [.command, .shift])
                .disabled(vm.workingEditor?.hasRedo != true)
                .accessibilityLabel(vm.workingEditor?.redoLabel.map { "Redo \($0)" } ?? "Redo")

                Button("Revert", role: .destructive) { confirmation = .revertWorkingSchedule }
                    .font(.caption.weight(.semibold))
                    .disabled(isDiscarding)
            }
        }
        // The one card surface, tinted — this was hand-rolled chrome that missed
        // the hairline edge and the continuous-corner radius every other card
        // on the screen has.
        .brandCard(fill: Color.statusBackground(.orange))
        .accessibilityElement(children: .contain)
    }

    /// The crew region's three states.
    ///
    /// The house detail screens gate the *whole* screen because they have no
    /// content until their fetch lands. This one is handed a complete
    /// `ScheduleEvent` by its caller, so the header is real on the first frame —
    /// gating the screen would trade that for pattern symmetry. The house
    /// vocabulary (a skeleton, then `ContentUnavailableView` with a prominent
    /// Retry) applies to the region that is actually pending.
    @ViewBuilder
    private var crewBody: some View {
        if vm.isLoading {
            EventDetailCrewSkeleton()
        } else if let err = vm.error {
            ContentUnavailableView {
                Label("Couldn't load crew", systemImage: "exclamationmark.triangle")
            } description: {
                Text(err)
            } actions: {
                Button("Retry") { Task { await vm.load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.shiftGroup != nil, let workingCopyError = vm.workingCopyError {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.orange))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Showing the published crew")
                            .font(.footnote.weight(.semibold))
                        Text(workingCopyError)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Button("Retry") { Task { await vm.load() } }
                        .font(.footnote.weight(.semibold))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.statusBackground(.orange), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)

                crewList
            }
        } else if vm.shiftGroup == nil {
            VStack(spacing: 10) {
                Image(systemName: "person.2.slash")
                    .font(.largeTitle)
                    .foregroundStyle(.tertiary)
                Text("No crew scheduled")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Text("No shifts have been set up for this event yet.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                // "Set up crew" used to live here as a second prominent button.
                // The primary action bar owns it now — one dominant action per
                // screen, and this card states the situation rather than
                // competing to resolve it.
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .brandCard(alignment: .center)
        } else {
            crewList
        }
    }

    private func createShiftGroup() async {
        isCreatingGroup = true
        defer { isCreatingGroup = false }
        do {
            vm.shiftGroup = try await APIClient.shared.createShiftGroup(eventId: event.id)
            Haptics.success()
        } catch {
            presentActionError(title: "Couldn't set up crew", error: error) {
                await createShiftGroup()
            }
        }
    }

    private var crewList: some View {
        // Areas are separated more than a heading is separated from its own
        // card (`lg` here against `xs` inside `AreaBlock`), so each area reads
        // as one block. At the old near-equal gaps the headings floated between
        // two cards, belonging to neither, and the crew list read as a stack of
        // unrelated islands rather than one roster.
        VStack(alignment: .leading, spacing: Brand.Space.lg) {
            // Per-area shift blocks (the "Crew" header lives in crewSection).
            ForEach(vm.shiftsByArea, id: \.area) { group in
                AreaBlock(
                    area: group.area,
                    shifts: group.shifts,
                    myShiftId: myShift?.id,
                    currentUserId: session.currentUser?.id,
                    canManageShifts: canManageShifts,
                    isWorkingCopy: canManageShifts && vm.workingEditor != nil,
                    // Unassigned students claim from the dedicated action card
                    // above. Once assigned, the row menu remains available for
                    // their own trade actions without duplicating Claim controls.
                    isStudent: isStudent && !showsOpenShiftSection,
                    onAssign: { shift in assignTarget = shift },
                    onConvertAndReplace: { shift in replaceTarget = shift },
                    onRequest: { shift in confirmation = .claim(shift) },
                    onPostTrade: { shift, assignment in
                        postTradeTarget = TradePostCandidate(
                            assignment: assignment,
                            shift: shift,
                            eventTitle: scheduleEventDisplayTitle(event),
                            currentUserId: session.currentUser?.id,
                            event: event
                        )
                    },
                    onCancelTrade: { assignment in confirmation = .cancelTrade(assignment) },
                    onUnassign: { assignment in confirmation = .unassign(assignment) },
                    onApprove: canReviewClaims
                        ? { assignment in Task { await approveRequest(assignment) } }
                        : nil,
                    onDecline: canReviewClaims
                        ? { assignment in Task { await declineRequest(assignment) } }
                        : nil,
                    onDuplicate: { shift in Task { await duplicateShift(shift) } },
                    onEditTimes: { shift in editTimesTarget = shift },
                    onDelete: { shift in
                        if shift.assignments.isEmpty {
                            Task { await deleteShift(shift) }
                        } else {
                            confirmation = .delete(shift)
                        }
                    },
                    hidesShiftTimes: event.displayAllDay,
                    callWindowIsHoisted: callWindowIsHoisted,
                    studentCallTimeAllowed: studentCallTimeAllowed
                )
            }
        }
    }
}

// MARK: - Area Block

struct AreaBlock: View {
    let area: String
    let shifts: [EventShift]
    let myShiftId: String?
    let currentUserId: String?
    var canManageShifts: Bool = false
    var isWorkingCopy: Bool = false
    var isStudent: Bool = false
    var onAssign: ((EventShift) -> Void)? = nil
    var onConvertAndReplace: ((EventShift) -> Void)? = nil
    var onRequest: ((EventShift) -> Void)? = nil
    var onPostTrade: ((EventShift, ShiftAssignmentRecord) -> Void)? = nil
    var onCancelTrade: ((ShiftAssignmentRecord) -> Void)? = nil
    var onUnassign: ((ShiftAssignmentRecord) -> Void)? = nil
    var onApprove: ((ShiftAssignmentRecord) -> Void)? = nil
    var onDecline: ((ShiftAssignmentRecord) -> Void)? = nil
    var onDuplicate: ((EventShift) -> Void)? = nil
    var onEditTimes: ((EventShift) -> Void)? = nil
    var onDelete: ((EventShift) -> Void)? = nil
    var hidesShiftTimes = false
    /// Set when the Crew header already states the call window for the whole
    /// event, which is the normal case. The rows then drop their call column
    /// instead of reprinting one identical time per row.
    var callWindowIsHoisted = false
    var studentCallTimeAllowed = true

    var body: some View {
        // Tight: the heading names the card directly under it. `crewList`
        // separates whole areas by `lg` so this pairing reads unambiguously.
        VStack(alignment: .leading, spacing: Brand.Space.xs) {
            // Area header — title-cased ("Video" / "Photo") so the row's
            // ALL-CAPS server token doesn't shout, with the area's icon and the
            // same filled count the web Crew table shows. The worker-type label
            // stays on the rows, never here: hoisting it for uniform areas made
            // adjacent blocks structurally different and knocked the name column
            // out of alignment between them.
            CrewAreaHeading(area: area, filled: filledCount, total: shifts.count)

            VStack(spacing: 0) {
                ForEach(Array(shifts.enumerated()), id: \.element.id) { idx, shift in
                    ShiftRow(
                        shift: shift,
                        isHighlighted: isMyShift(shift),
                        currentUserId: currentUserId,
                        canManageShifts: canManageShifts,
                        isWorkingCopy: isWorkingCopy,
                        isStudent: isStudent,
                        hidesShiftTimes: hidesShiftTimes,
                        showsCallColumn: showsCallColumn,
                        studentCallTimeAllowed: studentCallTimeAllowed,
                        showsWorkerType: true,
                        onAssign: onAssign,
                        onConvertAndReplace: onConvertAndReplace,
                        onRequest: onRequest,
                        onPostTrade: onPostTrade,
                        onCancelTrade: onCancelTrade,
                        onUnassign: onUnassign,
                        onApprove: onApprove,
                        onDecline: onDecline,
                        onDuplicate: onDuplicate,
                        onEditTimes: onEditTimes,
                        onDelete: onDelete
                    )
                    if idx < shifts.count - 1 {
                        // Flush with the row's own content inset. The old 44pt
                        // indent lined up with nothing in either row layout —
                        // with a call column, content starts past 100pt; without
                        // one, it starts at 12.
                        Divider().padding(.leading, ShiftRow.horizontalPadding)
                    }
                }
            }
            .background(Color.cardSurface)
            .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                    .strokeBorder(Color.hairline, lineWidth: 0.5)
            )
        }
    }

    /// Slots in this area with someone actually on them.
    private var filledCount: Int {
        shifts.filter { !$0.isOpen }.count
    }

    /// Whether this area reserves the leading call-time column. Staff slots have
    /// no call time, but when the block also holds Student slots every row still
    /// reserves the column: dropping it on the Staff rows slid their crew type,
    /// avatar, and Assign control left, so no two adjacent rows in the same card
    /// shared a left edge.
    ///
    /// The column disappears entirely once the header states the window — at
    /// that point it held one repeated time and a column of em dashes.
    private var showsCallColumn: Bool {
        studentCallTimeAllowed
            && !hidesShiftTimes
            && !callWindowIsHoisted
            && shifts.contains { $0.workerType == "ST" }
    }

    private func isMyShift(_ shift: EventShift) -> Bool {
        guard let userId = currentUserId else { return false }
        return shift.assignments.contains { $0.user.id == userId }
    }
}

// MARK: - Shift Row

struct ShiftRow: View {
    let shift: EventShift
    let isHighlighted: Bool
    let currentUserId: String?
    var canManageShifts: Bool = false
    var isWorkingCopy: Bool = false
    var isStudent: Bool = false
    var hidesShiftTimes = false
    /// Set by `AreaBlock` when this area reserves the leading call-time column.
    /// Every row in the block agrees, so the crew-type, name, and action columns
    /// share a left edge even though only Student slots carry a call time.
    var showsCallColumn: Bool = false
    var studentCallTimeAllowed = true
    /// Per-row Student/Staff badge. Suppressed when the whole area block is one
    /// worker type (it's shown once on the area header instead), so an all-staff
    /// crew isn't a column of identical "Staff" pills.
    var showsWorkerType: Bool = true
    var onAssign: ((EventShift) -> Void)? = nil
    var onConvertAndReplace: ((EventShift) -> Void)? = nil
    var onRequest: ((EventShift) -> Void)? = nil
    var onPostTrade: ((EventShift, ShiftAssignmentRecord) -> Void)? = nil
    var onCancelTrade: ((ShiftAssignmentRecord) -> Void)? = nil
    var onUnassign: ((ShiftAssignmentRecord) -> Void)? = nil
    var onApprove: ((ShiftAssignmentRecord) -> Void)? = nil
    var onDecline: ((ShiftAssignmentRecord) -> Void)? = nil
    var onDuplicate: ((EventShift) -> Void)? = nil
    var onEditTimes: ((EventShift) -> Void)? = nil
    var onDelete: ((EventShift) -> Void)? = nil

    private var isStudentSlot: Bool { shift.workerType == "ST" }

    /// The call column is wide enough for "12:00 PM" at the default text size
    /// and grows with Dynamic Type. At the old fixed 52pt it broke the time
    /// across two lines, and it did not scale at all.
    @ScaledMetric(relativeTo: .caption) private var callColumnWidth: CGFloat = 66
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Row content inset. `AreaBlock` reads it so its dividers start exactly
    /// where row content does.
    static let horizontalPadding: CGFloat = 12

    /// The row's own primary action, when it has one. Open slots are the only
    /// rows with an unambiguous next step, so they become the tap target.
    private var primaryRowAction: (() -> Void)? {
        guard shift.isOpen else { return nil }
        if canManageShifts, let onAssign { return { onAssign(shift) } }
        if isStudent, isStudentSlot, let onRequest { return { onRequest(shift) } }
        return nil
    }

    var body: some View {
        // An open slot's action belongs to the whole row, the way Calendar and
        // Contacts hand a row's action to the row. It used to live in a tinted
        // pill, which meant an unstaffed event was a column of five identical
        // filled buttons competing with the section's own controls — every
        // control shouting, so none of them leading. The row now carries the
        // target and the trailing text plus chevron carries the affordance.
        if let primaryRowAction {
            Button(action: primaryRowAction) { rowContent }
                .buttonStyle(.plain)
                .contextMenu { rowContextMenu }
                .accessibilityLabel(rowAccessibilityLabel)
                .accessibilityHint(openSlotActionTitle)
        } else {
            rowContent
                .contextMenu { rowContextMenu }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(rowAccessibilityLabel)
        }
    }

    private var rowContent: some View {
        Group {
            if dynamicTypeSize >= .xxLarge {
                // Three columns plus an action stop fitting a phone well before
                // the true accessibility sizes — the row ran off the screen
                // edge. Call time and crew type move to their own line so
                // nothing is clipped or hyphenated.
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if studentCallTimeAllowed && !hidesShiftTimes && isStudentSlot {
                            callWindowText
                        }
                        if showsWorkerType {
                            // Never let the crew type truncate to "St…"; the
                            // call window wraps instead if the line runs out.
                            CrewTypeLabel(label: workerTypeLabel, baseWidth: nil)
                                .fixedSize()
                        }
                    }
                    HStack(alignment: .top, spacing: 8) {
                        assignedPersonView
                        Spacer(minLength: 4)
                        if hasVisibleRowActions {
                            rowActionsMenu
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 12) {
                    // Call time column — reserved for every row in an area that
                    // has any Student slot, so the columns to its right line up.
                    if showsCallColumn {
                        callTimeColumn
                            .frame(width: callColumnWidth, alignment: .trailing)

                        Divider().frame(height: 36)
                    }

                    // Crew type — plain text in a fixed column, matching the web
                    // Crew table. It was a filled capsule, which made every row
                    // carry a coloured pill repeating what the column says.
                    if showsWorkerType {
                        CrewTypeLabel(label: workerTypeLabel)
                    }

                    // Assigned person (or open slot)
                    assignedPersonView

                    Spacer(minLength: 0)
                    if hasVisibleRowActions {
                        rowActionsMenu
                    }
                }
            }
        }
        .padding(.horizontal, Self.horizontalPadding)
        .padding(.vertical, 10)
        // 44pt even after the tinted pill that used to guarantee it is gone.
        .frame(minHeight: 44)
        .contentShape(.contextMenuPreview, Rectangle())
        .contentShape(Rectangle())
    }

    /// The call window, or an em dash for slots that don't have one. Staff and
    /// collaborators are never given a call time, so their rows state that
    /// rather than leaving a silent gap where the times sit on every row above.
    @ViewBuilder
    private var callTimeColumn: some View {
        if studentCallTimeAllowed && isStudentSlot {
            VStack(alignment: .trailing, spacing: 2) {
                Text(shift.effectiveStartsAt.formatted(.dateTime.hour().minute()))
                    .font(.caption.monospacedDigit().weight(.medium))
                Text(shift.effectiveEndsAt.formatted(.dateTime.hour().minute()))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        } else {
            Text("—")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.tertiary)
        }
    }

    /// Call window on one line, for the stacked accessibility layout.
    private var callWindowText: some View {
        Text("\(shift.effectiveStartsAt.formatted(.dateTime.hour().minute())) – \(shift.effectiveEndsAt.formatted(.dateTime.hour().minute()))")
            .font(.caption.monospacedDigit().weight(.medium))
    }

    private var rowAccessibilityLabel: String {
        var parts: [String] = []
        if isHighlighted { parts.append("Your shift") }
        parts.append("\(workerTypeLabel) shift")
        if studentCallTimeAllowed && !hidesShiftTimes && isStudentSlot {
            let timeRange = "\(shift.effectiveStartsAt.formatted(.dateTime.hour().minute())) to \(shift.effectiveEndsAt.formatted(.dateTime.hour().minute()))"
            parts.append(timeRange)
        } else if showsCallColumn {
            // Matches the em dash the row draws in the reserved call column.
            parts.append("No call time")
        }
        if shift.isOpen {
            parts.append("Open slot")
        } else {
            let names = shift.assignments.map { assignment -> String in
                if assignment.status == "REQUESTED" {
                    return "\(assignment.user.name), request waiting for approval"
                }
                if assignment.isOnTradeBoard {
                    return "\(assignment.user.name), on the Trade Board"
                }
                return assignment.user.name
            }.joined(separator: ", ")
            parts.append("Assigned: \(names)")
        }
        return parts.joined(separator: ". ")
    }

    private var pendingRequests: [ShiftAssignmentRecord] {
        shift.assignments.filter { $0.status == "REQUESTED" }
    }

    private var activeAssignments: [ShiftAssignmentRecord] {
        shift.assignments.filter { $0.status != "REQUESTED" }
    }

    private var hasVisibleRowActions: Bool {
        guard !shift.isOpen else { return false }
        if canManageShifts { return true }
        return activeAssignments.contains { assignment in
            assignment.user.id == currentUserId
        }
    }

    /// Visible overflow entry point for row lifecycle work. Long press remains
    /// a shortcut, but consequential commands no longer depend on discovering a
    /// hidden context menu. Shift-level commands appear once per row; trade
    /// actions retain assignment names when a row has more than one person.
    @ViewBuilder
    private var rowActionsMenu: some View {
        Menu {
            if canManageShifts {
                Section("Shift") {
                    if studentCallTimeAllowed, isStudentSlot, let onEditTimes {
                        Button { onEditTimes(shift) } label: {
                            Label("Change Call Time", systemImage: "clock.badge.checkmark")
                        }
                    }
                    if let onDuplicate {
                        Button { onDuplicate(shift) } label: {
                            Label("Duplicate Shift", systemImage: "plus.square.on.square")
                        }
                    }
                }
            }

            if !isWorkingCopy, shift.startsAt > Date() {
                Section("Trade Board") {
                    ForEach(activeAssignments, id: \.id) { assignment in
                        let isMine = currentUserId == assignment.user.id
                        if assignment.isOnTradeBoard {
                            if isMine || canManageShifts, let onCancelTrade {
                                Button { onCancelTrade(assignment) } label: {
                                    Label(
                                        activeAssignments.count > 1
                                            ? "Remove \(assignment.user.name) from Trade Board"
                                            : "Remove from Trade Board",
                                        systemImage: "arrow.uturn.backward"
                                    )
                                }
                            }
                        } else if isMine || (canManageShifts && assignment.user.isStudentSchedulingClass), let onPostTrade {
                            Button { onPostTrade(shift, assignment) } label: {
                                Label(
                                    activeAssignments.count > 1
                                        ? "Post \(assignment.user.name) to Trade Board"
                                        : "Post to Trade Board",
                                    systemImage: "arrow.left.arrow.right"
                                )
                            }
                        }
                    }
                }
            }

            if canManageShifts {
                Section {
                    if let onUnassign {
                        ForEach(activeAssignments, id: \.id) { assignment in
                            Button(role: .destructive) { onUnassign(assignment) } label: {
                                Label("Remove \(assignment.user.name)", systemImage: "person.fill.xmark")
                            }
                        }
                    }
                    if let onDelete {
                        Button(role: .destructive) { onDelete(shift) } label: {
                            Label("Delete Shift", systemImage: "trash")
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title3)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Circle())
        }
        .accessibilityLabel("Actions for \(workerTypeLabel) shift")
        .accessibilityHint("Shows shift, trade board, and removal actions")
    }

    /// Long-pressing a crew row.
    ///
    /// HIG asks for grouped, ordered actions with destructive ones gathered at
    /// the end. This was one flat list of up to seven items with destructive
    /// entries scattered through it in three separate places — Decline near the
    /// top, Remove in the middle, Delete at the bottom — so the two actions that
    /// take a person off a shift sat directly beside the ones that don't. The
    /// items are unchanged; the grouping and order are not.
    @ViewBuilder
    private var rowContextMenu: some View {
        Section { primaryMenuActions }
        Section { tradeBoardMenuActions }
        Section { shiftManagementMenuActions }
        Section { destructiveMenuActions }
    }

    /// What this row is actually for: fill it, claim it, or settle the request
    /// waiting on it.
    @ViewBuilder
    private var primaryMenuActions: some View {
        if shift.isOpen {
            if canManageShifts, let onAssign {
                Button { onAssign(shift) } label: {
                    Label("Assign Someone", systemImage: "person.badge.plus")
                }
            }
            if isStudent && isStudentSlot, let onRequest {
                Button { onRequest(shift) } label: {
                    Label("Claim Shift", systemImage: "hand.raised")
                }
            }
        } else {
            if canManageShifts, let onApprove {
                ForEach(pendingRequests, id: \.id) { assignment in
                    Button { onApprove(assignment) } label: {
                        Label("Approve \(assignment.user.name)", systemImage: "checkmark.circle")
                    }
                }
            }
            if canManageShifts {
                if isWorkingCopy, let onConvertAndReplace {
                    Button { onConvertAndReplace(shift) } label: {
                        Label("Replace and Convert…", systemImage: "arrow.left.arrow.right")
                    }
                } else if !isWorkingCopy, let onAssign {
                    Button { onAssign(shift) } label: {
                        Label("Replace…", systemImage: "person.2.badge.gearshape.fill")
                    }
                }
            }
        }
    }

    /// Trade Board: owners post their own shift; staff post student shifts.
    /// Started shifts can't be traded (the server enforces this too).
    @ViewBuilder
    private var tradeBoardMenuActions: some View {
        if !isWorkingCopy, shift.startsAt > Date() {
            ForEach(activeAssignments, id: \.id) { assignment in
                let isMine = currentUserId == assignment.user.id
                if assignment.isOnTradeBoard {
                    if isMine || canManageShifts, let onCancelTrade {
                        Button { onCancelTrade(assignment) } label: {
                            Label(
                                shift.assignments.count > 1
                                    ? "Remove \(assignment.user.name) from Trade Board"
                                    : "Remove from Trade Board",
                                systemImage: "arrow.uturn.backward"
                            )
                        }
                    }
                } else if isMine || (canManageShifts && assignment.user.isStudentSchedulingClass), let onPostTrade {
                    Button { onPostTrade(shift, assignment) } label: {
                        Label(
                            shift.assignments.count > 1
                                ? "Post \(assignment.user.name) to Trade Board"
                                : "Post to Trade Board",
                            systemImage: "arrow.left.arrow.right"
                        )
                    }
                }
            }
        }
    }

    /// Edits to the slot itself rather than to who is on it. Call time leads:
    /// changing when someone is needed is far commoner than cloning a slot.
    @ViewBuilder
    private var shiftManagementMenuActions: some View {
        if canManageShifts {
            if studentCallTimeAllowed, isStudentSlot, let onEditTimes {
                Button { onEditTimes(shift) } label: {
                    Label("Change Call Time", systemImage: "clock.badge.checkmark")
                }
            }
            if let onDuplicate {
                Button { onDuplicate(shift) } label: {
                    Label("Duplicate Shift", systemImage: "plus.square.on.square")
                }
            }
        }
    }

    /// Everything that takes someone off a shift or removes the shift, gathered
    /// in one group at the end where a slip is least likely.
    @ViewBuilder
    private var destructiveMenuActions: some View {
        if canManageShifts {
            if let onDecline {
                ForEach(pendingRequests, id: \.id) { assignment in
                    Button(role: .destructive) { onDecline(assignment) } label: {
                        Label("Decline \(assignment.user.name)", systemImage: "xmark.circle")
                    }
                }
            }
            if !shift.isOpen, let onUnassign {
                ForEach(shift.assignments, id: \.id) { assignment in
                    Button(role: .destructive) { onUnassign(assignment) } label: {
                        Label("Remove \(assignment.user.name)", systemImage: "person.fill.xmark")
                    }
                }
            }
            if let onDelete {
                Button(role: .destructive) { onDelete(shift) } label: {
                    Label("Delete Shift", systemImage: "trash")
                }
            }
        }
    }

    @ViewBuilder
    private var assignedPersonView: some View {
        if shift.isOpen {
            // Two things, one gutter: the crew type on the left, the action at
            // the trailing edge where a row's chevron belongs. The dashed
            // placeholder avatar that used to sit between them existed to stop
            // the action jumping to the left edge — which the trailing-edge
            // layout already does. Left in place it became a third element
            // stranded in its own gap, standing in for a person who is exactly
            // the point of the row being empty.
            HStack(spacing: 8) {
                Spacer(minLength: 8)
                openSlotView
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(shift.assignments, id: \.id) { assignment in
                    assignmentRow(assignment)
                }
            }
        }
    }

    @ViewBuilder
    private func assignmentRow(_ assignment: ShiftAssignmentRecord) -> some View {
        let isMe = currentUserId.map { $0 == assignment.user.id } ?? false
        HStack(alignment: .top, spacing: 8) {
            UserAvatarView(name: assignment.user.name, avatarUrl: assignment.user.avatarUrl, size: 28)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    // Everyone reads at full strength — secondary text made
                    // the rest of the crew look disabled. The "You" chip
                    // already distinguishes the signed-in user.
                    Text(assignment.user.name)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                    if isMe {
                        Text("You")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.statusBackground(.blue))
                            .foregroundStyle(Color.statusText(.blue))
                            .clipShape(Capsule())
                    }
                    if assignment.status == "REQUESTED" {
                        CrewSlotStatusLabel(state: .requested, requestCount: 1)
                    }
                }
                if assignment.isOnTradeBoard {
                    // On-the-board cue, matching the Schedule legend's trade
                    // iconography. It sits under the name rather than beside it:
                    // as an inline capsule it wrapped into a column of single
                    // letters whenever the name column got tight.
                    Label("Trade Board", systemImage: "arrow.left.arrow.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.statusText(.orange))
                        .lineLimit(1)
                        .fixedSize()
                }
                if canManageShifts,
                   assignment.status == "REQUESTED",
                   onApprove != nil || onDecline != nil {
                    // Approve is the primary call-to-action (filled green);
                    // Decline is a clearly-separated outlined red. Bumped from
                    // .mini to .small + wider spacing so two consequential
                    // actions aren't a mis-tap risk on a dense row.
                    HStack(spacing: 10) {
                        if let onApprove {
                            Button("Approve") { onApprove(assignment) }
                                .buttonStyle(.borderedProminent)
                                .controlSize(.small)
                                .frame(minHeight: 44)
                                .lineLimit(1)
                                .tint(Color.statusText(.green))
                                .accessibilityLabel("Approve \(assignment.user.name)")
                        }
                        if let onDecline {
                            Button("Decline") { onDecline(assignment) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .frame(minHeight: 44)
                                .lineLimit(1)
                                .tint(Color.statusText(.red))
                                .accessibilityLabel("Decline \(assignment.user.name)")
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
    }

    /// What tapping this open row does, in the row's own words.
    private var openSlotActionTitle: String {
        if canManageShifts { return "Assign" }
        return isStudent && isStudentSlot ? "Claim shift" : "Open"
    }

    @ViewBuilder
    private var openSlotView: some View {
        // The row is the button now (see `body`), so this is the affordance, not
        // the target: accent text plus a chevron, the same shape every other
        // tappable row in the app uses. As a tinted pill it out-shouted the
        // section's real controls and repeated itself once per empty slot.
        if primaryRowAction != nil {
            HStack(spacing: 4) {
                Text(openSlotActionTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.statusText(.purple))
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .accessibilityHidden(true)
        } else {
            CrewSlotStatusLabel(state: .open)
        }
    }

    private var workerTypeLabel: String { crewWorkerTypeLabel(shift.workerType) }
}

// MARK: - Edit Shift Times Sheet

enum CallWindowEditScope {
    case slot
    case allAssigned
}

struct EditShiftTimesSheet: View {
    let shift: EventShift
    let eventTitle: String
    let scope: CallWindowEditScope
    let onSave: (Date, Date) async -> String?

    @State private var startsAt: Date
    @State private var endsAt: Date
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var showDiscardConfirm = false
    @Environment(\.dismiss) private var dismiss

    init(
        shift: EventShift,
        eventTitle: String,
        scope: CallWindowEditScope = .slot,
        defaultStart: Date? = nil,
        defaultEnd: Date? = nil,
        onSave: @escaping (Date, Date) async -> String?
    ) {
        self.shift = shift
        self.eventTitle = eventTitle
        self.scope = scope
        self.onSave = onSave
        _startsAt = State(initialValue: defaultStart ?? shift.effectiveStartsAt)
        _endsAt = State(initialValue: defaultEnd ?? shift.effectiveEndsAt)
    }

    private var hasChanges: Bool {
        startsAt != shift.effectiveStartsAt || endsAt != shift.effectiveEndsAt
    }

    private var hasValidWindow: Bool {
        endsAt > startsAt
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    contextCard
                    callWindowCard

                    if let saveError {
                        saveErrorCard(message: saveError)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(scope == .allAssigned ? "Set Student Call Time" : "Edit Call Window")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isSaving { return }
                        if hasChanges {
                            showDiscardConfirm = true
                        } else {
                            dismiss()
                        }
                    }
                    .disabled(isSaving)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await save() }
                } label: {
                    HStack(spacing: 8) {
                        if isSaving {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "checkmark")
                        }
                        Text(scope == .allAssigned ? "Apply to Students" : "Save Call Window")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.purple))
                .controlSize(.large)
                .disabled(isSaving || !hasChanges || !hasValidWindow)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .interactiveDismissDisabled(isSaving || hasChanges)
            .confirmationDialog(
                "Discard changes?",
                isPresented: $showDiscardConfirm,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your changes will be lost.")
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var contextCard: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.statusText(.blue))
                .frame(width: 4, height: 58)

            VStack(alignment: .leading, spacing: 4) {
                Text(eventTitle)
                    .font(.headline)
                    .lineLimit(2)
                Text(scope == .allAssigned ? "Every Student slot" : "\(shift.area.shiftAreaLabel) · \(workerClassLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var callWindowCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Call Window")
                    .font(.headline)
                Text(scope == .allAssigned
                    ? "Applies to every Student slot and clears Student personal overrides. Staff and collaborators do not have a call time."
                    : "Applies only to this crew slot")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()
            ShiftDateTimeRow(label: "Call", systemImage: "arrow.right", date: $startsAt)
                .disabled(isSaving)
            Divider()
            ShiftDateTimeRow(label: "End", systemImage: "arrow.left", date: $endsAt)
                .disabled(isSaving)

            if !hasValidWindow {
                Label("End time must be after call time.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.statusText(.red))
            } else {
                Text(windowSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private func saveErrorCard(message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
            VStack(alignment: .leading, spacing: 4) {
                Text(scope == .allAssigned ? "Couldn't update call times" : "Couldn't save call window")
                    .font(.subheadline.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Retry") { Task { await save() } }
                .font(.caption.weight(.semibold))
                .disabled(isSaving || !hasValidWindow)
        }
        .padding(14)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
    }

    private var workerClassLabel: String {
        shift.workerType == "ST" ? "Student shift" : "Staff shift"
    }

    private var windowSummary: String {
        "\(shortDate(startsAt)) · \(startsAt.formatted(date: .omitted, time: .shortened)) to \(endsAt.formatted(date: .omitted, time: .shortened))"
    }

    private func shortDate(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.component(.year, from: date) == calendar.component(.year, from: .now) {
            return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
    }

    private func save() async {
        guard !isSaving, hasChanges, hasValidWindow else { return }
        isSaving = true
        saveError = nil
        let error = await onSave(startsAt, endsAt)
        isSaving = false
        if let error {
            saveError = error
        } else {
            dismiss()
        }
    }
}

#Preview {
    Text("Tap an event to see detail")
}
