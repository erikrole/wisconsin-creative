import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Settings Security web account deletion", () => {
  it("exposes password-reauthenticated delete account against DELETE /api/me/account", () => {
    const security = source("src/app/(app)/settings/security/page.tsx");
    const route = source("src/app/api/me/account/route.ts");

    expect(security).toContain('id="account"');
    expect(security).toContain("Delete account");
    expect(security).toContain('fetch("/api/me/account"');
    expect(security).toContain('method: "DELETE"');
    expect(security).toContain('confirmation: "DELETE"');
    expect(security).toContain("currentPassword: deletePassword");
    expect(security).toContain("Permanently delete this account?");
    expect(security).toContain("return any checked-out gear first");
    expect(security).toContain('router.replace("/login")');
    expect(security).toContain("deletingRef");
    expect(security).toContain('deleteConfirmation !== "DELETE"');

    expect(route).toContain('action: "account_self_deleted"');
    expect(route).toContain("erasePersonalData: true");
    expect(route).toContain('confirmation: z.literal("DELETE")');
  });
});
