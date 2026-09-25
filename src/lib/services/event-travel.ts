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
