import { MAX_BULK_UNIT_NUMBER } from "@/lib/request-limits";

type DerivedBulkUnitQrSku = {
  id: string;
  binQrCodeValue: string | null;
  trackByNumber?: boolean | null;
};

type DerivedBulkUnitQrMatch = {
  bulkSkuId: string;
  binQrCodeValue: string;
  unitNumber: number;
};

/**
 * Format the derived unit QR value for a numbered bulk unit.
 * Mirror of {@link parseDerivedBulkUnitQr}: `{binQrCodeValue}-{unitNumber}`.
 * Never stored — derived at read/export time so the QR data stays single-sourced
 * on `BulkSku.binQrCodeValue` and `BulkSkuUnit.unitNumber` (Decision D-022).
 */
export function buildDerivedBulkUnitQrValue(
  binQrCodeValue: string,
  unitNumber: number,
): string {
  const trimmed = binQrCodeValue.trim();
  if (!trimmed) {
    throw new Error("Cannot derive a unit QR value without a bin QR code");
  }
  if (!Number.isSafeInteger(unitNumber) || unitNumber <= 0 || unitNumber > MAX_BULK_UNIT_NUMBER) {
    throw new Error(`Invalid unit number for derived QR value: ${unitNumber}`);
  }
  return `${trimmed}-${unitNumber}`;
}

function normalizedScanCandidates(scanValue: string): string[] {
  const rawValue = scanValue
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\u2010-\u2015]/g, "-");
  if (!rawValue) return [];

  const candidates = new Set<string>([rawValue]);

  try {
    const url = new URL(rawValue);
    const queryValue =
      url.searchParams.get("qr_code") ??
      url.searchParams.get("qrCode") ??
      url.searchParams.get("code") ??
      url.searchParams.get("scan") ??
      url.searchParams.get("value");
    if (queryValue) {
      candidates.add(queryValue.trim().replace(/[\u0000-\u001F\u007F]/g, "").replace(/[\u2010-\u2015]/g, "-"));
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    const lastPart = pathParts.at(-1);
    if (lastPart) {
      candidates.add(decodeURIComponent(lastPart).trim().replace(/[\u0000-\u001F\u007F]/g, "").replace(/[\u2010-\u2015]/g, "-"));
    }
  } catch {
    // Plain QR strings are the normal path.
  }

  const expanded = Array.from(candidates);
  for (const candidate of expanded) {
    const withoutLegacyPrefix = candidate.replace(/^qr-/i, "");
    candidates.add(withoutLegacyPrefix);
  }

  return Array.from(candidates).filter(Boolean);
}

export function parseDerivedBulkUnitQr(
  scanValue: string,
  skus: DerivedBulkUnitQrSku[],
): DerivedBulkUnitQrMatch | null {
  const scanCandidates = normalizedScanCandidates(scanValue);
  if (scanCandidates.length === 0) return null;

  const candidates = skus
    .filter((sku) => sku.trackByNumber && sku.binQrCodeValue?.trim())
    .map((sku) => ({
      id: sku.id,
      binQrCodeValue: sku.binQrCodeValue!.trim(),
    }))
    .sort((a, b) => b.binQrCodeValue.length - a.binQrCodeValue.length);

  for (const rawValue of scanCandidates) {
    const normalizedValue = rawValue.toLowerCase();
    for (const sku of candidates) {
      const prefix = `${sku.binQrCodeValue.toLowerCase()}-`;
      if (!normalizedValue.startsWith(prefix)) continue;

      const suffix = rawValue.slice(sku.binQrCodeValue.length + 1).trim();
      if (!/^\d+$/.test(suffix)) return null;

      const unitNumber = Number(suffix);
      if (!Number.isSafeInteger(unitNumber) || unitNumber <= 0 || unitNumber > MAX_BULK_UNIT_NUMBER) return null;

      return {
        bulkSkuId: sku.id,
        binQrCodeValue: sku.binQrCodeValue,
        unitNumber,
      };
    }
  }

  return null;
}
