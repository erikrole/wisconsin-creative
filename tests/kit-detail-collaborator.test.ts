import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));

const kitFindUnique = vi.hoisted(() => vi.fn());
const assetAllocationFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    kit: { findUnique: kitFindUnique },
    location: { findUnique: vi.fn(), findMany: vi.fn() },
    assetAllocation: { findMany: assetAllocationFindMany },
    $executeRaw: vi.fn(),
  },
}));

import { requireAuth } from "@/lib/auth";
import { GET } from "@/app/api/kits/[id]/route";

const kitId = "cm000000000000000000000010";

const collaborator = {
  id: "cm000000000000000000000001",
  email: "partner@example.com",
  name: "Partner",
  role: Role.COLLABORATOR,
  capabilities: ["RESERVATION_CREATE"],
  avatarUrl: null,
  forcePasswordChange: false,
};

const staff = {
  ...collaborator,
  id: "cm000000000000000000000002",
  email: "staff@example.com",
  name: "Staff",
  role: Role.STAFF,
  capabilities: undefined,
};

const holderRow = {
  assetId: "cam-1",
  startsAt: new Date("2026-10-12T12:00:00.000Z"),
  endsAt: new Date("2026-10-13T12:00:00.000Z"),
  booking: {
    id: "booking-1",
    kind: "CHECKOUT",
    status: "OPEN",
    title: "Football at Iowa",
    endsAt: new Date("2026-10-13T18:00:00.000Z"),
    requester: { name: "Alex Kim" },
  },
};

function kitRow() {
  return {
    id: kitId,
    name: "Slow 1",
    description: null,
    active: true,
    locationId: "loc-1",
    sportCode: null,
    gamedayRole: null,
    location: { id: "loc-1", name: "Studio Cage" },
    members: [
      {
        id: "member-1",
        asset: {
          id: "cam-1",
          assetTag: "CAM 102",
          name: "Cinema camera",
          type: "Camera",
          brand: "Sony",
          model: "FX6",
          status: "AVAILABLE",
          imageUrl: null,
          category: { id: "cat-1", name: "Cameras" },
        },
      },
    ],
    bulkMembers: [],
  };
}

function request() {
  return new Request(`https://app.example.com/api/kits/${kitId}`, {
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  kitFindUnique.mockResolvedValue(kitRow());
  assetAllocationFindMany.mockResolvedValue([holderRow]);
});

describe("GET /api/kits/[id] collaborator kit detail", () => {
  it("keeps hold timing and omits who has the gear", async () => {
    vi.mocked(requireAuth).mockResolvedValue(collaborator as never);
    const res = await GET(request(), { params: Promise.resolve({ id: kitId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const asset = body.data.members[0].asset;

    expect(asset.computedStatus).toBe("CHECKED_OUT");
    expect(asset.currentHolder).toEqual({ endsAt: "2026-10-13T18:00:00.000Z" });
    expect(JSON.stringify(body)).not.toContain("Alex Kim");
    expect(JSON.stringify(body)).not.toContain("Football at Iowa");
    expect(JSON.stringify(body)).not.toContain("booking-1");

    vi.mocked(requireAuth).mockResolvedValue(staff as never);
    const staffRes = await GET(request(), { params: Promise.resolve({ id: kitId }) });
    const staffBody = await staffRes.json();
    expect(staffBody.data.members[0].asset.currentHolder).toEqual({
      bookingId: "booking-1",
      bookingTitle: "Football at Iowa",
      holderName: "Alex Kim",
      endsAt: "2026-10-13T18:00:00.000Z",
    });
  });
});
