import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  verifyPassword: vi.fn(),
  createSession: vi.fn(),
  checkRateLimit: vi.fn(),
  createAuditEntry: vi.fn(),
  refreshProjection: vi.fn(),
  issueCompanionSession: vi.fn(),
  getCompanionUserEpoch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUser } },
}));

vi.mock("@/lib/auth", () => ({
  verifyPassword: mocks.verifyPassword,
  createSession: mocks.createSession,
  requireAuth: vi.fn(),
  requireKiosk: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: mocks.createAuditEntry,
}));

vi.mock("@/lib/collaborator-access", () => ({
  capabilitiesForActor: () => [],
  collaboratorPolicyMetadataForActor: () => null,
  compatibilityCollaboratorProfile: () => null,
  requireActiveCollaboratorPolicy: vi.fn(),
}));

vi.mock("@/lib/services/collaborator-policies", () => ({
  collaboratorPolicyActorSelect: {},
}));

vi.mock("@/lib/companion-store", () => ({
  issueCompanionSession: mocks.issueCompanionSession,
  getCompanionUserEpoch: mocks.getCompanionUserEpoch,
}));

vi.mock("@/lib/services/companion-projection", () => ({
  refreshCompanionProjection: mocks.refreshProjection,
}));

vi.mock("@/lib/companion-projection-contract", () => ({
  projectionForRole: vi.fn((projection) => projection),
}));

import { POST } from "@/app/api/auth/login/route";

describe("companion login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.getCompanionUserEpoch.mockResolvedValue(7);
    mocks.refreshProjection.mockResolvedValue({ revision: 12 });
    mocks.issueCompanionSession.mockResolvedValue("companion-token");
    mocks.findUser.mockResolvedValue({
      id: "user-1",
      name: "Erik Role",
      email: "erik@wisc.edu",
      passwordHash: "hash",
      role: "ADMIN",
      active: true,
      forcePasswordChange: true,
      affiliation: null,
      collaboratorProfile: null,
      staffingType: null,
      collaboratorPolicy: null,
    });
  });

  it("revalidates account authority and epoch before issuing a credential", async () => {
    const initialUser = {
      id: "user-1",
      name: "Erik Role",
      email: "erik@wisc.edu",
      passwordHash: "hash",
      role: "ADMIN",
      active: true,
      forcePasswordChange: false,
      affiliation: null,
      collaboratorProfile: null,
      staffingType: null,
      collaboratorPolicy: null,
    };
    mocks.findUser
      .mockResolvedValueOnce(initialUser)
      .mockResolvedValueOnce({
        passwordHash: "hash",
        role: "ADMIN",
        active: true,
        forcePasswordChange: false,
      });

    const response = await POST(
      new Request("https://wisconsincreative.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "erik@wisc.edu",
          password: "password123",
          companion: true,
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getCompanionUserEpoch).toHaveBeenCalledWith("user-1");
    expect(mocks.issueCompanionSession).toHaveBeenCalledWith(initialUser, 7);
  });

  it("does not issue when account authority changes during projection work", async () => {
    mocks.findUser
      .mockResolvedValueOnce({
        id: "user-1",
        name: "Erik Role",
        email: "erik@wisc.edu",
        passwordHash: "old-hash",
        role: "ADMIN",
        active: true,
        forcePasswordChange: false,
        affiliation: null,
        collaboratorProfile: null,
        staffingType: null,
        collaboratorPolicy: null,
      })
      .mockResolvedValueOnce({
        passwordHash: "new-hash",
        role: "STAFF",
        active: true,
        forcePasswordChange: false,
      });

    const response = await POST(
      new Request("https://wisconsincreative.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "erik@wisc.edu",
          password: "password123",
          companion: true,
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(409);
    expect(mocks.issueCompanionSession).not.toHaveBeenCalled();
  });

  it("rejects forced-password enrollment before projection refresh or token issue", async () => {
    const response = await POST(
      new Request("https://wisconsincreative.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "erik@wisc.edu",
          password: "password123",
          companion: true,
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Change your password in Wisconsin Creative before enrolling this companion.",
    });
    expect(mocks.refreshProjection).not.toHaveBeenCalled();
    expect(mocks.issueCompanionSession).not.toHaveBeenCalled();
    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).toHaveBeenCalledWith("hash", "password123");
  });

  it("checks the supplied password before disclosing the forced-change state", async () => {
    mocks.verifyPassword.mockResolvedValue(false);

    const response = await POST(
      new Request("https://wisconsincreative.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "erik@wisc.edu",
          password: "wrong-password",
          companion: true,
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid credentials" });
    expect(mocks.verifyPassword).toHaveBeenCalledWith("hash", "wrong-password");
    expect(mocks.refreshProjection).not.toHaveBeenCalled();
    expect(mocks.issueCompanionSession).not.toHaveBeenCalled();
    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
  });
});
