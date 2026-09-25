import SwiftUI
import TipKit
import UIKit

struct ScheduleEventRoute: Hashable {
    let id: String
}

// MARK: - View Model

enum MyShiftStatus: String {
    case active = "ACTIVE"
    case cancelled = "CANCELLED"
    case completed = "COMPLETED"
    case unknown
}

extension MyShift {
    var statusValue: MyShiftStatus {
        MyShiftStatus(rawValue: status) ?? .unknown
    }
}

/// Considered fresh while younger than this; older triggers a background refresh.
private let scheduleStaleAfter: TimeInterval = 5 * 60 // 5 minutes

/// How many weeks one edge load adds. The first load covers two weeks before
/// today (the first pull into the past reveals them without waiting) through
/// `initialWeeksAhead` weeks out.
private let scheduleWeeksPerEarlierLoad = 4
private let scheduleWeeksPerLaterLoad = 8
private let scheduleInitialWeeksAhead = 8
private let scheduleInitialWeeksBack = 2
/// Future weeks load before the reader gets this close to the end, so fast
/// scrolling does not outrun the data.
private let schedulePrefetchWeeksAhead = 4
/// Outer bounds for scrolling, so an empty stretch cannot page forever.
private let scheduleMaxWeeksBack = 104
private let scheduleMaxWeeksAhead = 104

@MainActor
@Observable
final class ScheduleViewModel {
    /// Every raw event loaded so far, keyed by id. Windows overlap at their
    /// edges, so merging by id keeps an event that spans two loads single.
    @ObservationIgnored private var rawEventsById: [String: ScheduleEvent] = [:]
    @ObservationIgnored private var shiftsById: [String: MyShift] = [:]

    private(set) var events: [ScheduleEvent] = [] {
        didSet { rebuildEventIndexes() }
    }
    private(set) var myShifts: [MyShift] = []
    var isLoading = false
    var error: String?
    var refreshError: String?
    private(set) var hasLoaded = false
    private var loadTask: Task<Void, Never>?
    private var loadRequests = LatestRequestGeneration()
    /// Bumped by every full reload and teardown, so an edge load that started
    /// before one cannot merge stale weeks into the replacement.
    @ObservationIgnored private var windowGeneration = 0

    /// The loaded window, in whole weeks: `[loadedStart, loadedEnd)`. The list
    /// scrolls through exactly this range and grows it at either edge.
    private(set) var loadedStart: Date
    private(set) var loadedEnd: Date
    private(set) var isLoadingEarlier = false
    private(set) var isLoadingLater = false
    private(set) var reachedEarliest = false
    private(set) var reachedLatest = false

    /// Whose Schedule this is, for the on-disk snapshot. Nil skips caching.
    @ObservationIgnored var cacheOwnerId: String?

    var shiftsByEventId: [String: MyShift] = [:]
    /// Every personal assignment on an event, earliest first. `shiftsByEventId`
    /// keeps the primary row so existing filters and swipe actions stay stable.
    var allShiftsByEventId: [String: [MyShift]] = [:]
    var extraShiftAreasByEventId: [String: [String]] = [:]
    var lastLoadedAt: Date?

    private static var calendar: Calendar { .current }

    static func weekStart(of date: Date) -> Date {
        calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? calendar.startOfDay(for: date)
    }

    private static func adding(weeks: Int, to date: Date) -> Date {
        calendar.date(byAdding: .weekOfYear, value: weeks, to: date) ?? date
    }

    private var earliestAllowed: Date {
        Self.adding(weeks: -scheduleMaxWeeksBack, to: Self.weekStart(of: .now))
    }

    private var latestAllowed: Date {
        Self.adding(weeks: scheduleMaxWeeksAhead, to: Self.weekStart(of: .now))
    }

    init() {
        let thisWeek = Self.weekStart(of: .now)
        loadedStart = Self.adding(weeks: -scheduleInitialWeeksBack, to: thisWeek)
        loadedEnd = Self.adding(weeks: scheduleInitialWeeksAhead, to: thisWeek)
    }

    var isStale: Bool {
        guard let t = lastLoadedAt else { return true }
        return Date.now.timeIntervalSince(t) > scheduleStaleAfter
    }

    /// Every week start in the loaded window, oldest first.
    var loadedWeeks: [Date] {
        var weeks: [Date] = []
        var cursor = loadedStart
        while cursor < loadedEnd, weeks.count < scheduleMaxWeeksBack + scheduleMaxWeeksAhead + 8 {
            weeks.append(cursor)
            cursor = Self.adding(weeks: 1, to: cursor)
        }
        return weeks
    }

    private(set) var groupedEvents: [(date: Date, events: [ScheduleEvent])] = []
    private(set) var eventsByDay: [Date: [ScheduleEvent]] = [:]

    private func rebuildEventIndexes() {
        var byDay: [Date: [ScheduleEvent]] = [:]
        for event in events {
            // A multi-day event appears under each calendar day it covers, so
            // it stays visible while it's still in progress.
            for day in event.spannedDays where day >= loadedStart && day < loadedEnd {
                byDay[day, default: []].append(event)
            }
        }
        eventsByDay = byDay.mapValues { $0.sorted { $0.startsAt < $1.startsAt } }
        groupedEvents = eventsByDay
            .sorted { $0.key < $1.key }
            .map { (date: $0.key, events: $0.value) }
    }

