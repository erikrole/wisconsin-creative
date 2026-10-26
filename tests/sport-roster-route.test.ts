import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    studentSportAssignment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/services/sport-configs", () => ({
  getSportRoster: vi.fn(),
  addToRoster: vi.fn(),
  removeFromRoster: vi.fn(),
  bulkAddToRoster: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { MAX_SPORT_ROSTER_USERS_PER_REQUEST } from "@/lib/request-limits";
import { addToRoster, bulkAddToRoster, getSportRoster, removeFromRoster } from "@/lib/services/sport-configs";
import { db } from "@/lib/db";
import { DELETE, GET, PATCH, POST } from "@/app/api/sport-configs/[sportCode]/roster/route";

const user = {
  id: "cm000000000000000000000001",
  email: "admin@test.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};

const routeParams = { params: Promise.resolve({ sportCode: "fb" }) };

function cuid(index: number) {
  return `cm${index.toString(36).padStart(23, "0")}`;
}

function request(userIds: string[]) {
  return new Request("https://app.example.com/api/sport-configs/fb/roster", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ userIds }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(bulkAddToRoster).mockResolvedValue([]);
  vi.mocked(createAuditEntry).mockResolvedValue(undefined);
});

describe("POST /api/sport-configs/[sportCode]/roster", () => {
  it("accepts the exact roster ceiling in one service call", async () => {
    const userIds = Array.from(
      { length: MAX_SPORT_ROSTER_USERS_PER_REQUEST },
      (_, index) => cuid(index),
    );

    const res = await POST(request(userIds), routeParams);

    expect(res.status).toBe(201);
    expect(bulkAddToRoster).toHaveBeenCalledTimes(1);
    expect(bulkAddToRoster).toHaveBeenCalledWith(userIds, "FB");
    expect(createAuditEntry).toHaveBeenCalledTimes(1);
  });

  it("rejects max plus one before calling the roster service", async () => {
    const userIds = Array.from(
      { length: MAX_SPORT_ROSTER_USERS_PER_REQUEST + 1 },
      (_, index) => cuid(index),
    );

    const res = await POST(request(userIds), routeParams);

    expect(res.status).toBe(400);
    expect(bulkAddToRoster).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/sport-configs/[sportCode]/roster", () => {
  it("audits the stored travel flag as the before value, not the inverse of the request", async () => {
    // Re-sending the current value must not invent a change in the audit trail.
    vi.mocked(db.studentSportAssignment.findUnique).mockResolvedValue({ sportCode: "FB", defaultTraveler: true } as never);
    vi.mocked(db.studentSportAssignment.update).mockResolvedValue({ userId: "u-1" } as never);

    const res = await PATCH(new Request("https://app.example.com/api/sport-configs/fb/roster", {
      method: "PATCH",
      headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
      body: JSON.stringify({ assignmentId: cuid(1), defaultTraveler: true }),
    }), routeParams);

    expect(res.status).toBe(200);
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "roster_travel_set",
      before: { defaultTraveler: true },
      after: expect.objectContaining({ defaultTraveler: true }),
    }));
  });
});

const headers = { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" };

describe("GET and single POST /api/sport-configs/[sportCode]/roster", () => {
  it("reads the roster for the normalized sport code", async () => {
    vi.mocked(getSportRoster).mockResolvedValue([{ id: "a1" }] as never);

    const res = await GET(new Request("https://app.example.com/api/sport-configs/fb/roster"), routeParams);

    expect(await res.json()).toEqual({ data: [{ id: "a1" }] });
    expect(getSportRoster).toHaveBeenCalledWith("FB");
  });

  it("adds one person and audits the new assignment", async () => {
    vi.mocked(addToRoster).mockResolvedValue({ id: "a2" } as never);

    const res = await POST(new Request("https://app.example.com/api/sport-configs/fb/roster", {
      method: "POST", headers, body: JSON.stringify({ userId: cuid(1) }),
    }), routeParams);

    expect(res.status).toBe(201);
    expect(addToRoster).toHaveBeenCalledWith(cuid(1), "FB");
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ entityId: "a2", action: "roster_added", after: { sportCode: "FB", userId: cuid(1) } }));
  });

  it("explains a bad body", async () => {
    const res = await POST(new Request("https://app.example.com/api/sport-configs/fb/roster", {
      method: "POST", headers, body: JSON.stringify({ userId: "nope" }),
    }), routeParams);

    expect(res.status).toBe(400);
    expect(addToRoster).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/sport-configs/[sportCode]/roster guards", () => {
  it("returns 404 for an assignment in another sport", async () => {
    vi.mocked(db.studentSportAssignment.findUnique).mockResolvedValue({ sportCode: "MBB", defaultTraveler: false } as never);

    const res = await PATCH(new Request("https://app.example.com/api/sport-configs/fb/roster", {
      method: "PATCH", headers, body: JSON.stringify({ assignmentId: cuid(1), defaultTraveler: true }),
    }), routeParams);

    expect(res.status).toBe(404);
    expect(db.studentSportAssignment.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/sport-configs/[sportCode]/roster", () => {
  const remove = (query: string) => DELETE(new Request(`https://app.example.com/api/sport-configs/fb/roster${query}`, { method: "DELETE", headers }), routeParams);

  it("removes the assignment within the URL's sport and audits it", async () => {
    vi.mocked(removeFromRoster).mockResolvedValue(true);

    const res = await remove("?assignmentId=a1");

    expect(await res.json()).toEqual({ success: true });
    expect(removeFromRoster).toHaveBeenCalledWith("a1", "FB");
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "roster_removed", entityId: "a1", after: { sportCode: "FB", assignmentId: "a1" } }));
  });

  it("returns 404 without an audit when the assignment is already gone or belongs to another sport", async () => {
    vi.mocked(removeFromRoster).mockResolvedValue(false);

    expect((await remove("?assignmentId=a1")).status).toBe(404);
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("requires an assignment id", async () => {
    expect((await remove("")).status).toBe(400);
    expect(removeFromRoster).not.toHaveBeenCalled();
  });
});
