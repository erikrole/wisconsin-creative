import Testing
import Foundation
@testable import Wisconsin

/// Locks in the all-day / multi-day day math for `ScheduleEvent`.
///
/// All-day events carry encoded calendar dates. Imported ICS all-day events can
/// arrive as UTC midnight, while manual all-day events can arrive as Central
/// midnight (`05:00Z` during daylight saving). In both cases the UTC Y/M/D
/// components are the event dates and the clock time must not turn a single-day
/// event into "Day 1/2" on non-UTC devices.
///
/// Serialized because each test overrides the process-wide default time zone.
@Suite(.serialized)
struct ScheduleDateMathTests {

    // MARK: Helpers

    /// A UTC-midnight instant for the given calendar date.
    private func utcMidnight(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: DateComponents(year: year, month: month, day: day))!
    }

    /// A Central-midnight all-day instant as it appears in the live API during
    /// daylight saving time, e.g. Lambeau Field Visit:
    /// `2026-06-17T05:00:00.000Z` → `2026-06-18T05:00:00.000Z`.
    private func centralDaylightMidnightEncoded(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: DateComponents(year: year, month: month, day: day, hour: 5))!
    }

    /// Local midnight for the given calendar date (in the active default zone).
    private func localMidnight(_ year: Int, _ month: Int, _ day: Int) -> Date {
        Calendar.current.date(from: DateComponents(year: year, month: month, day: day))!
    }

    private func allDayEvent(start: Date, end: Date) -> ScheduleEvent {
        ScheduleEvent(
            id: "e", summary: "Test", startsAt: start, endsAt: end, allDay: true,
            status: "CONFIRMED", sportCode: nil, opponent: nil, isHome: nil, location: nil
        )
    }

    /// Run `body` with the process default time zone pinned, then restore it.
    private func withTimeZone(_ identifier: String, _ body: () -> Void) {
        let previous = NSTimeZone.default
        NSTimeZone.default = TimeZone(identifier: identifier)!
        defer { NSTimeZone.default = previous }
        body()
    }

    // MARK: All-day, single day

    @Test func singleDayAllDayEventIsNotMultiDay_pacific() {
        withTimeZone("America/Los_Angeles") {
            // Lambeau-shaped one-day all-day event: Central midnight Jun 17
            // through exclusive Central midnight Jun 18.
            let event = allDayEvent(
                start: centralDaylightMidnightEncoded(2026, 6, 17),
                end: centralDaylightMidnightEncoded(2026, 6, 18)
            )
            #expect(event.isMultiDay == false)
            #expect(event.dayCount == 1)
            #expect(event.spannedDays == [localMidnight(2026, 6, 17)])
        }
    }

    // MARK: All-day, multi day

    @Test func twoDayAllDayEventSpansTwoCorrectDays_pacific() {
        withTimeZone("America/Los_Angeles") {
            // All-day Jul 7-8: Central midnight Jul 7 through exclusive
            // Central midnight Jul 9.
            let event = allDayEvent(
                start: centralDaylightMidnightEncoded(2026, 7, 7),
                end: centralDaylightMidnightEncoded(2026, 7, 9)
            )
            #expect(event.isMultiDay == true)
            #expect(event.dayCount == 2)

            let d7 = localMidnight(2026, 7, 7)
            let d8 = localMidnight(2026, 7, 8)
            #expect(event.spannedDays == [d7, d8])
            #expect(event.dayIndex(for: d7) == 1)
            #expect(event.dayIndex(for: d8) == 2)
        }
    }

    // MARK: Timezone independence

    @Test func allDayEventReadsIdenticallyAcrossTimeZones() {
        let event = allDayEvent(
            start: centralDaylightMidnightEncoded(2026, 6, 17),
            end: centralDaylightMidnightEncoded(2026, 6, 18)
        )
        var pacific = -1
        var utc = -1
        var tokyo = -1
        withTimeZone("America/Los_Angeles") { pacific = event.dayCount }
        withTimeZone("UTC") { utc = event.dayCount }
        withTimeZone("Asia/Tokyo") { tokyo = event.dayCount }
        #expect(pacific == 1)
        #expect(utc == 1)
        #expect(tokyo == 1)
    }

    // MARK: Timed events stay local

    @Test func timedEventUsesLocalCalendarDay_pacific() {
        withTimeZone("America/Los_Angeles") {
            let start = Calendar.current.date(from: DateComponents(year: 2026, month: 7, day: 7, hour: 14))!
            let end = Calendar.current.date(from: DateComponents(year: 2026, month: 7, day: 7, hour: 16))!
            let event = ScheduleEvent(
                id: "t", summary: "Game", startsAt: start, endsAt: end, allDay: false,
                status: "CONFIRMED", sportCode: "FB", opponent: nil, isHome: true, location: nil
            )
            #expect(event.isMultiDay == false)
            #expect(event.dayCount == 1)
            #expect(event.spannedDays == [localMidnight(2026, 7, 7)])
        }
    }
}

