import { pad2 } from "@/lib/format";
const MS_PER_DAY = 86_400_000;

function parseLicenseExpiry(expiresAt: string) {
  return new Date(expiresAt);
}

/**
 * License expiry values are annual calendar dates encoded at UTC midnight.
 * Read their UTC date parts instead of treating the encoded instant as a
 * moment in the viewer's timezone.
 */
function licenseExpiryAsLocalDate(expiresAt: string): Date {
  const encoded = parseLicenseExpiry(expiresAt);
  return new Date(encoded.getUTCFullYear(), encoded.getUTCMonth(), encoded.getUTCDate());
}

export function licenseExpiryInputValue(expiresAt: string): string {
  const encoded = parseLicenseExpiry(expiresAt);
  if (Number.isNaN(encoded.getTime())) return "";
  return [
    encoded.getUTCFullYear(),
    pad2(encoded.getUTCMonth() + 1),
    pad2(encoded.getUTCDate()),
  ].join("-");
}

export function formatLicenseExpiryDate(expiresAt: string): string {
  return licenseExpiryAsLocalDate(expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Compare an encoded expiry date with the viewer's local calendar day. */
export function licenseDaysUntilExpiry(expiresAt: string, now = new Date()): number {
  const encoded = parseLicenseExpiry(expiresAt);
  const expiryDay = Date.UTC(encoded.getUTCFullYear(), encoded.getUTCMonth(), encoded.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expiryDay - today) / MS_PER_DAY);
}

export function isLicenseExpired(expiresAt: string, now = new Date()): boolean {
  return licenseDaysUntilExpiry(expiresAt, now) < 0;
}

/** Keep the storage boundary explicit: date inputs are encoded as UTC midnight. */
export function encodeLicenseExpiryDate(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00.000Z`).toISOString();
}

export function localDateKey(now = new Date()): string {
  return [now.getFullYear(), pad2(now.getMonth() + 1), pad2(now.getDate())].join("-");
}
