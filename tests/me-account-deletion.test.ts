import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/services/user-deactivation", () => ({ deactivateUserWithCleanup: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";
import { DELETE } from "@/app/api/me/account/route";

const user = { id: "user-1", email: "user@example.com", name: "User", role: "STUDENT" as const, avatarUrl: null };

function request(password = "correct-password", confirmation = "DELETE") {
  return new Request("https://app.example.com/api/me/account", {
    method: "DELETE",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify({ currentPassword: password, confirmation }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(db.user.findUnique).mockResolvedValue({ passwordHash: "hash", active: true } as never);
  vi.mocked(verifyPassword).mockResolvedValue(true);
  vi.mocked(deactivateUserWithCleanup).mockResolvedValue({ cancelledIds: ["booking-1"], directReportsCleared: 1 });
});

describe("DELETE /api/me/account", () => {
  it("reauthenticates and erases only the signed-in user", async () => {
    const response = await DELETE(request(), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(verifyPassword).toHaveBeenCalledWith("hash", "correct-password");
    expect(deactivateUserWithCleanup).toHaveBeenCalledWith({
      targetUserId: "user-1",
      actorId: "user-1",
      actorRole: "STUDENT",
      erasePersonalData: true,
      audit: {
        action: "account_self_deleted",
        before: { active: true },
        after: {
          active: false,
          personalData: "erased",
          authentication: "revoked",
          retainedRecords: ["historical custody", "audit attribution"],
        },
      },
    });
  });

  it("rejects an incorrect password before changing lifecycle state", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const response = await DELETE(request("wrong-password"), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(deactivateUserWithCleanup).not.toHaveBeenCalled();
  });

  it("requires an explicit destructive confirmation token", async () => {
    const response = await DELETE(request("correct-password", "NO"), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(deactivateUserWithCleanup).not.toHaveBeenCalled();
  });
});