/// Locks in the venue name Schedule rows and Event detail both render.
///
/// Imported events wrap the venue in a "City, ST" qualifier on either end. Only
/// the venue is useful on either surface, but the qualifier must come off only
/// when the component beside the city really is a state, so a venue that
/// legitimately contains commas is not truncated into nonsense.
struct ScheduleVenueNameTests {

    private func event(location: EventLocation?, rawLocationText: String?) -> ScheduleEvent {
        var event = ScheduleEvent(
            id: "e", summary: "Game", startsAt: .now, endsAt: .now, allDay: false,
            status: "CONFIRMED", sportCode: "WSOC", opponent: "BYU", isHome: true,
            location: location
        )
        event.rawLocationText = rawLocationText
        return event
    }

    // MARK: Leading "City, ST" — the shape the live feed sends

    @Test func namesVenueAfterPostalStateQualifier() {
        #expect(scheduleVenueDisplayName("Madison, WI, Camp Randall Stadium") == "Camp Randall Stadium")
        #expect(scheduleVenueDisplayName("Madison, WI, Goodman Diamond") == "Goodman Diamond")
        #expect(scheduleVenueDisplayName("Minneapolis, MN, Target Field") == "Target Field")
        #expect(scheduleVenueDisplayName("Iowa City, IA, Carver-Hawkeye Arena") == "Carver-Hawkeye Arena")
    }

