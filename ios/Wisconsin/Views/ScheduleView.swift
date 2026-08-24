import SwiftUI
import TipKit
import UIKit

// MARK: - View Mode

enum ScheduleViewMode: String, CaseIterable, Hashable {
    case list = "List"
    case calendar = "Calendar"
}

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

@MainActor
@Observable
final class ScheduleViewModel {
    var events: [ScheduleEvent] = [] {
        didSet { rebuildEventIndexes() }
    }
    var myShifts: [MyShift] = []
    var isLoading = false
    var error: String?
    var refreshError: String?
    /// When true, the load also pulls events whose end time is in the past —
    /// matches the "Past" toggle the web schedule's list view exposes.
    var includePast = false {
        didSet {
            guard includePast != oldValue else { return }
            rebuildEventIndexes()
        }
    }
    private var hasLoaded = false
    private var loadTask: Task<Void, Never>?
    private var loadRequests = LatestRequestGeneration()

    var shiftsByEventId: [String: MyShift] = [:]
    var lastLoadedAt: Date?

    var isStale: Bool {
        guard let t = lastLoadedAt else { return true }
        return Date.now.timeIntervalSince(t) > scheduleStaleAfter
    }

    /// Lower bound for expanding multi-day events: when "Past" is off we don't
    /// want a long-running event to spawn day groups before today.
    private var spanLowerBound: Date {
        includePast ? .distantPast : Calendar.current.startOfDay(for: .now)
    }

    private(set) var groupedEvents: [(date: Date, events: [ScheduleEvent])] = []
    private(set) var eventsByDay: [Date: [ScheduleEvent]] = [:]

    private func rebuildEventIndexes() {
        var byDay: [Date: [ScheduleEvent]] = [:]
        var allByDay: [Date: [ScheduleEvent]] = [:]
        let lowerBound = spanLowerBound
        for event in events {
            // A multi-day event appears under each calendar day it covers, so
            // it stays visible while it's still in progress.
            for day in event.spannedDays {
                allByDay[day, default: []].append(event)
                if day >= lowerBound {
                    byDay[day, default: []].append(event)
                }
            }
        }
        groupedEvents = byDay
            .sorted { $0.key < $1.key }
            .map { (date: $0.key, events: $0.value.sorted { $0.startsAt < $1.startsAt }) }
        // Calendar mode's day list reads from this index, so it needs the same
        // chronological order the list groups get. Without it the day rendered
        // in whatever order the API returned, which the leading time column
        // made obvious: 11:00 AM, 4:00 PM, 7:30 PM, then 5:50 PM.
        eventsByDay = allByDay.mapValues { $0.sorted { $0.startsAt < $1.startsAt } }
    }

