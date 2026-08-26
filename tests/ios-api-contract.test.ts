import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/**
 * iOS ↔ API response-contract pins.
 *
 * Swift JSONDecoder fails the ENTIRE response when one required key is
 * missing or null, so server-side shape changes that are invisible to the
 * web TypeScript client (types erased at runtime) brick iOS screens.
 * This suite pins both sides of every contract that has actually broken:
 * change either side and the matching assertion here fails, pointing at
 * the sibling that must move in the same commit.
 *
 * History: FormUser.email (bb45e74a), the 6 drift fixes in 66ff9e8f, and
 * the kiosk/URL fixes in 51f97d31. See tasks/lessons.md sessions
 * 2026-05-28 and 2026-06-09.
 */
describe("iOS API contracts — form options", () => {
  it("FormUser only requires fields the server selects", () => {
    const route = source("src/app/api/form-options/route.ts");
    const models = source("ios/Wisconsin/Models/FormModels.swift");

    // Server users select must keep at least id + name…
    expect(route).toMatch(/db\.user\.findMany\(\{[\s\S]*?select: \{ id: true, name: true/);
    // …and the Swift model must not REQUIRE anything beyond them.
    // (Optional fields are fine — missing keys decode to nil.)
    const structBody = models.slice(
      models.indexOf("struct FormUser"),
      models.indexOf("struct FormBulkSku"),
    );
    const requiredFields = [...structBody.matchAll(/let (\w+): (\S+)/g)]
      .filter((match) => !(match[2] ?? "").endsWith("?"))
      .map((match) => match[1]);
    expect(requiredFields.sort()).toEqual(["id", "name"]);
  });

  it("FormOptions keeps bulk SKU picker data without requiring it from legacy responses", () => {
    const route = source("src/app/api/form-options/route.ts");
    const models = source("ios/Wisconsin/Models/FormModels.swift");

    expect(route).toMatch(/db\.bulkSku\.findMany\(\{[\s\S]*?select: \{[\s\S]*?availableQuantity/);
    expect(models).toContain("struct FormBulkSku");
    expect(models).toContain("let bulkSkus: [FormBulkSku]");
    expect(models).toContain("bulkSkus = try container.decodeIfPresent([FormBulkSku].self, forKey: .bulkSkus) ?? []");
  });
});

describe("iOS API contracts — reservation create payload", () => {
  it("iOS sends typed bulk items to the existing reservation schema", () => {
    const validation = source("src/lib/validation.ts");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    expect(validation).toContain("bulkSkuId: z.string().cuid()");
    expect(validation).toContain("quantity: z.number().int().positive()");
    expect(apiClient).toContain("struct BulkReservationRequest: Codable, Equatable");
    expect(apiClient).toContain("bulkItems: [BulkReservationRequest] = []");
    expect(apiClient).toContain("let bulkItems: [BulkReservationRequest]");
    expect(apiClient).toContain("bulkItems: bulkItems");
    expect(apiClient).not.toContain("let bulkItems: [String]");
    expect(apiClient).not.toContain("bulkItems: [],");
  });
});

describe("iOS API contracts — booking list avatars", () => {
  it("keeps requester avatar URLs in booking list responses", () => {
    const listQueries = source("src/lib/services/bookings-queries.ts");
    const combinedRoute = source("src/app/api/bookings/route.ts");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const bookingsView = source("ios/Wisconsin/Views/BookingsView.swift");

    expect(listQueries).toContain("requester: { select: { id: true, name: true, email: true, avatarUrl: true } }");
    expect(combinedRoute).toContain("requester: { select: { id: true, name: true, email: true, avatarUrl: true } }");
    expect(models).toContain("let avatarUrl: String?");
    expect(bookingsView).toContain("UserAvatarView(name: booking.requester.name, avatarUrl: booking.requester.avatarUrl");
  });
});

describe("iOS user directory polish", () => {
  it("keeps native user profile rows free of routine location sublines", () => {
    const usersView = source("ios/Wisconsin/Views/UsersView.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");

    // The row describes a person by standing and area, never by the location
    // they happen to be assigned to -- everyone shares a handful of those, so
    // it distinguishes nobody.
    const secondaryLine = usersView.slice(usersView.indexOf("private var secondaryLine: String?"));
    expect(secondaryLine).toContain("UserIdentity.line(");
    expect(secondaryLine).toContain("primaryArea: user.primaryArea");
    expect(secondaryLine).not.toContain("user.location");

    // One owner for that description, so the list row and the profile it opens
    // can never introduce the same person two different ways.
    expect(models).toContain("enum UserIdentity");
    expect(models).toContain("static func standing(role: String, title: String?, gradYear: Int?, studentYearOverride: String?) -> String?");
    expect(models).toContain("static func line(role: String, title: String?, gradYear: Int?, studentYearOverride: String?, primaryArea: String?) -> String?");
    expect(usersView).not.toContain("private var titleOrYear");
    expect(usersView).not.toContain("private static func labelFor");
  });

  it("presents Admins as Staff on people-directory chips", () => {
    const brand = source("ios/Wisconsin/Core/Brand.swift");
    const pill = source("ios/Wisconsin/Views/Components/StatusPill.swift");
    const usersView = source("ios/Wisconsin/Views/UsersView.swift");

    expect(brand).toContain("static func publicDirectoryRole");
    expect(brand).toContain('role == "ADMIN" ? "STAFF"');
    expect(pill).toContain("StatusTone.publicDirectoryRole(role)");
    expect(usersView).toContain("StatusTone.publicDirectoryRole(user.role)");
  });

  it("refuses to attribute one person's shifts to another", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const route = source("src/app/api/my-shifts/route.ts");
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");

    // `/api/my-shifts` can answer for a teammate so their profile can show a
    // Next Up card. The gear lookup has to follow the same person, or a
    // teammate's shift rows get the viewer's own bookings attached.
    expect(route).toContain('const targetUserId = url.searchParams.get("userId") || user.id');
    expect(route).toContain("userId: targetUserId");
    expect(route).toContain("requesterUserId: targetUserId");
    expect(route).not.toContain("requesterUserId: user.id");

    // A server that predates the filter ignores it and returns the caller's own
    // shifts, which would print your shifts on somebody else's profile. The
    // response says whose it is and the client drops what it cannot attribute.
    expect(route).toContain("return ok({ data, userId: targetUserId })");
    expect(models).toContain("let userId: String?");
    expect(apiClient).toContain("if let userId, resp.userId != userId { return [] }");
  });

  it("keeps profile Next Up fed only by work that is actually live", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");

    // Next Up must not be fed every checkout the person ever made, or it lists
    // rows stamped Completed and Cancelled as though they were upcoming.
    expect(apiClient).toContain("func checkoutsByUser(userId: String, activeOnly: Bool = false, limit: Int = 10)");
    expect(apiClient).toContain("func reservationsByUser(userId: String, activeOnly: Bool = false, limit: Int = 10)");
    expect(apiClient).toContain("[BookingStatus.open, .pendingPickup].map(\\.rawValue).joined(separator: \",\")");
    for (const view of [detail, profile]) {
      expect(view).toContain("activeOnly: true");
      expect(view).toContain("ProfileNextUpCard(");
    }
    expect(detail).not.toContain('title: "Active Checkouts"');
    expect(detail).not.toContain('title: "Out Now"');
  });

  it("builds both user profiles from the same three blocks in the same order", () => {
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");

    // Header, then Next Up, then Badges -- on the profile you open for someone
    // else and the one you open for yourself.
    const detailOrder = ["profileHeader(detail)", "ProfileNextUpCard(", "badgesSection"]
      .map((needle) => detail.indexOf(needle));
    const profileOrder = ["headerSection", "nextUpSection", "badgeSection"]
      .map((needle) => profile.indexOf(needle));
    for (const order of [detailOrder, profileOrder]) {
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }

    // The custody strip and its two booking cards are gone from both.
    for (const view of [detail, profile]) {
      expect(view).not.toContain("UserCustodyStrip");
      expect(view).not.toContain("UserBookingsCard");
    }

    // Contact actions are for reaching other people. Mailing yourself is a dead
    // end, and your own profile is the one place they were never useful.
    expect(detail).toContain(
      "if detail.id != session.currentUser?.id && (!detail.email.isEmpty || detail.phone?.isEmpty == false) {",
    );
    expect(profile).not.toContain("ContactActions(");
  });
});

describe("iOS guides reader polish", () => {
  it("preserves native markdown numbered-list values and compact row labels", () => {
    const guidesView = source("ios/Wisconsin/Views/GuidesView.swift");
    const markdown = source("ios/Wisconsin/Views/GuideMarkdown.swift");

    // Numbering follows the list's own start index and increments from there,
    // so "5." renders as 5 rather than being renumbered from 1.
    expect(markdown).toContain("case numbered(depth: Int, number: Int, text: GuideInlineText)");
    expect(markdown).toContain("var number = Int(list.startIndex)");
    expect(markdown).toContain("number += 1");

    expect(guidesView).toContain("Text(\"\\(number)\")");
    expect(guidesView).toContain('.accessibilityLabel("Step \\(number). \\(text.plain)")');
    expect(guidesView).toContain(".accessibilityLabel(accessibilityLabel)");
    expect(guidesView).not.toContain("parts.append(guide.updatedSummary)");
    expect(guidesView).not.toContain(".safeAreaInset(edge: .bottom)");
    expect(guidesView).toContain(".toolbar(.hidden, for: .tabBar)");
  });
});

describe("iOS scanner fallback polish", () => {
  it("keeps manual-entry sheets from sitting over scanner fallback controls", () => {
    const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");

    expect(scanner).toContain("private var unavailableView: some View");
    expect(scanner).toContain("if !showManualEntry");
    expect(scanner).toContain("Button(\"Type Code Instead\") { showManualEntry = true }");
  });
});

describe("iOS availability editor polish", () => {
  it("confirms destructive availability deletion before mutating student scheduling data", () => {
    const availability = source("ios/Wisconsin/Views/AvailabilityView.swift");

    expect(availability).toContain("@State private var blockPendingDelete: AvailabilityBlock?");
    expect(availability).toContain(".confirmationDialog(");
    expect(availability).toContain("\"Delete availability block?\"");
    expect(availability).toContain("Button(\"Delete \\(block.primaryLine)\", role: .destructive)");
    expect(availability).toContain("blockPendingDelete = block");
    expect(availability).not.toContain("Task { await delete(block) } label:");
  });
});

describe("iOS schedule sheet all-day polish", () => {
  it("keeps Add Shift default event windows date-only for all-day events", () => {
    const addShift = source("ios/Wisconsin/Views/Schedule/AddShiftSheet.swift");

    expect(addShift).toContain("private var defaultsToAllDayWindow: Bool");
    expect(addShift).toContain("calendar.compare(defaultStart, to: calendar.startOfDay(for: defaultStart), toGranularity: .minute)");
    expect(addShift).toContain("calendar.compare(defaultEnd, to: calendar.startOfDay(for: defaultEnd), toGranularity: .minute)");
    expect(addShift).toContain("Label(defaultWindowText, systemImage: defaultsToAllDayWindow ? \"calendar\" : \"clock\")");
    expect(addShift).toContain("return \"All day · \\(shortDate(defaultStart))\"");
    expect(addShift).toContain("return \"All day · \\(shortDate(defaultStart)) to \\(shortDate(inclusiveEnd))\"");
    expect(addShift).toContain("if calendar.component(.year, from: date) == calendar.component(.year, from: .now)");
  });
});

describe("iOS API contracts — asset lookup item families", () => {
  it("iOS decodes /api/assets bulkItems and treats them as scan/search results", () => {
    const route = source("src/app/api/assets/route.ts");
    const models = source("ios/Wisconsin/Models/AssetModels.swift");
    const searchService = source("ios/Wisconsin/Core/SearchService.swift");
    const globalSearch = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");
    const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");

    expect(route).toContain("bulkItems,");
    expect(route).toContain("itemOrder,");
    expect(route).toContain("matchedUnitNumber");
    expect(models).toContain("struct AssetFamilySearchResult");
    expect(models).toContain("let bulkItems: [AssetFamilySearchResult]");
    expect(models).toContain("let itemOrder: [String]");
    expect(models).toContain("decodeIfPresent([AssetFamilySearchResult].self, forKey: .bulkItems) ?? []");
    expect(models).toContain("decodeIfPresent([String].self, forKey: .itemOrder) ?? []");
    expect(searchService).toContain("var itemFamilies: [AssetFamilySearchResult] = []");
    expect(searchService).toContain("api.assets(search: q, qr: rawScan, limit: 10)");
    expect(searchService).not.toContain("qr: rawScan ?? q");
    expect(searchService).toContain("itemsResp?.bulkItems");
    expect(searchService).toContain("let isDirectScan = rawScan?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false");
    // The guarantee is that a direct scan bypasses the accessory filter while a
    // typed search applies it. The sources are read through optionals now that
    // each search source is awaited independently, so the filtering happens on
    // the unwrapped locals rather than on the response directly.
    expect(searchService).toContain("let rawItems = itemsResp?.data ?? []");
    expect(searchService).toContain("let rawFamilies = itemsResp?.bulkItems ?? []");
    expect(searchService).toContain("let visibleItems = isDirectScan ? rawItems : rawItems.filter(Self.isSearchVisibleAsset)");
    expect(searchService).toContain("let visibleFamilies = isDirectScan ? rawFamilies : rawFamilies.filter(Self.isSearchVisibleFamily)");
    expect(searchService).toContain("private static func isHiddenAttachmentCategory(_ title: String?) -> Bool");
    expect(searchService).toContain("normalized == \"accessories\"");
    expect(searchService).toContain("normalized.hasSuffix(\"/accessories\")");
    expect(searchService).toContain("itemFamilies.isEmpty");
    expect(globalSearch).toContain("ItemFamilyResultRow(family: family)");
    expect(scanner).toContain("case itemFamily(AssetFamilySearchResult)");
    // The resolve-based scanner still surfaces bulk families as matches.
    expect(scanner).toContain("match = .itemFamily(family)");
    expect(scanner).toContain("switch await resolve(match)");
  });

  it("iOS Items list renders the mixed /api/assets order and exposes web-backed sort choices", () => {
    const route = source("src/app/api/assets/route.ts");
    const models = source("ios/Wisconsin/Models/AssetModels.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(route).toContain("shouldUseUnifiedAssetTagPagination");
    expect(route).toContain("sortKey === \"popular\"");
    expect(models).toContain("enum ItemListRow");
    expect(models).toContain("var orderedRows: [ItemListRow]");
    expect(models).toContain("for id in itemOrder");
    expect(apiClient).toContain("if let sort, !sort.isEmpty { items.append(.init(name: \"sort\", value: sort)) }");
    expect(apiClient).toContain("includeAccessories: Bool = false");
    expect(apiClient).toContain("if includeAccessories { items.append(.init(name: \"include_accessories\", value: \"true\")) }");
    expect(itemsView).toContain("var rows: [ItemListRow] = []");
    expect(itemsView).toContain("case popular = \"popular\"");
    expect(itemsView).toContain("var sortOption: SortOption = .popular");
    expect(itemsView).toContain("sort: sortOption.rawValue");
    expect(itemsView).not.toContain("includeAccessories: true");
    expect(itemsView).toContain("let resultRows = result.orderedRows");
    expect(itemsView).toContain("ItemFamilyListRow(family: family)");
    expect(itemsView).toContain("startReservation(forFamily: family)");
    expect(itemsView).toContain("drafts.start({");
    expect(itemsView).toContain("composer.prefillReservation(forFamily: family)");
  });

  it("iOS item detail uses attachment language for bundled child rows", () => {
    const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");

    expect(itemDetail).toContain("Label(\"Attachments\", systemImage: \"shippingbox\")");
    expect(itemDetail).toContain(".accessibilityLabel(\"Attachment:");
    expect(itemDetail).not.toContain("Text(\"Accessories\")");
    expect(itemDetail).not.toContain(".accessibilityLabel(\"Accessory:");
  });
});

describe("iOS API contracts — kiosk checkout scan photos", () => {
  it("kiosk checkout scan can show item photos without requiring them from old responses", () => {
    const route = source("src/app/api/kiosk/checkout/scan/route.ts");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
    const checkoutView = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(route).toContain("imageUrl: bulkUnit.imageUrl");
    expect(route).toContain("imageUrl: true");
    expect(route).toContain("imageUrl: asset.imageUrl");
    expect(models).toMatch(/struct ScannedItem[\s\S]*?let imageUrl: String\?/);
    expect(store).toMatch(/struct KioskCartItem[\s\S]*?let imageUrl: String\?/);
    expect(checkoutView).toContain("KioskCheckoutThumbnail(item: group.first)");
    expect(checkoutView).toContain("imageUrl: item.imageUrl");
  });
});

describe("iOS API contracts — kiosk dashboard decoding", () => {
  it("keeps idle dashboard decoding tolerant of partial or skewed sections", () => {
    const route = source("src/app/api/kiosk/dashboard/route.ts");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");

    expect(route).toContain("partialFailures");
    expect(route).toContain("settledValue(");
    expect(models).toContain("private struct LossyDecodableArray<Element: Decodable>: Decodable");
    expect(models).toContain("stats = try container.decodeIfPresent(Stats.self, forKey: .stats) ?? Stats()");
    expect(models).toContain("LossyDecodableArray<KioskEvent>");
    expect(models).toContain("LossyDecodableArray<ActiveItem>");
    expect(models).toContain("LossyDecodableArray<KioskActiveCheckout>");
    expect(models).toContain("let requesterId: String?");
    expect(models).toContain("sleepMode = try container.decodeIfPresent(Bool.self, forKey: .sleepMode) ?? false");
    expect(models).toContain("assignedUsers = try container.decodeIfPresent(LossyDecodableArray<AssignedUser>.self");
    expect(models).toContain("requesterInitials = try container.decodeIfPresent(String.self, forKey: .requesterInitials) ?? Self.initials(for: requesterName)");
    expect(client).toContain("[KioskAPI] decode failed for");
  });

  it("uses kiosk-wide fractional ISO date decoding so counters and row lists stay aligned", () => {
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");

    expect(client).toContain("d.dateDecodingStrategy = .custom");
    expect(client).toContain("KioskAPI.parseISODate(value)");
    expect(client).toContain("private static func parseISODate(_ value: String) -> Date?");
    expect(client).toContain("formatOptions = [.withInternetDateTime, .withFractionalSeconds]");
    expect(client).toContain("formatOptions = [.withInternetDateTime]");
    expect(client).not.toMatch(/private static let \w*[Ff]ormatter/);
    expect(client).not.toContain("d.dateDecodingStrategy = .iso8601");
  });
});

describe("iOS API contracts — kiosk student context decoding", () => {
  it("keeps student hub decoding tolerant and avoids false network copy", () => {
    const route = source("src/app/api/kiosk/student/[userId]/route.ts");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const operatorHub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");

    expect(route).toContain("return ok({");
    expect(route).toContain("checkouts: checkouts.map");
    expect(route).toContain("pendingPickups: [...pendingPickups, ...dueReservations].map");
    expect(route).toContain("reservations: reservations.map");
    expect(models).toContain("struct KioskStudentContext: Decodable");
    expect(models).toContain("LossyDecodableArray<KioskStudentCheckout>");
    expect(models).toContain("LossyDecodableArray<KioskPendingPickup>");
    expect(models).toContain("LossyDecodableArray<KioskReservation>");
    expect(models).toContain("items = try container.decodeIfPresent(LossyDecodableArray<StudentItem>.self");
    expect(models).toContain("serializedItems = try container.decodeIfPresent(LossyDecodableArray<SerializedItem>.self");
    expect(models).toContain("bulkItems = try container.decodeIfPresent(LossyDecodableArray<BulkItem>.self");
    expect(operatorHub).toContain("studentContextErrorMessage(for: error)");
    expect(operatorHub).toContain("case .networkError:");
    expect(operatorHub).toContain("case .decodingError:");
    expect(operatorHub).toContain("store.deactivate()");
    expect(operatorHub).not.toContain('self.error = "Check your connection and try again."');
  });
});

describe("iOS API contracts — kiosk checkout context", () => {
  it("kiosk checkout completion requires an event or custom purpose", () => {
    const schema = source("src/lib/schemas/kiosk.ts");
    const route = source("src/app/api/kiosk/checkout/complete/route.ts");
    const availabilityRoute = source("src/app/api/kiosk/checkout/availability/route.ts");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const checkoutView = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(schema).toContain("customPurpose: z.string().trim().min(1).max(160).optional()");
    expect(schema).toContain("checkoutAvailabilityBody");
    expect(schema).toContain("endsAt: z.string().datetime({ offset: true })");
    expect(schema).toContain("Select an event or enter what this checkout is for");
    expect(route).toContain("tx.bookingEvent.create");
    expect(route).toContain("checkAvailability(tx");
    expect(route).toContain("parseDateRange(");
    expect(route).toContain("title: b.title");
    expect(availabilityRoute).toContain("withKiosk");
    expect(availabilityRoute).toContain("checkAvailability(db");
    // Events are fetched with the identified requester so the server can flag
    // which of them that person is actually working a shift on.
    expect(client).toContain("func kioskCheckoutEvents(requesterId: String? = nil) async throws -> [KioskCheckoutEvent]");
    expect(client).toContain('URLQueryItem(name: "userId", value: id)');
    expect(client).toContain("func kioskCheckoutAvailability(");
    expect(client).toContain("eventId: eventId");
    expect(client).toContain("customPurpose: customPurpose");
    expect(client).toContain("endsAt: isoString(from: endsAt)");
    expect(models).toContain("struct KioskCheckoutEvent");
    expect(models).toContain("struct KioskCheckoutAvailabilityResult");
    expect(checkoutView).toContain("KioskCheckoutSetupPanel");
    expect(checkoutView).toContain("KioskCheckoutContextWindow");
    expect(checkoutView).toContain("KioskCheckoutReturnWindow");
    expect(checkoutView).toContain("KioskCheckoutAvailabilityBanner");
    expect(checkoutView).toContain("KioskCheckoutContextSummary");
    expect(checkoutView).toContain("KioskScanStage");
    expect(checkoutView).toContain("KioskCartGroupRow");
    expect(checkoutView).toContain("dueBackAt");
    expect(checkoutView).toContain("availabilityResult.hasBlockingIssue");
    expect(checkoutView).toContain("let preflight = await refreshAvailability(for: updated)");
    expect(checkoutView).toContain("scanAvailabilityFeedback(for: cartItem, result: $0)");
    expect(checkoutView).toContain("Remove it before checkout.");
    expect(checkoutView).toContain("Start Scanning");
    expect(checkoutView).toContain("Checkout Details");
    expect(checkoutView).toContain("Scan Items");
    expect(checkoutView).toContain("checkoutContextReady");
    expect(checkoutView).toContain("hasCheckoutContext");
  });

  it("kiosk checkout completion uses the shared kiosk API error path", () => {
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const method = client.slice(
      client.indexOf("func kioskCheckoutComplete("),
      client.indexOf("func kioskCheckoutDetail("),
    );

    expect(method).toContain("let response: Response = try await perform(req)");
    expect(method).toContain("return response.earnedBadges ?? []");
    expect(method).not.toContain("session.data(for: req)");
    expect(method).not.toContain("HTTPURLResponse");
  });
});

describe("iOS API contracts — availability check", () => {
  it("iOS decodes the route's top-level result (no data envelope)", () => {
    const route = source("src/app/api/availability/check/route.ts");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");

    // Route returns the availability result spread at the top level.
    expect(route).toContain("return ok({ ...result, bulkAvailability });");
    // iOS must decode the full top-level result, not an invented `data`
    // envelope. New advisory arrays remain optional at the wire boundary.
    expect(models).toContain("struct AvailabilityCheckResult: Decodable");
    expect(models).toContain("decodeIfPresent([AvailabilityCommitment].self, forKey: .upcomingCommitments)");
    expect(models).toContain("decodeIfPresent([AvailabilityTurnaroundRisk].self, forKey: .turnaroundRisks)");
    expect(models).toContain("decodeIfPresent([AvailabilityBulkTurnaroundRisk].self, forKey: .bulkTurnaroundRisks)");
    expect(apiClient).toContain("async -> AvailabilityCheckResult");
    expect(apiClient).toContain("decoder.decode(AvailabilityCheckResult.self, from: data)");
    expect(apiClient).toContain("let bulkItems: [BulkReservationRequest]");
    expect(apiClient).toContain("bulkItems: bulkItems");
    expect(apiClient).not.toContain("struct CheckResponse: Decodable { let conflicts: [AssetConflict]? }");
    expect(apiClient).toContain("kind: bookingKind.rawValue");
    expect(apiClient).toContain("bookingKind: BookingKind = .reservation");
    expect(source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift"))
      .toContain("bookingKind: .reservation");
    expect(source("ios/Wisconsin/Views/BookingDetailView.swift"))
      .toContain("bookingKind: booking.kind");
  });
});

describe("iOS API contracts — nullable columns stay optional in Swift", () => {
  it("AssetAccessory.serialNumber is optional (Asset.serialNumber is nullable)", () => {
    const schema = source("prisma/schema.prisma");
    const models = source("ios/Wisconsin/Models/AssetModels.swift");

    expect(schema).toMatch(/serialNumber\s+String\?\s+@unique @map\("serial_number"\)/);
    expect(models).toMatch(/struct AssetAccessory[\s\S]*?let serialNumber: String\?/);
  });

  it("AvailabilityBlock.dayOfWeek is optional (AD_HOC blocks have no weekday)", () => {
    const schema = source("prisma/schema.prisma");
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");

    expect(schema).toMatch(/dayOfWeek\s+Int\?\s+@map\("day_of_week"\)/);
    expect(models).toMatch(/struct AvailabilityBlock[\s\S]*?let dayOfWeek: Int\?/);
  });

  it("keeps one-off range and all-day fields rollout-safe", () => {
    const schema = source("prisma/schema.prisma");
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");

    expect(schema).toMatch(/dateEndsOn\s+DateTime\?\s+@map\("date_ends_on"\)/);
    expect(schema).toMatch(/allDay\s+Boolean\s+@default\(false\)\s+@map\("all_day"\)/);
    expect(models).toMatch(/struct AvailabilityBlock[\s\S]*?let dateEndsOn: String\?/);
    expect(models).toMatch(/struct AvailabilityBlock[\s\S]*?let allDay: Bool\?/);
  });
});

describe("iOS API contracts — notification preferences", () => {
  it("iOS sends the pausedUntil key explicitly (PUT schema requires it)", () => {
    const route = source("src/app/api/me/notification-preferences/route.ts");
    const models = source("ios/Wisconsin/Models/Models.swift");

    // Zod `.nullable()` without `.optional()` = the key must be present.
    expect(route).toContain("pausedUntil: z.string().datetime({ offset: true }).nullable()");
    // Swift's synthesized encoder omits nil optionals; the custom encoder
    // must write an explicit null.
    expect(models).toMatch(/func encode\(to encoder: Encoder\) throws[\s\S]*?try container\.encode\(pausedUntil, forKey: \.pausedUntil\)/);
  });

  it("iOS round-trips badges/categories so a save doesn't reset web prefs", () => {
    const models = source("ios/Wisconsin/Models/Models.swift");

    expect(models).toMatch(/struct NotificationPreferences[\s\S]*?var badges: Bool\?/);
    expect(models).toMatch(/struct NotificationPreferences[\s\S]*?var categories: Categories\?/);
    expect(models).toContain("try container.encodeIfPresent(badges, forKey: .badges)");
    expect(models).toContain("try container.encodeIfPresent(categories, forKey: .categories)");
  });
});

describe("iOS API contracts — mutation responses match list shapes", () => {
  it("POST /api/shift-groups returns the event relation EventShiftGroup requires", () => {
    const route = source("src/app/api/shift-groups/route.ts");
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");

    // Swift model requires a non-optional event…
    expect(models).toMatch(/struct EventShiftGroup[\s\S]*?let event: ShiftGroupEvent\b/);
    // …so the POST include must load it (same shape as GET).
    const postSection = route.slice(route.indexOf("export const POST"));
    expect(postSection).toMatch(/shiftGroup\.create\(\{[\s\S]*?include: \{\s*event: \{/);
  });

  it("cancelTrade returns the same relations as post/claim (ShiftTrade requires them)", () => {
    const service = source("src/lib/services/shift-trades.ts");
    const models = source("ios/Wisconsin/Models/ShiftTradeModels.swift");

    expect(models).toMatch(/struct ShiftTrade[\s\S]*?let postedBy: ShiftTradeUser\b/);
    expect(models).toMatch(/struct ShiftTrade[\s\S]*?let shiftAssignment: ShiftTradeAssignment\b/);

    const cancelSection = service.slice(
      service.indexOf("export async function cancelTrade"),
      service.indexOf("export async function listTrades"),
    );
    expect(cancelSection).toMatch(/shiftTrade\.update\(\{[\s\S]*?include: \{[\s\S]*?shiftAssignment: \{[\s\S]*?postedBy: \{/);
  });
});

describe("iOS API contracts — Open Work response tolerance", () => {
  it("keeps the native Trade Board tolerant of omitted Open Work sections", () => {
    const route = source("src/app/api/schedule/open-work/route.ts");
    const service = source("src/lib/services/schedule-open-work.ts");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/ShiftTradeModels.swift");

    expect(route).toContain("return ok({ data: work });");
    expect(service).toContain("openShifts: shifts.map");
    expect(service).toContain("pickupRequests: pickupRequests.map");
    expect(apiClient).toContain("let resp: DataWrapper<OpenWorkResponse> = try await perform");
    expect(models).toContain("struct OpenWorkResponse: Codable");
    expect(models).toContain("init(openShifts: [OpenWorkShift] = [], pickupRequests: [OpenWorkPickupRequest] = [])");
    expect(models).toContain("decodeIfPresent([OpenWorkShift].self, forKey: .openShifts) ?? []");
    expect(models).toContain("decodeIfPresent([OpenWorkPickupRequest].self, forKey: .pickupRequests) ?? []");
  });
});

describe("iOS API contracts — asset metadata leniency", () => {
  it("parseNotes only treats plain JSON objects as metadata", () => {
    const route = source("src/app/api/assets/[id]/route.ts");

    // JSON.parse accepts scalars ("1234") — without this guard a numeric
    // note is hidden on web and `metadata` becomes a non-object that breaks
    // the iOS asset-detail decode.
    expect(route).toMatch(/typeof parsed === "object" && !Array\.isArray\(parsed\)/);
  });

  it("AssetMetadata degrades to nil on malformed legacy JSON", () => {
    const models = source("ios/Wisconsin/Models/AssetModels.swift");

    const structBody = models.slice(
      models.indexOf("struct AssetMetadata"),
      models.indexOf("struct AssetDetail"),
    );
    expect(structBody).toContain("let container = try? decoder.container(keyedBy: CodingKeys.self)");
    expect(structBody).toContain("(try? container?.decodeIfPresent(String.self, forKey: .uwAssetTag)) ?? nil");
  });
});

describe("iOS API contracts — kiosk session", () => {
  it("kioskMe decodes the route's top-level shape (no data envelope)", () => {
    const route = source("src/app/api/kiosk/me/route.ts");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");

    expect(route).toMatch(/return ok\(\{\s*kioskId: kiosk\.kioskId/);
    const kioskMe = client.slice(
      client.indexOf("struct KioskMeResponse"),
      client.indexOf("func kioskActivate"),
    );
    // Top-level fields, no data envelope. `name` stays Optional so the app
    // tolerates older servers that don't return the device name yet.
    expect(kioskMe).toContain("let kioskId: String");
    expect(kioskMe).toContain("let locationId: String");
    expect(kioskMe).toContain("let locationName: String");
    expect(kioskMe).toContain("let name: String?");
    expect(kioskMe).not.toContain("DataWrapper");
  });

  it("activation persists a raw kiosk token even during API rollout skew", () => {
    const route = source("src/app/api/kiosk/activate/route.ts");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
    const activation = client.slice(
      client.indexOf("func kioskActivate"),
      client.indexOf("func kioskHeartbeat"),
    );

    expect(route).toContain("sessionToken,");
    expect(activation).toContain("kioskCredentialBoundary.advance()");
    expect(activation).toMatch(
      /let result: \(KioskActivationResponse, HTTPURLResponse\) = try await performWithResponse\(\s*req,\s*broadcastsUnauthorizedSession: false\s*\)/,
    );
    expect(client).toContain("kioskSessionToken(from: http)");
    expect(client).toContain("cookieValue(named: \"kiosk_session\"");
    expect(store).toContain("KioskSessionVault.save(sessionToken)");
  });

  it("validateSession only clears the activation on a definitive 401", () => {
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");

    const validate = store.slice(
      store.indexOf("private func validateSession()"),
      store.indexOf("func activate("),
    );
    expect(validate).toContain("catch APIError.unauthorized");
    // The unauthorized branch clears; the generic branch must NOT.
    const genericCatch = validate.slice(validate.lastIndexOf("} catch {"));
    expect(genericCatch).not.toContain("clearStoredInfo()");
    expect(genericCatch).toContain("startHeartbeat()");
  });
});

describe("iOS API contracts — URL construction", () => {
  it("no query string is embedded in a request(path:) literal", () => {
    // appendingPathComponent percent-encodes `?`, so `?force=true` inside a
    // path literal becomes part of the last route param and the server 404s.
    for (const file of [
      "ios/Wisconsin/Core/APIClient.swift",
      "ios/Wisconsin/Kiosk/KioskAPIClient.swift",
    ]) {
      const text = source(file);
      const embedded = text.match(/request\(\s*path: "[^"]*\?[^"]*"/g) ?? [];
      expect(embedded, `${file} embeds a query string in request(path:): ${embedded.join(", ")}`).toEqual([]);
    }
  });

  it("deleteShift passes force=true as a query item", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    expect(apiClient).toMatch(/func deleteShift[\s\S]*?queryItems: \[\.init\(name: "force", value: "true"\)\]/);
  });
});

describe("iOS project configuration", () => {
  it("XcodeGen and the checked-in Xcode project use the same bundle identifier", () => {
    const projectYml = source("ios/project.yml");
    const pbxproj = source("ios/Wisconsin.xcodeproj/project.pbxproj");

    expect(projectYml).toContain("bundleId: com.erikrole.Wisconsin");
    expect(pbxproj).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = com\.erikrole\.Wisconsin;/);
    expect(projectYml).not.toContain("bundleId: com.erikrole.creative");
  });

  it("keeps the kiosk target separate on the shared iOS 26 baseline", () => {
    const projectYml = source("ios/project.yml");
    const pbxproj = source("ios/Wisconsin.xcodeproj/project.pbxproj");

    const appTarget = projectYml.slice(
      projectYml.indexOf("  Wisconsin:\n"),
      projectYml.indexOf("  WisconsinKiosk:\n"),
    );
    const kioskTarget = projectYml.slice(
      projectYml.indexOf("  WisconsinKiosk:\n"),
      projectYml.indexOf("  WisconsinTests:\n"),
    );
    const testsTarget = projectYml.slice(projectYml.indexOf("  WisconsinTests:\n"));

    expect(appTarget).toContain('deploymentTarget: "26.0"');
    expect(appTarget).toContain("- KioskOnly/**");
    expect(testsTarget).toContain('deploymentTarget: "26.0"');

    expect(kioskTarget).toContain('deploymentTarget: "26.0"');
    expect(kioskTarget).not.toContain('deploymentTarget: "17.0"');
    expect(kioskTarget).toContain("bundleId: com.erikrole.WisconsinKiosk");
    expect(kioskTarget).toContain("- path: Wisconsin/KioskOnly");
    expect(kioskTarget).toContain("- path: Wisconsin/Kiosk");
    expect(kioskTarget).toContain("- path: Wisconsin/Assets.xcassets");
    expect(kioskTarget).toContain("- path: Wisconsin/Resources");
    expect(kioskTarget).not.toContain("- path: Wisconsin/Views");
    expect(kioskTarget).not.toContain("- path: Wisconsin/Core");

    expect(pbxproj).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = com\.erikrole\.Wisconsin;/);
    expect(pbxproj).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = com\.erikrole\.WisconsinKiosk;/);
    expect(pbxproj).not.toMatch(/IPHONEOS_DEPLOYMENT_TARGET = 17\.0;/);
  });
});
