import SwiftUI

/// Considered fresh while younger than this; older triggers a background refresh.
private let publishedScheduleStaleAfter: TimeInterval = 5 * 60

// MARK: - Collaborator Published Schedule

/// The read-only Schedule a Collaborator sees: published crews only, from the
/// snapshot-backed `/api/schedule/published`. Rows share the internal
/// Schedule's day groups, venue dots, and trailing times.
private struct PublishedScheduleRoute: Hashable {
    let id: String
}

struct CollaboratorPublishedScheduleView: View {
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
            ForEach(0..<5, id: \.self) { index in
                PublishedEventRowSkeleton()
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 11, leading: 32, bottom: 11, trailing: 32))
                    .listRowBackground(EventRowBackground(
                        isMine: false,
                        position: EventRowGroupPosition(index: index, count: 5)
                    ))
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
                    ForEach(Array(group.events.enumerated()), id: \.element.id) { index, item in
                        // A Button, not a NavigationLink, so the row carries no
                        // disclosure chevron, matching the internal Schedule.
                        Button {
                            navigationPath.append(PublishedScheduleRoute(id: item.id))
                        } label: {
                            PublishedEventRow(event: item)
                        }
                        .foregroundStyle(.primary)
                        .contextMenu {
                            if canFollow, pendingFollowId == nil {
                                Button {
                                    Task { await setFollowing(item) }
                                } label: {
                                    Label(
                                        item.isFollowing ? "Mute Event Updates" : "Follow Event",
                                        systemImage: item.isFollowing ? "bell.slash" : "bell"
                                    )
                                }
                            }
                        }
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 11, leading: 32, bottom: 11, trailing: 32))
                        .listRowBackground(EventRowBackground(
                            isMine: false,
                            position: EventRowGroupPosition(index: index, count: group.events.count)
                        ))
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
        .listSectionSpacing(6)
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
        let isStale = lastLoadedAt.map { Date.now.timeIntervalSince($0) > publishedScheduleStaleAfter } ?? true
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

    /// Same shape as the internal Schedule row: a venue dot, the title, one
    /// meta line, the crew, and the time trailing. The grouped List section
    /// supplies the surface.
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VenueDot(color: publishedEventRailColor(event.event))

            VStack(alignment: .leading, spacing: 3) {
                Text(event.event.summary)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Text(metaText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    PublishedCrewAvatarStack(crew: event.crew)
                    Text(event.crew.isEmpty ? "No scheduled crew" : publishedCrewCount(event.crew.count))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 6) {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(event.event.allDay ? "All day" : event.event.startsAt.formatted(date: .omitted, time: .shortened))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.primary)
                    if !event.event.allDay {
                        Text(event.event.endsAt.formatted(date: .omitted, time: .shortened))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                if event.isFollowing {
                    Image(systemName: "bell.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(.purple))
                        .accessibilityHidden(true)
                }
            }
            .fixedSize()
            .padding(.top, 1)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    /// "Away · 3M Arena". Home is carried by the dot.
    private var metaText: String {
        let type = publishedEventType(event.event)
        let parts = [type == "Home" ? nil : type, event.event.venue?.name].compactMap { $0 }
        return parts.isEmpty ? type : parts.joined(separator: " · ")
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
        UserAvatarView(
            name: person.name,
            avatarUrl: person.avatarUrl,
            size: size,
            fallbackBackground: Color.cardSurfaceRaised,
            fallbackForeground: .secondary,
            showsBorder: false
        )
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
        HStack(alignment: .top, spacing: 12) {
            VenueDot(color: publishedEventRailColor(event.event), topPadding: 12)

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
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(Color.cardSurfaceRaised)
                .frame(width: 8, height: 8)
                .padding(.top, 7)
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
    guard let opponent = event.opponent?.trimmingCharacters(in: .whitespacesAndNewlines), !opponent.isEmpty else {
        return "Non-game"
    }
    switch event.site?.uppercased() {
    case "HOME": return "Home"
    case "AWAY": return "Away"
    case "NEUTRAL": return "Neutral"
    default: break
    }
    switch event.isHome {
    case true: return "Home"
    case false: return "Away"
    case nil: return "Neutral"
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
