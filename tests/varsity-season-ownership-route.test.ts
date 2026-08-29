import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 10, windowMs: 60_000 },
}));
vi.mock("@/lib/services/varsity-season-ownership", () => ({
  getVarsityOwnership: vi.fn(),
  handoffVarsityOwnership: vi.fn(),
  varsityOwnershipHandoffSchema: { parse: vi.fn((value) => value) },
}));

import { GET, POST } from "@/app/api/schedule/varsity-ownership/route";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVarsityOwnership, handoffVarsityOwnership } from "@/lib/services/varsity-season-ownership";

const admin = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: Role.ADMIN,
  staffingType: "FT" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

function request(method: "GET" | "POST", body?: unknown) {
  return new Request("https://app.example.com/api/schedule/varsity-ownership?sportCode=WSOC", {
    method,
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("varsity ownership route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(getVarsityOwnership).mockResolvedValue({ sportCode: "WSOC", owners: [], students: [] });
    vi.mocked(handoffVarsityOwnership).mockResolvedValue([]);
  });

  it("rate-limits an authorized Admin read", async () => {
    const response = await GET(request("GET"), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("varsity-ownership:read:admin-1", { max: 60, windowMs: 60_000 });
    expect(getVarsityOwnership).toHaveBeenCalledWith("WSOC");
  });

  it("permission-protects writes and uses the actor-owned audited service", async () => {
    const body = { sportCode: "WSOC", area: "PHOTO", startsOn: "2026-09-01", endsOn: "2026-12-31", userIds: ["student-1"] };
    const response = await POST(request("POST", body), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("varsity-ownership:write:admin-1", { max: 10, windowMs: 60_000 });
    expect(handoffVarsityOwnership).toHaveBeenCalledWith(body, admin);
  });

  it("denies Students before service or rate-limit work", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, id: "student-1", role: Role.STUDENT, staffingType: "ST" });
    const response = await POST(request("POST", {}), { params: Promise.resolve({}) });
    expect(response.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(handoffVarsityOwnership).not.toHaveBeenCalled();
  });

  it("denies Staff even though they can manage ordinary sport setup", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, id: "staff-1", role: Role.STAFF });
    const response = await GET(request("GET"), { params: Promise.resolve({}) });
    expect(response.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(getVarsityOwnership).not.toHaveBeenCalled();
  });
});
