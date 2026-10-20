import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { visibleUserWhere } from "@/lib/user-visibility";
import { buildActiveBulkUnitAllocationMap } from "@/lib/bulk-unit-status";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { hasCollaboratorCapability } from "@/lib/collaborator-access";
import { isSupportedReservationPickupLocationName } from "@/lib/reservation-pickup-locations";

/**
 * Locations double as event venues, inventory homes, and kiosk sites, so
 * clients need a server-owned flag to know which ones can be a reservation
 * pickup counter. Native apps hard-coded the names before this existed.
 */
function withReservationPickupFlag<T extends { name: string }>(locations: readonly T[]) {
  return locations.map((location) => ({
    ...location,
    reservationPickup: isSupportedReservationPickupLocationName(location.name),
  }));
}

export const GET = withAuth(async (_req, { user }) => {
  if (user.role === "COLLABORATOR") {
    if (!hasCollaboratorCapability(user, "GEAR_CATALOG_VIEW") && !hasCollaboratorCapability(user, "MY_GEAR_VIEW")) {
      throw new HttpError(403, "Forbidden");
    }
    const locations = await db.location.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return ok({ data: { locations: withReservationPickupFlag(locations), departments: [], users: [], bulkSkus: [] } });
  }

  const [locations, departments, users, bulkSkus] = await Promise.all([
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({
      where: {
        AND: [
          visibleUserWhere(user),
          user.role === "STUDENT" ? { id: user.id, active: true } : { active: true },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, avatarUrl: true },
    }),
    db.bulkSku.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, category: true, unit: true, locationId: true, binQrCodeValue: true, trackByNumber: true,
        imageUrl: true,
        minThreshold: true,
        categoryRel: { select: { name: true } },
        balances: { select: { onHandQuantity: true } },
        units: { select: { id: true, status: true } },
      }
    })
  ]);

  const unitIds = bulkSkus.flatMap((sku) => sku.trackByNumber ? sku.units.map((unit) => unit.id) : []);
  const activeAllocations = unitIds.length
    ? await db.bookingBulkUnitAllocation.findMany({
        where: {
          bulkSkuUnitId: { in: unitIds },
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        select: { bulkSkuUnitId: true },
      })
    : [];
  const activeAllocationByUnitId = buildActiveBulkUnitAllocationMap(activeAllocations);

  const bulkSkusFlat = bulkSkus.map((s) => {
    const state = summarizeItemFamilyState(s, activeAllocationByUnitId);
    return {
      id: s.id, name: s.name, category: s.category, unit: s.unit,
      locationId: s.locationId, binQrCodeValue: s.binQrCodeValue, trackByNumber: s.trackByNumber,
      imageUrl: s.imageUrl,
      minThreshold: s.minThreshold,
      categoryName: s.categoryRel?.name ?? null,
      currentQuantity: state.onHandQuantity,
      availableQuantity: state.availableQuantity,
    };
  });

  return ok({ data: { locations: withReservationPickupFlag(locations), departments, users, bulkSkus: bulkSkusFlat } });
});
