import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkAssignmentScope } from "@/lib/bulk-schedule-assignment-types";
import type { CandidateScoringUser } from "@/lib/services/candidate-scoring";

const mocks = vi.hoisted(() => {
  const tx = {
    shiftGroup: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    scheduleBulkAssignment: { create: vi.fn() },
    scheduleBulkAssignmentItem: { createMany: vi.fn() },
    shiftGroupWorkingCopy: { create: vi.fn() },
  };
  return {
    tx,
    transactionOptions: [] as unknown[],
    db: {
      calendarEvent: { findMany: vi.fn(), count: vi.fn() },
      sportConfig: { findMany: vi.fn() },
      studentSportAssignment: { groupBy: vi.fn() },
      scheduleBulkAssignment: { findUnique: vi.fn(), update: vi.fn() },
      scheduleBulkAssignmentItem: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    },
    loadCandidates: vi.fn(),
    checkTimeConflict: vi.fn(),
    createAuditEntriesTx: vi.fn(),
    notify: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/candidate-scoring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/candidate-scoring")>()),
  loadCandidateScoringUsersForRange: mocks.loadCandidates,
}));
vi.mock("@/lib/services/shift-assignments", () => ({ checkTimeConflict: mocks.checkTimeConflict }));
vi.mock("@/lib/audit", () => ({ createAuditEntriesTx: mocks.createAuditEntriesTx }));
vi.mock("@/lib/services/notifications", () => ({ createBulkScheduleAssignmentNotifications: mocks.notify }));

import {
  applyBulkScheduleAssignment,
  finalizeBulkScheduleAssignment,
  getBulkAssignmentPreview,
  recordBulkScheduleReleaseOutcome,
} from "@/lib/services/bulk-schedule-assignment";

// ── Fixtures ────────────────────────────────────────────────────────────────

type ShiftSpec = { id: string; area?: string; workerType: "FT" | "ST"; assignedTo?: string; startsAt?: Date; endsAt?: Date };

function shiftGroup(id: string, startsAt: Date, shifts: ShiftSpec[], overrides: Record<string, unknown> = {}) {
  const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000);
  return {
    id,
    eventId: `ev-${id}`,
    publishedAt: new Date("2026-10-01T12:00:00Z"),
    publishedVersion: 3,
    archivedAt: null,
    event: { id: `ev-${id}`, summary: `Event ${id}`, startsAt, endsAt, allDay: false, sportCode: "FB", opponent: "Iowa", isHome: true },
    shifts: shifts.map((shift, index) => ({
      id: shift.id,
      createdAt: new Date(`2026-10-01T12:0${index}:00Z`),
      area: shift.area ?? "VIDEO",
      workerType: shift.workerType,
      startsAt: shift.startsAt ?? startsAt,
      endsAt: shift.endsAt ?? endsAt,
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      _count: { assignments: shift.assignedTo ? 1 : 0 },
      assignments: shift.assignedTo
        ? [{
            id: `a-${shift.id}`,
            userId: shift.assignedTo,
            status: "DIRECT_ASSIGNED",
            source: "MANUAL",
            callStartsAt: null,
            callEndsAt: null,
            callNote: null,
            trades: [],
            _count: { bookings: 0 },
          }]
        : [],
    })),
    workingCopy: null,
    ...overrides,
  };
}

function eventRow(group: ReturnType<typeof shiftGroup>, overrides: Record<string, unknown> = {}) {
  return {
    id: group.event.id,
    summary: group.event.summary,
    startsAt: group.event.startsAt,
    endsAt: group.event.endsAt,
    allDay: false,
    status: "CONFIRMED",
    sportCode: group.event.sportCode,
    opponent: group.event.opponent,
    isHome: group.event.isHome,
    shiftGroup: group,
    ...overrides,
  };
}

