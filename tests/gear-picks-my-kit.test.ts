import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    gearPickCycle: { findUnique: vi.fn() },
    gearPickParticipant: { findUnique: vi.fn() },
    gearPickStudent: { findUnique: vi.fn() },
    gearPickHandout: { findMany: vi.fn() },
  },
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as getKit } from "@/app/api/gear-picks/me/kit/route";

type MockFn = ReturnType<typeof vi.fn>;
const mocks = db as unknown as Record<string, Record<string, MockFn>>;
const context = { params: Promise.resolve({}) };
const staff = { id: "user-1", name: "Erik Role", email: "erik@example.com", role: Role.STAFF, avatarUrl: null };
const student = { ...staff, id: "student-1", role: Role.STUDENT };

const cycle = {
  title: "2027–28 Under Armour staff gear",
  launchedAt: new Date("2026-10-01T12:00:00Z"),
  orderPlacedAt: new Date("2026-10-14T12:00:00Z"),
  poNumber: "PO-1",
  orderNumber: "ORD-1",
  expectedAt: new Date("2027-07-02T12:00:00Z"),
};
const call = () => getKit(new Request("https://app.example.com/api/gear-picks/me/kit"), context);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gearPickCycle!.findUnique!.mockResolvedValue(cycle);
  mocks.gearPickParticipant!.findUnique!.mockResolvedValue(null);
  mocks.gearPickStudent!.findUnique!.mockResolvedValue(null);
  mocks.gearPickHandout!.findMany!.mockResolvedValue([]);
});

describe("GET /api/gear-picks/me/kit", () => {
  it("returns a staff kit with sizes from the profile and picks, marking handed pieces", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staff);
    mocks.gearPickParticipant!.findUnique!.mockResolvedValue({
      id: "p1",
      fit: "MEN",
      allowanceCents: 18_500,
      user: { id: "user-1", name: "Erik Role", email: "erik@example.com", active: true, topSize: "L", shoeSize: "10" },
      submission: {
        id: "s1",
        version: 1,
        totalCents: 1500,
        submittedAt: new Date("2026-10-05T12:00:00Z"),
        updatedAt: new Date("2026-10-05T12:00:00Z"),
        lines: [{ sku: "6021649-005", size: "L", quantity: 2, unitPriceCents: 1500, lineTotalCents: 3000 }],
      },
    });
    const first = await getKit(new Request("https://app.example.com/api/gear-picks/me/kit"), context);
    const body = (await first.json()) as { data: { kit: { group: string; order: { poNumber: string }; pieces: { sku: string; source: string; size: string; quantity: number; handed: boolean }[] } } };
    expect(body.data.kit.group).toBe("Staff");
    expect(body.data.kit.order.poNumber).toBe("PO-1");
    const pick = body.data.kit.pieces.find((piece) => piece.source === "PICK");
    expect(pick).toMatchObject({ sku: "6021649-005", size: "L", quantity: 2, handed: false });
    expect(body.data.kit.pieces.some((piece) => piece.source === "STANDARD_ISSUE")).toBe(true);

    mocks.gearPickHandout!.findMany!.mockResolvedValue([{ sku: "6021649-005", size: "L", source: "PICK", handedOutAt: new Date("2027-07-03T12:00:00Z") }]);
    const second = (await (await call()).json()) as typeof body;
    expect(second.data.kit.pieces.find((piece) => piece.source === "PICK")).toMatchObject({ handed: true });
  });

  it("returns the student kit for someone on the student list", async () => {
    vi.mocked(requireAuth).mockResolvedValue(student);
    mocks.gearPickStudent!.findUnique!.mockResolvedValue({
      id: "st1",
      user: { id: "student-1", name: "Sam", active: true, topSize: "M", topSizeFit: "MENS", shoeSize: null },
    });
    const body = (await (await call()).json()) as { data: { kit: { group: string; pieces: { source: string; size: string }[] } } };
    expect(body.data.kit.group).toBe("Student");
    expect(body.data.kit.pieces.length).toBeGreaterThan(0);
    expect(body.data.kit.pieces.every((piece) => piece.source === "STUDENT_KIT" && piece.size === "M")).toBe(true);
  });

  it("returns no kit before launch or when the person is not on the list", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staff);
    expect(((await (await call()).json()) as { data: { kit: unknown } }).data.kit).toBeNull();

    mocks.gearPickCycle!.findUnique!.mockResolvedValue({ ...cycle, launchedAt: null });
    mocks.gearPickStudent!.findUnique!.mockResolvedValue({ id: "st1", user: { id: "user-1", name: "x", active: true, topSize: "M", topSizeFit: null, shoeSize: null } });
    expect(((await (await call()).json()) as { data: { kit: unknown } }).data.kit).toBeNull();
  });
});
