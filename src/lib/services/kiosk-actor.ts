import { BookingCustodyScope, Prisma, Role } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { getAllowedRoles } from "@/lib/permissions";
import { kioskRosterUserWhere } from "@/lib/user-visibility";

export type KioskActor = { id: string; role: Role };

/**
 * The person acting at the kiosk, validated against the same roster rule the
 * kiosk shows: active, not hidden, and — for collaborators — roster-eligible.
 * Every kiosk mutation resolves its actor through this so a stale cached
 * roster or a hand-built request cannot act as someone the kiosk would not
 * offer.
 */
export async function requireKioskActor(
  tx: Prisma.TransactionClient,
  actorId: string,
): Promise<KioskActor> {
  const actor = await tx.user.findFirst({
    where: { id: actorId, ...kioskRosterUserWhere() },
    select: { id: true, role: true },
  });
  if (!actor) throw new HttpError(404, "Person not found");
  return actor;
}

export function canManageAnyCheckout(role: Role): boolean {
  return getAllowedRoles("checkout", "manage_custody").includes(role);
}

/**
 * Who may edit a live checkout's items or due-back at the kiosk without the
 * scan-and-return path: its owner, staff/admin, or — for custodian-neutral
 * SHARED custody (D-061) — the identified operator. Returning someone else's
 * gear stays open to anyone through the scan-based Return flow, which records
 * the real returner; removing an item here records no scan at all, so it is
 * not a return and must not be available on another person's checkout.
 */
export function assertKioskCheckoutEditor(
  actor: KioskActor,
  booking: { requesterUserId: string | null; custodyScope: BookingCustodyScope },
) {
  if (booking.custodyScope === BookingCustodyScope.SHARED) return;
  if (booking.requesterUserId === actor.id) return;
  if (canManageAnyCheckout(actor.role)) return;
  throw new HttpError(
    403,
    "Only the person who checked this out, or staff, can change it here. To bring gear back, use Return and scan it.",
  );
}
