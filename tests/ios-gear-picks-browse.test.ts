import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const view = () => source("ios/Wisconsin/Views/GearPicksView.swift");
const models = () => source("ios/Wisconsin/Models/GearPickModels.swift");
const client = () => source("ios/Wisconsin/Core/APIClient.swift");

describe("iOS UA gear picks", () => {
  it("adds a participant row for internal roles and keeps collaborators off it", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).toContain("[.scoreboard, .accountability, .events, .items, .kits, .guides, .brandAssets, .blasts, .licenses, .users, .gearPicks]");
    expect(internalRows).toContain("rows.insert(.batteries, at: 4)");
    expect(menu).toContain('case .gearPicks: "UA Gear"');
    expect(menu).toContain("Pick this year's Under Armour gear.");
    expect(menu).toContain("GearPicksView(wrapsInNavigationStack: false)");

    const collaboratorRows = menu.slice(menu.indexOf("let capabilities"), menu.indexOf("var body: some View"));
    expect(collaboratorRows).not.toContain("gearPicks");
  });

  it("shops and saves through the participant route only", () => {
    const screen = view();
    const api = client();

    expect(api).toContain('request(path: "/api/gear-picks/me", queryItems: [.init(name: "catalog", value: "1")])');
    expect(api).toContain('request(path: "/api/gear-picks/me", method: "PUT")');
    expect(api).not.toContain("/api/gear-picks/admin");
    expect(screen).not.toContain("/api/gear-picks/admin");
    expect(screen).not.toContain("Export CSV");
    expect(screen).not.toContain("setDeadline");
    expect(screen).toContain("Save draft");
    expect(screen).toContain("Submit picks");
    expect(screen).toContain("Gear picks aren't open");
    expect(screen).toContain("You're not on this year's pick list");
    expect(screen).toContain("Standard issue is covered by the department");
    expect(screen).toContain("Included in your standard issue");
    expect(screen).toContain("Discard and reload");
    expect(screen).toContain("@ViewBuilder");
  });

  it("keeps sizing, allowance, and stale-save problems in product language", () => {
    const rules = models();

    expect(rules).toContain("Choose a size");
    expect(rules).toContain("Choose an available size");
    expect(rules).toContain("is listed twice");
    expect(rules).toContain("over your");
    expect(rules).toContain("OSFA");
    expect(client()).toContain("func myGearPicks()");
    expect(client()).toContain("func saveMyGearPicks");
  });
});
