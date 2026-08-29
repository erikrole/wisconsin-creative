import Foundation

// MARK: - Calendar Events

struct ScheduleEvent: Codable, Identifiable {
    let id: String
    let summary: String
    let startsAt: Date
    let endsAt: Date
    let allDay: Bool
    let status: String
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
    /// The canonical venue direction, and the reason `isHome` alone is not
    /// enough: `isHome == nil` means both "neutral site" and "no idea", and a
    /// row can carry `isHome == true` alongside `site == "NEUTRAL"` when the
    /// title said "vs" but was explicitly marked neutral. `/api/calendar-events`
    /// has always returned this; reading it is what stops Schedule showing a
    /// neutral game as a home game here while web shows it as neutral.
    /// Optional `var` (see `coverage` below) so it decodes and still defaults
    /// to nil for the event seeds that construct this type by hand.
    var site: String?
    let location: EventLocation?
    /// Original calendar venue text. Imported events can carry a useful venue
    /// before that text has been mapped to a Wisconsin Creative location.
    var rawLocationText: String?
    /// Crew coverage from `/api/calendar-events`. nil when the event has no
    /// (non-archived) shift group; lets the list show fill without drilling in.
    /// `var` (not `let = nil`) so it actually decodes — an immutable property with
    /// an initial value is skipped by synthesized Decodable. Optional `var` still
    /// defaults to nil in the memberwise init, so dashboard event seeds that don't
    /// supply coverage keep compiling.
    var coverage: ShiftCoverage?
}

struct EventLocation: Codable, Identifiable {
    let id: String
    let name: String
}

// MARK: - Temporal state

/// Where an event sits relative to now.
///
/// Shared by the Schedule list row and Event detail deliberately: the list grew
/// a "NOW" badge and a dimmed finished state before detail had any notion of
/// either, so tapping a live row landed on a screen that said nothing about it.
/// One definition means the two surfaces cannot drift apart again.
enum ScheduleEventTimeState {
    case upcoming
    case live
    case past
}

// MARK: - Venue

/// Where an event is played. Mirrors `VenueTone` in `src/lib/venue-tone.ts` so
/// the two clients name the same thing the same way.
enum ScheduleVenue {
    case home
    case away
    case neutral
    case nonGame
}

extension ScheduleEvent {
    /// Mirrors `venueToneFromEvent` in `src/lib/venue-tone.ts`, in the same
    /// order: no opponent is a non-game; a stored `site` is authoritative; a
    /// bracketed title prefix comes next; `isHome` is the last resort.
    ///
    /// Deriving this from `isHome` alone -- which every Schedule surface used to
    /// do -- collapses "neutral site" and "unclassified" back together and, for
    /// a row marked neutral on a home-mapped venue, reports a home game.
    var venue: ScheduleVenue {
        // Blank, not just nil: web tests `!event.opponent`, so an empty string
        // is a non-game there. Every other Swift surface that asks this
        // question -- `scheduleEventDisplayTitle`, the booking scope label --
        // already trims before deciding, so an untrimmed check here would have
        // classified a blank-opponent row as a game the title renders as a
        // non-game.
        guard let opponent, !opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .nonGame
        }
        switch site?.uppercased() {
        case "HOME": return .home
        case "AWAY": return .away
        case "NEUTRAL": return .neutral
        default: break
        }
        switch summaryVenuePrefix {
        case "H": return .home
        case "A": return .away
        case "N": return .neutral
        default: break
        }
        switch isHome {
        case true: return .home
        case false: return .away
        case nil: return .neutral
        }
    }

    /// A leading `[H]` / `[A]` / `[N]` marker. Stored summaries arrive already
    /// cleaned of it, same as on web -- this is the shared fallback rung, not a
    /// path either client reaches from `/api/calendar-events` today.
    private var summaryVenuePrefix: String? {
        let trimmed = summary.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3, trimmed.hasPrefix("[") else { return nil }
        let marker = trimmed[trimmed.index(trimmed.startIndex, offsetBy: 1)]
        guard trimmed[trimmed.index(trimmed.startIndex, offsetBy: 2)] == "]" else { return nil }
        return String(marker).uppercased()
    }
}

