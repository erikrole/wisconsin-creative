import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/notifications", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db", () => ({
  db: {
    licenseCode: { findMany: vi.fn() },
    licenseCodeClaim: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/services/notifications";
import { processExpiryWarnings, processLicenseNags } from "@/lib/services/licenses";

const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

function codes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `code-${i}`,
    code: `PM-${i}`,
    label: `Seat ${i}`,
    expiresAt: soon,
  }));
}

function admins(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `admin-${i}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(db.notification.findMany).mockResolvedValue([] as never);
  vi.mocked(db.notification.createMany).mockImplementation((async (args: { data: unknown[] }) =>
    ({ count: args.data.length })) as never);
});

describe("processExpiryWarnings batching", () => {
  it("uses one dedupe read and one createMany for the whole code x admin fanout", async () => {
    vi.mocked(db.licenseCode.findMany).mockResolvedValue(codes(4) as never);
    vi.mocked(db.user.findMany).mockResolvedValue(admins(3) as never);

    const result = await processExpiryWarnings();

    expect(result).toEqual({ warned: 12 });
    expect(vi.mocked(db.notification.findMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.notification.createMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.notification.findUnique)).not.toHaveBeenCalled();
    expect(vi.mocked(db.notification.create)).not.toHaveBeenCalled();

    const keys = vi.mocked(db.notification.findMany).mock.calls[0]![0]!
      .where!.dedupeKey as { in: string[] };
    expect(keys.in).toHaveLength(12);
    expect(vi.mocked(sendPushToUser)).toHaveBeenCalledTimes(12);
  });

  it("preserves the dedupe key format and payload of the per-pair writes", async () => {
    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    vi.mocked(db.licenseCode.findMany).mockResolvedValue(codes(1) as never);
    vi.mocked(db.user.findMany).mockResolvedValue(admins(1) as never);

    await processExpiryWarnings();

    const rows = vi.mocked(db.notification.createMany).mock.calls[0]![0]!.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "admin-0",
      type: "license_expiring_soon",
      channel: "IN_APP",
      dedupeKey: `license-expiry-code-0-${yearMonth}-admin-0`,
      payload: { type: "license_expiry", licenseCodeId: "code-0", href: "/licenses" },
    });
    expect(rows[0]!.title).toBe("Photo Mechanic license expiring in 3d");
    expect(rows[0]!.body).toBe("Seat 0 (PM-0) · Renew soon to avoid disruption.");
  });

  it("writes nothing when every key already exists", async () => {
    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    vi.mocked(db.licenseCode.findMany).mockResolvedValue(codes(1) as never);
    vi.mocked(db.user.findMany).mockResolvedValue(admins(1) as never);
    vi.mocked(db.notification.findMany).mockResolvedValue(
      [{ dedupeKey: `license-expiry-code-0-${yearMonth}-admin-0` }] as never,
    );

    expect(await processExpiryWarnings()).toEqual({ warned: 0 });
    expect(vi.mocked(db.notification.createMany)).not.toHaveBeenCalled();
    expect(vi.mocked(sendPushToUser)).not.toHaveBeenCalled();
  });

  it("still reports the created count when a push rejects", async () => {
    vi.mocked(db.licenseCode.findMany).mockResolvedValue(codes(1) as never);
    vi.mocked(db.user.findMany).mockResolvedValue(admins(2) as never);
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error("apns down"));

    expect(await processExpiryWarnings()).toEqual({ warned: 2 });
  });
});

describe("processLicenseNags batching", () => {
  function claims(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `claim-${i}`,
      userId: `student-${i}`,
      claimedAt: new Date("2026-09-01T12:00:00.000Z"),
      licenseCodeId: `code-${i}`,
    }));
  }

  it("uses one dedupe read and one createMany for every overdue claim", async () => {
    vi.mocked(db.licenseCodeClaim.findMany).mockResolvedValue(claims(5) as never);

    const result = await processLicenseNags();

    expect(result).toEqual({ nagged: 5 });
    expect(vi.mocked(db.notification.findMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.notification.createMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.notification.findUnique)).not.toHaveBeenCalled();
    expect(vi.mocked(sendPushToUser)).toHaveBeenCalledTimes(5);
  });

  it("preserves the per-claim dedupe key and payload", async () => {
    vi.mocked(db.licenseCodeClaim.findMany).mockResolvedValue(claims(1) as never);

    await processLicenseNags();

    const rows = vi.mocked(db.notification.createMany).mock.calls[0]![0]!.data as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      userId: "student-0",
      type: "license_held_2d",
      channel: "IN_APP",
      dedupeKey: "license-nag-code-0-2026-09-01T12:00:00.000Z",
      payload: { type: "license_nag", licenseCodeId: "code-0", href: "/licenses" },
    });
    expect(rows[0]!.title).toBe("Still using Photo Mechanic?");
  });

  it("skips claims that already have a nag", async () => {
    vi.mocked(db.licenseCodeClaim.findMany).mockResolvedValue(claims(2) as never);
    vi.mocked(db.notification.findMany).mockResolvedValue(
      [{ dedupeKey: "license-nag-code-0-2026-09-01T12:00:00.000Z" }] as never,
    );

    expect(await processLicenseNags()).toEqual({ nagged: 1 });
    const rows = vi.mocked(db.notification.createMany).mock.calls[0]![0]!.data as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.userId)).toEqual(["student-1"]);
  });
});
