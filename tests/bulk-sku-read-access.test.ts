import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  bulkSku: { findUnique: vi.fn() },
  bulkSkuUnit: { findMany: vi.fn() },
  bulkSkuProduct: { findMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET as getUnits } from "@/app/api/bulk-skus/[id]/units/route";
import { GET as getProducts } from "@/app/api/bulk-skus/[id]/products/route";

const params = { params: Promise.resolve({ id: "family-1" }) };

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.bulkSku.findUnique.mockResolvedValue({ id: "family-1", trackByNumber: true });
  dbMock.bulkSkuUnit.findMany.mockResolvedValue([]);
  dbMock.bulkSkuProduct.findMany.mockResolvedValue([]);
});

describe("item family unit and product reads", () => {
  it("lets a student read units and products", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "student-1",
      email: "student@example.com",
      name: "Student",
      role: Role.STUDENT,
      avatarUrl: null,
    });

    expect((await getUnits(get("/api/bulk-skus/family-1/units"), params)).status).toBe(200);
    expect((await getProducts(get("/api/bulk-skus/family-1/products"), params)).status).toBe(200);
  });

  it("denies a collaborator without catalog access before reading units or products", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "collab-1",
      email: "collab@example.com",
      name: "Collab",
      role: Role.COLLABORATOR,
      avatarUrl: null,
      capabilities: ["MY_GEAR_VIEW"],
    });

    expect((await getUnits(get("/api/bulk-skus/family-1/units"), params)).status).toBe(403);
    expect((await getProducts(get("/api/bulk-skus/family-1/products"), params)).status).toBe(403);
    expect(dbMock.bulkSku.findUnique).not.toHaveBeenCalled();
    expect(dbMock.bulkSkuUnit.findMany).not.toHaveBeenCalled();
    expect(dbMock.bulkSkuProduct.findMany).not.toHaveBeenCalled();
  });
});
