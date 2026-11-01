import { BookingCustodyScope, Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { withSerializationRetry } from "@/lib/serialization";
import {
  groupChecklist,
  parseChecklistChecks,
  parseChecklistItems,
  SHARED_CASE_CHECKLIST_KEY,
} from "@/lib/shared-case-checklist";

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export async function loadChecklistItems(client: Prisma.TransactionClient | typeof db = db) {
  const row = await client.systemConfig.findUnique({ where: { key: SHARED_CASE_CHECKLIST_KEY } });
  return parseChecklistItems(row?.value);
}

/**
 * A reservation and the checkout picked up from it are one trip, so ticks live
 * on the reservation when there is one and both show the same progress.
 */
async function loadTrip(client: Prisma.TransactionClient | typeof db, bookingId: string) {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, custodyScope: true, sourceReservationId: true, packingChecks: true },
  });
  if (!booking) throw new HttpError(404, "Booking not found");
  const root = booking.sourceReservationId
    ? await client.booking.findUnique({ where: { id: booking.sourceReservationId }, select: { id: true, packingChecks: true } })
    : null;
  return {
    shared: booking.custodyScope === BookingCustodyScope.SHARED,
    tripId: root?.id ?? booking.id,
    rawChecks: root ? root.packingChecks : booking.packingChecks,
  };
}

/** The checklist for a shared case booking with who ticked what, or null for any other booking. */
export async function loadTripChecklist(bookingId: string) {
  const [trip, items] = await Promise.all([loadTrip(db, bookingId), loadChecklistItems()]);
  if (!trip.shared || items.length === 0) return null;
  const ids = new Set(items.map((item) => item.id));
  const checks = Object.fromEntries(Object.entries(parseChecklistChecks(trip.rawChecks)).filter(([id]) => ids.has(id)));
  const by = [...new Set(Object.values(checks).map((check) => check.by))];
  const people = by.length ? await db.user.findMany({ where: { id: { in: by } }, select: { id: true, name: true } }) : [];
  return {
    tripId: trip.tripId,
    groups: groupChecklist(items),
    checks,
    names: Object.fromEntries(people.map((person) => [person.id, person.name])),
    total: items.length,
    checked: Object.keys(checks).length,
  };
}

export async function setTripCheck(
  bookingId: string,
  input: { itemId: string; checked: boolean },
  actor: { id: string; role: Role },
) {
  await withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const trip = await loadTrip(tx, bookingId);
      if (!trip.shared) throw new HttpError(409, "Only shared case bookings have a checklist");
      const item = (await loadChecklistItems(tx)).find((entry) => entry.id === input.itemId);
      if (!item) throw new HttpError(409, "That item is no longer on the checklist. Refresh and try again.");

      const checks = parseChecklistChecks(trip.rawChecks);
      if (Boolean(checks[item.id]) === input.checked) return;
      if (input.checked) checks[item.id] = { at: new Date().toISOString(), by: actor.id };
      else delete checks[item.id];

      await tx.booking.update({ where: { id: trip.tripId }, data: { packingChecks: checks } });
      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "booking",
        entityId: trip.tripId,
        action: input.checked ? "packing_item_checked" : "packing_item_unchecked",
        after: { item: item.label },
      });
    }, SERIALIZABLE),
  );
  return loadTripChecklist(bookingId);
}
