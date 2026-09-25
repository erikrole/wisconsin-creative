import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  getClaimHistory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/services/licenses", () => ({ getClaimHistory: mocks.getClaimHistory }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET as getHistory } from "@/app/api/licenses/[id]/history/route";

function userWith(role: Role) {
  return {
    id: "user-1",
    name: "User One",
    email: "user@example.com",
    role,
    avatarUrl: null,
    forcePasswordChange: false,
  };
}

function request(query = "") {
  return new Request(`https://app.example.com/api/licenses/code-1/history${query}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

const context = { params: Promise.resolve({ id: "code-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(userWith(Role.STAFF));
  mocks.getClaimHistory.mockResolvedValue([]);
});

describe("GET /api/licenses/[id]/history", () => {
  it("caps an oversized limit at 100 rows", async () => {
    const response = await getHistory(request("?limit=500"), context);

    expect(response.status).toBe(200);
    expect(mocks.getClaimHistory).toHaveBeenCalledWith("code-1", 100);
    await expect(response.json()).resolves.toMatchObject({ limit: 100 });
  });

  it("refuses a student before reading any claim history", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWith(Role.STUDENT));

    const response = await getHistory(request(), context);

    expect(response.status).toBe(403);
    expect(mocks.getClaimHistory).not.toHaveBeenCalled();
  });
});
