import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS blast sending (staff and admins)", () => {
  const api = source("ios/Wisconsin/Core/APIClient.swift");
  const models = source("ios/Wisconsin/Models/BlastModels.swift");
  const compose = source("ios/Wisconsin/Views/BlastComposeViews.swift");
  const blasts = source("ios/Wisconsin/Views/BlastsView.swift");
  const event = source("ios/Wisconsin/Views/EventDetailSheet.swift");

  it("uses the web's blast routes for preview, send, tracking and cancel", () => {
    expect(api).toContain('request(path: "/api/blasts/preview", method: "POST")');
    expect(api).toContain('request(path: "/api/blasts", method: "POST")');
    expect(api).toContain('request(path: "/api/blasts", queryItems:');
    expect(api).toContain('request(path: "/api/blasts/\\(id)")');
    expect(api).toContain('request(path: "/api/blasts/\\(id)/cancel", method: "POST")');
    // Every blast asks for an acknowledgement, matching the web dialog.
    expect(api).toContain("requiresAck: true");
  });

  it("encodes only the targets the server schema accepts, and never an empty group", () => {
    expect(models).toContain('try c.encode("EVENT_CREW", forKey: .kind)');
    expect(models).toContain('try c.encode("DYNAMIC", forKey: .kind)');
    expect(models).toContain("case .groups(let areas, let workerTypes): !areas.isEmpty || !workerTypes.isEmpty");
  });

  it("previews who a blast reaches and confirms before sending", () => {
    expect(compose).toContain("APIClient.shared.previewBlast(target: target)");
    expect(compose).toContain("try await Task.sleep(for: .milliseconds(300))");
    expect(compose).toContain('Button("Send") { confirmingSend = true }');
    expect(compose).toContain('Button("Send Blast") { Task { await send() } }');
    expect(compose).toContain("(reachCount ?? 0) > 0");
  });

  it("offers compose and Sent only to staff and admins", () => {
    expect(blasts).toContain('return role == "STAFF" || role == "ADMIN"');
    expect(blasts).toContain("if canSend {");
    expect(blasts).toContain('Label("New Blast", systemImage: "square.and.pencil")');
    expect(blasts).toContain("NavigationLink(value: SentBlastsRoute())");
    expect(blasts).toContain("SentBlastDetailView(id: route.id)");
  });

  it("lists waiting people first and confirms a cancel", () => {
    expect(compose).toContain('Section("Waiting · \\(detail.waiting.count)")');
    expect(compose).toContain('Button("Cancel Blast", role: .destructive) { Task { await cancel() } }');
  });

  it("lets staff message an event's crew from Event detail", () => {
    expect(event).toContain('Label("Message Crew…", systemImage: "megaphone")');
    expect(event).toContain("ComposeBlastSheet(lockedEvent: BlastEventChoice(event: event))");
  });
});

describe("iOS Browse tools", () => {
  const browse = source("ios/Wisconsin/Views/BrowseView.swift");
  const webTools = source("src/lib/web-tools.ts");

  it("lists every web tool and opens it in an in-app Safari view", () => {
    for (const href of webTools.match(/href: "(\/[a-z-]+)"/g) ?? []) {
      const path = href.replace('href: ', "");
      expect(browse).toContain(path);
    }
    expect(browse).toContain("InAppSafariView(url: tool.url)");
    expect(browse).toContain("AppEnvironment.activeAPIBaseURL.appendingPathComponent(path)");
  });
});
