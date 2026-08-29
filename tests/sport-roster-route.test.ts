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
  setRosterTravelStatus: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { MAX_SPORT_ROSTER_USERS_PER_REQUEST } from "@/lib/request-limits";
import { bulkAddToRoster, setRosterTravelStatus } from "@/lib/services/sport-configs";
import { PATCH, POST } from "@/app/api/sport-configs/[sportCode]/roster/route";

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

function patchRequest(assignmentIds: string[], defaultTraveler: boolean) {
  return new Request("https://app.example.com/api/sport-configs/fb/roster", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ assignmentIds, defaultTraveler }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(bulkAddToRoster).mockResolvedValue([]);
  vi.mocked(setRosterTravelStatus).mockResolvedValue([]);
  vi.mocked(createAuditEntry).mockResolvedValue(undefined);
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
});

describe("PATCH /api/sport-configs/[sportCode]/roster", () => {
  it("sends one bounded bulk travel update through the roster service", async () => {
    const assignmentIds = [cuid(1), cuid(2)];

    const res = await PATCH(patchRequest(assignmentIds, true), routeParams);

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith(
      `sport-roster:write:${user.id}`,
      { max: 60, windowMs: 60_000 },
    );
    expect(setRosterTravelStatus).toHaveBeenCalledTimes(1);
    expect(setRosterTravelStatus).toHaveBeenCalledWith({
      assignmentIds,
      sportCode: "FB",
      defaultTraveler: true,
      actor: { id: user.id, role: Role.ADMIN },
    });
  });

  it("rejects duplicate members before calling the travel writer", async () => {
    const assignmentId = cuid(1);

    const res = await PATCH(patchRequest([assignmentId, assignmentId], false), routeParams);

    expect(res.status).toBe(400);
    expect(setRosterTravelStatus).not.toHaveBeenCalled();
  });

  it("keeps travel mutations unavailable to students", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...user, role: Role.STUDENT });

    const res = await PATCH(patchRequest([cuid(1)], true), routeParams);

    expect(res.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(setRosterTravelStatus).not.toHaveBeenCalled();
  });
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