    /// Shows the last saved window while the first network load runs. Does
    /// nothing once real data has loaded.
    func restoreCachedWindow() {
        guard !hasLoaded, events.isEmpty, let owner = cacheOwnerId,
              let snapshot = ScheduleWindowCache.load(userId: owner) else { return }
        rawEventsById = Dictionary(snapshot.events.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        shiftsById = Dictionary(snapshot.shifts.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        publish()
    }

    private func saveCachedWindow() {
        guard let owner = cacheOwnerId else { return }
        ScheduleWindowCache.save(.init(
            userId: owner,
            savedAt: .now,
            events: Array(rawEventsById.values),
            shifts: Array(shiftsById.values)
        ))
    }

    /// What a reload refetches: the loaded window, capped to a few weeks
    /// back and half a year ahead of today. After scrolling a year out, a
    /// foreground refresh stays one short read instead of paging the whole
    /// window; weeks outside it keep what they last loaded.
    private var reloadWindow: DateInterval {
        let thisWeek = Self.weekStart(of: .now)
        let start = max(loadedStart, Self.adding(weeks: -4, to: thisWeek))
        let end = min(loadedEnd, Self.adding(weeks: 26, to: thisWeek))
        return DateInterval(start: start, end: max(end, start))
    }

    /// Reloads the loaded window around today (see `reloadWindow`).
    func load(forceRefresh: Bool = false) async {
        if forceRefresh {
            // A refresh must replace the in-flight query rather than wait on it.
            loadTask?.cancel()
        } else if isLoading {
            return
        }
        // Allow first load, explicit refresh, or staleness-driven refresh.
        guard !hasLoaded || forceRefresh || isStale else { return }
        let window = reloadWindow
        windowGeneration += 1
        let requestToken = loadRequests.begin()
        let task = Task { @MainActor in
            await performLoad(window: window, requestToken: requestToken)
        }
        loadTask = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            // Unstructured child tasks do not inherit later cancellation from
            // the calling SwiftUI task. Cancel this exact child, not whatever
            // newer force refresh may now own `loadTask`.
            task.cancel()
        }
    }

    /// View and session teardown must revoke publication ownership even when
    /// URLSession resumes with a wrapped cancellation error.
    func cancelLoad() {
        loadTask?.cancel()
        loadTask = nil
        loadRequests.invalidate()
        windowGeneration += 1
        isLoading = false
        isLoadingEarlier = false
        isLoadingLater = false
    }

    private func performLoad(window: DateInterval, requestToken: UUID) async {
        guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
        isLoading = true
        if events.isEmpty { error = nil }
        refreshError = nil
        defer {
            if loadRequests.owns(requestToken) {
                isLoading = false
                loadTask = nil
            }
        }
        do {
            let (fetchedEvents, fetchedShifts) = try await fetch(window)
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            // Replaces only what its own window covers. Weeks an edge load or
            // a deep link added while this was in flight survive it.
            replace(window, with: (fetchedEvents, fetchedShifts))
            publish()
            hasLoaded = true
            lastLoadedAt = .now
            error = nil
            saveCachedWindow()
            GearStore.shared.seedScheduleEvents(fetchedEvents)
        } catch APIError.unauthorized {
            // SessionStore listens for the global notification and routes the
            // user to login; nothing to do here besides cleaning up loading state.
            return
        } catch is CancellationError {
            // A newer request owns publication.
        } catch {
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            // Refresh failure must not blank an already-populated screen.
            if events.isEmpty {
                self.error = error.localizedDescription
            } else {
                self.refreshError = error.localizedDescription
            }
        }
    }

    /// Adds the weeks before the loaded window. Returns true when weeks were
    /// added, so the list can hold its scroll position over the insertion.
    @discardableResult
    func loadEarlier() async -> Bool {
        guard hasLoaded, !isLoadingEarlier, !reachedEarliest else { return false }
        let newStart = max(Self.adding(weeks: -scheduleWeeksPerEarlierLoad, to: loadedStart), earliestAllowed)
        guard newStart < loadedStart else {
            reachedEarliest = true
            return false
        }
        isLoadingEarlier = true
        defer { isLoadingEarlier = false }
        let generation = windowGeneration
        do {
            let window = DateInterval(start: newStart, end: loadedStart)
            let result = try await fetch(window)
            guard windowGeneration == generation, !Task.isCancelled else { return false }
            replace(window, with: result)
            // Bounds only grow: a concurrent jump may already reach further.
            loadedStart = min(loadedStart, newStart)
            reachedEarliest = newStart <= earliestAllowed
            publish()
            return true
        } catch {
            return false
        }
    }

    /// Adds the weeks after the loaded window.
    func loadLater() async {
        guard hasLoaded, !isLoadingLater, !reachedLatest else { return }
        let newEnd = min(Self.adding(weeks: scheduleWeeksPerLaterLoad, to: loadedEnd), latestAllowed)
        guard newEnd > loadedEnd else {
            reachedLatest = true
            return
        }
        isLoadingLater = true
        defer { isLoadingLater = false }
        let generation = windowGeneration
        do {
            let window = DateInterval(start: loadedEnd, end: newEnd)
            let result = try await fetch(window)
            guard windowGeneration == generation, !Task.isCancelled else { return }
            replace(window, with: result)
            loadedEnd = max(loadedEnd, newEnd)
            reachedLatest = newEnd >= latestAllowed
            publish()
        } catch {
            return
        }
    }

    /// Starts the next future load once a visible day is within a few weeks of
    /// the loaded end.
    func prefetchLater(near day: Date) {
        guard hasLoaded, !isLoadingLater, !reachedLatest,
              day >= Self.adding(weeks: -schedulePrefetchWeeksAhead, to: loadedEnd) else { return }
        Task { await loadLater() }
    }

    /// Grows the window to cover a day picked in the month grid, so a jump
    /// never lands on a date the list has not loaded. Returns false when the
    /// day is outside the scrollable bounds or the load failed.
    @discardableResult
    func ensureLoaded(_ day: Date) async -> Bool {
        let target = Self.calendar.startOfDay(for: day)
        guard target >= earliestAllowed, target < latestAllowed else { return false }
        if target < loadedStart {
            let newStart = Self.weekStart(of: target)
            let generation = windowGeneration
            let window = DateInterval(start: newStart, end: loadedStart)
            guard let result = try? await fetch(window),
                  windowGeneration == generation else { return false }
            replace(window, with: result)
            loadedStart = min(loadedStart, newStart)
            reachedEarliest = newStart <= earliestAllowed
            publish()
        } else if target >= loadedEnd {
            let newEnd = Self.adding(weeks: 1, to: Self.weekStart(of: target))
            let generation = windowGeneration
            let window = DateInterval(start: loadedEnd, end: newEnd)
            guard let result = try? await fetch(window),
                  windowGeneration == generation else { return false }
            replace(window, with: result)
            loadedEnd = max(loadedEnd, newEnd)
            reachedLatest = newEnd >= latestAllowed
            publish()
        }
        return true
    }

    /// Finds an event for a push or deep link. One outside the loaded weeks is
    /// read by id, then its weeks are loaded so the detail screen and the list
    /// both have it.
    func event(forLink id: String) async -> ScheduleEvent? {
        // Wait out an in-flight first load, so it cannot land afterwards and
        // replace the event this link just resolved.
        if let loadTask { await loadTask.value }
        if let loaded = events.first(where: { $0.id == id || ($0.combinedEvents ?? []).contains { $0.id == id } }) {
            return loaded
        }
        guard let fetched = try? await APIClient.shared.scheduleEvent(id: id) else { return nil }
        await ensureLoaded(fetched.startsAt)
        if let loaded = events.first(where: { $0.id == fetched.id }) { return loaded }
        // Beyond the scrollable range (or its weeks failed to load): still
        // open it, from the fetched payload.
        linkedEvents[fetched.id] = fetched
        return fetched
    }

    /// Events opened from a link that the loaded weeks do not hold.
    private(set) var linkedEvents: [String: ScheduleEvent] = [:]

    private func fetch(_ window: DateInterval) async throws -> ([ScheduleEvent], [MyShift]) {
        async let eventsTask = APIClient.shared.allCalendarEvents(window: window)
        async let shiftsTask = APIClient.shared.allMyShifts(window: window)
        return try await (eventsTask, shiftsTask)
    }

    /// Swaps in a fresh read of one window: anything that overlaps it is
    /// dropped first, so an event deleted or moved away disappears, and
    /// everything outside it is left alone.
    private func replace(_ window: DateInterval, with result: ([ScheduleEvent], [MyShift])) {
        func overlaps(_ start: Date, _ end: Date) -> Bool {
            start < window.end && end > window.start
        }
        rawEventsById = rawEventsById.filter { !overlaps($0.value.startsAt, $0.value.endsAt) }
        shiftsById = shiftsById.filter { !overlaps($0.value.event.startsAt, $0.value.event.endsAt) }
        for event in result.0 { rawEventsById[event.id] = event }
        for shift in result.1 { shiftsById[shift.id] = shift }
        GearStore.shared.seedScheduleEvents(result.0)
        saveCachedWindow()
    }

    private func publish() {
        let shifts = Array(shiftsById.values)
        myShifts = shifts.sorted { $0.startsAt < $1.startsAt }
        let grouped = orderedPersonalShiftsByEvent(shifts)
        allShiftsByEventId = grouped
        shiftsByEventId = grouped.compactMapValues(\.first)
        extraShiftAreasByEventId = grouped.reduce(into: [:]) { result, pair in
            let extras = extraPersonalAreas(from: pair.value)
            if !extras.isEmpty { result[pair.key] = extras }
        }
        // Assigned last: its didSet rebuilds the day index, which reads the
        // current window bounds.
        events = collapsedCombinedScheduleEvents(Array(rawEventsById.values))
    }
}

// MARK: - HomeAwayFilter

enum HomeAwayFilter: String, CaseIterable {
    case all = "All"
    case home = "Home"
    case away = "Away"
    case neutral = "Neutral"
    case nonGame = "Non-game"
}

private func orderedPersonalShiftsByEvent(_ shifts: [MyShift]) -> [String: [MyShift]] {
    Dictionary(grouping: shifts, by: { $0.event.id }).mapValues { group in
        group.sorted { first, second in
            if first.startsAt != second.startsAt {
                return first.startsAt < second.startsAt
            }
            return first.id < second.id
        }
    }
}

private func extraPersonalAreas(from ordered: [MyShift]) -> [String] {
    guard let firstArea = ordered.first?.area else { return [] }
    var seen: Set<String> = [firstArea]
    return ordered.dropFirst().compactMap { shift in
        seen.insert(shift.area).inserted ? shift.area : nil
    }
}

private func scheduleEventMatches(_ event: ScheduleEvent, filter: HomeAwayFilter) -> Bool {
    // Reads the same resolved venue the rail and the dots do, so filtering to
    // Neutral cannot hide a row the list is drawing as neutral. The raw
    // `isHome` tri-state used to answer this, which put every explicitly
    // neutral game on a home-mapped venue under Home instead.
    switch filter {
    case .all: return true
    case .home: return event.venue == .home
    case .away: return event.venue == .away
    case .neutral: return event.venue == .neutral
    case .nonGame: return event.venue == .nonGame
    }
}

// MARK: - Main View

struct ScheduleView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        if session.currentUser?.role == "COLLABORATOR" {
            CollaboratorPublishedScheduleView()
        } else {
            InternalScheduleView()
        }
    }
}

