import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Home header source contract", () => {
  it("keeps the Home hero free of generated summary copy", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");

    expect(home).not.toContain("import FoundationModels");
    expect(home).not.toContain("homeGeneratedHeaderDefaultsKey");
    expect(home).not.toContain("SystemLanguageModel");
    expect(home).not.toContain("LanguageModelSession");
    expect(home).not.toContain("GenerationOptions");
    expect(home).not.toContain("HomeHeaderSignal");
    expect(home).not.toContain("generatedMessage");
    expect(home).not.toContain("headerMessage");
    expect(home).not.toContain("fallbackMessage");
  });

  it("varies the greeting locally while leaving operational rows authoritative", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");

    expect(home).toContain("private var greeting: String");
    expect(home).toContain("let dayOrdinal = calendar.ordinality(of: .day, in: .era, for: .now)");
    expect(home).toContain('variants = ["Good morning", "Morning", "Good to see you"]');
    expect(home).toContain('variants = ["Good afternoon", "Afternoon", "Good to see you"]');
    expect(home).toContain('variants = ["Good evening", "Evening", "Welcome back"]');
    expect(home).toContain('variants = ["Hello", "Welcome back", "Good to see you"]');
    expect(home).toContain("return variants[dayOrdinal % variants.count]");
    expect(home).toContain("HomeDashboardList(");
  });

  it("keeps Live Activity reconciliation out of the Home dashboard load timing", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const loadBody = home.slice(
      home.indexOf("func load(appState: AppState?"),
      home.indexOf("private static func refreshSecondaryLaunchState"),
    );

    expect(loadBody).toContain("launch.home.dashboardLoad result=success");
    expect(loadBody).toContain("Task {");
    expect(loadBody).toContain("await Self.refreshSecondaryLaunchState");
    expect(loadBody).not.toContain("await CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts");
    expect(home).toContain("launch.home.liveActivityReconcile");
  });

  it("keeps Home focused on needs-attention without a floating create button", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const sections = source("ios/Wisconsin/Views/Home/HomeSections.swift");

    expect(home).not.toContain("@State private var showCreate");
    expect(home).not.toContain(".overlay(alignment: .bottomTrailing)");
    expect(home).not.toContain("CreateBookingSheet { newId in");
    expect(home).not.toContain("#if DEBUG");
    expect(home).not.toContain("KioskStore.enterKiosk");
    expect(home).toContain("HomeDashboardList(");
    expect(sections).toContain('HomeSectionHeader(title: "Needs attention"');
    expect(sections).toContain('Label("Search or Scan", systemImage: "magnifyingglass")');
  });

  it("replaces the counts line with the web's one-sentence day summary", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const model = source("ios/Wisconsin/Views/Home/HomeModel.swift");

    expect(home).toContain("summary: HomeModel.daySummary(dash: dash)");
    expect(home).not.toContain("StatStrip(");
    expect(model).toContain("static func daySummary(dash: DashboardData");
    expect(model).toContain("Nothing due today. You\\u{2019}re clear.");
    expect(model).toContain('"\\(team ? "Team gear" : "Your gear"): ');
  });

  it("keeps red for overdue and green for the primary action", () => {
    const sections = source("ios/Wisconsin/Views/Home/HomeSections.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");

    expect(source("ios/Wisconsin/Views/Home/HomeModel.swift")).toContain('var isOverdue: Bool { id.hasPrefix("overdue-")');
    expect(sections).toContain("item.isOverdue ? AnyShapeStyle(Color.statusText(.red))");
    expect(sections).toContain(".tint(Color.statusText(.green))");
    // The bell badge is not red: overdue is the only red on Home.
    expect(home).not.toContain("foregroundStyle(Color.brandPrimary)");
  });

  it("gives call times only to Students on Up next rows", () => {
    const model = source("ios/Wisconsin/Views/Home/HomeModel.swift");

    // Staff know their event timing outside Schedule, so only an ST assignment
    // with a call window is labelled "Call time".
    expect(model).toContain('let studentCall = s.workerType == "ST" && !allDay && s.callStartsAt != nil');
    expect(model).toContain('studentCall ? "Call time" : nil');
  });

  it("titles rows in the Bookings list's Gotham face", () => {
    const sections = source("ios/Wisconsin/Views/Home/HomeSections.swift");
    const bookings = source("ios/Wisconsin/Views/BookingsView.swift");

    expect(bookings).toContain(".font(.gothamBold(size: 16))");
    expect(sections).toContain(".font(.gothamBold(size: 16))");
    expect(sections).toContain(".font(.gothamBlack(size: 22))");
  });

  it("leaves freshness to pull-to-refresh instead of a synced stamp", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");

    expect(home).toContain(".refreshable {");
    expect(home).not.toContain("syncedStamp");
    expect(home).not.toContain('Text("Synced ');
    expect(home).not.toContain("Dashboard synced");
    // The strip no longer needs the load timestamp at all.
    expect(home).not.toContain("lastLoadedAt: vm.lastLoadedAt");
  });

  it("colors rows from the domain each row belongs to", () => {
    const sections = source("ios/Wisconsin/Views/Home/HomeSections.swift");

    // Gear markers read the booking-status palette in docs/COLOR_SYSTEM.md,
    // with the deadline overlay on an open checkout due today.
    expect(sections).toContain("private func homeGearTone(_ booking: BookingSummary, now: Date) -> StatusTone");
    expect(sections).toContain("if booking.isOverdue { return .red }");
    expect(sections).toContain("case .booked: return .purple");
    expect(sections).toContain("case .pendingPickup: return .orange");
    expect(sections).toContain("Calendar.current.dayOffset(of: booking.endsAt, from: now) == 0 ? .orange : .blue");
    // The featured shift card reads the scheduling domain's venue rail.
    expect(sections).toContain("venueRailColor(for: shift.asScheduleEvent)");
  });
});
