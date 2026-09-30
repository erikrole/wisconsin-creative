import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShiftArea } from "@prisma/client";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    sportConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    sportShiftConfig: {
      upsert: vi.fn(),
    },
    studentSportAssignment: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
    },
  };

  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      // Direct access for non-transactional queries
      sportConfig: mockTx.sportConfig,
      sportShiftConfig: mockTx.sportShiftConfig,
      studentSportAssignment: mockTx.studentSportAssignment,
      _mockTx: mockTx,
    },
  };
});

import { db } from "@/lib/db";
import {
  getAllSportConfigs,
  getSportConfig,
  upsertSportConfig,
  toggleSportConfig,
  getSportRoster,
  addToRoster,
  removeFromRoster,
  bulkAddToRoster,
} from "@/lib/services/sport-configs";

type SportConfigMockTx = {
  sportConfig: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  sportShiftConfig: {
    upsert: ReturnType<typeof vi.fn>;
  };
  studentSportAssignment: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

function sportConfigRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.sportConfig.findMany>>;
}

function sportConfigRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.sportConfig.findUnique>>;
}

function sportConfigUpdateRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.sportConfig.update>>;
}

function studentSportAssignmentRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.studentSportAssignment.findMany>>;
}

function studentSportAssignmentRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.studentSportAssignment.create>>;
}

function createManyResult(count: number) {
  return { count } as Awaited<ReturnType<typeof db.studentSportAssignment.createMany>>;
}

function deleteResult(row: unknown) {
  return row as Awaited<ReturnType<typeof db.studentSportAssignment.delete>>;
}

const mockTx = (db as unknown as { _mockTx: SportConfigMockTx })._mockTx;

