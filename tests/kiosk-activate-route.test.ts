import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  tokenHash: vi.fn(),
  createKioskSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    kioskDevice: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  checkRateLimit: vi.fn(),
  isRateLimitExhausted: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createSystemAuditEntry: vi.fn(),
}));

vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { tokenHash, createKioskSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit, enforceRateLimit, getClientIp, isRateLimitExhausted } from "@/lib/rate-limit";
import { createSystemAuditEntry } from "@/lib/audit";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { POST as activateKiosk } from "@/app/api/kiosk/activate/route";

function authedPost(path: string, body?: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tokenHash).mockResolvedValue("hashed-code");
  vi.mocked(createKioskSession).mockResolvedValue("session-token");
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
  vi.mocked(isRateLimitExhausted).mockResolvedValue(false);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60 * 60_000 });
  vi.mocked(getClientIp).mockReturnValue("203.0.113.10");
  vi.mocked(db.kioskDevice.findUnique).mockResolvedValue({
    id: "kiosk-1",
    active: true,
    name: "Kiosk One",
    locationId: "loc-1",
    location: { id: "loc-1", name: "Main" },
    activationCodeExpiresAt: new Date(Date.now() + 60 * 60_000),
  } as unknown as Awaited<ReturnType<typeof db.kioskDevice.findUnique>>);
  vi.mocked(db.kioskDevice.updateMany).mockResolvedValue(
    { count: 1 } as Awaited<ReturnType<typeof db.kioskDevice.updateMany>>,
  );
});

describe("kiosk activation route", () => {
  it("rate limits kiosk activation by IP and activation code", async () => {
    const res = await activateKiosk(
      authedPost("/api/kiosk/activate", { code: "123456" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:activate:203.0.113.10", { max: 5, windowMs: 15 * 60_000 });
    expect(enforceRateLimit).toHaveBeenCalledWith("kiosk:activate:code:hashed-code", { max: 5, windowMs: 60 * 60_000 });
    expect(createSystemAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: "kiosk_activated" }),
    );
    expect(deferCompanionProjectionRefreshForCommittedMutation).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST" }),
    );
  });

  const GLOBAL_FAILURES = "kiosk:activate:failures:global";
  const GLOBAL_LIMIT = { max: 30, windowMs: 60 * 60_000 };

  it("does not spend the global failure budget on a successful activation", async () => {
    const res = await activateKiosk(
      authedPost("/api/kiosk/activate", { code: "123456" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(isRateLimitExhausted).toHaveBeenCalledWith(GLOBAL_FAILURES, GLOBAL_LIMIT);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("counts each wrong code against a global budget shared by every IP", async () => {
    vi.mocked(db.kioskDevice.findUnique).mockResolvedValue(null);

    const res = await activateKiosk(
      authedPost("/api/kiosk/activate", { code: "654321" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(401);
    expect(checkRateLimit).toHaveBeenCalledWith(GLOBAL_FAILURES, GLOBAL_LIMIT);
    expect(createKioskSession).not.toHaveBeenCalled();
  });

  it("pauses activation for everyone once the global failure budget is spent", async () => {
    vi.mocked(isRateLimitExhausted).mockResolvedValue(true);

    const res = await activateKiosk(
      authedPost("/api/kiosk/activate", { code: "123456" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("Kiosk activation is paused after too many incorrect codes");
    // Even a correct code is not checked while paused, so guessing stops paying off.
    expect(db.kioskDevice.findUnique).not.toHaveBeenCalled();
    expect(db.kioskDevice.updateMany).not.toHaveBeenCalled();
    expect(createKioskSession).not.toHaveBeenCalled();
  });
});
