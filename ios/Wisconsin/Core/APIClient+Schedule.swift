import Foundation

// Schedule, shift trades, and shift authoring.

extension APIClient {
    // MARK: - Schedule

    func calendarEventPage(
        includePast: Bool,
        window: DateInterval? = nil,
        eventId: String? = nil,
        limit: Int,
        offset: Int
    ) async throws -> ScheduleEventsResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if includePast { items.append(.init(name: "includePast", value: "true")) }
        if let eventId { items.append(.init(name: "eventId", value: eventId)) }
        items += Self.windowQueryItems(window)
        return try await perform(request(path: "/api/calendar-events", queryItems: items))
    }

    /// One Schedule event by id, whatever its date, in the same shape the list
    /// returns. A combined secondary's id resolves to its canonical row. Nil
    /// when the event is gone or hidden from this viewer.
    func scheduleEvent(id: String) async throws -> ScheduleEvent? {
        let first = try await calendarEventPage(includePast: true, eventId: id, limit: 1, offset: 0).data.first
        // A server that predates the `eventId` read ignores it and returns the
        // first list row, which would open the wrong event. Only accept the
        // event asked for, or the canonical row a combined secondary maps to.
        guard let first,
              first.id == id || (first.combinedEvents ?? []).contains(where: { $0.id == id }) else { return nil }
        return first
    }

    /// `startDate`/`endDate` for a Schedule window. Both routes read them as
    /// "overlaps the window": the event ends after the start and starts at or
    /// before the end.
    static func windowQueryItems(_ window: DateInterval?) -> [URLQueryItem] {
        guard let window else { return [] }
        let formatter = ISO8601DateFormatter()
        return [
            .init(name: "startDate", value: formatter.string(from: window.start)),
            .init(name: "endDate", value: formatter.string(from: window.end)),
        ]
    }

    /// Upcoming events matching a title, opponent, or location, for global search.
    func searchCalendarEvents(query: String, limit: Int, offset: Int) async throws -> ScheduleEventsResponse {
        let items: [URLQueryItem] = [
            .init(name: "q", value: query),
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        return try await perform(request(path: "/api/calendar-events", queryItems: items))
    }

    func calendarEvents(
        includePast: Bool = false,
        limit: Int = 60
    ) async throws -> [ScheduleEvent] {
        let response = try await calendarEventPage(includePast: includePast, limit: limit, offset: 0)
        return response.data
    }

    /// One page of `/api/calendar-events`. The Browse events list follows
    /// `total` the same way Schedule does, without Schedule's week window.
    func calendarEventsPage(
        includePast: Bool,
        window: DateInterval? = nil,
        limit: Int,
        offset: Int
    ) async throws -> ScheduleEventsResponse {
        try await calendarEventPage(
            includePast: includePast,
            window: window,
            limit: limit,
            offset: offset
        )
    }

    /// `GET /api/calendar-events/:id`. Richer than the list row: source,
    /// subtitle, hidden, and combined-event identity. Read-only.
    func calendarEventDetail(id: String) async throws -> CalendarEventDetail {
        let response: DataWrapper<CalendarEventDetail> = try await perform(
            request(path: "/api/calendar-events/\(id)")
        )
        return response.data
    }

    /// Staff/admin gear and booking summary for one event. Students receive
    /// 403; callers treat that as "no team gear" rather than a failed event.
    func eventCommandCenter(id: String) async throws -> EventCommandCenter {
        let response: DataWrapper<EventCommandCenter> = try await perform(
            request(path: "/api/calendar-events/\(id)/command-center")
        )
        return response.data
    }

    /// Reads the complete event window through the API's total-driven pages.
    /// SwiftUI still renders the result lazily, while the client no longer
    /// mistakes the first 60 events (roughly one month during a busy season)
    /// for the entire schedule. The bounded page size matches the server cap.
    func allCalendarEvents(
        includePast: Bool = false,
        window: DateInterval? = nil,
        pageSize: Int = 200
    ) async throws -> [ScheduleEvent] {
        let pageSize = min(max(pageSize, 1), 200)
        var events: [ScheduleEvent] = []
        var seenIds = Set<String>()
        var offset = 0

        while true {
            try Task.checkCancellation()
            let response = try await calendarEventPage(
                includePast: includePast,
                window: window,
                limit: pageSize,
                offset: offset
            )
            let countBefore = events.count
            for event in response.data where seenIds.insert(event.id).inserted {
                events.append(event)
            }

            let pageCount = response.data.count
            guard pageCount > 0,
                  pageCount >= pageSize,
                  offset + pageCount < response.total,
                  events.count > countBefore else {
                break
            }
            offset += pageCount
        }

        return events
    }

    func shiftGroup(eventId: String) async throws -> EventShiftGroup? {
        let req = request(path: "/api/shift-groups", queryItems: [
            .init(name: "eventId", value: eventId),
            .init(name: "limit", value: "1"),
        ])
        let resp: ShiftGroupsResponse = try await perform(req)
        return resp.data.first
    }

    /// Away-game travel roster. Read-only: adding and removing travelers stays on the website.
    func eventTravelMembers(eventId: String) async throws -> [EventTravelMember] {
        let response: DataWrapper<[EventTravelMember]> = try await perform(
            request(path: "/api/calendar-events/\(eventId)/travel")
        )
        return response.data
    }

    /// Staff-only versioned working schedule. The relational shift group stays
    /// the published read model; this additive editor contract carries private
    /// draft slots and the optimistic version needed for every mutation.
    func workingScheduleEditor(shiftGroupId: String) async throws -> WorkingScheduleEditor {
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(
            request(path: "/api/shift-groups/\(shiftGroupId)/working-copy")
        )
        return rememberDraft(response.data)
    }

    // MARK: Draft identity

    /// Records which draft an editor response describes, so the next mutation
    /// can name it. A draft that exists but carries no id comes from a server
    /// that predates draft identity; the expectation is dropped, not guessed.
    func rememberDraft(_ editor: WorkingScheduleEditor) -> WorkingScheduleEditor {
        draftIdsLock.lock()
        defer { draftIdsLock.unlock() }
        if let draftId = editor.draftId {
            draftIds[editor.shiftGroupId] = .some(draftId)
        } else if !editor.hasWorkingCopy {
            draftIds[editor.shiftGroupId] = .some(nil)
        } else {
            draftIds[editor.shiftGroupId] = nil
        }
        return editor
    }

    func expectedDraft(for shiftGroupId: String) -> String?? {
        draftIdsLock.lock()
        defer { draftIdsLock.unlock() }
        return draftIds[shiftGroupId]
    }

    /// `expectedVersion` plus `expectedDraftId` when the draft is known:
    /// the id, or an explicit null for "no draft yet".
    struct VersionedBody<Extra: Encodable>: Encodable {
        let expectedVersion: Int
        let expectedDraft: String??
        let extra: Extra

        private enum Keys: String, CodingKey { case expectedVersion, expectedDraftId }

        func encode(to encoder: Encoder) throws {
            try extra.encode(to: encoder)
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(expectedVersion, forKey: .expectedVersion)
            if let expectedDraft {
                if let id = expectedDraft {
                    try container.encode(id, forKey: .expectedDraftId)
                } else {
                    try container.encodeNil(forKey: .expectedDraftId)
                }
            }
        }
    }

    struct NoExtra: Encodable {
        func encode(to encoder: Encoder) throws {}
    }

    /// Creates a new shift group for an event (STAFF/ADMIN).
    func createShiftGroup(eventId: String) async throws -> EventShiftGroup {
        struct Body: Encodable { let eventId: String }
        var req = request(path: "/api/shift-groups", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(eventId: eventId))
        struct Resp: Decodable { let data: EventShiftGroup }
        let resp: Resp = try await perform(req)
        return resp.data
    }

    /// `userId` defaults to the caller. Pass one to read a teammate's upcoming
    /// shifts for their profile.
    ///
    /// When asking about somebody else, the response has to say whose shifts it
    /// contains. A server without the `userId` filter ignores the parameter and
    /// returns the caller's own, which would silently print your shifts on a
    /// teammate's profile; if the answer cannot be attributed, return nothing.
    func myShiftsPage(
        userId: String?,
        eventId: String? = nil,
        window: DateInterval? = nil,
        limit: Int,
        offset: Int
    ) async throws -> MyShiftsResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let userId { items.append(.init(name: "userId", value: userId)) }
        if let eventId { items.append(.init(name: "eventId", value: eventId)) }
        items += Self.windowQueryItems(window)
        return try await perform(request(path: "/api/my-shifts", queryItems: items))
    }

    func myShifts(userId: String? = nil, limit: Int = 20) async throws -> [MyShift] {
        let resp = try await myShiftsPage(userId: userId, limit: limit, offset: 0)
        if let userId, resp.userId != userId { return [] }
        return resp.data
    }

    /// The signed-in person's shifts on one event, including the gear bookings
    /// linked to that event. The route caps a page at 20; one person does not
    /// have more active assignments than that on a single event.
    func myShifts(eventId: String) async throws -> [MyShift] {
        let response = try await myShiftsPage(userId: nil, eventId: eventId, limit: 20, offset: 0)
        return response.data
    }

    /// Hours the signed-in person has worked. The server owns the window:
    /// Monday–Sunday and the calendar month, both in Central time.
    /// Collaborators are refused; this is only the caller's own totals.
    func myHours() async throws -> MyHours {
        let response: DataWrapper<MyHours> = try await perform(
            request(path: "/api/shifts/my-hours")
        )
        return response.data
    }

    /// Reads every active assignment for the caller. The route is still
    /// page-compatible with older servers: if `total` is absent, return the
    /// first response instead of guessing at more offsets.
    func allMyShifts(
        userId: String? = nil,
        window: DateInterval? = nil,
        pageSize: Int = 20
    ) async throws -> [MyShift] {
        let pageSize = min(max(pageSize, 1), 20)
        var response = try await myShiftsPage(userId: userId, window: window, limit: pageSize, offset: 0)
        if let userId, response.userId != userId { return [] }

        var shifts = response.data
        guard let total = response.total else { return shifts }
        var offset = response.data.count

        while offset < total, !response.data.isEmpty {
            try Task.checkCancellation()
            response = try await myShiftsPage(userId: userId, window: window, limit: pageSize, offset: offset)
            if let userId, response.userId != userId { return [] }
            shifts.append(contentsOf: response.data)
            offset += response.data.count
        }

        return shifts
    }

    func publishedSchedule(limit: Int = 100, offset: Int = 0) async throws -> PublishedScheduleResponse {
        try await perform(request(path: "/api/schedule/published", queryItems: [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]))
    }

    func publishedScheduleEvent(eventId: String) async throws -> PublishedScheduleEvent {
        let response: DataWrapper<PublishedScheduleEvent> = try await perform(
            request(path: "/api/schedule/published/\(eventId)")
        )
        return response.data
    }

    func setPublishedScheduleFollow(eventId: String, following: Bool) async throws -> Bool {
        struct Body: Encodable { let following: Bool }
        var req = request(path: "/api/schedule/published/\(eventId)/follow", method: "PUT")
        req.httpBody = try JSONEncoder().encode(Body(following: following))
        struct FollowState: Decodable { let eventId: String; let isFollowing: Bool }
        let response: DataWrapper<FollowState> = try await perform(req)
        return response.data.isFollowing
    }

    // MARK: - Shift Trades

    func shiftTrades(status: String? = nil, area: String? = nil, limit: Int = 30, offset: Int = 0) async throws -> ShiftTradesResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let status { items.append(.init(name: "status", value: status)) }
        if let area { items.append(.init(name: "area", value: area)) }
        return try await perform(request(path: "/api/shift-trades", queryItems: items))
    }

    func scheduleOpenWork(area: String? = nil) async throws -> OpenWorkResponse {
        var items: [URLQueryItem] = []
        if let area { items.append(.init(name: "area", value: area)) }
        let resp: DataWrapper<OpenWorkResponse> = try await perform(request(path: "/api/schedule/open-work", queryItems: items))
        return resp.data
    }

    func postShiftTrade(assignmentId: String, notes: String?) async throws -> ShiftTrade {
        struct Body: Encodable { let shiftAssignmentId: String; let notes: String? }
        var req = request(path: "/api/shift-trades", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(shiftAssignmentId: assignmentId, notes: notes))
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func claimShiftTrade(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/claim", method: "POST")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    /// The board reloads after a decision, so only the status matters. The
    /// body is not decoded: a success must never read as a failure because
    /// the server returned a slimmer row than `ShiftTrade` expects.
    func approveShiftTrade(id: String) async throws {
        try await sendDecision(path: "/api/shift-trades/\(id)/approve", fallback: "Couldn't approve trade")
    }

    func declineShiftTrade(id: String) async throws {
        try await sendDecision(path: "/api/shift-trades/\(id)/decline", fallback: "Couldn't decline trade")
    }

    func sendDecision(path: String, fallback: String) async throws {
        let req = request(path: path, method: "PATCH")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        guard let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) else { return }
        if http.statusCode == 401 {
            broadcastSessionExpiry(for: requestBoundary)
            throw APIError.unauthorized
        }
        let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? fallback
        if http.statusCode == 409 { throw APIError.conflict(msg) }
        throw APIError.serverError(msg)
    }

    func cancelShiftTrade(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/cancel", method: "PATCH")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func withdrawShiftTradeClaim(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/withdraw", method: "PATCH")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func withdrawShiftRequest(id: String) async throws {
        let req = request(path: "/api/shift-assignments/\(id)/withdraw", method: "PATCH")
        let _: DataWrapper<ShiftAssignmentActionResponse> = try await perform(req)
    }

    func pickupOpenShift(id: String) async throws {
        struct Body: Encodable { let shiftId: String }
        var req = request(path: "/api/shift-assignments/pickup", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(shiftId: id))
        let _: DataWrapper<ShiftAssignmentActionResponse> = try await perform(req)
    }

    // MARK: - Shift assignment / authoring

    /// Roster of users assigned to a sport (used as the eligibility list for
    /// assigning students to ST shifts on iOS).
    func sportRoster(sportCode: String) async throws -> [RosterEntry] {
        let req = request(path: "/api/sport-configs/\(sportCode)/roster")
        let resp: DataWrapper<[RosterEntry]> = try await perform(req)
        return resp.data
    }

    func workingScheduleCandidateScores(
        shiftGroupId: String,
        slotKey: String,
        workerType: String? = nil
    ) async throws -> [CandidateRecommendation] {
        var queryItems: [URLQueryItem] = [.init(name: "slotKey", value: slotKey)]
        if let workerType {
            queryItems.append(.init(name: "workerType", value: workerType))
        }
        let response: DataWrapper<[CandidateRecommendation]> = try await perform(
            request(
                path: "/api/shift-groups/\(shiftGroupId)/working-copy/candidate-scores",
                queryItems: queryItems
            )
        )
        return response.data
    }

    func addWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        area: String,
        workerType: String,
        callStartsAt: Date? = nil,
        callEndsAt: Date? = nil
    ) async throws -> WorkingScheduleEditor {
        let iso = ISO8601DateFormatter()
        return try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "adjustSlots",
                area: area,
                workerType: workerType,
                delta: 1,
                callStartsAt: callStartsAt.map { iso.string(from: $0) },
                callEndsAt: callEndsAt.map { iso.string(from: $0) }
            )
        )
    }

    func assignWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String,
        userId: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(type: "assign", slotKey: slotKey, userId: userId)
        )
    }

    func convertAndReplaceWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String,
        workerType: String,
        userId: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "convertAndReplace",
                workerType: workerType,
                slotKey: slotKey,
                userId: userId
            )
        )
    }

    func unassignWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(type: "unassign", slotKey: slotKey)
        )
    }

    func removeWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(type: "removeSlot", slotKey: slotKey)
        )
    }

    func setWorkingScheduleCallWindow(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String,
        callStartsAt: Date?,
        callEndsAt: Date?
    ) async throws -> WorkingScheduleEditor {
        let iso = ISO8601DateFormatter()
        return try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "setCallWindow",
                slotKey: slotKey,
                callStartsAt: callStartsAt.map { iso.string(from: $0) },
                callEndsAt: callEndsAt.map { iso.string(from: $0) }
            )
        )
    }

    func setWorkingScheduleCallWindowForAll(
        shiftGroupId: String,
        expectedVersion: Int,
        callStartsAt: Date?,
        callEndsAt: Date?
    ) async throws -> WorkingScheduleEditor {
        let iso = ISO8601DateFormatter()
        return try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "setCallWindowForAll",
                callStartsAt: callStartsAt.map { iso.string(from: $0) },
                callEndsAt: callEndsAt.map { iso.string(from: $0) }
            )
        )
    }

    /// Reverses or reapplies exactly one named working-copy command. The
    /// server owns the snapshots and checks the expected version and operator
    /// inside its serializable transaction; this is deliberately separate from
    /// the batch discard/Revert action below.
    func undoWorkingSchedule(shiftGroupId: String, expectedVersion: Int) async throws -> WorkingScheduleEditor {
        try await changeWorkingScheduleHistory(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            action: "undo"
        )
    }

    func redoWorkingSchedule(shiftGroupId: String, expectedVersion: Int) async throws -> WorkingScheduleEditor {
        try await changeWorkingScheduleHistory(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            action: "redo"
        )
    }

    func discardWorkingSchedule(shiftGroupId: String, expectedVersion: Int) async throws -> WorkingScheduleEditor {
        var items: [URLQueryItem] = [.init(name: "expectedVersion", value: "\(expectedVersion)")]
        if let expected = expectedDraft(for: shiftGroupId) {
            // An empty value means "I expect no draft yet".
            items.append(.init(name: "expectedDraftId", value: expected ?? ""))
        }
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(
            request(
                path: "/api/shift-groups/\(shiftGroupId)/working-copy",
                method: "DELETE",
                queryItems: items
            )
        )
        return rememberDraft(response.data)
    }

    func publishWorkingSchedule(shiftGroupId: String, expectedVersion: Int) async throws -> WorkingScheduleEditor {
        var req = request(path: "/api/shift-groups/\(shiftGroupId)/publish", method: "POST")
        req.httpBody = try JSONEncoder().encode(VersionedBody(
            expectedVersion: expectedVersion,
            expectedDraft: expectedDraft(for: shiftGroupId),
            extra: NoExtra()
        ))
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(req)
        return rememberDraft(response.data)
    }

    /// Direct-assign a user to a shift (STAFF/ADMIN).
    func assignShift(shiftId: String, userId: String) async throws {
        struct Body: Encodable { let shiftId: String; let userId: String }
        var req = request(path: "/api/shift-assignments", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(shiftId: shiftId, userId: userId))
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't assign shift"
            throw APIError.serverError(msg)
        }
    }

    /// Remove an assignment (STAFF/ADMIN).
    func unassignShift(assignmentId: String) async throws {
        let req = request(path: "/api/shift-assignments/\(assignmentId)", method: "DELETE")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't remove assignment"
            throw APIError.serverError(msg)
        }
    }

    func updateShiftTimes(shiftId: String, startsAt: Date, endsAt: Date) async throws {
        struct Body: Encodable { let startsAt: String; let endsAt: String }
        let iso = ISO8601DateFormatter()
        var req = request(path: "/api/shifts/\(shiftId)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(startsAt: iso.string(from: startsAt), endsAt: iso.string(from: endsAt)))
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't update shift times"
            throw APIError.serverError(msg)
        }
    }

    func approveShift(assignmentId: String) async throws {
        let req = request(path: "/api/shift-assignments/\(assignmentId)/approve", method: "PATCH")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't approve request"
            throw APIError.serverError(msg)
        }
    }

    func declineShift(assignmentId: String) async throws {
        let req = request(path: "/api/shift-assignments/\(assignmentId)/decline", method: "PATCH")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't decline request"
            throw APIError.serverError(msg)
        }
    }

    /// Delete a shift from a shift group (STAFF/ADMIN). Pass force=true to remove even if assigned.
    func deleteShift(shiftGroupId: String, shiftId: String) async throws {
        let req = request(
            path: "/api/shift-groups/\(shiftGroupId)/shifts/\(shiftId)",
            method: "DELETE",
            queryItems: [.init(name: "force", value: "true")]
        )
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't delete shift"
            throw APIError.serverError(msg)
        }
    }

    /// Add a new shift to a shift group (STAFF/ADMIN).
    func addShift(
        shiftGroupId: String,
        area: String,
        workerType: String,
        startsAt: Date? = nil,
        endsAt: Date? = nil
    ) async throws {
        struct Body: Encodable {
            let area: String
            let workerType: String
            let startsAt: String?
            let endsAt: String?
        }
        let isoFormatter = ISO8601DateFormatter()
        let body = Body(
            area: area,
            workerType: workerType,
            startsAt: startsAt.map { isoFormatter.string(from: $0) },
            endsAt: endsAt.map { isoFormatter.string(from: $0) }
        )
        var req = request(path: "/api/shift-groups/\(shiftGroupId)/shifts", method: "POST")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't add shift"
            throw APIError.serverError(msg)
        }
    }
}
