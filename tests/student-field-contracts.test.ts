import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/** The text between two markers, so an assertion can be scoped to one member. */
function sliceBetween(haystack: string, start: string, end: string) {
  const from = haystack.indexOf(start);
  const to = haystack.indexOf(end, from + start.length);
  if (from === -1 || to === -1) return "";
  return haystack.slice(from, to);
}

function createBookingSource() {
  return [
    "ios/Wisconsin/Views/CreateBookingSheet.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift",
    "ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift",
  ].map(source).join("\n");
}

describe("student field mobile contracts", () => {
  it("keeps iOS active checkouts scoped to open and pending-pickup work", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    expect(apiClient).toContain("statusList: status == nil && activeOnly ? [.open, .pendingPickup] : nil");
    expect(apiClient).toContain(".init(name: \"status_in\", value: statusList.map(\\.rawValue).joined(separator: \",\"))");
  });

  it("keeps iOS Home on the lean dashboard payload", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const route = source("src/app/api/dashboard/route.ts");

    expect(apiClient).toContain(".init(name: \"scope\", value: \"ios-home\")");
    expect(route).toContain("const isIosHomeScope = scope === \"ios-home\"");
    expect(route).toContain("isIosHomeScope");
    expect(route).toContain("? Promise.resolve([])");
    expect(route).toContain("db.calendarEvent.findMany");
  });

  it("keeps a personal-scope dashboard reporting only the caller's own work", () => {
    const route = source("src/app/api/dashboard/route.ts");
    const statsRoute = source("src/app/api/dashboard/stats/route.ts");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    // The row queries are already filtered to this user, so the counts beside
    // them must be too -- an org-wide "12 overdue" over an empty list reads as
    // missing data, not as somebody else's problem.
    // `gearHidden` short-circuits ahead of the personal/team split for a
    // collaborator with no MY_GEAR_VIEW, whose gear lanes are empty by
    // construction. The personal-vs-team branch behind it is unchanged.
    expect(route).toContain("const totalOverdue = gearHidden ? 0 : isPersonalOnly ? counts.myOverdue : counts.totalOverdue");
    expect(route).toContain("const dueTodayCount = gearHidden ? 0 : isPersonalOnly ? counts.myDueToday : counts.dueToday");
    expect(route).toContain("const totalCheckedOut = gearHidden ? 0 : isPersonalOnly ? counts.myCheckoutsTotal : counts.totalCheckedOut");
    expect(route).toContain('const gearHidden = isCollaborator && !hasCollaboratorCapability(user, "MY_GEAR_VIEW")');
    expect(route).toContain("const pendingPickupTotalCount = isPersonalOnly ? pendingPickupsRaw.length : counts.pendingPickupTotal");
    expect(route).toContain("...(isPersonalOnly ? { requesterUserId: user.id } : {})");
    // No stat lane may still read a team total on a personal dashboard.
    expect(route).not.toMatch(/const (total|dueToday|pendingPickup|team|stale)\w* = isCollaborator \?/);

    // The tab badge reads the lightweight endpoint, so it takes the same scope
    // or it accuses a student of gear that was never theirs.
    expect(apiClient).toMatch(/dashboardStats\(\)[\s\S]*?scope", value: "ios-home"/);
    expect(statsRoute).toContain('searchParams.get("scope") === "ios-home"');
    expect(statsRoute).not.toContain('user.role === "STUDENT"');
    expect(statsRoute).toContain("overdueCount: canViewMyGear ? (isPersonalOnly ? c.myOverdue : c.totalOverdue) : 0");
    expect(statsRoute).not.toMatch(/: isCollaborator \? c\./);
  });

  it("keeps the regular web Student dashboard team-visible while iOS Home stays personal", () => {
    const route = source("src/app/api/dashboard/route.ts");
    const statsRoute = source("src/app/api/dashboard/stats/route.ts");
    const page = source("src/app/(app)/page.tsx");

    expect(route).toContain("const isPersonalOnly = isIosHomeScope || isCollaborator;");
    expect(statsRoute).toContain('const isPersonalOnly = new URL(req.url).searchParams.get("scope") === "ios-home"');
    expect(statsRoute).toContain("|| isCollaborator;");
    expect(statsRoute).not.toContain('user.role === "STUDENT"');
    expect(page).toContain('className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 md:gap-6"');
    expect(page).toContain("<TeamActivityColumn");
    expect(page).not.toContain("{!isStudent && (");
  });

  it("keeps iOS booking edits on the optimistic-lock contract", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");

    expect(models).toContain("let updatedAt: Date?");
    expect(apiClient).toContain("updatedAt: Date? = nil");
    expect(apiClient).toContain("forHTTPHeaderField: \"If-Unmodified-Since\"");
    expect(apiClient).toContain("httpDateString(updatedAt)");
    expect(detail).toContain("updatedAt: booking.updatedAt");
  });

  it("keeps iOS bookings unified and toolbar buttons field-readable", () => {
    const appTab = source("ios/Wisconsin/Views/AppTabView.swift");
    const bookingsView = source("ios/Wisconsin/Views/BookingsView.swift");
    const searchView = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");
    const homeView = source("ios/Wisconsin/Views/HomeView.swift");

    expect(appTab).toContain("isStaffOrAdmin ? \"Bookings\" : \"My Gear\"");
    expect(appTab).toContain('Tab("Browse", systemImage: "square.grid.2x2", value: 2)');
    expect(appTab).toContain('Tab("Users", systemImage: "person.2", value: 5)');
    expect(appTab).not.toMatch(/if isStaffOrAdmin \{[\s\S]*?Tab\("Users"/);
    expect(searchView).toContain("@State private var isSearchPresented = false");
    expect(searchView).toContain("isPresented: $isSearchPresented");
    expect(searchView).toContain("isSearchPresented = true");
    expect(homeView).toContain(".buttonStyle(.plain)");
    expect(homeView).not.toContain("Circle().strokeBorder(Color(.separator)");
    expect(bookingsView).toContain('scope = currentUserRole == "COLLABORATOR" ? .mine : .all');
    expect(bookingsView).toContain("BookingListSection(title: sectionTitle");
    expect(bookingsView).toContain('vm.statusFilter == .active ? "Active" : vm.statusFilter.label');
    expect(bookingsView).not.toContain('BookingListSection(title: "Checkouts"');
    expect(bookingsView).not.toContain('BookingListSection(title: "Reservations"');
    expect(bookingsView).toContain('"Search bookings..."');
    expect(bookingsView).toContain("APIClient.shared.bookings(");
    expect(bookingsView).toContain("activeOnly: true");
    expect(bookingsView).toContain("enum BookingScope: String");
    expect(bookingsView).toContain('vm.mineOnly ? "person.crop.circle.fill" : "person.crop.circle"');
    expect(bookingsView).not.toContain("Picker(\"Booking scope\", selection: $vm.scope)");
    expect(bookingsView).not.toContain("case needsAttention");
    expect(bookingsView).toContain("Label(\"New Reservation\", systemImage: \"plus\")");
    expect(bookingsView).not.toContain("Picker(\"Booking type\"");
    expect(bookingsView).not.toContain("enum BookingTab");
  });

  it("keeps iOS Bookings tab from flashing stale cache rows", () => {
    const bookingsView = source("ios/Wisconsin/Views/BookingsView.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    expect(bookingsView).toContain("load(reset: Bool = false, clearExistingRows: Bool = false)");
    expect(bookingsView).toContain("clearExistingRows");
    expect(bookingsView).toContain(".refreshable");
    expect(bookingsView).toContain("BookingEmptyState(");
    expect(bookingsView).toContain('Label("View All Bookings", systemImage: "person.2")');
    expect(bookingsView).not.toContain("ReservationEmptyRow");
    expect(bookingsView).toContain("capitalizesRelativeDay: false");
    expect(bookingsView).not.toContain("isRefreshingVisibleRows");
    expect(bookingsView).not.toContain("BookingFreshnessFooter");
    expect(bookingsView).not.toContain("needsBookingAttention(now:");
    expect(bookingsView).not.toContain("GearStore.shared.cachedBookings");
    expect(apiClient).toContain("filter: String? = nil");
    expect(apiClient).toContain(".init(name: \"filter\", value: filter)");
  });

  it("keeps iOS Schedule controls self-describing", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");

    expect(scheduleView).toContain("scheduleControlStrip");
    expect(scheduleView).toContain("Picker(\"Schedule view\"");
    expect(scheduleView).toContain("@State private var showFilters = false");
    expect(scheduleView).toContain("activeFilterSummary");
    expect(scheduleView).toContain("private struct ScheduleFilterSheet");
    expect(scheduleView).toContain("\"My shifts\"");
    expect(scheduleView).toContain("\"Include past events\"");
    expect(scheduleView).toContain("Text(\"Event Type\")");
    expect(scheduleView).toContain("ForEach(HomeAwayFilter.allCases");
    expect(scheduleView).toContain("Picker(\"Sport\"");
    // Toolbar controls are Labels, not bare Images: the title is what makes
    // them self-describing, and it lets the system own sizing and hit area.
    expect(scheduleView).toContain("Label(\n                            \"Trade Board\",");
    expect(scheduleView).toContain("arrow.left.arrow.right.circle");
    expect(scheduleView).toContain("Label(\"My Availability\", systemImage: \"calendar.badge.clock\")");
    expect(scheduleView).toContain("Label(\"Shift Calendar\", systemImage: \"calendar.badge.plus\")");
    expect(scheduleView).toContain("\"Filters, \\(activeFilterCount) active\"");
    expect(scheduleView).toContain("\"Trade Board, \\(appState.openTradeCount) open\"");
    expect(scheduleView).toContain("accessibilityLabel(\"More Schedule actions\")");
    expect(scheduleView).not.toContain("Switch to calendar view");
    expect(scheduleView).not.toContain("Switch to list view");
  });

  it("keeps iOS Schedule detail and trade actions self-describing", () => {
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const tradeBoard = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    const postTrade = source("ios/Wisconsin/Views/Schedule/PostTradeSheet.swift");

    expect(eventDetail).toContain("Label(\"Add Shift\", systemImage: \"plus\")");
    // An open crew row is itself the button -- the action used to sit in a
    // tinted pill, which turned an unstaffed event into a column of five
    // identical filled controls competing with the section's own. The row keeps
    // a 44pt target, states its action in words, and shows a chevron; VoiceOver
    // reads the row label and takes the action title as its hint.
    expect(eventDetail).toContain("private var primaryRowAction: (() -> Void)?");
    expect(eventDetail).toContain("Button(action: primaryRowAction) { rowContent }");
    expect(eventDetail).toContain(".accessibilityHint(openSlotActionTitle)");
    expect(eventDetail).toContain('if canManageShifts { return "Assign" }');
    expect(eventDetail).toContain('return isStudent && isStudentSlot ? "Claim shift" : "Open"');
    expect(eventDetail).toContain('Image(systemName: "chevron.right")');
    expect(eventDetail).not.toContain('Label("Assign", systemImage: "plus.circle.fill")');

    // Grouping by proximity: an area heading binds tighter to its own card than
    // areas bind to each other. Near-equal gaps left the headings floating
    // between two cards and the crew list reading as unrelated islands.
    expect(eventDetail).toContain("VStack(alignment: .leading, spacing: Brand.Space.lg) {");
    expect(eventDetail).toContain("VStack(alignment: .leading, spacing: Brand.Space.xs) {");
    // Staff commands live in the navigation bar, not the content column. Add
    // Shift spent two rounds homeless there -- first too narrow beside the Crew
    // title and pill, then alone on a full-width line attached to nothing.
    expect(eventDetail).toContain("private var addShiftToolbarButton: some View");
    expect(eventDetail).toContain("ToolbarItem(placement: .topBarTrailing)");
    expect(eventDetail).toContain('.accessibilityLabel("Add shift")');
    expect(eventDetail).toContain('.accessibilityLabel("More event actions")');
    expect(eventDetail).not.toContain("crewControlRow");
    expect(eventDetail).not.toContain("crewActionBar");
    // Exactly one dominant action, in a bottom bar, state-driven.
    expect(eventDetail).toContain("private enum PrimaryAction");
    expect(eventDetail).toContain(".safeAreaInset(edge: .bottom) { primaryActionBar }");
    expect(eventDetail).toContain('case .setUpCrew: "Set up crew"');
    expect(eventDetail).toContain('openCount == 1 ? "Assign — 1 open" : "Assign — \\(openCount) open"');
    // One confirmation dialog for five confirmable actions, each of which used
    // to carry its own @State target and hand-rolled Binding(get:set:).
    expect(eventDetail).toContain("enum EventConfirmation: Identifiable");
    expect(eventDetail).toContain("presenting: confirmation");
    expect(eventDetail).not.toContain("claimTarget");
    expect(eventDetail).not.toContain("deleteTarget");
    expect(eventDetail).not.toContain("showDiscardReview");
    // A cancelled event no longer looks identical to a confirmed one, and it
    // can't be staffed -- ScheduleEvent.status was read nowhere in the app.
    expect(eventDetail).toContain('event.status.uppercased() == "CANCELLED"');
    expect(eventDetail).toContain('Text("Cancelled")');
    expect(eventDetail).toContain("guard !eventIsCancelled, !eventHasEnded else { return nil }");
    // Free-text crew notes arrive on every load and used to render nowhere.
    expect(eventDetail).toContain('BrandSectionHeader("Notes", systemImage: "note.text")');
    expect(eventDetail).toContain("vm.shiftGroup?.notes");
    // Your own shift card agrees with the tint the list row and ShiftRow use.
    expect(eventDetail).toContain(".brandCard(fill: Color.statusBackground(.blue))");
    // The pending-changes card says how many people a revert would touch.
    expect(eventDetail).toContain("vm.workingEditor?.affectedWorkerCount");
    // An empty slot is two things and one gutter -- no placeholder avatar
    // stranded in the middle standing in for the person who isn't there.
    expect(eventDetail).not.toContain("openSlotAvatar");

    // Long-pressing a crew row gives grouped actions, not one flat list with
    // destructive entries scattered through it. Everything that takes a person
    // off a shift, or removes the shift, lives in the last group.
    expect(eventDetail).toContain("Section { primaryMenuActions }");
    expect(eventDetail).toContain("Section { tradeBoardMenuActions }");
    expect(eventDetail).toContain("Section { shiftManagementMenuActions }");
    expect(eventDetail).toContain("Section { destructiveMenuActions }");
    const destructiveGroup = sliceBetween(
      eventDetail,
      "private var destructiveMenuActions: some View",
      "// MARK: - Edit Shift Times Sheet",
    );
    expect(destructiveGroup).toContain('Label("Decline \\(assignment.user.name)"');
    expect(destructiveGroup).toContain('Label("Remove \\(assignment.user.name)"');
    expect(destructiveGroup).toContain('Label("Delete Shift", systemImage: "trash")');
    // ...and nothing destructive is left behind in the other groups.
    const managementGroup = sliceBetween(
      eventDetail,
      "private var shiftManagementMenuActions: some View",
      "private var destructiveMenuActions",
    );
    expect(managementGroup).not.toContain("role: .destructive");

    // Long-pressing the event card passes the event along; that is the one
    // thing the card holds that is not reachable any other way.
    expect(eventDetail).toContain("ShareLink(item: eventShareText)");
    expect(eventDetail).toContain('Label("Copy Event Details", systemImage: "doc.on.doc")');
    // The venue is a caption, not a destination. Directions were tried and
    // turned down -- the crew knows where its own venues are, so a tappable
    // venue and a Maps action are both noise. Keep them out.
    expect(eventDetail).toContain('Label(eventVenueName, systemImage: "mappin.and.ellipse")');
    expect(eventDetail).not.toContain("maps.apple.com");
    expect(eventDetail).not.toContain("Open in Maps");
    expect(eventDetail).not.toContain("@Environment(\\.openURL)");
    // The buttons carry short visible titles -- the full name wrapped them to
    // four lines and swallowed the row -- with the name in the a11y label.
    expect(eventDetail).toContain('Button("Approve") { onApprove(assignment) }');
    expect(eventDetail).toContain('Button("Decline") { onDecline(assignment) }');
    expect(eventDetail).toContain('accessibilityLabel("Approve \\(assignment.user.name)")');
    expect(eventDetail).toContain('accessibilityLabel("Decline \\(assignment.user.name)")');
    // The system owns the title. A hand-rolled `.principal` toolbar item stood
    // in for it, which cost large-title collapse and automatic back-button
    // labelling and used a font the platform didn't choose.
    expect(eventDetail).toContain('.navigationTitle("Event")');
    expect(eventDetail).not.toContain("ToolbarItem(placement: .principal)");
    // Loading and failure use the house vocabulary, not one-off cards.
    expect(eventDetail).toContain("EventDetailCrewSkeleton()");
    expect(eventDetail).toContain("ContentUnavailableView {");
    // isLoading starts true, so a staffed event never flashes "No crew
    // scheduled" before the fetch lands. Reentrancy guards on its own flag --
    // guarding on isLoading would make the first load return without fetching.
    expect(eventDetail).toContain("var isLoading = true");
    expect(eventDetail).toContain("if !forceRefresh, isFetching { return }");
    // "Your Shift" states when to report and which area, and stops there.
    // Gear left this screen entirely -- see the Event detail gear contract in
    // ios-create-booking-picker-parity.test.ts.
    expect(eventDetail).toContain('BrandSectionHeader("Your Shift"');
    expect(eventDetail).not.toContain("reserveGearTitle");
    expect(eventDetail).not.toContain("Reserve gear");
    expect(eventDetail).not.toContain("ToolbarItem(placement: .bottomBar)");
    expect(eventDetail).not.toContain("Label(\"Prep gear\", systemImage: \"archivebox\")");
    expect(tradeBoard).toContain(".accessibilityLabel(\"Post trade\")");
    expect(tradeBoard).toContain(".navigationTitle(\"Trade Board\")");
    expect(tradeBoard).toContain("APIClient.shared.scheduleOpenWork(area: areaFilter)");
    expect(tradeBoard).toContain('title: "Trade Posts"');
    expect(tradeBoard).toContain('title: "Open Shifts"');
    expect(tradeBoard).toContain("My Posts");
    expect(tradeBoard).toContain("Waiting or Blocked");
    expect(tradeBoard).toContain("Text(\"Claim shift\")");
    expect(tradeBoard).toContain("Text(\"Claim this shift\")");
    expect(tradeBoard).toContain("Text(\"Cancel post\")");
    expect(tradeBoard).toContain("Canceling removes the post; the shift stays assigned to you.");
    expect(tradeBoard).toContain("An admin reviews this before you're on the schedule.");
    expect(postTrade).toContain("Text(\"Choose a Shift\")");
    expect(postTrade).toContain("Text(\"Post to Trade Board\")");
  });

  it("keeps iOS Items controls self-describing", () => {
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    expect(itemsView).toContain(".searchable(");
    expect(itemsView).toContain("text: $vm.searchText");
    expect(itemsView).toContain('prompt: Text("Search tag, model, serial, location")');
    expect(itemsView).toContain("ToolbarItemGroup(placement: .topBarTrailing)");
    expect(itemsView).toContain("Label(\"Favorites\", systemImage: vm.favoritesOnly ? \"star.fill\" : \"star\")");
    expect(itemsView).toContain("AssetStatusFilterMenu(selected: $vm.selectedStatuses)");
    expect(itemsView).toContain("ItemSortMenu(selected: $vm.sortOption)");
    expect(apiClient).toContain("includeAccessories: Bool = false");
    expect(apiClient).toContain("include_accessories");
    expect(itemsView).not.toContain("includeAccessories: true");
    expect(itemsView).toContain("selected.isEmpty ? \"All statuses\" : \"\\(selected.count) statuses\"");
    expect(itemsView).not.toContain("itemsControlStrip");
    expect(itemsView).not.toContain("ItemControlPill(");
    expect(itemsView).not.toContain("Showing favorites");
    expect(itemsView).not.toContain("Show favorites");
  });

  it("keeps iOS Booking Detail edit state self-describing", () => {
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const extendSheet = source("ios/Wisconsin/Views/ExtendBookingSheet.swift");
    const editor = detail.slice(
      detail.indexOf("struct EditBookingSheet"),
      detail.indexOf("struct TransferBookingOwnerSheet"),
    );

    expect(detail).toContain("BookingDetailsSection(");
    expect(detail).toContain("Label(\"Edit Details\", systemImage: \"pencil\")");
    expect(detail).toContain(".accessibilityLabel(\"Edit booking details\")");
    expect(editor).toContain(".navigationTitle(\"Edit Booking\")");
    expect(editor).toContain("Gear and pickup details stay read-only on your phone.");
    expect(editor).toContain('BrandSectionHeader("Booking Name")');
    expect(editor).toContain('DatePicker(\n                                    "Return Time"');
    expect(editor).toContain("APIClient.shared.bookingAvailability");
    expect(editor).not.toContain("OptionPickerView(");
    expect(editor).not.toContain("TextEditor(");
    expect(apiClient).toContain("locationId: String? = nil");
    expect(apiClient).toContain("let locationId: String?");
    expect(apiClient).toContain("locationId: locationId");
    expect(detail).toContain('BrandSectionHeader(title: "Gear")');
    expect(detail).toContain("if canExtendBooking");
    expect(detail).toContain("if canCancelBooking");
    expect(detail).toContain("BookingExtendBar");
    expect(editor).toContain("guard canSave else { return }");
    expect(detail).toContain("if isActioning { return }");
    expect(extendSheet).toContain("if isLoading { return }");
    expect(detail).not.toContain("Image(systemName: \"pencil\")");
  });

  it("keeps iOS Profile controls self-describing", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");
    const notifications = source("ios/Wisconsin/Views/NotificationSettingsView.swift");
    const availability = source("ios/Wisconsin/Views/AvailabilityView.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const scheduleModels = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const webAvailability = source("src/app/(app)/users/[id]/UserAvailabilityTab.tsx");
    const meRoute = source("src/app/api/me/route.ts");
    const auth = source("src/lib/auth.ts");
    const userPage = source("src/app/(app)/users/[id]/page.tsx");
    const availabilityRoute = source("src/app/api/users/[id]/availability/route.ts");

    expect(notifications).toContain("title: \"Push alerts\"");
    expect(notifications).toContain("title: \"Delivery status\"");
    expect(notifications).toContain("Send Test Notification");
    expect(notifications).not.toContain("Pause Alerts");
    expect(notifications).not.toContain("Email alerts");
    expect(settings).toContain("title: \"Theme\"");
    expect(profile).toContain("title: \"My Availability\"");
    expect(profile).toContain("private var isStudentWorker: Bool");
    expect(profile).toContain("session.currentUser?.staffingType == \"ST\"");
    expect(models).toContain("let staffingType: String?");
    expect(auth).toContain("staffingType: session.user.staffingType");
    expect(meRoute).toContain("return ok({");
    expect(userPage).toContain("profile.staffingType === \"ST\"");
    expect(availabilityRoute).toContain("target.staffingType !== \"ST\"");
    expect(scheduleModels).toContain("let intent: String?");
    expect(scheduleModels).toContain("let status: String?");
    expect(scheduleModels).toContain("let date: String?");
    expect(scheduleModels).toContain("let dateEndsOn: String?");
    expect(scheduleModels).toContain("let allDay: Bool?");
    expect(scheduleModels).toContain("let reviewNote: String?");
    expect(availability).toContain("AvailabilityEditorIntent");
    expect(availability).toContain("case prefer = \"PREFER\"");
    expect(availability).toContain("case dislike = \"DISLIKE\"");
    expect(availability).toContain("case timeOff = \"TIME_OFF\"");
    expect(availability).toContain("AvailabilityEditorKind");
    expect(availability).toContain("case adHoc = \"AD_HOC\"");
    expect(availability).toContain("AvailabilityWeekStrip");
    expect(availability).toContain("Your schedule signals");
    expect(availability).toContain("Weekly class schedule");
    expect(availability).toContain("One-off days and ranges");
    expect(availability).toContain("Pending staff review");
    expect(availability).toContain("Label(\"Add availability\", systemImage: \"plus\")");
    expect(availability).toContain("Multiple days");
    expect(availability).toContain("All day");
    expect(availability).toContain("Edit Availability");
    expect(availability).toContain("stride(from: 0, through: 23 * 60 + 45, by: 15)");
    expect(apiClient).toContain("kind: String = \"WEEKLY\"");
    expect(apiClient).toContain("intent: String = \"CANNOT_WORK\"");
    expect(apiClient).toContain("date: String? = nil");
    expect(apiClient).toContain("kind: kind");
    expect(apiClient).toContain("intent: intent");
    expect(apiClient).toContain("date: kind == \"AD_HOC\" ? date : nil");
    expect(apiClient).toContain("dateEndsOn: kind == \"AD_HOC\" ? dateEndsOn ?? date : nil");
    expect(apiClient).toContain("allDay: kind == \"AD_HOC\" && allDay");
    expect(apiClient).toContain("func updateAvailabilityBlock(");
    expect(apiClient).toContain("method: \"PATCH\"");
    expect(webAvailability).toContain("One-time day or range");
    expect(webAvailability).toContain("dateEndsOn");
    expect(webAvailability).toContain("allDay");
  });

  it("keeps iOS Create Booking actions and selected equipment recoverable", () => {
    const createSheet = createBookingSource();

    expect(createSheet).toContain("selectedAssetSnapshots: [String: Asset]");
    expect(createSheet).toContain("selectedBulkQuantities: [String: Int]");
    expect(createSheet).toContain("var selectedAssets: [Asset]");
    expect(createSheet).toContain("var selectedEquipmentCount: Int");
    expect(createSheet).toContain("var selectedBulkRequests: [BulkReservationRequest]");
    // Three-step flow mirroring web: Equipment requires a selection before
    // Review (the cart bar owns the Review action), and the Confirm step
    // owns the single primary action.
    expect(createSheet).toContain("attemptReview()");
    expect(createSheet).toContain('(vm.selectedConflictCount == 0 ? "Review" : "Resolve Conflicts")');
    expect(createSheet).toContain(".disabled(!vm.canReviewEquipment)");
    expect(createSheet).toContain("Text(vm.title.isEmpty ? \"Review your reservation\" : vm.title)");
    expect(createSheet).not.toContain("Batteries & Counted Items");
    // Scan is a toolbar action with continuous scanning; keep it labeled
    // for VoiceOver since it's icon-only.
    expect(createSheet).toContain("Image(systemName: \"barcode.viewfinder\")");
    expect(createSheet).toContain(".accessibilityLabel(\"Scan equipment\")");
    // The cart drawer keeps every pick removable and quantities adjustable.
    expect(createSheet).toContain("EquipmentCartSheet");
    expect(createSheet).toContain("SelectedEquipmentRow");
    expect(createSheet).toContain("BulkQuantityRow");
    expect(createSheet).toContain("BookingAssetThumbnail");
    expect(createSheet).toContain("BookingBulkThumbnail");
    expect(createSheet).toContain("Image(systemName: \"xmark.circle.fill\")");
    expect(createSheet).toContain("parts.append(\"Remove button\")");
    expect(createSheet).toContain("func removeSelectedAsset(_ asset: Asset)");
    expect(createSheet).toContain("func removeSelectedBulk(_ sku: FormBulkSku)");
  });

  it("keeps my-shifts gear context aligned with dashboard event work", () => {
    const route = source("src/app/api/my-shifts/route.ts");

    expect(route).toContain("\"PENDING_PICKUP\"");
    expect(route).toContain("if (status === \"PENDING_PICKUP\") return \"pickup_ready\"");
    expect(route).toContain("{ events: { some: { eventId: { in: eventIds } } } }");
    expect(route).toContain("{ shiftAssignmentId: { in: assignmentIds } }");
    expect(route).toContain("{ shiftAssignment: { shift: { shiftGroup: { eventId: { in: eventIds } } } } }");
  });

  it("returns real dashboard event-work all-day state instead of a hardcoded value", () => {
    const route = source("src/app/api/dashboard/route.ts");

    expect(route).toContain("allDay: true");
    expect(route).toContain("allDay: ev.allDay");
    expect(route).not.toContain("allDay: false");
  });
});
