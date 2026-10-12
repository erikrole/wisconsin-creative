import { beforeEach, describe, expect, it, vi } from "vitest";

const kitMembership = vi.hoisted(() => ({ findMany: vi.fn() }));
const assetAllocation = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { kitMembership, assetAllocation } }));

import { summarizeKitListAvailability } from "@/lib/services/kit-list-availability";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("summarizeKitListAvailability", () => {
  it("counts checked-out members without treating shelf status as truth", async () => {
    kitMembership.findMany.mockResolvedValue([
      { kitId: "slow-1", asset: { id: "cam-1", status: "AVAILABLE" } },
      { kitId: "slow-1", asset: { id: "lens-1", status: "AVAILABLE" } },
      { kitId: "bench", asset: { id: "cam-2", status: "AVAILABLE" } },
    ]);
    assetAllocation.findMany.mockResolvedValue([
      {
        assetId: "cam-1",
        startsAt: new Date("2026-10-12T12:00:00.000Z"),
        endsAt: new Date("2026-10-13T12:00:00.000Z"),
        booking: { kind: "CHECKOUT", status: "OPEN" },
      },
      {
        assetId: "cam-2",
        startsAt: new Date("2026-10-12T12:00:00.000Z"),
        endsAt: new Date("2026-10-13T12:00:00.000Z"),
        booking: { kind: "CHECKOUT", status: "OPEN" },
      },
    ]);

    const summaries = await summarizeKitListAvailability(["slow-1", "bench", "empty"]);

    expect(summaries.get("slow-1")).toEqual({ serialized: 2, unavailable: 1 });
    expect(summaries.get("bench")).toEqual({ serialized: 1, unavailable: 1 });
    expect(summaries.get("empty")).toEqual({ serialized: 0, unavailable: 0 });
  });
});
