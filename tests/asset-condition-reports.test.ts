import { beforeEach, describe, expect, it, vi } from "vitest";
const { auth, assetFindUnique } = vi.hoisted(() => ({ auth: vi.fn(), assetFindUnique: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: auth }));
vi.mock("@/lib/db", () => ({ db: {
  asset: { findUnique: assetFindUnique, findMany: vi.fn(async () => []) },
  bookingSerializedItem: { findMany: vi.fn(async () => []) },
  assetAllocation: { findMany: vi.fn(async () => []) },
  favoriteItem: { findUnique: vi.fn(async () => null) },
} }));
vi.mock("@/lib/services/status", () => ({ deriveAssetStatus: vi.fn(async () => "MAINTENANCE") }));
vi.mock("@/lib/firmware-watch-targets", () => ({ canonicalFirmwareIdentity: vi.fn(() => null) }));
import { GET } from "@/app/api/assets/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  assetFindUnique.mockResolvedValue({ id: "a1", status: "MAINTENANCE", notes: null, brand: "Sony", model: "FX3" });
});

describe("item condition evidence visibility", () => {
  it.each(["STAFF", "ADMIN", "STUDENT"])("bounds report evidence and respects the %s role", async (role) => {
    auth.mockResolvedValue({ id: "u1", name: "Pat", role });
    const response = await GET(new Request("https://app.example.com/api/assets/a1"), { params: Promise.resolve({ id: "a1" }) });
    expect(response.status).toBe(200);
    const include = assetFindUnique.mock.calls[0]![0].include;
    if (role === "STUDENT") {
      expect(include.checkinReports).toBe(false);
    } else {
      expect(include.checkinReports).toMatchObject({
        take: 5,
        orderBy: [{ lastReportedAt: "desc" }, { id: "desc" }],
        select: {
          description: true, imageUrl: true, createdAt: true, lastReportedAt: true,
          reportedBy: { select: { name: true } }, booking: { select: { id: true, title: true } },
        },
      });
    }
  });
});