extension ScheduleEvent {
    /// All-day events encode calendar dates, not instants, so their raw
    /// timestamps cannot answer this. An imported ICS all-day event is stored at
    /// UTC midnight (`calendar-sync.ts` writes `Date.UTC(y, m, d)`), which in
    /// Central lands `startsAt` at 7 PM the evening before and the exclusive
    /// `endsAt` at 7 PM on the day itself. Comparing those instants marked a
    /// one-day all-day event "Now" from the previous night and dimmed it to
    /// "Ended" while it was still running. Compare calendar days instead,
    /// against the same UTC-read span the Schedule list groups by.
    var timeState: ScheduleEventTimeState { timeState(now: .now) }

    /// Injectable `now` so the all-day branch can be tested without depending on
    /// the wall clock: the whole defect is a several-hour offset, so a test that
    /// reads the real time only reproduces it during part of the day.
    func timeState(now: Date) -> ScheduleEventTimeState {
        guard displayAllDay else {
            if endsAt <= now { return .past }
            if startsAt <= now { return .live }
            return .upcoming
        }
        let today = Calendar.current.startOfDay(for: now)
        if today > displayEndDay { return .past }
        if today >= displayStartDay { return .live }
        return .upcoming
    }
}

// MARK: - Multi-day spans

extension ScheduleEvent {
    /// All-day events store calendar dates as ISO instants whose UTC date
    /// component is the event date. The clock time is not display semantics:
    /// manual events may be stored as Central midnight (`05:00Z`) while imported
    /// ICS all-day events are UTC midnight. Read only the UTC Y/M/D components
    /// so device timezone never changes the covered dates.
    private var dayComponentsCalendar: Calendar {
        guard allDay else { return .current }
        var cal = Calendar(identifier: .gregorian)
        if let utc = TimeZone(identifier: "UTC") { cal.timeZone = utc }
        return cal
    }

    var displayAllDay: Bool {
        allDay || hasLocalMidnightSpan
    }

    /// Heuristic for *timed* events whose start and end land exactly on local
    /// midnight (so they should display like all-day). True all-day events take
    /// the `allDay` flag path above and are handled in UTC.
    private var hasLocalMidnightSpan: Bool {
        guard !allDay, endsAt > startsAt else { return false }
        let calendar = Calendar.current
        let startOfStartDay = calendar.startOfDay(for: startsAt)
        let startOfEndDay = calendar.startOfDay(for: endsAt)
        guard startOfEndDay > startOfStartDay else { return false }
        return abs(startsAt.timeIntervalSince(startOfStartDay)) < 60 &&
            abs(endsAt.timeIntervalSince(startOfEndDay)) < 60
    }

    /// The reference end instant for local timed span math. Midnight-span
    /// timed events carry an exclusive end, so step back a second to land on
    /// the true last day. True all-day events use `spanEndDay` below because
    /// their end must be floored to the encoded calendar date before subtracting
    /// a day.
    private var spanEndDate: Date {
        displayAllDay ? endsAt.addingTimeInterval(-1) : endsAt
    }

    private var spanStartDay: Date {
        displayDay(for: startsAt)
    }

    private var spanEndDay: Date {
        if allDay {
            let start = spanStartDay
            let rawEndExclusiveDay = displayDay(for: endsAt)
            guard rawEndExclusiveDay > start else { return start }
            return Calendar.current.date(byAdding: .day, value: -1, to: rawEndExclusiveDay) ?? start
        }
        return displayDay(for: spanEndDate)
    }

    /// The local-midnight `Date` for a given instant's calendar day — read in
    /// UTC for all-day events, locally otherwise. Returning local-midnight keeps
    /// grouping keys and the (locally-formatted) date headers consistent across
    /// all-day and timed events that fall on the same day.
    private func displayDay(for instant: Date) -> Date {
        let comps = dayComponentsCalendar.dateComponents([.year, .month, .day], from: instant)
        return Calendar.current.date(from: DateComponents(
            year: comps.year, month: comps.month, day: comps.day
        )) ?? Calendar.current.startOfDay(for: instant)
    }

