import XCTest
@testable import Wisconsin

@MainActor
private final class DraftPersistenceStub: ReservationDraftPersistence {
    var saveError: Error?
    var deleteError: Error?
    var savedId = "draft-1"
    var createdId = "booking-1"
    var listedDrafts: [BookingDraftSummary] = []
    var draftDetail: BookingDraftDetail?
    var createResults: [Result<String, Error>] = []
    private(set) var saveCalls = 0
    private(set) var deleteCalls = 0
    private(set) var createCalls = 0
    private(set) var savedTitles: [String] = []
    private(set) var savedDraftIds: [String?] = []
    private(set) var savedRequesterUserIds: [String?] = []
    private(set) var savedLocationIds: [String?] = []
    private(set) var savedStartsAt: [Date] = []
    private(set) var savedEndsAt: [Date] = []
    private(set) var savedNotes: [String?] = []
    private(set) var savedEventIds: [[String]] = []
    private(set) var createdTitles: [String] = []
    private(set) var createdSourceDraftIds: [String?] = []
    private(set) var createdSerializedAssetIds: [[String]] = []
    private(set) var createdBulkItems: [[BulkReservationRequest]] = []
    private(set) var operationLog: [String] = []
    var suspendsSave = false
    var suspendsList = false
    var suspendsDetail = false
    var suspendsCreate = false
    private var saveContinuation: CheckedContinuation<String, Error>?
    private var listContinuations: [CheckedContinuation<[BookingDraftSummary], Error>] = []
    private var detailContinuation: CheckedContinuation<BookingDraftDetail, Error>?
    private var createContinuation: CheckedContinuation<String, Error>?

    var hasPendingSave: Bool { saveContinuation != nil }
    var pendingListCount: Int { listContinuations.count }
    var hasPendingDetail: Bool { detailContinuation != nil }
    var hasPendingCreate: Bool { createContinuation != nil }

    func bookingDrafts() async throws -> [BookingDraftSummary] {
        if suspendsList {
            return try await withCheckedThrowingContinuation { continuation in
                listContinuations.append(continuation)
            }
        }
        return listedDrafts
    }

    func bookingDraft(id: String) async throws -> BookingDraftDetail {
        if suspendsDetail {
            return try await withCheckedThrowingContinuation { continuation in
                detailContinuation = continuation
            }
        }
        guard let draftDetail else { throw APIError.notFound }
        return draftDetail
    }

    func saveBookingDraft(
        id: String?,
        title: String,
        requesterUserId: String?,
        locationId: String?,
        startsAt: Date,
        endsAt: Date,
        notes: String?,
        eventIds: [String],
        serializedAssetIds: [String],
        bulkItems: [BulkReservationRequest]
    ) async throws -> String {
        saveCalls += 1
        savedTitles.append(title)
        savedDraftIds.append(id)
        savedRequesterUserIds.append(requesterUserId)
        savedLocationIds.append(locationId)
        savedStartsAt.append(startsAt)
        savedEndsAt.append(endsAt)
        savedNotes.append(notes)
        savedEventIds.append(eventIds)
        operationLog.append("save")
        if let saveError { throw saveError }
        if suspendsSave {
            return try await withCheckedThrowingContinuation { continuation in
                saveContinuation = continuation
            }
        }
        return savedId
    }

    func deleteBookingDraft(id: String) async throws {
        deleteCalls += 1
        if let deleteError { throw deleteError }
    }

    func createReservation(
        title: String,
        requesterUserId: String,
        locationId: String,
        startsAt: Date,
        endsAt: Date,
        notes: String?,
        eventId: String?,
        eventIds: [String],
        shiftAssignmentId: String?,
        sourceDraftId: String?,
        serializedAssetIds: [String],
        bulkItems: [BulkReservationRequest]
    ) async throws -> String {
        createCalls += 1
        createdTitles.append(title)
        createdSourceDraftIds.append(sourceDraftId)
        createdSerializedAssetIds.append(serializedAssetIds)
        createdBulkItems.append(bulkItems)
        operationLog.append("create")
        if !createResults.isEmpty {
            return try createResults.removeFirst().get()
        }
        if suspendsCreate {
            return try await withCheckedThrowingContinuation { continuation in
                createContinuation = continuation
            }
        }
        return createdId
    }

