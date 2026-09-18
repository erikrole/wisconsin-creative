import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const store = readFileSync("ios/Wisconsin/Core/ReservationDraftStore.swift", "utf8");
const sheet = readFileSync("ios/Wisconsin/Views/CreateBookingSheet.swift", "utf8");
const composer = readFileSync("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift", "utf8");
const shell = readFileSync("ios/Wisconsin/Views/AppTabView.swift", "utf8");
const card = readFileSync("ios/Wisconsin/Views/Components/ReservationDraftCard.swift", "utf8");
const api = readFileSync("ios/Wisconsin/Core/APIClient.swift", "utf8");
const app = readFileSync("ios/Wisconsin/App/WisconsinApp.swift", "utf8");
const reservationRoute = readFileSync("src/app/api/reservations/route.ts", "utf8");
const draftModels = readFileSync("ios/Wisconsin/Models/DraftModels.swift", "utf8");

// Every surface that starts a reservation hands off to the shared draft store.
// Event detail is deliberately absent: gear left that screen when it became a
// staffing console, so it no longer starts reservations at all.
const CALL_SITES = [
  "ios/Wisconsin/Views/BookingsView.swift",
  "ios/Wisconsin/Views/ItemsView.swift",
  "ios/Wisconsin/Views/ItemDetailView.swift",
  "ios/Wisconsin/Views/DevTools/ScannerDebuggerView.swift",
];

describe("iOS reservation drafts use the shared server contract", () => {
  it("talks to /api/drafts rather than persisting locally", () => {
    expect(api).toContain('func bookingDrafts() async throws -> [BookingDraftSummary]');
    expect(api).toContain('func bookingDraft(id: String) async throws -> BookingDraftDetail');
    expect(api).toContain("func saveBookingDraft(");
    expect(api).toContain('request(path: "/api/drafts", method: "POST")');
    expect(api).toContain('request(path: "/api/drafts/\\(id)", method: "DELETE")');
    // The route only accepts RESERVATION or CHECKOUT; iOS composes reservations.
    expect(api).toContain('kind: "RESERVATION"');
  });

  it("re-uses an existing draft row instead of piling up new ones", () => {
    expect(composer).toContain("var serverDraftId: String?");
    expect(composer).toContain("id: snapshot.serverDraftId,");
    expect(composer).toContain("baseline = snapshot.baseline");
    expect(composer).toContain("if let existing = draftSaveOperation");
    expect(composer).toContain("draftSaveRequests.owns(requestToken)");
  });

  it("consumes the source draft atomically with reservation creation", () => {
    expect(composer).toContain("sourceDraftId: sourceDraftId");
    expect(composer).not.toContain("try? await APIClient.shared.deleteBookingDraft");
    expect(api).toContain("let sourceDraftId: String?");
    expect(reservationRoute).toContain("replayConsumedDraftReservation");
    expect(reservationRoute).toContain('action: "draft_consumed"');
    expect(reservationRoute).toContain("createdReservationId");
  });

  it("binds every replay id to one immutable payload and preserves later edits separately", () => {
    const sourceIdHelper = composer.slice(
      composer.indexOf("private func sourceDraftIdForSubmission()"),
      composer.indexOf("/// Rehydrates a saved draft"),
    );
    expect(sourceIdHelper).toContain("if let existing = draftSaveOperation");
    expect(sourceIdHelper).toContain("if let serverDraftId {");
    expect(sourceIdHelper).toContain("return serverDraftId");
    expect(sourceIdHelper).toContain("return try await saveDraft(allowDuringSubmission: true)");

    const submitBody = composer.slice(
      composer.indexOf(
        "func submit() async throws -> ReservationSubmissionOutcome",
      ),
      composer.indexOf("private func compareAssetsByDisplayName"),
    );
    const acquireIndex = submitBody.indexOf(
      "let sourceDraftId = try await sourceDraftIdForSubmission()",
    );
    const postIndex = submitBody.indexOf("draftPersistence.createReservation(");
    expect(acquireIndex).toBeGreaterThanOrEqual(0);
    expect(postIndex).toBeGreaterThan(acquireIndex);
    expect(submitBody).toContain("sourceDraftId: sourceDraftId");
    expect(submitBody).toContain("if let uncertainReservationSubmission");
    expect(submitBody).toContain("uncertainReservationSubmission.payload");
    expect(submitBody).toContain(
      "uncertainReservationSubmission.sourceDraftId",
    );
    expect(submitBody).toContain(
      "private func finishCommittedSubmission(",
    );
    expect(submitBody).toContain("serverDraftId = nil");
    expect(submitBody).toContain("saveDraft(allowDuringSubmission: true)");
    expect(submitBody).toContain(".committedOriginal(");
    expect(draftModels).toContain("func createReservation(");
  });

  it("keeps HTTP status so 5xx replay is indeterminate and 4xx rejection is definite", () => {
    expect(api).toContain(
      "case httpError(statusCode: Int, message: String)",
    );
    expect(api).toContain(
      "APIError.httpError(statusCode: http.statusCode, message: msg)",
    );
    expect(composer).toContain("case .httpError(let statusCode, _):");
    expect(composer).toContain("return (500...599).contains(statusCode)");
  });
});

