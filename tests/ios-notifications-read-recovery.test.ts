import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS notifications read recovery", () => {
  it("treats notification read API failures as real errors", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

    expect(apiClient).toContain("func markNotificationRead(id: String) async throws");
    expect(apiClient).toContain("let _: SuccessResponse = try await perform(req)");
    expect(apiClient).not.toContain("func markNotificationRead(id: String) async throws {\n        struct Body: Encodable { let action: String; let id: String }\n        var req = request(path: \"/api/notifications\", method: \"PATCH\")\n        req.httpBody = try JSONEncoder().encode(Body(action: \"mark_read\", id: id))\n        let (_, _) = try await session.data(for: req)\n    }");
    expect(apiClient).toContain("private struct SuccessResponse: Decodable");
  });

  it("serializes read actions and reconciles uncertain responses", () => {
    const sheet = source("ios/Wisconsin/Views/NotificationsSheet.swift");
    expect(sheet).toContain("var isMutating = false");
    expect(sheet).toContain("guard !isMutating, !isLoading");
    expect(sheet).toContain("await reconcileReadFailure()");
    expect(sheet).toContain("await load(forceRefresh: true)");
    expect(sheet).not.toContain("notifications = previousNotifications");
    expect(sheet).not.toContain("unreadCount = previousUnreadCount");
    expect(sheet).toContain("authSessionBoundary.owns(sessionBoundary)");
    expect(sheet).toContain("await sharedAppState?.refreshUnread()");
    expect(sheet).toContain('actionLabel: "Refresh"');
    expect(sheet).toContain("AccessibilityNotification.Announcement(actionError).post()");
    expect(sheet).toContain('actionLabel: "Undo"');
    expect(sheet).toContain("stride(from: 0, to: ids.count, by: 500)");
  });

  it("preserves cached rows with visible failures and independent paging offsets", () => {
    const sheet = source("ios/Wisconsin/Views/NotificationsSheet.swift");
    expect(sheet).toContain("if vm.error != nil, !vm.notifications.isEmpty");
    expect(sheet).toContain("Showing the last loaded inbox.");
    expect(sheet).toContain("let offset = nextOffset");
    expect(sheet).toContain("!existingIDs.contains($0.id)");
    expect(sheet).toContain("nextOffset = offset + resp.data.count");
    expect(sheet).toContain(".safeAreaInset(edge: .top");
    expect(sheet).toContain("sharedAppState?.pendingPushBlastId = blastId");
  });
});