    func resumeSave() {
        let continuation = saveContinuation
        saveContinuation = nil
        continuation?.resume(returning: savedId)
    }

    func resumeOldestList(with drafts: [BookingDraftSummary]) {
        guard !listContinuations.isEmpty else { return }
        listContinuations.removeFirst().resume(returning: drafts)
    }

    func resumeDetail() {
        let continuation = detailContinuation
        detailContinuation = nil
        if let draftDetail {
            continuation?.resume(returning: draftDetail)
        } else {
            continuation?.resume(throwing: APIError.notFound)
        }
    }

    func resumeCreate() {
        let continuation = createContinuation
        createContinuation = nil
        continuation?.resume(returning: createdId)
    }
}

@MainActor
final class ReservationDraftStoreTests: XCTestCase {
    func testFailedSaveAndCloseKeepsComposerOpen() async {
        let persistence = DraftPersistenceStub()
        persistence.saveError = APIError.serverError("Save unavailable")
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Road game kit"
        store.start(composer)

        await store.saveAndClose()

        XCTAssertTrue(store.composer === composer)
        XCTAssertTrue(store.isExpanded)
        XCTAssertEqual(persistence.saveCalls, 1)
        XCTAssertEqual(store.errorMessage, "Couldn't save your draft. Save unavailable")
    }

    func testPristineSaveAndCloseDoesNotClearComposerWithoutPersistence() async {
        let persistence = DraftPersistenceStub()
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.captureBaselineIfNeeded()
        store.start(composer)

        await store.saveAndClose()

        XCTAssertTrue(store.composer === composer)
        XCTAssertTrue(store.isExpanded)
        XCTAssertEqual(persistence.saveCalls, 0)
        XCTAssertEqual(store.errorMessage, "There isn't anything to save yet.")
    }

    func testNoteOnlySaveAndClosePersistsBeforeClearingComposer() async {
        let persistence = DraftPersistenceStub()
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.captureBaselineIfNeeded()
        composer.notes = "Leave cases at the west dock."
        store.start(composer)

        XCTAssertTrue(composer.hasUnsavedInput)
        XCTAssertTrue(composer.isWorthSavingAsDraft)

        await store.saveAndClose()

        XCTAssertNil(store.composer)
        XCTAssertFalse(store.isExpanded)
        XCTAssertEqual(persistence.saveCalls, 1)
        XCTAssertEqual(persistence.savedNotes, ["Leave cases at the west dock."])
        XCTAssertEqual(store.savedDraft?.id, "draft-1")
    }

    func testEveryServerBackedDetailEditIsMeaningfulDraftInput() {
        func composer() -> CreateBookingViewModel {
            let composer = CreateBookingViewModel(draftPersistence: DraftPersistenceStub())
            composer.selectedUserId = "user-1"
            composer.selectedLocationId = "location-1"
            composer.captureBaselineIfNeeded()
            return composer
        }

        let note = composer()
        note.notes = "Call when ready"

        let requester = composer()
        requester.selectedUserId = "user-2"

        let location = composer()
        location.selectedLocationId = "location-2"

        let pickup = composer()
        pickup.startsAt = pickup.startsAt.addingTimeInterval(900)

        let returned = composer()
        returned.endsAt = returned.endsAt.addingTimeInterval(900)

        let event = composer()
        event.selectedEventIds = ["event-1"]

        for editedComposer in [note, requester, location, pickup, returned, event] {
            XCTAssertTrue(editedComposer.hasUnsavedInput)
            XCTAssertTrue(editedComposer.isWorthSavingAsDraft)
        }
    }

