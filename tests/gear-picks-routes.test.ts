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
    gearPickStudent: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    gearPickReceipt: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    gearPickHandout: { upsert: vi.fn(), deleteMany: vi.fn() },
    gearPastCycle: { deleteMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    db: {
      gearPickCycle: { findUnique: vi.fn() },
      gearPickParticipant: { findUnique: vi.fn(), findMany: vi.fn() },
      gearPickStudent: { findMany: vi.fn() },
      gearPickReceipt: { findMany: vi.fn() },
      gearPickHandout: { findMany: vi.fn() },
      gearPastCycle: { findMany: vi.fn() },
      budgetLine: { findMany: vi.fn() },
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
import { GET as getHistory, POST as postHistory } from "@/app/api/gear-picks/admin/history/route";
import { GET as exportCsv } from "@/app/api/gear-picks/admin/export.csv/route";
import { GET as exportSheet } from "@/app/api/gear-picks/admin/export.xlsx/route";
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
  vi.mocked(db.gearPickStudent.findMany).mockResolvedValue([]);
  vi.mocked(db.gearPickReceipt.findMany).mockResolvedValue([]);
  vi.mocked(db.gearPickHandout.findMany).mockResolvedValue([]);
  vi.mocked(db.budgetLine.findMany).mockResolvedValue([]);
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

  it("adds the caller's fit catalog only when the phone asks for it", async () => {
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue(openCycle as never);
    vi.mocked(db.gearPickParticipant.findUnique).mockResolvedValue(participant as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ topSize: "M", topSizeFit: "MENS", shoeSize: "11", shoeSizeSystem: "US_MENS" } as never);

    const plain = await (await getMe(new Request(`${ORIGIN}/api/gear-picks/me`), context)).json();
    expect(plain.data.catalog).toBeUndefined();

    const json = await (await getMe(new Request(`${ORIGIN}/api/gear-picks/me?catalog=1`), context)).json();
    expect(json.data.catalog.items.some((item: { style: string }) => item.style === "6021649")).toBe(true);
    expect(json.data.catalog.items.some((item: { style: string }) => item.style === "6021628")).toBe(false);
    expect(json.data.catalog.items.find((item: { style: string }) => item.style === "6021649").priceCents).toBe(1500);
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
    expect((await exportSheet(new Request(`${ORIGIN}/api/gear-picks/admin/export.xlsx`), context)).status).toBe(403);
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

  it("sets the budget with a before/after audit and rejects bad amounts", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickCycle!.findUnique!.mockResolvedValue({ ...unlaunchedCycle, budgetCents: 550000, budgetConfirmed: false });

    const response = await patchAdmin(patch({ action: "setBudget", budgetCents: 600000, confirmed: true }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickCycle!.update).toHaveBeenCalledWith({
      where: { id: "2027-28" },
      data: { budgetCents: 600000, budgetConfirmed: true },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "set_budget",
        before: { budgetCents: 550000, confirmed: false },
        after: { budgetCents: 600000, confirmed: true },
      }),
    );

    tx.gearPickCycle!.update!.mockClear();
    expect((await patchAdmin(patch({ action: "setBudget", budgetCents: -1, confirmed: true }), context)).status).toBe(400);
    expect((await patchAdmin(patch({ action: "setBudget", budgetCents: 1.5, confirmed: true }), context)).status).toBe(400);
    expect(tx.gearPickCycle!.update).not.toHaveBeenCalled();
  });

  it("adds an active student to the list with an audit entry, and refuses staff accounts", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.user!.findUnique!.mockResolvedValue({ id: "student-1", name: "Student One", active: true, role: Role.STUDENT });
    tx.gearPickStudent!.create!.mockResolvedValue({ id: "gps-1" });

    const response = await patchAdmin(patch({ action: "addStudent", userId: "student-1" }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickStudent!.create).toHaveBeenCalledWith({
      data: { cycleId: "2027-28", userId: "student-1" },
      select: { id: true },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entityType: "gear_pick_student", action: "add_student", after: { userId: "student-1", name: "Student One" } }),
    );

    tx.gearPickStudent!.create!.mockClear();
    tx.user!.findUnique!.mockResolvedValue({ id: "staff-1", name: "Staff", active: true, role: Role.STAFF });
    expect((await patchAdmin(patch({ action: "addStudent", userId: "staff-1" }), context)).status).toBe(404);
    expect(tx.gearPickStudent!.create).not.toHaveBeenCalled();
  });

  it("answers a duplicate student with a friendly conflict", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.user!.findUnique!.mockResolvedValue({ id: "student-1", name: "Student One", active: true, role: Role.STUDENT });
    tx.gearPickStudent!.create!.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );

    const response = await patchAdmin(patch({ action: "addStudent", userId: "student-1" }), context);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already on the student list/);
  });

  it("removes a student from the list with an audit entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickStudent!.findFirst!.mockResolvedValue({ id: "gps-1", user: { id: "student-1", name: "Student One" } });

    const response = await patchAdmin(patch({ action: "removeStudent", studentId: "gps-1" }), context);

    expect(response.status).toBe(200);
    expect(tx.gearPickStudent!.delete).toHaveBeenCalledWith({ where: { id: "gps-1" } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "remove_student", before: { userId: "student-1", name: "Student One" } }),
    );
  });

  it("lets an admin set a student's sizes with an audit entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickStudent!.findFirst!.mockResolvedValue({
      id: "gps-1",
      user: { id: "student-1", name: "Student One", topSize: null, shoeSize: "9" },
    });

    const response = await patchAdmin(patch({ action: "setStudentSizes", studentId: "gps-1", topSize: "M", shoeSize: "9" }), context);

    expect(response.status).toBe(200);
    expect(tx.user!.update).toHaveBeenCalledWith({ where: { id: "student-1" }, data: { topSize: "M", shoeSize: "9" } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "set_student_sizes",
        before: { userId: "student-1", topSize: null, shoeSize: "9" },
        after: { userId: "student-1", topSize: "M", shoeSize: "9" },
      }),
    );
  });

  it("404s when setting sizes for a student who is not on the list", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickStudent!.findFirst!.mockResolvedValue(null);

    const response = await patchAdmin(patch({ action: "setStudentSizes", studentId: "nope", topSize: "M", shoeSize: null }), context);

    expect(response.status).toBe(404);
    expect(tx.user!.update).not.toHaveBeenCalled();
  });

  it("records the order with an audit entry", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickCycle!.findUnique!.mockResolvedValue({ ...openCycle, orderPlacedAt: null, poNumber: null, orderNumber: null, expectedAt: null });

    const response = await patchAdmin(
      patch({ action: "setOrder", placedAt: "2026-10-20T12:00:00Z", poNumber: "PO-1", orderNumber: "UA-9", expectedAt: "2027-07-01T12:00:00Z" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(tx.gearPickCycle!.update).toHaveBeenCalledWith({
      where: { id: "2027-28" },
      data: { orderPlacedAt: new Date("2026-10-20T12:00:00Z"), poNumber: "PO-1", orderNumber: "UA-9", expectedAt: new Date("2027-07-01T12:00:00Z") },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "set_order" }));
  });

  it("records a receipt for a SKU and size, and rejects a bad SKU", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickReceipt!.create!.mockResolvedValue({ id: "r-1" });

    const response = await patchAdmin(
      patch({ action: "addReceipt", sku: "6021649-834", size: "M", quantity: 4, receivedAt: "2027-07-08T12:00:00Z" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(tx.gearPickReceipt!.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sku: "6021649-834", size: "M", quantity: 4, receivedById: "admin-1" }) }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "add_receipt" }));

    const bad = await patchAdmin(patch({ action: "addReceipt", sku: "nope", size: null, quantity: 1, receivedAt: "2027-07-08T12:00:00Z" }), context);
    expect(bad.status).toBe(400);
  });

  it("removes a receipt, and 404s on an unknown one", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.gearPickReceipt!.findFirst!.mockResolvedValueOnce({ id: "r-1", sku: "6021649-834", size: "M", quantity: 4 });

    const response = await patchAdmin(patch({ action: "removeReceipt", receiptId: "r-1" }), context);
    expect(response.status).toBe(200);
    expect(tx.gearPickReceipt!.delete).toHaveBeenCalledWith({ where: { id: "r-1" } });

    tx.gearPickReceipt!.findFirst!.mockResolvedValueOnce(null);
    const missing = await patchAdmin(patch({ action: "removeReceipt", receiptId: "nope" }), context);
    expect(missing.status).toBe(404);
  });

  it("marks a piece handed out and undoes it, with audit entries", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.user!.findUnique!.mockResolvedValue({ id: "user-1", name: "Erik Role" });
    const piece = { sku: "6021649-834", size: "M", source: "CORE_KIT", quantity: 1 };

    const handed = await patchAdmin(patch({ action: "setHandout", userId: "user-1", pieces: [piece], handed: true }), context);
    expect(handed.status).toBe(200);
    expect(tx.gearPickHandout!.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cycleId_userId_sku_size_source: { cycleId: "2027-28", userId: "user-1", sku: "6021649-834", size: "M", source: "CORE_KIT" } },
        create: expect.objectContaining({ quantity: 1, handedOutById: "admin-1" }),
      }),
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "hand_out" }));

    const undone = await patchAdmin(patch({ action: "setHandout", userId: "user-1", pieces: [piece], handed: false }), context);
    expect(undone.status).toBe(200);
    expect(tx.gearPickHandout!.deleteMany).toHaveBeenCalledWith({
      where: { cycleId: "2027-28", userId: "user-1", sku: "6021649-834", size: "M", source: "CORE_KIT" },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "undo_hand_out" }));
  });

  it("rejects a handout for an unknown person or a bad source", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    tx.user!.findUnique!.mockResolvedValue(null);

    const missing = await patchAdmin(
      patch({ action: "setHandout", userId: "nobody", handed: true, pieces: [{ sku: "6021649-834", size: "M", source: "CORE_KIT", quantity: 1 }] }),
      context,
    );
    expect(missing.status).toBe(404);

    const bad = await patchAdmin(
      patch({ action: "setHandout", userId: "user-1", handed: true, pieces: [{ sku: "6021649-834", size: "M", source: "GIFT", quantity: 1 }] }),
      context,
    );
    expect(bad.status).toBe(400);
  });

  it("serves past years to admins only, with the remaining budget worked out", async () => {
    vi.mocked(db.gearPastCycle.findMany).mockResolvedValue([
      { id: "2026-27", title: "2026–27", budgetCents: 550_000, budgetedSpendCents: 583_100, otherSpendCents: 46_250, note: null, items: [], people: [] },
    ] as never);

    vi.mocked(requireAuth).mockResolvedValue(staff);
    expect((await getHistory(new Request(`${ORIGIN}/api/gear-picks/admin/history`), context)).status).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue(admin);
    const response = await getHistory(new Request(`${ORIGIN}/api/gear-picks/admin/history`), context);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.cycles[0]).toMatchObject({ id: "2026-27", remainingCents: -33_100 });
  });

  it("saves the live year to History with its items, people and budget, admins only", async () => {
    const request = () => new Request(`${ORIGIN}/api/gear-picks/admin/history`, { method: "POST", headers: { origin: ORIGIN } });
    vi.mocked(requireAuth).mockResolvedValue(staff);
    expect((await postHistory(request(), context)).status).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue({
      ...openCycle,
      budgetCents: 550_000,
      budgetConfirmed: true,
      studentKitCents: 14_250,
      orderPlacedAt: new Date("2026-10-20T12:00:00Z"),
      poNumber: null,
      orderNumber: null,
      expectedAt: null,
    } as never);
    vi.mocked(db.gearPickParticipant.findMany).mockResolvedValue([
      { id: "p1", fit: "MEN", allowanceCents: 18_500, user: { id: "u1", name: "Staff One", email: "s@x.com", active: true, topSize: "M", shoeSize: "10" }, submission: null },
    ] as never);
    vi.mocked(db.gearPickStudent.findMany).mockResolvedValue([
      { id: "gps-1", user: { id: "s1", name: "Student One", active: true, topSize: "S", topSizeFit: "WOMENS", shoeSize: "7" } },
    ] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.gearPickReceipt.findMany).mockResolvedValue([
      { id: "r1", sku: "6021649-834", size: "M", quantity: 1, receivedAt: new Date("2027-07-08T12:00:00Z"), note: null, receivedBy: null },
    ] as never);

    const response = await postHistory(request(), context);

    expect(response.status).toBe(200);
    expect(tx.gearPastCycle!.deleteMany).toHaveBeenCalledWith({ where: { id: "2027-28" } });
    const created = tx.gearPastCycle!.create!.mock.calls[0]![0].data;
    expect(created).toMatchObject({ id: "2027-28", budgetCents: 550_000, budgetedSpendCents: 14_250 });
    expect(created.people.create.map((person: { name: string; groupLabel: string; fit: string }) => [person.name, person.groupLabel, person.fit])).toEqual([
      ["Staff One", "Staff", "Men"],
      ["Student One", "Student", "Women"],
    ]);
    const tee = created.items.create.find((item: { sku: string }) => item.sku === "6021649-834");
    expect(tee).toMatchObject({ plannedQty: 1, receivedQty: 1, orderedQty: 1 });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "archive_cycle" }));
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
      expect.objectContaining({ data: { cycleId: "2027-28", userId: "user-9", fit: "WOMEN", allowanceCents: 35_700 } }),
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

  describe("participant changes against saved picks", () => {
    const withPicks = {
      id: "participant-1",
      fit: "MEN",
      allowanceCents: 18_500,
      userId: "user-1",
      user: { name: "Erik Role" },
      submission: { totalCents: 3000, lines: [{ sku: MEN_TEE }] },
    };

    beforeEach(() => {
      vi.mocked(requireAuth).mockResolvedValue(admin);
      tx.gearPickParticipant!.findFirst!.mockResolvedValue(withPicks);
      tx.gearPickParticipant!.update!.mockResolvedValue({ id: "participant-1", fit: "MEN", allowanceCents: 18_500 });
    });

    it("refuses an allowance below what they've saved", async () => {
      const response = await patchAdmin(
        patch({ action: "updateParticipant", participantId: "participant-1", allowanceCents: 2000 }),
        context,
      );
      const json = await response.json();

      expect(response.status).toBe(409);
      expect(json.code).toBe("GEAR_PICKS_CONFLICT");
      expect(json.error).toContain("Erik Role's saved picks total $30.00");
      expect(tx.gearPickParticipant!.update).not.toHaveBeenCalled();
    });

    it("refuses a fit change that would orphan a saved item", async () => {
      const response = await patchAdmin(
        patch({ action: "updateParticipant", participantId: "participant-1", fit: "WOMEN" }),
        context,
      );

      expect(response.status).toBe(409);
      expect(tx.gearPickParticipant!.update).not.toHaveBeenCalled();
    });

    it("allows a change their saved picks still fit", async () => {
      const response = await patchAdmin(
        patch({ action: "updateParticipant", participantId: "participant-1", allowanceCents: 3000 }),
        context,
      );

      expect(response.status).toBe(200);
      expect(tx.gearPickParticipant!.update).toHaveBeenCalled();
    });
  });

  it("lists students with their profile sizes, flags missing ones, and counts their kits in the budget", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue({ ...openCycle, budgetCents: 550_000, budgetConfirmed: false, studentKitCents: 14_250 } as never);
    vi.mocked(db.gearPickParticipant.findMany).mockResolvedValue([]);
    vi.mocked(db.gearPickStudent.findMany).mockResolvedValue([
      { id: "gps-1", user: { id: "s1", name: "Student One", active: true, topSize: "M", shoeSize: "9" } },
      { id: "gps-2", user: { id: "s2", name: "Student Two", active: true, topSize: null, shoeSize: "10" } },
    ] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const response = await getAdmin(new Request(`${ORIGIN}/api/gear-picks/admin`), context);
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.students.map((student: { needsSize: boolean }) => student.needsSize)).toEqual([false, true]);
    expect(data.budget).toMatchObject({ studentKitsCents: 28_500, committedCents: 28_500, remainingCents: 521_500 });
  });

  it("adds Creative budget lines marked for the year on top of the allotment, leaving cancelled ones out", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(db.gearPickCycle.findUnique).mockResolvedValue({ ...openCycle, budgetCents: 550_000, budgetConfirmed: true, studentKitCents: 0 } as never);
    vi.mocked(db.gearPickParticipant.findMany).mockResolvedValue([]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.budgetLine.findMany).mockResolvedValue([
      { id: "line-1", description: "Student UA top-up", unitCostCents: 25_000, quantity: 2, budget: { id: "b1", name: "Creative", fiscalYear: "2026-27" } },
    ] as never);

    const response = await getAdmin(new Request(`${ORIGIN}/api/gear-picks/admin`), context);
    const { data } = await response.json();

    expect(vi.mocked(db.budgetLine.findMany).mock.calls[0]![0]).toMatchObject({
      where: { gearPickCycleId: openCycle.id, status: { not: "CANCELLED" } },
    });
    expect(data.budget).toMatchObject({
      budgetCents: 550_000,
      topUpCents: 50_000,
      availableCents: 600_000,
      remainingCents: 600_000,
      topUps: [{ lineId: "line-1", budgetId: "b1", budgetLabel: "Creative 2026-27", description: "Student UA top-up", amountCents: 50_000 }],
    });
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

  it("exports the equipment department's workbook", async () => {
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

    const response = await exportSheet(new Request(`${ORIGIN}/api/gear-picks/admin/export.xlsx`), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("equipment-sheet-2027-28.xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: "export", after: expect.objectContaining({ format: "equipment_sheet", rowCount: 1 }) }),
    );
  });
});
