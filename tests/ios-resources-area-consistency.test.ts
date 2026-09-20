import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

/**
 * The Resources area is three destinations that sit together in the iPad
 * sidebar and as adjacent Browse rows: Guides (the library landing), Users (the
 * people directory), and Licenses. They were built at different times and had
 * drifted apart — different refresh semantics, only one honouring the tab-reset
 * gesture, only one showing active-filter state, and dead-end empty states.
 *
 * These assertions pin the shared behaviour so the three keep reading as one
 * family. Per-surface behaviour lives in `ios-guides-native-page.test.ts` and
 * `ios-licenses-native-page.test.ts`.
 */

const guides = () => source("ios/Wisconsin/Views/GuidesView.swift");
const licenses = () => source("ios/Wisconsin/Views/LicensesView.swift");
const users = () => source("ios/Wisconsin/Views/UsersView.swift");

const surfaces = () =>
  [
    ["Guides", guides()],
    ["Licenses", licenses()],
    ["Users", users()],
  ] as const;

describe("iOS Resources area consistency", () => {
  it("every Resources destination honours the tab-reset gesture", () => {
    // Tab values come from AppTabView: Users 5, Guides 6, Licenses 7.
    expect(guides()).toContain("guard appState.resetTab == 6 else { return }");
    expect(licenses()).toContain("guard appState.resetTab == 7 else { return }");
    expect(users()).toContain("guard appState.resetTab == 5 else { return }");

    // Guides and Users own a path so the reset can pop back to root.
    expect(guides()).toContain("NavigationStack(path: $navigationPath)");
    expect(users()).toContain("NavigationStack(path: $navigationPath)");
  });

  it("a forced refresh supersedes an in-flight load instead of being dropped", () => {
    for (const [name, file] of surfaces()) {
      expect(file, `${name} should cancel the superseded load`).toContain("loadTask?.cancel()");
      expect(file, `${name} should not apply a cancelled response`).toContain(
        "catch is CancellationError",
      );
    }

    // The old shape returned instantly while a load was already running, which
    // snapped the refresh control back without refetching anything.
    expect(guides()).not.toContain("guard !isLoading else { return }");
    expect(licenses()).not.toContain("guard !isLoading else { return }");
  });

  it("narrowing a list to nothing always offers a way back", () => {
    expect(guides()).toContain('Button("Clear filters") { clearFilters() }');
    expect(users()).toContain('Button("Clear filters") { clearFilters() }');

    // The copy names which control emptied the list rather than guessing.
    expect(guides()).toContain("private var filteredEmptyDescription: String");
    expect(users()).toContain("private var emptyDescription: String");
  });

  it("filter and sort controls report active state with the shared tint", () => {
    expect(guides()).toContain(".listControlTint(isActive: focus != .all)");
    expect(guides()).toContain(".listControlTint(isActive: sort != .recommended)");
    expect(users()).toContain(".listControlTint(isActive: hasFilter)");

    // Filled glyph is the house signal that a control is narrowing the list.
    expect(guides()).toContain(
      'systemImage: "line.3.horizontal.decrease.circle\\(focus == .all ? "" : ".fill")"',
    );
  });

  it("initial loading announces a real status instead of an anonymous spinner", () => {
    expect(guides()).toContain('ProgressView("Loading guides")');
    expect(licenses()).toContain('ProgressView("Loading licenses")');
    expect(users()).toContain("accessibilityHidden(true)");
    expect(licenses()).not.toContain("ProgressView()\n                .frame(maxWidth: .infinity, maxHeight: .infinity)");
  });

  it("skeleton rows vary so loading does not read as a test pattern", () => {
    expect(users()).toContain("UserRowSkeleton(seed: index)");
    expect(users()).toContain("nameWidths");
    expect(users()).toContain("detailWidths");
  });

  it("licenses reads the pool and the current claim concurrently", () => {
    const file = licenses();
    expect(file).toContain("async let fetchedCodes = APIClient.shared.licenses()");
    expect(file).toContain("async let fetchedClaim = APIClient.shared.myLicense()");
    expect(file).toContain("try await (fetchedCodes, fetchedClaim)");
  });

  it("license expiry is read as a calendar date, not an instant", () => {
    const file = licenses();
    // Storage contract lives in src/lib/license-dates.ts: an expiry is a
    // calendar date encoded at UTC midnight. Formatting the raw instant in the
    // device timezone rendered every expiry a day early west of UTC.
    expect(file).toContain("enum LicenseExpiry");
    expect(file).toContain('TimeZone(identifier: "UTC")');
    expect(file).toContain("static func calendarDay(from raw: String?");
    expect(file).toContain("static func daysUntil(");
    // Claim timestamps are real instants and must stay local.
    expect(file).toContain("Claimed \\(date.formatted(date: .abbreviated, time: .omitted))");
  });

  it("license confirmations expire instead of pinning to the list", () => {
    const file = licenses();
    expect(file).toContain("private func showNotice(");
    expect(file).toContain("noticeTask?.cancel()");
    // A "copied for 2 minutes" banner that outlives the clipboard entry is a
    // lie, so no confirmation may be assigned directly any more.
    expect(file).not.toMatch(/notice = "License claimed/);
    expect(file).not.toMatch(/notice = "License returned/);
    expect(file).not.toMatch(/notice = "Code copied/);
  });
});