/// Isolated from `InternalScheduleView.body` so iOS 27 overflow content type-checks
/// in a small ToolbarContent unit instead of the Schedule root's giant tree.
private struct ScheduleRootToolbar: ToolbarContent {
    @Binding var myShiftsOnly: Bool
    @Binding var sportFilter: String?
    let availableSportCodes: [String]
    let canManageAvailability: Bool
    let openTradeCount: Int
    let scheduleOpenWorkTip: ScheduleOpenWorkTip
    let shiftCalendarTip: ShiftCalendarTip
    @Binding var showTradeBoard: Bool
    @Binding var showAvailability: Bool
    @Binding var showCalendarSetup: Bool

    private static let allSports = "__all_sports__"

    private var showsSportMenu: Bool { availableSportCodes.count > 1 }

    var body: some ToolbarContent {
        if #available(iOS 27.0, *) {
            ToolbarItemGroup(placement: .topBarTrailing) {
                myShiftsButton
                if showsSportMenu { sportMenu }
            }
            .visibilityPriority(.high)

            ToolbarSpacer(.fixed, placement: .topBarTrailing)

            ToolbarItem(placement: .topBarTrailing) {
                tradeBoardButton
                    .badge(openTradeCount)
            }
            .visibilityPriority(.high)

            ToolbarOverflowMenu {
                overflowActions
            }
        } else {
            ToolbarItemGroup(placement: .topBarTrailing) {
                myShiftsButton
                if showsSportMenu { sportMenu }
            }

            ToolbarSpacer(.fixed, placement: .topBarTrailing)

            ToolbarItem(placement: .topBarTrailing) {
                tradeBoardButton
                    .badge(openTradeCount)
            }

            ToolbarItem(placement: .topBarTrailing) {
                moreControl
            }
        }
    }

    /// One tap between everything and your own work, which is the question
    /// most people open Schedule to answer.
    private var myShiftsButton: some View {
        Button {
            myShiftsOnly.toggle()
            Haptics.selection()
        } label: {
            Label(
                "My Shifts",
                systemImage: myShiftsOnly
                    ? "person.crop.circle.fill.badge.checkmark"
                    : "person.crop.circle.badge.checkmark"
            )
        }
        .listControlTint(isActive: myShiftsOnly)
        .accessibilityLabel("My Shifts")
        .accessibilityValue(myShiftsOnly ? "On" : "Off")
        .accessibilityAddTraits(myShiftsOnly ? .isSelected : [])
    }

    private var sportSelection: Binding<String> {
        Binding {
            sportFilter ?? Self.allSports
        } set: { newValue in
            sportFilter = newValue == Self.allSports ? nil : newValue
        }
    }

    private var sportMenu: some View {
        Menu {
            Picker("Sport", selection: sportSelection) {
                Text("All Sports").tag(Self.allSports)
                ForEach(availableSportCodes, id: \.self) { code in
                    Text(scheduleSportLabel(code)).tag(code)
                }
            }
        } label: {
            Label(
                "Sport",
                systemImage: sportFilter == nil ? "sportscourt" : "sportscourt.fill"
            )
        }
        .listControlTint(isActive: sportFilter != nil)
        .accessibilityLabel(sportMenuAccessibilityLabel)
    }

    private var sportMenuAccessibilityLabel: String {
        guard let sportFilter else { return "Sport, all sports" }
        return "Sport, " + scheduleSportLabel(sportFilter)
    }

    private var tradeBoardButton: some View {
        Button {
            scheduleOpenWorkTip.invalidate(reason: .actionPerformed)
            showTradeBoard = true
        } label: {
            // The count rides on the toolbar item's native badge. A hand-drawn
            // overlay was clipped by the glass capsule into a half-disc.
            Label(
                "Trade Board",
                systemImage: openTradeCount > 0
                    ? "arrow.left.arrow.right.circle.fill"
                    : "arrow.left.arrow.right.circle"
            )
            .popoverTip(scheduleOpenWorkTip, arrowEdge: .top)
        }
        .tint(Color.primary)
        .accessibilityLabel(openTradeCount > 0
            ? "Trade Board, \(openTradeCount) open"
            : "Trade Board")
    }

    @ViewBuilder
    private var overflowActions: some View {
        if canManageAvailability {
            availabilityButton
        }
        calendarButton
    }

    @ViewBuilder
    private var moreControl: some View {
        if canManageAvailability {
            Menu {
                overflowActions
            } label: {
                Label("More", systemImage: "ellipsis")
                    .popoverTip(shiftCalendarTip, arrowEdge: .top)
            }
            .tint(Color.primary)
            .accessibilityLabel("More Schedule actions")
        } else {
            calendarButton
                .popoverTip(shiftCalendarTip, arrowEdge: .top)
                .tint(Color.primary)
                .accessibilityLabel("Shift Calendar")
        }
    }

    private var availabilityButton: some View {
        Button {
            showAvailability = true
        } label: {
            Label("My Availability", systemImage: "calendar.badge.clock")
        }
    }

    private var calendarButton: some View {
        Button {
            shiftCalendarTip.invalidate(reason: .actionPerformed)
            showCalendarSetup = true
        } label: {
            Label("Shift Calendar", systemImage: "calendar.badge.plus")
        }
    }
}

