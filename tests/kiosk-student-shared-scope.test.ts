import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  bookingFindMany: vi.fn(),
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
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

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getClientIp: mocks.getClientIp,
}));

import { GET as getKioskStudent } from "@/app/api/kiosk/student/[userId]/route";

type Row = Record<string, unknown> & {
  custodyScope: "PERSON" | "SHARED";
  requesterUserId: string;
  kind: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
};

function matches(row: Row, where: Record<string, unknown>) {
  for (const [key, value] of Object.entries(where)) {
    if (key === "startsAt" || key === "endsAt") {
      const range = value as { lte?: Date; gte?: Date; gt?: Date };
      const at = row[key] as Date;
      if (range.lte && !(at <= range.lte)) return false;
      if (range.gte && !(at >= range.gte)) return false;
      if (range.gt && !(at > range.gt)) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

const hour = 60 * 60 * 1000;

function booking(overrides: Partial<Row> & Pick<Row, "id" | "kind" | "status" | "custodyScope">): Row {
  const now = Date.now();
  return {
    title: String(overrides.id),
    refNumber: String(overrides.id).toUpperCase(),
    requesterUserId: "user-1",
    startsAt: new Date(now - hour),
    endsAt: new Date(now + 4 * hour),
    createdAt: new Date(now - 2 * hour),
    serializedItems: [],
    bulkItems: [],
    ...overrides,
  } as Row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientIp.mockReturnValue("203.0.113.10");
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.userFindUnique.mockResolvedValue({
    id: "user-1",
    active: true,
    hiddenFromRoster: false,
    role: "STAFF",
    affiliation: null,
    collaboratorProfile: null,
    collaboratorPolicy: null,
  });
});

describe("kiosk operator hub excludes SHARED custody from personal lists (D-061)", () => {
  it("lists only the person's own checkouts, pickups, and reservations", async () => {
    const rows: Row[] = [
      booking({ id: "co-personal", kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON" }),
      booking({ id: "co-shared", kind: "CHECKOUT", status: "OPEN", custodyScope: "SHARED" }),
      booking({ id: "rv-personal-due", kind: "RESERVATION", status: "BOOKED", custodyScope: "PERSON" }),
      booking({ id: "rv-shared-due", kind: "RESERVATION", status: "BOOKED", custodyScope: "SHARED" }),
      booking({
        id: "rv-personal-soon",
        kind: "RESERVATION",
        status: "BOOKED",
        custodyScope: "PERSON",
        startsAt: new Date(Date.now() + 24 * hour),
        endsAt: new Date(Date.now() + 30 * hour),
      }),
      booking({
        id: "rv-shared-soon",
        kind: "RESERVATION",
        status: "BOOKED",
        custodyScope: "SHARED",
        startsAt: new Date(Date.now() + 24 * hour),
        endsAt: new Date(Date.now() + 30 * hour),
      }),
    ];
    mocks.bookingFindMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, where)));

    const res = await getKioskStudent(
      new Request("http://test"),
      { params: Promise.resolve({ userId: "user-1" }) },
    );
    const json = await res.json();

    expect(json.checkouts.map((row: { id: string }) => row.id)).toEqual(["co-personal"]);
    expect(json.pendingPickups.map((row: { id: string }) => row.id)).toEqual(["rv-personal-due"]);
    expect(json.reservations.map((row: { id: string }) => row.id)).toEqual(["rv-personal-soon"]);
    for (const [args] of mocks.bookingFindMany.mock.calls) {
      expect(args.where).toMatchObject({ requesterUserId: "user-1", custodyScope: "PERSON" });
    }
  });
});
