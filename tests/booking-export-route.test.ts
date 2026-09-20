import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/bookings/export/route";

const admin = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};

async function call(query: string) {
  return GET(
    new Request(`https://app.example.com/api/bookings/export${query}`, {
      headers: { host: "app.example.com" },
    }),
    { params: Promise.resolve({}) },
  );
}

describe("booking export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(admin);
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.booking.count).mockResolvedValue(0);
  });

  it("rejects unknown booking kinds instead of silently exporting all rows", async () => {
    const res = await call("?kind=UNKNOWN");

    expect(res.status).toBe(400);
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("rejects invalid or inverted date ranges before querying", async () => {
    const invalid = await call("?from=not-a-date");
    const inverted = await call(
      "?from=2026-08-08T00%3A00%3A00.000Z&to=2026-08-07T00%3A00%3A00.000Z",
    );

    expect(invalid.status).toBe(400);
    expect(inverted.status).toBe(400);
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("applies a validated kind and inclusive creation window", async () => {
    const res = await call(
      "?kind=RESERVATION&from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-07T23%3A59%3A59.000Z",
    );

    expect(res.status).toBe(200);
    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        kind: "RESERVATION",
        createdAt: {
          gte: new Date("2026-08-01T00:00:00.000Z"),
          lte: new Date("2026-08-07T23:59:59.000Z"),
        },
      },
      take: 5000,
    }));
  });

  it("disables caching for the exported CSV", async () => {
    const res = await call("");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses stable timestamp ties in capped exports", async () => {
    await call("");

    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });
});