private struct InternalScheduleView: View {
    private let scheduleOpenWorkTip = ScheduleOpenWorkTip()
    private let shiftCalendarTip = ShiftCalendarTip()
    @State private var vm = ScheduleViewModel()
    @State private var navigationPath = NavigationPath()
    @State private var myShiftsOnly = false
    @State private var homeAwayFilter: HomeAwayFilter = .all
    /// nil = all sports. Cuts the all-team firehose down to the sport a student
    /// or staffer actually works, without hiding open shifts the way a
    /// my-shifts-only default would.
    @State private var sportFilter: String?
    @State private var showTradeBoard = false
    @State private var shiftToPost: TradePostCandidate?
    @State private var showAvailability = false
    @State private var scrollTracker = ScheduleScrollTracker()
    @State private var jumpRequest: ScheduleJumpRequest?
    @State private var isMonthExpanded = false
    @State private var didInitialJump = false
    /// How many two-week steps of the past are revealed above today. Zero
    /// keeps today as the top of the list, so a status-bar tap or a hard
    /// flick upward stops on today instead of running into last month.
    @State private var pastRevealSteps = 0
    @State private var pullDistance: CGFloat = 0
    @State private var isPullArmed = false
    @State private var isDraggingList = false
    /// How many reveals are still inserting rows and scrolling to them. A
    /// count, not a flag, so one finishing cannot clear another still waiting
    /// on the network; while above zero the idle collapse stands down.
    @State private var revealSettlingCount = 0
    @State private var showCalendarSetup = false
    @State private var toast: Toast?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase

    /// Applies the Home Shifts hint. Consumed rather than observed so a later
    /// manual clear of the filter is not undone by a stale flag, and read on
    /// appear as well as on change because the tab switch and the flag can
    /// arrive in either order.
    private func consumePendingMyShifts() {
        guard appState.pendingScheduleMyShifts else { return }
        appState.pendingScheduleMyShifts = false
        myShiftsOnly = true
    }

    private var canManageAvailability: Bool {
        session.currentUser?.staffingType == "ST"
    }

    private var displayedGroups: [(date: Date, events: [ScheduleEvent])] {
        vm.groupedEvents.compactMap { group in
            var filtered = group.events
            if myShiftsOnly { filtered = filtered.filter { vm.shiftsByEventId[$0.id] != nil } }
            filtered = filtered.filter { scheduleEventMatches($0, filter: homeAwayFilter) }
            if let sportFilter { filtered = filtered.filter { $0.sportCode == sportFilter } }
            return filtered.isEmpty ? nil : (date: group.date, events: filtered)
        }
    }

    /// Every current sport plus any other code in the loaded events, ordered
    /// by display name. A fixed list, because the loaded weeks are only a
    /// window: a sport whose games are all months out still belongs in the menu.
    private var availableSportCodes: [String] {
        let codes = Set(scheduleCurrentSportCodes).union(vm.events.compactMap { $0.sportCode })
        return codes.sorted { scheduleSportLabel($0) < scheduleSportLabel($1) }
    }

    private var activeFilterCount: Int {
        var count = 0
        if myShiftsOnly { count += 1 }
        if homeAwayFilter != .all { count += 1 }
        if sportFilter != nil { count += 1 }
        return count
    }

