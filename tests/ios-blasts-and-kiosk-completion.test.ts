import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("kiosk handoff completion", () => {
  it("throws APIError instead of force-unwrapping the saved request", () => {
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const tests = source("ios/WisconsinKioskTests/KioskCompletionPreparationTests.swift");

    expect(client).not.toContain("request.url!");
    expect(client).not.toContain("request.httpBody!");
    expect(client).not.toContain("as! [String: Any]");
    expect(client).toContain("guard let url = request.url else {");
    expect(client).toContain("guard let httpBody = request.httpBody else {");
    expect(client).toContain("guard var body = parsed as? [String: Any] else {");
    expect(client).toContain('throw APIError.serverError("Could not save this handoff. Try again.")');
    expect(client).toContain("KioskCompletionPreparation.prepare(");

    expect(tests).toContain("func testMissingURLThrowsAPIError()");
    expect(tests).toContain("func testMissingBodyThrowsAPIError()");
    expect(tests).toContain("func testNonObjectBodyThrowsAPIError()");
    expect(tests).toContain("func testSavedBodyIsReusedWithoutRequiringANewPayload()");
    expect(tests).toContain("case APIError.serverError");
  });
});

describe("native Blasts list", () => {
  it("reaches a read-only list and detail from Browse with the existing me/blasts client", () => {
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");
    const view = source("ios/Wisconsin/Views/BlastsView.swift");
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const history = source("ios/WisconsinTests/BlastHistoryTests.swift");
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(browse).toContain('case .blasts: "Blasts"');
    expect(browse).toContain("BlastsView(wrapsInNavigationStack: false)");
    expect(browse).toContain(".blasts, .whatsNew, .licenses, .sharedLogins, .users, .gearPicks]");
    expect(browse).toContain("Optional.some(BrowseDestination.blasts)");
    expect(api).toContain('request(path: "/api/me/blasts")');
    expect(api).toContain('request(path: "/api/me/blasts/\\(id)/read"');
    expect(api).toContain('request(path: "/api/me/blasts/\\(id)/ack"');
    expect(api).toContain("BlastArchive.markAcknowledged(id)");
    expect(api).not.toContain('request(path: "/api/blasts"');

    expect(view).toContain("APIClient.shared.activeBlasts()");
    expect(view).toContain("APIClient.shared.markBlastRead(id: id)");
    expect(view).toContain("APIClient.shared.acknowledgeBlast(id: id)");
    expect(view).toContain('navigationTitle("Blasts")');
    expect(view).toContain('Text(isAcknowledging ? "Saving" : "Got it")');
    expect(view).toContain("StatusPill(label: entry.blast.severity.blastLabel, tone: entry.blast.severity.blastTone)");
    expect(view).toContain('Text("Sent by \\(sender)")');
    expect(view).toContain('Text("Acknowledged")');
    expect(view).toContain(".listStyle(.insetGrouped)");
    expect(view).toContain('Label("Couldn\'t load blasts", systemImage: "wifi.exclamationmark")');
    expect(view).not.toContain("New blast");
    expect(view).not.toContain("Cancel blast");
    expect(view).not.toContain("/api/blasts");

    expect(home).toContain("BlastArchive.recordActive(latest, userId: userId)");
    expect(app).toContain("BlastArchive.clear()");
    expect(history).toContain("func testDismissedBlastStaysWhenTheServerOmitsIt()");
    expect(tabs.match(/\.tabPlacement\(\.sidebarOnly\)/g)).toHaveLength(4);
  });
});
