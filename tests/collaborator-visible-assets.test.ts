import { describe, expect, it, vi } from "vitest";
import { BookingKind } from "@prisma/client";
import { checkAssetStatuses } from "@/lib/services/availability";

function txWith(assets: Array<{ id: string; collaboratorVisible: boolean }>) {
  return {
    asset: {
      findMany: vi.fn().mockResolvedValue(
        assets.map((asset) => ({
          status: "AVAILABLE",
          availableForCheckout: true,
          availableForReservation: true,
          ...asset,
        })),
      ),
    },
  } as never;
}

describe("collaborator-visible items", () => {
  it("blocks a collaborator reservation for an item hidden from partners", async () => {
    const tx = txWith([
      { id: "shown", collaboratorVisible: true },
      { id: "hidden", collaboratorVisible: false },
    ]);
    const result = await checkAssetStatuses(tx, {
      serializedAssetIds: ["shown", "hidden"],
      bookingKind: BookingKind.RESERVATION,
      forCollaborator: true,
    });
    expect(result).toEqual([{ assetId: "hidden", status: "NOT_AVAILABLE_FOR_COLLABORATORS" }]);
  });

  it("lets staff and students reserve the same hidden item", async () => {
    const tx = txWith([{ id: "hidden", collaboratorVisible: false }]);
    const result = await checkAssetStatuses(tx, {
      serializedAssetIds: ["hidden"],
      bookingKind: BookingKind.RESERVATION,
    });
    expect(result).toEqual([]);
  });
});
