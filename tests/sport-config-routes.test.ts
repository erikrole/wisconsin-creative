import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/sport-configs", () => ({
  getSportConfig: vi.fn(),
  upsertSportConfig: vi.fn(),
  toggleSportConfig: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 10, windowMs: 60_000 },
}));

import { requireAuth } from "@/lib/auth";
import { getSportConfig } from "@/lib/services/sport-configs";
import { GET } from "@/app/api/sport-configs/[sportCode]/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function request(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(getSportConfig).mockResolvedValue({
    id: "sc-vb",
    sportCode: "VB",
    active: true,
    autoAssignPolicy: "STAFF_ONLY",
    shiftStartOffset: 120,
    shiftEndOffset: 120,
    shiftConfigs: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
});

describe("GET /api/sport-configs/[sportCode]", () => {
  it("normalizes lowercase path sport codes before service reads", async () => {
    const res = await GET(
      request("/api/sport-configs/vb"),
      { params: Promise.resolve({ sportCode: "vb" }) },
    );

    expect(res.status).toBe(200);
    expect(getSportConfig).toHaveBeenCalledWith("VB");
  });

  it("rejects unknown path sport codes before service reads", async () => {
    const res = await GET(
      request("/api/sport-configs/football"),
      { params: Promise.resolve({ sportCode: "football" }) },
    );

    expect(res.status).toBe(400);
    expect(getSportConfig).not.toHaveBeenCalled();
  });
});
