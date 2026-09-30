import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingItems: vi.fn(),
  asset: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  asset: { findUnique: mocks.asset },
  bookingSerializedItem: { findMany: mocks.bookingItems },
  auditLog: { findMany: mocks.audit },
} }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET } from "@/app/api/assets/[id]/insights/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
  vi.mocked(requireAuth).mockResolvedValue({ id: "staff-1", role: Role.STAFF } as Awaited<ReturnType<typeof requireAuth>>);
  mocks.asset.mockResolvedValue({ id: "asset-1", purchasePrice: null, purchaseDate: null });
  mocks.audit.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("asset insights utilization", () => {
  it.each([
    { name: "empty history", intervals: [], utilizationPct: 0 },
    { name: "overlapping bookings counted once", intervals: [["2026-02-01", "2026-02-05"], ["2026-02-03", "2026-02-07"]], utilizationPct: 20 },
    { name: "adjacent bookings with exclusive ends", intervals: [["2026-02-01", "2026-02-02"], ["2026-02-02", "2026-02-03"]], utilizationPct: 6.7 },
    { name: "duplicate intervals counted once", intervals: [["2026-02-01", "2026-02-05"], ["2026-02-01", "2026-02-05"]], utilizationPct: 13.3 },
    { name: "existing partial-day sampling", intervals: [["2026-02-01T23:00:00Z", "2026-02-02T02:00:00Z"]], utilizationPct: 3.3 },
    { name: "history clipped at both window edges", intervals: [["2025-01-01", "2027-01-01"]], utilizationPct: 100 },
    { name: "zero-length booking", intervals: [["2026-02-01", "2026-02-01"]], utilizationPct: 0 },
    { name: "out-of-window history", intervals: [["2025-12-01", "2025-12-10"]], utilizationPct: 0 },
    { name: "unsorted separated and nested intervals", intervals: [["2026-02-10", "2026-02-12"], ["2026-02-01", "2026-02-05"], ["2026-02-02", "2026-02-03"]], utilizationPct: 20 },
  ])("preserves $name", async ({ intervals, utilizationPct }) => {
    mocks.bookingItems.mockResolvedValue(intervals.map(([start, end], index) => ({ booking: {
      id: `booking-${index}`, kind: "CHECKOUT", status: "COMPLETED",
      startsAt: new Date(start!), endsAt: new Date(end!), updatedAt: new Date(end!),
      sportCode: "FB", requester: { name: "Test borrower" },
    } })));

    const response = await GET(new Request("https://app.example.com/api/assets/asset-1/insights"), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=60");
    await expect(response.json()).resolves.toMatchObject({ data: { "30d": { utilizationPct } } });
  });
});
