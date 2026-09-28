import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  bookingFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mocks.userFindUnique },
    booking: { findMany: mocks.bookingFindMany },
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: { kioskId: string; locationId: string; locationName: string };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) => handler(req, {
    params: await ctx.params,
    kiosk: { kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall" },
  }),
}));

vi.mock("@/lib/services/kiosk-checkout-allowance", () => ({
  evaluateKioskCheckoutAllowance: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue("203.0.113.10"),
}));

import { GET as getKioskStudent } from "@/app/api/kiosk/student/[userId]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindUnique.mockResolvedValue({
    id: "user-1",
    active: true,
    hiddenFromRoster: false,
    role: "STUDENT",
    affiliation: null,
    collaboratorProfile: null,
    collaboratorPolicy: null,
  });
});

describe("kiosk student pending pickup kind", () => {
  it("marks PENDING_PICKUP checkouts and due reservations so the hub only offers reservation changes on reservations", async () => {
    const startsAt = new Date("2026-08-01T12:00:00.000Z");
    mocks.bookingFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "legacy-pickup",
        title: "Road trip",
        refNumber: "CO-1002",
        startsAt,
        serializedItems: [],
        bulkItems: [],
      }])
      .mockResolvedValueOnce([{
        id: "due-reservation",
        title: "Duals",
        refNumber: "RV-1001",
        startsAt,
        serializedItems: [],
        bulkItems: [],
      }])
      .mockResolvedValueOnce([]);

    const res = await getKioskStudent(
      new Request("http://test"),
      { params: Promise.resolve({ userId: "user-1" }) },
    );
    const json = await res.json();

    expect(json.pendingPickups.map((p: { id: string; kind: string }) => [p.id, p.kind])).toEqual([
      ["legacy-pickup", "checkout"],
      ["due-reservation", "reservation"],
    ]);
  });
});
