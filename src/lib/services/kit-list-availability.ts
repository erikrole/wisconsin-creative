import { db } from "@/lib/db";
import { enrichAssetsWithStatusFromLoaded } from "@/lib/services/status";

export type KitListAvailability = {
  serialized: number;
  unavailable: number;
};

/**
 * Count serialized kit members that are not on the shelf. Stored asset status
 * stays AVAILABLE while a checkout or due reservation is open, so the list
 * cannot trust that column.
 */
export async function summarizeKitListAvailability(kitIds: string[]) {
  const summaries = new Map<string, KitListAvailability>();
  for (const kitId of kitIds) summaries.set(kitId, { serialized: 0, unavailable: 0 });
  if (kitIds.length === 0) return summaries;

  const memberships = await db.kitMembership.findMany({
    where: { kitId: { in: kitIds } },
    select: { kitId: true, asset: { select: { id: true, status: true } } },
  });
  const enriched = await enrichAssetsWithStatusFromLoaded(memberships.map((membership) => membership.asset));
  const statusById = new Map(enriched.map((asset) => [asset.id, asset.computedStatus]));

  for (const membership of memberships) {
    const summary = summaries.get(membership.kitId);
    if (!summary) continue;
    summary.serialized += 1;
    if (statusById.get(membership.asset.id) !== "AVAILABLE") summary.unavailable += 1;
  }

  return summaries;
}