    /// True when the event covers more than one calendar day.
    var isMultiDay: Bool {
        spanStartDay != spanEndDay
    }

    /// Local start-of-day for every calendar day the event covers, inclusive.
    /// Single-day events return just their start day.
    var spannedDays: [Date] {
        let cal = Calendar.current
        let start = spanStartDay
        let end = spanEndDay
        guard end > start else { return [start] }
        var days: [Date] = []
        var cursor = start
        while cursor <= end {
            days.append(cursor)
            guard let next = cal.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return days
    }

    var dayCount: Int { spannedDays.count }

    /// Local midnight of the first calendar day the event covers.
    ///
    /// Anything *displaying* an event's date needs this rather than `startsAt`:
    /// the raw instant of an all-day event is a UTC-encoded calendar date, and
    /// formatting it locally names the previous evening. This is the Swift
    /// counterpart of `calendarDate(iso, allDay)` in `src/lib/format.ts`.
    var displayStartDay: Date { spanStartDay }

    /// Local midnight of the last calendar day the event covers, inclusive --
    /// already stepped back off an all-day event's exclusive end.
    var displayEndDay: Date { spanEndDay }

    /// 1-based position of `day` within the span (for "Day n of m"); nil if the
    /// day isn't part of the span.
    func dayIndex(for day: Date) -> Int? {
        let cal = Calendar.current
        return spannedDays.firstIndex { cal.isDate($0, inSameDayAs: day) }.map { $0 + 1 }
    }
}

// MARK: - My Shifts

struct MyShift: Codable, Identifiable, Hashable {
    static func == (lhs: MyShift, rhs: MyShift) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let area: String
    let workerType: String
    let startsAt: Date
    let endsAt: Date
    let status: String
    let event: MyShiftEvent
    let gear: ShiftGear
}

struct MyShiftEvent: Codable {
    let id: String
    let summary: String
    let startsAt: Date
    let endsAt: Date
    let sportCode: String?
    let isHome: Bool?
    let opponent: String?
    /// `/api/my-shifts` sends both halves of the mapped pickup location. The id
    /// is decoded so `asScheduleEvent` can rebuild a real `EventLocation`
    /// instead of dropping the venue on the floor.
    let locationId: String?
    let locationName: String?
}

struct ShiftGear: Codable {
    let status: String
    let bookings: [ShiftGearBooking]

    var hasGear: Bool { status != "none" }
    var gearLabel: String {
        switch status {
        case "checked_out": return "Gear out"
        case "pickup_ready": return "Gear ready"
        case "reserved":    return "Gear reserved"
        case "draft":       return "Gear draft"
        default:            return "No gear"
        }
    }
}

extension MyShift {
    /// Lets a shift be titled and routed with the same helpers the Schedule tab
    /// uses, so "Football vs Notre Dame" is constructed once.
    ///
    /// `location` was hardcoded nil here while `MyShiftEvent` was already
    /// decoding the venue, so an event opened from Profile or a user's roster
    /// rendered with no venue line at all — the same event showed its venue from
    /// the Schedule tab and lost it from Profile. `DashboardEventWork` does this
    /// correctly and is the reference.
    ///
    /// `allDay` and `status` stay hardcoded because `MyShiftEvent` carries
    /// neither; fixing those needs `/api/my-shifts` to send them.
    var asScheduleEvent: ScheduleEvent {
        ScheduleEvent(
            id: event.id,
            summary: event.summary,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: false,
            status: "CONFIRMED",
            sportCode: event.sportCode,
            opponent: event.opponent,
            isHome: event.isHome,
            location: event.locationId.map { EventLocation(id: $0, name: event.locationName ?? "") }
        )
    }
}

struct ShiftGearBooking: Codable, Identifiable {
    let id: String
    let status: String
    let kind: String
    let itemCount: Int
}

// MARK: - Shift Group Detail (for event detail sheet)

struct EventShiftGroup: Codable, Identifiable {
    let id: String
    let eventId: String
    let notes: String?
    let event: ShiftGroupEvent
    let shifts: [EventShift]
    let coverage: ShiftCoverage
}

struct ShiftGroupEvent: Codable, Identifiable {
    let id: String
    let summary: String
    let startsAt: Date
    let endsAt: Date
    let sportCode: String?
    let isHome: Bool?
    let opponent: String?
    let locationId: String?
}

/// The current viewer's pending request for one open Student slot. It is
/// intentionally not the full assignment queue: other students' requests are
/// staff-only, while a student only needs to know whether their own claim is
/// awaiting review.
struct ViewerShiftRequest: Codable, Identifiable {
    let id: String
    let status: String
    let hasConflict: Bool?
    let conflictNote: String?
}

struct EventShift: Codable, Identifiable {
    let id: String
    let area: String
    let workerType: String
    let startsAt: Date
    let endsAt: Date
    let callStartsAt: Date?
    let callEndsAt: Date?
    let notes: String?
    let assignments: [ShiftAssignmentRecord]
    let viewerRequest: ViewerShiftRequest?