    /// Venue marks for the week strip and month grid, from the same filtered
    /// groups the list draws, so a dot always has a row to jump to.
    private func dayMarks(for groups: [(date: Date, events: [ScheduleEvent])]) -> [Date: ScheduleDayMarks] {
        var marks: [Date: ScheduleDayMarks] = [:]
        for group in groups {
            let dots = group.events.prefix(3).map { event in
                DotInfo(
                    color: venueRailColor(for: event),
                    isShift: vm.shiftsByEventId[event.id] != nil,
                    venue: event.venue
                )
            }
            marks[group.date] = ScheduleDayMarks(
                dots: Array(dots),
                eventCount: group.events.count,
                hasShift: group.events.contains { vm.shiftsByEventId[$0.id] != nil },
                venueCounts: Dictionary(grouping: group.events, by: \.venue).mapValues(\.count)
            )
        }
        return marks
    }

    /// The list in loaded-window order: each day with events, and one
    /// placeholder for a week with none, so scrolling always moves through
    /// real weeks instead of skipping or dead-ending.
    private func listSections(for groups: [(date: Date, events: [ScheduleEvent])]) -> [ScheduleListSection] {
        let lowerBound = visibleLowerBound
        let lowerWeek = ScheduleViewModel.weekStart(of: lowerBound)
        let visibleGroups = groups.filter { $0.date >= lowerBound }
        let byWeek = Dictionary(grouping: visibleGroups) { ScheduleViewModel.weekStart(of: $0.date) }
        var sections: [ScheduleListSection] = []
        for week in vm.loadedWeeks where week >= lowerWeek {
            if let days = byWeek[week] {
                sections += days.map { .day(date: $0.date, events: $0.events) }
            } else if case let .emptyWeeks(start, count)? = sections.last {
                // A run of empty weeks is one row, not a stack of identical
                // "nothing this week" cards.
                sections[sections.count - 1] = .emptyWeeks(start: start, count: count + 1)
            } else {
                sections.append(.emptyWeeks(start: week, count: 1))
            }
        }
        return sections
    }

    /// The section a day resolves to: that day, the next day with events in
    /// its week, or its week's placeholder.
    private func section(for day: Date, in sections: [ScheduleListSection]) -> ScheduleListSection? {
        let target = Calendar.current.startOfDay(for: day)
        return sections.first { $0.lastDay >= target } ?? sections.last
    }

    /// Where Today lands, for the strip's Today button.
    private func todayAnchor(in sections: [ScheduleListSection]) -> Date? {
        section(for: .now, in: sections)?.id.date
    }

    /// Scrolls the master list to a day, loading its weeks first when the
    /// month grid picks a date outside the loaded window.
    private func jump(to day: Date, animated: Bool = true) {
        let target = Calendar.current.startOfDay(for: day)
        let today = Calendar.current.startOfDay(for: .now)
        if target < today {
            // A past day picked in the strip or month grid is itself the
            // intentional step, so reveal enough of the past to hold it.
            let days = Calendar.current.dateComponents([.day], from: target, to: today).day ?? 0
            let steps = max(1, Int((Double(days) / 14).rounded(.up)))
            if steps > pastRevealSteps {
                pastRevealSteps = steps
                revealSettlingCount += 1
                Task {
                    try? await Task.sleep(for: .milliseconds(700))
                    revealSettlingCount -= 1
                }
            }
        } else if target == today {
            pastRevealSteps = 0
        }
        guard target >= vm.loadedStart, target < vm.loadedEnd else {
            Task {
                if await vm.ensureLoaded(target) { jump(to: target, animated: animated) }
            }
            return
        }
        guard let section = section(for: target, in: listSections(for: displayedGroups)) else { return }
        jumpRequest = ScheduleJumpRequest(anchor: section.firstAnchor, animated: animated)
    }

    private static let pullThreshold: CGFloat = 96

    /// The first day the list shows. Today, until the reader deliberately
    /// pulls past the top; each pull adds two weeks.
    private var visibleLowerBound: Date {
        let today = Calendar.current.startOfDay(for: .now)
        guard pastRevealSteps > 0 else { return today }
        let back = Calendar.current.date(byAdding: .day, value: -14 * pastRevealSteps, to: today) ?? today
        return ScheduleViewModel.weekStart(of: back)
    }

    private var canRevealMorePast: Bool {
        visibleLowerBound > ScheduleViewModel.weekStart(
            of: Calendar.current.date(byAdding: .weekOfYear, value: -104, to: .now) ?? .now
        )
    }

    /// Tracks the overscroll at the top of the list. Crossing the threshold
    /// arms the reveal with one firm haptic; easing back below disarms it.
    private func handlePull(_ distance: CGFloat) {
        pullDistance = max(0, distance)
        guard isDraggingList, canRevealMorePast else { return }
        if !isPullArmed, distance >= Self.pullThreshold {
            isPullArmed = true
            Haptics.threshold()
        } else if isPullArmed, distance < Self.pullThreshold * 0.6 {
            isPullArmed = false
            Haptics.selection()
        }
    }

    private func handleScrollPhase(_ phase: ScrollPhase, sections: [ScheduleListSection]) {
        let wasDragging = isDraggingList
        isDraggingList = phase == .interacting
        if wasDragging, !isDraggingList, isPullArmed {
            isPullArmed = false
            revealPast(keeping: sections.first?.firstAnchor)
        }
        if phase == .idle { collapsePastIfOutOfView() }
    }

    /// Reveals two more weeks of the past above the current top. Inserting
    /// rows above the viewport pushes the content down, so the list is put
    /// back on the row that was first, then eased up into the newest past day.
    private func revealPast(keeping anchor: ScheduleRowAnchor?) {
        revealSettlingCount += 1
        pastRevealSteps += 1
        let lowerBound = visibleLowerBound
        Task {
            await vm.ensureLoaded(lowerBound)
            if let anchor {
                jumpRequest = ScheduleJumpRequest(anchor: anchor, animated: false)
            }
            try? await Task.sleep(for: .milliseconds(60))
            let sections = listSections(for: displayedGroups)
            if let anchor,
               let index = sections.firstIndex(where: { $0.firstAnchor == anchor }),
               index > 0 {
                jumpRequest = ScheduleJumpRequest(anchor: sections[index - 1].firstAnchor)
            }
            try? await Task.sleep(for: .milliseconds(500))
            revealSettlingCount -= 1
            // Keep the next pull instant.
            await vm.loadEarlier()
        }
    }

    /// Once the reader is back on today or later and the list comes to rest,
    /// the past folds away again, holding the list on the row at the top. The
    /// next status-bar tap or hard flick upward then stops on today.
    private func collapsePastIfOutOfView() {
        guard pastRevealSteps > 0, revealSettlingCount == 0 else { return }
        let today = Calendar.current.startOfDay(for: .now)
        guard !scrollTracker.hasVisibleRow(before: today),
              let anchor = scrollTracker.topAnchor?.base as? ScheduleRowAnchor else { return }
        pastRevealSteps = 0
        jumpRequest = ScheduleJumpRequest(anchor: anchor, animated: false)
    }

