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

  it("restores optimistic notification state and shows recovery UI", () => {
    const sheet = source("ios/Wisconsin/Views/NotificationsSheet.swift");

    expect(sheet).toContain("var actionError: String?");
    expect(sheet).toContain("let previous = notifications[idx]");
    expect(sheet).toContain("let previousUnreadCount = unreadCount");
    expect(sheet).toContain("notifications[restoreIdx] = previous");
    expect(sheet).toContain("notifications = previousNotifications");
    expect(sheet).toContain("actionError = \"Couldn't mark all notifications read. Your inbox was restored.\"");
    expect(sheet).toContain("BannerView(");
    expect(sheet).toContain("actionLabel: \"Refresh\"");
    expect(sheet).toContain("AccessibilityNotification.Announcement(actionError).post()");
    expect(sheet).toContain("actionLabel: \"Undo\"");
    expect(sheet).toContain("markNotificationsUnread(ids: ids)");
  });
});
