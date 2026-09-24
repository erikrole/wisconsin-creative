import Testing
import Foundation
@testable import Wisconsin

/// The Schedule's on-disk window must round-trip the same models the API
/// decodes, including the fields with custom decoding, and must refuse a
/// snapshot that belongs to someone else or has gone stale.
struct ScheduleWindowCacheTests {
    private func apiDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private func sampleEvent() throws -> ScheduleEvent {
        let json = """
        { "id": "e1", "summary": "Volleyball vs Nebraska", "startsAt": "2026-09-23T16:00:00Z",
          "endsAt": "2026-09-23T19:00:00Z", "allDay": false, "status": "CONFIRMED",
          "sportCode": "VB", "opponent": "Nebraska", "isHome": true, "site": "NEUTRAL",
          "location": { "id": "loc-fh", "name": "UW Field House" },
          "rawLocationText": "Madison, WI, UW Field House",
          "coverage": { "total": 6, "filled": 4, "percentage": 67 },
          "combinedEvents": [{ "id": "e1b", "summary": "Volleyball vs Nebraska (TV)",
            "startsAt": "2026-09-23T16:00:00Z", "endsAt": "2026-09-23T19:00:00Z",
            "allDay": false, "sportCode": "VB", "opponent": "Nebraska" }] }
        """
        return try apiDecoder().decode(ScheduleEvent.self, from: Data(json.utf8))
    }

    private func sampleShift() throws -> MyShift {
        let json = """
        { "id": "s1", "area": "CAMERA", "workerType": "ST", "startsAt": "2026-09-23T14:30:00Z",
          "endsAt": "2026-09-23T19:30:00Z", "status": "ACTIVE",
          "event": { "id": "e1", "summary": "Volleyball vs Nebraska", "startsAt": "2026-09-23T16:00:00Z",
                     "endsAt": "2026-09-23T19:00:00Z", "sportCode": "VB", "isHome": true,
                     "opponent": "Nebraska", "locationId": "loc-fh", "locationName": "UW Field House" },
          "gear": { "status": "checked_out",
                    "bookings": [ { "id": "b1", "status": "CHECKED_OUT", "kind": "SERIALIZED", "itemCount": 4 } ] } }
        """
        return try apiDecoder().decode(MyShift.self, from: Data(json.utf8))
    }

    @Test func roundTripsEventsAndShifts() throws {
        let event = try sampleEvent()
        let shift = try sampleShift()
        let savedAt = Date(timeIntervalSince1970: 1_790_000_000)
        let data = try ScheduleWindowCache.encode(.init(userId: "u1", savedAt: savedAt, events: [event], shifts: [shift]))

        let restored = try #require(ScheduleWindowCache.usableSnapshot(from: data, userId: "u1", now: savedAt))
        let restoredEvent = try #require(restored.events.first)
        #expect(restoredEvent.id == event.id)
        #expect(restoredEvent.startsAt == event.startsAt)
        #expect(restoredEvent.venue == event.venue)
        #expect(restoredEvent.coverage?.filled == 4)
        #expect(restoredEvent.combinedEvents?.first?.id == "e1b")
        #expect(scheduleEventVenueName(restoredEvent) == scheduleEventVenueName(event))
        let restoredShift = try #require(restored.shifts.first)
        #expect(restoredShift.id == shift.id)
        #expect(restoredShift.callStartsAt == shift.callStartsAt)
        #expect(restoredShift.event.id == "e1")
    }

    @Test func refusesAnotherUsersSnapshot() throws {
        let data = try ScheduleWindowCache.encode(.init(userId: "u1", savedAt: .now, events: [], shifts: []))
        #expect(ScheduleWindowCache.usableSnapshot(from: data, userId: "u2") == nil)
    }

    @Test func refusesAStaleSnapshot() throws {
        let savedAt = Date(timeIntervalSince1970: 1_790_000_000)
        let data = try ScheduleWindowCache.encode(.init(userId: "u1", savedAt: savedAt, events: [], shifts: []))
        let later = savedAt.addingTimeInterval(ScheduleWindowCache.maxAge + 1)
        #expect(ScheduleWindowCache.usableSnapshot(from: data, userId: "u1", now: later) == nil)
    }
}
