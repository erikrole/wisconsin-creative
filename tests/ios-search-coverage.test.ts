import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("iOS search: Kits, Events and Guides", () => {
  const service = source("ios/Wisconsin/Core/SearchService.swift");
  const sheet = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");
  const client = apiClientSource();
  const route = source("src/app/api/calendar-events/route.ts");
  const where = source("src/lib/schedule-event-where.ts");

  it("asks each existing endpoint for its own matches", () => {
    expect(service).toContain("api.kitList(search: query");
    expect(service).toContain("api.searchCalendarEvents(query: query");
    expect(service).toContain("api.guides(search: query)");
    expect(client).toContain('.init(name: "q", value: query)');
  });

  it("treats a role without access as nothing to show, not a failure", () => {
    expect(service).toContain("catch APIError.notFound");
    expect(service).toContain("status == 403");
    expect(service).toContain("if kitsPage.failed { unavailable.insert(.kits) }");
  });

  it("offers a chip, a section, and a destination for each", () => {
    for (const label of ['"Kits"', '"Events"', '"Guides"']) expect(sheet).toContain(label);
    expect(sheet).toContain("shows(.kits)");
    expect(sheet).toContain("shows(.events)");
    expect(sheet).toContain("shows(.guides)");
    expect(sheet).toContain("KitDetailView(kitId: id)");
    expect(sheet).toContain("EventDetailView(event: event, myShifts: [])");
    expect(sheet).toContain("GuideReaderView(guide: guide)");
  });

  it("keeps collaborators on gear only", () => {
    expect(service).toContain("if gearOnly {");
  });

  it("adds q to the events list without widening visibility", () => {
    expect(route).toContain('searchParams.get("q")');
    expect(where).toContain("where.AND = [");
    expect(where).toContain("...(!includeHidden ? { isHidden: false } : {})");
  });
});