    @Test func namesVenueAfterApStyleStateQualifier() {
        #expect(scheduleVenueDisplayName("Green Bay, Wis., Lambeau Field") == "Lambeau Field")
        #expect(scheduleVenueDisplayName("Madison, Wis., McClimon Track/Soccer Complex")
            == "McClimon Track/Soccer Complex")
    }

    /// A slash inside the venue is part of its name, not a separator.
    @Test func keepsSlashesInsideTheVenueName() {
        #expect(scheduleVenueDisplayName("Madison, WI, McClimon Track/Soccer Complex")
            == "McClimon Track/Soccer Complex")
    }

    @Test func toleratesRaggedFeedWhitespace() {
        #expect(scheduleVenueDisplayName("Green Bay, Wis.,  Lambeau Field") == "Lambeau Field")
    }

    // MARK: Trailing "City, ST"

    @Test func namesVenueBeforePostalStateQualifier() {
        #expect(scheduleVenueDisplayName("Camp Randall Stadium, Madison, WI") == "Camp Randall Stadium")
    }

    @Test func namesVenueBeforeApStyleStateQualifier() {
        #expect(scheduleVenueDisplayName("Lambeau Field, Green Bay, Wis.") == "Lambeau Field")
    }

    // MARK: The venue is one component

    /// Trailing detail after the venue is not part of its name. Whatever the
    /// separator arrangement, a schedule surface names the venue and stops.
    @Test func dropsDetailTrailingTheVenue() {
        #expect(scheduleVenueDisplayName("Madison, WI, Kohl Center, Section 118") == "Kohl Center")
        #expect(scheduleVenueDisplayName("Kohl Center, Section 118") == "Kohl Center")
        #expect(scheduleVenueDisplayName("Kohl Center, Section 118, Madison, WI") == "Kohl Center")
    }

    // MARK: No venue to name

    /// An away location with no venue keeps its state — "Iowa City" alone reads
    /// like a truncation.
    @Test func keepsCityAndStateWhenThereIsNoVenue() {
        #expect(scheduleVenueDisplayName("Iowa City, IA") == "Iowa City, IA")
        #expect(scheduleVenueDisplayName("Madison, WI") == "Madison, WI")
    }

    @Test func passesThroughABareVenue() {
        #expect(scheduleVenueDisplayName("Camp Randall Stadium") == "Camp Randall Stadium")
        #expect(scheduleVenueDisplayName("UW Volleyball Arena Alias") == "UW Volleyball Arena Alias")
    }

    /// The sync feed has produced malformed venue text; it must survive intact
    /// rather than be parsed into something confidently wrong.
    @Test func passesThroughMalformedVenueText() {
        #expect(scheduleVenueDisplayName("Field (north") == "Field (north")
    }

    // MARK: Event resolution

    /// A mapped Wisconsin Creative location is admin-entered and shown verbatim — it
    /// is already the name the team uses, and it never carries a feed qualifier.
    @Test func mappedLocationWins() {
        let subject = event(
            location: EventLocation(id: "l", name: "McClimon Complex"),
            rawLocationText: "Madison, WI, McClimon Track/Soccer Complex"
        )
        #expect(scheduleEventVenueName(subject) == "McClimon Complex")
    }

    @Test func fallsBackToNamedRawVenue() {
        let subject = event(location: nil, rawLocationText: "Madison, WI, McClimon Track/Soccer Complex")
        #expect(scheduleEventVenueName(subject) == "McClimon Track/Soccer Complex")
    }

    @Test func returnsNilWithoutAnyVenue() {
        #expect(scheduleEventVenueName(event(location: nil, rawLocationText: nil)) == nil)
        #expect(scheduleEventVenueName(event(location: nil, rawLocationText: "   ")) == nil)
    }

    // MARK: Venue survives the entry point

    /// A shift opened from Profile or a user's roster goes through
    /// `MyShift.asScheduleEvent`, which hardcoded `location: nil` while
    /// `MyShiftEvent` was already decoding the venue. The same event showed its
    /// venue from the Schedule tab and lost it from Profile.
    @Test func myShiftCarriesItsVenueIntoTheDetailEvent() {
        let shift = MyShift(
            id: "s1", area: "VIDEO", workerType: "ST",
            startsAt: .now, endsAt: .now, status: "ASSIGNED",
            event: MyShiftEvent(
                id: "e1", summary: "Women's Soccer vs BYU",
                startsAt: .now, endsAt: .now,
                sportCode: "WSOC", isHome: true, opponent: "BYU",
                locationId: "loc-1", locationName: "McClimon Track/Soccer Complex"
            ),
            gear: ShiftGear(status: "none", bookings: [])
        )
        #expect(scheduleEventVenueName(shift.asScheduleEvent) == "McClimon Track/Soccer Complex")
    }

    /// An unmapped shift has a name but no location id; the venue still has to
    /// reach the header rather than being dropped for want of an id.
    @Test func myShiftWithoutALocationIdHasNoVenueRatherThanACrash() {
        let shift = MyShift(
            id: "s2", area: "PHOTO", workerType: "ST",
            startsAt: .now, endsAt: .now, status: "ASSIGNED",
            event: MyShiftEvent(
                id: "e2", summary: "Practice",
                startsAt: .now, endsAt: .now,
                sportCode: nil, isHome: nil, opponent: nil,
                locationId: nil, locationName: nil
            ),
            gear: ShiftGear(status: "none", bookings: [])
        )
        #expect(scheduleEventVenueName(shift.asScheduleEvent) == nil)
    }

    // MARK: Every surface agrees

    /// Schedule rows, Event detail, and the booking event picker all resolve the
    /// venue through the same helper. The picker previously kept only the last
    /// comma component, so these are exactly the cases where it disagreed.
    @Test func bookingPickerNamesVenueLastStringsCorrectly() {
        let subject = event(location: nil, rawLocationText: "Camp Randall Stadium, Madison, WI")
        #expect(subject.bookingEventPickerVenue == "Camp Randall Stadium")
        #expect(subject.bookingEventPickerVenue == scheduleEventVenueName(subject))
    }

    @Test func bookingPickerShowsMappedLocationVerbatim() {
        let subject = event(
            location: EventLocation(id: "l", name: "Kohl Center"),
            rawLocationText: "Madison, WI, Kohl Center"
        )
        #expect(subject.bookingEventPickerVenue == "Kohl Center")
        #expect(subject.bookingEventPickerVenue == scheduleEventVenueName(subject))
    }

    /// The picker used to rewrite this venue's real name to "McClimon Soccer
    /// Complex" to save six characters on a line that truncates anyway.
    @Test func bookingPickerKeepsTheRealVenueName() {
        let subject = event(location: nil, rawLocationText: "Madison, WI, McClimon Track/Soccer Complex")
        #expect(subject.bookingEventPickerVenue == "McClimon Track/Soccer Complex")
        #expect(subject.bookingEventPickerVenue == scheduleEventVenueName(subject))
    }
}

