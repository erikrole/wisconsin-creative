import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    studentAvailabilityBlock: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    shift: {
      findUnique: vi.fn(),
    },
    shiftAssignment: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    notification: {
      createManyAndReturn: vi.fn(async () => [{ id: "notification-1" }]),
    },
  },
}));

vi.mock("@/lib/services/notifications", () => ({
  deferPush: vi.fn(),
  sendPushToUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    enforceRateLimit: vi.fn(),
  };
});

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { sendPushToUser } from "@/lib/services/notifications";
import { POST as createAvailability } from "@/app/api/users/[id]/availability/route";
import {
  DELETE as deleteAvailability,
  PATCH as updateAvailability,
} from "@/app/api/users/[id]/availability/[blockId]/route";
import { GET as getShiftConflicts } from "@/app/api/shifts/[id]/conflicts/route";

const studentUser = {
  id: "student-1",
  email: "student@example.com",
  name: "Student One",
  role: "STUDENT" as const,
  staffingType: "ST" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

const staffUser = {
  ...studentUser,
  id: "staff-1",
  role: "STAFF" as const,
};

function jsonRequest(path: string, method: string, body?: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

describe("student availability routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "student-1",
      role: "STUDENT",
      staffingType: "ST",
      availabilityBlocks: [],
    } as never);
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([] as never);
    vi.mocked(db.shiftAssignment.update).mockResolvedValue({} as never);
  });

  it("lets a student create an ad hoc conflict for themself and audits it", async () => {
    vi.mocked(db.studentAvailabilityBlock.create).mockResolvedValue({
      id: "block-1",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: null,
      date: new Date("2026-10-06T00:00:00.000Z"),
      startsAt: "10:00",
      endsAt: "11:00",
      label: "Exam",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await createAvailability(
      jsonRequest("/api/users/student-1/availability", "POST", {
        kind: "AD_HOC",
        date: "2026-10-06",
        startsAt: "10:00",
        endsAt: "11:00",
        label: "Exam",
      }),
      params({ id: "student-1" }),
    );

    expect(res.status).toBe(201);
    expect(db.studentAvailabilityBlock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "student-1",
        kind: "AD_HOC",
        dayOfWeek: null,
        date: new Date("2026-10-06T00:00:00.000Z"),
      }),
    });
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "student-1",
      entityType: "student_availability_block",
      action: "student_availability_created",
    }));
    expect(db.shiftAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "student-1",
      }),
    }));
  });

  it("persists an inclusive all-day range for a one-off day away", async () => {
    vi.mocked(db.studentAvailabilityBlock.create).mockResolvedValue({
      id: "block-range",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: null,
      date: new Date("2026-10-08T00:00:00.000Z"),
      dateEndsOn: new Date("2026-10-10T00:00:00.000Z"),
      allDay: true,
      startsAt: "00:00",
      endsAt: "23:59",
      label: "Friends visiting",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await createAvailability(
      jsonRequest("/api/users/student-1/availability", "POST", {
        kind: "AD_HOC",
        date: "2026-10-08",
        dateEndsOn: "2026-10-10",
        allDay: true,
        startsAt: "00:00",
        endsAt: "23:59",
        label: "Friends visiting",
      }),
      params({ id: "student-1" }),
    );

    expect(res.status).toBe(201);
    expect(db.studentAvailabilityBlock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        date: new Date("2026-10-08T00:00:00.000Z"),
        dateEndsOn: new Date("2026-10-10T00:00:00.000Z"),
        allDay: true,
        startsAt: "00:00",
        endsAt: "23:59",
      }),
    });
  });

  it("recomputes future active assignment conflicts after creating availability", async () => {
    const block = {
      id: "block-1",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: null,
      date: new Date("2026-10-06T00:00:00.000Z"),
      startsAt: "10:00",
      endsAt: "11:00",
      label: "Exam",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(db.studentAvailabilityBlock.create).mockResolvedValue(block as never);
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce({ id: "student-1", role: "STUDENT", staffingType: "ST" } as never)
      .mockResolvedValueOnce({
        id: "student-1",
        role: "STUDENT",
        staffingType: "ST",
        availabilityBlocks: [block],
      } as never);
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([{
      id: "assignment-1",
      hasConflict: false,
      conflictNote: null,
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-10-06T13:00:00.000Z"),
        endsAt: new Date("2026-10-06T17:00:00.000Z"),
        callStartsAt: new Date("2026-10-06T15:15:00.000Z"),
        callEndsAt: new Date("2026-10-06T15:45:00.000Z"),
      },
    }] as never);

    const res = await createAvailability(
      jsonRequest("/api/users/student-1/availability", "POST", {
        kind: "AD_HOC",
        date: "2026-10-06",
        startsAt: "10:00",
        endsAt: "11:00",
        label: "Exam",
      }),
      params({ id: "student-1" }),
    );

    expect(res.status).toBe(201);
    expect(db.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: {
        hasConflict: true,
        conflictNote: "Conflicts with Exam (10:00-11:00)",
      },
    });
  });

  it("creates student time-off requests as pending and keeps them auditable", async () => {
    vi.mocked(db.studentAvailabilityBlock.create).mockResolvedValue({
      id: "block-2",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "TIME_OFF",
      status: "PENDING",
      dayOfWeek: null,
      date: new Date("2026-10-10T00:00:00.000Z"),
      startsAt: "09:00",
      endsAt: "17:00",
      label: "Family trip",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await createAvailability(
      jsonRequest("/api/users/student-1/availability", "POST", {
        kind: "AD_HOC",
        intent: "TIME_OFF",
        date: "2026-10-10",
        startsAt: "09:00",
        endsAt: "17:00",
        label: "Family trip",
      }),
      params({ id: "student-1" }),
    );

    expect(res.status).toBe(201);
    expect(db.studentAvailabilityBlock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        intent: "TIME_OFF",
        status: "PENDING",
        reviewedAt: null,
        reviewedById: null,
      }),
    });
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      after: expect.objectContaining({ intent: "TIME_OFF", status: "PENDING" }),
    }));
  });

  it("lets a staff-access user with Student scheduling class own availability", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "staff-student-1",
      email: "staff-student@example.com",
      name: "Staff Access Student",
      role: "STAFF",
      staffingType: "ST",
      avatarUrl: null,
      forcePasswordChange: false,
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "staff-student-1", role: "STAFF", staffingType: "ST" } as never);
    vi.mocked(db.studentAvailabilityBlock.create).mockResolvedValue({
      id: "block-staff-student",
      userId: "staff-student-1",
      kind: "WEEKLY",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: 1,
      date: null,
      startsAt: "09:00",
      endsAt: "10:00",
      label: "Class",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await createAvailability(
      jsonRequest("/api/users/staff-student-1/availability", "POST", {
        kind: "WEEKLY",
        dayOfWeek: 1,
        startsAt: "09:00",
        endsAt: "10:00",
        label: "Class",
      }),
      params({ id: "staff-student-1" }),
    );

    expect(res.status).toBe(201);
    expect(db.studentAvailabilityBlock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "staff-student-1",
        kind: "WEEKLY",
      }),
    });
  });

  it("rejects availability creation for Staff scheduling class targets", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "staff-1", role: "STAFF", staffingType: "FT" } as never);

    const res = await createAvailability(
      jsonRequest("/api/users/staff-1/availability", "POST", {
        kind: "WEEKLY",
        dayOfWeek: 1,
        startsAt: "09:00",
        endsAt: "10:00",
      }),
      params({ id: "staff-1" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Availability is only available for Student scheduling class");
    expect(db.studentAvailabilityBlock.create).not.toHaveBeenCalled();
  });

  it("denies students editing another student's availability", async () => {
    const res = await createAvailability(
      jsonRequest("/api/users/student-2/availability", "POST", {
        kind: "WEEKLY",
        dayOfWeek: 1,
        startsAt: "09:00",
        endsAt: "10:00",
      }),
      params({ id: "student-2" }),
    );

    expect(res.status).toBe(403);
    expect(db.studentAvailabilityBlock.create).not.toHaveBeenCalled();
  });

  it("lets staff update a weekly semester block and audits before and after", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.studentAvailabilityBlock.findUnique).mockResolvedValue({
      id: "block-1",
      userId: "student-1",
      kind: "WEEKLY",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: 1,
      date: null,
      startsAt: "09:00",
      endsAt: "10:00",
      label: "Old",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(db.studentAvailabilityBlock.update).mockResolvedValue({
      id: "block-1",
      userId: "student-1",
      kind: "WEEKLY",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: 2,
      date: null,
      startsAt: "09:30",
      endsAt: "10:45",
      label: "COMM 201",
      semesterLabel: "Fall 2026",
      semesterStartsOn: new Date("2026-08-24T00:00:00.000Z"),
      semesterEndsOn: new Date("2026-12-18T00:00:00.000Z"),
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await updateAvailability(
      jsonRequest("/api/users/student-1/availability/block-1", "PATCH", {
        kind: "WEEKLY",
        dayOfWeek: 2,
        startsAt: "09:30",
        endsAt: "10:45",
        label: "COMM 201",
        semesterLabel: "Fall 2026",
        semesterStartsOn: "2026-08-24",
        semesterEndsOn: "2026-12-18",
      }),
      params({ id: "student-1", blockId: "block-1" }),
    );

    expect(res.status).toBe(200);
    expect(db.studentAvailabilityBlock.update).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({
        kind: "WEEKLY",
        dayOfWeek: 2,
        semesterStartsOn: new Date("2026-08-24T00:00:00.000Z"),
        semesterEndsOn: new Date("2026-12-18T00:00:00.000Z"),
      }),
    });
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "staff-1",
      action: "student_availability_updated",
      before: expect.objectContaining({ label: "Old" }),
      after: expect.objectContaining({ label: "COMM 201" }),
    }));
  });

  it("denies a student trying to approve their own time off", async () => {
    vi.mocked(db.studentAvailabilityBlock.findUnique).mockResolvedValue({
      id: "block-2",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "TIME_OFF",
      status: "PENDING",
      dayOfWeek: null,
      date: new Date("2026-10-10T00:00:00.000Z"),
      startsAt: "09:00",
      endsAt: "17:00",
      label: "Family trip",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await updateAvailability(
      jsonRequest("/api/users/student-1/availability/block-2", "PATCH", {
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        date: "2026-10-10",
        startsAt: "09:00",
        endsAt: "17:00",
        label: "Family trip",
      }),
      params({ id: "student-1", blockId: "block-2" }),
    );

    expect(res.status).toBe(403);
    expect(db.studentAvailabilityBlock.update).not.toHaveBeenCalled();
  });

  it("lets staff approve pending time off and records reviewer metadata", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.studentAvailabilityBlock.findUnique).mockResolvedValue({
      id: "block-2",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "TIME_OFF",
      status: "PENDING",
      dayOfWeek: null,
      date: new Date("2026-10-10T00:00:00.000Z"),
      startsAt: "09:00",
      endsAt: "17:00",
      label: "Family trip",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(db.studentAvailabilityBlock.update).mockResolvedValue({
      id: "block-2",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "TIME_OFF",
      status: "APPROVED",
      dayOfWeek: null,
      date: new Date("2026-10-10T00:00:00.000Z"),
      startsAt: "09:00",
      endsAt: "17:00",
      label: "Family trip",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: new Date("2026-09-01T12:00:00.000Z"),
      reviewedById: "staff-1",
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await updateAvailability(
      jsonRequest("/api/users/student-1/availability/block-2", "PATCH", {
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        date: "2026-10-10",
        startsAt: "09:00",
        endsAt: "17:00",
        label: "Family trip",
      }),
      params({ id: "student-1", blockId: "block-2" }),
    );

    expect(res.status).toBe(200);
    expect(db.studentAvailabilityBlock.update).toHaveBeenCalledWith({
      where: { id: "block-2" },
      data: expect.objectContaining({
        intent: "TIME_OFF",
        status: "APPROVED",
        reviewedAt: expect.any(Date),
        reviewedById: "staff-1",
      }),
    });
    expect(db.notification.createManyAndReturn).toHaveBeenCalledWith({
      skipDuplicates: true,
      select: { id: true },
      data: [expect.objectContaining({
        userId: "student-1",
        type: "time_off_approved",
        title: "Time off approved",
        payload: expect.objectContaining({
          availabilityBlockId: "block-2",
          href: "/users/student-1?tab=availability",
        }),
        channel: "IN_APP",
      })],
    });
    expect(sendPushToUser).toHaveBeenCalledWith("student-1", expect.objectContaining({ category: "timeOff" }));
  });

  it("marks existing future assignments conflicted when staff approve overlapping time off", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    const approvedBlock = {
      id: "block-2",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "TIME_OFF",
      status: "APPROVED",
      dayOfWeek: null,
      date: new Date("2026-10-10T00:00:00.000Z"),
      startsAt: "09:00",
      endsAt: "17:00",
      label: "Family trip",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: new Date("2026-09-01T12:00:00.000Z"),
      reviewedById: "staff-1",
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(db.studentAvailabilityBlock.findUnique).mockResolvedValue({
      ...approvedBlock,
      status: "PENDING",
      reviewedAt: null,
      reviewedById: null,
    } as never);
    vi.mocked(db.studentAvailabilityBlock.update).mockResolvedValue(approvedBlock as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "student-1",
      role: "STUDENT",
      staffingType: "ST",
      availabilityBlocks: [approvedBlock],
    } as never);
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([{
      id: "assignment-2",
      hasConflict: false,
      conflictNote: null,
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-10-10T14:30:00.000Z"),
        endsAt: new Date("2026-10-10T17:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
      },
    }] as never);

    const res = await updateAvailability(
      jsonRequest("/api/users/student-1/availability/block-2", "PATCH", {
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        date: "2026-10-10",
        startsAt: "09:00",
        endsAt: "17:00",
        label: "Family trip",
      }),
      params({ id: "student-1", blockId: "block-2" }),
    );

    expect(res.status).toBe(200);
    expect(db.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-2" },
      data: {
        hasConflict: true,
        conflictNote: "Approved time off: Family trip (09:00-17:00)",
      },
    });
  });

  it("clears stale future assignment conflicts after deleting availability", async () => {
    vi.mocked(db.studentAvailabilityBlock.findUnique).mockResolvedValue({
      id: "block-1",
      userId: "student-1",
      kind: "AD_HOC",
      intent: "CANNOT_WORK",
      status: "APPROVED",
      dayOfWeek: null,
      date: new Date("2026-10-06T00:00:00.000Z"),
      startsAt: "10:00",
      endsAt: "11:00",
      label: "Exam",
      semesterLabel: null,
      semesterStartsOn: null,
      semesterEndsOn: null,
      reviewedAt: null,
      reviewedById: null,
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(db.studentAvailabilityBlock.delete).mockResolvedValue({} as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "student-1",
      role: "STUDENT",
      staffingType: "ST",
      availabilityBlocks: [],
    } as never);
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([{
      id: "assignment-1",
      hasConflict: true,
      conflictNote: "Conflicts with Exam (10:00-11:00)",
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-10-06T13:00:00.000Z"),
        endsAt: new Date("2026-10-06T17:00:00.000Z"),
        callStartsAt: new Date("2026-10-06T15:15:00.000Z"),
        callEndsAt: new Date("2026-10-06T15:45:00.000Z"),
      },
    }] as never);

    const res = await deleteAvailability(
      jsonRequest("/api/users/student-1/availability/block-1", "DELETE"),
      params({ id: "student-1", blockId: "block-1" }),
    );

    expect(res.status).toBe(200);
    expect(db.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: {
        hasConflict: false,
        conflictNote: null,
      },
    });
  });

  it("rejects weekly blocks without a weekday", async () => {
    const res = await createAvailability(
      jsonRequest("/api/users/student-1/availability", "POST", {
        kind: "WEEKLY",
        startsAt: "09:00",
        endsAt: "10:00",
      }),
      params({ id: "student-1" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Day of week is required for weekly availability");
  });

  it("rejects a one-off range whose end comes before its start", async () => {
    const res = await createAvailability(
      jsonRequest("/api/users/student-1/availability", "POST", {
        kind: "AD_HOC",
        date: "2026-10-10",
        dateEndsOn: "2026-10-08",
        startsAt: "00:00",
        endsAt: "23:59",
      }),
      params({ id: "student-1" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("End date must be on or after the start date");
    expect(db.studentAvailabilityBlock.create).not.toHaveBeenCalled();
  });
});

describe("shift conflict route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
  });

  it("returns conflicts from weekly and ad hoc blocks using the effective slot call window", async () => {
    vi.mocked(db.shift.findUnique).mockResolvedValue({
      id: "shift-1",
      startsAt: new Date("2026-10-06T13:00:00.000Z"),
      endsAt: new Date("2026-10-06T16:00:00.000Z"),
      callStartsAt: new Date("2026-10-06T15:15:00.000Z"),
      callEndsAt: new Date("2026-10-06T15:45:00.000Z"),
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "student-1",
        availabilityBlocks: [{
          kind: "AD_HOC",
          dayOfWeek: null,
          date: new Date("2026-10-06T00:00:00.000Z"),
          startsAt: "10:00",
          endsAt: "11:00",
          label: "Exam",
          semesterLabel: null,
          semesterStartsOn: null,
          semesterEndsOn: null,
        }],
      },
      {
        id: "student-2",
        availabilityBlocks: [{
          kind: "WEEKLY",
          dayOfWeek: 2,
          date: null,
          startsAt: "10:30",
          endsAt: "12:00",
          label: "COMM 201",
          semesterLabel: "Fall 2026",
          semesterStartsOn: new Date("2026-08-24T00:00:00.000Z"),
          semesterEndsOn: new Date("2026-12-18T00:00:00.000Z"),
        }],
      },
    ] as never);

    const res = await getShiftConflicts(
      new Request("https://app.example.com/api/shifts/shift-1/conflicts", {
        headers: { host: "app.example.com" },
      }),
      params({ id: "shift-1" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      "student-1": "Conflicts with Exam (10:00-11:00)",
      "student-2": "Conflicts with COMM 201 (10:30-12:00)",
    });
  });
});
