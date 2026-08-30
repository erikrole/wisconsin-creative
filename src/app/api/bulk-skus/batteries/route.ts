import { withAuth } from "@/lib/api";
import { getBatteryCompatibilitySummaries } from "@/lib/battery-compatibility";
import { isBatterySku } from "@/lib/bulk-batteries";
import { buildActiveBulkUnitAllocationMap, effectiveBulkUnitStatus } from "@/lib/bulk-unit-status";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getBatteryOpsFixture } from "@/lib/fixtures/battery-ops";
import { BookingKind, BookingStatus } from "@prisma/client";

function daysSince(value: Date | null | undefined, now: Date) {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / (1000 * 60 * 60 * 24)));
}

function wantsDevelopmentFixture(req: Request) {
  if (process.env.NODE_ENV !== "development") return false;
  if (new URL(req.url).searchParams.get("fixture") === "battery-ops") return true;

  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).searchParams.get("fixture") === "battery-ops";
  } catch {
    return false;
  }
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "bulk_sku", "adjust");

  if (wantsDevelopmentFixture(req)) {
    return ok({ data: getBatteryOpsFixture() });
  }

  const now = new Date();
  const [rawSkus, cameraAssets, activeUnitAllocations] = await Promise.all([
    db.bulkSku.findMany({
      where: {
        active: true,
      },
      include: {
        location: { select: { id: true, name: true } },
        categoryRel: { select: { id: true, name: true } },
        balances: true,
        products: {
          where: { active: true },
          select: {
            id: true,
            name: true,
            brand: true,
            model: true,
            active: true,
            _count: { select: { units: true } },
          },
          orderBy: [{ name: "asc" }],
        },
        units: {
          orderBy: { unitNumber: "asc" },
        },
      },
      orderBy: [{ locationId: "asc" }, { name: "asc" }],
    }),
    db.asset.findMany({
      where: {
        status: { not: "RETIRED" },
        parentAssetId: null,
      },
      select: {
        brand: true,
        model: true,
        type: true,
        category: { select: { name: true } },
      },
    }),
    db.bookingBulkUnitAllocation.findMany({
      where: {
        checkedOutAt: { not: null },
        checkedInAt: null,
        bookingBulkItem: {
          booking: {
            kind: BookingKind.CHECKOUT,
            status: BookingStatus.OPEN,
          },
        },
      },
      orderBy: [{ checkedOutAt: "desc" }, { createdAt: "desc" }],
      select: {
        bulkSkuUnitId: true,
        checkedOutAt: true,
        createdAt: true,
        bookingBulkItem: {
          select: {
            booking: {
              select: {
                id: true,
                title: true,
                refNumber: true,
                endsAt: true,
                requester: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const activeAllocationByUnitId = buildActiveBulkUnitAllocationMap(activeUnitAllocations);

  const staleCheckedOutUnits: Array<{
    id: string;
    skuId: string;
    skuName: string;
    locationName: string;
    unitNumber: number;
  }> = [];

  const skus = rawSkus.filter(isBatterySku).map((sku) => {
    const units = sku.units.map((unit) => {
      const allocation = activeAllocationByUnitId.get(unit.id) ?? null;
      const status = effectiveBulkUnitStatus(unit, allocation);
      const booking = status === "CHECKED_OUT" ? allocation?.bookingBulkItem.booking : null;
      const checkedOutAt = status === "CHECKED_OUT"
        ? allocation?.checkedOutAt ?? allocation?.createdAt ?? null
        : null;
      if (unit.status === "CHECKED_OUT" && !allocation) {
        staleCheckedOutUnits.push({
          id: unit.id,
          skuId: sku.id,
          skuName: sku.name,
          locationName: sku.location.name,
          unitNumber: unit.unitNumber,
        });
      }

      return {
        id: unit.id,
        productId: unit.productId,
        unitNumber: unit.unitNumber,
        status,
        notes: unit.notes,
        labelPrintedAt: unit.labelPrintedAt?.toISOString() ?? null,
        labelPrintedById: unit.labelPrintedById,
        labelPrintBatchId: unit.labelPrintBatchId,
        checkedOutAt: checkedOutAt?.toISOString() ?? null,
        checkedOutDays: daysSince(checkedOutAt, now),
        booking: booking
          ? {
              id: booking.id,
              title: booking.title,
              refNumber: booking.refNumber,
              endsAt: booking.endsAt.toISOString(),
              requesterName: booking.requester.name,
            }
          : null,
      };
    });

    const onHand = sku.balances.reduce((sum, balance) => sum + balance.onHandQuantity, 0);
    const available = sku.trackByNumber
      ? units.filter((unit) => unit.status === "AVAILABLE").length
      : Math.max(0, onHand);
    const checkedOut = sku.trackByNumber ? units.filter((unit) => unit.status === "CHECKED_OUT").length : 0;
    const lost = sku.trackByNumber ? units.filter((unit) => unit.status === "LOST").length : 0;
    const retired = sku.trackByNumber ? units.filter((unit) => unit.status === "RETIRED").length : 0;
    const total = sku.trackByNumber ? units.length : available;
    const threshold = Math.max(10, sku.minThreshold);
    const labelPrintedCount = sku.trackByNumber
      ? units.filter((unit) => unit.labelPrintedAt !== null).length
      : 0;
    const labelNeededCount = sku.trackByNumber
      ? units.filter((unit) => unit.labelPrintedAt === null && unit.status !== "RETIRED").length
      : 0;

    return {
      id: sku.id,
      name: sku.name,
      category: sku.categoryRel?.name ?? sku.category,
      trackByNumber: sku.trackByNumber,
      location: sku.location,
      minThreshold: sku.minThreshold,
      threshold,
      binQrCodeValue: sku.binQrCodeValue,
      products: (sku.products ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        brand: product.brand,
        model: product.model,
        assignedUnitCount: product._count.units,
      })),
      counts: {
        total,
        available,
        checkedOut,
        lost,
        retired,
      },
      labelPrintedCount,
      labelNeededCount,
      isLow: available < threshold,
      units,
    };
  });

  const totals = skus.reduce(
    (acc, sku) => {
      acc.total += sku.counts.total;
      acc.available += sku.counts.available;
      acc.checkedOut += sku.counts.checkedOut;
      acc.lost += sku.counts.lost;
      acc.retired += sku.counts.retired;
      if (sku.isLow) acc.lowSkus += 1;
      acc.agingCheckedOut += sku.units.filter(
        (unit) => unit.status === "CHECKED_OUT" && (unit.checkedOutDays ?? 0) >= 7,
      ).length;
      return acc;
    },
    { total: 0, available: 0, checkedOut: 0, lost: 0, retired: 0, lowSkus: 0, agingCheckedOut: 0 },
  );

  const compatibility = getBatteryCompatibilitySummaries({
    cameraAssets: cameraAssets.map((asset) => ({
      brand: asset.brand,
      model: asset.model,
      type: asset.type,
      categoryName: asset.category?.name ?? null,
    })),
    bulkSkus: skus.map((sku) => ({
      id: sku.id,
      name: sku.name,
      category: sku.category,
      availableQuantity: sku.counts.available,
      minThreshold: sku.minThreshold,
    })),
  })
    .filter((summary) => summary.isLow)
    .sort((a, b) => (a.availableQuantity - a.threshold) - (b.availableQuantity - b.threshold));

  return ok({
    data: {
      totals,
      skus,
      compatibility,
      integrity: {
        staleCheckedOutCount: staleCheckedOutUnits.length,
        staleCheckedOutUnits,
      },
    },
  });
});