    func testFailedSaveAndStartNewKeepsCurrentAndPendingComposers() async {
        let persistence = DraftPersistenceStub()
        persistence.saveError = APIError.serverError("Save unavailable")
        let store = ReservationDraftStore(persistence: persistence)
        let current = CreateBookingViewModel(draftPersistence: persistence)
        current.title = "Current reservation"
        let pending = CreateBookingViewModel(draftPersistence: persistence)
        pending.title = "Next reservation"
        store.start(current)
        store.start(pending)

        await store.resolvePendingStartBySavingCurrent()

        XCTAssertTrue(store.composer === current)
        XCTAssertTrue(store.pendingStart?.composer === pending)
        XCTAssertTrue(store.isExpanded)
        XCTAssertEqual(persistence.saveCalls, 1)
    }

    func testFailedDiscardKeepsServerBoundComposerRecoverable() async {
        let persistence = DraftPersistenceStub()
        persistence.deleteError = APIError.serverError("Discard unavailable")
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Saved reservation"
        composer.serverDraftId = "draft-1"
        store.start(composer)

        await store.discard()

        XCTAssertTrue(store.composer === composer)
        XCTAssertEqual(composer.serverDraftId, "draft-1")
        XCTAssertTrue(store.isExpanded)
        XCTAssertEqual(persistence.deleteCalls, 1)
        XCTAssertEqual(store.errorMessage, "Couldn't discard your draft. Discard unavailable")
    }

    func testSuccessfulDiscardClearsComposerAfterServerDelete() async {
        let persistence = DraftPersistenceStub()
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Saved reservation"
        composer.serverDraftId = "draft-1"
        store.start(composer)

        await store.discard()

        XCTAssertNil(store.composer)
        XCTAssertFalse(store.isExpanded)
        XCTAssertEqual(persistence.deleteCalls, 1)
    }

    func testSlowAutosaveBaselinesOnlyTheSnapshotItSent() async throws {
        let persistence = DraftPersistenceStub()
        persistence.suspendsSave = true
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.selectedUserId = "user-1"
        composer.captureBaselineIfNeeded()
        composer.title = "Snapshot one"
        store.start(composer)

        let autosave = Task { await store.autosave() }
        while !persistence.hasPendingSave {
            await Task.yield()
        }

        composer.title = "Snapshot two"
        persistence.resumeSave()
        await autosave.value

        XCTAssertEqual(persistence.savedTitles, ["Snapshot one"])
        XCTAssertEqual(composer.serverDraftId, "draft-1")
        XCTAssertTrue(composer.hasUnsavedInput)
    }

    func testSaveAndCloseKeepsNewerEditsOpenWhileSlowSaveFinishes() async {
        let persistence = DraftPersistenceStub()
        persistence.suspendsSave = true
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.selectedUserId = "user-1"
        composer.captureBaselineIfNeeded()
        composer.title = "Snapshot one"
        store.start(composer)

        let close = Task { await store.saveAndClose() }
        while !persistence.hasPendingSave {
            await Task.yield()
        }

        composer.title = "Snapshot two"
        persistence.resumeSave()
        await close.value

        XCTAssertTrue(store.composer === composer)
        XCTAssertTrue(store.isExpanded)
        XCTAssertTrue(composer.hasUnsavedInput)
        XCTAssertEqual(store.statusMessage, "Draft saved. Newer edits are still open.")
    }

    func testConcurrentDraftSavesJoinOneRequest() async throws {
        let persistence = DraftPersistenceStub()
        persistence.suspendsSave = true
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "One draft"

        let first = Task { try await composer.saveDraft() }
        while !persistence.hasPendingSave {
            await Task.yield()
        }
        let second = Task { try await composer.saveDraft() }
        await Task.yield()

        XCTAssertEqual(persistence.saveCalls, 1)
        persistence.resumeSave()

        let ids = try await [first.value, second.value]
        XCTAssertEqual(ids, ["draft-1", "draft-1"])
        XCTAssertEqual(persistence.saveCalls, 1)
    }

