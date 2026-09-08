import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { collectPublishBlockers } from "@/lib/services/schedule-publication";
import { findTimeConflict } from "@/lib/services/shift-assignments";
import type { WorkingSchedulePayload } from "@/lib/schedule-working-copy";

vi.mock("@/lib/db", () => ({ db: {} }));

const start = new Date("2026-10-03T00:00:00Z");
const end = new Date("2026-10-04T00:00:00Z");
function assignment(day: number, summary: string, overrides = {}) {
  const startsAt = new Date(`2026-10-0${day}T00:00:00Z`);
  const endsAt = new Date(`2026-10-0${day + 1}T00:00:00Z`);
  return { id: `assignment-${day}`, callStartsAt: null, callEndsAt: null, ...overrides,
    shift: { area: "PHOTO", startsAt, endsAt, callStartsAt: null, callEndsAt: null,
      shiftGroup: { event: { id: `event-${day}`, summary, allDay: true, startsAt, endsAt } } } };
}
function context(rows: ReturnType<typeof assignment>[]) {
  return { shiftAssignment: { findMany: vi.fn().mockResolvedValue(rows) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: "worker", name: "Test Worker", active: true,
      role: "STAFF", staffingType: "FT", availabilityBlocks: [] }]) } } as unknown as Prisma.TransactionClient;
}
const payload: WorkingSchedulePayload = {
  eventStartsAt: start.toISOString(), eventEndsAt: end.toISOString(), baseShiftIds: [],
  slots: [{ key: "draft:photo", sourceShiftId: null, area: "PHOTO", workerType: "FT",
    startsAt: start.toISOString(), endsAt: end.toISOString(), callStartsAt: null, callEndsAt: null,
    notes: null, assignmentHistoryCount: 0, assignment: { userId: "worker", sourceAssignmentId: null,
      status: "DIRECT_ASSIGNED", callStartsAt: null, callEndsAt: null, callNote: null,
      bookingCount: 0, activeTradeId: null } }],
};
const group = { shifts: [], publishedVersion: 0,
  workingCopy: { basePublishedVersion: 0, createdAt: new Date("2026-08-17T00:00:00Z") } } as unknown as Parameters<typeof collectPublishBlockers>[1];

describe("staff release conflict context", () => {
  it("identifies the same-day event, not adjacent all-day work, in release preflight", async () => {
    const tx = context([assignment(2, "Hockey vs Robert Morris"), assignment(3, "Football vs Michigan State")]);
    const result = await collectPublishBlockers(tx, group, payload);
    expect(result.staleness).toBeNull();
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]!.code).toBe("time_conflict");
    expect(result.blockers[0]!.message).toContain("Football vs Michigan State");
    expect(result.blockers[0]!.message).toContain("Sat, Oct 3 (all day)");
    expect(result.blockers[0]!.message).not.toContain("Oct 2");
  });

  it("does not reveal event identity through the generic worker conflict path", async () => {
    const tx = context([assignment(3, "Private crew context")]);
    expect(await findTimeConflict(tx, "worker", start, end)).toBe("User already has a shift during this time (PHOTO)");
  });

  it("reports the effective timed override instead of an inherited all-day label", async () => {
    const tx = context([assignment(3, "Timed Football", {
      callStartsAt: new Date("2026-10-03T18:00:00Z"),
      callEndsAt: new Date("2026-10-03T22:00:00Z"),
    })]);
    const message = await findTimeConflict(tx, "worker", start, end, undefined, "staff-release");
    expect(message).toContain("Timed Football");
    expect(message).toContain("1:00 PM");
    expect(message).toContain("5:00 PM");
    expect(message).not.toContain("all day");
  });

  it("allows the adjacent day with half-open boundaries", async () => {
    const tx = context([assignment(2, "Previous day")]);
    expect((await collectPublishBlockers(tx, group, payload)).blockers).toEqual([]);
  });
});
