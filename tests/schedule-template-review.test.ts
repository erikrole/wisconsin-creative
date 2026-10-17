import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

vi.mock("@/lib/db", () => ({
  db: {
    shiftGroup: { findUnique: vi.fn() },
    sportConfig: { findUnique: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/candidate-scoring", () => ({
  getCandidateScoresForShiftIds: vi.fn(),
}));

vi.mock("@/lib/services/shift-assignments", () => ({
  directAssignShift: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { getCandidateScoresForShiftIds } from "@/lib/services/candidate-scoring";
import { directAssignShift } from "@/lib/services/shift-assignments";
import {
  applyCopyForwardCrew,
  getScheduleTemplateReview,
} from "@/lib/services/schedule-template-review";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";

const mockDb = db as typeof db & {
  shiftGroup: { findUnique: ReturnType<typeof vi.fn> };
  sportConfig: { findUnique: ReturnType<typeof vi.fn> };
  calendarEvent: { findMany: ReturnType<typeof vi.fn> };
};

const targetGroup = {
  id: "group-target",
  eventId: "event-target",
  manuallyEdited: true,
  event: {
    id: "event-target",
    summary: "Wisconsin Volleyball vs Iowa",
    sportCode: "wvb",
    isHome: true,
    sourceId: "source-1",
    locationId: "fieldhouse",
    startsAt: new Date("2026-10-10T18:00:00.000Z"),
    endsAt: new Date("2026-10-10T21:00:00.000Z"),
  },
  shifts: [
    {
      id: "target-video-st",
      area: "VIDEO",
      workerType: "ST",
      startsAt: new Date("2026-10-10T17:00:00.000Z"),
      endsAt: new Date("2026-10-10T22:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      assignments: [],
    },
    {
      id: "target-video-ft",
      area: "VIDEO",
      workerType: "FT",
      startsAt: new Date("2026-10-10T17:00:00.000Z"),
      endsAt: new Date("2026-10-10T22:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      assignments: [],
    },
  ],
};

const sportConfig = {
  active: true,
  shiftStartOffset: 75,
  shiftEndOffset: 45,
  shiftConfigs: [
    {
      area: "VIDEO",
      homeCount: 1,
      awayCount: 1,
      homeStaffCount: 0,
      homeStudentCount: 1,
      awayStaffCount: 0,
      awayStudentCount: 1,
    },
    {
      area: "PHOTO",
      homeCount: 1,
      awayCount: 1,
      homeStaffCount: 0,
      homeStudentCount: 1,
      awayStaffCount: 0,
      awayStudentCount: 1,
    },
  ],
};

function score(overrides: Partial<CandidateRecommendation> & { userId: string; score: number }): CandidateRecommendation {
  const { userId, score: scoreValue, ...rest } = overrides;
  return {
    userId,
    score: scoreValue,
    bucket: "recommended",
    reasons: [{ code: "primary_area", label: "Primary area match", weight: 20 }],
    warnings: [],
    blockingConflict: false,
    advisoryConflict: false,
    advisoryConflictNote: null,
    workload: { weekAssignments: 0, weekHours: 0, monthAssignments: 0, monthHours: 0, upcomingAssignments: 0 },
    ...rest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.shiftGroup.findUnique.mockResolvedValue(targetGroup);
  mockDb.sportConfig.findUnique.mockResolvedValue(sportConfig);
  mockDb.calendarEvent.findMany.mockResolvedValue([]);
  vi.mocked(getCandidateScoresForShiftIds).mockResolvedValue(new Map());
  vi.mocked(directAssignShift).mockResolvedValue({ id: "assignment-1" } as Awaited<ReturnType<typeof directAssignShift>>);
  vi.mocked(createAuditEntry).mockResolvedValue(undefined);
});

describe("getScheduleTemplateReview", () => {
  it("reports template drift without deleting or overwriting manual slots", async () => {
    const review = await getScheduleTemplateReview("group-target");

    expect(mockDb.sportConfig.findUnique).toHaveBeenCalledWith({
      where: { sportCode: "wvb" },
      select: expect.objectContaining({ active: true, shiftConfigs: expect.any(Object) }),
    });
    expect(review.template.status).toBe("ready");
    expect(review.template.manuallyEdited).toBe(true);
    expect(review.template.message).toContain("Manual slots are preserved");
    expect(review.template.expected).toEqual([
      expect.objectContaining({ area: "VIDEO", workerType: "FT", expected: 0, current: 1 }),
      expect.objectContaining({ area: "VIDEO", workerType: "ST", expected: 1, current: 1 }),
      expect.objectContaining({ area: "PHOTO", workerType: "FT", expected: 0, current: 0 }),
      expect.objectContaining({ area: "PHOTO", workerType: "ST", expected: 1, current: 0 }),
    ]);
    expect(review.template.missing).toEqual([
      expect.objectContaining({ area: "PHOTO", workerType: "ST", count: 1 }),
    ]);
    expect(review.template.extra).toEqual([
      expect.objectContaining({ area: "VIDEO", workerType: "FT", count: 1 }),
    ]);
  });

  it("builds copy-forward proposals from the best previous matching event", async () => {
    mockDb.shiftGroup.findUnique.mockResolvedValue({
      ...targetGroup,
      shifts: [
        ...targetGroup.shifts,
        {
          id: "target-photo-st",
          area: "PHOTO",
          workerType: "ST",
          startsAt: new Date("2026-10-10T17:00:00.000Z"),
          endsAt: new Date("2026-10-10T22:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          assignments: [],
        },
        {
          id: "target-graphics-st",
          area: "GRAPHICS",
          workerType: "ST",
          startsAt: new Date("2026-10-10T17:00:00.000Z"),
          endsAt: new Date("2026-10-10T22:00:00.000Z"),
          callStartsAt: null,
          callEndsAt: null,
          assignments: [],
        },
      ],
    });
    mockDb.calendarEvent.findMany.mockResolvedValue([
      {
        id: "event-source",
        summary: "Wisconsin Volleyball vs Purdue",
        startsAt: new Date("2026-10-01T18:00:00.000Z"),
        isHome: true,
        sourceId: "source-1",
        locationId: "fieldhouse",
        shiftGroup: {
          shifts: [
            {
              id: "source-video-st",
              area: "VIDEO",
              workerType: "ST",
              startsAt: new Date("2026-10-01T17:00:00.000Z"),
              assignments: [{
                id: "source-assignment-video",
                userId: "student-active",
                status: "DIRECT_ASSIGNED",
                user: { id: "student-active", name: "Active Student", role: "STUDENT", staffingType: "ST", active: true },
              }],
            },
            {
              id: "source-photo-st",
              area: "PHOTO",
              workerType: "ST",
              startsAt: new Date("2026-10-01T17:00:00.000Z"),
              assignments: [{
                id: "source-assignment-photo",
                userId: "student-inactive",
                status: "DIRECT_ASSIGNED",
                user: { id: "student-inactive", name: "Inactive Student", role: "STUDENT", staffingType: "ST", active: false },
              }],
            },
            {
              id: "source-graphics-st",
              area: "GRAPHICS",
              workerType: "ST",
              startsAt: new Date("2026-10-01T17:00:00.000Z"),
              assignments: [{
                id: "source-assignment-graphics",
                userId: "student-time-off",
                status: "DIRECT_ASSIGNED",
                user: { id: "student-time-off", name: "Time Off Student", role: "STUDENT", staffingType: "ST", active: true },
              }],
            },
          ],
        },
      },
    ]);
    vi.mocked(getCandidateScoresForShiftIds).mockImplementation(async (shiftIds) => {
      const scores = new Map<string, CandidateRecommendation[]>();
      for (const shiftId of shiftIds) {
        if (shiftId === "target-video-st") {
          scores.set(shiftId, [score({ userId: "student-active", score: 92 })]);
        } else if (shiftId === "target-graphics-st") {
          scores.set(shiftId, [
            score({
              userId: "student-time-off",
              score: 20,
              blockingConflict: true,
              advisoryConflict: true,
              advisoryConflictNote: "Approved time off 09:00-17:00",
              warnings: [{ code: "approved_time_off", label: "Approved time off 09:00-17:00", weight: -70 }],
            }),
          ]);
        } else {
          scores.set(shiftId, []);
        }
      }
      return scores;
    });

    const review = await getScheduleTemplateReview("group-target");

    expect(review.copyForward.sourceEvent?.id).toBe("event-source");
    expect(review.copyForward.proposals).toEqual([
      expect.objectContaining({
        shiftId: "target-video-st",
        sourceAssignmentId: "source-assignment-video",
        userId: "student-active",
        userStaffingType: "ST",
      }),
    ]);
    expect(review.copyForward.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ shiftId: "target-photo-st", reason: "Source worker is inactive." }),
      expect.objectContaining({ shiftId: "target-graphics-st", reason: "Approved time off 09:00-17:00" }),
    ]));
  });
});

describe("applyCopyForwardCrew", () => {
  it("recomputes preview, applies through direct assignment checks, and audits the outcome", async () => {
    mockDb.calendarEvent.findMany.mockResolvedValue([
      {
        id: "event-source",
        summary: "Wisconsin Volleyball vs Purdue",
        startsAt: new Date("2026-10-01T18:00:00.000Z"),
        isHome: true,
        sourceId: "source-1",
        locationId: "fieldhouse",
        shiftGroup: {
          shifts: [
            {
              id: "source-video-st",
              area: "VIDEO",
              workerType: "ST",
              startsAt: new Date("2026-10-01T17:00:00.000Z"),
              assignments: [{
                id: "source-assignment-video",
                userId: "student-active",
                status: "DIRECT_ASSIGNED",
                user: { id: "student-active", name: "Active Student", role: "STUDENT", staffingType: "ST", active: true },
              }],
            },
            {
              id: "source-video-ft",
              area: "VIDEO",
              workerType: "FT",
              startsAt: new Date("2026-10-01T17:00:00.000Z"),
              assignments: [{
                id: "source-assignment-ft",
                userId: "staff-busy",
                status: "DIRECT_ASSIGNED",
                user: { id: "staff-busy", name: "Busy Staff", role: "STAFF", staffingType: "FT", active: true },
              }],
            },
          ],
        },
      },
    ]);
    vi.mocked(getCandidateScoresForShiftIds).mockImplementation(async (shiftIds) => {
      const scores = new Map<string, CandidateRecommendation[]>();
      for (const shiftId of shiftIds) {
        if (shiftId === "target-video-st") scores.set(shiftId, [score({ userId: "student-active", score: 92 })]);
        else if (shiftId === "target-video-ft") scores.set(shiftId, [score({ userId: "staff-busy", score: 88 })]);
        else scores.set(shiftId, []);
      }
      return scores;
    });
    vi.mocked(directAssignShift).mockImplementation(async (shiftId) => {
      if (shiftId === "target-video-ft") throw new HttpError(409, "This shift already has an active assignment");
      return { id: `assignment-${shiftId}` } as Awaited<ReturnType<typeof directAssignShift>>;
    });

    const result = await applyCopyForwardCrew("group-target", { id: "staff-1", role: "STAFF" });

    expect(directAssignShift).toHaveBeenCalledWith("target-video-st", "student-active", "staff-1");
    expect(directAssignShift).toHaveBeenCalledWith("target-video-ft", "staff-busy", "staff-1");
    expect(result.assigned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({ shiftId: "target-video-ft", status: "skipped", reason: "This shift already has an active assignment" }),
      expect.objectContaining({ shiftId: "target-video-st", status: "assigned" }),
    ]);
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "staff-1",
      actorRole: "STAFF",
      entityType: "shift_group",
      entityId: "group-target",
      action: "shift_group_copy_forward_applied",
      after: expect.objectContaining({ sourceEventId: "event-source", assigned: 1, skipped: 1 }),
    }));
  });
});
