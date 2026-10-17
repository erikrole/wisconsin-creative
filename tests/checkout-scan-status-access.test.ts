import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  booking: { findUnique: vi.fn() },
  scanEvent: { findMany: vi.fn() },
  checkinItemReport: { findMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET } from "@/app/api/checkouts/[id]/scan-status/route";

const checkout = {
  id: "co-1",
  kind: "CHECKOUT",
  title: "Saturday game",
  status: "OPEN",
  requester: { id: "owner-1", name: "Owner" },
  location: { id: "loc-1", name: "Kohl Center" },
  serializedItems: [{
    allocationStatus: "active",
    asset: {
      id: "asset-1",
      assetTag: "FX3-1",
      brand: "Sony",
      model: "FX3",
      qrCodeValue: "secret-qr",
      primaryScanCode: "secret-scan",
      imageUrl: null,
      category: { name: "Camera" },
    },
  }],
  bulkItems: [],
};

function get(phase = "CHECKOUT") {
  return GET(new Request(`https://app.example.com/api/checkouts/co-1/scan-status?phase=${phase}`, {
    headers: { host: "app.example.com" },
  }), { params: Promise.resolve({ id: "co-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.booking.findUnique.mockResolvedValue(checkout);
  dbMock.scanEvent.findMany.mockResolvedValue([]);
  dbMock.checkinItemReport.findMany.mockResolvedValue([]);
});

describe("GET /api/checkouts/[id]/scan-status", () => {
  it("gives staff the scan codes for a return", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "staff-1",
      email: "staff@example.com",
      name: "Staff",
      role: Role.STAFF,
      avatarUrl: null,
    });

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { serializedItems: [{ qrCodeValue: "secret-qr", primaryScanCode: "secret-scan" }] },
    });
  });

  it("hides another person's scan codes from a collaborator", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "collab-1",
      email: "collab@example.com",
      name: "Collab",
      role: Role.COLLABORATOR,
      avatarUrl: null,
      capabilities: ["MY_GEAR_VIEW"],
    });

    const res = await get();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("You can only view scan status for your own checkouts");
    expect(JSON.stringify(body)).not.toContain("secret-qr");
  });

  it("denies a collaborator without My Gear before loading the checkout", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "collab-1",
      email: "collab@example.com",
      name: "Collab",
      role: Role.COLLABORATOR,
      avatarUrl: null,
      capabilities: [],
    });

    const res = await get();
    expect(res.status).toBe(403);
    expect(dbMock.booking.findUnique).not.toHaveBeenCalled();
  });
});
