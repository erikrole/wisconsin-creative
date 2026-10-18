import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import type { CollaboratorCapability } from "@/lib/collaborator-access";

const dbMock = vi.hoisted(() => ({
  asset: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/services/status", () => ({ deriveAssetStatus: vi.fn(async () => "AVAILABLE") }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET as getAccessories } from "@/app/api/assets/[id]/accessories/route";
import { GET as getAsset } from "@/app/api/assets/[id]/route";

const accessory = {
  id: "child-1",
  assetTag: "FX3-CAGE",
  name: "Cage",
  brand: "SmallRig",
  model: "Cage",
  serialNumber: "secret-serial",
  status: "AVAILABLE",
  type: "Camera",
  imageUrl: null,
};

function collaborator(capabilities: CollaboratorCapability[]) {
  return {
    id: "collab-1",
    email: "collab@example.com",
    name: "Collab",
    role: Role.COLLABORATOR,
    avatarUrl: null,
    capabilities,
  };
}

function selectedFields<T extends Record<string, unknown>>(row: T, select: Record<string, boolean> | undefined) {
  if (!select) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => select[key]));
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.asset.findFirst.mockResolvedValue({
    id: "parent-1",
    assetTag: "FX3-1",
    name: "FX3",
    brand: "Sony",
    model: "FX3",
    imageUrl: null,
    location: null,
    category: null,
  });
  dbMock.asset.findMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => [
    selectedFields(accessory, args.select),
  ]);
});

describe("item attachments", () => {
  it("hides serial numbers from a collaborator who can browse the catalog", async () => {
    vi.mocked(requireAuth).mockResolvedValue(collaborator(["GEAR_CATALOG_VIEW"]));

    const res = await getAccessories(new Request("https://app.example.com/api/assets/parent-1/accessories", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({ id: "parent-1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{
      id: "child-1",
      assetTag: "FX3-CAGE",
      name: "Cage",
      brand: "SmallRig",
      model: "Cage",
      status: "AVAILABLE",
      type: "Camera",
      imageUrl: null,
    }]);
    expect(JSON.stringify(body)).not.toContain("secret-serial");
    expect(dbMock.asset.findMany.mock.calls[0]![0].select).not.toHaveProperty("serialNumber");
  });

  it("does not list attachments for a parent a collaborator cannot open", async () => {
    vi.mocked(requireAuth).mockResolvedValue(collaborator(["GEAR_CATALOG_VIEW"]));
    dbMock.asset.findFirst.mockResolvedValue(null);

    const res = await getAccessories(new Request("https://app.example.com/api/assets/retired-1/accessories", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({ id: "retired-1" }) });

    expect(res.status).toBe(404);
    expect(dbMock.asset.findMany).not.toHaveBeenCalled();
  });

  it("includes attachments without serial numbers on a collaborator item", async () => {
    vi.mocked(requireAuth).mockResolvedValue(collaborator(["GEAR_CATALOG_VIEW"]));

    const res = await getAsset(new Request("https://app.example.com/api/assets/parent-1", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({ id: "parent-1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accessories).toEqual([{
      id: "child-1",
      assetTag: "FX3-CAGE",
      name: "Cage",
      brand: "SmallRig",
      model: "Cage",
      status: "AVAILABLE",
      type: "Camera",
      imageUrl: null,
    }]);
    expect(JSON.stringify(body)).not.toContain("secret-serial");
  });

  it("returns serial numbers to staff", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "staff-1",
      email: "staff@example.com",
      name: "Staff",
      role: Role.STAFF,
      avatarUrl: null,
    });

    const res = await getAccessories(new Request("https://app.example.com/api/assets/parent-1/accessories", {
      headers: { host: "app.example.com" },
    }), { params: Promise.resolve({ id: "parent-1" }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: [{ serialNumber: "secret-serial" }],
    });
    expect(dbMock.asset.findFirst).not.toHaveBeenCalled();
  });
});
