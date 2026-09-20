import type { BulkUnitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { calendarSourceFailureDetail, getCalendarSyncFailureCounts } from "@/lib/services/calendar-sync-health";
import { summarizeItemFamilyState } from "@/lib/item-family-state";

const SAMPLE_LIMIT = 5;
const KIOSK_OFFLINE_AFTER_MINUTES = 15;
const LICENSE_EXPIRY_WINDOW_DAYS = 30;
const DEFAULT_BULK_THRESHOLD = 1;

export type AdminFixTodaySeverity = "critical" | "warning" | "info";

type AdminFixTodaySample = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

type AdminFixTodaySection = {
  key: string;
  title: string;
  description: string;
  count: number;
  severity: AdminFixTodaySeverity;
  href: string;
  ctaLabel: string;
  samples: AdminFixTodaySample[];
};

export type AdminFixTodayQueue = {
  generatedAt: string;
  totals: {
    openItems: number;
    activeChecks: number;
    checksNeedingWork: number;
    criticalChecks: number;
  };
  sections: AdminFixTodaySection[];
  partialFailures: string[];
};

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function section(input: AdminFixTodaySection): AdminFixTodaySection {
  return input;
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  partialFailures: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  console.error(`[admin-fix-today] ${label} failed`, result.reason);
  partialFailures.push(label);
  return fallback;
}

function bookingLabel(row: { refNumber: string | null; title: string }) {
  return row.refNumber ? `${row.refNumber} / ${row.title}` : row.title;
}

function formatQueueDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(date);
}

function formatDateDetail(label: string, date: Date | null) {
  if (!date) return `${label}: never`;
  return `${label} ${formatQueueDate(date)}`;
}

type BatterySkuRow = {
  id: string;
  name: string;
  category: string;
  minThreshold: number;
  trackByNumber: boolean;
  location: { name: string };
  categoryRel: { name: string } | null;
  balances: Array<{ onHandQuantity: number }>;
  units: Array<{
    id: string;
    status: BulkUnitStatus | `${BulkUnitStatus}`;
    allocations?: Array<{ bulkSkuUnitId: string }>;
  }>;
};

function batteryAvailability(sku: BatterySkuRow) {
  const activeAllocationByUnitId = new Map(
    sku.units.flatMap((unit) => (unit.allocations ?? []).map((allocation) => [unit.id, allocation] as const)),
  );
  const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);
  const threshold = Math.max(DEFAULT_BULK_THRESHOLD, sku.minThreshold);
  return { available: state.availableQuantity, threshold };
}

