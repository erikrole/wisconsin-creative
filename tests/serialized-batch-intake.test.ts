import { describe, expect, it } from "vitest";
import {
  MAX_SERIALIZED_BATCH_SIZE,
  applyPastedSerialNumbers,
  clampSerializedBatchSize,
  countReadySerializedUnits,
  getSerializedUnitDraftErrors,
  parsePastedSerialNumbers,
  regenerateSerializedUnitTags,
  resizeSerializedUnitDrafts,
  updateSerializedUnitAssetTag,
  validateSerializedUnitDrafts,
  type SerializedUnitDraft,
} from "@/app/(app)/items/new-item-sheet/serialized-batch";

function factory() {
  let id = 1;
  return {
    qrCode: () => `QR-${id}`,
    key: () => `unit-${id++}`,
  };
}

function firstUnit(assetTag = "FX3 5"): SerializedUnitDraft {
  return {
    key: "unit-primary",
    assetTag,
    serialNumber: "",
    qrCodeValue: "QR-PRIMARY",
    uwAssetTag: "",
  };
}

describe("serialized batch intake", () => {
  it("bounds batch size to the supported operator workspace", () => {
    expect(clampSerializedBatchSize(0)).toBe(1);
    expect(clampSerializedBatchSize(4.9)).toBe(4);
    expect(clampSerializedBatchSize(999)).toBe(MAX_SERIALIZED_BATCH_SIZE);
  });

  it("preserves current rows and suggests sequential tags for added units", () => {
    const units = resizeSerializedUnitDrafts([firstUnit()], 4, factory());

    expect(units.map((unit) => unit.assetTag)).toEqual(["FX3 5", "FX3 6", "FX3 7", "FX3 8"]);
    expect(new Set(units.map((unit) => unit.qrCodeValue)).size).toBe(4);
    expect(resizeSerializedUnitDrafts(units, 2, factory()).map((unit) => unit.assetTag)).toEqual(["FX3 5", "FX3 6"]);
  });

  it("regenerates all later tags from the operator's first tag", () => {
    const units = resizeSerializedUnitDrafts([firstUnit("CAM 20")], 3, factory());
    units[1]!.assetTag = "manual value";

    expect(regenerateSerializedUnitTags(units).map((unit) => unit.assetTag)).toEqual(["CAM 20", "CAM 21", "CAM 22"]);
  });

  it("keeps generated tags in sequence when the first tag changes without overwriting manual rows", () => {
    const units = resizeSerializedUnitDrafts([firstUnit("FX3 5")], 4, factory());
    expect(updateSerializedUnitAssetTag(units, "unit-primary", "FX3 10").map((unit) => unit.assetTag))
      .toEqual(["FX3 10", "FX3 11", "FX3 12", "FX3 13"]);

    units[1]!.assetTag = "CABINET CAMERA";
    expect(updateSerializedUnitAssetTag(units, "unit-primary", "FX3 10").map((unit) => unit.assetTag))
      .toEqual(["FX3 10", "CABINET CAMERA", "FX3 7", "FX3 8"]);
  });

  it("parses spreadsheet columns and comma-separated serials", () => {
    expect(parsePastedSerialNumbers("A001\nA002\tA003, A004\n\n")).toEqual(["A001", "A002", "A003", "A004"]);
  });

  it("expands the unit list when pasted serials need more rows", () => {
    const units = applyPastedSerialNumbers([firstUnit()], ["S1", "S2", "S3"], factory());

    expect(units).toHaveLength(3);
    expect(units.map((unit) => unit.serialNumber)).toEqual(["S1", "S2", "S3"]);
    expect(units.map((unit) => unit.assetTag)).toEqual(["FX3 5", "FX3 6", "FX3 7"]);
  });

  it("blocks blank and duplicated per-unit identities before submit", () => {
    const units = resizeSerializedUnitDrafts([firstUnit()], 3, factory());
    units[1]!.assetTag = " fx3 5 ";
    units[2]!.serialNumber = "SERIAL-1";
    units[0]!.serialNumber = "serial-1";
    units[2]!.qrCodeValue = "";

    const errors = getSerializedUnitDraftErrors(units);
    expect([...errors.values()]).toEqual(expect.arrayContaining([
      "Asset tag duplicates FX3 5.",
      "Serial number duplicates serial-1.",
      "QR code is required.",
    ]));
    expect(validateSerializedUnitDrafts(units)).not.toBeNull();
    expect(countReadySerializedUnits(units)).toBe(1);
  });
});
