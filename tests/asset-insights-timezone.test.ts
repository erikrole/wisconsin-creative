import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  asset: { findUnique: vi.fn() },
  bookingSerializedItem: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET } from "@/app/api/assets/[id]/insights/route";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T18:00:00.000Z"));
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    id: "staff-1",
    email: "staff@example.com",
    name: "Staff",
    role: Role.STAFF,
    avatarUrl: null,
  });
  dbMock.asset.findUnique.mockResolvedValue({
    id: "asset-1",
    purchasePrice: null,
    purchaseDate: null,
  });
  dbMock.auditLog.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/assets/[id]/insights", () => {
  it("files an evening checkout on the Madison day and month", async () => {
    // Sat Oct 31, 2026, 9:00pm CDT = Sun Nov 1, 02:00 UTC.
    dbMock.bookingSerializedItem.findMany.mockResolvedValue([{
      booking: {
        id: "booking-1",
        kind: "CHECKOUT",
        status: "COMPLETED",
        startsAt: new Date("2026-11-01T02:00:00.000Z"),
        endsAt: new Date("2026-11-01T04:00:00.000Z"),
        updatedAt: new Date("2026-11-01T04:00:00.000Z"),
        sportCode: "FB",
        requester: { name: "Pat" },
      },
    }]);

    const res = await GET(new Request("https://app.example.com/api/assets/asset-1/insights", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({ id: "asset-1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.all.monthly).toEqual([
      { month: "2026-10", checkouts: 1, reservations: 0 },
    ]);
    // Mon=0 … Sat=5. The UTC day would have been Sunday.
    expect(body.data.all.byDayOfWeek).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });
});