export async function getAdminFixTodayQueue(now = new Date()): Promise<AdminFixTodayQueue> {
  const kioskOfflineBefore = addMinutes(now, -KIOSK_OFFLINE_AFTER_MINUTES);
  const licenseWindowEnd = addDays(now, LICENSE_EXPIRY_WINDOW_DAYS);

  const [
    overdueCheckoutCountResult,
    overdueCheckoutRowsResult,
    pendingPickupCountResult,
    pendingPickupRowsResult,
    offlineKioskCountResult,
    offlineKioskRowsResult,
    flaggedAssetCountResult,
    flaggedAssetRowsResult,
    batteryRowsResult,
    calendarFailureCountResult,
    calendarFailureRowsResult,
    calendarFailureCountsResult,
    licenseExpiryCountResult,
    licenseExpiryRowsResult,
  ] = await Promise.allSettled([
    db.booking.count({ where: { kind: "CHECKOUT", status: "OPEN", endsAt: { lt: now } } }),
    db.booking.findMany({
      where: { kind: "CHECKOUT", status: "OPEN", endsAt: { lt: now } },
      orderBy: { endsAt: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        title: true,
        refNumber: true,
        endsAt: true,
        requester: { select: { name: true } },
      },
    }),
    db.booking.count({ where: { kind: "CHECKOUT", status: "PENDING_PICKUP" } }),
    db.booking.findMany({
      where: { kind: "CHECKOUT", status: "PENDING_PICKUP" },
      orderBy: { startsAt: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        title: true,
        refNumber: true,
        startsAt: true,
        requester: { select: { name: true } },
      },
    }),
    db.kioskDevice.count({
      where: {
        active: true,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: kioskOfflineBefore } }],
      },
    }),
    db.kioskDevice.findMany({
      where: {
        active: true,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: kioskOfflineBefore } }],
      },
      orderBy: [{ lastSeenAt: "asc" }, { name: "asc" }],
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        name: true,
        lastSeenAt: true,
        location: { select: { name: true } },
      },
    }),
    db.asset.count({ where: { status: "MAINTENANCE" } }),
    db.asset.findMany({
      where: { status: "MAINTENANCE" },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        assetTag: true,
        name: true,
        brand: true,
        model: true,
        location: { select: { name: true } },
      },
    }),
    db.bulkSku.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: "battery", mode: "insensitive" } },
          { category: { contains: "battery", mode: "insensitive" } },
          { categoryRel: { name: { contains: "battery", mode: "insensitive" } } },
        ],
      },
      orderBy: { name: "asc" },
      include: {
        location: { select: { name: true } },
        categoryRel: { select: { name: true } },
        balances: { select: { onHandQuantity: true } },
        units: {
          select: {
            id: true,
            status: true,
            allocations: {
              where: {
                checkedOutAt: { not: null },
                checkedInAt: null,
              },
              take: 1,
              select: { bulkSkuUnitId: true },
            },
          },
        },
      },
    }),
    db.calendarSource.count({ where: { enabled: true, lastError: { not: null } } }),
    db.calendarSource.findMany({
      where: { enabled: true, lastError: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        name: true,
        lastFetchedAt: true,
        lastError: true,
      },
    }),
    getCalendarSyncFailureCounts(),
    db.licenseCode.count({
      where: {
        status: { not: "RETIRED" },
        expiresAt: { not: null, lte: licenseWindowEnd },
      },
    }),
    db.licenseCode.findMany({
      where: {
        status: { not: "RETIRED" },
        expiresAt: { not: null, lte: licenseWindowEnd },
      },
      orderBy: { expiresAt: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        label: true,
        accountEmail: true,
        expiresAt: true,
        status: true,
        claimedBy: { select: { name: true } },
      },
    }),
  ]);

  const partialFailures: string[] = [];
  const overdueCheckoutCount = settledValue(overdueCheckoutCountResult, 0, "overdueCheckoutCount", partialFailures);
  const overdueCheckoutRows = settledValue(overdueCheckoutRowsResult, [], "overdueCheckoutRows", partialFailures);
  const pendingPickupCount = settledValue(pendingPickupCountResult, 0, "pendingPickupCount", partialFailures);
  const pendingPickupRows = settledValue(pendingPickupRowsResult, [], "pendingPickupRows", partialFailures);
  const offlineKioskCount = settledValue(offlineKioskCountResult, 0, "offlineKioskCount", partialFailures);
  const offlineKioskRows = settledValue(offlineKioskRowsResult, [], "offlineKioskRows", partialFailures);
  const flaggedAssetCount = settledValue(flaggedAssetCountResult, 0, "flaggedAssetCount", partialFailures);
  const flaggedAssetRows = settledValue(flaggedAssetRowsResult, [], "flaggedAssetRows", partialFailures);
  const batteryRows = settledValue(batteryRowsResult, [] as BatterySkuRow[], "batteryRows", partialFailures);
  const calendarFailureCount = settledValue(calendarFailureCountResult, 0, "calendarFailureCount", partialFailures);
  const calendarFailureRows = settledValue(calendarFailureRowsResult, [], "calendarFailureRows", partialFailures);
  const calendarFailureCounts = settledValue(calendarFailureCountsResult, new Map<string, number>(), "calendarFailureCounts", partialFailures);
  const licenseExpiryCount = settledValue(licenseExpiryCountResult, 0, "licenseExpiryCount", partialFailures);
  const licenseExpiryRows = settledValue(licenseExpiryRowsResult, [], "licenseExpiryRows", partialFailures);

  const lowBatteryRows = batteryRows
    .map((sku) => ({ sku, ...batteryAvailability(sku) }))
    .filter((row) => row.available < row.threshold)
    .sort((a, b) => a.available - b.available || a.sku.name.localeCompare(b.sku.name));

  const sections = [
    section({
      key: "overdue-checkouts",
      title: "Overdue gear",
      description: "Open checkouts past their return time.",
      count: overdueCheckoutCount,
      severity: "critical",
      href: "/bookings?tab=checkouts&filter=overdue",
      ctaLabel: "Review overdue",
      samples: overdueCheckoutRows.map((row) => ({
        id: row.id,
        label: bookingLabel(row),
        detail: `${row.requester.name} / due ${formatQueueDate(row.endsAt)}`,
        href: `/checkouts/${row.id}`,
      })),
    }),
    section({
      key: "pending-pickups",
      title: "Pending pickup handoffs",
      description: "Checkouts created but not picked up at a kiosk yet.",
      count: pendingPickupCount,
      severity: "warning",
      href: "/bookings?tab=checkouts&status=PENDING_PICKUP",
      ctaLabel: "Review handoffs",
      samples: pendingPickupRows.map((row) => ({
        id: row.id,
        label: bookingLabel(row),
        detail: `${row.requester.name} / pickup ${formatQueueDate(row.startsAt)}`,
        href: `/checkouts/${row.id}`,
      })),
    }),
    section({
      key: "offline-kiosks",
      title: "Offline kiosks",
      description: `Active kiosk devices not seen in the last ${KIOSK_OFFLINE_AFTER_MINUTES} minutes.`,
      count: offlineKioskCount,
      severity: "critical",
      href: "/settings/kiosk-devices",
      ctaLabel: "Open kiosk settings",
      samples: offlineKioskRows.map((row) => ({
        id: row.id,
        label: row.name,
        detail: `${row.location.name} / ${formatDateDetail("last seen", row.lastSeenAt)}`,
        href: "/settings/kiosk-devices",
      })),
    }),
    section({
      key: "flagged-items",
      title: "Flagged items",
      description: "Serialized assets currently marked as in maintenance.",
      count: flaggedAssetCount,
      severity: "warning",
      href: "/items?status=MAINTENANCE",
      ctaLabel: "Review flagged items",
      samples: flaggedAssetRows.map((row) => ({
        id: row.id,
        label: row.assetTag,
        detail: [
          row.name?.trim() || [row.brand, row.model].filter(Boolean).join(" ").trim(),
          row.location?.name,
        ].filter(Boolean).join(" / ") || "No supporting metadata",
        href: `/items/${row.id}`,
      })),
    }),
    section({
      key: "low-batteries",
      title: "Low batteries",
      description: "Battery families below their configured threshold.",
      count: lowBatteryRows.length,
      severity: "warning",
      href: "/bulk-inventory/batteries",
      ctaLabel: "Open batteries",
      samples: lowBatteryRows.slice(0, SAMPLE_LIMIT).map(({ sku, available, threshold }) => ({
        id: sku.id,
        label: sku.name,
        detail: `${available} available / ${threshold} threshold / ${sku.location.name}`,
        href: `/bulk-inventory/${sku.id}`,
      })),
    }),
    section({
      key: "calendar-sync-failures",
      title: "Calendar sync failures",
      description: "Enabled calendar sources reporting their latest sync error.",
      count: calendarFailureCount,
      severity: "critical",
      href: "/settings/calendar-sources",
      ctaLabel: "Open calendar sources",
      samples: calendarFailureRows.map((row) => ({
        id: row.id,
        label: row.name,
        detail: row.lastError
          ? calendarSourceFailureDetail(row.lastError, calendarFailureCounts.get(row.id) ?? 0)
          : formatDateDetail("last fetched", row.lastFetchedAt),
        href: "/settings/calendar-sources",
      })),
    }),
    section({
      key: "license-expirations",
      title: "License expirations",
      description: `Active license codes expiring in the next ${LICENSE_EXPIRY_WINDOW_DAYS} days or already expired.`,
      count: licenseExpiryCount,
      severity: "info",
      href: "/licenses",
      ctaLabel: "Open licenses",
      samples: licenseExpiryRows.map((row) => ({
        id: row.id,
        label: row.label || row.accountEmail || "Unlabeled license",
        detail: `${row.status.toLowerCase()} / ${row.claimedBy?.name ?? "unassigned"} / expires ${row.expiresAt ? formatQueueDate(row.expiresAt) : "unknown"}`,
        href: "/licenses",
      })),
    }),
  ];

  const activeSections = sections.filter((item) => item.count > 0);
  const openItems = sections.reduce((sum, item) => sum + item.count, 0);

  return {
    generatedAt: now.toISOString(),
    totals: {
      openItems,
      activeChecks: sections.length,
      checksNeedingWork: activeSections.length,
      criticalChecks: activeSections.filter((item) => item.severity === "critical").length,
    },
    sections,
    partialFailures,
  };
}
