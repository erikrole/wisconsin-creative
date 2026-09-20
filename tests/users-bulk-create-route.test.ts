import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { points: 60, duration: 60 },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth, hashPassword } from "@/lib/auth";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { POST } from "@/app/api/users/bulk-create/route";

const adminUser = {
  id: "admin-1",
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@test.com",
  name: "Staff",
  role: "STAFF" as const,
  avatarUrl: null,
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/users/bulk-create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/users/bulk-create", () => {
  it("retires bulk temporary-password onboarding before passwords are hashed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);

    const response = await POST(
      makeRequest({
        users: [
          { name: "Admin Two", email: "admin2@uw.edu", role: "ADMIN" },
        ],
      }),
      noParams,
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toBe("Temporary-password bulk onboarding has been retired. Add emails to the allowlist so users can register and set their own passwords.");
    expect(enforceRateLimit).toHaveBeenCalledWith("users:bulk-create:admin-1", SETTINGS_MUTATION_LIMIT);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("keeps auth, role, and rate-limit checks around the retired endpoint", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const response = await POST(
      makeRequest({
        users: [
          { name: "Staff Two", email: "staff2@uw.edu", role: "STAFF" },
        ],
      }),
      noParams,
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toBe("Temporary-password bulk onboarding has been retired. Add emails to the allowlist so users can register and set their own passwords.");
    expect(enforceRateLimit).toHaveBeenCalledWith("users:bulk-create:staff-1", SETTINGS_MUTATION_LIMIT);
    expect(hashPassword).not.toHaveBeenCalled();
  });
});
