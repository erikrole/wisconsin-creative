import { db } from "@/lib/db";
import { batterySkuCandidateWhere, isBatterySku, shouldNotifyBatteryLow } from "@/lib/bulk-batteries";
import { ACTIVE_BULK_UNIT_ALLOCATION_WHERE } from "@/lib/bulk-unit-status";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

/** ISO-week key, so a family that stays low re-notifies weekly, not daily. */
function isoWeekKey(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Inbox notice to staff and admins when a large battery family runs low.
 * Relative on purpose: a family smaller than BATTERY_NOTIFY_MIN_FAMILY never
 * notifies, and a big one notifies only below 20% of what the shop owns.
 * Inbox only (no push or email) to keep notification volume down.
 */
export async function processBatteryLowStock(now = new Date()) {
  const skus = await db.bulkSku.findMany({
    where: { active: true, ...batterySkuCandidateWhere() },
    select: {
      id: true,
      name: true,
      category: true,
      minThreshold: true,
      trackByNumber: true,
      categoryRel: { select: { name: true } },
      balances: { select: { onHandQuantity: true } },
      units: {
        select: {
          id: true,
          status: true,
          allocations: { where: ACTIVE_BULK_UNIT_ALLOCATION_WHERE, take: 1, select: { id: true } },
        },
      },
    },
  });

  const low = skus.filter(isBatterySku).flatMap((sku) => {
    const held = new Map(sku.units.flatMap((unit) => unit.allocations.map((a) => [unit.id, a] as const)));
    const state = summarizeItemFamilyState(sku, held);
    const triggered = shouldNotifyBatteryLow({
      minThreshold: sku.minThreshold,
      ownedQuantity: state.onHandQuantity,
      availableQuantity: state.availableQuantity,
    });
    return triggered
      ? [{ id: sku.id, name: sku.name, available: state.availableQuantity, owned: state.onHandQuantity }]
      : [];
  });
  if (low.length === 0) return { families: 0, created: 0 };

  const recipients = await db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true },
  });
  if (recipients.length === 0) return { families: low.length, created: 0 };

  const week = isoWeekKey(now);
  const created = await db.notification.createManyAndReturn({
    data: low.flatMap((family) =>
      recipients.map((user) => ({
        userId: user.id,
        type: "low_stock",
        title: `${family.name} running low`,
        body: `${family.available} of ${family.owned} available. Time to reorder or chase returns.`,
        payload: {
          type: "low_stock",
          skuId: family.id,
          skuName: family.name,
          href: "/bulk-inventory/batteries",
        },
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `battery-low-${family.id}-${week}-${user.id}`,
      })),
    ),
    skipDuplicates: true,
    select: { id: true },
  });

  return { families: low.length, created: created.length };
}