beforeEach(() => {
  transactionCalls.length = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// getAllSportConfigs
// ═════════════════════════════════════════════════════════════════════════════
describe("getAllSportConfigs", () => {
  it("returns all sport configs ordered by sportCode", async () => {
    const configs = [
      { id: "sc-1", sportCode: "FB", active: true, shiftConfigs: [] },
      { id: "sc-2", sportCode: "MBB", active: true, shiftConfigs: [] },
    ];
    vi.mocked(db.sportConfig.findMany).mockResolvedValue(sportConfigRows(configs));

    const result = await getAllSportConfigs();

    expect(result).toEqual(configs);
    expect(db.sportConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { shiftConfigs: true },
        orderBy: { sportCode: "asc" },
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getSportConfig
// ═════════════════════════════════════════════════════════════════════════════
describe("getSportConfig", () => {
  it("returns a single sport config by sportCode", async () => {
    const config = { id: "sc-1", sportCode: "FB", active: true, shiftConfigs: [] };
    vi.mocked(db.sportConfig.findUnique).mockResolvedValue(sportConfigRow(config));

    const result = await getSportConfig("FB");

    expect(result).toEqual(config);
    expect(db.sportConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sportCode: "FB" },
      })
    );
  });

  it("returns null when sport config not found", async () => {
    vi.mocked(db.sportConfig.findUnique).mockResolvedValue(null);

    const result = await getSportConfig("NONEXISTENT");

    expect(result).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// upsertSportConfig
// ═════════════════════════════════════════════════════════════════════════════
describe("upsertSportConfig", () => {
  it("creates a new sport config with shift configs", async () => {
    const config = { id: "sc-1", sportCode: "FB", active: true };
    mockTx.sportConfig.upsert.mockResolvedValue(config);
    mockTx.sportShiftConfig.upsert.mockResolvedValue({});
    mockTx.sportConfig.findUnique.mockResolvedValue({
      ...config,
      shiftConfigs: [{ area: ShiftArea.VIDEO, homeCount: 4, awayCount: 2 }],
    });

    const result = await upsertSportConfig("FB", true, [
      { area: ShiftArea.VIDEO, homeCount: 4, awayCount: 2 },
    ]);

    expect(mockTx.sportConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sportCode: "FB" },
      })
    );
    expect(mockTx.sportShiftConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mockTx.sportShiftConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          homeCount: 4,
          homeStaffCount: 0,
          homeStudentCount: 4,
          awayCount: 2,
          awayStaffCount: 0,
          awayStudentCount: 2,
        }),
        update: expect.objectContaining({
          homeCount: 4,
          homeStaffCount: 0,
          homeStudentCount: 4,
          awayCount: 2,
          awayStaffCount: 0,
          awayStudentCount: 2,
        }),
      })
    );
    expect(result!.shiftConfigs).toHaveLength(1);
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("stores separate staff and student counts while preserving legacy totals", async () => {
    mockTx.sportConfig.upsert.mockResolvedValue({ id: "sc-1" });
    mockTx.sportShiftConfig.upsert.mockResolvedValue({});
    mockTx.sportConfig.findUnique.mockResolvedValue({ id: "sc-1", shiftConfigs: [] });

    await upsertSportConfig("FB", true, [
      {
        area: ShiftArea.VIDEO,
        homeStaffCount: 1,
        homeStudentCount: 2,
        awayStaffCount: 1,
        awayStudentCount: 1,
      },
    ]);

    expect(mockTx.sportShiftConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          homeCount: 3,
          homeStaffCount: 1,
          homeStudentCount: 2,
          awayCount: 2,
          awayStaffCount: 1,
          awayStudentCount: 1,
        }),
        update: expect.objectContaining({
          homeCount: 3,
          homeStaffCount: 1,
          homeStudentCount: 2,
          awayCount: 2,
          awayStaffCount: 1,
          awayStudentCount: 1,
        }),
      })
    );
  });

  it("passes shiftStartOffset and shiftEndOffset when provided", async () => {
    mockTx.sportConfig.upsert.mockResolvedValue({ id: "sc-1" });
    mockTx.sportConfig.findUnique.mockResolvedValue({ id: "sc-1", shiftConfigs: [] });

    await upsertSportConfig("FB", true, [], -60, 30);

    expect(mockTx.sportConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shiftStartOffset: -60,
          shiftEndOffset: 30,
        }),
        update: expect.objectContaining({
          shiftStartOffset: -60,
          shiftEndOffset: 30,
        }),
      })
    );
  });

  it("upserts multiple shift config areas", async () => {
    mockTx.sportConfig.upsert.mockResolvedValue({ id: "sc-1" });
    mockTx.sportShiftConfig.upsert.mockResolvedValue({});
    mockTx.sportConfig.findUnique.mockResolvedValue({ id: "sc-1", shiftConfigs: [] });

    await upsertSportConfig("FB", true, [
      { area: ShiftArea.VIDEO, homeCount: 4, awayCount: 2 },
      { area: ShiftArea.PHOTO, homeCount: 3, awayCount: 1 },
    ]);

    expect(mockTx.sportShiftConfig.upsert).toHaveBeenCalledTimes(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// toggleSportConfig
// ═════════════════════════════════════════════════════════════════════════════
describe("toggleSportConfig", () => {
  it("toggles a sport config active state", async () => {
    vi.mocked(db.sportConfig.update).mockResolvedValue(sportConfigUpdateRow({
      id: "sc-1",
      sportCode: "FB",
      active: false,
      shiftConfigs: [],
    }));

    const result = await toggleSportConfig("FB", false);

    expect(db.sportConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sportCode: "FB" },
        data: { active: false },
      })
    );
    expect(result.active).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Roster operations
// ═════════════════════════════════════════════════════════════════════════════
describe("getSportRoster", () => {
  it("returns roster with user details", async () => {
    vi.mocked(db.studentSportAssignment.findMany).mockResolvedValue(studentSportAssignmentRows([
      {
        id: "ssa-1",
        userId: "u-1",
        sportCode: "FB",
        defaultTraveler: true,
        user: { id: "u-1", name: "Student 1", email: "s1@uw.edu", role: "STUDENT", primaryArea: null },
        createdAt: new Date("2026-01-01"),
      },
    ]));

    const result = await getSportRoster("FB");

    expect(result).toHaveLength(1);
    expect(result[0]!.userId).toBe("u-1");
    expect(result[0]!.user.name).toBe("Student 1");
    // The event Travel card's plane toggle reads this flag; without it the
    // toggle could only ever set true.
    expect(result[0]!.defaultTraveler).toBe(true);
  });

  it("lists only active, visible people", async () => {
    vi.mocked(db.studentSportAssignment.findMany).mockResolvedValue(studentSportAssignmentRows([]));

    await getSportRoster("FB");

    expect(vi.mocked(db.studentSportAssignment.findMany).mock.calls[0]?.[0]).toMatchObject({
      where: { sportCode: "FB", user: { active: true, hiddenFromRoster: false } },
    });
  });
});

describe("addToRoster", () => {
  it("creates a sport assignment", async () => {
    vi.mocked(db.studentSportAssignment.create).mockResolvedValue(studentSportAssignmentRow({
      id: "ssa-new",
      userId: "u-1",
      sportCode: "FB",
      user: { id: "u-1", name: "Student 1" },
    }));

    await addToRoster("u-1", "FB");

    expect(db.studentSportAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: "u-1", sportCode: "FB" },
      })
    );
  });
});

describe("removeFromRoster", () => {
  it("deletes a sport assignment", async () => {
    vi.mocked(db.studentSportAssignment.delete).mockResolvedValue(deleteResult({}));

    await removeFromRoster("ssa-1");

    expect(db.studentSportAssignment.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ssa-1" },
      })
    );
  });
});

describe("bulkAddToRoster", () => {
  it("creates multiple assignments and returns updated roster", async () => {
    vi.mocked(db.studentSportAssignment.createMany).mockResolvedValue(createManyResult(2));
    vi.mocked(db.studentSportAssignment.findMany).mockResolvedValue(studentSportAssignmentRows([
      { id: "ssa-1", userId: "u-1", sportCode: "FB", user: { id: "u-1", name: "S1" }, createdAt: new Date() },
      { id: "ssa-2", userId: "u-2", sportCode: "FB", user: { id: "u-2", name: "S2" }, createdAt: new Date() },
    ]));

    const result = await bulkAddToRoster(["u-1", "u-2"], "FB");

    expect(db.studentSportAssignment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
      })
    );
    expect(result).toHaveLength(2);
  });
});