function person(id: string, overrides: Partial<CandidateScoringUser> = {}): CandidateScoringUser {
  const isStudent = id.startsWith("st-");
  return {
    id,
    name: id,
    role: isStudent ? "STUDENT" : "STAFF",
    staffingType: isStudent ? "ST" : "FT",
    primaryArea: "VIDEO",
    areaAssignments: [],
    sportAssignments: [{ sportCode: "FB", defaultTraveler: false }],
    availabilityBlocks: [],
    assignments: [],
    ...overrides,
  } as CandidateScoringUser;
}

/** Live user rows the apply transaction re-validates against. */
function liveUser(candidate: CandidateScoringUser, overrides: Record<string, unknown> = {}) {
  return {
    id: candidate.id,
    active: true,
    role: candidate.role,
    staffingType: candidate.staffingType,
    collaboratorPolicy: null,
    sportAssignments: candidate.sportAssignments,
    availabilityBlocks: [],
    ...overrides,
  };
}

const saturday = new Date("2026-10-24T17:00:00Z");
const sunday = new Date("2026-10-25T17:00:00Z");

const scope: BulkAssignmentScope = {
  sportCodes: [],
  rangeStartsAt: "2026-10-19T05:00:00.000Z",
  rangeEndsAt: "2026-11-02T05:00:00.000Z",
  area: null,
  workerScope: "ALL",
  eventIds: [],
  period: "custom",
} as BulkAssignmentScope;

function given({
  events,
  candidates,
  policies = [],
  travelers = [],
  heldCount = 0,
}: {
  events: ReturnType<typeof eventRow>[];
  candidates: CandidateScoringUser[];
  policies?: Array<{ sportCode: string; autoAssignPolicy: string }>;
  travelers?: Array<{ sportCode: string; count: number }>;
  heldCount?: number;
}) {
  mocks.db.sportConfig.findMany.mockResolvedValue(policies);
  mocks.db.calendarEvent.findMany.mockResolvedValue(events);
  mocks.db.calendarEvent.count.mockResolvedValue(heldCount);
  mocks.db.studentSportAssignment.groupBy.mockResolvedValue(
    travelers.map(({ sportCode, count }) => ({ sportCode, _count: { _all: count } })),
  );
  // Scoring mutates candidates with tentative assignments, so hand out copies.
  mocks.loadCandidates.mockImplementation(async () => candidates.map((candidate) => ({ ...candidate, assignments: [...candidate.assignments] })));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transactionOptions.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown, options?: unknown) => {
    mocks.transactionOptions.push(options);
    return fn(mocks.tx);
  });
  mocks.checkTimeConflict.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Preview ─────────────────────────────────────────────────────────────────

