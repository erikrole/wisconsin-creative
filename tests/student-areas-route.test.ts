import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = { studentAreaAssignment: { updateMany: vi.fn(), upsert: vi.fn() } };
  return {
    tx,
    db: {
      studentAreaAssignment: { findMany: vi.fn(), delete: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    requireAuth: vi.fn(),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));

import { DELETE, GET, POST } from "@/app/api/student-areas/route";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const student = { ...staff, id: "cstudent001", role: Role.STUDENT };
const headers = { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" };
const noParams = { params: Promise.resolve({}) };

async function list(query = "") {
  await GET(new Request(`https://app.example.com/api/student-areas${query}`), noParams);
  return mocks.db.studentAreaAssignment.findMany.mock.calls.at(-1)?.[0].where;
}

function assign(body: Record<string, unknown>) {
  return POST(new Request("https://app.example.com/api/student-areas", { method: "POST", headers, body: JSON.stringify(body) }), noParams);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.studentAreaAssignment.findMany.mockResolvedValue([]);
  mocks.tx.studentAreaAssignment.upsert.mockResolvedValue({ id: "assign-1" });
  mocks.audit.mockResolvedValue(undefined);
});

describe("GET /api/student-areas", () => {
  it("shows staff everyone, or one student when asked", async () => {
    expect(await list()).toEqual({});
    expect(await list("?userId=cstudent002")).toEqual({ userId: "cstudent002" });
  });

  it("shows a student only their own areas", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    expect(await list()).toEqual({ userId: student.id });
    expect(await list("?userId=cstudent002")).toEqual({ userId: student.id });
    expect(await list(`?userId=${student.id}`)).toEqual({ userId: student.id });
  });
});

describe("POST /api/student-areas", () => {
  it("makes a new primary area the only primary one", async () => {
    const response = await assign({ userId: student.id, area: "VIDEO", isPrimary: true });

    expect(response.status).toBe(201);
    expect(mocks.tx.studentAreaAssignment.updateMany).toHaveBeenCalledWith({ where: { userId: student.id, isPrimary: true }, data: { isPrimary: false } });
    expect(mocks.tx.studentAreaAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_area: { userId: student.id, area: "VIDEO" } },
      create: { userId: student.id, area: "VIDEO", isPrimary: true },
      update: { isPrimary: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "assign-1", action: "area_assigned" }));
  });

  it("adds a secondary area without touching the primary", async () => {
    await assign({ userId: student.id, area: "PHOTO" });

    expect(mocks.tx.studentAreaAssignment.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.studentAreaAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { isPrimary: false } }));
  });

  it("keeps students from assigning areas", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    expect((await assign({ userId: student.id, area: "PHOTO" })).status).toBe(403);
  });
});

describe("DELETE /api/student-areas", () => {
  it("removes an assignment by id and needs one", async () => {
    const response = await DELETE(new Request("https://app.example.com/api/student-areas?id=assign-1", { method: "DELETE", headers }), noParams);

    expect(response.status).toBe(200);
    expect(mocks.db.studentAreaAssignment.delete).toHaveBeenCalledWith({ where: { id: "assign-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "assign-1", action: "area_removed" }));

    const missing = await DELETE(new Request("https://app.example.com/api/student-areas", { method: "DELETE", headers }), noParams);
    expect(missing.status).toBe(400);
  });
});