    private enum CodingKeys: String, CodingKey {
        case id, area, workerType, startsAt, endsAt, callStartsAt, callEndsAt, notes, assignments, viewerRequest
    }

    init(
        id: String,
        area: String,
        workerType: String,
        startsAt: Date,
        endsAt: Date,
        callStartsAt: Date? = nil,
        callEndsAt: Date? = nil,
        notes: String?,
        assignments: [ShiftAssignmentRecord],
        viewerRequest: ViewerShiftRequest? = nil
    ) {
        self.id = id
        self.area = area
        self.workerType = workerType
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.callStartsAt = callStartsAt
        self.callEndsAt = callEndsAt
        self.notes = notes
        self.assignments = assignments
        self.viewerRequest = viewerRequest
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        area = try container.decode(String.self, forKey: .area)
        workerType = try container.decode(String.self, forKey: .workerType)
        startsAt = try container.decode(Date.self, forKey: .startsAt)
        endsAt = try container.decode(Date.self, forKey: .endsAt)
        callStartsAt = try container.decodeIfPresent(Date.self, forKey: .callStartsAt)
        callEndsAt = try container.decodeIfPresent(Date.self, forKey: .callEndsAt)
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        assignments = try container.decodeIfPresent([ShiftAssignmentRecord].self, forKey: .assignments) ?? []
        viewerRequest = try container.decodeIfPresent(ViewerShiftRequest.self, forKey: .viewerRequest)
    }

    var isOpen: Bool { assignments.isEmpty }
    var effectiveStartsAt: Date { callStartsAt ?? startsAt }
    var effectiveEndsAt: Date { callEndsAt ?? endsAt }
}

struct ShiftAssignmentRecord: Codable, Identifiable {
    let id: String
    let status: String
    let user: ShiftWorker
    /// OPEN/CLAIMED trade on this assignment, when one exists. Optional so
    /// older payloads (and the create-group response) still decode.
    let activeTrade: ActiveTradeRef?

    enum CodingKeys: String, CodingKey {
        case id, status, user, activeTrade
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decode(String.self, forKey: .status)
        user = try c.decode(ShiftWorker.self, forKey: .user)
        activeTrade = try c.decodeIfPresent(ActiveTradeRef.self, forKey: .activeTrade)
    }

    init(id: String, status: String, user: ShiftWorker, activeTrade: ActiveTradeRef? = nil) {
        self.id = id
        self.status = status
        self.user = user
        self.activeTrade = activeTrade
    }

    var isOnTradeBoard: Bool { activeTrade != nil }
}

/// Minimal reference to an open Trade Board post attached to an assignment.
struct ActiveTradeRef: Codable {
    let id: String
    let status: String
}

// MARK: - Native working schedule editor

struct WorkingScheduleChanges: Codable {
    let addedSlots: Int
    let removedSlots: Int
    let convertedSlots: Int
    let assignmentChanges: Int
    let callWindowChanges: Int
    let total: Int

