import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS widgets: Lock Screen and larger families", () => {
  const widgets = source("ios/WisconsinLiveActivities/GearHomeScreenWidgets.swift");

  it("offers every family on both widgets", () => {
    const families =
      ".supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])";
    expect(widgets.split(families).length - 1).toBe(2);
  });

  it("gives each accessory family an empty state instead of a Home Screen placeholder", () => {
    expect(widgets).toContain("AccessoryWidgetBackground()");
    expect(widgets).toContain("AccessoryEmpty(");
    expect(widgets).toContain("No upcoming shifts");
    expect(widgets).toContain("All gear returned");
  });

  it("lists shifts and gear from the cached snapshot only", () => {
    expect(widgets).toContain("listBody(rows: 3, showsScan: false)");
    expect(widgets).toContain("listBody(rows: 6, showsScan: true)");
    expect(widgets).toContain(".filter { $0.endsAt > entry.date }");
    expect(widgets).toContain("bookingRows(limit:");
  });

  it("never ticks seconds on gear and keeps the countdown in the list header", () => {
    expect(widgets).not.toContain('Overdue" : "Due") \\(next.endsAt, style: .relative)');
    expect(widgets).toContain("format: .dateTime.hour().minute()");
    expect(widgets).toContain('Text("in \\(next.startsAt, style: .relative)")');
    expect(widgets).toContain("private var gearSummary: AnyView?");
  });

  it("opens Scan through the capability-gated route, not a widget-side action", () => {
    expect(widgets).toContain('URL(string: "wisconsin://scan")');
  });
});

describe("iOS search", () => {
  const search = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");

  it("scopes results to the sources the search service already queries", () => {
    expect(search).toContain("enum SearchScope");
    for (const label of ['"Gear"', '"Reservations"', '"Check-outs"', '"People"']) {
      expect(search).toContain(label);
    }
    expect(search).toContain("shows(.items)");
    expect(search).toContain("shows(.people)");
    expect(search).toContain("FilterChip(label: chipLabel(option)");
  });

  it("offers quick jumps and deletable recents before typing", () => {
    expect(search).toContain('quickRow("Scan a code"');
    expect(search).toContain('quickRow("My gear"');
    expect(search).toContain("appState.apply(.myGear)");
    expect(search).toContain("removeRecent(term)");
    expect(search).toContain("Clear recent searches");
  });
});

describe("iOS scanner", () => {
  const scanner = source("ios/Wisconsin/Views/Search/QRScannerSheet.swift");

  it("keeps a session history, an idle hint, and a confirmation beat", () => {
    expect(scanner).toContain("ScanHistoryEntry");
    expect(scanner).toContain("historyStrip");
    expect(scanner).toContain("No code found yet");
    expect(scanner).toContain("record(label, success: true)");
    expect(scanner).toContain("record(shortCode, success: false)");
  });

  it("still pairs every outcome with a haptic", () => {
    expect(scanner).toContain("Haptics.success()");
    expect(scanner).toContain("Haptics.warning()");
    expect(scanner).toContain("Haptics.error()");
  });
});

describe("iOS notifications inbox", () => {
  const inbox = source("ios/Wisconsin/Views/NotificationsSheet.swift");

  it("groups by calendar day", () => {
    expect(inbox).toContain("static func dayTitle(daysAgo: Int, sample: Date)");
    expect(inbox).toContain('case 0: return "Today"');
    expect(inbox).toContain('case 1: return "Yesterday"');
    expect(inbox).not.toContain('"Previous 7 Days"');
  });

  it("swipes to read and to unread, and never deletes", () => {
    expect(inbox).toContain(".swipeActions(edge: .leading, allowsFullSwipe: true)");
    expect(inbox).toContain("func markUnread(id: String) async");
    expect(inbox).toContain('Label("Mark Unread"');
    expect(inbox).not.toContain("DELETE");
    expect(inbox).not.toContain('role: .destructive');
  });
});

describe("iOS Siri and Shortcuts", () => {
  const data = source("ios/Wisconsin/App/AppIntentsData.swift");
  const provider = source("ios/Wisconsin/App/AppIntents.swift");

  it("searches gear read-only with a spoken and visual answer", () => {
    expect(data).toContain("struct SearchGearIntent: AppIntent");
    expect(data).toContain('requireIntentCapability("GEAR_CATALOG_VIEW")');
    expect(data).toContain("struct GearSearchSnippetIntent: SnippetIntent");
    expect(data).toContain("snippetIntent: GearSearchSnippetIntent(query: term)");
    expect(provider).toContain("intent: SearchGearIntent()");
    expect(provider).toContain("What gear is due back in");
    expect(provider).toContain("When do I work next in");
  });
});
