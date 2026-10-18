import Foundation

/// How many linked bookings the event detail will read in full. The command
/// center can name up to 500; a phone shows the first page and says so.
let eventCatalogBookingFetchCap = 24

/// `GET /api/calendar-events/:id`. Extra server fields are ignored. Optional
/// fields stay optional so an older payload still opens the event.
struct CalendarEventDetail: Decodable, Identifiable {
    let id: String
    let summary: String
    let subtitle: String?
    let startsAt: Date
    let endsAt: Date
    let allDay: Bool
    let status: String
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
    let site: String?
    let rawLocationText: String?
    let isHidden: Bool?
    let location: EventLocation?
    let source: CalendarEventSource?
    let createdByName: String?
    let combinedInto: CalendarEventLink?
    let combinedEvents: [CombinedScheduleMember]?

    func asScheduleEvent() -> ScheduleEvent {
        ScheduleEvent(
            id: id,
            summary: summary,
            startsAt: startsAt,
            endsAt: endsAt,
            allDay: allDay,
            status: status,
            sportCode: sportCode,
            opponent: opponent,
            isHome: isHome,
            site: site,
            location: location,
            rawLocationText: rawLocationText,
            combinedIntoId: combinedInto?.id,
            combinedEvents: combinedEvents
        )
    }
}

struct CalendarEventSource: Decodable {
    let id: String
    let name: String
    let url: String?
}

struct CalendarEventLink: Decodable, Identifiable {
    let id: String
    let summary: String
}

/// The gear portion of `GET /api/calendar-events/:id/command-center`.
/// Shifts, missing gear, and activity stay on the Schedule event sheet.
struct EventCommandCenter: Decodable {
    var gearPlans: [EventGearPlan]?
}

struct EventGearPlan: Decodable, Identifiable {
    let requesterUserId: String
    let requesterName: String
    let bookingIds: [String]
    let title: String
    let state: String
    let itemCount: Int

    var id: String { requesterUserId }
}

struct EventBookingFallback: Identifiable {
    let id: String
    let bookingId: String?
    let title: String
    let subtitle: String
    let statusLabel: String
    let tone: StatusTone
}

struct EventGearLine: Identifiable {
    let id: String
    let bookingId: String
    let title: String
    let subtitle: String
}

struct EventCatalogStatus {
    let label: String
    let tone: StatusTone
}

/// Source line shared with web event detail: the public calendar name, or who
/// added a manual event. Pickup location is not a source.
func eventCatalogSourceLabel(source: CalendarEventSource?, createdByName: String?) -> String {
    if let source {
        let haystack = "\(source.name) \(source.url ?? "")".lowercased()
        if haystack.contains("uwbadgers") || haystack.contains("uw badgers") {
            return "UWBadgers.com"
        }
        if let rawURL = source.url?.trimmingCharacters(in: .whitespacesAndNewlines), !rawURL.isEmpty {
            let normalized = rawURL.replacingOccurrences(of: "webcal:", with: "https:", options: .caseInsensitive)
            if let host = URL(string: normalized)?.host?.replacingOccurrences(of: "www.", with: "") , !host.isEmpty {
                return host
            }
        }
        let name = source.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
    }
    let addedBy = createdByName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return addedBy.isEmpty ? "Added in Schedule" : "Added by \(addedBy)"
}

func eventCatalogTitle(detail: CalendarEventDetail?, event: ScheduleEvent?) -> String {
    if let event { return scheduleEventDisplayTitle(event) }
    let summary = detail?.summary.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return summary.isEmpty ? "Event" : summary
}

