import Foundation

// Bookings, reservation drafts, and availability blocks.

extension APIClient {
    // MARK: - Bookings

    /// Checkouts and reservations in one stream, soonest-finishing first.
    ///
    /// `/api/bookings` applies no `kind` filter, so one paginated, server-sorted
    /// request backs the merged Bookings list. Merging two independently paged
    /// calls client-side would let a later page insert rows above ones already
    /// on screen.
    /// The merged checkout + reservation list. `activeOnly` keeps the default
    /// operational set; `pastOnly` and `status` open the closed and
    /// single-status scopes the native list exposes for GAP-34 parity. The
    /// route reads `active`, `past`, and `status` as mutually exclusive, so
    /// pass exactly one scope selector.
    func bookings(activeOnly: Bool = true, pastOnly: Bool = false, status: BookingStatus? = nil, search: String? = nil, requesterId: String? = nil, filter: String? = nil, sort: String? = "endsAt", limit: Int = 30, offset: Int = 0) async throws -> PaginatedResponse<Booking> {
        try await perform(bookingListRequest(
            path: "/api/bookings",
            active: activeOnly,
            past: pastOnly,
            status: status,
            statusList: nil,
            search: search,
            requesterId: requesterId,
            filter: filter,
            sort: sort,
            limit: limit,
            offset: offset
        ))
    }

    /// Single-kind lists, used where checkouts and reservations stay separate
    /// result groups (global search). `sort` defaults to nil so these keep the
    /// server's `startsAt desc` recency order, which is what search wants;
    /// callers that page through operational work pass an explicit key.
    func reservations(activeOnly: Bool = true, search: String? = nil, requesterId: String? = nil, filter: String? = nil, sort: String? = nil, limit: Int = 30, offset: Int = 0) async throws -> PaginatedResponse<Booking> {
        try await perform(bookingListRequest(path: "/api/reservations", active: activeOnly, status: nil, statusList: nil, search: search, requesterId: requesterId, filter: filter, sort: sort, limit: limit, offset: offset))
    }

    func checkouts(activeOnly: Bool = true, status: BookingStatus? = nil, search: String? = nil, requesterId: String? = nil, filter: String? = nil, sort: String? = nil, limit: Int = 30, offset: Int = 0) async throws -> PaginatedResponse<Booking> {
        try await perform(bookingListRequest(
            path: "/api/checkouts",
            active: false,
            status: status,
            statusList: status == nil && activeOnly ? [.open, .pendingPickup] : nil,
            search: search,
            requesterId: requesterId,
            filter: filter,
            sort: sort,
            limit: limit,
            offset: offset
        ))
    }

    func bookingListRequest(path: String, active: Bool, past: Bool = false, status: BookingStatus?, statusList: [BookingStatus]?, search: String?, requesterId: String?, filter: String?, sort: String?, limit: Int, offset: Int) -> URLRequest {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if active { items.append(.init(name: "active", value: "true")) }
        if past { items.append(.init(name: "past", value: "true")) }
        if let status { items.append(.init(name: "status", value: status.rawValue)) }
        if let statusList, !statusList.isEmpty {
            items.append(.init(name: "status_in", value: statusList.map(\.rawValue).joined(separator: ",")))
        }
        if let search, !search.isEmpty { items.append(.init(name: "q", value: search)) }
        if let requesterId, !requesterId.isEmpty { items.append(.init(name: "requester_id", value: requesterId)) }
        if let filter, !filter.isEmpty { items.append(.init(name: "filter", value: filter)) }
        if let sort, !sort.isEmpty { items.append(.init(name: "sort", value: sort)) }
        return request(path: path, queryItems: items)
    }

    func booking(id: String) async throws -> Booking {
        let req = request(path: "/api/bookings/\(id)")
        let resp: DataWrapper<Booking> = try await perform(req)
        return resp.data
    }

    /// Newest booking history from the same detail payload the website uses.
    /// Collaborator responses omit `auditLogs`; the caller hides Activity first.
    func bookingActivity(id: String) async throws -> BookingActivityPage {
        let response: DataWrapper<BookingActivityPage> = try await perform(
            request(path: "/api/bookings/\(id)")
        )
        return response.data
    }

    func bookingReusePlan(id: String) async throws -> BookingReusePlan {
        let req = request(path: "/api/bookings/\(id)/reuse-plan")
        let resp: DataWrapper<BookingReusePlan> = try await perform(req)
        return resp.data
    }

