import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  checkRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));
vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = {
    gearPickCycle: { findUnique: vi.fn(), update: vi.fn() },
    gearPickParticipant: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    gearPickSubmission: { create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    gearPickLine: { deleteMany: vi.fn(), createMany: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    db: {
      gearPickCycle: { findUnique: vi.fn() },
      gearPickParticipant: { findUnique: vi.fn(), findMany: vi.fn() },
      user: { findUnique: vi.fn(), findMany: vi.fn() },
      $transaction: vi.fn(),
      _mockTx: tx,
    },
  };
});

import { requireAuth } from "@/lib/auth";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { checkRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { GET as getMe, PUT as putMe } from "@/app/api/gear-picks/me/route";
import { GET as getAdmin, PATCH as patchAdmin } from "@/app/api/gear-picks/admin/route";
import { GET as exportCsv } from "@/app/api/gear-picks/admin/export.csv/route";
import { GET as getUserPicks } from "@/app/api/gear-picks/users/[userId]/route";

type MockFn = ReturnType<typeof vi.fn>;
const tx = (db as unknown as { _mockTx: Record<string, Record<string, MockFn>> })._mockTx;
const context = { params: Promise.resolve({}) };
const ORIGIN = "https://app.example.com";

const staff = { id: "user-1", name: "Erik Role", email: "erik@example.com", role: Role.STAFF, avatarUrl: null };
const admin = { ...staff, id: "admin-1", name: "Admin", role: Role.ADMIN };

const MEN_TEE = "6021649-005"; // $15.00
const WOMEN_FULL_ZIP = "6021628-005";

const LAUNCHED = new Date("2026-10-01T12:00:00Z");
const openCycle = { id: "2027-28", title: "2027–28 Under Armour staff gear", deadline: null, launchedAt: LAUNCHED };
const unlaunchedCycle = { ...openCycle, launchedAt: null };
const participant = { id: "participant-1", fit: "MEN", allowanceCents: 18_500, submission: null };

function put(body: unknown) {
  return new Request(`${ORIGIN}/api/gear-picks/me`, {
    method: "PUT",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown) {
  return new Request(`${ORIGIN}/api/gear-picks/admin`, {
    method: "PATCH",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function savedSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: "submission-1",
    version: 1,
    totalCents: 3000,
    submittedAt: null,
    updatedAt: new Date("2026-10-07T12:00:00Z"),
    lines: [{ sku: MEN_TEE, style: "6021649", colorCode: "005", size: "L", quantity: 2, unitPriceCents: 1500 }],
    ...overrides,
  };
}

beforeEach(() => {
  for (const model of Object.values(tx)) for (const fn of Object.values(model)) fn.mockReset();
  vi.mocked(db.$transaction).mockImplementation((async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  vi.mocked(requireAuth).mockResolvedValue(staff);
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  tx.gearPickCycle!.findUnique!.mockResolvedValue(openCycle);
  tx.gearPickParticipant!.findUnique!.mockResolvedValue(participant);
  tx.gearPickSubmission!.create!.mockResolvedValue({ id: "submission-1" });
  tx.gearPickSubmission!.update!.mockResolvedValue({ id: "submission-1" });
  tx.gearPickSubmission!.findUniqueOrThrow!.mockResolvedValue(savedSubmission());
});

describe("GET /api/gear-picks/me", () => {
  it("returns a null participant for someone who isn't on the list", async () => {
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(openCycle as never);
    vi.mocked(db.gearPickParticipant.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findUnique).mockResolvedValue({ topSize: "2XL", topSizeFit: "MENS", shoeSize: "11", shoeSizeSystem: "US_MENS" } as never);

    const response = await getMe(new Request(`${ORIGIN}/api/gear-picks/me`), context);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toMatchObject({
      cycle: { id: "2027-28", deadline: null, isOpen: true, launchedAt: LAUNCHED.toISOString() },
      participant: null,
      submission: null,
      profile: { topSize: "2XL", shoeSize: "11" },
      isAdmin: false,
    });
  });

  it("keeps collaborators out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...staff, role: Role.COLLABORATOR });
    expect((await getMe(new Request(`${ORIGIN}/api/gear-picks/me`), context)).status).toBe(403);
  });

  it("hides an unlaunched cycle from staff, even participants", async () => {
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(unlaunchedCycle as never);
    vi.mocked(db.gearPickParticipant.findUnique).mockResolvedValue(participant as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ topSize: null, topSizeFit: null, shoeSize: null, shoeSizeSystem: null } as never);

    const json = await (await getMe(new Request(`${ORIGIN}/api/gear-picks/me`), context)).json();

    expect(json.data).toMatchObject({ cycle: null, participant: null, submission: null });
  });

  it("shows an unlaunched cycle to an admin previewing as staff", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...admin,
      role: Role.STAFF,
      preview: { actualRole: "ADMIN", role: Role.STAFF, readOnly: true, expiresAt: Date.now() + 60_000 },
    } as never);
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(unlaunchedCycle as never);
    vi.mocked(db.gearPickParticipant.findUnique).mockResolvedValue(participant as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ topSize: null, topSizeFit: null, shoeSize: null, shoeSizeSystem: null } as never);

    const json = await (await getMe(new Request(`${ORIGIN}/api/gear-picks/me`), context)).json();

    expect(json.data).toMatchObject({ cycle: { launchedAt: null }, participant: { id: "participant-1" }, isAdmin: false });
  });

  it("shows an unlaunched cycle to admins", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(unlaunchedCycle as never);
    vi.mocked(db.gearPickParticipant.findUnique).mockResolvedValue(participant as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ topSize: null, topSizeFit: null, shoeSize: null, shoeSizeSystem: null } as never);

    const json = await (await getMe(new Request(`${ORIGIN}/api/gear-picks/me`), context)).json();

    expect(json.data).toMatchObject({ cycle: { launchedAt: null }, participant: { id: "participant-1" }, isAdmin: true });
  });
});

