import { describe, expect, it } from "vitest";
import { choosePickupSubstitutionCandidate, pickupSubstitutionOffer } from "@/lib/services/kiosk-pickup-substitute";

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

describe("pickupSubstitutionOffer", () => {
  const mic = { id: "mic-12", name: "Rode NTG5", assetTag: "MIC-12", type: "Microphone", categoryId: "mics" };

  it("offers a like-for-like swap with the reserved item's id", () => {
    const offer = pickupSubstitutionOffer(
      [remaining({ assetId: "mic-09", tag: "MIC-09", name: "Rode NTG5", categoryId: "mics" })],
      mic,
      new Set(),
    );
    expect(offer).toEqual({
      scanned: { id: "mic-12", name: "Rode NTG5", tagName: "MIC-12" },
      reserved: { id: "mic-09", name: "Rode NTG5", tagName: "MIC-09" },
    });
  });

  it("does not pair an unrelated scan with the last remaining item", () => {
    const offer = pickupSubstitutionOffer(
      [remaining({ assetId: "cam-1", tag: "CAM-1", name: "Sony FX3", categoryId: "cameras" })],
      mic,
      new Set(),
    );
    expect(offer).toBeNull();
  });

  it("skips reserved items already scanned", () => {
    const offer = pickupSubstitutionOffer(
      [remaining({ assetId: "mic-09", tag: "MIC-09", name: "Rode NTG5", categoryId: "mics" })],
      mic,
      new Set(["mic-09"]),
    );
    expect(offer).toBeNull();
  });
});
