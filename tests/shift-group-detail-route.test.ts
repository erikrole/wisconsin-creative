import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shiftGroup: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/services/schedule-publication", () => ({
  getSchedulePublicationState: vi.fn(() => ({ status: "published" })),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/shift-groups/[id]/route";

function sessionUser(role: "STUDENT" | "STAFF", id: string) {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role,
    avatarUrl: null,
    forcePasswordChange: false,
  };
}

function assignment(id: string, userId: string, status: string) {
  return {
    id,
    shiftId: "shift-1",
    userId,
    status,
    assignedBy: "staff-1",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    hasConflict: true,
    conflictNote: "Class until 5",
    notes: null,
    user: {
      id: userId,
      name: `Name ${userId}`,
      email: `${userId}@example.com`,
      role: "STUDENT",
      staffingType: "ST",
      primaryArea: "VIDEO",
    },
    assigner: { id: "staff-1", name: "Staff One" },
  };
}

function group() {
  return {
    id: "group-1",
    event: { id: "evt-1", allDay: false, isHome: true, summary: "Wisconsin vs Iowa" },
    workingCopy: null,
    shifts: [{
      id: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      callStartsAt: null,
      callEndsAt: null,
      assignments: [
        assignment("a-active", "other-1", "DIRECT_ASSIGNED"),
        assignment("a-declined", "other-2", "DECLINED"),
        assignment("a-requested", "other-3", "REQUESTED"),
        assignment("a-mine", "student-1", "REQUESTED"),
      ],
    }],
  };
}

async function read(role: "STUDENT" | "STAFF", id: string) {
  vi.mocked(requireAuth).mockResolvedValue(sessionUser(role, id));
  vi.mocked(db.shiftGroup.findUnique).mockResolvedValue(group() as never);
  const res = await GET(
    new Request("https://app.example.com/api/shift-groups/group-1", { headers: { host: "app.example.com" } }),
    { params: Promise.resolve({ id: "group-1" }) },
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data.shifts[0].assignments as Array<ReturnType<typeof assignment>>;
}

describe("GET /api/shift-groups/[id] assignment privacy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a student only active assignments plus their own requests", async () => {
    const rows = await read("STUDENT", "student-1");
    expect(rows.map((row) => row.id)).toEqual(["a-active", "a-mine"]);
  });

  it("strips contact, conflict, and assigner details from other people's rows", async () => {
    const rows = await read("STUDENT", "student-1");
    const other = rows.find((row) => row.id === "a-active")!;
    expect(other.user).toEqual({
      id: "other-1",
      name: "Name other-1",
      role: "STUDENT",
      staffingType: "ST",
      primaryArea: "VIDEO",
    });
    expect(other.hasConflict).toBe(false);
    expect(other.conflictNote).toBeNull();
    expect(other.assigner).toBeNull();
    expect(other.assignedBy).toBeNull();
  });

  it("returns a student's own row whole", async () => {
    const rows = await read("STUDENT", "student-1");
    const mine = rows.find((row) => row.id === "a-mine")!;
    expect(mine.user.email).toBe("student-1@example.com");
    expect(mine.conflictNote).toBe("Class until 5");
    expect(mine.assigner).toEqual({ id: "staff-1", name: "Staff One" });
  });

  it("leaves the staff view untouched", async () => {
    const rows = await read("STAFF", "staff-1");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.user.email).toBe("other-1@example.com");
    expect(rows[0]?.conflictNote).toBe("Class until 5");
  });
});
