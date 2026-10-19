import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  randomHex: vi.fn(),
  tokenHash: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    passwordResetToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
  renderEmail: vi.fn(() => ({ html: "<p>reset</p>", text: "reset" })),
}));

vi.mock("@/lib/audit", () => ({
  createSystemAuditEntry: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { db } from "@/lib/db";
import { randomHex, tokenHash } from "@/lib/auth";
import { createSystemAuditEntry } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/forgot-password/route";

function forgotPasswordRequest() {
  return new Request("https://app.example.com/api/auth/forgot-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({ email: "user@example.com" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
  });
  vi.mocked(getClientIp).mockReturnValue("127.0.0.1");
  vi.mocked(randomHex).mockReturnValue("raw-reset-token");
  vi.mocked(tokenHash).mockResolvedValue("hashed-reset-token");
  vi.mocked(sendEmail).mockResolvedValue(true);
});

describe("POST /api/auth/forgot-password", () => {
  it("does not create unusable reset tokens when email delivery is not configured", async () => {
    const res = await POST(forgotPasswordRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resetEmailConfigured).toBe(false);
    expect(body.message).toContain("not configured");
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not issue a reset token or email for an inactive user", async () => {
    process.env.RESEND_API_KEY = "test-key";
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      active: false,
    } as never);

    const res = await POST(forgotPasswordRequest(), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(db.passwordResetToken.deleteMany).not.toHaveBeenCalled();
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });

  it("records an active reset request as a pre-auth system event", async () => {
    process.env.RESEND_API_KEY = "test-key";
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      role: "STUDENT",
      active: true,
    } as never);

    const res = await POST(forgotPasswordRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      message: "If that email exists, we sent a reset link.",
      resetEmailConfigured: true,
    });
    expect(createSystemAuditEntry).toHaveBeenCalledWith({
      entityType: "user",
      entityId: "user-1",
      action: "password_reset_requested",
      after: {
        ip: "127.0.0.1",
        userAgent: null,
      },
    });
    expect(createSystemAuditEntry).not.toHaveBeenCalledWith(
      expect.objectContaining({ actorId: expect.anything() }),
    );
    delete process.env.RESEND_API_KEY;
  });
});
