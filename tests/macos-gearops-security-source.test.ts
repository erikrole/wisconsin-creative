import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("GearOps macOS security contracts", () => {
  it("uses an ephemeral cookie-free transport and bypasses URL cache", () => {
    const client = source("macos/GearOps/GearOpsClient.swift");

    expect(client).toContain("let configuration = URLSessionConfiguration.ephemeral");
    expect(client).toContain("sessionConfiguration?.protocolClasses");
    expect(client).toContain("configuration.protocolClasses = protocolClasses");
    expect(client).toContain("configuration.requestCachePolicy = .reloadIgnoringLocalCacheData");
    expect(client).toContain("configuration.urlCache = nil");
    expect(client).toContain("configuration.httpCookieStorage = nil");
    expect(client).toContain("configuration.httpShouldSetCookies = false");
    expect(client).toContain("configuration.httpCookieAcceptPolicy = .never");
    expect(client).toContain("configuration.urlCredentialStorage = nil");
    expect(client).toContain("request.cachePolicy = .reloadIgnoringLocalCacheData");
    expect(client).toContain('request.setValue("no-store", forHTTPHeaderField: "Cache-Control")');
    expect(client).not.toContain("HTTPCookieStorage.shared");
  });

  it("validates the revoke endpoint success contract and propagates failures", () => {
    const client = source("macos/GearOps/GearOpsClient.swift");
    const route = source("src/app/api/companion/devices/route.ts");
    const revoke = client.slice(
      client.indexOf("func revokeCompanion(credential: String) async throws {"),
      client.indexOf("private func makeRequest"),
    );

    expect(client).toContain("func revokeCompanion(credential: String) async throws");
    expect(route).toContain("return ok({ success: true });");
    expect(revoke).toContain("let response: SuccessResponse = try await perform(request)");
    expect(revoke).toContain("guard response.success else");
    expect(revoke).not.toContain("try?");
    expect(revoke).not.toContain("session.data(for:");
  });

  it("keeps transport errors neutral so callers own fallback messaging", () => {
    const client = source("macos/GearOps/GearOpsClient.swift");
    const messages = client.slice(client.indexOf("private static func networkMessage"));

    expect(messages).toContain("Check your connection and try again.");
    expect(messages).toContain("Wisconsin Creative timed out. Try again.");
    expect(messages).not.toContain("Showing the last");
  });

  it("stores active and pending credentials in the device-only data-protection keychain", () => {
    const store = source("macos/GearOps/CompanionCredentialStore.swift");

    expect(store).toContain("func deleteToken(ifMatching token: String)");
    expect(store).toContain("guard try loadToken() == token else { return }");
    expect(store).toContain('private let pendingRevocationsAccount = "pending-revocations"');
    expect(store).toContain("private let maxPendingRevocations = 16");
    expect(store).toContain("func stageTokenForRevocation(_ token: String)");
    expect(store).toContain("func loadPendingRevocations()");
    expect(store).toContain("func removePendingRevocation(_ token: String)");
    expect(store).toContain("JSONEncoder().encode(tokens)");
    expect(store).toContain("Array(pending.suffix(maxPendingRevocations))");
    expect(store).toContain("kSecUseDataProtectionKeychain as String");
    expect(store).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(store).toContain("loadData(account: tokenAccount, dataProtection: false)");
    expect(store).toContain("try? saveHardenedData(legacyData, account: tokenAccount)");
    expect(store).toContain("try? deleteItem(account: tokenAccount, dataProtection: false)");
    expect(store).not.toContain("kSecAttrAccessibleAlways");
  });

  it("enables Hardened Runtime only for the app Release configuration", () => {
    const spec = source("macos/project.yml");
    const project = source("macos/GearOps.xcodeproj/project.pbxproj");

    expect(spec).toMatch(/GearOps:[\s\S]*configs:\n\s+Release:\n\s+ENABLE_HARDENED_RUNTIME: "YES"/);
    expect(project).toContain("ENABLE_HARDENED_RUNTIME = YES;");
    expect(spec).not.toContain("ENABLE_APP_SANDBOX");
    expect(spec).not.toContain("com.apple.security.app-sandbox");
    expect(project).not.toContain("ENABLE_APP_SANDBOX = YES;");
  });
});
