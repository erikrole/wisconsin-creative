import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const list = () => source("ios/Wisconsin/Views/EventsView.swift");
const detail = () => source("ios/Wisconsin/Views/EventCatalogDetailView.swift");
const models = () => source("ios/Wisconsin/Models/EventCatalogModels.swift");
const client = () => source("ios/Wisconsin/Core/APIClient.swift");

describe("iOS Events browse", () => {
  it("adds a read-only Events row for internal roles and keeps collaborators off it", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).toContain("[.scoreboard, .events, .items, .kits, .guides, .brandAssets, .blasts, .licenses, .users]");
    expect(menu).toContain('case .events: "Events"');
    expect(menu).toContain("Event details, linked gear, and bookings.");
    expect(menu).toContain("EventsView(wrapsInNavigationStack: false)");
    expect(menu).toContain('case .users: "Users"');

    const collaboratorRows = menu.slice(
      menu.indexOf("let capabilities"),
      menu.indexOf("var body: some View"),
    );
    expect(collaboratorRows).not.toContain(".events");
    expect(collaboratorRows).toContain(".scoreboard");
  });

  it("lists calendar events inside the Browse navigation stack", () => {
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