    var summary: String {
        var parts: [String] = []
        if addedSlots > 0 { parts.append("\(addedSlots) added") }
        if removedSlots > 0 { parts.append("\(removedSlots) removed") }
        if convertedSlots > 0 { parts.append("\(convertedSlots) converted") }
        if assignmentChanges > 0 { parts.append("\(assignmentChanges) assignments") }
        if callWindowChanges > 0 { parts.append("\(callWindowChanges) call windows") }
        return parts.isEmpty ? "No pending changes" : parts.joined(separator: " · ")
    }
}

struct WorkingScheduleUser: Codable, Identifiable {
    let id: String
    let name: String
    let role: String?
    let staffingType: String?
    let primaryArea: String?
    let avatarUrl: String?
}

struct WorkingScheduleAssignment: Codable {
    let sourceAssignmentId: String?
    let userId: String
    let status: String
    let callStartsAt: Date?
    let callEndsAt: Date?
    let callNote: String?
    let activeTradeId: String?
    let bookingCount: Int
}

struct WorkingScheduleSlot: Codable, Identifiable {
    let key: String
    let sourceShiftId: String?
    let area: String
    let workerType: String
    let startsAt: Date
    let endsAt: Date
    let callStartsAt: Date?
    let callEndsAt: Date?
    let notes: String?
    let assignmentHistoryCount: Int
    let assignment: WorkingScheduleAssignment?

    var id: String { key }
}

struct WorkingSchedulePayload: Codable {
    let eventStartsAt: Date
    let eventEndsAt: Date
    let slots: [WorkingScheduleSlot]
}

struct WorkingScheduleDefaultWindow: Codable {
    let startsAt: Date
    let endsAt: Date
}

struct WorkingScheduleEditor: Codable, Identifiable {
    let shiftGroupId: String
    let publicationState: String
    let publishedAt: Date?
    let publishedVersion: Int
    let workingVersion: Int
    let basePublishedVersion: Int
    let hasWorkingCopy: Bool
    let updatedAt: Date?
    let updatedById: String?
    let autoReleaseAt: Date?
    let autoReleaseRunId: String?
    let autoReleaseError: String?
    let changes: WorkingScheduleChanges
    let affectedWorkerCount: Int
    let assignedUsers: [WorkingScheduleUser]
    let defaultWindow: WorkingScheduleDefaultWindow?
    let schedule: WorkingSchedulePayload

    var id: String { shiftGroupId }
    var hasUnpublishedChanges: Bool { hasWorkingCopy && changes.total > 0 }

    func eventShifts() -> [EventShift] {
        let users = Dictionary(uniqueKeysWithValues: assignedUsers.map { ($0.id, $0) })
        return schedule.slots.map { slot in
            let assignment = slot.assignment.map { draftAssignment in
                let profile = users[draftAssignment.userId]
                let worker = ShiftWorker(
                    id: draftAssignment.userId,
                    name: profile?.name ?? "Assigned worker",
                    primaryArea: profile?.primaryArea,
                    avatarUrl: profile?.avatarUrl,
                    role: profile?.role,
                    staffingType: profile?.staffingType
                )
                let trade = draftAssignment.activeTradeId.map { ActiveTradeRef(id: $0, status: "OPEN") }
                return ShiftAssignmentRecord(
                    id: draftAssignment.sourceAssignmentId ?? "working:\(slot.key)",
                    status: draftAssignment.status,
                    user: worker,
                    activeTrade: trade
                )
            }
            return EventShift(
                id: slot.key,
                area: slot.area,
                workerType: slot.workerType,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
                callStartsAt: slot.workerType == "ST" ? slot.assignment?.callStartsAt ?? slot.callStartsAt : nil,
                callEndsAt: slot.workerType == "ST" ? slot.assignment?.callEndsAt ?? slot.callEndsAt : nil,
                notes: slot.notes,
                assignments: assignment.map { [$0] } ?? []
            )
        }
    }
}

struct SchedulePublicationState: Codable {
    let status: String
    let publishedAt: Date?
    let publishedById: String?
    let changedAfterPublish: Bool
    let activeAssignmentCount: Int
    let acknowledgedCount: Int
    let unacknowledgedCount: Int
}

struct ShiftWorker: Codable, Identifiable {
    let id: String
    let name: String
    let primaryArea: String?
    let avatarUrl: String?
    let role: String?
    let staffingType: String?

