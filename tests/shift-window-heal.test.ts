import { beforeEach, describe, expect, it, vi } from "vitest";

const { shiftFindMany, shiftUpdate, sportFindMany, transaction } = vi.hoisted(() => ({
  shiftFindMany: vi.fn(),
  shiftUpdate: vi.fn((args: unknown) => args),
  sportFindMany: vi.fn(),
  transaction: vi.fn(async (ops: unknown[]) => ops),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shift: { findMany: shiftFindMany, update: shiftUpdate },
    sportConfig: { findMany: sportFindMany },
    $transaction: transaction,
  },
}));

import { healFullDayShiftWindows } from "@/lib/services/shift-generation";

const event = {
  sportCode: "WHOK",
  startsAt: new Date("2026-11-15T19:00:00.000Z"),
  endsAt: new Date("2026-11-15T21:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  sportFindMany.mockResolvedValue([{ sportCode: "WHOK", shiftStartOffset: 60, shiftEndOffset: 60 }]);
});

describe("healFullDayShiftWindows", () => {
  it("moves full-day slots onto the timed event window and leaves real windows alone", async () => {
    shiftFindMany.mockResolvedValue([
      {
        id: "stale-st",
        workerType: "ST",
        startsAt: new Date("2026-11-16T00:00:00.000Z"),
        endsAt: new Date("2026-11-17T00:00:00.000Z"),
        shiftGroup: { event },
      },
      {
        id: "stale-ft",
        workerType: "FT",
        startsAt: new Date("2026-11-16T00:00:00.000Z"),
        endsAt: new Date("2026-11-17T00:00:00.000Z"),
        shiftGroup: { event },
      },
      {
        id: "fine",
        workerType: "ST",
        startsAt: new Date("2026-11-15T18:00:00.000Z"),
        endsAt: new Date("2026-11-15T22:00:00.000Z"),
        shiftGroup: { event },
      },
    ]);

    await expect(healFullDayShiftWindows()).resolves.toBe(2);
    expect(shiftUpdate).toHaveBeenCalledTimes(2);
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: "stale-st" },
      data: { startsAt: new Date("2026-11-15T18:00:00.000Z"), endsAt: new Date("2026-11-15T22:00:00.000Z") },
    });
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: "stale-ft" },
      data: { startsAt: event.startsAt, endsAt: event.endsAt },
    });
  });

  it("writes nothing when no slot is stale", async () => {
    shiftFindMany.mockResolvedValue([]);
    await expect(healFullDayShiftWindows()).resolves.toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});