describe("GET /api/gear-picks/users/[userId]", () => {
  const userRequest = (userId: string) => new Request(`${ORIGIN}/api/gear-picks/users/${userId}`);
  const userContext = (userId: string) => ({ params: Promise.resolve({ userId }) });

  beforeEach(() => {
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(openCycle as never);
    vi.mocked(db.gearPickParticipant.findUnique).mockResolvedValue(participant as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ topSize: null, topSizeFit: null, shoeSize: null, shoeSizeSystem: null } as never);
  });

  it("lets people read their own picks", async () => {
    const response = await getUserPicks(userRequest(staff.id), userContext(staff.id));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ participant: { id: "participant-1" }, isAdmin: false });
    expect(db.gearPickParticipant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cycleId_userId: { cycleId: "2027-28", userId: staff.id } } }),
    );
  });

  it("keeps staff out of other people's picks", async () => {
    const response = await getUserPicks(userRequest("someone-else"), userContext("someone-else"));

    expect(response.status).toBe(403);
    expect(db.gearPickParticipant.findUnique).not.toHaveBeenCalled();
  });

  it("keeps students out of other people's picks", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...staff, id: "student-1", role: Role.STUDENT });

    const response = await getUserPicks(userRequest(staff.id), userContext(staff.id));

    expect(response.status).toBe(403);
    expect(db.gearPickParticipant.findUnique).not.toHaveBeenCalled();
  });

  it("keeps collaborators out, even of their own profile", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...staff, role: Role.COLLABORATOR });

    expect((await getUserPicks(userRequest(staff.id), userContext(staff.id))).status).toBe(403);
  });

  it("lets admins read anyone's picks", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);

    const response = await getUserPicks(userRequest(staff.id), userContext(staff.id));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ participant: { id: "participant-1" }, isAdmin: true });
    expect(db.gearPickParticipant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cycleId_userId: { cycleId: "2027-28", userId: staff.id } } }),
    );
  });
});

