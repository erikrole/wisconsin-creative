import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function createBookingSource() {
  return [
    "ios/Wisconsin/Views/CreateBookingSheet.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingEventViews.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingFormRows.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingPickers.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift",
  ].map(source).join("\n");
}

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

describe("iOS create booking picker parity", () => {
  it("can scan equipment directly into the native booking picker", () => {
    const createSheet = createBookingSource();
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");

    expect(createSheet).toContain("@State private var showScanner = false");
    // Continuous scanning: the scanner stays open between hits and both
    // serialized assets and bulk families land in the reservation.
    expect(createSheet).toContain("QRScannerSheet(resolve: { match in");
    expect(createSheet).toContain("case .asset(let assetId):");
    expect(createSheet).toContain("let outcome = await vm.addScannedAsset(id: assetId)");
    expect(createSheet).toContain("case .itemFamily(let family):");
    expect(createSheet).toContain("let outcome = vm.addScannedFamily(family)");
    expect(createSheet).toContain(".continueScanning(message: outcome.message, success: outcome.success)");
    expect(createSheet).toContain("func addScannedAsset(id: String) async");
    expect(createSheet).toContain("let detail = try await APIClient.shared.asset(id: id)");
    expect(createSheet).toContain("let asset = detail.asAsset");
    // Scan is reachable from the equipment step's toolbar.
    expect(sheet).toContain("Image(systemName: \"barcode.viewfinder\")");
    expect(sheet).toContain(".accessibilityLabel(\"Scan equipment\")");
  });

  it("treats counted supplies as first-class selected equipment", () => {
    const createSheet = createBookingSource();
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const review = sliceBetween(
      sheet,
      "private var reviewStep: some View",
      "private func reviewSectionHeader",
    );

    expect(createSheet).toContain("var selectedBulkTotal: Int");
    expect(createSheet).toContain("selectedAssetIds.count + selectedBulkTotal");
    expect(createSheet).toContain("selectedBulkQuantities.values.reduce(0, +)");
    expect(createSheet).not.toContain("Batteries & Counted Items");
    expect(createSheet).toContain("BulkQuantityRow(");
    expect(createSheet).toContain("BulkResultRow(");
    expect(review).toContain('reviewSectionHeader(title: "Gear", count: vm.selectedEquipmentCount, editStep: 2)');
    expect(review).toContain("ForEach(Array(vm.selectedBulkSkus.enumerated()), id: \\.element.id)");
    expect(review).toContain("Text(\"×\\(vm.quantity(for: sku))\")");
    expect(review).not.toContain("more selected");
  });

  it("submits selected bulk quantities through the shared API client", () => {
    const createSheet = createBookingSource();
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    expect(createSheet).toContain("bulkItems: selectedBulkRequests");
    expect(createSheet).toContain(".map { BulkReservationRequest(bulkSkuId: $0.key, quantity: $0.value) }");
    expect(apiClient).toContain("struct BulkReservationRequest: Codable, Equatable");
    expect(apiClient).toContain("bulkItems: [BulkReservationRequest] = []");
    expect(apiClient).toContain("bulkItems: bulkItems");
  });

  it("sorts the available equipment picker by the displayed product name", () => {
    const assetsRoute = source("src/app/api/assets/route.ts");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const createSheet = createBookingSource();

    expect(assetsRoute).toMatch(/name:\s*\[\{\s*brand:\s*"asc"\s*\},\s*\{\s*model:\s*"asc"\s*\},\s*\{\s*assetTag:\s*"asc"\s*\}\]/);
    expect(apiClient).toContain("sort: String? = nil");
    expect(apiClient).toContain('items.append(.init(name: "sort", value: sort))');
    // Browse leads with popularity; explicit searches stay alphabetical.
    expect(createSheet).toContain('sort: capturedSearch.isEmpty ? "popular" : "name"');
    expect(createSheet).toContain("let rankedAssets = availableAssets.filter(isReservablePickerAsset)");
    expect(createSheet).toContain("popularItemOrder = resp.itemOrder");
    expect(createSheet).toContain("var displayedCategoryResults: [ReservationPickerResult]?");
    expect(createSheet).toContain("let rank = Dictionary(uniqueKeysWithValues: popularItemOrder.enumerated()");
    expect(assetsRoute).toContain("if (shouldUsePopularitySort && a.popularity !== b.popularity) return b.popularity - a.popularity");
  });

  it("loads a bounded cross-location picker and makes pickup mismatches explicit", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const createSheet = createBookingSource();
    const picker = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift");
    const loadAvailableAssets = sliceBetween(
      createSheet,
      "func loadAvailableAssets(reset: Bool = false) async",
      "func toggleAsset",
    );

    expect(apiClient).toContain("locationId: String? = nil");
    expect(apiClient).toContain('items.append(.init(name: "location_id", value: locationId))');
    expect(createSheet).toContain("private let assetPickerLimit = 300");
    expect(loadAvailableAssets).toContain("locationId: nil");
    expect(loadAvailableAssets).toContain("limit: assetPickerLimit");
    expect(loadAvailableAssets).toContain("offset: 0");
    expect(loadAvailableAssets).toContain("availableAssets = resp.data");
    expect(createSheet).toContain("struct AssetCategoryGroup: Identifiable");
    expect(createSheet).toContain("var availableAssetGroups: [AssetCategoryGroup]");
    expect(createSheet).toContain("return categoryName?.isEmpty == false ? categoryName! : \"Uncategorized\"");
    // The picker renders the displayed groups (popular-first browse, category
    // chips, or grouped search results) as native sections.
    expect(createSheet).toContain("var displayedAssetGroups: [AssetCategoryGroup]");
    expect(picker).toContain("let displayedAssetGroups = vm.displayedAssetGroups");
    expect(picker).toContain("ForEach(displayedAssetGroups) { group in");
    expect(picker).toContain("ForEach(group.assets) { asset in");
    expect(picker).toContain("Section(group.title)");
    expect(picker).toContain("More equipment exists. Search to narrow results.");
    expect(picker).not.toContain("Task { await vm.loadAvailableAssets() }");
    expect(createSheet).toContain("func isAtPickupLocation(_ asset: Asset) -> Bool");
    expect(createSheet).toContain("selectedLocationMismatchCount");
    expect(createSheet).toContain("Choose \\(asset.location.name) pickup to add");
    expect(picker).toContain(".disabled(!vm.canReviewEquipment)");
  });

  it("keeps attachment categories out of native reservation equipment browsing", () => {
    const createSheet = createBookingSource();

    expect(createSheet).toContain("private func isReservablePickerAsset(_ asset: Asset) -> Bool");
    expect(createSheet).toContain("private func isHiddenAttachmentCategory(_ title: String?) -> Bool");
    expect(createSheet).toContain("availableAssets.filter(isReservablePickerAsset)");
    expect(createSheet).toContain("normalized == \"accessories\"");
    expect(createSheet).toContain("normalized == \"camera accessories\"");
    expect(createSheet).toContain("normalized.hasSuffix(\"/accessories\")");
    expect(createSheet).toContain('private static let reservationCategories = ["Cameras", "Lenses", "Batteries", "Other"]');
    expect(createSheet).toContain("let visibleSkus = availableBulkSkus.filter { !isHiddenAttachmentCategory(bulkCategoryTitle($0)) }");
  });

  it("makes native reservation picker rows match their visible full-row hit targets", () => {
    const pickers = source("ios/Wisconsin/Views/CreateBooking/CreateBookingPickers.swift");

    expect(pickers.match(/\.contentShape\(Rectangle\(\)\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("shows battery/counted-item photos in the native picker", () => {
    const formOptions = source("src/app/api/form-options/route.ts");
    const models = source("ios/Wisconsin/Models/FormModels.swift");
    const createSheet = createBookingSource();
    const equipmentRows = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift");
    const thumbnailLoader = source("ios/Wisconsin/Core/ThumbnailLoader.swift");
    const bulkRow = createSheet.slice(createSheet.indexOf("struct BulkQuantityRow"));

    expect(formOptions).toContain("imageUrl: true");
    expect(formOptions).toContain("imageUrl: s.imageUrl");
    expect(models).toContain("let imageUrl: String?");
    expect(bulkRow).toContain("BookingBulkThumbnail(imageUrl: sku.imageUrl)");
    expect(equipmentRows.match(/CachedThumbnail\(url: url, size: size\)/g)).toHaveLength(2);
    expect(equipmentRows).not.toContain("AsyncImage(");
    expect(thumbnailLoader).toContain("struct CachedThumbnail: View");
  });

  it("lets native reservation creation link upcoming events", () => {
    const createSheet = createBookingSource();
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const scheduleModels = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const details = sliceBetween(
      sheet,
      "private var detailsForm: some View",
      "private var setupModeBinding",
    );
    const eventCard = sliceBetween(
      createSheet,
      "struct EventSelectionCard: View",
      "struct EventPickRow: View",
    );

    expect(createSheet).toContain("var events: [ScheduleEvent] = []");
    expect(createSheet).toContain("var selectedEventIds: [String] = []");
    expect(createSheet).toContain("var prefillEvent: ScheduleEvent?");
    expect(createSheet).toContain("func loadEvents() async");
    expect(createSheet).toContain("events = try await APIClient.shared.calendarEvents(includePast: false, limit: 60)");
    expect(createSheet).toContain("static let maxLinkedEvents = 5");
    expect(createSheet).toContain("guard selectedEventIds.count < BookingEventLimits.maxLinkedEvents");
    expect(createSheet).toContain("selectedEvents.count >= BookingEventLimits.maxLinkedEvents");
    expect(createSheet).toContain("sortSelectedEventIds()");
    expect(createSheet).toContain("applySelectedEventsToDetails()");
    expect(createSheet).toContain("eventIds: selectedEventIds");
    expect(createSheet).toContain("eventId: selectedEventIds.isEmpty ? prefillEventId : nil");
    expect(apiClient).toContain("eventIds: [String] = []");
    expect(apiClient).toContain("let eventIds: [String]?");
    expect(apiClient).toContain("eventIds: eventIds.isEmpty ? nil : eventIds");
    expect(details).toContain("EventSelectionCard(");
    expect(sheet).toContain('case event = "Event Linked"');
    expect(sheet).toContain('case manual = "Manual"');
    expect(sheet).toContain("vm.usesEventLinkedSetup ? .event : .manual");
    expect(sheet).toContain("vm.usesEventLinkedSetup = mode == .event");
    expect(eventCard).not.toContain("Text(\"Link an Event\")");
    expect(eventCard).toContain("EventChip(event: event)");
    expect(eventCard).toContain("AllEventsPickerView(");
    expect(eventCard).toContain('Text(selectedEvents.isEmpty ? "Choose Event" : "Edit Linked Events")');
    expect(eventCard).not.toContain('Text(selectedEvents.isEmpty ? "Choose from');
    expect(eventCard).toContain("EventPickRow(");
    expect(eventCard).toContain('Image(systemName: "checkmark")');
    expect(eventCard).toContain('.accessibilityLabel("Confirm event selection")');
    expect(eventCard).toContain('case home = "Home"');
    expect(eventCard).toContain('case away = "Away"');
    expect(eventCard).toContain('case neutral = "Neutral"');
    expect(eventCard).toContain('case nonGame = "Non-game"');
    expect(eventCard).toContain("case .neutral: isGame && event.isHome == nil");
    expect(eventCard).toContain("case .nonGame: !isGame");
    expect(createSheet).toContain("StatusRail(color: event.bookingEventRailColor)");
    expect(createSheet).toContain("Text(event.bookingEventScopeLabel)");
    expect(createSheet).toContain("Text(event.bookingEventPickerDate)");
    expect(createSheet).toContain("if let venue = event.bookingEventPickerVenue");
    expect(createSheet).toContain("Text(venue)");
    expect(createSheet).toContain(".weekday(.abbreviated).month(.abbreviated).day().hour().minute()");
    expect(createSheet).toContain('return "\\(bookingEventPickerDate), \\(venue)"');
    // The picker names the venue through the one shared helper every schedule
    // surface uses. It used to keep only the last comma component and rewrite
    // "Track/Soccer" to "Soccer", which named a venue-last string ("Camp Randall
    // Stadium, Madison, WI") simply "WI". Both the bespoke parse and the
    // venue-specific rewrite are gone.
    expect(createSheet).toContain("scheduleEventVenueName(self)");
    expect(createSheet).not.toContain("let source = location?.name ?? rawLocationText");
    expect(createSheet).not.toContain('replacingOccurrences(of: "Track/Soccer", with: "Soccer")');
    expect(scheduleModels).toContain("var rawLocationText: String?");
    expect(createSheet).not.toContain("sportLabel(event.sportCode)");
  });

  it("keeps reservation details compact and uses deliberate schedule controls", () => {
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const viewModel = source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift");
    const details = sliceBetween(sheet, "private var detailsForm: some View", "private var setupModeBinding");

    expect(details).toContain('Text("Reservation Title")');
    expect(details).toContain('BrandSectionHeader("Set Schedule From")');
    expect(details).toContain('BrandSectionHeader("Pickup Location")');
    expect(details).toContain("vm.primaryPickupLocations");
    expect(details).toContain("QuarterHourDatePickerRow(");
    expect(sheet).toContain("private let quarterHours = Array(0..<96)");
    expect(sheet).toContain('DatePicker(\n                "\\(label) date"');
    expect(sheet).toContain('Picker("\\(label) time", selection: quarterBinding)');
    expect(sheet).not.toContain("UIViewRepresentable");
    expect(details).not.toContain("BookingStepHeader(");
    expect(details).not.toContain('label: "For"');
    expect(sheet).not.toContain("BookingDurationPreset");
    expect(viewModel).toContain('private static let reservationCategories = ["Cameras", "Lenses", "Batteries", "Other"]');
    expect(details.indexOf('BrandSectionHeader("Set Schedule From")')).toBeLessThan(
      details.indexOf("reservationTitleCard"),
    );
    expect(details).toContain("if vm.linkedEventCount > 0");
    expect(details).toContain("scheduleWindowCard");
    expect(viewModel).toContain("private let eventPickupLeadTime: TimeInterval = 60 * 60");
    expect(viewModel).toContain("private let eventReturnBuffer: TimeInterval = 2 * 60 * 60");
    expect(viewModel).toContain("startsAt = first.startsAt.addingTimeInterval(-eventPickupLeadTime)");
    expect(viewModel).toContain("endsAt = last.endsAt.addingTimeInterval(eventReturnBuffer)");
    expect(viewModel).toContain("startsAt = newStart\n        scheduleConflictCheck()");
    expect(viewModel).not.toContain("endsAt = newStart.addingTimeInterval");
  });

  it("suggests location-valid power for Sony cameras, FX6 bodies, and monitors", () => {
    const createSheet = createBookingSource();
    const picker = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift");

    expect(createSheet).toContain("var batteryRecommendations: [BatteryRecommendation]");
    expect(createSheet).toContain("var batterySuggestions: [BatteryRecommendation]");
    expect(createSheet).toContain("powerRecommendations(includeSatisfied: true)");
    expect(createSheet).toContain('matching: ["sony", "battery"]');
    expect(createSheet).toContain('matching: ["gold", "mount"]');
    expect(createSheet).toContain('matching: ["monitor", "battery"]');
    expect(createSheet).toContain("guard isAtPickupLocation(sku) else { return false }");
    expect(createSheet).toContain("var reminderKey: String");
    expect(picker).toContain("private struct BatteryRecommendationCard");
    expect(picker).toContain("activeRecommendations");
    expect(picker).toContain("vm.batterySuggestions.filter");
    expect(picker).toContain("ForEach(activeRecommendations)");
    expect(picker).toContain("activeRecommendations.map(\\.reminderKey)");
    expect(picker).toContain("DragGesture(minimumDistance: 18)");
    expect(picker).toContain('vm.browseCategoryFilter = "Batteries"');
    expect(picker).toContain("guard !vm.hasSelectedPower, let recommendation = vm.batteryRecommendations.first else");
    expect(picker).toContain("onReview()\n            return");
    expect(createSheet).toContain("private var selectedAssetOrder: [String] = []");
    expect(createSheet).toContain(".sorted { $0.0 < $1.0 }");
    const recommendationCard = sliceBetween(
      picker,
      "private struct BatteryRecommendationCard",
      "// MARK: - Cart drawer",
    );
    expect(recommendationCard).toContain('Text(recommendation.sku.name)');
    expect(recommendationCard).not.toContain('Text("Add \\(recommendation.sku.name)")');
    expect(recommendationCard).not.toContain("recommendation.reason");
    expect(picker).not.toContain('Section("Don\'t forget power")');
  });

  it("keeps all gear categories visible and counted quantities explicit", () => {
    const picker = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift");
    const bulkRow = sliceBetween(picker, "struct BulkResultRow: View", "private struct ReservationCategoryChip");

    expect(picker).toContain("ViewThatFits(in: .horizontal)");
    expect(picker).toContain('ReservationCategoryChip(label: "All"');
    expect(picker).toContain("ForEach(vm.browseCategories");
    expect(bulkRow).toContain("let onDecrement: () -> Void");
    expect(bulkRow).toContain("let onIncrement: () -> Void");
    expect(bulkRow).toContain('Image(systemName: "minus")');
    expect(bulkRow).toContain('Image(systemName: "plus")');
    expect(bulkRow).toContain('Text("\\(quantity)")');
    expect(bulkRow.match(/Color\.statusBackground\(\.purple\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(bulkRow).toContain('"\\(sku.availableQuantity)/\\(sku.currentQuantity) available"');
    const viewModel = source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift");
    expect(viewModel).toContain('private static let reservationCategories = ["Cameras", "Lenses", "Batteries", "Other"]');
    expect(viewModel).toContain('return "Other"');
    expect(viewModel).toContain("reservationCategory(for: $0) == filter");
    expect(picker).toContain("ForEach(categoryResults)");
  });

  it("promotes the user-updated Icon Composer scale into the active app icon", () => {
    const activeIcon = source("ios/Wisconsin/AppIcons/AppIcon.icon/icon.json");
    const candidateIcon = source("ios/IconSources/IconComposerCandidates/vintage-helmet/BlockW.icon/icon.json");

    expect(activeIcon).toContain('"scale" : 1.75');
    expect(activeIcon.trimEnd()).toBe(candidateIcon.trimEnd());
  });

  it("shows explicit linked-event pickup and return windows in review", () => {
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");

    expect(sheet).toContain("private var reviewPickupText: String");
    expect(sheet).toContain("private var reviewReturnText: String");
    expect(sheet).not.toContain("selectedAllDayWindowText");
    expect(sheet).toContain("value: reviewPickupText");
    expect(sheet).toContain("value: reviewReturnText");
  });

  it("keeps the native review screen event-aware without a separate linked-event card", () => {
    const createSheet = createBookingSource();
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const review = sliceBetween(
      sheet,
      "private var reviewStep: some View",
      "private func reviewSectionHeader",
    );

    expect(createSheet).toContain("var linkedEventLabel: String?");
    expect(createSheet).toContain("extension ScheduleEvent");
    expect(createSheet).toContain("var shortBookingEventTitle: String");
    expect(createSheet).toContain("var bookingEventSubtitle: String");
    expect(createSheet).not.toContain("struct ReviewEventRow: View");
    expect(review).toContain("calendar.badge.checkmark");
    expect(review).toContain('label: vm.linkedEventCount > 1 ? "Events" : "Event"');
    expect(review).toContain("value: linked");
    expect(review).not.toContain("Linked Event");
    expect(review).not.toContain("ReviewEventRow(event: event)");
  });

  it("uses showtime-ready event titles, pickup copy, and thumbnail-led review rows", () => {
    const createSheet = createBookingSource();
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const viewModel = source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift");
    const formRows = source("ios/Wisconsin/Views/CreateBooking/CreateBookingFormRows.swift");
    const equipmentRows = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const review = sliceBetween(
      sheet,
      "private var reviewStep: some View",
      "private func reviewSectionHeader",
    );

    expect(formRows).toContain("return \"\\(code) \\(prefix) \\(opponent)\"");
    expect(formRows).toContain("let prefix = isHome == false ? \"at\" : \"vs\"");
    expect(formRows).not.toContain("sportLabel(sportCode)");
    expect(formRows).not.toContain("(Neutral)");
    expect(viewModel).toContain("title = first.shortBookingEventTitle");
    expect(viewModel).not.toContain("title = \"Gear - \\(first.summary)\"");
    // Event detail no longer prefills a reservation at all -- gear left that
    // screen entirely (see the Event detail gear contract below), so the
    // composer's own event picker is the only place event titles are derived.
    expect(eventDetail).not.toContain('title: "Gear - \\(event.summary)"');
    expect(viewModel).not.toContain("first.location?.id");
    expect(sheet).toContain('BrandSectionHeader("Pickup Location")');
    expect(sheet).toContain('Picker(\n                            "Pickup location"');
    expect(sheet).toContain("vm.primaryPickupLocations");
    expect(review).toContain('label: "Pickup"');
    expect(review).toContain("value: reviewPickupText");
    expect(review).toContain('label: "Return"');
    expect(review).toContain("value: reviewReturnText");
    expect(sheet).toContain("vm.endsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())");
    expect(review).toContain("BookingAssetThumbnail(imageUrl: asset.imageUrl, size: 40, cornerRadius: 8)");
    expect(review).toContain("BookingBulkThumbnail(imageUrl: sku.imageUrl, size: 40, cornerRadius: 8)");
    expect(review).toContain("if showsBulkSubtitle(sku)");
    expect(sheet).toContain('return !productContext.localizedCaseInsensitiveContains("battery")');
    expect(equipmentRows).toContain("struct BookingAssetThumbnail");
    expect(equipmentRows).toContain("struct BookingBulkThumbnail");
    expect(createSheet).not.toContain("Ends ");
  });

  it("keeps selection, conflict recovery, and edit routes visible across gear and review", () => {
    const picker = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift");
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");

    expect(picker).toContain("private var selectedSummary: some View");
    expect(picker).toContain('Text("Selected Gear")');
    expect(picker).toContain('return "Ready to review"');
    expect(picker).toContain('return "\\(count) conflict\\(count == 1 ? "" : "s") to review"');
    expect(picker).toContain('(vm.conflictedAssetIds.isEmpty ? "Review" : "Review Conflicts")');
    expect(picker).toContain('vm.selectedLocationMismatchCount > 0');
    expect(sheet).toContain('reviewSectionHeader(title: "Schedule", editStep: 1)');
    expect(sheet).toContain('reviewSectionHeader(title: "Gear", count: vm.selectedEquipmentCount, editStep: 2)');
    expect(sheet).toContain('Button("Review Gear") { setStep(2) }');
    expect(sheet).toContain('} else if step == 3 {');
    const cartSheet = picker.slice(picker.indexOf("struct EquipmentCartSheet"));
    expect(cartSheet).not.toContain('Section("Equipment")');
    expect(cartSheet).not.toContain('Section("Supplies")');
  });

  it("returns create-time conflicts to gear without dropping the selection", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const viewModel = source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift");
    const picker = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift");
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");

    expect(api).toContain("case conflict(String)");
    expect(api).toContain("case 409:");
    expect(api).toContain('throw APIError.conflict("Some equipment is no longer available:');
    expect(api).toContain(
      "throw APIError.httpError(statusCode: http.statusCode, message: msg409)",
    );
    expect(viewModel).toContain("var submissionConflict: String?");
    expect(viewModel).toContain("catch APIError.conflict(let message)");
    expect(viewModel).toContain("submissionConflict = message");
    expect(picker).toContain("if let submissionConflict = vm.submissionConflict");
    expect(picker).toContain('Text("Gear changed since review")');
    expect(sheet).toContain("catch APIError.conflict(_)");
    expect(sheet).toContain("setStep(2)");
    expect(sheet).toContain("vm.scheduleConflictCheck()");
  });

  it("keeps gear off the Event detail staffing console", () => {
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    // Accepted product direction: Event detail is a staff staffing console and
    // gear is Bookings' job, so this screen neither reports gear state nor
    // starts a reservation. It previously prefilled a composer with event +
    // shift-assignment context; reservations now carry event context through
    // the composer's own event picker instead.
    expect(eventDetail).not.toContain("startPrepGearReservation");
    expect(eventDetail).not.toContain("makePrepGearVM");
    expect(eventDetail).not.toContain("createdGearBookingId");
    expect(eventDetail).not.toContain("drafts.start(");
    expect(eventDetail).not.toContain("ReservationDraftStore");
    expect(eventDetail).not.toContain("BookingDetailView");
    expect(eventDetail).not.toContain("Reserve gear");
    expect(eventDetail).not.toContain("reservedGearBookings");
    expect(eventDetail).not.toContain("shiftGearTone");
  });
});
