import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const list = () => source("ios/Wisconsin/Views/EventsView.swift");
const detail = () => source("ios/Wisconsin/Views/EventCatalogDetailView.swift");
const models = () => source("ios/Wisconsin/Models/EventCatalogModels.swift");
const client = () => apiClientSource();

describe("iOS Events browse", () => {
  it("keeps event discovery in Schedule instead of a second Browse destination", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).not.toContain(".events");
    expect(menu).not.toContain('case events');
    expect(menu).not.toContain("EventsView(wrapsInNavigationStack: false)");
    expect(menu).toContain('if rawValue == "events"');
    expect(menu).toContain("appState.selectedTab = 1");
    expect(menu).toContain('case .users: "Staff"');

    const collaboratorRows = menu.slice(
      menu.indexOf("let capabilities"),
      menu.indexOf("var body: some View"),
    );
    expect(collaboratorRows).not.toContain(".events");
    expect(collaboratorRows).toContain(".scoreboard");
  });

  it("keeps retained catalog reads bounded and read-only", () => {
    const events = list();

    expect(events).toContain("var wrapsInNavigationStack = true");
    expect(events).toContain("calendarEventsPage(");
    expect(events).toContain("EventCatalogDetailView(eventId: route.id)");
    expect(events).toContain(".navigationDestination(for: BookingRouteId.self)");
    expect(events).toContain("guard appState.resetTab == 2 else { return }");
    expect(events).toContain("eventCatalogRecentWindow()");
    expect(events).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
  });

  it("shows event identity, linked gear, and bookings, then opens Schedule", () => {
    const screen = detail();

    expect(screen).toContain("calendarEventDetail(id:");
    expect(screen).toContain('role == "STAFF" || role == "ADMIN"');
    expect(screen).toContain("includeTeamGear");
    expect(screen).toContain("eventCommandCenter(id:");
    expect(screen).toContain("myShifts(eventId:");
    expect(screen).toContain("booking(id:");
    expect(screen).toContain('Label("Open in Schedule"');
    expect(screen).toContain("EventDetailView(event: event, myShifts: model.personalShifts)");
    expect(screen).toContain("StatusPill(");
    expect(screen).toContain("Separating them stays on the web.");
    expect(screen).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);
  });

  it("keeps the venue, source, and gear-status mapping on the shared calendar contract", () => {
    const catalog = models();
    const api = client();

    expect(catalog).toContain("func eventCatalogVenueName");
    expect(catalog).toContain("scheduleVenueDisplayName");
    expect(catalog).toContain("func eventCatalogSourceLabel");
    expect(catalog).toContain("UWBadgers.com");
    expect(catalog).toContain('case "checked_out"');
    expect(catalog).toContain('case "BOOKED"');
    expect(api).toContain('request(path: "/api/calendar-events/\\(id)")');
    expect(api).toContain('request(path: "/api/calendar-events/\\(id)/command-center")');
    expect(api).toContain('if let eventId { items.append(.init(name: "eventId", value: eventId)) }');
    expect(api).toContain("func myShifts(eventId: String)");
  });
});