    /// Mirrors web `shiftWorkerTypeForProfile`: explicit staffing type wins,
    /// then role. Gates staff-on-behalf Trade Board posting to student shifts.
    var isStudentSchedulingClass: Bool {
        if staffingType == "ST" { return true }
        if staffingType == "FT" { return false }
        return role == "STUDENT"
    }
}

// MARK: - Sport Roster

struct RosterEntry: Codable, Identifiable {
    let id: String
    let userId: String
    let sportCode: String
    let user: RosterUser
}

struct RosterUser: Codable, Identifiable {
    let id: String
    let name: String
    let email: String
    let role: String
    let primaryArea: String?
}

// MARK: - Assignment candidates

/// Staff-only recommendation context from `/api/shifts/[id]/candidate-scores`.
/// Defaults keep the picker usable if the server adds or temporarily omits
/// nonessential scoring fields during rollout.
struct CandidateRecommendation: Decodable, Identifiable {
    var id: String { userId }
    let userId: String
    let bucket: String
    let score: Int
    let reasons: [CandidateScoreSignal]
    let warnings: [CandidateScoreSignal]
    let blockingConflict: Bool
    let advisoryConflict: Bool
    let advisoryConflictNote: String?

    private enum CodingKeys: String, CodingKey {
        case userId, bucket, score, reasons, warnings
        case blockingConflict, advisoryConflict, advisoryConflictNote
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userId = try container.decode(String.self, forKey: .userId)
        bucket = try container.decodeIfPresent(String.self, forKey: .bucket) ?? "good_fit"
        score = try container.decodeIfPresent(Int.self, forKey: .score) ?? 0
        reasons = try container.decodeIfPresent([CandidateScoreSignal].self, forKey: .reasons) ?? []
        warnings = try container.decodeIfPresent([CandidateScoreSignal].self, forKey: .warnings) ?? []
        blockingConflict = try container.decodeIfPresent(Bool.self, forKey: .blockingConflict) ?? false
        advisoryConflict = try container.decodeIfPresent(Bool.self, forKey: .advisoryConflict) ?? false
        advisoryConflictNote = try container.decodeIfPresent(String.self, forKey: .advisoryConflictNote)
    }

    var fitLabel: String {
        switch bucket {
        case "recommended": "Recommended"
        case "good_fit": "Good fit"
        case "overloaded": "Heavy workload"
        default: "Review"
        }
    }

    var primaryContext: String? {
        reasons.first?.label ?? warnings.first?.label
    }