    private var pullHint: some View {
        let progress = min(pullDistance / Self.pullThreshold, 1)
        return Label(
            isPullArmed ? "Release for earlier weeks" : "Pull for earlier weeks",
            systemImage: isPullArmed ? "arrow.up.circle.fill" : "arrow.down.circle"
        )
        .font(.footnote.weight(.semibold))
        .foregroundStyle(isPullArmed ? Color.brandPrimary : Color.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.regularMaterial, in: Capsule())
        .opacity(canRevealMorePast && pullDistance > 12 ? progress : 0)
        .offset(y: min(pullDistance, Self.pullThreshold) / 2 - 8)
        .animation(.snappy(duration: 0.15), value: isPullArmed)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    var body: some View {
        let groups = displayedGroups
        NavigationStack(path: $navigationPath) {
            Group {
                // A cached window renders at once; the skeleton only shows on
                // a first launch with nothing saved.
                if !vm.hasLoaded && vm.events.isEmpty && vm.error == nil {
                    VStack(spacing: 8) {
                        ProgressView("Loading schedule")
                            .padding(.top, 12)
                        List {
                            Section {
                                ForEach(0..<6, id: \.self) { _ in
                                    EventRowSkeleton()
                                        .listRowBackground(Color.cardSurface)
                                }
                            }
                        }
                        .listStyle(.insetGrouped)
                        .scrollContentBackground(.hidden)
                        .background(Color(.systemGroupedBackground))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                    }
                } else if !vm.hasLoaded, vm.events.isEmpty, let err = vm.error {
                    // Only blank the screen when we have nothing to show.
                    ContentUnavailableView {
                        Label("Couldn't load schedule", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(err)
                    } actions: {
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    VStack(spacing: 0) {
                        scheduleHeader(groups: groups)
                        eventList(groups: groups)
                    }
                    .background(Color(.systemGroupedBackground))
                }
            }
            .overlay(alignment: .top) {
                // Non-blocking refresh-failed banner — lets the user keep using stale data.
                if !vm.events.isEmpty, let refreshError = vm.refreshError {
                    HStack(spacing: 8) {
                        Image(systemName: "wifi.exclamationmark")
                        Text(refreshError)
                            .font(.footnote)
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .font(.footnote.weight(.semibold))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 12)
                    .padding(.top, 4)
                    .shadow(color: Color.primary.opacity(0.08), radius: 8, y: 2)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .toast($toast)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: vm.refreshError)
            .navigationTitle("Schedule")
            // Schedule is a tab root, not a pushed view. It stays inline anyway
            // because the screen is scanned rather than read, and it matches the
            // compact title Bookings already uses; Items and Users keep large
            // titles because they lead with search.
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ScheduleRootToolbar(
                    myShiftsOnly: $myShiftsOnly,
                    sportFilter: $sportFilter,
                    availableSportCodes: availableSportCodes,
                    canManageAvailability: canManageAvailability,
                    openTradeCount: appState.openTradeCount,
                    scheduleOpenWorkTip: scheduleOpenWorkTip,
                    shiftCalendarTip: shiftCalendarTip,
                    showTradeBoard: $showTradeBoard,
                    showAvailability: $showAvailability,
                    showCalendarSetup: $showCalendarSetup
                )
            }
            .nativeScrollBarMinimization()
            .task {
                consumePendingMyShifts()
                vm.cacheOwnerId = session.currentUser?.id
                vm.restoreCachedWindow()
                // A push that launched the app set its id before this view
                // existed, so the change handler never saw it. Read it here too.
                if let eventId = appState.pendingPushEventId {
                    routePendingPush(eventId)
                }
                await vm.load()
            }
            .onDisappear { vm.cancelLoad() }
            .onChange(of: session.currentUser?.id) { _, userId in
                if userId == nil {
                    vm.cancelLoad()
                }
            }
            .onChange(of: appState.pendingScheduleMyShifts) { _, _ in
                consumePendingMyShifts()
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 4 else { return }
                navigationPath = NavigationPath()
                myShiftsOnly = false
                homeAwayFilter = .all
                sportFilter = nil
                isMonthExpanded = false
                showTradeBoard = false
                showAvailability = false
                showCalendarSetup = false
                jump(to: .now)
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await vm.load() }
                }
            }
            .onChange(of: appState.pendingPushEventId) { _, eventId in
                guard let eventId else { return }
                routePendingPush(eventId)
            }
            .navigationDestination(for: ScheduleEventRoute.self) { route in
                if let event = vm.events.first(where: { $0.id == route.id }) ?? vm.linkedEvents[route.id] {
                    EventDetailView(
                        event: event,
                        myShifts: vm.allShiftsByEventId[event.id] ?? []
                    )
                } else {
                    ContentUnavailableView(
                        "Event unavailable",
                        systemImage: "calendar.badge.exclamationmark",
                        description: Text("Return to Schedule and refresh to try again.")
                    )
                }
            }
            .navigationDestination(isPresented: $showAvailability) {
                AvailabilityView(userId: session.currentUser?.id ?? "")
            }
            .sheet(isPresented: $showCalendarSetup) {
                ScheduleCalendarSubscriptionSheet()
            }
            .sheet(isPresented: $showTradeBoard, onDismiss: {
                Task { await appState.refresh(forceRefresh: true) }
            }) {
                TradeBoardSheet(
                    myShifts: vm.myShifts,
                    currentUserId: session.currentUser?.id ?? "",
                    currentUserRole: session.currentUser?.role ?? "",
                    onTradePosted: { area in
                        toast = Toast(message: "Posted \(area) shift to the trade board", icon: "checkmark.circle.fill", role: .success)
                    },
                    onTradeClaimed: { area, when in
                        toast = Toast(message: "You picked up \(area) on \(when)", icon: "hand.thumbsup.fill", role: .success)
                    }
                )
            }
            .sheet(item: $shiftToPost) { candidate in
                PostTradeSheet(candidate: candidate) { posted in
                    toast = Toast(message: "Posted \(posted.area) shift to the trade board", icon: "checkmark.circle.fill", role: .success)
                    Task { await vm.load(forceRefresh: true) }
                }
            }
        }
    }

    /// Opens a pushed event. Loaded events open at once; anything else,
    /// including a game months out, is read by id and its weeks loaded first.
    private func routePendingPush(_ eventId: String) {
        appState.pendingPushEventId = nil
        Task {
            if let event = await vm.event(forLink: eventId) {
                navigationPath.append(ScheduleEventRoute(id: event.id))
            }
        }
    }

    /// Your own future, still-active shift on this event, if you have one. A
    /// started or already-ended shift cannot be traded and the server says so
    /// too, so the action simply is not offered.
    private func postableCandidate(forEvent eventId: String) -> TradePostCandidate? {
        guard let shift = vm.shiftsByEventId[eventId],
              shift.statusValue == .active,
              (shift.callStartsAt ?? shift.startsAt) > Date() else { return nil }
        return TradePostCandidate(shift: shift)
    }

    private func clearScheduleFilters() {
        myShiftsOnly = false
        homeAwayFilter = .all
        sportFilter = nil
    }

    /// The week jump bar and the event type chips. Both sit above the one
    /// master list; neither replaces it.
    private func scheduleHeader(groups: [(date: Date, events: [ScheduleEvent])]) -> some View {
        VStack(spacing: 2) {
            ScheduleWeekStrip(
                marksByDay: dayMarks(for: groups),
                weeks: vm.loadedWeeks,
                tracker: scrollTracker,
                todayAnchor: todayAnchor(in: listSections(for: groups)),
                isExpanded: $isMonthExpanded,
                onJump: { jump(to: $0) },
                onToday: { jump(to: .now) },
                // Loading earlier data never inserts list rows by itself; the
                // list only shows the past a deliberate pull has revealed.
                onReachStart: { Task { await vm.loadEarlier() } },
                onReachEnd: { Task { await vm.loadLater() } },
                onShowMonth: { month in
                    Task {
                        let cal = Calendar.current
                        let lastDay = cal.date(byAdding: DateComponents(month: 1, day: -1), to: month) ?? month
                        await vm.ensureLoaded(lastDay)
                        await vm.ensureLoaded(month)
                    }
                }
            )
            ScheduleQuickFilterBar(
                homeAwayFilter: $homeAwayFilter,
                sportLabel: sportFilter.map(scheduleSportLabel),
                onClearSport: { sportFilter = nil }
            )
        }
        .padding(.top, 2)
        .padding(.bottom, 4)
        .background(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private func eventList(groups: [(date: Date, events: [ScheduleEvent])]) -> some View {
        // The full-screen empty state waits until the whole scrollable future
        // has been searched. Before that the list stays mounted, showing
        // "No matching events" runs, and its end row keeps loading weeks
        // until something matches (a filtered sport may play months out).
        if activeFilterCount > 0, vm.reachedLatest,
           !listSections(for: groups).contains(where: \.isDay) {
            ContentUnavailableView {
                Label(filteredEmptyTitle, systemImage: "calendar")
            } description: {
                Text(filteredEmptyDescription)
            } actions: {
                Button("Clear Filters") { clearScheduleFilters() }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            let sections = listSections(for: groups)
            ScrollViewReader { proxy in
                List {
                    ForEach(sections) { section in
                        listSection(section)
                    }

                    if vm.reachedLatest {
                        Text(endOfScheduleText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    } else {
                        edgeLoadingRow("Loading later weeks")
                            .onAppear { Task { await vm.loadLater() } }
                            // A new identity per window end, so the row
                            // appears again (and loads again) when it is
                            // still on screen after a load, as it is when a
                            // filter leaves the weeks empty.
                            .id(vm.loadedEnd)
                    }
                }
                // Plain so day headers stay pinned while their rows scroll;
                // each row draws its own slice of the rounded day group.
                .listStyle(.plain)
                .listSectionSpacing(6)
                .scrollContentBackground(.hidden)
                .contentMargins(.top, 4, for: .scrollContent)
                .contentMargins(.bottom, 24, for: .scrollContent)
                .background(Color(.systemGroupedBackground))
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.containerSize.height
                        >= geometry.contentSize.height - 8
                } action: { _, atBottom in
                    scrollTracker.setAtBottom(atBottom)
                }
                // The past sits behind a deliberate pull at the top: overscroll
                // past the threshold, feel the haptic, release.
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    -(geometry.contentOffset.y + geometry.contentInsets.top)
                } action: { _, distance in
                    handlePull(distance)
                }
                .onScrollPhaseChange { _, phase in
                    handleScrollPhase(phase, sections: sections)
                }
                .overlay(alignment: .top) { pullHint }
                .onChange(of: jumpRequest) { _, request in
                    guard let request else { return }
                    // The target is a section's first row; its header is
                    // pinned above it.
                    if request.animated && !reduceMotion {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            proxy.scrollTo(request.anchor, anchor: .top)
                        }
                    } else {
                        proxy.scrollTo(request.anchor, anchor: .top)
                    }
                }
                .onAppear {
                    // The window opens a week before today, so the first
                    // render lands on today rather than the top of the window.
                    guard !didInitialJump else { return }
                    Task { @MainActor in
                        jump(to: .now, animated: false)
                        didInitialJump = true
                    }
                }
            }
        }
    }

    private var endOfScheduleText: String {
        "Schedule shown through " + vm.loadedEnd.formatted(.dateTime.month(.abbreviated).day().year())
    }

    @ViewBuilder
    private func listSection(_ section: ScheduleListSection) -> some View {
        switch section {
        case let .day(date, events):
            Section {
                ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                    let anchor = ScheduleRowAnchor(day: date, eventId: event.id)
                    eventRow(
                        event,
                        on: date,
                        position: EventRowGroupPosition(index: index, count: events.count)
                    )
                    .id(anchor)
                    .onAppear {
                        scrollTracker.rowAppeared(on: date, anchor: anchor, index: index)
                        vm.prefetchLater(near: date)
                    }
                    .onDisappear { scrollTracker.rowDisappeared(on: date, anchor: anchor) }
                }
            } header: {
                ScheduleDateHeader(date: date, eventCount: events.count)
                    .listRowInsets(EdgeInsets())
            }
            .listSectionSeparator(.hidden)
        case let .emptyWeeks(start, count):
            Section {
                Text(emptyWeeksText(count: count))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .listRowInsets(EdgeInsets(top: 12, leading: 32, bottom: 12, trailing: 32))
                    .listRowSeparator(.hidden)
                    .listRowBackground(EventRowBackground(isMine: false))
                    .id(section.firstAnchor)
                    .onAppear {
                        scrollTracker.rowAppeared(on: trackedDay(forWeek: start), anchor: section.firstAnchor)
                        vm.prefetchLater(near: section.lastDay)
                    }
                    .onDisappear {
                        scrollTracker.rowDisappeared(on: trackedDay(forWeek: start), anchor: section.firstAnchor)
                    }
            } header: {
                ScheduleWeekHeader(weekStart: start, weekCount: count)
                    .listRowInsets(EdgeInsets())
            }
            .listSectionSeparator(.hidden)
        }
    }

    private func emptyWeeksText(count: Int) -> String {
        if activeFilterCount > 0 {
            return count == 1 ? "No matching events this week" : "No matching events"
        }
        return count == 1 ? "No events this week" : "Nothing scheduled"
    }

    /// An empty stretch reports its start day to the strip, except when it
    /// begins in the current week, whose placeholder stands for today onward.
    private func trackedDay(forWeek start: Date) -> Date {
        let today = Calendar.current.startOfDay(for: .now)
        return ScheduleViewModel.weekStart(of: today) == start ? today : start
    }

    private func edgeLoadingRow(_ label: String) -> some View {
        ProgressView()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityLabel(label)
    }

    /// A Button, not a NavigationLink, so the row carries no disclosure
    /// chevron; the whole grouped cell is the tap target.
    private func eventRow(_ event: ScheduleEvent, on day: Date, position: EventRowGroupPosition) -> some View {
        let myShift = vm.shiftsByEventId[event.id]
        return Button {
            navigationPath.append(ScheduleEventRoute(id: event.id))
        } label: {
            EventRow(
                event: event,
                myShift: myShift,
                extraAreas: vm.extraShiftAreasByEventId[event.id] ?? [],
                contextDay: day
            )
        }
        .foregroundStyle(.primary)
        .listRowInsets(EdgeInsets(top: 11, leading: 32, bottom: 11, trailing: 32))
        .listRowSeparator(.hidden)
        .listRowBackground(EventRowBackground(isMine: myShift != nil, position: position))
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Posting a shift is the one thing people do from this list about
            // their own work, and it was three taps away through the Trade
            // Board's picker.
            if let candidate = postableCandidate(forEvent: event.id) {
                Button {
                    shiftToPost = candidate
                    Haptics.selection()
                } label: {
                    Label("Post trade", systemImage: "arrow.left.arrow.right")
                }
                .tint(Color.brandPrimary)
            }
        }
    }

