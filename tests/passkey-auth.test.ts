import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  passkeyCredential: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  passkeyChallenge: {
    deleteMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
}));

const cookieState = vi.hoisted(() => ({ value: "ceremony-token" as string | undefined }));
const cookieApi = vi.hoisted(() => ({
  get: vi.fn(() => (cookieState.value ? { value: cookieState.value } : undefined)),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieApi) }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/env", () => ({
  env: {
    sessionCookieName: "app_session",
    trustedOrigins: ["https://app.example.com"],
    passkeyRpName: "Wisconsin Creative",
    passkeyRpId: "app.example.com",
    passkeyOrigins: ["https://app.example.com"],
  },
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireKiosk: vi.fn(),
  createSession: vi.fn(),
  randomHex: vi.fn(() => "raw-ceremony-token"),
  tokenHash: vi.fn(async (value: string) => `hash:${value}`),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
  enforceRateLimit: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/collaborator-access", () => ({
  capabilitiesForActor: vi.fn(() => []),
  collaboratorPolicyMetadataForActor: vi.fn(() => null),
  compatibilityCollaboratorProfile: vi.fn((_, value) => value ?? null),
  requireActiveCollaboratorPolicy: vi.fn(),
}));
vi.mock("@/lib/services/collaborator-policies", () => ({ collaboratorPolicyActorSelect: {} }));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { requireAuth, createSession, verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { POST as registrationOptions } from "@/app/api/auth/passkey/registration/options/route";
import { POST as registrationVerify } from "@/app/api/auth/passkey/registration/verify/route";
import { POST as loginVerify } from "@/app/api/auth/passkey/login/verify/route";
import { DELETE as revokePasskey } from "@/app/api/me/passkeys/[id]/route";

const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User One",
  role: Role.STAFF,
  affiliation: null,
  collaboratorProfile: null,
  staffingType: "FT" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

function request(
  path: string,
  body: Record<string, unknown>,
  method = "POST",
  extraHeaders: Record<string, string> = {},
) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "x-forwarded-for": "127.0.0.1",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

const REGISTRATION_RESPONSE = {
  id: "credential-public-id",
  rawId: "credential-public-id",
  type: "public-key",
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation-object",
    transports: ["internal"],
  },
};

function mockVerifiedRegistration() {
  dbMock.passkeyChallenge.findUnique.mockResolvedValue({
    id: "challenge-1",
    challenge: "registration-challenge",
    type: "REGISTRATION",
    userId: "user-1",
    rememberMe: false,
    expiresAt: new Date(Date.now() + 60_000),
  });
  dbMock.passkeyChallenge.deleteMany.mockResolvedValue({ count: 1 });
  vi.mocked(verifyRegistrationResponse).mockResolvedValue({
    verified: true,
    registrationInfo: {
      fmt: "none",
      aaguid: "00000000-0000-0000-0000-000000000000",
      credential: {
        id: "credential-public-id",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
      credentialType: "public-key",
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
      origin: "https://app.example.com",
      rpID: "app.example.com",
    },
  });
  dbMock.passkeyCredential.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "credential-1",
      createdAt: new Date("2026-08-23T00:00:00.000Z"),
      ...data,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieState.value = "ceremony-token";
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 });
  vi.mocked(verifyPassword).mockResolvedValue(true);
  dbMock.user.findUnique.mockResolvedValue({ passwordHash: "password-hash" });
  dbMock.passkeyCredential.findMany.mockResolvedValue([]);
  dbMock.passkeyChallenge.deleteMany.mockResolvedValue({ count: 0 });
  dbMock.passkeyChallenge.create.mockResolvedValue({ id: "challenge-1" });
  vi.mocked(generateRegistrationOptions).mockResolvedValue({
    challenge: "registration-challenge",
    rp: { name: "Wisconsin Creative", id: "app.example.com" },
    user: { id: "dXNlci0x", name: user.email, displayName: user.name },
    pubKeyCredParams: [],
  } as never);
  dbMock.$transaction.mockImplementation(async (callback: (tx: typeof dbMock) => Promise<unknown>) => callback(dbMock));
  dbMock.passkeyChallenge.findUnique.mockResolvedValue({
    id: "challenge-1",
    challenge: "authentication-challenge",
    type: "AUTHENTICATION",
    userId: null,
    rememberMe: true,
    expiresAt: new Date(Date.now() + 60_000),
  });
  dbMock.passkeyCredential.findUnique.mockResolvedValue({
    id: "credential-1",
    credentialId: "credential-public-id",
    userId: "user-1",
    publicKey: Buffer.from([1, 2, 3]),
    counter: 4,
    transports: ["internal"],
    deviceType: "singleDevice",
    backedUp: false,
  });
  dbMock.passkeyCredential.updateMany.mockResolvedValue({ count: 1 });
  dbMock.passkeyCredential.deleteMany.mockResolvedValue({ count: 1 });
  vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
    verified: true,
    authenticationInfo: {
      credentialID: "credential-public-id",
      newCounter: 5,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "https://app.example.com",
      rpID: "app.example.com",
    },
  });
});

