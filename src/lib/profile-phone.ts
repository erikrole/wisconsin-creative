export function normalizeProfilePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = normalizedPhoneDigits(value);
  return digits.length === 10 ? formatPhoneDigits(digits) : null;
}

export function normalizedPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function formatPhoneDigits(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function formatPhoneInput(value: string): string {
  const digits = normalizedPhoneDigits(value).slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return formatPhoneDigits(digits);
}

export function phoneAuditValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits ? `***${digits.slice(-4)}` : null;
}