describe("PUT /api/gear-picks/me", () => {
  it("creates a submission priced from the catalog in one serializable transaction", async () => {
    const response = await putMe(
      put({ lines: [{ sku: MEN_TEE, size: "l", quantity: 2, unitPriceCents: 1 }], submit: false, version: 0 }),
      context,
    );

    expect(response.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.gearPickSubmission!.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { participantId: "participant-1", totalCents: 3000, submittedAt: null } }),
    );
    expect(tx.gearPickLine!.createMany).toHaveBeenCalledWith({
      data: [
        {
          sku: MEN_TEE,
          style: "6021649",
          colorCode: "005",
          size: "L",
          quantity: 2,
          unitPriceCents: 1500,
          submissionId: "submission-1",
        },
      ],
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entityType: "gear_pick_submission", action: "save_draft", before: undefined }),
    );
  });

  it("replaces lines and keeps the first submittedAt on a later submit", async () => {
    const firstSubmit = new Date("2026-10-01T12:00:00Z");
    tx.gearPickParticipant!.findUnique!.mockResolvedValue({
      ...participant,
      submission: savedSubmission({ version: 3, submittedAt: firstSubmit }),
    });

    const response = await putMe(put({ lines: [{ sku: MEN_TEE, size: "M", quantity: 1 }], submit: true, version: 3 }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickLine!.deleteMany).toHaveBeenCalledWith({ where: { submissionId: "submission-1" } });
    expect(tx.gearPickSubmission!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { totalCents: 1500, version: { increment: 1 }, submittedAt: firstSubmit },
      }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "submit", before: expect.objectContaining({ version: 3, totalCents: 3000 }) }),
    );
  });

  it("returns a friendly 409 when the list changed since the client read it", async () => {
    tx.gearPickParticipant!.findUnique!.mockResolvedValue({ ...participant, submission: savedSubmission({ version: 2 }) });

    const response = await putMe(put({ lines: [], submit: false, version: 1 }), context);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe("GEAR_PICKS_STALE");
    expect(tx.gearPickLine!.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses staff saves before launch", async () => {
    tx.gearPickCycle!.findUnique!.mockResolvedValue(unlaunchedCycle);

    const response = await putMe(put({ lines: [], submit: false, version: 0 }), context);

    expect(response.status).toBe(404);
    expect(tx.gearPickSubmission!.create).not.toHaveBeenCalled();
  });

  it("lets admins save before launch", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickCycle!.findUnique!.mockResolvedValue(unlaunchedCycle);

    const response = await putMe(put({ lines: [{ sku: MEN_TEE, size: "M", quantity: 1 }], submit: false, version: 0 }), context);

    expect(response.status).toBe(200);
  });

  it("locks picks after the deadline", async () => {
    tx.gearPickCycle!.findUnique!.mockResolvedValue({ ...openCycle, deadline: new Date("2020-01-01T00:00:00Z") });

    const response = await putMe(put({ lines: [{ sku: MEN_TEE, size: "M", quantity: 1 }], submit: true, version: 0 }), context);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("GEAR_PICKS_CLOSED");
    expect(tx.gearPickSubmission!.create).not.toHaveBeenCalled();
  });

  it("refuses people who aren't participants", async () => {
    tx.gearPickParticipant!.findUnique!.mockResolvedValue(null);
    const response = await putMe(put({ lines: [], submit: false, version: 0 }), context);
    expect(response.status).toBe(403);
    expect(tx.gearPickSubmission!.create).not.toHaveBeenCalled();
  });

  it("rejects items outside the participant's fit and totals over the allowance without writing", async () => {
    const wrongFit = await putMe(put({ lines: [{ sku: WOMEN_FULL_ZIP, size: "M", quantity: 1 }], submit: false, version: 0 }), context);
    expect(wrongFit.status).toBe(400);

    tx.gearPickParticipant!.findUnique!.mockResolvedValue({ ...participant, allowanceCents: 1000 });
    const over = await putMe(put({ lines: [{ sku: MEN_TEE, size: "M", quantity: 1 }], submit: false, version: 0 }), context);
    expect(over.status).toBe(400);
    expect((await over.json()).error).toMatch(/over your \$10\.00 allowance/);
    expect(tx.gearPickSubmission!.create).not.toHaveBeenCalled();
  });

  it("validates quantity bounds at the schema boundary", async () => {
    const response = await putMe(put({ lines: [{ sku: MEN_TEE, size: "M", quantity: 6 }], submit: false, version: 0 }), context);
    expect(response.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an empty submit", async () => {
    const response = await putMe(put({ lines: [], submit: true, version: 0 }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least one item/);
  });
});