describe("getBulkAssignmentPreview", () => {
  it("fills a staff slot with staff and a student slot with a student", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-ft", workerType: "FT" }, { id: "s-st", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates: [person("staff-1"), person("st-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals.map((p) => [p.shiftId, p.userId])).toEqual([["s-ft", "staff-1"], ["s-st", "st-1"]]);
    expect(preview.events[0]).toMatchObject({ status: "ready", openSlots: 2, unfilledSlots: 0, fullyCrewed: true });
    expect(preview.summary).toMatchObject({ eventsMatched: 1, eventsReady: 1, openSlots: 2, proposed: 2, peopleAffected: 2, eventsFullyCrewed: 1 });
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("gives the same fingerprint for the same data, and a new one when it changes", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates: [person("st-1")] });
    const first = await getBulkAssignmentPreview(scope);
    const second = await getBulkAssignmentPreview(scope);
    expect(second.fingerprint).toBe(first.fingerprint);

    given({ events: [eventRow(shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }], { publishedVersion: 4 }))], candidates: [person("st-1")] });
    expect((await getBulkAssignmentPreview(scope)).fingerprint).not.toBe(first.fingerprint);
  });

  it("draws only from the sport's roster", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates: [person("st-other", { sportAssignments: [{ sportCode: "WVB", defaultTraveler: false }] })] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals).toEqual([]);
    expect(preview.events[0]?.skipped[0]).toMatchObject({ reasonCode: "no_sport_roster", reason: "Nobody is assigned to this sport." });
    expect(preview.events[0]?.skipped[0]?.reasonDetails).toContain("1 are not on the FB roster.");
  });

  it("never proposes a collaborator", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-ft", workerType: "FT" }]);
    given({ events: [eventRow(group)], candidates: [person("collab-1", { role: "COLLABORATOR" } as Partial<CandidateScoringUser>)] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.skipped[0]?.reasonCode).toBe("no_visible_candidates");
  });

  it("gives one person one slot per event", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st-1", workerType: "ST" }, { id: "s-st-2", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates: [person("st-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals.map((p) => p.userId)).toEqual(["st-1"]);
    // The first proposal is held tentatively, so it now overlaps the second slot.
    expect(preview.events[0]?.skipped[0]).toMatchObject({ shiftId: "s-st-2", reasonCode: "overlapping_assignment_blocked" });
    expect(preview.events[0]).toMatchObject({ unfilledSlots: 1, fullyCrewed: false });
    expect(preview.summary.eventsPartiallyCrewed).toBe(1);
  });

  it("does not hand one person two slots of the same event even when the times do not overlap", async () => {
    const hours = (h: number) => new Date(saturday.getTime() + h * 3_600_000);
    const group = shiftGroup("g1", saturday, [
      { id: "s-early", workerType: "ST", startsAt: hours(0), endsAt: hours(1) },
      { id: "s-late", workerType: "ST", startsAt: hours(3), endsAt: hours(4) },
    ]);
    given({ events: [eventRow(group)], candidates: [person("st-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals.map((p) => p.shiftId)).toEqual(["s-early"]);
    expect(preview.events[0]?.skipped[0]).toMatchObject({ shiftId: "s-late", reasonCode: "already_proposed" });
  });

  it("leaves filled slots alone", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST", assignedTo: "st-9" }]);
    given({ events: [eventRow(group)], candidates: [person("st-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(mocks.loadCandidates).not.toHaveBeenCalled();
    expect(preview.events[0]?.skipped[0]).toMatchObject({ reasonCode: "no_open_slots", reason: "This event has no open crew slots." });
  });

  it("keeps student slots open for students to request on a staff-only sport", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-ft", workerType: "FT" }, { id: "s-st", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates: [person("staff-1"), person("st-1")], policies: [{ sportCode: "FB", autoAssignPolicy: "STAFF_ONLY" }] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals.map((p) => p.shiftId)).toEqual(["s-ft"]);
    expect(preview.events[0]).toMatchObject({ openSlots: 1, fullyCrewed: true });
  });

  it("keeps held sports out of the query and still counts them", async () => {
    given({ events: [], candidates: [], policies: [{ sportCode: "FB", autoAssignPolicy: "HOLD" }], heldCount: 3 });

    const preview = await getBulkAssignmentPreview(scope);

    const where = mocks.db.calendarEvent.findMany.mock.calls[0]?.[0].where;
    // A bare notIn would also drop non-sport events, because NOT IN is null for a null column.
    expect(where.OR).toEqual([{ sportCode: null }, { sportCode: { notIn: ["FB"] } }]);
    expect(mocks.db.calendarEvent.count).toHaveBeenCalledWith({ where: expect.objectContaining({ sportCode: { in: ["FB"] } }) });
    expect(preview.summary.eventsOnHold).toBe(3);
  });

  it("skips an event with pending changes instead of stacking a second draft on it", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }], { workingCopy: { version: 2, payload: {} } });
    given({ events: [eventRow(group)], candidates: [person("st-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]).toMatchObject({ status: "skipped", workingVersion: 2 });
    expect(preview.events[0]?.skipped[0]?.reasonCode).toBe("pending_working_copy");
    expect(preview.summary.eventsPendingChanges).toBe(1);
  });

  it("reports an event with no crew schedule", async () => {
    const group = shiftGroup("g1", saturday, []);
    given({ events: [eventRow(group, { shiftGroup: null })], candidates: [] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]).toMatchObject({ status: "skipped", shiftGroupId: null });
    expect(preview.events[0]?.skipped[0]?.reasonCode).toBe("no_shift_group");
  });

  it("crews away games from the travel roster once a sport has one", async () => {
    const away = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    away.event.isHome = false;
    const homebody = person("st-home");
    const traveler = person("st-travel", { sportAssignments: [{ sportCode: "FB", defaultTraveler: true }] });
    given({ events: [eventRow(away)], candidates: [homebody, traveler], travelers: [{ sportCode: "FB", count: 1 }] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals.map((p) => p.userId)).toEqual(["st-travel"]);
  });

  it("names the travel roster when nobody on it can go", async () => {
    const away = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    away.event.isHome = false;
    given({ events: [eventRow(away)], candidates: [person("st-home")], travelers: [{ sportCode: "FB", count: 2 }] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.skipped[0]?.reasonCode).toBe("no_travel_roster");
  });

  it("fills what fits and counts the slot nobody fits", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-ft", workerType: "FT" }, { id: "s-st", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates: [person("staff-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals.map((proposal) => proposal.userId)).toEqual(["staff-1"]);
    expect(preview.events[0]).toMatchObject({ unfilledSlots: 1, fullyCrewed: false });
  });

  it("does not let approved time off be overridden", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    const away = person("st-1", {
      availabilityBlocks: [{ kind: "AD_HOC", intent: "TIME_OFF", status: "APPROVED", date: "2026-10-24", allDay: true, startsAt: "00:00", endsAt: "23:59", label: "Family" }],
    } as Partial<CandidateScoringUser>);
    given({ events: [eventRow(group)], candidates: [away] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events[0]?.proposals).toEqual([]);
    expect(preview.events[0]?.skipped[0]?.reasonCode).toBe("approved_time_off_blocked");
  });

  it("refuses a scope over 200 events before scoring anyone", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    given({ events: Array.from({ length: 201 }, () => eventRow(group)), candidates: [] });

    await expect(getBulkAssignmentPreview(scope)).rejects.toMatchObject({ status: 400 });
    expect(mocks.loadCandidates).not.toHaveBeenCalled();
  });

  it("lists events in start order", async () => {
    const later = shiftGroup("g2", sunday, [{ id: "s-2", workerType: "ST", assignedTo: "st-9" }]);
    const earlier = shiftGroup("g1", saturday, [{ id: "s-1", workerType: "ST" }]);
    given({ events: [eventRow(later), eventRow(earlier)], candidates: [person("st-1")] });

    const preview = await getBulkAssignmentPreview(scope);

    expect(preview.events.map((event) => event.eventId)).toEqual(["ev-g1", "ev-g2"]);
  });
});

// ── Apply ───────────────────────────────────────────────────────────────────

describe("applyBulkScheduleAssignment", () => {
  const actor = { id: "admin-1", role: "ADMIN" as const };
  const release = vi.fn();

  async function previewed(candidates = [person("staff-1"), person("st-1")]) {
    const group = shiftGroup("g1", saturday, [{ id: "s-ft", workerType: "FT" }, { id: "s-st", workerType: "ST" }]);
    given({ events: [eventRow(group)], candidates });
    const preview = await getBulkAssignmentPreview(scope);
    mocks.tx.shiftGroup.findMany.mockResolvedValue([group]);
    mocks.tx.user.findMany.mockResolvedValue(candidates.map((candidate) => liveUser(candidate)));
    release.mockResolvedValue({ at: new Date("2026-10-21T12:00:00Z"), runId: "run-1" });
    const proposals = preview.events.flatMap((event) => event.proposals).map(({ proposalId, shiftGroupId, shiftId, eventId, userId }) => ({
      proposalId, shiftGroupId, shiftId, eventId, userId,
    }));
    return { group, preview, input: { scope, fingerprint: preview.fingerprint, proposals } };
  }

  it("stages the picks as a pending schedule with a release timer", async () => {
    const { input } = await previewed();

    const result = await applyBulkScheduleAssignment(input, actor, release);

    expect(result).toMatchObject({ releaseAt: "2026-10-21T12:00:00.000Z", eventCount: 1, assignmentCount: 2 });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ shiftGroupId: "g1", version: 1, batchId: result.batchId }));
    expect(mocks.transactionOptions[0]).toEqual({ isolationLevel: "Serializable" });
    expect(mocks.tx.scheduleBulkAssignmentItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        bulkAssignmentId: result.batchId,
        shiftGroupId: "g1",
        expectedVersion: 1,
        proposalPayload: [{ shiftId: "s-ft", userId: "staff-1" }, { shiftId: "s-st", userId: "st-1" }],
      })],
    });

    const working = mocks.tx.shiftGroupWorkingCopy.create.mock.calls[0]?.[0].data;
    expect(working).toMatchObject({ shiftGroupId: "g1", version: 1, basePublishedVersion: 3, autoReleaseRunId: "run-1", createdById: "admin-1" });
    // Bulk picks are marked so the crew editor can tell them from hand picks.
    expect(working.payload.slots.map((slot: { assignment: { userId: string; source: string } }) => [slot.assignment.userId, slot.assignment.source]))
      .toEqual([["staff-1", "AUTO_FILL"], ["st-1", "AUTO_FILL"]]);
    expect(mocks.createAuditEntriesTx).toHaveBeenCalledWith(mocks.tx, [expect.objectContaining({ action: "schedule_bulk_assignment_staged", entityId: result.batchId })]);
  });

  it("stages what still fits and reports what it left out", async () => {
    const { input } = await previewed();
    const gone = { ...input.proposals[1]!, proposalId: "g1:s-gone:st-9", shiftId: "s-gone", userId: "st-9" };

    const result = await applyBulkScheduleAssignment({ ...input, proposals: [input.proposals[0]!, gone] }, actor, release);

    expect(result).toMatchObject({ assignmentCount: 1, droppedCount: 1 });
  });

  it("applies a runner-up swapped in during review", async () => {
    const group = shiftGroup("g1", saturday, [{ id: "s-st", workerType: "ST" }]);
    const candidates = [person("st-1"), person("st-2")];
    given({ events: [eventRow(group)], candidates });
    const preview = await getBulkAssignmentPreview(scope);
    mocks.tx.shiftGroup.findMany.mockResolvedValue([group]);
    mocks.tx.user.findMany.mockResolvedValue(candidates.map((candidate) => liveUser(candidate)));
    release.mockResolvedValue({ at: new Date("2026-10-21T12:00:00Z"), runId: "run-1" });
    const [proposal] = preview.events[0]!.proposals;
    const runnerUp = proposal!.alternatives[0]!.userId;
    const { proposalId, shiftGroupId, shiftId, eventId } = proposal!;

    const result = await applyBulkScheduleAssignment(
      { scope, fingerprint: preview.fingerprint, proposals: [{ proposalId, shiftGroupId, shiftId, eventId, userId: runnerUp }] },
      actor,
      release,
    );

    expect(result).toMatchObject({ assignmentCount: 1, droppedCount: 0 });
    expect(mocks.tx.scheduleBulkAssignmentItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ proposalPayload: [{ shiftId: "s-st", userId: runnerUp }] })],
    });
  });

  it("rejects picking the same proposal twice", async () => {
    const { input } = await previewed();

    await expect(applyBulkScheduleAssignment({ ...input, proposals: [input.proposals[0]!, input.proposals[0]!] }, actor, release))
      .rejects.toMatchObject({ status: 400 });
  });

  it("rejects a proposal edited to someone who was not offered", async () => {
    const { input } = await previewed();
    const tampered = [{ ...input.proposals[1]!, userId: "st-9" }];

    await expect(applyBulkScheduleAssignment({ ...input, proposals: tampered }, actor, release))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("available anymore") });
  });

  it("re-checks the roster inside the transaction", async () => {
    const { input } = await previewed();
    mocks.tx.user.findMany.mockResolvedValue([
      liveUser(person("staff-1")),
      liveUser(person("st-1"), { sportAssignments: [] }),
    ]);

    await expect(applyBulkScheduleAssignment(input, actor, release))
      .rejects.toMatchObject({ status: 409, message: "One of the proposed workers is no longer on this event's sport roster." });
    expect(mocks.tx.shiftGroupWorkingCopy.create).not.toHaveBeenCalled();
  });

  it("stops if the sport went on hold after the preview", async () => {
    const { input } = await previewed();
    mocks.db.sportConfig.findMany.mockResolvedValue([{ sportCode: "FB", autoAssignPolicy: "HOLD" }]);

    await expect(applyBulkScheduleAssignment(input, actor, release)).rejects.toMatchObject({ status: 409 });
  });

  it("stops if someone was deactivated after the preview", async () => {
    const { input } = await previewed();
    mocks.tx.user.findMany.mockResolvedValue([liveUser(person("staff-1")), liveUser(person("st-1"), { active: false })]);

    await expect(applyBulkScheduleAssignment(input, actor, release))
      .rejects.toMatchObject({ message: "One of the proposed workers is no longer active." });
  });

  it("re-runs the live conflict check for every pick", async () => {
    const { input } = await previewed();

    await applyBulkScheduleAssignment(input, actor, release);

    expect(mocks.checkTimeConflict.mock.calls.map((call) => call[1])).toEqual(["staff-1", "st-1"]);
  });
});

