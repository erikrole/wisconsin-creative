import type { AssetDetail } from "./types";
import { normalizeExternalUrl } from "@/lib/external-url";

/* ── USD Currency Field ─────────────────────────────────── */

export function parseUsdDraft(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Enter a valid USD amount");
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    throw new Error("Enter a valid USD amount");
  }
  return numeric.toFixed(2);
}

export function formatUsdDraft(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  try {
    const normalized = parseUsdDraft(String(value));
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(normalized));
  } catch {
    return String(value);
  }
}

export function normalizeUsdForDirty(value: string): string {
  try {
    return parseUsdDraft(value);
  } catch {
    return value.trim();
  }
}

/* ── Link Field (with open/copy buttons) ───────────────── */

export function getNormalizedExternalUrl(value: string): string {
  try {
    return normalizeExternalUrl(value);
  } catch {
    return "";
  }
}

export function formatFirmwareDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type FirmwareSupportMode = NonNullable<AssetDetail["firmwareWatch"]>["supportMode"];

type FirmwareBadgeVariant = "green" | "orange" | "gray";

export function firmwareSupportVariant(mode: FirmwareSupportMode) {
  if (mode === "ACTIVE") return "green";
  if (mode === "MAINTENANCE") return "orange";
  return "gray";
}

export function firmwareSupportLabel(mode: FirmwareSupportMode) {
  if (mode === "ACTIVE") return "Active";
  if (mode === "MAINTENANCE") return "Maintenance";
  return "Unknown";
}

export function normalizeFirmwareVersion(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/^v(?:er\.?)?\s*/i, "")
    .toLowerCase();
}

export function firmwareBadgeVariant(installedVersion: string, latestVersion: string | null): FirmwareBadgeVariant {
  if (!installedVersion || !latestVersion) return "gray";
  return normalizeFirmwareVersion(installedVersion) === normalizeFirmwareVersion(latestVersion)
    ? "green"
    : "orange";
}

export function firmwareBadgeStatus(installedVersion: string, latestVersion: string | null) {
  if (!installedVersion) return "Not recorded";
  if (!latestVersion) return "Unknown";
  return normalizeFirmwareVersion(installedVersion) === normalizeFirmwareVersion(latestVersion)
    ? "Updated"
    : "Outdated";
}