    func cancelBooking(id: String) async throws -> Booking {
        let req = request(path: "/api/bookings/\(id)/cancel", method: "POST")
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    // MARK: - Booking drafts

    /// Current user's saved drafts, newest first. The server prunes drafts
    /// older than 30 days on read, so this list is already scoped to work the
    /// user could plausibly still want.
    func bookingDrafts() async throws -> [BookingDraftSummary] {
        let req = request(path: "/api/drafts")
        let resp: DataWrapper<[BookingDraftSummary]> = try await perform(req)
        return resp.data
    }

    func bookingDraft(id: String) async throws -> BookingDraftDetail {
        let req = request(path: "/api/drafts/\(id)")
        let resp: DataWrapper<BookingDraftDetail> = try await perform(req)
        return resp.data
    }

    /// Creates or updates a draft. Passing `id` updates in place, which is how
    /// repeated saves of the same composer avoid piling up rows.
    func saveBookingDraft(
        id: String?,
        title: String,
        requesterUserId: String?,
        locationId: String?,
        startsAt: Date,
        endsAt: Date,
        notes: String?,
        eventIds: [String] = [],
        serializedAssetIds: [String] = [],
        bulkItems: [BulkReservationRequest] = []
    ) async throws -> String {
        struct Body: Encodable {
            let id: String?
            let kind: String
            let title: String
            let requesterUserId: String?
            let locationId: String?
            let startsAt: String
            let endsAt: String
            let notes: String?
            let eventIds: [String]?
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
        }
        var req = request(path: "/api/drafts", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(
            id: id,
            kind: "RESERVATION",
            title: title,
            requesterUserId: requesterUserId?.isEmpty == true ? nil : requesterUserId,
            locationId: locationId?.isEmpty == true ? nil : locationId,
            startsAt: iso.string(from: startsAt),
            endsAt: iso.string(from: endsAt),
            notes: notes?.isEmpty == true ? nil : notes,
            eventIds: eventIds.isEmpty ? nil : eventIds,
            serializedAssetIds: serializedAssetIds,
            bulkItems: bulkItems
        ))
        let resp: DataWrapper<BookingStub> = try await perform(req)
        return resp.data.id
    }

    func deleteBookingDraft(id: String) async throws {
        let req = request(path: "/api/drafts/\(id)", method: "DELETE")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            // A draft that is already gone is the outcome the caller wanted.
            if http.statusCode == 404 { return }
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Discard failed"
            throw APIError.serverError(msg)
        }
    }

    func updateAssetQR(id: String, qrCodeValue: String) async throws {
        struct Body: Encodable { let qrCodeValue: String }
        var req = request(path: "/api/assets/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(qrCodeValue: qrCodeValue))
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Update failed"
            throw APIError.serverError(msg)
        }
    }