// ── Release outcome ─────────────────────────────────────────────────────────

describe("bulk release outcome", () => {
  function batch(statuses: string[], overrides: Record<string, unknown> = {}) {
    return { id: "batch-1", notificationSentAt: null, items: statuses.map((status) => ({ status })), ...overrides };
  }

  it("records each event's outcome only while it is still pending", async () => {
    mocks.db.scheduleBulkAssignment.findUnique.mockResolvedValue(batch(["PENDING"]));

    await recordBulkScheduleReleaseOutcome({ batchId: "batch-1", shiftGroupId: "g1", expectedVersion: 1, status: "BLOCKED", error: "Slot changed" });

    expect(mocks.db.scheduleBulkAssignmentItem.updateMany).toHaveBeenCalledWith({
      where: { bulkAssignmentId: "batch-1", shiftGroupId: "g1", expectedVersion: 1, status: "PENDING" },
      data: { status: "BLOCKED", releasedVersion: undefined, error: "Slot changed" },
    });
  });

  it.each([
    [["RELEASED", "RELEASED"], "RELEASED"],
    [["RELEASED", "BLOCKED"], "PARTIAL"],
    [["BLOCKED", "SUPERSEDED"], "BLOCKED"],
  ])("summarizes %j as %s and notifies once", async (statuses, expected) => {
    mocks.db.scheduleBulkAssignment.findUnique.mockResolvedValue(batch(statuses));

    await finalizeBulkScheduleAssignment("batch-1");

    expect(mocks.db.scheduleBulkAssignment.update).toHaveBeenNthCalledWith(1, { where: { id: "batch-1" }, data: { status: expected } });
    expect(mocks.notify).toHaveBeenCalledWith("batch-1");
    expect(mocks.db.scheduleBulkAssignment.update).toHaveBeenNthCalledWith(2, { where: { id: "batch-1" }, data: { notificationSentAt: new Date("2026-10-20T12:00:00Z") } });
  });

  it("waits for every event, and never notifies twice", async () => {
    mocks.db.scheduleBulkAssignment.findUnique.mockResolvedValueOnce(batch(["RELEASED", "PENDING"]));
    await finalizeBulkScheduleAssignment("batch-1");
    mocks.db.scheduleBulkAssignment.findUnique.mockResolvedValueOnce(batch(["RELEASED"], { notificationSentAt: new Date() }));
    await finalizeBulkScheduleAssignment("batch-1");

    expect(mocks.db.scheduleBulkAssignment.update).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
