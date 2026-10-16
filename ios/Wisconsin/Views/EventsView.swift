import SwiftUI

struct EventCatalogRoute: Hashable {
    let id: String
}

enum EventsListScope: String, CaseIterable, Identifiable {
    case upcoming
    case recent

    var id: String { rawValue }

    var label: String {
        switch self {
        case .upcoming: "Upcoming"
        case .recent: "Past 30 days"
        }
    }
}

private struct EventDaySection: Identifiable {
    let day: Date
    var events: [ScheduleEvent]
    var id: Date { day }
}

@MainActor
@Observable
final class EventsListModel {
    var events: [ScheduleEvent] = []
    var scope: EventsListScope = .upcoming
    var isLoading = false
    var error: String?
    var pageError: String?
    var hasMore = true

    private var offset = 0
    private let pageSize = 50
    private var seenIds = Set<String>()
    private var loads = LatestRequestGeneration()

    func setScope(_ scope: EventsListScope) {
        guard scope != self.scope else { return }
        self.scope = scope
        events = []
        offset = 0
        hasMore = true
        error = nil
        pageError = nil
        seenIds = []
        loads.invalidate()
    }

    func load(reset: Bool) async {
        if !reset, isLoading || !hasMore || error != nil {
            return
        }
        let token = loads.begin()
        let requestOffset = reset ? 0 : offset
        let requestScope = scope
        isLoading = true
        if reset {
            pageError = nil
            if events.isEmpty { error = nil }
        }
        defer {
            if loads.owns(token) { isLoading = false }
        }
        do {
            let response = try await APIClient.shared.calendarEventsPage(
                includePast: requestScope == .recent,
                window: requestScope == .recent ? eventCatalogRecentWindow() : nil,
                limit: pageSize,
                offset: requestOffset
            )
            guard loads.owns(token), scope == requestScope, !Task.isCancelled else { return }
            if reset {
                events = []
                seenIds = []
            }
            for event in response.data where seenIds.insert(event.id).inserted {
                events.append(event)
            }
            offset = requestOffset + response.data.count
            hasMore = !response.data.isEmpty && offset < response.total
            error = nil
            pageError = nil
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), scope == requestScope, !Task.isCancelled else { return }
            if reset && events.isEmpty {
                self.error = error.localizedDescription
                hasMore = false
            } else {
                pageError = error.localizedDescription
                hasMore = false
            }
        }
    }

    func retryPage() async {
        pageError = nil
        hasMore = true
        await load(reset: false)
    }
}

struct EventsView: View {
    var wrapsInNavigationStack = true

    @State private var navigationPath = NavigationPath()
    @State private var model = EventsListModel()
    @Environment(\.today) private var today
    @Environment(AppState.self) private var appState

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack(path: $navigationPath) {
                configuredContent
            }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        content
            .navigationTitle("Events")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("When", selection: scopeBinding) {
                            ForEach(EventsListScope.allCases) { scope in
                                Text(scope.label).tag(scope)
                            }
                        }
                    } label: {
                        Label(model.scope.label, systemImage: "line.3.horizontal.decrease")
                    }
                    .accessibilityLabel("When, \(model.scope.label)")
                }
            }
            .refreshable { await model.load(reset: true) }
            .task { await model.load(reset: true) }
            .navigationDestination(for: EventCatalogRoute.self) { route in
                EventCatalogDetailView(eventId: route.id)
            }
            .navigationDestination(for: BookingRouteId.self) { route in
                BookingDetailView(bookingId: route.id)
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 2 else { return }
                navigationPath = NavigationPath()
            }
    }

    private var scopeBinding: Binding<EventsListScope> {
        Binding(
            get: { model.scope },
            set: { scope in
                model.setScope(scope)
                Task { await model.load(reset: true) }
            }
        )
    }

    @ViewBuilder
    private var content: some View {
        if model.events.isEmpty, model.isLoading {
            ProgressView("Loading events")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.events.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load events", systemImage: "calendar.badge.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await model.load(reset: true) } }
            }
        } else if model.events.isEmpty {
            ContentUnavailableView {
                Label(model.scope == .upcoming ? "Nothing coming up" : "No recent events", systemImage: "calendar")
            } description: {
                Text(model.scope == .upcoming
                    ? "Events that are still ahead show up here."
                    : "The past 30 days didn't include an event.")
            }
        } else {
            List {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.events) { event in
                            NavigationLink(value: EventCatalogRoute(id: event.id)) {
                                EventCatalogRow(event: event)
                            }
                        }
                    } header: {
                        Text(section.day.operationalDayLabel(now: today))
                    }
                }
                if let pageError = model.pageError {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(pageError)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button("Try again") { Task { await model.retryPage() } }
                        }
                    }
                } else if model.hasMore {
                    Section {
                        ProgressView("Loading more events")
                            .frame(maxWidth: .infinity)
                            .task(id: model.events.count) { await model.load(reset: false) }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private var sections: [EventDaySection] {
        var built: [EventDaySection] = []
        for event in model.events {
            let day = event.displayStartDay
            if let index = built.lastIndex(where: { Calendar.current.isDate($0.day, inSameDayAs: day) }) {
                built[index].events.append(event)
            } else {
                built.append(EventDaySection(day: day, events: [event]))
            }
        }
        return built
    }
}

private struct EventCatalogRow: View {
    let event: ScheduleEvent
    @Environment(\.today) private var today

    private var isPast: Bool { event.timeState(now: today) == .past }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(scheduleEventDisplayTitle(event))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(isPast ? Color.secondary : Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let meta {
                    Text(meta)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(trailingTime)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var trailingTime: String {
        if event.timeState(now: today) == .live { return "Now" }
        if event.displayAllDay { return scheduleAllDayLabel(event) }
        return event.startsAt.gearTime
    }

    private var meta: String? {
        var parts: [String] = []
        if event.isMultiDay { parts.append("Through \(event.displayEndDay.formatted(.dateTime.month(.abbreviated).day()))") }
        switch event.venue {
        case .home: break
        case .away: parts.append("Away")
        case .neutral: parts.append("Neutral")
        case .nonGame: parts.append("Non-game")
        }
        if let venue = scheduleEventVenueName(event) { parts.append(venue) }
        if let coverage = event.coverage, coverage.total > 0 {
            parts.append("\(coverage.filled)/\(coverage.total) crew")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
