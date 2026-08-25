import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function between(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

describe("native app and web trust contracts", () => {
  it("returns and installs authoritative booking edit and cancel snapshots", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const list = source("ios/Wisconsin/Views/BookingsView.swift");

    const cancel = between(api, "func cancelBooking(", "// MARK: - Booking drafts");
    expect(cancel).toContain("async throws -> Booking");
    expect(cancel).toContain("DataWrapper<Booking>");
    expect(cancel).toContain("return response.data");

    const update = between(api, "func updateBooking(", "func transferBookingOwner(");
    expect(update).toContain("async throws -> Booking");
    expect(update).toContain("guard let updatedAt");
    expect(update).toContain('forHTTPHeaderField: "If-Unmodified-Since"');
    expect(update).toContain("DataWrapper<Booking>");
    expect(update).not.toContain("authenticatedData(for: req)");

    expect(detail).toContain("let updatedBooking = try await APIClient.shared.updateBooking(");
    expect(detail).toContain("let cancelled = try await APIClient.shared.cancelBooking(");
    expect(detail).toContain("booking = cancelled");
    expect(list).toContain("vm.install(cancelled)");
  });

  it("uses server actions in native list and detail with legacy rollout fallback", () => {
    const route = source("src/app/api/bookings/route.ts");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const list = source("ios/Wisconsin/Views/BookingsView.swift");

    expect(route).toContain("getAllowedBookingActions(user, booking)");
    expect(route).toContain("collaboratorBookingResponse(displayBooking, allowedActions)");
    expect(route).toContain("{ ...displayBooking, allowedActions }");
    expect(models).toContain("var allowedActions: [String]? = nil");
    expect(models).toContain("func allows(_ action: String) -> Bool?");
    expect(detail).toContain('booking.allows("edit") ?? legacyCanEdit(booking)');
    expect(detail).toContain('booking.allows("extend") ?? legacyAllowed');
    expect(list).toContain('booking.allows("transfer-owner")');
    expect(list).toContain('booking.allows("cancel")');
  });

  it("encodes explicit item clears and installs the returned fields", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/AssetModels.swift");
    const item = source("ios/Wisconsin/Views/ItemDetailView.swift");

    const update = between(api, "func updateAsset(", "func updateBooking(");
    expect(update).toContain("AssetTextMutation");
    expect(update).toContain("try container.encodeNil(forKey: .name)");
    expect(update).toContain("try container.encodeNil(forKey: .serialNumber)");
    expect(update).toContain('try container.encode("", forKey: .notes)');
    expect(update).toContain("DataWrapper<AssetUpdateConfirmation>");
    expect(models).toContain("func applying(_ update: AssetUpdateConfirmation) -> AssetDetail");
    expect(item).toContain("edited.isEmpty ? .clear : .value(edited)");
    expect(item).toContain("self.asset = asset.applying(updated)");
  });

  it("renders every linked event with a single-event fallback", () => {
    const models = source("ios/Wisconsin/Models/Models.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");

    expect(models).toContain("var events: [BookingEvent]? = nil");
    expect(models).toContain("if let events, !events.isEmpty { return events }");
    expect(models).toContain("return event.map { [$0] } ?? []");
    expect(detail).toContain("booking.linkedEvents.compactMap");
    expect(detail).toContain("ForEach(Array(eventSummaries.enumerated())");
  });

  // Re-pinned on every bump on purpose: the pair has to move together, and a
  // stale number must not survive. The separate kiosk target keeps its own
  // build number and is deliberately not counted here.
  it("versions the app and Live Activity extension together as version 1.1 build 28", () => {
    const project = source("ios/project.yml");
    const mainTarget = between(project, "  Wisconsin:\n", "  WisconsinKiosk:\n");
    const liveActivitiesTarget = between(project, "  WisconsinLiveActivities:\n", "schemes:\n");
    expect(project.match(/MARKETING_VERSION: "1.1"/g)).toHaveLength(2);
    expect(project.match(/CURRENT_PROJECT_VERSION: "28"/g)).toHaveLength(2);
    expect(mainTarget).not.toContain('MARKETING_VERSION: "1.0"');
    expect(mainTarget).not.toContain('CURRENT_PROJECT_VERSION: "27"');
    expect(liveActivitiesTarget).not.toContain('MARKETING_VERSION: "1.0"');
    expect(liveActivitiesTarget).not.toContain('CURRENT_PROJECT_VERSION: "27"');
  });

  it("keeps WeatherKit out of the App Store target", () => {
    const project = source("ios/project.yml");
    const generatedProject = source("ios/Wisconsin.xcodeproj/project.pbxproj");
    const entitlements = source("ios/Wisconsin/Wisconsin.entitlements");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(project).not.toContain("WeatherKit");
    expect(generatedProject).not.toContain("WeatherKit");
    expect(entitlements).not.toContain("com.apple.developer.weatherkit");
    expect(eventDetail).not.toContain("EventWeatherService");
    expect(eventDetail).not.toContain("weatherkit.apple.com");
    expect(existsSync("ios/Wisconsin/Core/EventWeatherService.swift")).toBe(false);
  });
});
