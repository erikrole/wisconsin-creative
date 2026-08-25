import { describe, expect, it } from "vitest";
import { COLLABORATOR_CAPABILITIES } from "@/lib/collaborator-access";
import {
  createRolePreviewState,
  decodeRolePreview,
  encodeRolePreview,
  isRolePreviewBlockedRequest,
  rolePreviewCollaboratorPolicyMetadata,
} from "@/lib/role-preview";

describe("role preview policy", () => {
  it("creates the three supported presets and gives collaborator preview its reviewed capabilities", () => {
    expect(createRolePreviewState("STAFF", 1)).toEqual({
      role: "STAFF",
      capabilities: [],
      expiresAt: 1 + 2 * 60 * 60 * 1000,
    });
    expect(createRolePreviewState("STUDENT", 1).capabilities).toEqual([]);
    expect(createRolePreviewState("COLLABORATOR", 1).capabilities).toEqual([...COLLABORATOR_CAPABILITIES]);
    expect(createRolePreviewState("COLLABORATOR", 1).collaboratorAffiliation).toBe("BIG_TEN_NETWORK");
    expect(rolePreviewCollaboratorPolicyMetadata("LEARFIELD")).toEqual(expect.objectContaining({
      displayName: "Learfield",
      badgeLabel: "Learfield",
    }));
  });

  it("allows reads and preview controls but blocks mutations and protected file flows", () => {
    const request = (pathname: string, method = "GET") =>
      new Request(`https://app.example.com${pathname}`, { method });

    expect(isRolePreviewBlockedRequest(request("/api/items"))).toBe(false);
    expect(isRolePreviewBlockedRequest(request("/api/admin/role-preview", "POST"))).toBe(false);
    expect(isRolePreviewBlockedRequest(request("/api/admin/role-preview", "DELETE"))).toBe(false);
    expect(isRolePreviewBlockedRequest(request("/api/auth/logout", "POST"))).toBe(false);
    expect(isRolePreviewBlockedRequest(request("/api/items", "POST"))).toBe(true);
    expect(isRolePreviewBlockedRequest(request("/api/items/export?format=csv"))).toBe(true);
    expect(isRolePreviewBlockedRequest(request("/api/signatures/artifacts/revision/svg"))).toBe(true);
    expect(isRolePreviewBlockedRequest(request("/api/collections/1/download"))).toBe(true);
    expect(isRolePreviewBlockedRequest(request("/api/shifts/ics/token-1"))).toBe(true);
  });

  it("round-trips a signed state and rejects tampering or expiry", async () => {
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "role-preview-test-secret-01234567890123456789";
    try {
      const state = createRolePreviewState("STUDENT", 1_000);
      const encoded = await encodeRolePreview(state);
      const [payload, signature] = encoded.split(".");
      if (!payload || !signature) throw new Error("Expected a signed preview payload");
      const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

      await expect(decodeRolePreview(encoded, 1_000)).resolves.toEqual(state);
      await expect(decodeRolePreview(`${tamperedPayload}.${signature}`, 1_000)).resolves.toBeNull();
      await expect(decodeRolePreview(encoded, state.expiresAt)).resolves.toBeNull();
    } finally {
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
    }
  });
});
