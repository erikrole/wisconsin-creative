import { getNextSequentialAssetTag } from "./repeat-tags";

export const MAX_SERIALIZED_BATCH_SIZE = 25;

export type SerializedUnitDraft = {
  key: string;
  assetTag: string;
  serialNumber: string;
  qrCodeValue: string;
  uwAssetTag: string;
};

export type SerializedUnitDraftError = {
  fieldId: string;
  message: string;
};

type UnitFactory = {
  qrCode: () => string;
  key?: () => string;
};

function normalizeIdentity(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function clampSerializedBatchSize(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SERIALIZED_BATCH_SIZE, Math.max(1, Math.trunc(value)));
}

function createUnitDraft(assetTag: string, factory: UnitFactory): SerializedUnitDraft {
  const qrCodeValue = factory.qrCode();
  return {
    key: factory.key?.() ?? `unit-${qrCodeValue}`,
    assetTag,
    serialNumber: "",
    qrCodeValue,
    uwAssetTag: "",
  };
}

export function resizeSerializedUnitDrafts(
  units: SerializedUnitDraft[],
  requestedSize: number,
  factory: UnitFactory,
) {
  const size = clampSerializedBatchSize(requestedSize);
  if (units.length >= size) return units.slice(0, size);

  const next = [...units];
  let previousTag = next.at(-1)?.assetTag.trim() ?? "";
  while (next.length < size) {
    previousTag = getNextSequentialAssetTag(previousTag);
    next.push(createUnitDraft(previousTag, factory));
  }
  return next;
}

export function regenerateSerializedUnitTags(units: SerializedUnitDraft[]) {
  if (units.length === 0) return units;
  let nextTag = units[0]!.assetTag.trim();
  return units.map((unit, index) => {
    if (index > 0) nextTag = getNextSequentialAssetTag(nextTag);
    return { ...unit, assetTag: nextTag };
  });
}

export function updateSerializedUnitAssetTag(
  units: SerializedUnitDraft[],
  unitKey: string,
  value: string,
) {
  const index = units.findIndex((unit) => unit.key === unitKey);
  if (index !== 0) {
    return units.map((unit) => unit.key === unitKey ? { ...unit, assetTag: value } : unit);
  }

  let previousOldTag = units[0]?.assetTag ?? "";
  let previousNewTag = value;
  return units.map((unit, unitIndex) => {
    if (unitIndex === 0) return { ...unit, assetTag: value };

    const oldSuggestedTag = getNextSequentialAssetTag(previousOldTag);
    const followsSequence = !unit.assetTag.trim()
      || normalizeIdentity(unit.assetTag) === normalizeIdentity(oldSuggestedTag);
    const nextTag = followsSequence
      ? getNextSequentialAssetTag(previousNewTag)
      : unit.assetTag;
    previousOldTag = unit.assetTag;
    previousNewTag = nextTag;
    return { ...unit, assetTag: nextTag };
  });
}

export function parsePastedSerialNumbers(value: string) {
  return value
    .split(/[\n\t,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_SERIALIZED_BATCH_SIZE);
}

export function applyPastedSerialNumbers(
  units: SerializedUnitDraft[],
  serialNumbers: string[],
  factory: UnitFactory,
) {
  const targetSize = Math.max(units.length, Math.min(serialNumbers.length, MAX_SERIALIZED_BATCH_SIZE));
  return resizeSerializedUnitDrafts(units, targetSize, factory).map((unit, index) => ({
    ...unit,
    serialNumber: serialNumbers[index] ?? unit.serialNumber,
  }));
}

export function serializedUnitFieldId(unit: SerializedUnitDraft, field: "asset-tag" | "serial" | "qr" | "uw-tag") {
  return `new-item-${field}-${unit.key}`;
}

export function getSerializedUnitDraftErrors(units: SerializedUnitDraft[]) {
  const errors = new Map<string, string>();
  const seenTags = new Map<string, SerializedUnitDraft>();
  const seenSerials = new Map<string, SerializedUnitDraft>();
  const seenQrCodes = new Map<string, SerializedUnitDraft>();

  for (const unit of units) {
    const tagId = serializedUnitFieldId(unit, "asset-tag");
    const serialId = serializedUnitFieldId(unit, "serial");
    const qrId = serializedUnitFieldId(unit, "qr");
    const tag = normalizeIdentity(unit.assetTag);
    const serial = normalizeIdentity(unit.serialNumber);
    const qrCode = normalizeIdentity(unit.qrCodeValue);

    if (!tag) {
      errors.set(tagId, "Asset tag is required.");
    } else if (seenTags.has(tag)) {
      errors.set(tagId, `Asset tag duplicates ${seenTags.get(tag)!.assetTag}.`);
    } else {
      seenTags.set(tag, unit);
    }

    if (serial) {
      if (seenSerials.has(serial)) {
        errors.set(serialId, `Serial number duplicates ${seenSerials.get(serial)!.serialNumber}.`);
      } else {
        seenSerials.set(serial, unit);
      }
    }

    if (!qrCode) {
      errors.set(qrId, "QR code is required.");
    } else if (seenQrCodes.has(qrCode)) {
      errors.set(qrId, "QR code is duplicated in this batch.");
    } else {
      seenQrCodes.set(qrCode, unit);
    }
  }

  return errors;
}

export function validateSerializedUnitDrafts(units: SerializedUnitDraft[]): SerializedUnitDraftError | null {
  if (units.length < 1 || units.length > MAX_SERIALIZED_BATCH_SIZE) {
    return {
      fieldId: "new-item-batch-size",
      message: `Choose between 1 and ${MAX_SERIALIZED_BATCH_SIZE} physical items.`,
    };
  }

  const firstError = getSerializedUnitDraftErrors(units).entries().next().value as [string, string] | undefined;
  return firstError ? { fieldId: firstError[0], message: firstError[1] } : null;
}

export function countReadySerializedUnits(units: SerializedUnitDraft[]) {
  const errors = getSerializedUnitDraftErrors(units);
  return units.filter((unit) => (
    !errors.has(serializedUnitFieldId(unit, "asset-tag"))
    && !errors.has(serializedUnitFieldId(unit, "serial"))
    && !errors.has(serializedUnitFieldId(unit, "qr"))
  )).length;
}
