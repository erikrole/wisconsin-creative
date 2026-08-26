import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: vi.fn(),
  };
});

vi.mock("@/lib/rbac", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac")>("@/lib/rbac");
  return {
    ...actual,
    requirePermission: vi.fn(),
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { GET } from "@/app/api/bookings/changes/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
  forcePasswordChange: false,
};

const studentUser = {
  ...staffUser,
  id: "student-1",
  role: Role.STUDENT,
};

function request(query = "") {
  return new Request(`https://app.example.com/api/bookings/changes${query}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function decodeCursor(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
    version: number;
    booking: { at: string; id: string };
    audit: { at: string; id: string };
  };
}

async function call(query = "") {
  return GET(request(query), { params: Promise.resolve({}) });
}

describe("booking change signal route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 179, resetAt: Date.now() + 60_000 });
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);
    vi.mocked(db.auditLog.findFirst).mockResolvedValue(null);
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
  });

  it("establishes an empty baseline cursor without returning historical booking ids", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({ id: "booking-latest", updatedAt: new Date("2026-06-24T10:00:00.000Z") } as never);
    vi.mocked(db.auditLog.findFirst).mockResolvedValue({ id: "audit-latest", createdAt: new Date("2026-06-24T10:02:00.000Z") } as never);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.changedBookingIds).toEqual([]);
    expect(typeof body.data.cursor).toBe("string");
    expect(decodeCursor(body.data.cursor)).toEqual({
      version: 2,
      booking: { at: "2026-06-24T10:00:00.000Z", id: "booking-latest" },
      audit: { at: "2026-06-24T10:02:00.000Z", id: "audit-latest" },
    });
    expect(requirePermission).toHaveBeenCalledWith(Role.STAFF, "booking", "view");
    expect(checkRateLimit).toHaveBeenCalledWith("bookings:changes:staff-1", { max: 180, windowMs: 60_000 });
    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, updatedAt: true },
    });
    expect(db.auditLog.findFirst).toHaveBeenCalledWith({
      where: { entityType: "booking" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true },
    });
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("returns visible booking ids from booking rows and booking audit evidence after a cursor", async () => {
    const since = "2026-06-24T10:00:00.000Z";
    vi.mocked(db.booking.findMany)
      .mockResolvedValueOnce([
        { id: "booking-row-1", updatedAt: new Date("2026-06-24T10:01:00.000Z") },
      ] as never)
      .mockResolvedValueOnce([
        { id: "audit-visible-1" },
      ] as never);
    vi.mocked(db.auditLog.findMany).mockResolvedValue([
      { id: "audit-row-1", entityId: "audit-visible-1", createdAt: new Date("2026-06-24T10:02:00.000Z") },
      { id: "audit-row-2", entityId: "audit-hidden-1", createdAt: new Date("2026-06-24T10:03:00.000Z") },
    ] as never);

    const res = await call(`?since=${encodeURIComponent(since)}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.changedBookingIds).toEqual(["booking-row-1", "audit-visible-1"]);
    expect(typeof body.data.cursor).toBe("string");
    expect(db.booking.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          { updatedAt: { gt: new Date(since) } },
          { updatedAt: new Date(since), id: { gt: "" } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true, updatedAt: true },
      take: 100,
    });
    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        entityType: "booking",
        OR: [
          { createdAt: { gt: new Date(since) } },
          { createdAt: new Date(since), id: { gt: "" } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, entityId: true, createdAt: true },
      take: 100,
    });
    expect(db.booking.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["audit-visible-1", "audit-hidden-1"] } },
      select: { id: true },
      take: 100,
    });
  });

  it("advances the audit cursor past invisible rows so polling cannot get stuck", async () => {
    vi.mocked(db.booking.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(db.auditLog.findMany).mockResolvedValue([
      { id: "hidden-audit-row", entityId: "hidden-booking", createdAt: new Date("2026-06-24T10:03:00.000Z") },
    ] as never);

    const res = await call("?since=2026-06-24T10%3A00%3A00.000Z");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.changedBookingIds).toEqual([]);
    expect(decodeCursor(body.data.cursor).audit).toEqual({
      at: "2026-06-24T10:03:00.000Z",
      id: "hidden-audit-row",
    });
  });

  it("returns team-visible booking evidence for a student", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.booking.findMany)
      .mockResolvedValueOnce([{ id: "student-booking", updatedAt: new Date("2026-06-24T10:01:00.000Z") }] as never)
      .mockResolvedValueOnce([{ id: "student-booking" }] as never);
    vi.mocked(db.auditLog.findMany).mockResolvedValue([
      { id: "student-audit", entityId: "student-booking", createdAt: new Date("2026-06-24T10:01:30.000Z") },
    ] as never);

    const res = await call("?since=2026-06-24T10%3A00%3A00.000Z");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.changedBookingIds).toEqual(["student-booking"]);
    expect(db.booking.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        OR: [
          { updatedAt: { gt: new Date("2026-06-24T10:00:00.000Z") } },
          { updatedAt: new Date("2026-06-24T10:00:00.000Z"), id: { gt: "" } },
        ],
      },
    }));
    expect(db.booking.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: { in: ["student-booking"] } },
    }));
  });

  it("rejects invalid cursors before querying for changes", async () => {
    const res = await call("?since=not-a-date");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid booking change cursor");
    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("rate limits polling per signed-in user", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const res = await call("?since=2026-06-24T10%3A00%3A00.000Z");
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe("Too many requests. Please wait a moment.");
    expect(db.booking.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