    func load(forceRefresh: Bool = false) async {
        if forceRefresh {
            // A filter change must replace the in-flight query. Waiting for an
            // older request would let its query shape win and drop this reload.
            loadTask?.cancel()
        } else if isLoading {
            return
        }
        // Allow first load, explicit refresh, or staleness-driven refresh.
        guard !hasLoaded || forceRefresh || isStale else { return }
        let requestedIncludePast = includePast
        let requestToken = loadRequests.begin()
        let task = Task { @MainActor in
            await performLoad(includePast: requestedIncludePast, requestToken: requestToken)
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
        isLoading = false
    }

    private func performLoad(includePast requestedIncludePast: Bool, requestToken: UUID) async {
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
            async let eventsTask = APIClient.shared.calendarEvents(includePast: requestedIncludePast)
            async let shiftsTask = APIClient.shared.myShifts()
            let (fetchedEvents, fetchedShifts) = try await (eventsTask, shiftsTask)
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            events = fetchedEvents
            myShifts = fetchedShifts
            shiftsByEventId = Dictionary(uniqueKeysWithValues: fetchedShifts.map { ($0.event.id, $0) })
            hasLoaded = true
            lastLoadedAt = .now
            error = nil
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
}

// MARK: - HomeAwayFilter

enum HomeAwayFilter: String, CaseIterable {
    case all = "All"
    case home = "Home"
    case away = "Away"
    case neutral = "Neutral"
    case nonGame = "Non-game"
}

private func scheduleEventMatches(_ event: ScheduleEvent, filter: HomeAwayFilter) -> Bool {
    switch filter {
    case .all: return true
    case .home: return event.isHome == true
    case .away: return event.isHome == false
    case .neutral: return event.isHome == nil && event.opponent != nil
    case .nonGame: return event.isHome == nil && event.opponent == nil
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

private struct PublishedScheduleRoute: Hashable {
    let id: String
}

private struct CollaboratorPublishedScheduleView: View {
    private let pageSize = 50

    @State private var events: [PublishedScheduleEvent] = []
    @State private var total = 0
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var error: String?
    @State private var refreshError: String?
    @State private var pendingFollowId: String?
    @State private var routedEvents: [String: PublishedScheduleEvent] = [:]
    @State private var isRoutingEvent = false
    @State private var lastLoadedAt: Date?
    @State private var navigationPath = NavigationPath()
    @State private var toast: Toast?
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var canFollow: Bool {
        (session.currentUser?.capabilities ?? []).contains("SCHEDULE_FOLLOW")
    }

    private var groupedEvents: [(date: Date, events: [PublishedScheduleEvent])] {
        Dictionary(grouping: events) { publishedScheduleDay(for: $0.event) }
            .sorted { $0.key < $1.key }
            .map { date, events in
                (date: date, events: events.sorted { $0.event.startsAt < $1.event.startsAt })
            }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if isLoading && events.isEmpty {
                    publishedScheduleSkeleton
                } else if events.isEmpty, let error {
                    ContentUnavailableView {
                        Label("Couldn't load schedule", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await load(forceRefresh: true) } }
                            .buttonStyle(.borderedProminent)
                            .tint(Color.statusText(.purple))
                    }
                } else if events.isEmpty {
                    ContentUnavailableView(
                        "No upcoming events",
                        systemImage: "calendar",
                        description: Text("Events will appear here when crew assignments are ready.")
                    )
                } else {
                    publishedEventList
                }
            }
            .background(Color(.systemGroupedBackground))
            .overlay(alignment: .top) {
                if !events.isEmpty, let refreshError {
                    publishedScheduleRefreshBanner(message: refreshError)
                }
            }
            .toast($toast)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: refreshError)
            .navigationTitle("Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: PublishedScheduleRoute.self) { route in
                if let event = events.first(where: { $0.id == route.id }) ?? routedEvents[route.id] {
                    PublishedEventDetailView(
                        event: event,
                        canFollow: canFollow,
                        isUpdatingFollow: pendingFollowId == event.id,
                        onToggleFollow: { Task { await setFollowing(event) } }
                    )
                } else {
                    ContentUnavailableView(
                        "Event unavailable",
                        systemImage: "calendar.badge.exclamationmark",
                        description: Text("Return to Schedule and refresh to try again.")
                    )
                }
            }
            .task {
                await load()
                await routePendingEventIfNeeded()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await load() }
                }
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 4 else { return }
                navigationPath = NavigationPath()
            }
            .onChange(of: appState.pendingPushEventId) { _, _ in
                Task { await routePendingEventIfNeeded() }
            }
        }
    }

    private var publishedScheduleSkeleton: some View {
        List {
            ForEach(0..<5, id: \.self) { _ in
                PublishedEventRowSkeleton()
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var publishedEventList: some View {
        List {
            ForEach(groupedEvents, id: \.date) { group in
                Section {
                    ForEach(group.events) { item in
                        NavigationLink(value: PublishedScheduleRoute(id: item.id)) {
                            PublishedEventRow(event: item)
                        }
                        .buttonStyle(ScalePressStyle())
                        .contextMenu {
                            if canFollow {
                                Button {
                                    Task { await setFollowing(item) }
                                } label: {
                                    Label(
                                        item.isFollowing ? "Mute Event Updates" : "Follow Event",
                                        systemImage: item.isFollowing ? "bell.slash" : "bell"
                                    )
                                }
                                .disabled(pendingFollowId != nil)
                            }
                        }
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                    }
                } header: {
                    ScheduleDateHeader(date: group.date, eventCount: group.events.count)
                        .listRowInsets(EdgeInsets())
                }
                .listSectionSeparator(.hidden)
            }

            if events.count < total {
                HStack {
                    Spacer()
                    ProgressView("Loading more events")
                        .font(.caption)
                        .task { await loadMore() }
                    Spacer()
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .listSectionSpacing(.compact)
        .scrollContentBackground(.hidden)
        .contentMargins(.bottom, 96, for: .scrollContent)
        .refreshable { await load(forceRefresh: true) }
    }

    private func publishedScheduleRefreshBanner(message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
                .accessibilityHidden(true)
            Text(message)
                .font(.footnote)
                .lineLimit(2)
            Spacer(minLength: 8)
            Button("Retry") { Task { await load(forceRefresh: true) } }
                .font(.footnote.weight(.semibold))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .shadow(color: Color.primary.opacity(0.08), radius: 8, y: 2)
        .accessibilityElement(children: .combine)
    }

    private func load(forceRefresh: Bool = false) async {
        guard !isLoading, !isLoadingMore else { return }
        let isStale = lastLoadedAt.map { Date.now.timeIntervalSince($0) > scheduleStaleAfter } ?? true
        guard forceRefresh || events.isEmpty || isStale else { return }
        isLoading = true
        if events.isEmpty { error = nil }
        refreshError = nil
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.publishedSchedule(limit: pageSize)
            events = response.data
            total = response.total
            lastLoadedAt = .now
            error = nil
        } catch APIError.unauthorized {
            return
        } catch {
            if events.isEmpty {
                self.error = error.localizedDescription
            } else {
                refreshError = error.localizedDescription
            }
        }
    }

    private func loadMore() async {
        guard !isLoading, !isLoadingMore, events.count < total else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let response = try await APIClient.shared.publishedSchedule(limit: pageSize, offset: events.count)
            let existingIds = Set(events.map(\.id))
            events.append(contentsOf: response.data.filter { !existingIds.contains($0.id) })
            total = response.total
        } catch APIError.unauthorized {
            return
        } catch {
            refreshError = error.localizedDescription
        }
    }

    private func setFollowing(_ event: PublishedScheduleEvent) async {
        guard pendingFollowId == nil else { return }
        pendingFollowId = event.id
        defer { pendingFollowId = nil }
        do {
            let requestedState = !event.isFollowing
            let serverState = try await APIClient.shared.setPublishedScheduleFollow(
                eventId: event.id,
                following: requestedState
            )
            if let index = events.firstIndex(where: { $0.id == event.id }) {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                    events[index].isFollowing = serverState
                }
            }
            if routedEvents[event.id] != nil {
                routedEvents[event.id]?.isFollowing = serverState
            }
            toast = Toast(
                message: serverState ? "Following \(event.event.summary)" : "Muted updates for \(event.event.summary)",
                icon: serverState ? "bell.fill" : "bell.slash.fill",
                role: .success
            )
        } catch {
            toast = Toast(
                message: "Couldn't update notifications for \(event.event.summary). Try again.",
                icon: "exclamationmark.triangle.fill",
                role: .error
            )
        }
    }

    private func routePendingEventIfNeeded() async {
        guard !isRoutingEvent, let eventId = appState.pendingPushEventId else { return }
        isRoutingEvent = true
        defer { isRoutingEvent = false }

        if events.contains(where: { $0.id == eventId }) {
            appState.pendingPushEventId = nil
            navigationPath.append(PublishedScheduleRoute(id: eventId))
            return
        }

        do {
            routedEvents[eventId] = try await APIClient.shared.publishedScheduleEvent(eventId: eventId)
            appState.pendingPushEventId = nil
            navigationPath.append(PublishedScheduleRoute(id: eventId))
        } catch APIError.unauthorized {
            return
        } catch {
            appState.pendingPushEventId = nil
            toast = Toast(
                message: "This event is no longer available.",
                icon: "calendar.badge.exclamationmark",
                role: .error
            )
        }
    }
}

private struct PublishedEventRow: View {
    let event: PublishedScheduleEvent

    var body: some View {
        HStack(spacing: 12) {
            StatusRail(color: publishedEventRailColor(event.event))

            VStack(alignment: .leading, spacing: 5) {
                Text(event.event.summary)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Text("\(publishedEventType(event.event)) · \(publishedEventTime(event.event))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                if let venue = event.event.venue?.name {
                    Label(venue, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    PublishedCrewAvatarStack(crew: event.crew)
                    Text(event.crew.isEmpty ? "No scheduled crew" : publishedCrewCount(event.crew.count))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if event.isFollowing {
                Image(systemName: "bell.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.statusText(.purple))
                    .frame(width: 30, height: 30)
                    .background(Color.statusBackground(.purple), in: Circle())
                    .accessibilityHidden(true)
            }

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 0.5)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [event.event.summary, publishedEventType(event.event), publishedEventTime(event.event)]
        if let venue = event.event.venue?.name { parts.append(venue) }
        parts.append(event.crew.isEmpty ? "No scheduled crew" : publishedCrewCount(event.crew.count))
        if event.isFollowing { parts.append("Following event updates") }
        return parts.joined(separator: ", ")
    }
}

private struct PublishedCrewAvatarStack: View {
    let crew: [PublishedCrewMember]

    var body: some View {
        HStack(spacing: -7) {
            ForEach(Array(crew.prefix(3))) { member in
                PublishedCrewAvatar(person: member.person, size: 24)
                    .overlay(Circle().strokeBorder(Color.cardSurface, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}

private struct PublishedCrewAvatar: View {
    let person: PublishedCrewPerson
    let size: CGFloat

    var body: some View {
        AsyncImage(url: person.avatarUrl.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Circle()
                .fill(Color.cardSurfaceRaised)
                .overlay(
                    Text(String(person.name.prefix(1)))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                )
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

private struct PublishedEventDetailView: View {
    let event: PublishedScheduleEvent
    let canFollow: Bool
    let isUpdatingFollow: Bool
    let onToggleFollow: () -> Void

    private var crewByArea: [(area: String, crew: [PublishedCrewMember])] {
        Dictionary(grouping: event.crew, by: \.area)
            .sorted { publishedAreaOrder($0.key) < publishedAreaOrder($1.key) }
            .map { (area: $0.key, crew: $0.value.sorted { ($0.callStartsAt ?? $0.startsAt) < ($1.callStartsAt ?? $1.startsAt) }) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                eventHero
                if canFollow {
                    followCard
                }
                crewCard
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var eventHero: some View {
        HStack(alignment: .top, spacing: 14) {
            StatusRail(color: publishedEventRailColor(event.event))

            VStack(alignment: .leading, spacing: 8) {
                Text(event.event.summary)
                    .font(.title2.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)

                if let subtitle = event.event.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Label(publishedEventDate(event.event), systemImage: "calendar")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)

                Label(publishedEventTime(event.event), systemImage: "clock")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)

                if let venue = event.event.venue?.name {
                    Label(venue, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Text(publishedEventContext(event.event))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(publishedEventRailColor(event.event))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
    }

    private var followCard: some View {
        HStack(spacing: 12) {
            Image(systemName: event.isFollowing ? "bell.fill" : "bell")
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.statusText(.purple))
                .frame(width: 40, height: 40)
                .background(Color.statusBackground(.purple), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.isFollowing ? "Following event updates" : "Event updates are off")
                    .font(.subheadline.weight(.semibold))
                Text(event.isFollowing ? "Crew changes will appear in Notifications." : "Follow this event to receive crew changes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(event.isFollowing ? "Mute" : "Follow") {
                onToggleFollow()
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.statusText(.purple))
            .disabled(isUpdatingFollow)
        }
        .padding(14)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var crewCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Crew")
                    .font(.title3.weight(.bold))
                Spacer()
                Text("\(event.crew.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if crewByArea.isEmpty {
                ContentUnavailableView(
                    "No scheduled crew",
                    systemImage: "person.2",
                    description: Text("This event has no crew assignments yet.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                ForEach(crewByArea, id: \.area) { group in
                    VStack(alignment: .leading, spacing: 0) {
                        CrewAreaHeading(area: group.area)
                            .padding(.bottom, 6)

                        ForEach(group.crew) { member in
                            if member.id != group.crew.first?.id { Divider().padding(.leading, 50) }
                            PublishedCrewRow(member: member)
                        }
                    }
                }
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 0.5)
        )
    }
}

private struct PublishedCrewRow: View {
    let member: PublishedCrewMember

    var body: some View {
        HStack(spacing: 12) {
            PublishedCrewAvatar(person: member.person, size: 38)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(member.person.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)

                Text(publishedCrewRole(member.role))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if publishedCrewRole(member.role) == "Student", let callWindow = publishedCallWindow(member) {
                    Text("Call \(callWindow)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(publishedCrewAccessibilityLabel(member))
    }
}

private struct PublishedEventRowSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.cardSurfaceRaised)
                .frame(width: 4, height: 76)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 5).fill(Color.cardSurfaceRaised).frame(width: 210, height: 18)
                RoundedRectangle(cornerRadius: 5).fill(Color.cardSurfaceRaised).frame(width: 160, height: 13)
                RoundedRectangle(cornerRadius: 5).fill(Color.cardSurfaceRaised).frame(width: 120, height: 13)
            }
            Spacer()
        }
        .padding(14)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .redacted(reason: .placeholder)
    }
}

private func publishedScheduleDay(for event: PublishedEventSummary) -> Date {
    if event.allDay {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        let components = utc.dateComponents([.year, .month, .day], from: event.startsAt)
        return Calendar.current.date(from: components) ?? Calendar.current.startOfDay(for: event.startsAt)
    }
    return Calendar.current.startOfDay(for: event.startsAt)
}

private func publishedEventType(_ event: PublishedEventSummary) -> String {
    switch event.isHome {
    case true: "Home"
    case false: "Away"
    case nil: event.opponent == nil ? "Non-game" : "Neutral"
    }
}

private func publishedEventContext(_ event: PublishedEventSummary) -> String {
    let sport = event.sportCode.map(scheduleSportLabel)
    return [sport, publishedEventType(event)].compactMap { $0 }.joined(separator: " · ")
}

private func publishedEventTime(_ event: PublishedEventSummary) -> String {
    guard !event.allDay else { return "All day" }
    let start = event.startsAt.formatted(date: .omitted, time: .shortened)
    let end = event.endsAt.formatted(date: .omitted, time: .shortened)
    return "\(start) – \(end)"
}

private func publishedEventDate(_ event: PublishedEventSummary) -> String {
    let date = publishedScheduleDay(for: event)
    let calendar = Calendar.current
    if calendar.isDateInToday(date) { return "Today, \(date.formatted(.dateTime.month(.abbreviated).day()))" }
    if calendar.isDateInTomorrow(date) { return "Tomorrow, \(date.formatted(.dateTime.month(.abbreviated).day()))" }
    let year = calendar.component(.year, from: date)
    let currentYear = calendar.component(.year, from: .now)
    return year == currentYear
        ? date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        : date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day().year())
}

private func publishedEventRailColor(_ event: PublishedEventSummary) -> Color {
    venueRailColor(isHome: event.isHome)
}

private func publishedCrewCount(_ count: Int) -> String {
    count == 1 ? "1 crew member" : "\(count) crew members"
}

private func publishedCrewRole(_ role: String) -> String {
    // Staff/Student wording comes from the shared crew vocabulary so published
    // crew reads the same as every other crew surface.
    let shared = crewWorkerTypeLabel(role)
    guard shared == role else { return shared }
    return role.replacingOccurrences(of: "_", with: " ").capitalized
}

/// Nil for an all-day event: the server sends no call window because there is
/// no call time to state, and the row drops the line rather than inventing one.
private func publishedCallWindow(_ member: PublishedCrewMember) -> String? {
    guard let callStartsAt = member.callStartsAt, let callEndsAt = member.callEndsAt else { return nil }
    let start = callStartsAt.formatted(date: .omitted, time: .shortened)
    let end = callEndsAt.formatted(date: .omitted, time: .shortened)
    return "\(start) – \(end)"
}

private func publishedCrewAccessibilityLabel(_ member: PublishedCrewMember) -> String {
    let role = publishedCrewRole(member.role)
    guard role == "Student" else {
        return "\(member.person.name), Staff, \(member.area.shiftAreaLabel)"
    }
    guard let callWindow = publishedCallWindow(member) else {
        return "\(member.person.name), Student, \(member.area.shiftAreaLabel)"
    }
    return "\(member.person.name), Student, \(member.area.shiftAreaLabel), call \(callWindow)"
}

private func publishedAreaOrder(_ area: String) -> Int {
    switch area {
    case "VIDEO": 0
    case "PHOTO": 1
    case "GRAPHICS": 2
    case "SOCIAL": 3
    case "COMMS": 4
    default: 5
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
    @State private var viewMode: ScheduleViewMode = .list
    @State private var calendarSelectedDate: Date = .now
    @State private var showTradeBoard = false
    @State private var shiftToPost: TradePostCandidate?
    @State private var showAvailability = false
    @State private var showFilters = false
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
        viewMode = .list
    }

    private var canSeePastEvents: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var showsCrewCoverage: Bool {
        canSeePastEvents
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

    /// Distinct sport codes present in the loaded events, ordered by display
    /// name — drives the sport filter chips (only shown when 2+ sports appear).
    private var availableSportCodes: [String] {
        let codes = Set(vm.events.compactMap { $0.sportCode })
        return codes.sorted { scheduleSportLabel($0) < scheduleSportLabel($1) }
    }

    private var activeFilterCount: Int {
        var count = 0
        if myShiftsOnly { count += 1 }
        if canSeePastEvents && vm.includePast { count += 1 }
        if homeAwayFilter != .all { count += 1 }
        if sportFilter != nil { count += 1 }
        return count
    }

    private var activeFilterSummary: String {
        var parts: [String] = []
        if myShiftsOnly { parts.append("My shifts") }
        if homeAwayFilter != .all { parts.append(homeAwayFilter.rawValue) }
        if let sportFilter { parts.append(scheduleSportLabel(sportFilter)) }
        if canSeePastEvents && vm.includePast { parts.append("Past") }
        return parts.isEmpty ? "All upcoming events" : parts.joined(separator: " · ")
    }

    var body: some View {
        let groups = displayedGroups
        let matchingEventCount = Set(groups.flatMap { $0.events.map(\.id) }).count
        NavigationStack(path: $navigationPath) {
            Group {
                if vm.isLoading && vm.events.isEmpty {
                    List {
                        ForEach(0..<6, id: \.self) { _ in
                            EventRowSkeleton()
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                                .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color(.systemGroupedBackground))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                } else if vm.events.isEmpty, let err = vm.error {
                    // Only blank the screen when we have nothing to show.
                    ContentUnavailableView {
                        Label("Couldn't load schedule", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(err)
                    } actions: {
                        Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if vm.events.isEmpty {
                    ContentUnavailableView(
                        "No upcoming events",
                        systemImage: "calendar",
                        description: Text("Check back later for new events.")
                    )
                } else {
                    VStack(spacing: 0) {
                        scheduleControlStrip

                        switch viewMode {
                        case .list:
                            eventList(groups: groups)
                        case .calendar:
                            ScheduleCalendarView(
                                selectedDate: $calendarSelectedDate,
                                eventsByDay: vm.eventsByDay,
                                myShiftsOnly: myShiftsOnly,
                                homeAwayFilter: homeAwayFilter,
                                sportFilter: sportFilter,
                                shiftsByEventId: vm.shiftsByEventId,
                                showsCrewCoverage: showsCrewCoverage,
                                onSelectEvent: { navigationPath.append(ScheduleEventRoute(id: $0.id)) }
                            )
                        }
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
                // Filters is a list control, so it rides the toolbar with the
                // same tint contract Items and Users use: secondary at rest,
                // primary while it is changing what the list shows.
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showFilters = true
                    } label: {
                        Label(
                            "Filters",
                            systemImage: activeFilterCount > 0
                                ? "line.3.horizontal.decrease.circle.fill"
                                : "line.3.horizontal.decrease.circle"
                        )
                    }
                    .listControlTint(isActive: activeFilterCount > 0)
                    .accessibilityLabel(activeFilterCount > 0
                        ? "Filters, \(activeFilterCount) active"
                        : "Filters")
                    .sensoryFeedback(.selection, trigger: activeFilterCount)
                }

                // A control and two actions are different kinds of thing, so
                // they get different glass groups rather than one long capsule.
                ToolbarSpacer(.fixed, placement: .topBarTrailing)

                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        scheduleOpenWorkTip.invalidate(reason: .actionPerformed)
                        showTradeBoard = true
                    } label: {
                        // No count badge: the iOS 26 toolbar clips item content
                        // to its glass capsule, which sliced the old overlay
                        // into an orange half-disc with the number cut off. The
                        // filled variant carries "there is open work" instead,
                        // the way Items' star does, and the exact number stays
                        // in the accessibility label and on the board itself.
                        Label(
                            "Trade Board",
                            systemImage: appState.openTradeCount > 0
                                ? "arrow.left.arrow.right.circle.fill"
                                : "arrow.left.arrow.right.circle"
                        )
                        .popoverTip(scheduleOpenWorkTip, arrowEdge: .top)
                    }
                    .tint(Color.primary)
                    .sensoryFeedback(.selection, trigger: showTradeBoard)
                    .accessibilityLabel(appState.openTradeCount > 0
                        ? "Trade Board, \(appState.openTradeCount) open"
                        : "Trade Board")

                    Menu {
                        if canManageAvailability {
                            Button {
                                showAvailability = true
                            } label: {
                                Label("My Availability", systemImage: "calendar.badge.clock")
                            }
                        }

                        Button {
                            shiftCalendarTip.invalidate(reason: .actionPerformed)
                            showCalendarSetup = true
                        } label: {
                            Label("Shift Calendar", systemImage: "calendar.badge.plus")
                        }
                    } label: {
                        Label("More", systemImage: "ellipsis")
                            .popoverTip(shiftCalendarTip, arrowEdge: .top)
                    }
                    .tint(Color.primary)
                    .accessibilityLabel("More Schedule actions")
                }
            }
            .task {
                if !canSeePastEvents {
                    vm.includePast = false
                }
                consumePendingMyShifts()
                await vm.load()
            }
            .onDisappear { vm.cancelLoad() }
            .refreshable { await vm.load(forceRefresh: true) }
            .onChange(of: session.currentUser?.id) { _, userId in
                if userId == nil {
                    vm.cancelLoad()
                }
            }
            .onChange(of: canSeePastEvents) { _, canSee in
                if !canSee, vm.includePast {
                    vm.includePast = false
                    Task { await vm.load(forceRefresh: true) }
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
                viewMode = .list
                calendarSelectedDate = .now
                showFilters = false
                showTradeBoard = false
                showAvailability = false
                showCalendarSetup = false
                if vm.includePast {
                    vm.includePast = false
                    Task { await vm.load(forceRefresh: true) }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await vm.load() }
                }
            }
            .onChange(of: appState.pendingPushEventId) { _, eventId in
                guard let eventId else { return }
                appState.pendingPushEventId = nil
                if let event = vm.events.first(where: { $0.id == eventId }) {
                    navigationPath.append(ScheduleEventRoute(id: event.id))
                } else {
                    // Events not loaded yet — force a load then open once ready.
                    Task {
                        await vm.load(forceRefresh: true)
                        if let event = vm.events.first(where: { $0.id == eventId }) {
                            navigationPath.append(ScheduleEventRoute(id: event.id))
                        }
                    }
                }
            }
            .navigationDestination(for: ScheduleEventRoute.self) { route in
                if let event = vm.events.first(where: { $0.id == route.id }) {
                    EventDetailView(
                        event: event,
                        myShift: vm.shiftsByEventId[event.id]
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
            .sheet(isPresented: $showFilters) {
                ScheduleFilterSheet(
                    myShiftsOnly: $myShiftsOnly,
                    homeAwayFilter: $homeAwayFilter,
                    sportFilter: $sportFilter,
                    includePast: vm.includePast,
                    canSeePastEvents: canSeePastEvents,
                    availableSportCodes: availableSportCodes,
                    activeFilterCount: activeFilterCount,
                    matchingEventCount: matchingEventCount,
                    onTogglePast: togglePastEvents,
                    onClear: clearScheduleFilters
                )
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
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

    /// Your own future, still-active shift on this event, if you have one. A
    /// started or already-ended shift cannot be traded and the server says so
    /// too, so the action simply is not offered.
    private func postableCandidate(forEvent eventId: String) -> TradePostCandidate? {
        guard let shift = vm.shiftsByEventId[eventId],
              shift.statusValue == .active,
              shift.startsAt > Date() else { return nil }
        return TradePostCandidate(shift: shift)
    }

    private func togglePastEvents() {
        vm.includePast.toggle()
        Task { await vm.load(forceRefresh: true) }
    }

    private func clearScheduleFilters() {
        let shouldReload = vm.includePast
        myShiftsOnly = false
        homeAwayFilter = .all
        sportFilter = nil
        if shouldReload {
            vm.includePast = false
            Task { await vm.load(forceRefresh: true) }
        }
    }

    private var scheduleControlStrip: some View {
        VStack(alignment: .leading, spacing: 4) {
            // The segmented control is self-explanatory (List / Calendar), so it
            // carries no "View" label, matching Apple's own switchers. Filters
            // moved to the toolbar with the other list controls, which leaves
            // the switcher the full width instead of a shared row.
            Picker("Schedule view", selection: $viewMode) {
                ForEach(ScheduleViewMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Schedule view")

            // The summary only earns a row once something is actually filtered.
            // In the default state it restated "everything" and cost a full row.
            // It carries Clear so undoing a filter does not require reopening
            // the sheet that set it.
            if activeFilterCount > 0 {
                ActiveControlBar(summary: activeFilterSummary, clear: clearScheduleFilters)
            }
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.top, Brand.Space.sm)
        .padding(.bottom, Brand.Space.xs)
        .background(Color(.systemGroupedBackground))
        .sensoryFeedback(.selection, trigger: viewMode)
    }

    @ViewBuilder
    private func eventList(groups: [(date: Date, events: [ScheduleEvent])]) -> some View {
        if groups.isEmpty {
            ContentUnavailableView {
                Label(filteredEmptyTitle, systemImage: "calendar")
            } description: {
                Text(filteredEmptyDescription)
            } actions: {
                if activeFilterCount > 0 {
                    Button("Clear Filters") { clearScheduleFilters() }
                        .buttonStyle(.borderedProminent)
                }
            }
        } else {
            List {
                ForEach(groups, id: \.date) { group in
                    Section {
                        ForEach(group.events) { event in
                            // A Button (not NavigationLink) so the row keeps its own
                            // in-card chevron instead of also getting List's system
                            // disclosure indicator outside the card. Matches the
                            // calendar-mode day list below.
                            Button {
                                navigationPath.append(ScheduleEventRoute(id: event.id))
                            } label: {
                                EventRow(
                                    event: event,
                                    myShift: vm.shiftsByEventId[event.id],
                                    contextDay: group.date,
                                    showsCrewCoverage: showsCrewCoverage
                                )
                            }
                            .buttonStyle(ScalePressStyle())
                            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                // Posting a shift is the one thing people do from
                                // this list about their own work, and it was three
                                // taps away through the Trade Board's picker.
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
                    } header: {
                        ScheduleDateHeader(date: group.date, eventCount: group.events.count)
                            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    }
                    .listSectionSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .listSectionSpacing(8)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .contentMargins(.bottom, 96, for: .scrollContent)
            .background(Color(.systemGroupedBackground))
        }
    }

    private var filteredEmptyTitle: String {
        if myShiftsOnly && activeFilterCount == 1 {
            return "No shifts assigned to you"
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

// MARK: - Filter Sheet

private struct ScheduleFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var myShiftsOnly: Bool
    @Binding var homeAwayFilter: HomeAwayFilter
    @Binding var sportFilter: String?
    let includePast: Bool
    let canSeePastEvents: Bool
    let availableSportCodes: [String]
    let activeFilterCount: Int
    let matchingEventCount: Int
    let onTogglePast: () -> Void
    let onClear: () -> Void

    private static let allSports = "__all_sports__"

    private var sportSelection: Binding<String> {
        Binding {
            sportFilter ?? Self.allSports
        } set: { newValue in
            sportFilter = newValue == Self.allSports ? nil : newValue
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    resultCard
                    scopeCard
                    eventTypeCard
                    if availableSportCodes.count > 1 {
                        sportCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Filter Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // Shown only when there is something to clear. As a
                    // permanently-present disabled control it read as a broken
                    // button crowding the sheet's top-left corner.
                    if activeFilterCount > 0 {
                        Button("Clear") { onClear() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    dismiss()
                } label: {
                    Text(showResultsTitle)
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.purple))
                .controlSize(.large)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
        }
    }

    private var resultCard: some View {
        HStack(spacing: 12) {
            Image(systemName: activeFilterCount == 0 ? "calendar" : "line.3.horizontal.decrease.circle.fill")
                .font(.title3)
                .foregroundStyle(Color.statusText(.purple))
                .frame(width: 40, height: 40)
                .background(Color.statusBackground(.purple), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(matchingEventCount == 1 ? "1 matching event" : "\(matchingEventCount) matching events")
                    .font(.headline)
                Text(activeFilterSummaryLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var scopeCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Scope")
                .font(.headline)
                .padding(.bottom, 6)

            Toggle(isOn: $myShiftsOnly) {
                Label("Only my shifts", systemImage: myShiftsOnly ? "person.fill" : "person")
                    .foregroundStyle(.primary)
            }
            .tint(Color.statusText(.purple))
            .frame(minHeight: 44)

            if canSeePastEvents {
                Divider()
                Toggle(isOn: Binding(get: { includePast }, set: { _ in onTogglePast() })) {
                    Label("Include past events", systemImage: includePast ? "clock.arrow.circlepath" : "clock")
                        .foregroundStyle(.primary)
                }
                .tint(Color.statusText(.purple))
                .frame(minHeight: 44)
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var eventTypeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Event Type")
                .font(.headline)

            // "All" is the reset, so it spans the row and the four real venue
            // types sit in a balanced 2x2 below. A single 5-item adaptive grid
            // left a ragged half-empty last row.
            eventTypeButton(.all)

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(HomeAwayFilter.allCases.filter { $0 != .all }, id: \.self) { filter in
                    eventTypeButton(filter)
                }
            }
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    /// One shape, drawn once. The previous version stacked `.bordered`'s own
    /// capsule under a second `.background` at a different corner radius, which
    /// is what made the borders read as misaligned. Unselected keeps a defined
    /// surface and hairline so it reads tappable instead of disabled.
    private func eventTypeButton(_ filter: HomeAwayFilter) -> some View {
        let isOn = homeAwayFilter == filter
        let shape = RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
        return Button {
            homeAwayFilter = filter
            Haptics.selection()
        } label: {
            Text(filter.rawValue)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isOn ? Color.statusText(.purple) : Color.primary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(shape.fill(isOn ? Color.statusBackground(.purple) : Color(.secondarySystemBackground)))
                .overlay(shape.strokeBorder(
                    isOn ? Color.statusText(.purple).opacity(0.35) : Color.primary.opacity(0.12),
                    lineWidth: 1
                ))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private var sportCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sport")
                .font(.headline)

            Picker("Sport", selection: sportSelection) {
                Text("All Sports").tag(Self.allSports)
                ForEach(availableSportCodes, id: \.self) { code in
                    Text(scheduleSportLabel(code)).tag(code)
                }
            }
            .pickerStyle(.menu)
            .tint(Color.statusText(.purple))
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var showResultsTitle: String {
        matchingEventCount == 1 ? "Show 1 Event" : "Show \(matchingEventCount) Events"
    }

    private var activeFilterSummaryLine: String {
        switch activeFilterCount {
        case 0:  return "All upcoming events"
        case 1:  return "1 active filter"
        default: return "\(activeFilterCount) active filters"
        }
    }
}

// MARK: - Calendar Subscription

private struct ScheduleCalendarSubscriptionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("scheduleCalendarLastOpenedAt") private var lastOpenedAt = 0.0
    @State private var token: String?
    @State private var isLoading = true
    @State private var isOpening = false
    @State private var isResetting = false
    @State private var error: String?
    @State private var resetComplete = false
    @State private var showResetConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statusCard
                    explanationCard
                    if token != nil {
                        securityCard
                    }
                    if let error {
                        calendarErrorCard(message: error)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Shift Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isOpening || isResetting)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await openCalendar() }
                } label: {
                    HStack(spacing: 8) {
                        if isOpening {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: token == nil ? "calendar.badge.plus" : "arrow.up.forward.app")
                        }
                        Text(token == nil ? "Set Up in Apple Calendar" : "Open Apple Calendar")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.purple))
                .controlSize(.large)
                .disabled(isLoading || isOpening || isResetting || error != nil)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .task { await loadStatus() }
            .confirmationDialog(
                "Reset private calendar link?",
                isPresented: $showResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset Link", role: .destructive) {
                    Task { await resetLink() }
                }
                Button("Keep Current Link", role: .cancel) {}
            } message: {
                Text("Existing calendar subscriptions will stop updating. You'll need to subscribe again with the new link.")
            }
            .interactiveDismissDisabled(isOpening || isResetting)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var statusCard: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: token == nil ? "calendar.badge.plus" : "calendar.badge.checkmark")
                .font(.title2)
                .foregroundStyle(Color.statusText(token == nil ? .purple : .green))
                .frame(width: 46, height: 46)
                .background(Color.statusBackground(token == nil ? .purple : .green), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                if isLoading {
                    Text("Checking your calendar feed")
                        .font(.headline)
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text(token == nil ? "Ready to set up" : "Private feed ready")
                        .font(.headline)
                    Text(statusDetail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if resetComplete {
                        Text("Link reset. Subscribe again to keep receiving updates.")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.statusText(.purple))
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var explanationCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("How it works", systemImage: "arrow.triangle.2.circlepath")
                .font(.headline)
                .foregroundStyle(.primary)

            calendarExplanationRow("Gear Tracker updates the feed when your assignment or call time changes.")
            calendarExplanationRow("Apple Calendar controls when subscribed calendars refresh.")
            calendarExplanationRow("Editing a calendar event does not change your official Schedule assignment.")
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var securityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Private Feed Link")
                .font(.headline)
            Text("Treat this link like a password. Reset it if it was shared or if an old calendar should stop receiving updates.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Reset Private Link", role: .destructive) {
                showResetConfirmation = true
            }
            .disabled(isResetting || isOpening)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private func calendarExplanationRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Color.statusText(.purple))
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func calendarErrorCard(message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
            VStack(alignment: .leading, spacing: 4) {
                Text("Couldn't update calendar")
                    .font(.subheadline.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Retry") { Task { await loadStatus() } }
                .font(.caption.weight(.semibold))
                .disabled(isLoading || isOpening || isResetting)
        }
        .padding(14)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
    }

    private var statusDetail: String {
        guard lastOpenedAt > 0 else {
            return token == nil ? "Create a private feed and hand it to Apple Calendar." : "Open Apple Calendar to subscribe with this feed."
        }
        let date = Date(timeIntervalSince1970: lastOpenedAt)
        return "Apple Calendar last opened \(date.formatted(.relative(presentation: .named)))."
    }

    private func loadStatus() async {
        guard !isOpening, !isResetting else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            token = try await APIClient.shared.icsToken()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openCalendar() async {
        guard !isOpening, !isResetting else { return }
        isOpening = true
        error = nil
        defer { isOpening = false }
        do {
            let activeToken: String
            if let token {
                activeToken = token
            } else {
                activeToken = try await APIClient.shared.generateICSToken()
                token = activeToken
            }
            guard let url = AppEnvironment.webcalURL(path: "/api/shifts/ics/\(activeToken)") else {
                error = "The calendar link couldn't be created."
                return
            }
            guard await UIApplication.shared.open(url) else {
                error = "Apple Calendar couldn't open. Try again from this screen."
                return
            }
            lastOpenedAt = Date.now.timeIntervalSince1970
            resetComplete = false
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }

    private func resetLink() async {
        guard !isResetting, !isOpening else { return }
        isResetting = true
        error = nil
        defer { isResetting = false }
        do {
            token = try await APIClient.shared.generateICSToken()
            lastOpenedAt = 0
            resetComplete = true
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }
}

// MARK: - Calendar View

struct ScheduleCalendarView: View {
    @Binding var selectedDate: Date
    let eventsByDay: [Date: [ScheduleEvent]]
    let myShiftsOnly: Bool
    let homeAwayFilter: HomeAwayFilter
    var sportFilter: String?
    let shiftsByEventId: [String: MyShift]
    let showsCrewCoverage: Bool
    let onSelectEvent: (ScheduleEvent) -> Void

    @State private var displayedMonth: Date = {
        let c = Calendar.current
        return c.date(from: c.dateComponents([.year, .month], from: .now)) ?? .now
    }()

    private let calendar = Calendar.current
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
    private let weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"]

    private var selectedDayEvents: [ScheduleEvent] {
        filteredEvents(on: selectedDate)
    }

    private func filteredEvents(on date: Date) -> [ScheduleEvent] {
        let day = calendar.startOfDay(for: date)
        var all = eventsByDay[day] ?? []
        if myShiftsOnly { all = all.filter { shiftsByEventId[$0.id] != nil } }
        all = all.filter { scheduleEventMatches($0, filter: homeAwayFilter) }
        if let sportFilter { all = all.filter { $0.sportCode == sportFilter } }
        return all
    }

    var body: some View {
        VStack(spacing: 0) {
            monthHeader
                .padding(.horizontal)
                .padding(.vertical, 2)

            HStack(spacing: 0) {
                // Use a single weekday letter but disambiguated by position via accessibility.
                ForEach(Array(weekdayLabels.enumerated()), id: \.offset) { idx, label in
                    Text(label)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(weekdayFullNames[idx])
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 2)

            LazyVGrid(columns: columns, spacing: 1) {
                ForEach(Array(daysInMonth().enumerated()), id: \.offset) { _, day in
                    if let day {
                        let visibleEvents = filteredEvents(on: day)
                        let dots = dotInfo(for: day)
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                selectedDate = day
                                // Also follow selection across months.
                                displayedMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: day)) ?? displayedMonth
                            }
                        } label: {
                            DayCell(
                                date: day,
                                isToday: calendar.isDateInToday(day),
                                isSelected: calendar.isDate(day, inSameDayAs: selectedDate),
                                dots: dots,
                                eventCount: visibleEvents.count
                            )
                        }
                        .buttonStyle(.plain)
                    } else {
                        Color.clear.frame(height: 36)
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 4)
            .gesture(
                DragGesture(minimumDistance: 24)
                    .onEnded { value in
                        let dx = value.translation.width
                        guard abs(dx) > 50 else { return }
                        changeMonth(by: dx > 0 ? -1 : 1)
                    }
            )

            dotLegend
                .padding(.horizontal, 16)
                .padding(.bottom, 4)

            Divider()

            dayEventList
        }
    }

    private var weekdayFullNames: [String] {
        ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    }

    private var dotLegend: some View {
        HStack(spacing: 12) {
            LegendAssignmentMark(label: "My shift")
            LegendDot(color: Color.statusText(.green), label: "Home")
            LegendDot(color: Color.statusText(.orange), label: "Away")
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Legend: my shift, home, away")
    }

    private func changeMonth(by delta: Int) {
        withAnimation(.easeInOut(duration: 0.2)) {
            let next = calendar.date(byAdding: .month, value: delta, to: displayedMonth) ?? displayedMonth
            displayedMonth = next
            // Move selection along — keep the same day-of-month if valid, else clamp to first.
            let dayComponent = calendar.component(.day, from: selectedDate)
            let yearMonth = calendar.dateComponents([.year, .month], from: next)
            var components = yearMonth
            components.day = dayComponent
            if let candidate = calendar.date(from: components),
               calendar.component(.month, from: candidate) == yearMonth.month {
                selectedDate = candidate
            } else if let firstOfMonth = calendar.date(from: yearMonth) {
                selectedDate = firstOfMonth
            }
        }
    }

    private func goToToday() {
        let today = Date()
        withAnimation(.easeInOut(duration: 0.25)) {
            selectedDate = today
            displayedMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: today)) ?? today
        }
    }

    // MARK: Month header

    private var monthHeader: some View {
        HStack {
            Button { changeMonth(by: -1) } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .contentShape(Circle())
            }
            .buttonStyle(ScalePressStyle())
            .accessibilityLabel("Previous month")

            Spacer()

            VStack(spacing: 2) {
                Text(displayedMonth.formatted(.dateTime.month(.wide).year()))
                    .font(.headline)
                if !calendar.isDate(displayedMonth, equalTo: Date(), toGranularity: .month) {
                    Button("Today") { goToToday() }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.brandPrimary)
                        .buttonStyle(.plain)
                }
            }

            Spacer()

            Button { changeMonth(by: 1) } label: {
                Image(systemName: "chevron.right")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .contentShape(Circle())
            }
            .buttonStyle(ScalePressStyle())
            .accessibilityLabel("Next month")
        }
    }

    // MARK: Day event list

    @ViewBuilder
    private var dayEventList: some View {
        let events = selectedDayEvents
        if events.isEmpty {
            VStack {
                Spacer()
                Text("No events on \(selectedDate.formatted(.dateTime.month(.abbreviated).day()))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            List {
                ForEach(events) { event in
                    Button { onSelectEvent(event) } label: {
                        EventRow(
                            event: event,
                            myShift: shiftsByEventId[event.id],
                            contextDay: calendar.startOfDay(for: selectedDate),
                            showsCrewCoverage: showsCrewCoverage
                        )
                    }
                    .buttonStyle(ScalePressStyle())
                    .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.bottom, 96, for: .scrollContent)
            .background(Color(.systemGroupedBackground))
        }
    }

    // MARK: Helpers

    private func daysInMonth() -> [Date?] {
        guard let range = calendar.range(of: .day, in: .month, for: displayedMonth),
              let firstDay = calendar.date(from: calendar.dateComponents([.year, .month], from: displayedMonth))
        else { return [] }
        let offset = calendar.component(.weekday, from: firstDay) - 1
        let empties: [Date?] = Array(repeating: nil, count: offset)
        let days: [Date?] = range.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: firstDay) }
        return empties + days
    }

    // Venue and personal-work signals stay independent: each event keeps its
    // home/away/neutral dot while the day cell adds one blue assignment mark.
    private func dotInfo(for date: Date) -> [DotInfo] {
        let visible = filteredEvents(on: date)
        return visible.prefix(3).map { event in
            let isShift = shiftsByEventId[event.id] != nil
            return DotInfo(color: venueRailColor(isHome: event.isHome), isShift: isShift)
        }
    }
}

struct DotInfo {
    let color: Color
    let isShift: Bool
}

private struct LegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private struct LegendAssignmentMark: View {
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Capsule()
                .fill(Color.statusText(.blue))
                .frame(width: 10, height: 2)
                .accessibilityHidden(true)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Day Cell

private struct DayCell: View {
    let date: Date
    let isToday: Bool
    let isSelected: Bool
    let dots: [DotInfo]
    let eventCount: Int

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                if isSelected {
                    Circle()
                        .fill(isToday ? Color.brandPrimary : Color.brandPrimary.opacity(0.18))
                        .frame(width: 28, height: 28)
                } else if isToday {
                    Circle()
                        .strokeBorder(Color.brandPrimary, lineWidth: 1.5)
                        .frame(width: 28, height: 28)
                }
                Text(date.formatted(.dateTime.day()))
                    .font(.subheadline)
                    .fontWeight(isToday ? .semibold : .regular)
                    .foregroundStyle(
                        isSelected && isToday ? .white :
                        isSelected ? Color.brandPrimary :
                        isToday ? Color.brandPrimary : .primary
                    )
            }
            .frame(width: 28, height: 28)

            // Venue dots retain classification color even when the day also
            // contains personal work.
            HStack(spacing: 2) {
                ForEach(dots.indices, id: \.self) { i in
                    Circle()
                        .fill(dots[i].color)
                        .frame(width: 4, height: 4)
                }
            }
            .frame(height: 4)

            Capsule()
                .fill(dots.contains(where: \.isShift) ? Color.statusText(.blue) : Color.clear)
                .frame(width: 9, height: 2)
                .accessibilityHidden(true)
        }
        // Deliberately below Apple's 44pt guidance: a six-row month at 44pt ate
        // over half the screen and starved the agenda beneath it. Cell content
        // measures ~36pt and the whole cell stays tappable via contentShape.
        .frame(minWidth: 32, minHeight: 32)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var accessibilityLabel: String {
        var parts: [String] = []
        parts.append(date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
        if isToday { parts.append("today") }
        let hasMyShift = dots.contains(where: \.isShift)
        if eventCount == 0 {
            parts.append("no events")
        } else if eventCount == 1 {
            parts.append(hasMyShift ? "1 event including my shift" : "1 event")
        } else {
            parts.append(hasMyShift ? "\(eventCount) events including my shift" : "\(eventCount) events")
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Date Header

private struct ScheduleDateHeader: View {
    let date: Date
    let eventCount: Int

    private var cal: Calendar { .current }
    private var isToday: Bool { cal.isDateInToday(date) }
    private var isTomorrow: Bool { cal.isDateInTomorrow(date) }

    private var primaryLabel: String {
        if isToday { return "Today" }
        if isTomorrow { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.wide))
    }

    /// "Today"/"Tomorrow" already spend the primary slot, so those two carry the
    /// weekday here; a named weekday elsewhere would only repeat itself.
    private var dateLabel: String {
        let calendar = Calendar.current
        let year = calendar.component(.year, from: date)
        let currentYear = calendar.component(.year, from: .now)
        guard year == currentYear else {
            return date.formatted(.dateTime.month(.abbreviated).day().year())
        }
        return (isToday || isTomorrow)
            ? date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            : date.formatted(.dateTime.month(.abbreviated).day())
    }

    var body: some View {
        // One line, not two: the day and its date never needed a stacked pair,
        // and the row it cost was repeated for every group on the screen.
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(primaryLabel)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isToday ? Color.brandPrimary : .primary)

            Text("·")
                .font(.subheadline)
                .foregroundStyle(.tertiary)

            Text(dateLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer(minLength: 8)

            // Already computed for VoiceOver; showing it costs nothing and
            // answers "how heavy is this day" before the day is scrolled.
            Text(eventCount == 1 ? "1 event" : "\(eventCount) events")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.tertiary)
        }
        .lineLimit(1)
        .padding(.horizontal, 16)
        .padding(.top, Brand.Space.sm)
        .padding(.bottom, 5)
        .background(Color(.systemGroupedBackground))
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(headerAccessibilityLabel)
    }

    private var headerAccessibilityLabel: String {
        var parts: [String] = []
        if isToday {
            parts.append("Today")
        } else if isTomorrow {
            parts.append("Tomorrow")
        } else {
            parts.append(date.formatted(.dateTime.month(.wide).year()))
        }
        parts.append(date.formatted(.dateTime.weekday(.wide).day()))
        if eventCount > 1 {
            parts.append("\(eventCount) events")
        } else if eventCount == 1 {
            parts.append("1 event")
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Event Row

struct EventRow: View {
    let event: ScheduleEvent
    let myShift: MyShift?
    /// The day this row is rendered under. For a multi-day event it drives the
    /// "Day n/m" marker and the segment-aware time line.
    var contextDay: Date? = nil
    var showsCrewCoverage = true

    /// The time column grows with Dynamic Type. Held at a fixed 62pt, the
    /// gutter clipped its own value at accessibility sizes -- `11:00 AM` read
    /// as `11:…`, which removes the one thing the column exists to show.
    /// Same treatment as `CrewTypeLabel`'s name column.
    @ScaledMetric(relativeTo: .subheadline) private var gutterScale: CGFloat = 1

    /// When this row represents one day of a multi-day event, its 1-based
    /// position and the total span length.
    private var segment: (index: Int, total: Int)? {
        guard event.isMultiDay, let day = contextDay, let idx = event.dayIndex(for: day) else { return nil }
        return (idx, event.dayCount)
    }

    private var eventDisplayTitle: String {
        scheduleEventDisplayTitle(event)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Time leads the row so a day of work reads down a single column
            // instead of being re-found inside each card.
            timeGutter

            StatusRail(color: barColor)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 3) {
                Text(eventDisplayTitle)
                    .font(.body.weight(.semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                // Crew fill still right-aligns into a scannable trailing column,
                // one line lower than before. Sharing the meta line instead of
                // the title line is what buys the title its full width back.
                if !metaParts.isEmpty || hasCoverageChip {
                    HStack(spacing: 8) {
                        if !metaParts.isEmpty {
                            metaLine
                        }
                        Spacer(minLength: 0)
                        if showsCrewCoverage, let cov = event.coverage, cov.total > 0 {
                            coverageChip(cov)
                        }
                    }
                }

                if let myShift {
                    personalWorkLine(myShift)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 12)
        .background(rowBackground)
        .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                .strokeBorder(rowStroke, lineWidth: rowStrokeWidth)
        )
        // A finished event still belongs on the day, but it should stop
        // competing with the work that has not happened yet.
        .opacity(timeState == .past ? 0.55 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rowAccessibilityLabel)
    }

    // MARK: Temporal state

    /// Drives the "NOW" badge and the dimming that lets the eye skip work that
    /// is already done. Defined on `ScheduleEvent` so Event detail answers the
    /// same question the same way.
    private var timeState: ScheduleEventTimeState { event.timeState }

    private var rowBackground: Color {
        if myShift != nil { return Color.statusBackground(.blue).opacity(0.34) }
        return Color.cardSurface
    }

    private var rowStroke: Color {
        if timeState == .live { return Color.brandPrimary.opacity(0.55) }
        if myShift != nil { return Color.statusText(.blue).opacity(0.32) }
        return Color.hairline
    }

    private var rowStrokeWidth: CGFloat {
        if timeState == .live { return 1.5 }
        return myShift == nil ? 0.5 : 1
    }

    // MARK: Time gutter

    /// The two lines of the leading time column. Multi-day segments report the
    /// edge that actually falls on this day rather than the whole span.
    private var gutterLines: (primary: String, secondary: String?) {
        let start = event.startsAt.formatted(.dateTime.hour().minute())
        let end = event.endsAt.formatted(.dateTime.hour().minute())
        if let seg = segment {
            // "Day 2/3" belongs next to the time, not out in the meta line
            // where it competed with the venue for the same few points.
            let span = "Day \(seg.index)/\(seg.total)"
            if event.displayAllDay { return ("All day", span) }
            if seg.index == 1 { return (start, span) }
            if seg.index == seg.total { return (end, span) }
            return ("All day", span)
        }
        if event.displayAllDay { return ("All day", nil) }
        return (start, end)
    }

    private var timeGutter: some View {
        let lines = gutterLines
        return VStack(alignment: .trailing, spacing: 2) {
            Text(lines.primary)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(timeState == .live ? Color.brandPrimary : Color.primary)

            if timeState == .live {
                Text("NOW")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Color.brandPrimary, in: Capsule())
            } else if let secondary = lines.secondary {
                Text(secondary)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(width: 62 * gutterScale, alignment: .trailing)
        .accessibilityHidden(true)
    }

    /// A single, quiet secondary line: home/away · venue · multi-day. Time moved
    /// to the leading gutter, which freed this line to absorb the venue row and
    /// take a whole line back off every card.
    private var metaParts: [String] {
        var parts: [String] = []
        if let eventTypeLabel { parts.append(eventTypeLabel) }
        if let venueName { parts.append(venueName) }
        return parts
    }

    private var hasCoverageChip: Bool {
        showsCrewCoverage && (event.coverage?.total ?? 0) > 0
    }

    private var metaLine: some View {
        HStack(spacing: 4) {
            if let eventTypeLabel {
                Text(eventTypeLabel)
                metaDot
            }
            if let venueName {
                Image(systemName: "mappin.and.ellipse")
                    .font(.caption2)
                    .imageScale(.small)
                Text(venueName)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    private var metaDot: some View {
        Text("·").foregroundStyle(.tertiary)
    }

    /// Home is already carried by the green status rail, so only the exceptions
    /// spend a word on the meta line. VoiceOver still gets the full label below.
    ///
    /// Neutral and non-game share the grey rail, and the title already says
    /// which one it is by naming an opponent or not — so when there is a venue
    /// to print, the word loses to the venue rather than truncating it.
    private var eventTypeLabel: String? {
        switch event.isHome {
        case true: return nil
        case false: return "Away"
        case nil:
            guard venueName == nil else { return nil }
            return event.opponent == nil ? "Non-game" : "Neutral"
        }
    }

    private var accessibilityTypeLabel: String {
        switch event.isHome {
        case true: return "Home"
        case false: return "Away"
        case nil: return event.opponent == nil ? "Non-game" : "Neutral"
        }
    }

    /// Shared with Event detail via `scheduleEventVenueName` — the row and the
    /// detail header must name the same venue the same way.
    private var venueName: String? {
        scheduleEventVenueName(event)
    }

    private func personalWorkLine(_ shift: MyShift) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "person.fill.checkmark")
                .font(.caption2.weight(.semibold))
                .accessibilityHidden(true)
            Text(personalWorkText(shift))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(Color.statusText(.blue))
    }

    private func personalWorkText(_ shift: MyShift) -> String {
        var parts: [String] = []
        if !event.displayAllDay && shift.workerType == "ST" {
            parts.append("Call \(shift.startsAt.formatted(date: .omitted, time: .shortened))")
        } else if shift.workerType == "FT" {
            parts.append("Assigned")
        }
        parts.append(shift.area.shiftAreaLabel)
        parts.append(shift.gear.gearLabel)
        return parts.joined(separator: " · ")
    }

    private var rowAccessibilityLabel: String {
        var parts: [String] = []
        switch timeState {
        case .live: parts.append("In progress")
        case .past: parts.append("Ended")
        case .upcoming: break
        }
        if myShift != nil { parts.append("My shift") }
        parts.append(eventDisplayTitle)
        if showsCrewCoverage, let cov = event.coverage, cov.total > 0 {
            parts.append("Crew \(cov.filled) of \(cov.total)")
        }
        parts.append(accessibilityTypeLabel)
        if event.displayAllDay {
            parts.append("All day")
        } else if let shift = myShift {
            let callTime = shift.startsAt.formatted(.dateTime.hour().minute())
            let eventTime = event.startsAt.formatted(.dateTime.hour().minute())
            let endTime = shift.endsAt.formatted(.dateTime.hour().minute())
            if shift.workerType == "FT" {
                parts.append("Event \(eventTime) to \(endTime)")
            } else if calendarSame(shift.startsAt, event.startsAt) {
                parts.append("Event \(eventTime) to \(endTime)")
            } else {
                parts.append("Call \(callTime), event \(eventTime), end \(endTime)")
            }
            parts.append(shift.area.shiftAreaLabel)
            parts.append(shift.gear.gearLabel)
        } else {
            parts.append(eventTimeLabel)
        }
        if let segment {
            parts.append("Day \(segment.index) of \(segment.total)")
        }
        if let venueName {
            parts.append(venueName)
        }
        return parts.joined(separator: ", ")
    }

    /// Shared with Event detail's hero via `CoverageChip` — the list and the
    /// detail screen must report the same staffing the same way.
    @ViewBuilder
    private func coverageChip(_ cov: ShiftCoverage) -> some View {
        CoverageChip(coverage: cov)
            .accessibilityHidden(true) // surfaced via the combined row label
    }

    /// The left rail always encodes the venue (home/away/neutral); "my shift"
    /// is signalled by the card's accent stroke instead, so the two don't fight.
    private var barColor: Color {
        venueRailColor(isHome: event.isHome)
    }

    private var eventTimeLabel: String {
        if event.displayAllDay { return "All day" }
        let start = event.startsAt.formatted(.dateTime.hour().minute())
        let end = event.endsAt.formatted(.dateTime.hour().minute())
        return "\(start) – \(end)"
    }
}

private func calendarSame(_ a: Date, _ b: Date) -> Bool {
    abs(a.timeIntervalSince(b)) < 60
}

// MARK: - Sport labels (mirrors src/lib/sports.ts)

private func scheduleSportLabel(_ code: String) -> String {
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