    func testClearForSignOutPreventsLateResumeFromAdoptingOldComposer() async {
        let persistence = DraftPersistenceStub()
        persistence.suspendsDetail = true
        persistence.draftDetail = draftDetail(id: "draft-a", title: "Account A")
        let store = ReservationDraftStore(persistence: persistence)

        let resume = Task { await store.resume(draftId: "draft-a") }
        while !persistence.hasPendingDetail {
            await Task.yield()
        }

        store.clearForSignOut()
        let accountBComposer = CreateBookingViewModel(draftPersistence: persistence)
        accountBComposer.title = "Account B"
        store.start(accountBComposer)
        persistence.resumeDetail()
        await resume.value

        XCTAssertTrue(store.composer === accountBComposer)
        XCTAssertEqual(store.cardTitle, "Account B")
        XCTAssertTrue(store.isExpanded)
        XCTAssertFalse(store.isBusy)
        XCTAssertNil(store.errorMessage)
    }

    func testNewSessionListWinsOverLatePreviousSessionList() async {
        let persistence = DraftPersistenceStub()
        persistence.suspendsList = true
        let store = ReservationDraftStore(persistence: persistence)
        let oldDraft = draftSummary(id: "draft-a", title: "Account A")
        let newDraft = draftSummary(id: "draft-b", title: "Account B")

        let oldLoad = Task { await store.loadSavedDraft() }
        while persistence.pendingListCount == 0 {
            await Task.yield()
        }

        store.clearForSignOut()
        persistence.suspendsList = false
        persistence.listedDrafts = [newDraft]
        await store.loadSavedDraft()

        persistence.resumeOldestList(with: [oldDraft])
        await oldLoad.value

        XCTAssertEqual(store.savedDraft?.id, "draft-b")
        XCTAssertEqual(store.cardTitle, "Account B")
        XCTAssertFalse(store.isBusy)
    }

    func testClearForSignOutPreventsLateSaveFromAdoptingPendingComposer() async {
        let persistence = DraftPersistenceStub()
        persistence.suspendsSave = true
        let store = ReservationDraftStore(persistence: persistence)
        let accountAComposer = CreateBookingViewModel(draftPersistence: persistence)
        accountAComposer.title = "Account A current"
        let accountAPending = CreateBookingViewModel(draftPersistence: persistence)
        accountAPending.title = "Account A pending"
        store.start(accountAComposer)
        store.start(accountAPending)

        let resolve = Task { await store.resolvePendingStartBySavingCurrent() }
        while !persistence.hasPendingSave {
            await Task.yield()
        }

        store.clearForSignOut()
        let accountBComposer = CreateBookingViewModel(draftPersistence: persistence)
        accountBComposer.title = "Account B"
        store.start(accountBComposer)
        persistence.resumeSave()
        await resolve.value

        XCTAssertTrue(store.composer === accountBComposer)
        XCTAssertNil(store.pendingStart)
        XCTAssertNil(store.errorMessage)
        XCTAssertFalse(store.isBusy)
    }

    func testNeverSavedBulkOnlySubmitCreatesSourceDraftBeforeReservation() async throws {
        let persistence = DraftPersistenceStub()
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Battery kit"
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.selectedBulkQuantities = ["bulk-1": 3]

        let outcome = try await composer.submit()

        XCTAssertEqual(outcome, .created(bookingId: "booking-1"))
        XCTAssertEqual(persistence.operationLog, ["save", "create"])
        XCTAssertEqual(persistence.savedDraftIds.count, 1)
        XCTAssertNil(persistence.savedDraftIds[0])
        XCTAssertEqual(persistence.createdSourceDraftIds, ["draft-1"])
        XCTAssertEqual(persistence.createdSerializedAssetIds, [[]])
        XCTAssertEqual(persistence.createdBulkItems.first?.first?.bulkSkuId, "bulk-1")
        XCTAssertEqual(persistence.createdBulkItems.first?.first?.quantity, 3)
        XCTAssertNil(composer.serverDraftId)
    }

