import { describe, expect, it } from "vitest";
import { choosePickupSubstitutionCandidate } from "@/lib/services/kiosk-pickup-substitute";

function remaining(over: {
  assetId: string;
  tag: string;
  name?: string;
  type?: string;
  categoryId?: string | null;
  allocationStatus?: string;
}) {
  return {
    assetId: over.assetId,
    allocationStatus: over.allocationStatus ?? "active",
    asset: {
      id: over.assetId,
      assetTag: over.tag,
      name: over.name ?? over.tag,
      type: over.type ?? "Gear",
      categoryId: over.categoryId ?? null,
    },
  };
}

describe("choosePickupSubstitutionCandidate", () => {
  const scanned = {
    id: "755",
    name: "Manfrotto 755CX3 Tripod",
    assetTag: "Manfrotto 755CX3 Tripod",
    type: "Tripod",
    categoryId: "tripods",
  };

  it("offers the only remaining unscanned item even when the category differs", () => {
    const chosen = choosePickupSubstitutionCandidate(
      [remaining({ assetId: "535", tag: "Manfrotto 535 MPro Tripod", type: "Support", categoryId: "support" })],
      scanned,
      new Set(),
    );
    expect(chosen?.assetId).toBe("535");
  });

  it("picks the same-category remaining item when more than one item is left", () => {
    const chosen = choosePickupSubstitutionCandidate(
      [
        remaining({ assetId: "fx3", tag: "FX3 2", type: "Camera", categoryId: "cameras" }),
        remaining({ assetId: "535", tag: "Manfrotto 535 MPro Tripod", type: "Tripod", categoryId: "tripods" }),
      ],
      scanned,
      new Set(),
    );
    expect(chosen?.assetId).toBe("535");
  });

  it("does not offer an already scanned remaining item", () => {
    const chosen = choosePickupSubstitutionCandidate(
      [remaining({ assetId: "535", tag: "Manfrotto 535 MPro Tripod", categoryId: "tripods" })],
      scanned,
      new Set(["535"]),
    );
    expect(chosen).toBeNull();
  });

  it("returns null when leftover items are in other families", () => {
    const chosen = choosePickupSubstitutionCandidate(
      [
        remaining({ assetId: "fx3", tag: "FX3 2", type: "Camera", categoryId: "cameras" }),
        remaining({ assetId: "lens", tag: "16-35 1", type: "Lens", categoryId: "lenses" }),
      ],
      scanned,
      new Set(),
    );
    expect(chosen).toBeNull();
  });
});
