import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("native iOS role preview contract", () => {
  it("decodes the server-owned preview metadata without changing identity", () => {
    const models = source("ios/Wisconsin/Models/Models.swift");

    expect(models).toContain("struct RolePreviewInfo: Codable, Equatable");
    expect(models).toContain("let preview: RolePreviewInfo?");
    expect(models).toContain('preview?.actualRole == "ADMIN" && preview?.readOnly == true');
    expect(models).toContain("var shellIdentity: String");
  });

  it("reuses the signed web control route and refreshes /api/me", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const session = source("ios/Wisconsin/Core/SessionStore.swift");

    expect(api).toContain('request(path: "/api/admin/role-preview", method: "POST")');
    expect(api).toContain('role: "STUDENT"');
    expect(api).toContain('request(path: "/api/admin/role-preview", method: "DELETE")');
    expect(session).toContain("func startStudentRolePreview() async");
    expect(session).toContain("func stopRolePreview() async");
    expect(session).toContain("let user = try await APIClient.shared.me()");
    expect(session).toContain("self.publishCurrentUserIfChanged(user)");
  });

  it("keeps the native control Admin-only and exposes an exit path", () => {
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(settings).toContain('session.currentUser?.role == "ADMIN" && session.currentUser?.preview == nil');
    expect(settings).toContain("Preview as Student");
    expect(settings).toContain("session.stopRolePreview()");
    expect(tabs).toContain("Previewing as \\(preview.roleLabel) · Read-only");
    expect(tabs).toContain("session.stopRolePreview()");
  });

  it("remounts the shell and suppresses preview-time background writes", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(app).toContain(".id(user.shellIdentity)");
    expect(app).toContain("if user.isReadOnlyRolePreview");
    expect(app).toContain("!user.isReadOnlyRolePreview else { return }");
    expect(app).toContain("!user.isReadOnlyRolePreview");
    expect(app).toContain("let isReadOnlyPreview = user?.isReadOnlyRolePreview == true");
    expect(app).toContain("CheckoutReturnLiveActivityManager.shared.cancelObserverWork()");
    expect(app).toContain('recordProductEvent(eventName: "app_opened", surface: "home")');
    expect(tabs).toContain("isReadOnlyPreview");
    expect(tabs).toContain("guard hasCapability(\"RESERVATION_CREATE\"), !isReadOnlyPreview else { return }");
    expect(tabs).toContain("isReadOnlyPreview: Bool = false");
  });
});