    private var filteredEmptyTitle: String {
        if myShiftsOnly && activeFilterCount == 1 {
            return "No upcoming shifts"
        }
        return "No matching events"
    }

    private var filteredEmptyDescription: String {
        if myShiftsOnly && activeFilterCount == 1 {
            return "Your schedule will show up here when staff confirm."
        }
        return "Clear filters or try a broader event type or sport."
    }
}

/// One tap on the week strip. A fresh id each time, so tapping the same day
/// twice still scrolls back to it after the list has moved.
private struct ScheduleJumpRequest: Equatable {
    let id = UUID()
    let anchor: ScheduleRowAnchor
    var animated = true
}

/// One entry in the master list: a day with events, or a run of weeks with
/// none.
private enum ScheduleListSection: Identifiable {
    case day(date: Date, events: [ScheduleEvent])
    case emptyWeeks(start: Date, count: Int)

    enum ID: Hashable {
        case day(Date)
        case week(Date)

        var date: Date {
            switch self {
            case let .day(date), let .week(date): return date
            }
        }
    }

    var id: ID {
        switch self {
        case let .day(date, _): return .day(date)
        case let .emptyWeeks(start, _): return .week(start)
        }
    }

    /// The last day this section stands for: the day itself, or the end of
    /// the empty run.
    var lastDay: Date {
        switch self {
        case let .day(date, _):
            return date
        case let .emptyWeeks(start, count):
            return Calendar.current.date(byAdding: .day, value: 7 * count - 1, to: start) ?? start
        }
    }