/// Locks in `ScheduleEvent.venue` against `venueToneFromEvent` in
/// `src/lib/venue-tone.ts`.
///
/// The two clients used to answer this differently: web read the stored `site`,
/// iOS read the `isHome` tri-state. `isHome == nil` means both "neutral site"
/// and "unclassified", which is the whole reason `site` exists — and a row can
/// carry `isHome == true` alongside `site == "NEUTRAL"`, which is where the two
/// surfaces visibly disagreed.
struct ScheduleVenueTests {

    private func event(
        summary: String = "WSOC vs BYU",
        opponent: String? = "BYU",
        isHome: Bool?,
        site: String? = nil
    ) -> ScheduleEvent {
        var subject = ScheduleEvent(
            id: "e", summary: summary, startsAt: .now, endsAt: .now, allDay: false,
            status: "CONFIRMED", sportCode: "WSOC", opponent: opponent, isHome: isHome,
            location: nil
        )
        subject.site = site
        return subject
    }

    // MARK: A stored site wins

    /// The regression this exists for. `classifySourceEvent` writes exactly this
    /// shape for a title marked "(Neutral)": the summary said "vs", so `isHome`
    /// stayed true, while `site` recorded the neutral finding.
    @Test func storedNeutralSiteBeatsAHomeIsHomeFlag() {
        #expect(event(isHome: true, site: "NEUTRAL").venue == .neutral)
    }

    @Test func storedSiteBeatsAConflictingIsHomeFlag() {
        #expect(event(isHome: false, site: "HOME").venue == .home)
        #expect(event(isHome: true, site: "AWAY").venue == .away)
    }

    /// `isHome == nil` alone cannot say which of these it is; `site` can.
    @Test func storedSiteResolvesTheNilIsHomeAmbiguity() {
        #expect(event(isHome: nil, site: "HOME").venue == .home)
        #expect(event(isHome: nil, site: "AWAY").venue == .away)
        #expect(event(isHome: nil, site: "NEUTRAL").venue == .neutral)
    }

    @Test func readsSiteCaseInsensitively() {
        #expect(event(isHome: nil, site: "home").venue == .home)
    }

    // MARK: No opponent is a non-game, whatever the site says

    @Test func noOpponentIsAlwaysNonGame() {
        #expect(event(summary: "Media Day", opponent: nil, isHome: nil).venue == .nonGame)
        #expect(event(summary: "Media Day", opponent: nil, isHome: true, site: "HOME").venue == .nonGame)
    }

