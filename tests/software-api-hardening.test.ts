import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ...(() => {
    const softwareCredential = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    const licenseCode = {
      findMany: vi.fn(),
    };
    const tx = { softwareCredential };
    return {
      db: {
        softwareCredential,
        licenseCode,
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        _mockTx: tx,
      },
    };
  })(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 20, windowMs: 60_000 },
}));

vi.mock("@/lib/services/notifications", () => ({
  sendPushToUser: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { checkRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { encryptSoftwareSecret } from "@/lib/software-vault-crypto";
import { GET as GET_SOFTWARE, POST as POST_SOFTWARE } from "@/app/api/software/route";
import { DELETE as DELETE_SOFTWARE, PATCH as PATCH_SOFTWARE } from "@/app/api/software/[id]/route";
import { POST as POST_SOFTWARE_SECRET } from "@/app/api/software/[id]/secret/route";
import { GET as GET_LICENSES } from "@/app/api/licenses/route";

type MockFn = ReturnType<typeof vi.fn>;
type SoftwareTxMock = {
  softwareCredential: Record<"findMany" | "findUnique" | "create" | "update", MockFn>;
};

const softwareTx = (db as unknown as { _mockTx: SoftwareTxMock })._mockTx;
const transactionMock = db.$transaction as unknown as MockFn;
const licenseFindManyMock = db.licenseCode.findMany as unknown as MockFn;
const originalVaultKey = process.env.SOFTWARE_VAULT_KEY;

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@example.com",
  name: "Student User",
  role: "STUDENT" as const,
  avatarUrl: null,
};

const originalMetadata = {
  id: "software-1",
  name: "Motion Array",
  category: "Video",
  websiteUrl: "https://motionarray.com",
  visibleTo: ["STAFF", "STUDENT"] as const,
  archivedAt: null,
  updatedAt: new Date("2026-08-19T15:00:00.000Z"),
};

const updatedMetadata = {
  ...originalMetadata,
  name: "Motion Array Teams",
  visibleTo: ["STAFF"] as const,
  updatedAt: new Date("2026-08-19T16:00:00.000Z"),
};

const noParams = { params: Promise.resolve({}) };
const softwareParams = { params: Promise.resolve({ id: "software-1" }) };

function request(path: string, method: string, body?: Record<string, unknown>, includeOrigin = true) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(includeOrigin ? { origin: "https://app.example.com" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function serializableConflict() {
  return new Prisma.PrismaClientKnownRequestError("Serializable conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

beforeEach(() => {
  process.env.SOFTWARE_VAULT_KEY = Buffer.alloc(32, 7).toString("base64");
  vi.clearAllMocks();
  for (const method of Object.values(softwareTx.softwareCredential)) method.mockReset();
  licenseFindManyMock.mockReset();
  transactionMock.mockReset();
  transactionMock.mockImplementation(async (fn: (client: SoftwareTxMock) => Promise<unknown>) => fn(softwareTx));
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 });
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  vi.mocked(createAuditEntryTx).mockResolvedValue(undefined);
});

afterAll(() => {
  if (originalVaultKey === undefined) delete process.env.SOFTWARE_VAULT_KEY;
  else process.env.SOFTWARE_VAULT_KEY = originalVaultKey;
});

describe("software credential transaction boundaries", () => {
  it("commits create metadata and a secret-free audit in one serializable transaction", async () => {
    softwareTx.softwareCredential.create.mockResolvedValue(originalMetadata);
    const accountEmail = "shared-login@example.com";
    const password = "credential-secret-sentinel";

    const response = await POST_SOFTWARE(request("/api/software", "POST", {
      name: originalMetadata.name,
      category: originalMetadata.category,
      websiteUrl: originalMetadata.websiteUrl,
      accountEmail,
      password,
      visibleTo: [...originalMetadata.visibleTo],
    }), noParams);

    expect(response.status).toBe(201);
    expect(enforceRateLimit).toHaveBeenCalledWith("software:write:admin-1", expect.any(Object));
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    const createData = softwareTx.softwareCredential.create.mock.calls[0]?.[0]?.data;
    expect(createData.accountEmailCiphertext).not.toContain(accountEmail);
    expect(createData.passwordCiphertext).not.toContain(password);
    expect(createAuditEntryTx).toHaveBeenCalledWith(softwareTx, expect.objectContaining({
      actorId: adminUser.id,
      actorRole: adminUser.role,
      entityId: originalMetadata.id,
      action: "create",
    }));
    const auditPayload = vi.mocked(createAuditEntryTx).mock.calls[0]?.[1];
    expect(JSON.stringify(auditPayload)).not.toContain(accountEmail);
    expect(JSON.stringify(auditPayload)).not.toContain(password);
    expect(auditPayload?.after).toEqual(expect.objectContaining({
      name: originalMetadata.name,
      category: originalMetadata.category,
      visibleTo: [...originalMetadata.visibleTo],
      accountEmailStored: true,
      passwordStored: true,
    }));
  });

  it("does not report create success when the transactional audit write fails", async () => {
    softwareTx.softwareCredential.create.mockResolvedValue(originalMetadata);
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(new Error("audit unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST_SOFTWARE(request("/api/software", "POST", {
      name: originalMetadata.name,
      accountEmail: "shared-login@example.com",
      password: "credential-secret-sentinel",
    }), noParams);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(createAuditEntryTx).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("returns a specific conflict when create loses the unique-name race", async () => {
    softwareTx.softwareCredential.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["name"] } },
    ));

    const response = await POST_SOFTWARE(request("/api/software", "POST", {
      name: originalMetadata.name,
      accountEmail: "shared-login@example.com",
      password: "credential-secret-sentinel",
    }), noParams);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A software login with that name already exists." });
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("audits update before/after metadata without logging replaced secrets", async () => {
    softwareTx.softwareCredential.findUnique.mockResolvedValue(originalMetadata);
    softwareTx.softwareCredential.update.mockResolvedValue(updatedMetadata);
    const replacementPassword = "replacement-secret-sentinel";

    const response = await PATCH_SOFTWARE(request("/api/software/software-1", "PATCH", {
      name: updatedMetadata.name,
      password: replacementPassword,
      visibleTo: [...updatedMetadata.visibleTo],
    }), softwareParams);

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    const auditPayload = vi.mocked(createAuditEntryTx).mock.calls[0]?.[1];
    expect(auditPayload).toEqual(expect.objectContaining({
      action: "update",
      before: expect.objectContaining({
        name: originalMetadata.name,
        visibleTo: [...originalMetadata.visibleTo],
      }),
      after: expect.objectContaining({
        name: updatedMetadata.name,
        visibleTo: [...updatedMetadata.visibleTo],
        passwordChanged: true,
      }),
    }));
    expect(JSON.stringify(auditPayload)).not.toContain(replacementPassword);
  });

  it("archives the record and its before/after evidence atomically", async () => {
    const archivedAt = new Date("2026-08-19T17:00:00.000Z");
    softwareTx.softwareCredential.findUnique.mockResolvedValue(originalMetadata);
    softwareTx.softwareCredential.update.mockResolvedValue({
      ...originalMetadata,
      archivedAt,
      updatedAt: archivedAt,
    });

    const response = await DELETE_SOFTWARE(
      request("/api/software/software-1", "DELETE"),
      softwareParams,
    );

    expect(response.status).toBe(200);
    expect(createAuditEntryTx).toHaveBeenCalledWith(softwareTx, expect.objectContaining({
      action: "archive",
      before: expect.objectContaining({ archivedAt: null }),
      after: expect.objectContaining({ archivedAt: archivedAt.toISOString() }),
    }));
  });

  it("rejects empty and unknown-field mutations before opening a transaction", async () => {
    const emptyPatch = await PATCH_SOFTWARE(
      request("/api/software/software-1", "PATCH", {}),
      softwareParams,
    );
    const unknownCreate = await POST_SOFTWARE(request("/api/software", "POST", {
      name: originalMetadata.name,
      accountEmail: "shared-login@example.com",
      password: "credential-secret-sentinel",
      unexpected: true,
    }), noParams);

    expect(emptyPatch.status).toBe(400);
    expect(unknownCreate.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("software credential read boundaries", () => {
  it("does not load password ciphertext for list responses", async () => {
    const accountEmail = "shared-login@example.com";
    softwareTx.softwareCredential.findMany.mockResolvedValue([{
      ...originalMetadata,
      accountEmailCiphertext: encryptSoftwareSecret(accountEmail),
    }]);

    const response = await GET_SOFTWARE(
      new Request("https://app.example.com/api/software?includeArchived=1"),
      noParams,
    );

    expect(response.status).toBe(200);
    const query = softwareTx.softwareCredential.findMany.mock.calls[0]?.[0];
    expect(query.select.passwordCiphertext).toBeUndefined();
    const body = await response.json();
    expect(body.data[0]).toEqual(expect.objectContaining({
      accountEmail,
      hasPassword: true,
    }));
    expect(JSON.stringify(body)).not.toContain("Ciphertext");
  });

  it("returns a password only after its read and audit commit together", async () => {
    const password = "credential-secret-sentinel";
    softwareTx.softwareCredential.findUnique.mockResolvedValue({
      id: originalMetadata.id,
      name: originalMetadata.name,
      archivedAt: null,
      passwordCiphertext: encryptSoftwareSecret(password),
      visibleTo: [...originalMetadata.visibleTo],
    });

    const response = await POST_SOFTWARE_SECRET(
      request("/api/software/software-1/secret", "POST"),
      softwareParams,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { password } });
    expect(checkRateLimit).toHaveBeenCalledWith("software:reveal:admin-1", expect.any(Object));
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    const auditPayload = vi.mocked(createAuditEntryTx).mock.calls[0]?.[1];
    expect(auditPayload).toEqual(expect.objectContaining({ action: "reveal_password" }));
    expect(JSON.stringify(auditPayload)).not.toContain(password);
  });

  it("never returns the password when the reveal audit fails", async () => {
    const password = "credential-secret-sentinel";
    softwareTx.softwareCredential.findUnique.mockResolvedValue({
      id: originalMetadata.id,
      name: originalMetadata.name,
      archivedAt: null,
      passwordCiphertext: encryptSoftwareSecret(password),
      visibleTo: [...originalMetadata.visibleTo],
    });
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(new Error("audit unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST_SOFTWARE_SECRET(
      request("/api/software/software-1/secret", "POST"),
      softwareParams,
    );
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(password);
    consoleError.mockRestore();
  });

  it("retries a concurrent archive and refuses the now-archived secret", async () => {
    const password = "credential-secret-sentinel";
    softwareTx.softwareCredential.findUnique
      .mockResolvedValueOnce({
        id: originalMetadata.id,
        name: originalMetadata.name,
        archivedAt: null,
        passwordCiphertext: encryptSoftwareSecret(password),
        visibleTo: [...originalMetadata.visibleTo],
      })
      .mockResolvedValueOnce({
        id: originalMetadata.id,
        name: originalMetadata.name,
        archivedAt: new Date("2026-08-19T17:00:00.000Z"),
        passwordCiphertext: encryptSoftwareSecret(password),
        visibleTo: [...originalMetadata.visibleTo],
      });
    transactionMock.mockImplementationOnce(async (fn: (client: SoftwareTxMock) => Promise<unknown>) => {
      await fn(softwareTx);
      throw serializableConflict();
    });

    const response = await POST_SOFTWARE_SECRET(
      request("/api/software/software-1/secret", "POST"),
      softwareParams,
    );
    const responseText = await response.text();

    expect(response.status).toBe(404);
    expect(responseText).not.toContain(password);
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(softwareTx.softwareCredential.findUnique).toHaveBeenCalledTimes(2);
  });

  it("requires same-origin POST before spending reveal quota", async () => {
    const response = await POST_SOFTWARE_SECRET(
      request("/api/software/software-1/secret", "POST", undefined, false),
      softwareParams,
    );

    expect(response.status).toBe(403);
    expect(requireAuth).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("student Photo Mechanic response minimization", () => {
  it("returns safe holder identity without management or irrelevant claim fields", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    const accountEmail = "photo-mechanic-admin@example.com";
    licenseFindManyMock.mockResolvedValue([{
      id: "license-1",
      code: "PM-SECRET-CODE",
      label: "Photo Mechanic",
      accountEmail,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      status: "CLAIMED",
      claimedById: "other-user",
      claimedAt: new Date("2026-08-18T12:00:00.000Z"),
      nagSentAt: new Date("2026-08-19T12:00:00.000Z"),
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      updatedAt: new Date("2026-08-19T12:00:00.000Z"),
      createdById: "admin-1",
      claims: [
        {
          id: "claim-other",
          licenseCodeId: "license-1",
          userId: "other-user",
          occupantLabel: "Private occupant label",
          claimedAt: new Date("2026-08-18T12:00:00.000Z"),
          releasedAt: null,
          releasedById: null,
          notes: "Internal note",
          user: { id: "other-user", name: "Other Student", avatarUrl: "https://example.com/private.jpg" },
        },
        {
          id: "claim-own",
          licenseCodeId: "license-1",
          userId: studentUser.id,
          occupantLabel: null,
          claimedAt: new Date("2026-08-19T12:00:00.000Z"),
          releasedAt: null,
          releasedById: null,
          notes: "Internal note",
          user: { id: studentUser.id, name: studentUser.name, avatarUrl: null },
        },
      ],
    }]);

    const response = await GET_LICENSES(
      new Request("https://app.example.com/api/licenses"),
      noParams,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const license = body.data[0];
    expect(Object.keys(license).sort()).toEqual([
      "claims",
      "code",
      "expiresAt",
      "id",
      "label",
      "status",
    ]);
    expect(license.code).toBe("PM-SECRET-CODE");
    expect(JSON.stringify(license)).not.toContain(accountEmail);
    expect(JSON.stringify(license)).not.toContain("Private occupant label");
    expect(JSON.stringify(license)).toContain("Other Student");
    expect(Object.keys(license.claims[0]).sort()).toEqual([
      "claimedAt",
      "id",
      "occupantLabel",
      "user",
      "userId",
    ]);
    expect(license.claims[0]).toEqual(expect.objectContaining({
      id: "claim-other",
      userId: null,
      user: { name: "Other Student", avatarUrl: "https://example.com/private.jpg" },
      occupantLabel: null,
    }));
    expect(license.claims[1]).toEqual(expect.objectContaining({
      id: "claim-own",
      userId: studentUser.id,
      user: { id: studentUser.id, name: studentUser.name, avatarUrl: null },
    }));
  });
});