describe("iOS reservation composer survives leaving the sheet", () => {
  it("keeps the composer in the store, not in sheet state", () => {
    expect(store).toContain("private(set) var composer: CreateBookingViewModel?");
    expect(store).toContain("var step = 1");
    expect(sheet).toContain("@Environment(ReservationDraftStore.self) private var drafts");
    expect(sheet).toContain("private var step: Int { drafts.step }");
    expect(sheet).not.toContain("@State private var vm");
    expect(sheet).not.toContain("@State private var step");
  });

  it("treats swipe-down as minimize and never blocks it", () => {
    expect(sheet).toContain(".interactiveDismissDisabled(vm.isSubmitting)");
    expect(shell).toMatch(/set: \{ isExpanded in\s*if !isExpanded \{ drafts\.minimize\(\) \}/);
    expect(store).toContain("func minimize() {");
  });

  it("offers a visible minimize control alongside the gesture", () => {
    expect(sheet).toContain('drafts.minimize()');
    expect(sheet).toContain('Image(systemName: "chevron.down")');
    expect(sheet).toContain('.accessibilityLabel("Minimize reservation")');
  });

  it("exits through a keep-or-discard choice instead of discard-only", () => {
    expect(sheet).toContain('"Save this reservation as a draft?"');
    expect(sheet).toContain('Button("Save Draft")');
    expect(sheet).toContain('Button("Discard", role: .destructive)');
    expect(sheet).toContain('Button("Keep Editing", role: .cancel)');
    expect(sheet).not.toContain('"Discard reservation?"');
  });

  it("only prompts when there is work worth keeping", () => {
    expect(sheet).toContain("if vm.hasUnsavedInput {");
    expect(composer).toContain("var isWorthSavingAsDraft: Bool");
    expect(composer).toContain("serverDraftId != nil || hasUnsavedInput");
    expect(composer).toContain("eventIds: draftEventIds");
    expect(composer).toContain("func captureBaselineIfNeeded()");
  });

  it("never reports a pristine Save Draft as successful persistence", () => {
    const saveBody = store.slice(
      store.indexOf("private func saveCurrentComposerAsDraft("),
      store.indexOf("private func summary("),
    );
    expect(saveBody).toContain("guard composer.isWorthSavingAsDraft else {");
    expect(saveBody).toContain(
      "errorMessage = \"There isn't anything to save yet.\"",
    );
    expect(saveBody).toContain("return false");
    expect(saveBody).not.toContain(
      "guard composer.isWorthSavingAsDraft else { return true }",
    );
  });

  // Regression: resuming a saved draft re-baselines the composer, so
  // `hasUnsavedInput` is false and Cancel fell through to `discard()` —
  // silently deleting the draft the user had deliberately kept.
  it("backing out of an untouched saved draft does not delete it", () => {
    expect(sheet).toContain("} else if vm.serverDraftId != nil {");
    expect(sheet).toContain("Task { await drafts.closeKeepingDraft() }");
    expect(store).toContain("func closeKeepingDraft() async {");
    const closeBody = store.slice(
      store.indexOf("func closeKeepingDraft() async {"),
      store.indexOf("/// Exits and throws the work away"),
    );
    expect(closeBody).not.toContain("deleteServerDraftIfAny");
  });

  it("keeps the Event Linked / Manual choice across a minimize", () => {
    expect(composer).toContain("var usesEventLinkedSetup = true");
    expect(sheet).toContain("vm.usesEventLinkedSetup ? .event : .manual");
    expect(sheet).not.toContain("@State private var setupMode");
  });
});

describe("iOS reservation draft card", () => {
  it("hangs off the tab shell so it outlives any one screen", () => {
    expect(shell).toContain("tabViewBottomAccessory");
    expect(shell).toContain("ReservationDraftCard(");
    expect(store).toContain("var showsCard: Bool {");
    expect(card).toContain("@Environment(\\.tabViewBottomAccessoryPlacement) private var placement");
  });

  it("routes the card's close control back through the same choice", () => {
    expect(shell).toContain("onClose: { showDraftCloseOptions = true }");
    expect(shell).toContain('Button("Save Draft") { Task { await drafts.saveAndClose() } }');
    expect(shell).toContain('Button("Discard", role: .destructive) { Task { await drafts.discard() } }');
  });

  it("restores the newest saved reservation draft as a resume target", () => {
    expect(store).toContain("func loadSavedDraft() async {");
    expect(store).toContain("first(where: { $0.isReservation })");
    expect(shell).toContain("await drafts.loadSavedDraft()");
  });

  it("hides the accessory slot rather than leaving an empty pill", () => {
    expect(shell).toContain("ReservationDraftAccessory(isVisible: drafts.showsCard)");
    expect(shell).toContain("tabViewBottomAccessory(isEnabled: isVisible)");
    expect(shell).toContain("if #available(iOS 26.1, *)");
  });

  it("resumes a reservation draft from the Home drafts list", () => {
    const home = readFileSync("ios/Wisconsin/Views/HomeView.swift", "utf8");
    expect(home).toContain("if draft.isReservation {");
    expect(home).toContain("Task { await drafts.resume(draftId: draft.id) }");
    // `/api/dashboard` passes the raw Prisma enum through, so the old
    // lowercase comparison never matched and every draft drew the same icon.
    const models = readFileSync("ios/Wisconsin/Models/DashboardModels.swift", "utf8");
    expect(models).toContain('kind.caseInsensitiveCompare("RESERVATION") == .orderedSame');
    expect(home).not.toContain('draft.kind == "checkout"');
  });

  it("persists on backgrounding and clears on sign-out", () => {
    expect(app).toContain("Task { await drafts.autosave() }");
    expect(app).toContain("drafts.clearForSignOut()");
    expect(store).toContain("func autosave() async {");
  });

  it("revokes old-session load ownership before any late response can publish", () => {
    expect(store).toContain("private var sessionBoundaryId = UUID()");
    expect(store).toContain("private var loadTask: Task<Void, Never>?");
    expect(store).toContain("private var loadRequests = LatestRequestGeneration()");
    expect(store).toContain("sessionBoundaryId = UUID()");
    expect(store).toContain("composer?.cancelDraftPersistenceForSessionBoundary()");

    const resumeBody = store.slice(
      store.indexOf("private func performResume("),
      store.indexOf("/// Exits and keeps the work"),
    );
    expect(resumeBody).toContain("let detail = try await persistence.bookingDraft(id: draftId)");
    expect(resumeBody).toContain("await vm.applyDraft(detail)");
    const afterApply = resumeBody.slice(resumeBody.indexOf("await vm.applyDraft(detail)"));
    expect(afterApply).toContain(
      "guard canPublishLoad(requestToken: requestToken, ownership: ownership) else { return }",
    );

    const listBody = store.slice(
      store.indexOf("private func performSavedDraftLoad("),
      store.indexOf("func clearForSignOut()"),
    );
    expect(listBody).toContain("await persistence.bookingDrafts()");
    expect(listBody).toContain("canPublishLoad(requestToken: requestToken, ownership: ownership)");
    expect(store).toContain("pendingStart?.composer === pending.composer");
  });
});

describe("iOS reservation entry points hand off to the store", () => {
  it("no longer presents the sheet per call site", () => {
    for (const path of CALL_SITES) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("CreateBookingSheet(");
      expect(source, path).toContain("drafts.start(");
    }
  });

  it("routes creation centrally because the composer outlives its origin", () => {
    expect(store).toContain("func finish(bookingId: String) {");
    expect(store).toContain("guard ownedSubmissionBookingId == bookingId else { return }");
    expect(store).toContain("self.composer === newComposer");
    expect(composer).toContain("onReservationSubmitted?(receipt.id)");
    expect(sheet).toContain("drafts.finish(bookingId: bookingId)");
    expect(shell).toContain("appState.pendingBookingDetailId = bookingId");
    const bookings = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");
    expect(bookings).toContain("private func consumePendingBookingDetail() {");
    expect(bookings).toContain("navigationPath.append(bookingId)");
  });

  it("arbitrates a second reservation instead of dropping either one", () => {
    expect(store).toContain("private(set) var pendingStart: PendingStart?");
    expect(shell).toContain('Button("Save Draft & Start New")');
    expect(shell).toContain('Button("Discard & Start New", role: .destructive)');
  });

  it("keeps draft transitions open when persistence fails", () => {
    expect(store).toContain("guard await saveCurrentComposerAsDraft(");
    expect(store).toContain("guard await deleteServerDraftIfAny(");
    expect(store).toContain("private func deleteServerDraftIfAny(");
    expect(store).not.toContain("try? await APIClient.shared.deleteBookingDraft");
  });
});