    var warningContext: String? {
        advisoryConflictNote ?? warnings.first?.label
    }
}

struct CandidateScoreSignal: Decodable {
    let code: String
    let label: String
    let weight: Int?
}

struct ShiftCoverage: Codable {
    let total: Int
    let filled: Int
    let percentage: Int
}

// MARK: - Response Wrappers

struct ScheduleEventsResponse: Decodable {
    let data: [ScheduleEvent]
    let total: Int
}

struct MyShiftsResponse: Decodable {
    let data: [MyShift]
    /// Whose shifts the server actually answered for. Absent on servers that
    /// predate the `userId` filter, which is the case this exists to catch.
    let userId: String?
    /// Pagination metadata is optional for rollout tolerance with older
    /// servers; the native client stops after the first page when absent.
    let total: Int?
    let limit: Int?
    let offset: Int?
}

// MARK: - Availability blocks

/// An unavailability window (usually a class) that warns staff during shift
/// assignment. `startsAt`/`endsAt` are local wall-clock "HH:mm"; `dayOfWeek`
/// is 0 = Sunday … 6 = Saturday and is nil for AD_HOC blocks, which may cover
/// one date or an inclusive date range. New range/all-day fields stay optional
/// so older server payloads and saved blocks remain safe during rollout.
struct AvailabilityBlock: Codable, Identifiable {
    let id: String
    let kind: String?
    let intent: String?
    let status: String?
    let dayOfWeek: Int?
    let date: String?
    let dateEndsOn: String?
    let allDay: Bool?
    let startsAt: String
    let endsAt: String
    let label: String?
    let semesterLabel: String?
    let semesterStartsOn: String?
    let semesterEndsOn: String?
    let reviewNote: String?
}

struct AvailabilityBlocksResponse: Decodable {
    let data: [AvailabilityBlock]
}

struct ShiftGroupsResponse: Decodable {
    let data: [EventShiftGroup]
    let total: Int
}

// MARK: - Collaborator published schedule

struct PublishedScheduleResponse: Decodable {
    let data: [PublishedScheduleEvent]
    let total: Int
    let limit: Int
    let offset: Int
}

struct PublishedScheduleEvent: Codable, Identifiable {
    let id: String
    let event: PublishedEventSummary
    let crew: [PublishedCrewMember]
    var isFollowing: Bool
}

struct PublishedEventSummary: Codable {
    let id: String
    let summary: String
    let subtitle: String?
    let startsAt: Date
    let endsAt: Date
    let allDay: Bool
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
    let venue: EventLocation?
}

struct PublishedCrewMember: Codable, Identifiable {
    var id: String { assignmentId }
    let assignmentId: String
    let shiftId: String
    let person: PublishedCrewPerson
    let area: String
    let role: String
    let startsAt: Date
    let endsAt: Date
    /// Absent for an all-day event, which has no call time.
    let callStartsAt: Date?
    let callEndsAt: Date?
}

struct PublishedCrewPerson: Codable, Identifiable {
    let id: String
    let name: String
    let avatarUrl: String?
}

// MARK: - Helpers

let SPORT_LABELS: [String: String] = [
    "MBB": "Men's Basketball",
    "MXC": "Men's Cross Country",
    "FB":  "Football",
    "MGOLF": "Men's Golf",
    "MHKY": "Men's Hockey",
    "MROW": "Men's Rowing",
    "MSOC": "Men's Soccer",
    "MSWIM": "Men's Swimming & Diving",
    "MTEN": "Men's Tennis",
    "MTRACK": "Men's Track & Field",
    "WRES": "Wrestling",
    "WBB": "Women's Basketball",
    "WXC": "Women's Cross Country",
    "WGOLF": "Women's Golf",
    "WHKY": "Women's Hockey",
    "LROW": "Lightweight Rowing",
    "WROW": "Women's Rowing",
    "WSOC": "Women's Soccer",
    "SB":  "Softball",
    "WSWIM": "Women's Swimming & Diving",
    "WTEN": "Women's Tennis",
    "WTRACK": "Women's Track & Field",
    "VB":  "Volleyball",
]

func sportLabel(_ code: String?) -> String? {
    guard let code else { return nil }
    return SPORT_LABELS[code] ?? code
}

func scheduleEventDisplayTitle(_ event: ScheduleEvent) -> String {
    if let opponent = event.opponent, !opponent.isEmpty {
        var parts: [String] = []
        if let code = event.sportCode {
            parts.append(sportLabel(code) ?? code)
        }
        switch event.isHome {
        case true:  parts.append("vs \(opponent)")
        case false: parts.append("at \(opponent)")
        // Neutral-site games still read as "vs" -- a bare dash scanned as a
        // subtitle rather than an opponent. The neutral site itself stays
        // visible via the row's "Neutral" meta label.
        case nil:   parts.append("vs \(opponent)")
        }
        return parts.joined(separator: " ")
    }

    let title = cleanScheduleEventSummary(event.summary)
    if !title.isEmpty { return title }
    if let code = event.sportCode { return sportLabel(code) ?? code }
    return "Event"
}

// MARK: - Venue display

/// The venue every schedule surface shows: the mapped Wisconsin Creative location
/// name when the event has one, otherwise the imported calendar text with its
/// city/state qualifier stripped.
///
/// Schedule rows and Event detail derived this separately and disagreed — the
/// dense row stripped the qualifier while the detail header printed the raw
/// string, so the same event read "McClimon Track/Soccer Complex" in the list
/// and "Madison, WI, McClimon Track/Soccer Complex" (wrapped over two lines)
/// once opened.
func scheduleEventVenueName(_ event: ScheduleEvent) -> String? {
    if let name = event.location?.name, !name.isEmpty { return name }
    guard let raw = event.rawLocationText?.trimmingCharacters(in: .whitespacesAndNewlines),
          !raw.isEmpty else { return nil }
    return scheduleVenueDisplayName(raw)
}

/// The venue component of an imported calendar location.
///
/// Every venue this feed produces is a single comma component wrapped in a
/// "City, ST" qualifier — "Madison, WI, Camp Randall Stadium",
/// "Green Bay, Wis., Lambeau Field", "Iowa City, IA, Carver-Hawkeye Arena".
/// Some sources trail the qualifier instead ("Camp Randall Stadium, Madison,
/// WI"). Only the venue belongs on a schedule surface — the qualifier is what
/// pushes the real name into truncation — so this returns the venue alone,
/// never a venue with trailing detail attached.
///
/// The one shape that keeps its qualifier is a location with no venue at all
/// ("Iowa City, IA"). The city is then the only location there is, and dropping
/// the state would leave it reading like a truncation.
func scheduleVenueDisplayName(_ raw: String) -> String {
    let parts = raw
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }

    guard let venueOrCity = parts.first else { return raw }
    guard parts.count >= 2 else { return venueOrCity }

    // "City, ST" and nothing else.
    if parts.count == 2, isVenueStateToken(parts[1]) {
        return parts.joined(separator: ", ")
    }
    // "City, ST, <venue>".
    if parts.count >= 3, isVenueStateToken(parts[1]) {
        return parts[2]
    }
    // "<venue>, City, ST" — and every other shape, where the venue leads.
    return venueOrCity
}

/// Matches both postal codes ("WI") and the AP-style abbreviations the
/// imported feed uses ("Wis.", "Minn.", "Calif.").
private func isVenueStateToken(_ token: String) -> Bool {
    if token.count == 2, token.allSatisfy({ $0.isUppercase && $0.isLetter }) { return true }
    return token.hasSuffix(".")
        && token.count <= 7
        && token.dropLast().allSatisfy(\.isLetter)
}

func cleanScheduleEventSummary(_ raw: String) -> String {
    var s = raw
    // Strip leading home/away bracket: [W], [L], [H], [A], [N], etc.
    s = s.replacingOccurrences(of: #"^\[[A-Za-z]\]\s*"#, with: "", options: .regularExpression)
    // Strip "Wisconsin Badgers " or "Wisconsin " team prefix.
    s = s.replacingOccurrences(of: #"^Wisconsin Badgers\s+"#, with: "", options: .regularExpression)
    s = s.replacingOccurrences(of: #"^Wisconsin\s+"#, with: "", options: .regularExpression)
    // Strip trailing annotation like " (VIDEO)".
    s = s.replacingOccurrences(of: #"\s+\([A-Z]+\)$"#, with: "", options: .regularExpression)
    // Collapse extra whitespace.
    return s.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: " ")
}

// MARK: - Shift area label

extension String {
    /// Title-cased label for a server-typed shift area code.
    /// `"VIDEO"` → `"Video"`, `"GRAPHICS"` → `"Graphics"`. Mirrors the labels
    /// in `ShiftAreaOption` (the picker enum in `AddShiftSheet.swift`) and the
    /// web's `AREA_LABELS`, so every user-visible surface speaks the same name.
    /// Falls back to word-broken title case for any future server area code.
    var shiftAreaLabel: String {
        switch self {
        case "VIDEO":    return "Video"
        case "PHOTO":    return "Photo"
        case "GRAPHICS": return "Graphics"
        case "SOCIAL":   return "Social"
        case "COMMS":    return "Comms"
        case "LIVE_PRODUCTION": return "Live Production"
        // Underscores in a server area code are word breaks. Title-casing
        // around them printed "Live_production" on every surface that named
        // an area this way.
        default:         return replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
