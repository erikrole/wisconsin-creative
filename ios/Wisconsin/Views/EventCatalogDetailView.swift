import SwiftUI

@MainActor
@Observable
final class EventCatalogDetailModel {
    private(set) var eventId: String
    private(set) var detail: CalendarEventDetail?
    private(set) var bookings: [Booking] = []
    private(set) var fallbackRows: [EventBookingFallback] = []
    private(set) var personalShifts: [MyShift] = []
    private(set) var showsTeamGear = false
    private(set) var hiddenBookingCount = 0
    var isLoading = true
    var isLoadingLinks = false
    var error: String?
    var linksError: String?

    private var loads = LatestRequestGeneration()
    private var followedCombine = false
    /// Staff and admin can read every booking on the event. Students cannot,
    /// and a 403 from that read also refreshes the signed-in session, so the
    /// view skips the call instead of treating a refusal as a failure.
    private var includeTeamGear = false

    init(eventId: String) {
        self.eventId = eventId
    }

    var scheduleEvent: ScheduleEvent? {
        detail?.asScheduleEvent()
    }

    var gearLines: [EventGearLine] {
        bookings
            .sorted { $0.startsAt < $1.startsAt }
            .flatMap(eventGearLines(from:))
    }

    func load(includeTeamGear: Bool? = nil) async {
        if let includeTeamGear { self.includeTeamGear = includeTeamGear }
        let token = loads.begin()
        if detail == nil { isLoading = true }
        error = nil
        do {
            let loaded = try await APIClient.shared.calendarEventDetail(id: eventId)
            guard loads.owns(token), !Task.isCancelled else { return }
            if let parentId = loaded.combinedInto?.id, parentId != eventId, !followedCombine {
                followedCombine = true
                eventId = parentId
                await load()
                return
            }
            detail = loaded
            isLoading = false
            await loadLinks(token: token)
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            if detail == nil {
                self.error = error.localizedDescription
            } else {
                linksError = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func loadLinks(token: UUID) async {
        isLoadingLinks = true
        linksError = nil
        hiddenBookingCount = 0
        defer {
            if loads.owns(token) { isLoadingLinks = false }
        }

        let center: EventCommandCenter?
        if includeTeamGear {
            do {
                center = try await APIClient.shared.eventCommandCenter(id: eventId)
                showsTeamGear = true
            } catch let error as APIError {
                center = nil
                showsTeamGear = false
                if !Self.isExpectedGearRefusal(error), loads.owns(token) {
                    linksError = error.localizedDescription
                }
            } catch is CancellationError {
                return
            } catch {
                center = nil
                showsTeamGear = false
                if loads.owns(token) { linksError = error.localizedDescription }
            }
        } else {
            center = nil
            showsTeamGear = false
        }
        guard loads.owns(token), !Task.isCancelled else { return }

        let shifts: [MyShift]
        do {
            shifts = try await APIClient.shared.myShifts(eventId: eventId)
        } catch is CancellationError {
            return
        } catch {
            shifts = []
            if loads.owns(token), linksError == nil {
                linksError = error.localizedDescription
            }
        }
        guard loads.owns(token), !Task.isCancelled else { return }
        personalShifts = shifts

        var ids: [String] = []
        var seen = Set<String>()
        func add(_ id: String) {
            guard seen.insert(id).inserted else { return }
            ids.append(id)
        }
        for plan in center?.gearPlans ?? [] {
            for id in plan.bookingIds { add(id) }
        }
        for shift in shifts {
            for booking in shift.gear.bookings { add(booking.id) }
        }

        let visibleIds = Array(ids.prefix(eventCatalogBookingFetchCap))
        hiddenBookingCount = max(0, ids.count - visibleIds.count)
        fallbackRows = fallbackRows(plans: center?.gearPlans ?? [], shifts: shifts, ids: visibleIds)

        var loaded: [Booking] = []
        var failures = 0
        for id in visibleIds {
            if Task.isCancelled || !loads.owns(token) { return }
            do {
                loaded.append(try await APIClient.shared.booking(id: id))
            } catch is CancellationError {
                return
            } catch {
                failures += 1
            }
        }
        guard loads.owns(token), !Task.isCancelled else { return }
        bookings = loaded.sorted { $0.startsAt < $1.startsAt }
        if failures > 0 && linksError == nil && loaded.count < visibleIds.count {
            linksError = failures == visibleIds.count
                ? "Couldn't load the linked bookings."
                : "Some linked bookings didn't load."
        }
    }

    private func fallbackRows(plans: [EventGearPlan], shifts: [MyShift], ids: [String]) -> [EventBookingFallback] {
        let allowed = Set(ids)
        var rows: [EventBookingFallback] = []
        var covered = Set<String>()
        for plan in plans where plan.bookingIds.contains(where: allowed.contains) {
            let status = eventGearPlanStatus(plan.state)
            let bookingId = plan.bookingIds.first { allowed.contains($0) }
            if let bookingId { covered.insert(bookingId) }
            let countLabel = plan.itemCount == 1 ? "1 item" : "\(plan.itemCount) items"
            rows.append(EventBookingFallback(
                id: "plan-\(plan.requesterUserId)",
                bookingId: bookingId,
                title: plan.title,
                subtitle: "\(plan.requesterName) · \(countLabel)",
                statusLabel: status.label,
                tone: status.tone
            ))
        }
        for shift in shifts {
            for booking in shift.gear.bookings where allowed.contains(booking.id) && !covered.contains(booking.id) {
                let status = eventCatalogBookingStatusCode(booking.status)
                let countLabel = booking.itemCount == 1 ? "1 item" : "\(booking.itemCount) items"
                rows.append(EventBookingFallback(
                    id: booking.id,
                    bookingId: booking.id,
                    title: eventBookingKindLabel(BookingKind(rawValue: booking.kind) ?? .unknown),
                    subtitle: countLabel,
                    statusLabel: status.label,
                    tone: status.tone
                ))
            }
        }
        return rows
    }

    /// A missing command center, or a role the route refuses, is an empty team
    /// list. The event itself already loaded.
    private static func isExpectedGearRefusal(_ error: APIError) -> Bool {
        switch error {
        case .notFound:
            return true
        case .httpError(let status, _) where status == 403 || status == 404:
            return true
        default:
            return false
        }
    }
}

struct EventCatalogDetailView: View {
    let eventId: String

    @State private var model: EventCatalogDetailModel
    @State private var openSchedule = false
    @Environment(\.today) private var today
    @Environment(SessionStore.self) private var session

    private var canReadTeamGear: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    init(eventId: String) {
        self.eventId = eventId
        _model = State(initialValue: EventCatalogDetailModel(eventId: eventId))
    }

    var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.load(includeTeamGear: canReadTeamGear) }
            .task { await model.load(includeTeamGear: canReadTeamGear) }
            .navigationDestination(isPresented: $openSchedule) {
                if let event = model.scheduleEvent {
                    EventDetailView(event: event, myShifts: model.personalShifts)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.detail != nil {
                    Button {
                        openSchedule = true
                    } label: {
                        Label("Open in Schedule", systemImage: "calendar")
                    }
                    .authButton(.primary, adaptive: true)
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.vertical, Brand.Space.sm)
                    .background(.bar)
                    .accessibilityHint("Opens crew and call times for this event")
                }
            }
    }

    private var title: String {
        eventCatalogTitle(detail: model.detail, event: model.scheduleEvent)
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading, model.detail == nil {
            ProgressView("Loading event")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.detail == nil {
            ContentUnavailableView {
                Label("Couldn't load event", systemImage: "calendar.badge.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await model.load(includeTeamGear: canReadTeamGear) } }
            }
        } else if let detail = model.detail, let event = model.scheduleEvent {
            List {
                identitySection(detail: detail, event: event)
                combinedSection(detail: detail)
                bookingsSection
                gearSection
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder
    private func identitySection(detail: CalendarEventDetail, event: ScheduleEvent) -> some View {
        Section {
            if let subtitle = eventCatalogSubtitle(detail: detail, event: event) {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            LabeledContent("When", value: eventCatalogWhenLabel(event, now: today))
            LabeledContent("Type", value: eventCatalogTypeLabel(event))
            if let venue = eventCatalogVenueName(detail) {
                LabeledContent("Venue", value: venue)
            }
            LabeledContent("Source", value: eventCatalogSourceLabel(source: detail.source, createdByName: detail.createdByName))
            if !statusPills(detail: detail).isEmpty {
                HStack(spacing: 6) {
                    ForEach(statusPills(detail: detail), id: \.label) { status in
                        StatusPill(label: status.label, tone: status.tone)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func statusPills(detail: CalendarEventDetail) -> [EventCatalogStatus] {
        var pills: [EventCatalogStatus] = []
        if detail.status == "CANCELLED" {
            pills.append(EventCatalogStatus(label: "Cancelled", tone: .gray))
        }
        if detail.isHidden == true {
            pills.append(EventCatalogStatus(label: "Hidden", tone: .gray))
        }
        if !(detail.combinedEvents ?? []).isEmpty {
            pills.append(EventCatalogStatus(label: "Combined", tone: .orange))
        }
        return pills
    }

    @ViewBuilder
    private func combinedSection(detail: CalendarEventDetail) -> some View {
        let members = detail.combinedEvents ?? []
        if !members.isEmpty {
            Section {
                ForEach(members) { member in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(member.summary)
                        Text(eventCatalogWhenLabel(memberScheduleEvent(member), now: today))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Text("One crew covers these events. Separating them stays on the web.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Combined")
            }
        }
    }

    @ViewBuilder
    private var bookingsSection: some View {
        Section {
            if model.isLoadingLinks && model.bookings.isEmpty && model.fallbackRows.isEmpty {
                ProgressView("Loading bookings")
            } else if model.bookings.isEmpty && model.fallbackRows.isEmpty {
                Text(emptyLinksMessage)
                    .foregroundStyle(.secondary)
            } else if model.bookings.isEmpty {
                ForEach(model.fallbackRows) { row in
                    bookingFallbackRow(row)
                }
            } else {
                ForEach(model.bookings) { booking in
                    NavigationLink(value: BookingRouteId(id: booking.id)) {
                        bookingRow(booking)
                    }
                }
            }
            if model.hiddenBookingCount > 0 {
                Text("Showing the first \(eventCatalogBookingFetchCap) bookings.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let linksError = model.linksError {
                VStack(alignment: .leading, spacing: 8) {
                    Text(linksError)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Try again") { Task { await model.load(includeTeamGear: canReadTeamGear) } }
                }
            }
        } header: {
            Text("Bookings")
        }
    }

    @ViewBuilder
    private var gearSection: some View {
        Section {
            if model.isLoadingLinks && model.gearLines.isEmpty {
                ProgressView("Loading gear")
            } else if model.gearLines.isEmpty {
                Text(gearEmptyMessage)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.gearLines) { line in
                    NavigationLink(value: BookingRouteId(id: line.bookingId)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.title)
                            Text(line.subtitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } header: {
            Text("Gear")
        }
    }

    private var emptyLinksMessage: String {
        model.showsTeamGear
            ? "No bookings are linked to this event."
            : "No bookings are linked to you for this event."
    }

    private var gearEmptyMessage: String {
        if !model.bookings.isEmpty { return "These bookings don't list any gear." }
        if !model.fallbackRows.isEmpty { return "Open a booking to see its gear." }
        return "No linked gear."
    }

    private func bookingRow(_ booking: Booking) -> some View {
        let status = eventBookingStatus(booking, now: today)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(booking.title)
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                StatusPill(label: status.label, tone: status.tone)
            }
            Text("\(booking.requester.name) · \(eventBookingKindLabel(booking.kind))")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func bookingFallbackRow(_ row: EventBookingFallback) -> some View {
        let label = VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.title)
                    .font(.body.weight(.semibold))
                Spacer(minLength: 8)
                StatusPill(label: row.statusLabel, tone: row.tone)
            }
            Text(row.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        if let bookingId = row.bookingId {
            NavigationLink(value: BookingRouteId(id: bookingId)) { label }
        } else {
            label
        }
    }

    private func memberScheduleEvent(_ member: CombinedScheduleMember) -> ScheduleEvent {
        ScheduleEvent(
            id: member.id,
            summary: member.summary,
            startsAt: member.startsAt,
            endsAt: member.endsAt,
            allDay: member.allDay,
            status: "CONFIRMED",
            sportCode: member.sportCode,
            opponent: member.opponent,
            isHome: nil,
            location: nil
        )
    }
}