    func testHTTP500ReplayResendsOriginalPayloadAndPreservesLaterEditsAsNewDraft() async throws {
        let persistence = DraftPersistenceStub()
        persistence.savedId = "draft-recovery"
        persistence.createResults = [
            .failure(APIError.httpError(
                statusCode: 500,
                message: "Server failed after commit"
            )),
            .success("booking-1"),
        ]
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.captureBaselineIfNeeded()
        composer.title = "Original payload"
        composer.serverDraftId = "draft-existing"
        var submittedBookingIds: [String] = []
        composer.onReservationSubmitted = { submittedBookingIds.append($0) }

        do {
            _ = try await composer.submit()
            XCTFail("Expected the simulated 500 response")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Server failed after commit")
        }

        XCTAssertEqual(composer.serverDraftId, "draft-existing")
        XCTAssertTrue(composer.hasUnsavedInput)
        composer.title = "Later unsaved edit"

        let outcome = try await composer.submit()

        XCTAssertEqual(
            outcome,
            .committedOriginal(
                bookingId: "booking-1",
                preservation: .savedDraft(
                    id: "draft-recovery",
                    hasNewerUnsavedInput: false
                )
            )
        )
        XCTAssertEqual(persistence.saveCalls, 1)
        XCTAssertEqual(persistence.savedDraftIds, [nil])
        XCTAssertEqual(persistence.savedTitles, ["Later unsaved edit"])
        XCTAssertEqual(
            persistence.createdSourceDraftIds.compactMap { $0 },
            ["draft-existing", "draft-existing"]
        )
        XCTAssertEqual(persistence.createdTitles, ["Original payload", "Original payload"])
        XCTAssertEqual(composer.serverDraftId, "draft-recovery")
        XCTAssertEqual(composer.title, "Later unsaved edit")
        XCTAssertFalse(composer.hasUnsavedInput)
        XCTAssertTrue(submittedBookingIds.isEmpty)
    }

    func testLostResponseReplayWithoutLaterEditsFinishesNormally() async throws {
        let persistence = DraftPersistenceStub()
        persistence.createResults = [
            .failure(APIError.networkError(URLError(.networkConnectionLost))),
            .success("booking-1"),
        ]
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Original payload"
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.serverDraftId = "draft-existing"
        var submittedBookingIds: [String] = []
        composer.onReservationSubmitted = { submittedBookingIds.append($0) }

        do {
            _ = try await composer.submit()
            XCTFail("Expected the simulated response loss")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "No internet connection. Check your network and try again."
            )
        }

        let outcome = try await composer.submit()

