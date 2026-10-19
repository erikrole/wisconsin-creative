import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS profile hours", () => {
  const profile = source("ios/Wisconsin/Views/ProfileView.swift");
  const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
  const client = source("ios/Wisconsin/Core/APIClient.swift");
  const route = source("src/app/api/shifts/my-hours/route.ts");

  const card = profile.slice(
    profile.indexOf("struct MyHoursCard"),
    profile.indexOf("private func figure("),
  );
  const access = profile.slice(
    profile.indexOf("enum MyHoursAccess"),
    profile.indexOf("struct MyHoursCard"),
  );

  it("reads the signed-in person's hours from the existing route", () => {
    expect(route).toContain("requireInternalActor(user)");
    expect(route).toContain("thisWeek:");
    expect(route).toContain("thisMonth:");
    expect(route).toContain("shiftCountWeek");
    expect(route).toContain("shiftCountMonth");
    expect(client).toContain('request(path: "/api/shifts/my-hours")');
    expect(client).toContain("func myHours() async throws -> MyHours");
    expect(profile).toContain("let thisWeek: Double");
    expect(profile).toContain("let thisMonth: Double");
    expect(profile).toContain("let shiftCountWeek: Int");
    expect(profile).toContain("let shiftCountMonth: Int");
    expect(client).not.toContain('"/api/shifts/my-hours", method:');
  });

  it("shows hours on your profile and hides them from collaborators and other people", () => {
    expect(access).toContain('case "ADMIN", "STAFF", "STUDENT"');
    expect(profile).toContain("if MyHoursAccess.canRead(role: session.currentUser?.role)");
    expect(profile).toContain("guard MyHoursAccess.canRead(role: session.currentUser?.role) else { return }");
    expect(detail).toContain("if isViewingSelf && MyHoursAccess.canRead(role: session.currentUser?.role)");
    expect(detail).toContain("guard isViewingSelf, MyHoursAccess.canRead(role: session.currentUser?.role) else { return }");
    expect(detail).toContain("session.currentUser?.id == userId");

    const detailHeader = detail.indexOf("profileHeader(detail)");
    const detailNext = detail.indexOf("ProfileNextUpCard(");
    const detailHours = detail.indexOf("MyHoursCard(");
    const detailBadges = detail.indexOf("badgesSection");
    expect(detailHeader).toBeGreaterThan(-1);
    expect(detailNext).toBeGreaterThan(detailHeader);
    expect(detailHours).toBeGreaterThan(detailNext);
    expect(detailBadges).toBeGreaterThan(detailHours);

    const profileHeader = profile.indexOf("headerSection");
    const profileNext = profile.indexOf("nextUpSection");
    const profileHours = profile.indexOf("hoursSection");
    const profileBadges = profile.indexOf("badgeSection");
    expect(profileNext).toBeGreaterThan(profileHeader);
    expect(profileHours).toBeGreaterThan(profileNext);
    expect(profileBadges).toBeGreaterThan(profileHours);
  });

  it("keeps the website's week and month wording and a single retry", () => {
    expect(card).toContain('BrandSectionHeader(');
    expect(card).toContain('"My hours"');
    expect(card).toContain('"Monday through Sunday, Central time."');
    expect(card).toContain('"This week (\\(hours.weekShiftLabel))"');
    expect(card).toContain('"This month (\\(hours.monthShiftLabel))"');
    expect(card).toContain('Text("Hours could not load.")');
    expect(card).toContain('Button("Try again", action: retry)');
    expect(card).toContain("dynamicTypeSize.isAccessibilitySize");
    expect(profile).toContain('count == 1 ? "1 shift" : "\\(count) shifts"');
    expect(profile).toContain('return String(format: "%.1fh", value)');
    expect(card).not.toContain("Color.statusText");
    expect(card).not.toContain("POST");
  });

  it("keeps the last totals when a refresh fails", () => {
    expect(access).toContain("if hours.wrappedValue == nil { loading.wrappedValue = true }");
    expect(access).toContain("hours.wrappedValue = try await APIClient.shared.myHours()");
    expect(access).toContain("if isCancellation(error), hours.wrappedValue != nil { return }");
    expect(access).not.toContain("hours.wrappedValue = nil");
  });
});
