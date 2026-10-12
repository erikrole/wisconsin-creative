import { beforeEach, describe, expect, it, vi } from "vitest";

const assetAllocation = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { assetAllocation } }));

import { attachKitMemberAvailability } from "@/lib/services/kit-member-availability";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("attachKitMemberAvailability", () => {
  it("replaces stored shelf status with the open checkout and names the holder", async () => {
    assetAllocation.findMany
      .mockResolvedValueOnce([
        {
          assetId: "cam-1",
          startsAt: new Date("2026-10-12T12:00:00.000Z"),
          endsAt: new Date("2026-10-13T12:00:00.000Z"),
          booking: { kind: "CHECKOUT", status: "OPEN" },
        },
      ])
      .mockResolvedValueOnce([
        {
          assetId: "cam-1",
          booking: {
            id: "booking-1",
            title: "Football at Iowa",
            endsAt: new Date("2026-10-13T18:00:00.000Z"),
            requester: { name: "Alex Kim" },
          },
        },
      ]);

    const kit = await attachKitMemberAvailability({
      id: "kit-1",
      members: [
        { asset: { id: "cam-1", status: "AVAILABLE" as const, assetTag: "CAM 102" } },
        { asset: { id: "lens-1", status: "AVAILABLE" as const, assetTag: "LENS 4" } },
      ],
    });

    expect(kit.members[0]?.asset.computedStatus).toBe("CHECKED_OUT");
    expect(kit.members[0]?.asset.currentHolder).toEqual({
      bookingId: "booking-1",
      bookingTitle: "Football at Iowa",
      holderName: "Alex Kim",
      endsAt: "2026-10-13T18:00:00.000Z",
    });
    expect(kit.members[1]?.asset.computedStatus).toBe("AVAILABLE");
    expect(kit.members[1]?.asset.currentHolder).toBeNull();
  });

  it("keeps maintenance as maintenance and does not look up a holder", async () => {
    assetAllocation.findMany.mockResolvedValue([]);
    const kit = await attachKitMemberAvailability({
      members: [{ asset: { id: "cam-9", status: "MAINTENANCE" as const } }],
    });
    expect(kit.members[0]?.asset.computedStatus).toBe("MAINTENANCE");
    expect(kit.members[0]?.asset.currentHolder).toBeNull();
    expect(assetAllocation.findMany).not.toHaveBeenCalled();
  });
});