    /// Web tests `!event.opponent`, so an empty string is a non-game there, and
    /// `scheduleEventDisplayTitle` already renders a blank-opponent row as one.
    /// A bare `opponent != nil` check classified it as a game.
    @Test func blankOpponentIsANonGame() {
        #expect(event(summary: "Media Day", opponent: "", isHome: true, site: "HOME").venue == .nonGame)
        #expect(event(summary: "Media Day", opponent: "   ", isHome: false).venue == .nonGame)
    }

    // MARK: Fallbacks, in the web's order

    @Test func fallsBackToABracketedTitlePrefix() {
        #expect(event(summary: "[A] WSOC vs BYU", isHome: nil).venue == .away)
        #expect(event(summary: "[H] WSOC at BYU", isHome: nil).venue == .home)
        #expect(event(summary: "[N] WSOC vs BYU", isHome: nil).venue == .neutral)
    }

    @Test func fallsBackToIsHomeLast() {
        #expect(event(isHome: true).venue == .home)
        #expect(event(isHome: false).venue == .away)
        #expect(event(isHome: nil).venue == .neutral)
    }

    @Test func ignoresABracketThatIsNotAVenueMarker() {
        #expect(event(summary: "[W] WSOC vs BYU", isHome: false).venue == .away)
        #expect(event(summary: "WSOC vs BYU", isHome: false).venue == .away)
    }

    // MARK: Colour vocabulary matches the web table

    @Test func neutralAndNonGameShareGrey() {
        #expect(venueTone(.home) == .green)
        #expect(venueTone(.away) == .orange)
        #expect(venueTone(.neutral) == .gray)
        #expect(venueTone(.nonGame) == .gray)
    }
}


/// Locks in that a *displayed* all-day date is the encoded calendar date, not
/// the raw instant.
///
/// `calendar-sync.ts` stores an imported all-day event as `Date.UTC(y, m, d)`.
/// Read locally in Central that instant is the previous evening, so every
/// surface formatting `startsAt` directly named the day before the one the
/// Schedule list -- which groups by `spannedDays` -- had just shown for the
/// same row, and the shared `timeState` flipped to "Ended" at 7 PM on the day
/// the event was actually running.
///
/// Serialized because each test overrides the process-wide default time zone.
@Suite(.serialized)
struct ScheduleAllDayDisplayTests {