func eventCatalogSubtitle(detail: CalendarEventDetail, event: ScheduleEvent) -> String? {
    let title = scheduleEventDisplayTitle(event).lowercased()
    var parts: [String] = []
    var seen = Set<String>()
    for candidate in [detail.subtitle, scheduleEventPromotion(event)] {
        guard let trimmed = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { continue }
        let key = trimmed.lowercased()
        guard seen.insert(key).inserted, !title.contains(key) else { continue }
        parts.append(trimmed)
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

/// Calendar venue, not the gear pickup location. Web event detail uses the
/// same split: `rawLocationText` is the venue, `location` is pickup.
func eventCatalogVenueName(_ detail: CalendarEventDetail) -> String? {
    guard let raw = detail.rawLocationText?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
        return nil
    }
    let name = scheduleVenueDisplayName(raw)
    return name.isEmpty ? nil : name
}

func eventCatalogWhenLabel(_ event: ScheduleEvent, now: Date = .now) -> String {
    let startDay = event.displayStartDay.operationalDayLabel(now: now)
    if event.displayAllDay {
        if event.isMultiDay {
            let endDay = event.displayEndDay.formatted(.dateTime.month(.abbreviated).day())
            return "\(startDay) – \(endDay) · \(scheduleAllDayLabel(event))"
        }
        return "\(startDay) · \(scheduleAllDayLabel(event))"
    }
    let startTime = event.startsAt.gearTime
    let endTime = event.endsAt.gearTime
    if event.isMultiDay {
        let endDay = event.displayEndDay.formatted(.dateTime.month(.abbreviated).day())
        return "\(startDay), \(startTime) – \(endDay), \(endTime)"
    }
    return "\(startDay), \(startTime)–\(endTime)"
}

func eventCatalogTypeLabel(_ event: ScheduleEvent) -> String {
    switch event.venue {
    case .home: "Home"
    case .away: "Away"
    case .neutral: "Neutral"
    case .nonGame: "Non-game"
    }
}

func eventGearPlanStatus(_ state: String) -> EventCatalogStatus {
    switch state {
    case "draft": EventCatalogStatus(label: "Draft", tone: .gray)
    case "reserved": EventCatalogStatus(label: "Reserved", tone: .purple)
    case "ready_for_pickup": EventCatalogStatus(label: "Ready for pickup", tone: .orange)
    case "partially_picked_up": EventCatalogStatus(label: "Partially picked up", tone: .orange)
    case "checked_out": EventCatalogStatus(label: "Checked out", tone: .blue)
    case "returned": EventCatalogStatus(label: "Returned", tone: .green)
    default: EventCatalogStatus(label: "Gear", tone: .gray)
    }
}

func eventBookingStatus(_ booking: Booking, now: Date = .now) -> EventCatalogStatus {
    if booking.status == .open, booking.endsAt < now {
        return EventCatalogStatus(label: "Overdue", tone: .red)
    }
    switch booking.status {
    case .draft: return EventCatalogStatus(label: "Draft", tone: .gray)
    case .booked: return EventCatalogStatus(label: "Reserved", tone: .purple)
    case .pendingPickup: return EventCatalogStatus(label: "Pending Pickup", tone: .orange)
    case .open: return EventCatalogStatus(label: "Checked Out", tone: .blue)
    case .completed: return EventCatalogStatus(label: "Completed", tone: .green)
    case .cancelled: return EventCatalogStatus(label: "Cancelled", tone: .gray)
    case .unknown: return EventCatalogStatus(label: "Unknown", tone: .gray)
    }
}

func eventCatalogBookingStatusCode(_ status: String) -> EventCatalogStatus {
    switch status.uppercased() {
    case "DRAFT": EventCatalogStatus(label: "Draft", tone: .gray)
    case "BOOKED": EventCatalogStatus(label: "Reserved", tone: .purple)
    case "PENDING_PICKUP": EventCatalogStatus(label: "Pending Pickup", tone: .orange)
    case "OPEN": EventCatalogStatus(label: "Checked Out", tone: .blue)
    case "COMPLETED": EventCatalogStatus(label: "Completed", tone: .green)
    case "CANCELLED": EventCatalogStatus(label: "Cancelled", tone: .gray)
    default: EventCatalogStatus(label: "Gear", tone: .gray)
    }
}

func eventBookingKindLabel(_ kind: BookingKind) -> String {
    switch kind {
    case .reservation: "Reservation"
    case .checkout: "Checkout"
    case .unknown: "Booking"
    }
}

func eventGearLines(from booking: Booking) -> [EventGearLine] {
    let context = "\(booking.title) · \(booking.requester.name)"
    let serialized = booking.serializedItems.map { item in
        EventGearLine(
            id: "\(booking.id)-asset-\(item.id)",
            bookingId: booking.id,
            title: item.asset.itemListPrimaryTitle,
            subtitle: item.asset.itemListSecondaryTitle.map { "\($0) · \(context)" } ?? context
        )
    }
    let bulk = booking.bulkItems.map { item in
        let quantity = item.plannedQuantity > 1 ? "\(item.plannedQuantity) planned · " : ""
        return EventGearLine(
            id: "\(booking.id)-bulk-\(item.id)",
            bookingId: booking.id,
            title: item.itemListPrimaryTitle,
            subtitle: "\(quantity)\(context)"
        )
    }
    return serialized + bulk
}

/// Past events for the Browse list: the thirty days before today. Upcoming
/// uses the server's own "still going" window, so this one stops at today.
func eventCatalogRecentWindow(now: Date = .now) -> DateInterval {
    let calendar = Calendar.current
    let end = calendar.startOfDay(for: now)
    let start = calendar.date(byAdding: .day, value: -30, to: end) ?? end.addingTimeInterval(-30 * 86_400)
    return DateInterval(start: min(start, end), end: max(start, end))
}

/// One fallback per booking, even when a requester has several bookings or
/// several assignments refer to the same one. Fully loaded rows filter these.
func eventBookingFallbackRows(plans: [EventGearPlan], shifts: [MyShift], ids: [String]) -> [EventBookingFallback] {
    let allowed = Set(ids)
    var rows: [EventBookingFallback] = []
    var covered = Set<String>()
    for shift in shifts {
        for booking in shift.gear.bookings where allowed.contains(booking.id) && covered.insert(booking.id).inserted {
            let status = eventCatalogBookingStatusCode(booking.status)
            rows.append(EventBookingFallback(
                id: booking.id, bookingId: booking.id,
                title: eventBookingKindLabel(BookingKind(rawValue: booking.kind) ?? .unknown),
                subtitle: booking.itemCount == 1 ? "1 item" : "\(booking.itemCount) items",
                statusLabel: status.label, tone: status.tone
            ))
        }
    }
    for plan in plans {
        for id in plan.bookingIds where allowed.contains(id) && covered.insert(id).inserted {
            rows.append(EventBookingFallback(
                id: id, bookingId: id, title: "Booking",
                subtitle: plan.requesterName,
                statusLabel: "Details unavailable", tone: .gray
            ))
        }
    }
    return rows
}
