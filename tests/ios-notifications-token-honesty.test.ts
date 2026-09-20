import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function methodBody(text: string, name: string, nextName: string) {
  const start = text.indexOf(`func ${name}`);
  const end = text.indexOf(`func ${nextName}`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("iOS APNs device token honesty", () => {
  it("/api/devices returns a success envelope for register and revoke", () => {
    const route = source("src/app/api/devices/route.ts");

    expect(route).toContain("export const POST = withAuth");
    expect(route).toContain("export const DELETE = withAuth");
    expect(route.match(/return ok\(\{ success: true \}\);/g)).toHaveLength(2);
  });

  it("native token register/revoke use the shared API handler", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const register = methodBody(apiClient, "registerDeviceToken", "revokeAllDeviceTokens");
    const revoke = methodBody(apiClient, "revokeAllDeviceTokens", "me");

    expect(register).toContain("request(path: \"/api/devices\", method: \"POST\")");
    expect(register).toContain("let _: SuccessResponse = try await perform(req)");
    expect(register).not.toContain("session.data(for: req)");

    expect(revoke).toContain("request(path: \"/api/devices\", method: \"DELETE\")");
    expect(revoke).toContain("let _: SuccessResponse = try await perform(req)");
    expect(revoke).not.toContain("session.data(for: req)");
  });

  it("persists the current installation token for device-specific self-test", () => {
    const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");
    const route = source("src/app/api/devices/test/route.ts");

    expect(delegate).toContain('static let currentTokenKey = "WisconsinCurrentAPNsToken"');
    expect(delegate).toContain("UserDefaults.standard.set(hex, forKey: PushTokenStorage.currentTokenKey)");
    expect(detail).toContain("@AppStorage(PushTokenStorage.currentTokenKey) private var currentPushToken");
    expect(route).toContain("testPushSchema.parse(await req.json())");
    expect(route).toContain("where: { userId: user.id, token: body.token, revokedAt: null }");
  });

  it("shared perform remains the central 401 session-expiry path", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const perform = apiClient.slice(apiClient.indexOf("private func perform"));
    const broadcaster = apiClient.slice(
      apiClient.indexOf("private func broadcastSessionExpiry"),
      apiClient.indexOf("private func perform"),
    );

    expect(perform).toContain("case 401:");
    expect(perform).toContain("broadcastSessionExpiry(for: requestBoundary)");
    expect(perform).not.toContain("NotificationCenter.default.post(name: .sessionDidExpire");
    expect(apiClient).toContain("let requestBoundary = authSessionBoundary.capture()");
    expect(broadcaster).toContain("NotificationCenter.default.post(");
    expect(broadcaster).toContain("name: .sessionDidExpire");
    expect(broadcaster).toContain("object: requestBoundary");
    expect(broadcaster).not.toContain("object: nil");
    expect(apiClient).toContain("private struct SuccessResponse: Decodable");
  });
});
