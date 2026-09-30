import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role, SportAutoAssignPolicy } from "@prisma/client";
import type { BulkAssignmentScope } from "@/lib/bulk-schedule-assignment-types";

const m = vi.hoisted(() => ({
  events: vi.fn(), count: vi.fn(), policies: vi.fn(), travel: vi.fn(), candidates: vi.fn(), score: vi.fn(),
  batch: vi.fn(), update: vi.fn(), outcome: vi.fn(), notify: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  calendarEvent: { findMany: m.events, count: m.count },
  scheduleBulkAssignment: { findUnique: m.batch, update: m.update },
  scheduleBulkAssignmentItem: { updateMany: m.outcome }, $transaction: m.transaction,
} }));
vi.mock("@/lib/services/sport-auto-assign-policies", () => ({ loadSportAutoAssignPolicies: m.policies, loadTravelRosterCounts: m.travel }));
vi.mock("@/lib/services/candidate-scoring", () => ({ loadCandidateScoringUsersForRange: m.candidates, scoreCandidatesForShift: m.score }));
vi.mock("@/lib/services/notifications", () => ({ createBulkScheduleAssignmentNotifications: m.notify }));
import { applyBulkScheduleAssignment, finalizeBulkScheduleAssignment, getBulkAssignmentPreview, recordBulkScheduleReleaseOutcome } from "@/lib/services/bulk-schedule-assignment";

const scope: BulkAssignmentScope = { sportCodes: [], rangeStartsAt: "2026-09-01T00:00:00Z", rangeEndsAt: "2026-10-01T00:00:00Z", area: null, workerScope: "ALL", requireFullCrew: true, period: "custom" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  m.events.mockResolvedValue([]); m.count.mockResolvedValue(0);
  m.policies.mockResolvedValue(new Map()); m.travel.mockResolvedValue(new Map());
  m.notify.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("bulk schedule preview safety", () => {
  it.each(["pending_working_copy", "sport_policy_hold"])("excludes %s before scoring workers", async (reasonCode) => {
    const event = { id: "event", summary: "Game", startsAt: new Date("2026-09-02T12:00:00Z"), endsAt: new Date("2026-09-02T15:00:00Z"), status: "CONFIRMED", sportCode: "FB", isHome: true, allDay: false, opponent: null,
      shiftGroup: { id: "group", archivedAt: null, publishedVersion: 2, workingCopy: reasonCode === "pending_working_copy" ? { version: 1, payload: {} } : null } };
    m.events.mockResolvedValue([event]);
    if (reasonCode === "sport_policy_hold") m.policies.mockResolvedValue(new Map([["FB", SportAutoAssignPolicy.HOLD]]));
    const result = await getBulkAssignmentPreview(scope);
    expect(result.events).toEqual([expect.objectContaining({ eventId: "event", status: "skipped", proposals: [], skipped: [expect.objectContaining({ reasonCode })] })]);
    expect(result.summary.proposed).toBe(0);
    expect(m.candidates).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it.each(["stale fingerprint", "forged proposal"])("rejects a %s before timers or writes", async (scenario) => {
    const event = { id: "event", summary: "Production", startsAt: new Date("2026-09-02T12:00:00Z"), endsAt: new Date("2026-09-02T15:00:00Z"), status: "CONFIRMED", sportCode: null, isHome: true };
    m.events.mockResolvedValue([{ ...event, shiftGroup: { id: "group", event, publishedVersion: 2, archivedAt: null, workingCopy: null,
      shifts: [{ id: "shift", area: "PHOTO", workerType: "FT", notes: null, _count: { assignments: 0 }, assignments: [] }] } }]);
    m.candidates.mockImplementation(async () => [{ id: "user", name: "Staff", role: Role.STAFF, assignments: [], sportAssignments: [] }]);
    m.score.mockReturnValue([{ userId: "user", score: 80, bucket: "recommended", reasons: [{ code: "primary_area" }], warnings: [], blockingConflict: false, advisoryConflict: false, advisoryConflictNote: null }]);
    const preview = await getBulkAssignmentPreview(scope);
    expect(preview.events[0]?.proposals).toHaveLength(1);
    const proposal = preview.events[0]!.proposals[0]!;
    const enqueue = vi.fn();
    await expect(applyBulkScheduleAssignment({ scope, fingerprint: scenario === "stale fingerprint" ? "0".repeat(64) : preview.fingerprint, proposals: [{ ...proposal, userId: scenario === "forged proposal" ? "different-user" : proposal.userId }] }, { id: "staff", role: Role.STAFF }, enqueue)).rejects.toMatchObject({ status: 409 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });
});

describe("bulk schedule release completion", () => {
  it.each([
    { statuses: ["RELEASED", "RELEASED"], expected: "RELEASED" },
    { statuses: ["RELEASED", "BLOCKED"], expected: "PARTIAL" },
    { statuses: ["BLOCKED", "SUPERSEDED"], expected: "BLOCKED" },
  ])("classifies $statuses as $expected and then marks notification completion", async ({ statuses, expected }) => {
    m.batch.mockResolvedValue({ id: "batch", notificationSentAt: null, items: statuses.map(status => ({ status })) });
    await finalizeBulkScheduleAssignment("batch");
    expect(m.update).toHaveBeenNthCalledWith(1, { where: { id: "batch" }, data: { status: expected } });
    expect(m.notify).toHaveBeenCalledExactlyOnceWith("batch");
    expect(m.update).toHaveBeenNthCalledWith(2, { where: { id: "batch" }, data: { notificationSentAt: expect.any(Date) } });
    expect(m.notify.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[1]!);
  });

  it.each([
    { name: "missing batch", batch: null },
    { name: "empty batch", batch: { items: [], notificationSentAt: null } },
    { name: "unfinished release", batch: { items: [{ status: "RELEASED" }, { status: "PENDING" }], notificationSentAt: null } },
    { name: "already notified", batch: { items: [{ status: "RELEASED" }], notificationSentAt: new Date("2026-09-01") } },
  ])("does not notify a $name", async ({ batch }) => {
    m.batch.mockResolvedValue(batch);
    await finalizeBulkScheduleAssignment("batch");
    expect(m.notify).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });

  it("leaves failed notification delivery retryable", async () => {
    m.batch.mockResolvedValue({ items: [{ status: "RELEASED" }], notificationSentAt: null });
    m.notify.mockRejectedValue(new Error("Delivery unavailable"));
    await expect(finalizeBulkScheduleAssignment("batch")).rejects.toThrow("Delivery unavailable");
    expect(m.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "batch" }, data: { status: "RELEASED" } });
  });

  it("records an outcome only for the pending item at the requested version", async () => {
    m.batch.mockResolvedValue({ items: [{ status: "PENDING" }], notificationSentAt: null });
    await recordBulkScheduleReleaseOutcome({ batchId: "batch", shiftGroupId: "group", expectedVersion: 3, status: "RELEASED", releasedVersion: 4 });
    expect(m.outcome).toHaveBeenCalledExactlyOnceWith({ where: { bulkAssignmentId: "batch", shiftGroupId: "group", expectedVersion: 3, status: "PENDING" }, data: { status: "RELEASED", releasedVersion: 4, error: null } });
    expect(m.notify).not.toHaveBeenCalled();
  });
});