        XCTAssertEqual(outcome, .created(bookingId: "booking-1"))
        XCTAssertEqual(persistence.saveCalls, 0)
        XCTAssertEqual(persistence.createdTitles, ["Original payload", "Original payload"])
        XCTAssertEqual(
            persistence.createdSourceDraftIds.compactMap { $0 },
            ["draft-existing", "draft-existing"]
        )
        XCTAssertNil(composer.serverDraftId)
        XCTAssertEqual(submittedBookingIds, ["booking-1"])
    }

    func testDefiniteServerRejectionAllowsCorrectedPayloadOnNextSubmit() async throws {
        let persistence = DraftPersistenceStub()
        persistence.createResults = [
            .failure(APIError.httpError(statusCode: 400, message: "Title is invalid")),
            .success("booking-1"),
        ]
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Rejected payload"
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.serverDraftId = "draft-existing"

        do {
            _ = try await composer.submit()
            XCTFail("Expected the definite server rejection")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Title is invalid")
        }

        composer.title = "Corrected payload"
        let outcome = try await composer.submit()

        XCTAssertEqual(outcome, .created(bookingId: "booking-1"))
        XCTAssertEqual(persistence.createdTitles, ["Rejected payload", "Corrected payload"])
    }

    func testEditsMadeDuringSuccessfulCreateRemainOpenAsNewDraft() async throws {
        let persistence = DraftPersistenceStub()
        persistence.suspendsCreate = true
        persistence.savedId = "draft-later"
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Submitted snapshot"
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.serverDraftId = "draft-existing"

        let submit = Task { try await composer.submit() }
        while !persistence.hasPendingCreate {
            await Task.yield()
        }

        composer.notes = "Added while waiting"
        persistence.resumeCreate()
        let outcome = try await submit.value

        XCTAssertEqual(
            outcome,
            .committedOriginal(
                bookingId: "booking-1",
                preservation: .savedDraft(
                    id: "draft-later",
                    hasNewerUnsavedInput: false
                )
            )
        )
        XCTAssertEqual(persistence.savedNotes, ["Added while waiting"])
        XCTAssertEqual(persistence.savedDraftIds, [nil])
        XCTAssertEqual(composer.serverDraftId, "draft-later")
    }

    func testLatePreviousSessionSubmitCannotFinishReplacementComposer() async throws {
        let persistence = DraftPersistenceStub()
        persistence.suspendsCreate = true
        let store = ReservationDraftStore(persistence: persistence)
        let accountAComposer = CreateBookingViewModel(draftPersistence: persistence)
        accountAComposer.title = "Account A"
        accountAComposer.selectedUserId = "user-a"
        accountAComposer.selectedLocationId = "location-a"
        accountAComposer.selectedBulkQuantities = ["bulk-a": 1]
        store.start(accountAComposer)

        let submit = Task { try await accountAComposer.submit() }
        while !persistence.hasPendingCreate {
            await Task.yield()
        }

        store.clearForSignOut()
        let accountBComposer = CreateBookingViewModel(draftPersistence: persistence)
        accountBComposer.title = "Account B"
        store.start(accountBComposer)
        persistence.resumeCreate()
        let accountAOutcome = try await submit.value
        store.finish(bookingId: accountAOutcome.bookingId)

        XCTAssertTrue(store.composer === accountBComposer)
        XCTAssertEqual(store.cardTitle, "Account B")
        XCTAssertNil(store.createdBookingId)
        XCTAssertTrue(store.isExpanded)
    }

    func testCurrentComposerSubmitStillFinishesNormally() async throws {
        let persistence = DraftPersistenceStub()
        let store = ReservationDraftStore(persistence: persistence)
        let composer = CreateBookingViewModel(draftPersistence: persistence)
        composer.title = "Current account"
        composer.selectedUserId = "user-1"
        composer.selectedLocationId = "location-1"
        composer.selectedBulkQuantities = ["bulk-1": 1]
        store.start(composer)

        let outcome = try await composer.submit()
        store.finish(bookingId: outcome.bookingId)

        XCTAssertNil(store.composer)
        XCTAssertEqual(store.createdBookingId, "booking-1")
        XCTAssertFalse(store.isExpanded)
    }

    private func draftSummary(id: String, title: String) -> BookingDraftSummary {
        BookingDraftSummary(
            id: id,
            kind: "RESERVATION",
            title: title,
            locationName: "Camp Randall",
            startsAt: Date(timeIntervalSince1970: 1_800_000_000),
            endsAt: Date(timeIntervalSince1970: 1_800_003_600),
            itemCount: 1,
            updatedAt: Date(timeIntervalSince1970: 1_799_999_000)
        )
    }

    private func draftDetail(id: String, title: String) -> BookingDraftDetail {
        BookingDraftDetail(
            id: id,
            kind: "RESERVATION",
            title: title,
            requesterUserId: "user-a",
            locationId: "location-a",
            locationName: "Camp Randall",
            startsAt: Date(timeIntervalSince1970: 1_800_000_000),
            endsAt: Date(timeIntervalSince1970: 1_800_003_600),
            eventId: nil,
            events: [],
            sportCode: nil,
            notes: "",
            serializedAssetIds: [],
            bulkItems: [],
            updatedAt: Date(timeIntervalSince1970: 1_799_999_000)
        )
    }
}
