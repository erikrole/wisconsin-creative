import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

export const travelMemberInclude = {
  user: { select: { id: true, name: true, role: true, primaryArea: true, avatarUrl: true } },
} as const;

/**
 * Loads an event that may take travelers, or throws the reason it can't.
 * The gate matches the Travel card: only away games for a sport have a roster.
 */
export async function loadTravelEvent(eventId: string) {
  const event = await db.calendarEvent.findUnique({
    where: { id: eventId },
    select: { id: true, summary: true, isHome: true, sportCode: true, status: true, combinedIntoId: true },
  });
  if (!event) throw new HttpError(404, "Event not found");
  if (event.isHome !== false || !event.sportCode) {
    throw new HttpError(409, "Travel rosters are only for away games");
  }
  if (event.status === "CANCELLED") throw new HttpError(409, "This event is cancelled");
  if (event.combinedIntoId) throw new HttpError(409, "This event was combined into another event. Edit that event's travel roster.");
  return { ...event, sportCode: event.sportCode };
}

/** Who may travel: active, visible, non-collaborator people. */
export function travelerUserWhere(extra: Parameters<typeof visibleActiveUserWhere>[0] = {}) {
  return visibleActiveUserWhere({ ...extra, role: { not: Role.COLLABORATOR } });
}

/**
 * The travel roster for an event: people added by hand, plus everyone
 * confirmed on the away game's crew. Crew rows carry `fromCrew` and a
 * synthetic id, so they can be shown but not removed here; take someone off
 * the crew instead.
 */
export async function loadTravelRoster(eventId: string, isAwayGame: boolean) {
  const added = await db.eventTravelMember.findMany({
    where: { eventId },
    include: travelMemberInclude,
    orderBy: { createdAt: "asc" },
  });
  const manual = added.map((m) => ({ ...m, fromCrew: false, gearOut: 0 }));
  if (!isAwayGame) return manual;

  const crew = await db.shiftAssignment.findMany({
    where: {
      status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
      shift: { shiftGroup: { eventId } },
      user: travelerUserWhere(),
    },
    select: { userId: true, createdAt: true, user: travelMemberInclude.user },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Set(manual.map((m) => m.userId));
  const fromCrew = [];
  for (const a of crew) {
    if (seen.has(a.userId)) continue;
    seen.add(a.userId);
    fromCrew.push({
      id: `crew:${a.userId}`,
      eventId,
      userId: a.userId,
      notes: null,
      createdAt: a.createdAt,
      user: a.user,
      fromCrew: true,
      gearOut: 0,
    });
  }
  const roster = [...manual, ...fromCrew];

  // Gear each traveler still has out on a personal checkout for this trip.
  // Returns trickle in for days after an away game, so the card shows who is left.
  const openCheckouts = await db.booking.findMany({
    where: {
      eventId,
      kind: "CHECKOUT",
      status: "OPEN",
      custodyScope: "PERSON",
      requesterUserId: { in: roster.map((r) => r.userId) },
    },
    select: {
      requesterUserId: true,
      _count: { select: { serializedItems: { where: { allocationStatus: "active" } } } },
      bulkItems: { select: { checkedOutQuantity: true, checkedInQuantity: true } },
    },
  });
  const gearOut = new Map<string, number>();
  for (const b of openCheckouts) {
    const bulk = b.bulkItems.reduce((sum, i) => sum + Math.max(0, i.checkedOutQuantity - i.checkedInQuantity), 0);
    gearOut.set(b.requesterUserId, (gearOut.get(b.requesterUserId) ?? 0) + b._count.serializedItems + bulk);
  }

  return roster
    .map((r) => ({ ...r, gearOut: gearOut.get(r.userId) ?? 0 }))
    .sort((x, y) => x.user.name.localeCompare(y.user.name));
}
