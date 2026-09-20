import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/notifications", () => ({
  processOverdueNotifications: vi.fn(),
}));

vi.mock("@/lib/services/licenses", () => ({
  processLicenseNags: vi.fn(),
  processExpiryWarnings: vi.fn(),
}));

import { processOverdueNotifications } from "@/lib/services/notifications";
import { processLicenseNags, processExpiryWarnings } from "@/lib/services/licenses";
import { GET } from "@/app/api/cron/notifications/route";

function cronRequest() {
  return new Request("https://app.example.com/api/cron/notifications", {
    method: "GET",
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("notification cron route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all job results when every notification job succeeds", async () => {
    vi.mocked(processOverdueNotifications).mockResolvedValue({
      scanned: 4,
      notificationsCreated: 2,
      remaining: 0,
      truncated: false,
    });
    vi.mocked(processLicenseNags).mockResolvedValue({ nagged: 1 });
    vi.mocked(processExpiryWarnings).mockResolvedValue({ warned: 3 });

    const res = await GET(cronRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      scanned: 4,
      notificationsCreated: 2,
      remaining: 0,
      truncated: false,
      licenseNags: { nagged: 1 },
      licenseExpiry: { warned: 3 },
    });
  });

  it("reports partial failures without dropping successful notification jobs", async () => {
    vi.mocked(processOverdueNotifications).mockResolvedValue({
      scanned: 4,
      notificationsCreated: 2,
      remaining: 0,
      truncated: false,
    });
    vi.mocked(processLicenseNags).mockRejectedValue(new Error("license nag failed"));
    vi.mocked(processExpiryWarnings).mockResolvedValue({ warned: 3 });

    const res = await GET(cronRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: false,
      scanned: 4,
      notificationsCreated: 2,
      remaining: 0,
      truncated: false,
      licenseNags: { nagged: 0 },
      licenseExpiry: { warned: 3 },
      partialFailures: ["licenseNags"],
      errors: { licenseNags: "license nag failed" },
    });
  });

  it("surfaces the unscanned backlog when the overdue sweep hits its cap", async () => {
    vi.mocked(processOverdueNotifications).mockResolvedValue({
      scanned: 500,
      notificationsCreated: 12,
      remaining: 137,
      truncated: true,
    });
    vi.mocked(processLicenseNags).mockResolvedValue({ nagged: 0 });
    vi.mocked(processExpiryWarnings).mockResolvedValue({ warned: 0 });

    const res = await GET(cronRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      scanned: 500,
      notificationsCreated: 12,
      remaining: 137,
      truncated: true,
      licenseNags: { nagged: 0 },
      licenseExpiry: { warned: 0 },
    });
  });
});