    private func utcMidnight(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: DateComponents(year: year, month: month, day: day))!
    }

    private func localMidnight(_ year: Int, _ month: Int, _ day: Int) -> Date {
        Calendar.current.date(from: DateComponents(year: year, month: month, day: day))!
    }

    /// A local wall-clock instant in the active default zone.
    private func local(_ year: Int, _ month: Int, _ day: Int, _ hour: Int) -> Date {
        Calendar.current.date(from: DateComponents(
            year: year, month: month, day: day, hour: hour
        ))!
    }

    private func allDayEvent(start: Date, end: Date) -> ScheduleEvent {
        ScheduleEvent(
            id: "e", summary: "Big Ten Championships", startsAt: start, endsAt: end,
            allDay: true, status: "CONFIRMED", sportCode: "WSWIM", opponent: nil,
            isHome: nil, location: nil
        )
    }

    private func timedEvent(start: Date, end: Date) -> ScheduleEvent {
        ScheduleEvent(
            id: "e", summary: "WSOC vs BYU", startsAt: start, endsAt: end,
            allDay: false, status: "CONFIRMED", sportCode: "WSOC", opponent: "BYU",
            isHome: true, location: nil
        )
    }

    private func withTimeZone(_ identifier: String, _ body: () -> Void) {
        let previous = NSTimeZone.default
        NSTimeZone.default = TimeZone(identifier: identifier)!
        defer { NSTimeZone.default = previous }
        body()
    }

    // MARK: Display days

    /// The regression: `2026-06-17T00:00:00Z` is Jun 16, 7 PM in Central.
    @Test func displayDaysReadTheEncodedDateNotTheLocalInstant() {
        withTimeZone("America/Chicago") {
            let event = allDayEvent(
                start: utcMidnight(2026, 6, 17),
                end: utcMidnight(2026, 6, 18)
            )
            #expect(event.displayStartDay == localMidnight(2026, 6, 17))
            #expect(event.displayEndDay == localMidnight(2026, 6, 17))
        }
    }

    /// The exclusive end is already stepped back, so a three-day event ends on
    /// its last covered day rather than the day after it.
    @Test func displayEndDayIsInclusive() {
        withTimeZone("America/Chicago") {
            let event = allDayEvent(
                start: utcMidnight(2026, 6, 17),
                end: utcMidnight(2026, 6, 20)
            )
            #expect(event.displayStartDay == localMidnight(2026, 6, 17))
            #expect(event.displayEndDay == localMidnight(2026, 6, 19))
            #expect(event.spannedDays == [
                localMidnight(2026, 6, 17),
                localMidnight(2026, 6, 18),
                localMidnight(2026, 6, 19),
            ])
        }
    }

    /// A timed event's display days are just its own local days -- no shift.
    @Test func timedEventDisplayDaysAreLocal() {
        withTimeZone("America/Chicago") {
            let event = timedEvent(
                start: local(2026, 6, 17, 19),
                end: local(2026, 6, 17, 22)
            )
            #expect(event.displayStartDay == localMidnight(2026, 6, 17))
            #expect(event.displayEndDay == localMidnight(2026, 6, 17))
        }
    }

    // MARK: Time state

    /// 8 PM on the event day is squarely inside a one-day all-day event. The raw
    /// `endsAt` (Jun 18 UTC midnight = Jun 17, 7 PM Central) had already passed,
    /// so the row read "Ended" and dimmed an hour earlier.
    @Test func allDayEventIsLiveLateOnItsOwnDay() {
        withTimeZone("America/Chicago") {
            let event = allDayEvent(
                start: utcMidnight(2026, 6, 17),
                end: utcMidnight(2026, 6, 18)
            )
            #expect(event.timeState(now: local(2026, 6, 17, 20)) == .live)
            #expect(event.timeState(now: local(2026, 6, 17, 1)) == .live)
        }
    }

    /// The mirror image: the raw `startsAt` (Jun 17 UTC midnight = Jun 16, 7 PM
    /// Central) made tomorrow's all-day event read "Now" the night before.
    @Test func allDayEventIsUpcomingTheEveningBefore() {
        withTimeZone("America/Chicago") {
            let event = allDayEvent(
                start: utcMidnight(2026, 6, 17),
                end: utcMidnight(2026, 6, 18)
            )
            #expect(event.timeState(now: local(2026, 6, 16, 20)) == .upcoming)
        }
    }

    @Test func allDayEventIsPastOnceItsLastDayIsOver() {
        withTimeZone("America/Chicago") {
            let event = allDayEvent(
                start: utcMidnight(2026, 6, 17),
                end: utcMidnight(2026, 6, 19)
            )
            #expect(event.timeState(now: local(2026, 6, 18, 23)) == .live)
            #expect(event.timeState(now: local(2026, 6, 19, 0)) == .past)
        }
    }

    /// Timed events keep instant-level precision -- the day comparison is only
    /// for events that encode a date.
    @Test func timedEventStillUsesInstants() {
        withTimeZone("America/Chicago") {
            let event = timedEvent(
                start: local(2026, 6, 17, 19),
                end: local(2026, 6, 17, 22)
            )
            #expect(event.timeState(now: local(2026, 6, 17, 18)) == .upcoming)
            #expect(event.timeState(now: local(2026, 6, 17, 20)) == .live)
            #expect(event.timeState(now: local(2026, 6, 17, 23)) == .past)
        }
    }
}
