import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role, SportAutoAssignPolicy } from "@prisma/client";

const { db, audit, auditMany, finalize } = vi.hoisted(() => {
  const db = {
    sportConfig: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    studentSportAssignment: { findMany: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn() },
    scheduleBulkAssignment: { findMany: vi.fn(), findUnique: vi.fn() },
    scheduleBulkAssignmentItem: { updateMany: vi.fn() },
    shiftGroupWorkingCopy: { deleteMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, audit: vi.fn(), auditMany: vi.fn(), finalize: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: audit, createAuditEntriesTx: auditMany }));
vi.mock("@/lib/services/bulk-schedule-assignment", () => ({ finalizeBulkScheduleAssignment: finalize }));

import { getSportSetup, matchSportSetup } from "@/lib/services/sport-setup";
import { BULK_ASSIGNMENT_CANCEL_ACTION, cancelBulkAssignmentBatch, listBulkAssignmentBatches } from "@/lib/services/bulk-assignment-batches";

const admin = { id: "admin-1", role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("getSportSetup", () => {
  it("lists the big six first, splits rosters into staff and students, and skips people with no slot type", async () => {
    db.sportConfig.findMany.mockResolvedValue([{ sportCode: "VB", autoAssignPolicy: SportAutoAssignPolicy.STAFF_ONLY }]);
    db.studentSportAssignment.findMany.mockResolvedValue([
      { id: "ssa1", sportCode: "VB", defaultTraveler: true, user: { id: "u1", name: "Maya", role: "STUDENT", staffingType: null, primaryArea: "PHOTO" } },
      { id: "ssa2", sportCode: "VB", defaultTraveler: false, user: { id: "u2", name: "Erik", role: "ADMIN", staffingType: null, primaryArea: null } },
      { id: "ssa3", sportCode: "VB", defaultTraveler: false, user: { id: "u3", name: "Grad", role: "STAFF", staffingType: "ST", primaryArea: null } },
      { id: "ssa4", sportCode: "FB", defaultTraveler: false, user: { id: "u4", name: "Guest", role: "COLLABORATOR", staffingType: null, primaryArea: null } },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: "u1", name: "Maya", role: "STUDENT", staffingType: null, primaryArea: "PHOTO" },
      { id: "u4", name: "Guest", role: "COLLABORATOR", staffingType: null, primaryArea: null },
    ]);

    const { sports, people } = await getSportSetup();

    expect(sports.slice(0, 6).map((sport) => sport.sportCode)).toEqual(["FB", "MBB", "WBB", "MHKY", "WHKY", "VB"]);
    // After the big six, sports are alphabetical by name.
    const rest = sports.slice(6).map((sport) => sport.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    const vb = sports.find((sport) => sport.sportCode === "VB")!;
    expect(vb.policy).toBe(SportAutoAssignPolicy.STAFF_ONLY);
    expect(vb.staff.map((member) => member.name)).toEqual(["Erik"]);
    expect(vb.students.map((member) => [member.name, member.defaultTraveler])).toEqual([["Maya", true], ["Grad", false]]);
    expect(sports.find((sport) => sport.sportCode === "FB")).toMatchObject({ policy: SportAutoAssignPolicy.FULL_CREW, staff: [], students: [] });
    expect(people).toEqual([{ id: "u1", name: "Maya", role: "STUDENT", workerType: "ST", primaryArea: "PHOTO" }]);
  });
});

describe("matchSportSetup", () => {
  it("copies the policy, and adds only missing roster members with their travel flag", async () => {
    db.sportConfig.findUnique.mockResolvedValue({ autoAssignPolicy: SportAutoAssignPolicy.STAFF_ONLY });
    db.studentSportAssignment.findMany
      .mockResolvedValueOnce([{ userId: "u1", defaultTraveler: true }, { userId: "u2", defaultTraveler: false }, { userId: "u3", defaultTraveler: true }])
      .mockResolvedValueOnce([{ userId: "u3" }]);

    const result = await matchSportSetup({ sourceSportCode: "MBB", targetSportCode: "MHKY", includeRoster: true, actor: admin });

    expect(result).toEqual({ sourceSportCode: "MBB", targetSportCode: "MHKY", policy: SportAutoAssignPolicy.STAFF_ONLY, peopleAdded: 2, travelersAdded: 1 });
    expect(db.sportConfig.upsert).toHaveBeenCalledWith({
      where: { sportCode: "MHKY" },
      create: { sportCode: "MHKY", active: true, autoAssignPolicy: SportAutoAssignPolicy.STAFF_ONLY },
      update: { autoAssignPolicy: SportAutoAssignPolicy.STAFF_ONLY },
    });
    expect(db.studentSportAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u1", sportCode: "MHKY", defaultTraveler: true },
        { userId: "u2", sportCode: "MHKY", defaultTraveler: false },
      ],
      skipDuplicates: true,
    });
    expect(audit).toHaveBeenCalledWith(db, expect.objectContaining({ entityId: "MHKY", action: "sport_setup_matched" }));
    expect(db.$transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it("copies only the policy unless the roster is asked for, using the default when the source has none", async () => {
    db.sportConfig.findUnique.mockResolvedValue(null);

    const result = await matchSportSetup({ sourceSportCode: "SB", targetSportCode: "VB", includeRoster: false, actor: admin });

    expect(result).toMatchObject({ policy: SportAutoAssignPolicy.FULL_CREW, peopleAdded: 0 });
    expect(db.studentSportAssignment.findMany).not.toHaveBeenCalled();
  });

  it("refuses to match a sport to itself", async () => {
    await expect(matchSportSetup({ sourceSportCode: "VB", targetSportCode: "VB", includeRoster: true, actor: admin })).rejects.toMatchObject({ status: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("listBulkAssignmentBatches", () => {
  const now = new Date("2026-10-25T15:00:00.000Z");
  const batch = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    status: "PENDING",
    createdAt: new Date("2026-10-25T14:55:00.000Z"),
    releaseAt: new Date("2026-10-25T15:05:00.000Z"),
    sportCode: "VB",
    rangeStartsAt: new Date("2026-10-26T05:00:00.000Z"),
    rangeEndsAt: new Date("2026-11-02T05:00:00.000Z"),
    createdById: "admin-1",
    items: [
      {
        shiftGroupId: "g1",
        status: "PENDING",
        proposalPayload: [{ shiftId: "s1", userId: "u1" }, { shiftId: "s2", userId: "u2" }, { junk: true }],
        shiftGroup: { event: { id: "e1", summary: "Volleyball vs Nebraska", startsAt: new Date("2026-10-28T00:00:00.000Z") } },
      },
      { shiftGroupId: "g2", status: "SUPERSEDED", proposalPayload: null, shiftGroup: null },
    ],
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers({ now });
    db.user.findMany.mockResolvedValue([{ id: "admin-1", name: "Erik" }]);
    db.auditLog.findMany.mockResolvedValue([]);
  });

  it("shows what each batch will release and whether it can still be taken back", async () => {
    db.scheduleBulkAssignment.findMany.mockResolvedValue([
      batch("open"),
      batch("late", { releaseAt: new Date("2026-10-25T14:59:00.000Z") }),
      batch("done", { status: "RELEASED" }),
      batch("gone"),
    ]);
    db.auditLog.findMany.mockResolvedValue([
      { entityId: "open", action: "schedule_bulk_assignment_created", afterJson: { scope: { sportCodes: ["VB", "WHKY"] } } },
      { entityId: "gone", action: BULK_ASSIGNMENT_CANCEL_ACTION, afterJson: {} },
    ]);

    const batches = await listBulkAssignmentBatches(500);
    vi.useRealTimers();

    expect(db.scheduleBulkAssignment.findMany.mock.calls[0]?.[0]?.take).toBe(50);
    expect(batches.map((b) => [b.id, b.status, b.cancellable])).toEqual([
      ["open", "PENDING", true],
      ["late", "PENDING", false],
      ["done", "RELEASED", false],
      ["gone", "CANCELLED", false],
    ]);
    expect(batches[0]).toMatchObject({
      createdByName: "Erik",
      sportCodes: ["VB", "WHKY"],
      eventCount: 2,
      assignmentCount: 2,
      events: [
        { shiftGroupId: "g1", eventId: "e1", summary: "Volleyball vs Nebraska", startsAt: "2026-10-28T00:00:00.000Z", status: "PENDING", assignmentCount: 2 },
        { shiftGroupId: "g2", eventId: null, summary: null, startsAt: null, status: "SUPERSEDED", assignmentCount: 0 },
      ],
    });
    expect(batches[1]!.sportCodes).toEqual(["VB"]);
  });

  it("asks for nothing more when there are no batches", async () => {
    db.scheduleBulkAssignment.findMany.mockResolvedValue([]);

    expect(await listBulkAssignmentBatches(0)).toEqual([]);
    vi.useRealTimers();
    expect(db.scheduleBulkAssignment.findMany.mock.calls[0]?.[0]?.take).toBe(1);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("cancelBulkAssignmentBatch", () => {
  function pending(items: Array<{ shiftGroupId: string; expectedVersion: number; proposalPayload: unknown }>, status = "PENDING") {
    db.scheduleBulkAssignment.findUnique.mockResolvedValue({ id: "b1", status, releaseAt: new Date(), items });
  }

  it("discards the working copies it wrote, leaves edited ones alone, and records the cancel", async () => {
    pending([
      { shiftGroupId: "g1", expectedVersion: 2, proposalPayload: [{ shiftId: "s1", userId: "u1" }, { shiftId: "s2", userId: "u2" }] },
      { shiftGroupId: "g2", expectedVersion: 1, proposalPayload: [{ shiftId: "s3", userId: "u3" }] },
    ]);
    db.shiftGroupWorkingCopy.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const result = await cancelBulkAssignmentBatch("b1", admin);

    expect(result).toEqual({ batchId: "b1", cancelledEvents: 1, untouchedEvents: 1, assignmentsWithdrawn: 2 });
    expect(db.shiftGroupWorkingCopy.deleteMany.mock.calls[0]?.[0]).toEqual({ where: { shiftGroupId: "g1", version: 2 } });
    expect(db.scheduleBulkAssignmentItem.updateMany).toHaveBeenCalledWith({ where: { bulkAssignmentId: "b1", status: "PENDING" }, data: { status: "SUPERSEDED" } });
    const entries = auditMany.mock.calls[0]?.[1];
    expect(entries.map((entry: { action: string; entityId: string }) => [entry.action, entry.entityId])).toEqual([
      ["working_schedule_discarded", "g1"],
      [BULK_ASSIGNMENT_CANCEL_ACTION, "b1"],
    ]);
    expect(finalize).toHaveBeenCalledWith("b1");
  });

  it.each([
    ["missing", null, 404],
    ["already released", { id: "b1", status: "RELEASED", releaseAt: new Date(), items: [{ shiftGroupId: "g1" }] }, 409],
    ["fully resolved", { id: "b1", status: "PENDING", releaseAt: new Date(), items: [] }, 409],
  ])("refuses a batch that is %s", async (_label, row, status) => {
    db.scheduleBulkAssignment.findUnique.mockResolvedValue(row);

    await expect(cancelBulkAssignmentBatch("b1", admin)).rejects.toMatchObject({ status });
    expect(db.shiftGroupWorkingCopy.deleteMany).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });
});