    var isDay: Bool {
        if case .day = self { return true }
        return false
    }

    var firstAnchor: ScheduleRowAnchor {
        switch self {
        case let .day(date, events):
            return ScheduleRowAnchor(day: date, eventId: events.first?.id ?? "")
        case let .emptyWeeks(start, _):
            return ScheduleRowAnchor(day: start, eventId: "")
        }
    }
}

/// A row's scroll identity. Multi-day events repeat under each day they
/// cover, so the event id alone is not unique in the list. An empty week's
/// placeholder uses its week start and an empty event id.
private struct ScheduleRowAnchor: Hashable {
    let day: Date
    let eventId: String
}

// MARK: - Sport labels (mirrors src/lib/sports.ts)

/// The current sport codes, without the legacy ones kept only for labelling.
private let scheduleCurrentSportCodes = [
    "MBB", "MXC", "FB", "MGOLF", "MHKY", "MROW", "MSOC", "MSWIM", "MTEN", "MTRACK", "WRES",
    "WBB", "WXC", "WGOLF", "WHKY", "LROW", "WROW", "WSOC", "SB", "WSWIM", "WTEN", "WTRACK", "VB",
]

func scheduleSportLabel(_ code: String) -> String {
    let labels: [String: String] = [
        "MBB": "Men's Basketball", "MXC": "Men's Cross Country", "FB": "Football",
        "MGOLF": "Men's Golf", "MHKY": "Men's Hockey", "MROW": "Men's Rowing",
        "MSOC": "Men's Soccer", "MSWIM": "Men's Swimming & Diving", "MTEN": "Men's Tennis",
        "MTRACK": "Men's Track & Field", "WRES": "Wrestling",
        "WBB": "Women's Basketball", "WXC": "Women's Cross Country", "WGOLF": "Women's Golf",
        "WHKY": "Women's Hockey", "LROW": "Lightweight Rowing", "WROW": "Women's Rowing",
        "WSOC": "Women's Soccer", "SB": "Softball", "WSWIM": "Women's Swimming & Diving",
        "WTEN": "Women's Tennis", "WTRACK": "Women's Track & Field", "VB": "Volleyball",
        // Legacy codes
        "SWIM": "Swimming & Diving", "TF": "Track & Field", "XC": "Cross Country",
        "GOLF": "Golf", "ROW": "Rowing", "TEN": "Tennis", "GYM": "Gymnastics", "BASE": "Baseball",
    ]
    return labels[code] ?? code
}

#Preview {
    ScheduleView()
}
