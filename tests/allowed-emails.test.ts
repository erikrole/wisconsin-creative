import { afterEach, describe, it, expect, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

// ─── Mock modules ───────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    allowedEmail: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createAuditEntries: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/services/invite-email", () => ({
  sendInviteEmail: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/services/invite-email";
import { GET, POST } from "@/app/api/allowed-emails/route";
import { DELETE } from "@/app/api/allowed-emails/[id]/route";

const adminUser = {
  id: "admin-1",
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@test.com",
  name: "Staff",
  role: "STAFF" as const,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@test.com",
  name: "Student",
  role: "STUDENT" as const,
  avatarUrl: null,
};

function makeGetRequest(query = "") {
  return new Request(`https://app.example.com/api/allowed-emails${query}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function makePostRequest(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/allowed-emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new Request("https://app.example.com/api/allowed-emails/entry-1", {
    method: "DELETE",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
  });
}

const noParams = { params: Promise.resolve({}) };

type AllowedEmailRow = {
  id: string;
  email: string;
  role: Role;
  claimedAt?: Date | null;
  claimedById?: string | null;
};

function allowedEmailResult(row: AllowedEmailRow) {
  return row as unknown as Awaited<ReturnType<typeof db.allowedEmail.create>>;
}

function allowedEmailFindUniqueResult(row: AllowedEmailRow | null) {
  return row as unknown as Awaited<ReturnType<typeof db.allowedEmail.findUnique>>;
}

function allowedEmailFindManyResult(rows: Array<Partial<AllowedEmailRow>>) {
  return rows as unknown as Awaited<ReturnType<typeof db.allowedEmail.findMany>>;
}

function allowedEmailCreateManyResult(value: { count: number }) {
  return value as unknown as Awaited<ReturnType<typeof db.allowedEmail.createMany>>;
}

function registeredUserResult(value: { id: string; role: Role } | null) {
  return value as unknown as Awaited<ReturnType<typeof db.user.findUnique>>;
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/allowed-emails
// ═════════════════════════════════════════════════════════════════════════════
describe("GET /api/allowed-emails", () => {
  afterEach(() => {
    delete process.env.INTERNAL_OPERATOR_EMAILS;
  });

  it("returns paginated allowed emails for ADMIN", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue(allowedEmailFindManyResult([
      { id: "e-1", email: "stu@uw.edu", role: Role.STUDENT, claimedAt: null },
    ]));
    vi.mocked(db.allowedEmail.count).mockResolvedValue(1);

    const res = await GET(makeGetRequest(), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("excludes rows claimed by hidden users by default", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.count).mockResolvedValue(0);

    await GET(makeGetRequest(), noParams);

    expect(db.allowedEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { claimedById: null },
                { claimedBy: { is: { hiddenFromRoster: false } } },
              ],
            },
          ],
        },
      }),
    );
    expect(db.allowedEmail.count).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { claimedById: null },
              { claimedBy: { is: { hiddenFromRoster: false } } },
            ],
          },
        ],
      },
    });
  });

  it("allows internal operators to include hidden claimed rows", async () => {
    process.env.INTERNAL_OPERATOR_EMAILS = "admin@test.com";
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.count).mockResolvedValue(0);

    await GET(makeGetRequest("?includeHidden=1"), noParams);

    expect(db.allowedEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    );
  });

  it("filters by search query", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.count).mockResolvedValue(0);

    await GET(makeGetRequest("?q=test"), noParams);

    expect(db.allowedEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            { email: { contains: "test", mode: "insensitive" } },
          ]),
        },
      })
    );
  });

  it("filters by claimed status", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.count).mockResolvedValue(0);

    await GET(makeGetRequest("?status=unclaimed"), noParams);

    expect(db.allowedEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            { claimedAt: null },
          ]),
        },
      })
    );
  });

  it("returns 403 for STUDENT", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await GET(makeGetRequest(), noParams);

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/allowed-emails (single)
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/allowed-emails (single)", () => {
  it("creates a single allowed email entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailResult({
      id: "e-1",
      email: "new@uw.edu",
      role: Role.STUDENT,
    }));

    const res = await POST(
      makePostRequest({ email: "New@UW.edu", role: "STUDENT" }),
      noParams
    );

    expect(res.status).toBe(201);
    // Verify email is lowercased
    expect(db.allowedEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@uw.edu",
        }),
      })
    );
  });

  it("emails the invite once when asked, and records how the send ended", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailResult({ id: "e-2", email: "jo@wisc.edu", role: Role.STUDENT }));
    vi.mocked(sendInviteEmail).mockResolvedValue("sent");

    const res = await POST(makePostRequest({ email: "jo@wisc.edu", role: "STUDENT", preloadedName: "Jo Park", sendInvite: true }), noParams);

    expect(res.status).toBe(201);
    expect((await res.json()).emailStatus).toBe("sent");
    expect(sendInviteEmail).toHaveBeenCalledTimes(1);
    expect(sendInviteEmail).toHaveBeenCalledWith({ email: "jo@wisc.edu", name: "Jo Park", allowedEmailId: "e-2" });
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "e-2",
      action: "invite_sent",
      after: { emailStatus: "sent" },
    }));
  });

  it("sends nothing unless the invite email is asked for", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailResult({ id: "e-3", email: "al@wisc.edu", role: Role.STUDENT }));

    const res = await POST(makePostRequest({ email: "al@wisc.edu", role: "STUDENT" }), noParams);

    expect(res.status).toBe(201);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("creates a claimed allowlist row when the email already belongs to a registered user", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(registeredUserResult({ id: "existing-user", role: Role.STAFF }));
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailResult({
      id: "e-1",
      email: "existing@uw.edu",
      role: Role.STAFF,
      claimedAt: new Date("2026-05-12T18:30:00.000Z"),
      claimedById: "existing-user",
    }));

    const res = await POST(
      makePostRequest({ email: "existing@uw.edu", role: "STUDENT" }),
      noParams
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skipped).toBeUndefined();
    expect(body.email).toBe("existing@uw.edu");
    expect(body.role).toBe("STAFF");
    expect(db.allowedEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "existing@uw.edu",
          role: "STAFF",
          createdById: "admin-1",
          claimedById: "existing-user",
          claimedAt: expect.any(Date),
        }),
      })
    );
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "allowed_email",
        action: "created",
        after: expect.objectContaining({
          source: "registered_user_backfill",
          claimedById: "existing-user",
        }),
      })
    );
  });

  it("returns a generic success skip when the registered user already has an allowlist row", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(registeredUserResult({ id: "existing-user", role: Role.STUDENT }));
    vi.mocked(db.allowedEmail.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    const res = await POST(
      makePostRequest({ email: "existing@uw.edu", role: "STUDENT" }),
      noParams
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      email: "existing@uw.edu",
      role: "STUDENT",
      skipped: true,
    });
  });

  it("prevents STAFF from backfilling a registered STAFF allowlist row", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(registeredUserResult({ id: "existing-user", role: Role.STAFF }));

    const res = await POST(
      makePostRequest({ email: "existing-staff@uw.edu", role: "STUDENT" }),
      noParams
    );

    expect(res.status).toBe(403);
    expect(db.allowedEmail.create).not.toHaveBeenCalled();
  });

  it("STAFF cannot add STAFF-role entries", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await POST(
      makePostRequest({ email: "staff2@uw.edu", role: "STAFF" }),
      noParams
    );

    expect(res.status).toBe(403);
  });

  it("ADMIN can add STAFF-role entries", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailResult({
      id: "e-1",
      email: "staff2@uw.edu",
      role: Role.STAFF,
    }));

    const res = await POST(
      makePostRequest({ email: "staff2@uw.edu", role: "STAFF" }),
      noParams
    );

    expect(res.status).toBe(201);
  });

  it("returns 403 for STUDENT", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await POST(
      makePostRequest({ email: "any@uw.edu", role: "STUDENT" }),
      noParams
    );

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/allowed-emails (bulk)
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/allowed-emails (bulk)", () => {
  it("creates multiple allowed email entries and reports skipped ones", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue(allowedEmailFindManyResult([
      { email: "existing@uw.edu" },
    ]));
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.createMany).mockResolvedValue(allowedEmailCreateManyResult({ count: 1 }));
    // After createMany, fetch the created records
    vi.mocked(db.allowedEmail.findMany).mockResolvedValueOnce(allowedEmailFindManyResult([
      { email: "existing@uw.edu" },
    ])).mockResolvedValueOnce(allowedEmailFindManyResult([
      { id: "e-1", email: "new@uw.edu", role: Role.STUDENT },
    ]));

    const res = await POST(
      makePostRequest({
        emails: [
          { email: "New@UW.edu", role: "STUDENT" },
          { email: "Existing@UW.edu", role: "STUDENT" },
        ],
      }),
      noParams
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it("STAFF cannot bulk-add STAFF-role entries", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await POST(
      makePostRequest({
        emails: [
          { email: "staff2@uw.edu", role: "STAFF" },
          { email: "student@uw.edu", role: "STUDENT" },
        ],
      }),
      noParams
    );

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/allowed-emails/[id]
// ═════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/allowed-emails/[id]", () => {
  it("deletes an unclaimed entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(allowedEmailFindUniqueResult({
      id: "entry-1",
      email: "del@uw.edu",
      role: Role.STUDENT,
      claimedAt: null,
    }));
    vi.mocked(db.allowedEmail.deleteMany).mockResolvedValue({ count: 1 });

    const res = await DELETE(
      makeDeleteRequest(),
      { params: Promise.resolve({ id: "entry-1" }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 when entry not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(null);

    const res = await DELETE(
      makeDeleteRequest(),
      { params: Promise.resolve({ id: "nonexistent" }) }
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when entry is already claimed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(allowedEmailFindUniqueResult({
      id: "entry-1",
      email: "claimed@uw.edu",
      role: Role.STUDENT,
      claimedAt: new Date(),
    }));

    const res = await DELETE(
      makeDeleteRequest(),
      { params: Promise.resolve({ id: "entry-1" }) }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("claimed");
  });

  it("handles race condition where entry becomes claimed between check and delete", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(allowedEmailFindUniqueResult({
      id: "entry-1",
      email: "race@uw.edu",
      role: Role.STUDENT,
      claimedAt: null,
    }));
    // deleteMany returns 0 because the entry was claimed between findUnique and deleteMany
    vi.mocked(db.allowedEmail.deleteMany).mockResolvedValue({ count: 0 });

    const res = await DELETE(
      makeDeleteRequest(),
      { params: Promise.resolve({ id: "entry-1" }) }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("just claimed");
  });

  it("returns 403 for STUDENT", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await DELETE(
      makeDeleteRequest(),
      { params: Promise.resolve({ id: "entry-1" }) }
    );

    expect(res.status).toBe(403);
  });
});