    func updateAsset(
        id: String,
        name: AssetTextMutation = .unchanged,
        serialNumber: AssetTextMutation = .unchanged,
        notes: AssetTextMutation = .unchanged
    ) async throws -> AssetUpdateConfirmation {
        struct Body: Encodable {
            let name: AssetTextMutation
            let serialNumber: AssetTextMutation
            let notes: AssetTextMutation

            enum CodingKeys: String, CodingKey {
                case name, serialNumber, notes
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                switch name {
                case .unchanged: break
                case .value(let value): try container.encode(value, forKey: .name)
                case .clear: try container.encodeNil(forKey: .name)
                }
                switch serialNumber {
                case .unchanged: break
                case .value(let value): try container.encode(value, forKey: .serialNumber)
                case .clear: try container.encodeNil(forKey: .serialNumber)
                }
                switch notes {
                case .unchanged: break
                case .value(let value): try container.encode(value, forKey: .notes)
                case .clear: try container.encode("", forKey: .notes)
                }
            }
        }
        var req = request(path: "/api/assets/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(name: name, serialNumber: serialNumber, notes: notes))
        let response: DataWrapper<AssetUpdateConfirmation> = try await perform(req)
        return response.data
    }

    func updateBooking(id: String, title: String? = nil, notes: String? = nil, locationId: String? = nil, startsAt: Date? = nil, endsAt: Date? = nil, updatedAt: Date? = nil) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before editing it.")
        }
        struct Body: Encodable {
            let title: String?
            let notes: String?
            let locationId: String?
            let startsAt: String?
            let endsAt: String?
        }
        var req = request(path: "/api/bookings/\(id)", method: "PATCH")
        req.setValue(bookingSnapshotString(updatedAt), forHTTPHeaderField: "X-Booking-Updated-At")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(
            title: title,
            notes: notes,
            locationId: locationId,
            startsAt: startsAt.map { iso.string(from: $0) },
            endsAt: endsAt.map { iso.string(from: $0) }
        ))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func transferBookingOwner(id: String, targetUserId: String, updatedAt: Date?) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before transferring ownership.")
        }
        struct Body: Encodable {
            let targetUserId: String
        }
        var req = request(path: "/api/bookings/\(id)/transfer-owner", method: "POST")
        req.setValue(bookingSnapshotString(updatedAt), forHTTPHeaderField: "X-Booking-Updated-At")
        req.httpBody = try JSONEncoder().encode(Body(targetUserId: targetUserId))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func bookingAvailability(for booking: Booking, endsAt: Date) async throws -> BookingAvailabilityResult {
        struct Body: Encodable {
            let locationId: String
            let startsAt: String
            let endsAt: String
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
            let excludeBookingId: String
            let kind: String
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var req = request(path: "/api/availability/check", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            locationId: booking.location.id,
            startsAt: iso.string(from: booking.startsAt),
            endsAt: iso.string(from: endsAt),
            serializedAssetIds: booking.serializedItems.map(\.assetId),
            bulkItems: booking.bulkItems.map {
                BulkReservationRequest(bulkSkuId: $0.bulkSku.id, quantity: $0.plannedQuantity)
            },
            excludeBookingId: booking.id,
            kind: booking.kind.rawValue
        ))
        return try await perform(req)
    }

    func extendBooking(id: String, endsAt: Date, updatedAt: Date?) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before extending it.")
        }
        struct Body: Encodable { let endsAt: String }
        var req = request(path: "/api/bookings/\(id)/extend", method: "POST")
        req.setValue(bookingSnapshotString(updatedAt), forHTTPHeaderField: "X-Booking-Updated-At")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(endsAt: iso.string(from: endsAt)))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    /// Reservation edit. Checkout requester, pickup, start, and gear stay on
    /// their own routes; this PATCH is the reservation plan the web sheet saves.
    func updateReservation(
        id: String,
        title: String? = nil,
        notes: String? = nil,
        locationId: String? = nil,
        startsAt: Date? = nil,
        endsAt: Date? = nil,
        serializedAssetIds: [String]? = nil,
        bulkItems: [BulkReservationRequest]? = nil,
        updatedAt: Date?
    ) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this reservation before editing it.")
        }
        if let title {
            _ = try BookingEditRules.validatedTitle(title)
        }
        if let notes {
            try BookingEditRules.validateNotes(notes)
        }
        if let startsAt, let endsAt, endsAt <= startsAt {
            throw APIError.serverError("endsAt must be later than startsAt")
        }
        if let serializedAssetIds {
            try BookingEditRules.validateSerializedIds(serializedAssetIds)
        }
        if let bulkItems {
            try BookingEditRules.validateBulkItems(bulkItems)
        }
        struct Body: Encodable {
            let title: String?
            let notes: String?
            let locationId: String?
            let startsAt: String?
            let endsAt: String?
            let serializedAssetIds: [String]?
            let bulkItems: [BulkReservationRequest]?

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encodeIfPresent(title, forKey: .title)
                try container.encodeIfPresent(notes, forKey: .notes)
                try container.encodeIfPresent(locationId, forKey: .locationId)
                try container.encodeIfPresent(startsAt, forKey: .startsAt)
                try container.encodeIfPresent(endsAt, forKey: .endsAt)
                try container.encodeIfPresent(serializedAssetIds, forKey: .serializedAssetIds)
                try container.encodeIfPresent(bulkItems, forKey: .bulkItems)
            }

            private enum CodingKeys: String, CodingKey {
                case title, notes, locationId, startsAt, endsAt, serializedAssetIds, bulkItems
            }
        }
        var req = request(path: "/api/bookings/\(id)", method: "PATCH")
        req.setValue(bookingSnapshotString(updatedAt), forHTTPHeaderField: "X-Booking-Updated-At")
        req.httpBody = try JSONEncoder().encode(Body(
            title: title.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            notes: notes,
            locationId: locationId,
            startsAt: startsAt.map(bookingSnapshotString),
            endsAt: endsAt.map(bookingSnapshotString),
            serializedAssetIds: serializedAssetIds,
            bulkItems: bulkItems
        ))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func updateBookingEvents(id: String, eventIds: [String], updatedAt: Date?) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before editing its events.")
        }
        try BookingEditRules.validateEventIds(eventIds)
        struct Body: Encodable { let eventIds: [String] }
        var req = request(path: "/api/bookings/\(id)/events", method: "POST")
        req.setValue(bookingSnapshotString(updatedAt), forHTTPHeaderField: "X-Booking-Updated-At")
        req.httpBody = try JSONEncoder().encode(Body(eventIds: eventIds))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    /// `true` when this hour's reminder was already sent.
    func nudgeCheckout(id: String) async throws -> Bool {
        struct Result: Decodable {
            let alreadyNudged: Bool?
        }
        var req = request(path: "/api/bookings/\(id)/nudge", method: "POST")
        req.httpBody = Data()
        let result: Result = try await perform(req)
        return result.alreadyNudged == true
    }

    func forceCompleteCheckout(id: String, reason: String) async throws -> Booking {
        let reason = try BookingEditRules.validatedReason(reason)
        struct Body: Encodable { let reason: String }
        var req = request(path: "/api/bookings/\(id)/force-complete", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(reason: reason))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func updateCheckoutCustody(id: String, custodyScope: String, updatedAt: Date?) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this checkout before changing custody.")
        }
        guard custodyScope == "PERSON" || custodyScope == "SHARED" else {
            throw APIError.serverError("Custody must be personal or shared.")
        }
        struct Body: Encodable { let custodyScope: String }
        var req = request(path: "/api/bookings/\(id)/custody-scope", method: "POST")
        req.setValue(bookingSnapshotString(updatedAt), forHTTPHeaderField: "X-Booking-Updated-At")
        req.httpBody = try JSONEncoder().encode(Body(custodyScope: custodyScope))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func forceCheckoutReservation(id: String, reason: String) async throws -> Booking {
        let reason = try BookingEditRules.validatedReason(reason)
        struct Body: Encodable { let reason: String }
        var req = request(path: "/api/reservations/\(id)/force-checkout", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(reason: reason))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func closeReservationRemaining(id: String, reason: String?) async throws -> Booking {
        let note: String?
        if let reason {
            note = try BookingEditRules.validatedOptionalNote(reason)
        } else {
            note = nil
        }
        struct Body: Encodable {
            let reason: String?
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encodeIfPresent(reason, forKey: .reason)
            }
            private enum CodingKeys: String, CodingKey { case reason }
        }
        var req = request(path: "/api/reservations/\(id)/close-remaining", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(reason: note))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func createReservation(
        title: String,
        requesterUserId: String,
        locationId: String,
        startsAt: Date,
        endsAt: Date,
        notes: String?,
        eventId: String? = nil,
        eventIds: [String] = [],
        shiftAssignmentId: String? = nil,
        sourceDraftId: String? = nil,
        serializedAssetIds: [String] = [],
        bulkItems: [BulkReservationRequest] = [],
        kitId: String? = nil
    ) async throws -> ReservationCreationReceipt {
        struct Body: Encodable {
            let title: String
            let requesterUserId: String
            let locationId: String
            let startsAt: String
            let endsAt: String
            let notes: String?
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
            let eventId: String?
            let eventIds: [String]?
            let shiftAssignmentId: String?
            let sourceDraftId: String?
            let kitId: String?
        }
        var req = request(path: "/api/reservations", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(
            title: title,
            requesterUserId: requesterUserId,
            locationId: locationId,
            startsAt: iso.string(from: startsAt),
            endsAt: iso.string(from: endsAt),
            notes: notes?.isEmpty == true ? nil : notes,
            serializedAssetIds: serializedAssetIds,
            bulkItems: bulkItems,
            eventId: eventId,
            eventIds: eventIds.isEmpty ? nil : eventIds,
            shiftAssignmentId: shiftAssignmentId,
            sourceDraftId: sourceDraftId,
            kitId: kitId
        ))
        let resp: DataWrapper<BookingStub> = try await perform(req)
        return ReservationCreationReceipt(
            id: resp.data.id,
            consolidated: resp.data.creationDisposition == "consolidated"
        )
    }

    /// Returns the top-level availability result for the given window.
    ///
    /// `locationId` is required by the server schema; omitting it (or sending the
    /// wrong key) returns a 400 the caller never sees, so the result silently
    /// stays empty. Pass `excludeBookingId` so an existing booking does not
    /// conflict with itself.
    func checkAvailabilityOutcome(
        locationId: String,
        serializedAssetIds: [String],
        startsAt: Date,
        endsAt: Date,
        excludeBookingId: String? = nil,
        bookingKind: BookingKind = .reservation,
        bulkItems: [BulkReservationRequest] = []
    ) async -> AvailabilityCheckOutcome {
        guard (!serializedAssetIds.isEmpty || !bulkItems.isEmpty), !locationId.isEmpty else {
            return AvailabilityCheckOutcome(result: AvailabilityCheckResult(), errorMessage: nil)
        }
        struct Body: Encodable {
            let locationId: String
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
            let startsAt: String
            let endsAt: String
            let excludeBookingId: String?
            let kind: String
        }
        var req = request(path: "/api/availability/check", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let body = try? JSONEncoder().encode(Body(
            locationId: locationId,
            serializedAssetIds: serializedAssetIds,
            bulkItems: bulkItems,
            startsAt: iso.string(from: startsAt),
            endsAt: iso.string(from: endsAt),
            excludeBookingId: excludeBookingId,
            kind: bookingKind.rawValue
        )) else {
            return AvailabilityCheckOutcome(result: nil, errorMessage: "Availability check could not be prepared. Try again.")
        }
        req.httpBody = body
        do {
            let (data, response, requestBoundary) = try await authenticatedData(for: req)
            guard let http = response as? HTTPURLResponse else {
                return AvailabilityCheckOutcome(result: nil, errorMessage: "Availability check returned an invalid response. Try again.")
            }
            // Hint-style calls still need to surface 401 so the session boundary
            // can route the user back to sign-in rather than looking clear.
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                return AvailabilityCheckOutcome(
                    result: nil,
                    errorMessage: APIError.unauthorized.errorDescription
                )
            }
            guard (200...299).contains(http.statusCode) else {
                let message = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error
                    ?? "Availability could not be checked. Try again."
                return AvailabilityCheckOutcome(result: nil, errorMessage: message)
            }
            guard let result = try? decoder.decode(AvailabilityCheckResult.self, from: data) else {
                return AvailabilityCheckOutcome(result: nil, errorMessage: "Availability response could not be read. Try again.")
            }
            return AvailabilityCheckOutcome(result: result, errorMessage: nil)
        } catch let error as APIError {
            return AvailabilityCheckOutcome(result: nil, errorMessage: error.errorDescription ?? "Availability could not be checked. Try again.")
        } catch {
            return AvailabilityCheckOutcome(
                result: nil,
                errorMessage: APIError.networkError(error).errorDescription ?? "Availability could not be checked. Try again."
            )
        }
    }

    /// Compatibility wrapper for callers that intentionally only need the
    /// decoded result. Reservation creation and kiosk UI use the outcome API so
    /// a failed preflight cannot masquerade as a clear result.
    func checkAvailability(
        locationId: String,
        serializedAssetIds: [String],
        startsAt: Date,
        endsAt: Date,
        excludeBookingId: String? = nil,
        bookingKind: BookingKind = .reservation,
        bulkItems: [BulkReservationRequest] = []
    ) async -> AvailabilityCheckResult {
        let outcome = await checkAvailabilityOutcome(
            locationId: locationId,
            serializedAssetIds: serializedAssetIds,
            startsAt: startsAt,
            endsAt: endsAt,
            excludeBookingId: excludeBookingId,
            bookingKind: bookingKind,
            bulkItems: bulkItems
        )
        return outcome.result ?? AvailabilityCheckResult()
    }

    func checkoutReturnInsight(for booking: Booking) async -> CheckoutReturnInsight {
        guard !booking.serializedItems.isEmpty, !booking.location.id.isEmpty else {
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        struct Body: Encodable {
            let locationId: String
            let serializedAssetIds: [String]
            let startsAt: String
            let endsAt: String
            let excludeBookingId: String?
        }
        struct UpcomingCommitment: Decodable {
            let startsAt: Date
            let bookingTitle: String?
        }
        struct CheckResponse: Decodable {
            let upcomingCommitments: [UpcomingCommitment]?
        }

        var req = request(path: "/api/availability/check", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let body = try? JSONEncoder().encode(Body(
            locationId: booking.location.id,
            serializedAssetIds: booking.serializedItems.map(\.assetId),
            startsAt: iso.string(from: booking.startsAt),
            endsAt: iso.string(from: booking.endsAt),
            excludeBookingId: booking.id
        )) else { return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false) }
        req.httpBody = body

        guard let (data, response, requestBoundary) = try? await authenticatedData(for: req),
              let http = response as? HTTPURLResponse else {
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        if http.statusCode == 401 {
            broadcastSessionExpiry(for: requestBoundary)
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        guard (200...299).contains(http.statusCode),
              let resp = try? decoder.decode(CheckResponse.self, from: data) else {
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        let next = resp.upcomingCommitments?.min { $0.startsAt < $1.startsAt }
        return CheckoutReturnInsight(
            nextNeedAt: next?.startsAt,
            hasUpcomingNeed: next != nil,
            nextNeedTitle: next?.bookingTitle?.nonBlankText
        )
    }

    /// Availability conflicts for a shift, keyed by userId → human note (e.g.
    /// "Conflicts with class 14:00–15:00"). Non-blocking hint for the assign
    /// picker — empty on failure so the picker still works; broadcasts 401 so a
    /// swallowed expired session can't hide here (IOS_PATTERNS R3).
    func shiftConflicts(shiftId: String) async -> [String: String] {
        let req = request(path: "/api/shifts/\(shiftId)/conflicts")
        guard let (data, response, requestBoundary) = try? await authenticatedData(for: req),
              let http = response as? HTTPURLResponse else { return [:] }
        if http.statusCode == 401 {
            broadcastSessionExpiry(for: requestBoundary)
            return [:]
        }
        struct ConflictResponse: Decodable { let data: [String: String] }
        guard (200...299).contains(http.statusCode),
              let resp = try? decoder.decode(ConflictResponse.self, from: data) else { return [:] }
        return resp.data
    }

    /// Staff-only candidate recommendations for the assignment picker. The
    /// server remains authoritative for eligibility and the final mutation.
    func shiftCandidateScores(shiftId: String) async throws -> [CandidateRecommendation] {
        let req = request(path: "/api/shifts/\(shiftId)/candidate-scores")
        let resp: DataWrapper<[CandidateRecommendation]> = try await perform(req)
        return resp.data
    }

    // MARK: - Availability blocks

    func availabilityBlocks(userId: String) async throws -> [AvailabilityBlock] {
        let req = request(path: "/api/users/\(userId)/availability")
        let resp: AvailabilityBlocksResponse = try await perform(req)
        return resp.data
    }

    /// Every active student with their availability blocks. ADMIN/STAFF only.
    func teamAvailability() async throws -> [TeamAvailabilityStudent] {
        let req = request(path: "/api/availability/team")
        let resp: TeamAvailabilityResponse = try await perform(req)
        return resp.data
    }

    func createAvailabilityBlock(
        userId: String,
        requestId: String? = nil,
        kind: String = "WEEKLY",
        intent: String = "CANNOT_WORK",
        dayOfWeek: Int,
        date: String? = nil,
        dateEndsOn: String? = nil,
        allDay: Bool = false,
        startsAt: String,
        endsAt: String,
        label: String?,
        semesterLabel: String? = nil,
        semesterStartsOn: String? = nil,
        semesterEndsOn: String? = nil
    ) async throws -> AvailabilityBlock {
        struct Body: Encodable {
            let requestId: String?
            let kind: String
            let intent: String
            let dayOfWeek: Int?
            let date: String?
            let dateEndsOn: String?
            let allDay: Bool
            let startsAt: String
            let endsAt: String
            let label: String?
            let semesterLabel: String?
            let semesterStartsOn: String?
            let semesterEndsOn: String?
        }
        var req = request(path: "/api/users/\(userId)/availability", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            requestId: requestId,
            kind: kind,
            intent: intent,
            dayOfWeek: kind == "WEEKLY" ? dayOfWeek : nil,
            date: kind == "AD_HOC" ? date : nil,
            dateEndsOn: kind == "AD_HOC" ? dateEndsOn ?? date : nil,
            allDay: kind == "AD_HOC" && allDay,
            startsAt: startsAt,
            endsAt: endsAt,
            label: label,
            semesterLabel: semesterLabel,
            semesterStartsOn: semesterStartsOn,
            semesterEndsOn: semesterEndsOn
        ))
        let resp: DataWrapper<AvailabilityBlock> = try await perform(req)
        return resp.data
    }

    func updateAvailabilityBlock(
        userId: String,
        blockId: String,
        expectedUpdatedAt: String? = nil,
        kind: String,
        intent: String,
        dayOfWeek: Int,
        date: String?,
        dateEndsOn: String? = nil,
        allDay: Bool = false,
        startsAt: String,
        endsAt: String,
        label: String?,
        semesterLabel: String? = nil,
        semesterStartsOn: String? = nil,
        semesterEndsOn: String? = nil
    ) async throws -> AvailabilityBlock {
        struct Body: Encodable {
            let expectedUpdatedAt: String?
            let kind: String
            let intent: String
            let dayOfWeek: Int?
            let date: String?
            let dateEndsOn: String?
            let allDay: Bool
            let startsAt: String
            let endsAt: String
            let label: String?
            let semesterLabel: String?
            let semesterStartsOn: String?
            let semesterEndsOn: String?
        }
        var req = request(path: "/api/users/\(userId)/availability/\(blockId)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(
            expectedUpdatedAt: expectedUpdatedAt,
            kind: kind,
            intent: intent,
            dayOfWeek: kind == "WEEKLY" ? dayOfWeek : nil,
            date: kind == "AD_HOC" ? date : nil,
            dateEndsOn: kind == "AD_HOC" ? dateEndsOn ?? date : nil,
            allDay: kind == "AD_HOC" && allDay,
            startsAt: startsAt,
            endsAt: endsAt,
            label: label,
            semesterLabel: semesterLabel,
            semesterStartsOn: semesterStartsOn,
            semesterEndsOn: semesterEndsOn
        ))
        let resp: DataWrapper<AvailabilityBlock> = try await perform(req)
        return resp.data
    }

    func deleteAvailabilityBlock(userId: String, blockId: String) async throws {
        let req = request(path: "/api/users/\(userId)/availability/\(blockId)", method: "DELETE")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't remove block"
            throw APIError.serverError(msg)
        }
    }

    func reservationKits(locationId: String, requesterUserId: String? = nil) async throws -> (kits: [BookingKitOption], suggestedKitId: String?) {
        struct Resp: Decodable {
            let data: [BookingKitOption]
            let suggestedKitId: String?
        }
        var items: [URLQueryItem] = [
            .init(name: "location_id", value: locationId),
            .init(name: "limit", value: "100"),
        ]
        if let requesterUserId, !requesterUserId.isEmpty {
            items.append(.init(name: "requester_user_id", value: requesterUserId))
        }
        let req = request(path: "/api/kits", queryItems: items)
        let resp: Resp = try await perform(req)
        return (resp.data, resp.suggestedKitId)
    }

    func reservationKitDetail(id: String) async throws -> BookingKitDetail {
        let req = request(path: "/api/kits/\(id)")
        let resp: DataWrapper<BookingKitDetail> = try await perform(req)
        return resp.data
    }

    func kitList(search: String?, locationId: String?, includeArchived: Bool, limit: Int, offset: Int) async throws -> KitListPage {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: String(limit)),
            .init(name: "offset", value: String(offset)),
            .init(name: "sort", value: "name"),
            .init(name: "order", value: "asc"),
        ]
        let query = search?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !query.isEmpty {
            items.append(.init(name: "q", value: query))
        }
        if let locationId, !locationId.isEmpty {
            items.append(.init(name: "location_id", value: locationId))
        }
        if includeArchived {
            items.append(.init(name: "include_archived", value: "true"))
        }
        let req = request(path: "/api/kits", queryItems: items)
        return try await perform(req)
    }

    func kitReadDetail(id: String) async throws -> KitReadDetail {
        let req = request(path: "/api/kits/\(id)")
        let resp: DataWrapper<KitReadDetail> = try await perform(req)
        return resp.data
    }

    func bulkSkuReadDetail(id: String) async throws -> BulkSkuReadDetail {
        let req = request(path: "/api/bulk-skus/\(id)")
        let resp: DataWrapper<BulkSkuReadDetail> = try await perform(req)
        return resp.data
    }

    func batteryOps() async throws -> BatteryOpsSnapshot {
        let req = request(path: "/api/bulk-skus/batteries")
        let resp: DataWrapper<BatteryOpsSnapshot> = try await perform(req)
        return resp.data
    }

    func formOptions() async throws -> FormOptions {
        let req = request(path: "/api/form-options")
        let resp: DataWrapper<FormOptions> = try await perform(req)
        return resp.data
    }
}