describe("admin routes", () => {
  it("keeps results, changes, and export admin-only", async () => {
    expect((await getAdmin(new Request(`${ORIGIN}/api/gear-picks/admin`), context)).status).toBe(403);
    expect((await patchAdmin(patch({ action: "setDeadline", deadline: null }), context)).status).toBe(403);
    expect((await exportCsv(new Request(`${ORIGIN}/api/gear-picks/admin/export.csv`), context)).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("sets the deadline with a before/after audit", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);

    const response = await patchAdmin(patch({ action: "setDeadline", deadline: "2026-11-01T05:00:00.000Z" }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickCycle!.update).toHaveBeenCalledWith({
      where: { id: "2027-28" },
      data: { deadline: new Date("2026-11-01T05:00:00.000Z") },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entityType: "gear_pick_cycle",
        action: "set_deadline",
        before: { deadline: null },
        after: { deadline: "2026-11-01T05:00:00.000Z" },
      }),
    );
  });

  it("launches the cycle to staff with an audit entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickCycle!.findUnique!.mockResolvedValue(unlaunchedCycle);

    const response = await patchAdmin(patch({ action: "setLaunched", launched: true }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickCycle!.update).toHaveBeenCalledWith({
      where: { id: "2027-28" },
      data: { launchedAt: expect.any(Date) },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entityType: "gear_pick_cycle", action: "launch", before: { launchedAt: null } }),
    );
  });

  it("hides a launched cycle from staff again", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);

    const response = await patchAdmin(patch({ action: "setLaunched", launched: false }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickCycle!.update).toHaveBeenCalledWith({ where: { id: "2027-28" }, data: { launchedAt: null } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "unlaunch", before: { launchedAt: LAUNCHED.toISOString() }, after: { launchedAt: null } }),
    );
  });

  it("adds a participant with the fit's default allowance", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.user!.findUnique!.mockResolvedValue({ id: "user-9", name: "Emma Hansen", active: true, role: Role.STAFF });
    tx.gearPickParticipant!.create!.mockResolvedValue({ id: "participant-9" });

    const response = await patchAdmin(patch({ action: "addParticipant", userId: "user-9", fit: "WOMEN" }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickParticipant!.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cycleId: "2027-28", userId: "user-9", fit: "WOMEN", allowanceCents: 35_000 } }),
    );
  });

  it("maps a duplicate participant to a friendly conflict", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.user!.findUnique!.mockResolvedValue({ id: "user-9", name: "Emma Hansen", active: true, role: Role.STAFF });
    tx.gearPickParticipant!.create!.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );

    const response = await patchAdmin(patch({ action: "addParticipant", userId: "user-9", fit: "WOMEN" }), context);
    expect(response.status).toBe(409);
  });

  it("rejects an update that changes nothing", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    const response = await patchAdmin(patch({ action: "updateParticipant", participantId: "participant-1" }), context);
    expect(response.status).toBe(400);
  });

  it("exports one CSV row per line with the sheet's columns", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(openCycle as never);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.gearPickParticipant.findMany).mockResolvedValue([
      {
        id: "participant-1",
        fit: "MEN",
        allowanceCents: 18_500,
        user: { id: "user-1", name: "Erik Role", email: "erik@example.com", active: true, topSize: "L", shoeSize: "11" },
        submission: savedSubmission({ submittedAt: new Date("2026-10-07T15:00:00Z") }),
      },
    ] as never);

    const response = await exportCsv(new Request(`${ORIGIN}/api/gear-picks/admin/export.csv`), context);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(text.split("\n")).toEqual([
      "Group,Person,Item #,Item,Color,Size,Qty,Unit Price,Line Total,Submitted At",
      `Staff Pick,Erik Role,${MEN_TEE},Athletics SS Tee,Black,L,2,15.00,30.00,2026-10-07T15:00:00.000Z`,
    ]);
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ entityType: "gear_pick_cycle", action: "export" }));
  });
});