describe("passkey authentication", () => {
  it("requires current-password reauthentication before starting enrollment", async () => {
    const response = await registrationOptions(
      request("/api/auth/passkey/registration/options", { currentPassword: "correct-password" }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(Role.STAFF, "user", "edit_self");
    expect(verifyPassword).toHaveBeenCalledWith("password-hash", "correct-password");
    expect(dbMock.passkeyChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challenge: "registration-challenge",
        type: "REGISTRATION",
        userId: "user-1",
      }),
    });
    expect(cookieApi.set).toHaveBeenCalledWith(
      "passkey_ceremony",
      "raw-ceremony-token",
      expect.objectContaining({ httpOnly: true, maxAge: 300 }),
    );
  });

  it("does not create an enrollment ceremony when reauthentication fails", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await registrationOptions(
      request("/api/auth/passkey/registration/options", { currentPassword: "wrong-password" }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(400);
    expect(requirePermission).toHaveBeenCalledWith(Role.STAFF, "user", "edit_self");
    expect(dbMock.passkeyChallenge.create).not.toHaveBeenCalled();
  });

  it("returns an actionable conflict and retires the ceremony for a duplicate credential", async () => {
    dbMock.passkeyChallenge.findUnique.mockResolvedValue({
      id: "challenge-1",
      challenge: "registration-challenge",
      type: "REGISTRATION",
      userId: "user-1",
      rememberMe: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    dbMock.passkeyChallenge.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: "none",
        aaguid: "00000000-0000-0000-0000-000000000000",
        credential: {
          id: "credential-public-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialType: "public-key",
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin: "https://app.example.com",
        rpID: "app.example.com",
      },
    });
    dbMock.passkeyCredential.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["credential_id"] },
      }),
    );

    const response = await registrationVerify(
      request("/api/auth/passkey/registration/verify", {
        response: {
          id: "credential-public-id",
          rawId: "credential-public-id",
          type: "public-key",
          response: {
            clientDataJSON: "client-data",
            attestationObject: "attestation-object",
            transports: ["internal"],
          },
        },
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "This passkey is already registered." });
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: "registration-challenge",
      expectedOrigin: ["https://app.example.com"],
      expectedRPID: "app.example.com",
      requireUserVerification: true,
    }));
    expect(requirePermission).toHaveBeenCalledWith(Role.STAFF, "user", "edit_self");
    expect(dbMock.passkeyChallenge.deleteMany).toHaveBeenLastCalledWith({ where: { id: "challenge-1" } });
    expect(cookieApi.delete).toHaveBeenCalledWith("passkey_ceremony");
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("names an unnamed credential after the client that enrolled it", async () => {
    mockVerifiedRegistration();

    const response = await registrationVerify(
      request("/api/auth/passkey/registration/verify", { response: REGISTRATION_RESPONSE }, "POST", {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(201);
    expect(dbMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Chrome on macOS", userId: "user-1" }),
    });
    await expect(response.json()).resolves.toMatchObject({ data: { name: "Chrome on macOS" } });
  });

  it("keeps a name the person typed", async () => {
    mockVerifiedRegistration();

    const response = await registrationVerify(
      request(
        "/api/auth/passkey/registration/verify",
        { response: REGISTRATION_RESPONSE, name: "  Front desk iPad  " },
        "POST",
        { "user-agent": "WisconsinApp/1.0 iOS" },
      ),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(201);
    expect(dbMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Front desk iPad" }),
    });
  });

  it("permission-gates and password-protects owned passkey revocation", async () => {
    const response = await revokePasskey(
      request("/api/me/passkeys/credential-1", { currentPassword: "correct-password" }, "DELETE"),
      { params: Promise.resolve({ id: "credential-1" }) },
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(Role.STAFF, "user", "edit_self");
    expect(verifyPassword).toHaveBeenCalledWith("password-hash", "correct-password");
    expect(dbMock.passkeyCredential.deleteMany).toHaveBeenCalledWith({
      where: { id: "credential-1", userId: "user-1" },
    });
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      entityId: "credential-1",
      action: "passkey_revoked",
    }));
  });

  it("verifies a discoverable assertion and issues the normal session", async () => {
    dbMock.passkeyChallenge.deleteMany.mockResolvedValueOnce({ count: 1 });
    dbMock.user.findUnique.mockResolvedValue({ ...user, active: true, collaboratorPolicy: null });

    const response = await loginVerify(
      request("/api/auth/passkey/login/verify", {
        response: {
          id: "credential-public-id",
          rawId: "credential-public-id",
          type: "public-key",
          response: {
            clientDataJSON: "client-data",
            authenticatorData: "authenticator-data",
            signature: "signature",
          },
        },
      }),
      { params: Promise.resolve({}) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.id).toBe("user-1");
    expect(createSession).toHaveBeenCalledWith("user-1", true);
    expect(dbMock.passkeyCredential.updateMany).toHaveBeenCalledWith({
      where: { id: "credential-1", counter: 4 },
      data: expect.objectContaining({ counter: 5 }),
    });
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: "authentication-challenge",
      expectedOrigin: ["https://app.example.com"],
      expectedRPID: "app.example.com",
      requireUserVerification: true,
    }));
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_login" }));
  });

  it("rejects a valid assertion when its owning user is inactive", async () => {
    dbMock.user.findUnique.mockResolvedValue({ ...user, active: false, collaboratorPolicy: null });

    const response = await loginVerify(
      request("/api/auth/passkey/login/verify", {
        response: {
          id: "credential-public-id",
          rawId: "credential-public-id",
          type: "public-key",
          response: { clientDataJSON: "client-data", authenticatorData: "authenticator-data", signature: "signature" },
        },
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
    expect(dbMock.passkeyChallenge.deleteMany).not.toHaveBeenCalled();
    expect(dbMock.passkeyCredential.updateMany).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not accept a ceremony that has already been consumed", async () => {
    dbMock.passkeyChallenge.deleteMany.mockResolvedValueOnce({ count: 0 });

    const response = await loginVerify(
      request("/api/auth/passkey/login/verify", {
        response: {
          id: "credential-public-id",
          rawId: "credential-public-id",
          type: "public-key",
          response: { clientDataJSON: "client-data", authenticatorData: "authenticator-data", signature: "signature" },
        },
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });
});
