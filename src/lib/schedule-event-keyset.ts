import type { Prisma } from "@prisma/client";
import { parseOptionalDate } from "@/lib/api-dates";
import { HttpError } from "@/lib/http";

export type ScheduleEventKeyset =
  | { direction: "before"; startsAt: Date; id: string | null }
  | { direction: "after"; startsAt: Date; id: string | null };

export function parseScheduleEventKeyset(searchParams: URLSearchParams): ScheduleEventKeyset | null {
  const beforeStartsAt = searchParams.get("beforeStartsAt");
  const afterStartsAt = searchParams.get("afterStartsAt");
  const beforeId = searchParams.get("beforeId");
  const afterId = searchParams.get("afterId");

  if (beforeStartsAt && afterStartsAt) {
    throw new HttpError(400, "Use either beforeStartsAt or afterStartsAt, not both");
  }
  if (beforeId && !beforeStartsAt) {
    throw new HttpError(400, "beforeId requires beforeStartsAt");
  }
  if (afterId && !afterStartsAt) {
    throw new HttpError(400, "afterId requires afterStartsAt");
  }

  if (beforeStartsAt) {
    const startsAt = parseOptionalDate(beforeStartsAt, "beforeStartsAt");
    if (!startsAt) throw new HttpError(400, "beforeStartsAt must be a valid date");
    return { direction: "before", startsAt, id: beforeId };
  }

  if (afterStartsAt) {
    const startsAt = parseOptionalDate(afterStartsAt, "afterStartsAt");
    if (!startsAt) throw new HttpError(400, "afterStartsAt must be a valid date");
    return { direction: "after", startsAt, id: afterId };
  }

  return null;
}

export function scheduleEventKeysetWhere(keyset: ScheduleEventKeyset): Prisma.CalendarEventWhereInput {
  if (keyset.direction === "before") {
    if (!keyset.id) return { startsAt: { lt: keyset.startsAt } };
    return {
      OR: [
        { startsAt: { lt: keyset.startsAt } },
        { AND: [{ startsAt: keyset.startsAt }, { id: { lt: keyset.id } }] },
      ],
    };
  }

  if (!keyset.id) return { startsAt: { gt: keyset.startsAt } };
  return {
    OR: [
      { startsAt: { gt: keyset.startsAt } },
      { AND: [{ startsAt: keyset.startsAt }, { id: { gt: keyset.id } }] },
    ],
  };
}

export function scheduleEventKeysetOrder(
  keyset: ScheduleEventKeyset | null,
): Prisma.CalendarEventOrderByWithRelationInput[] {
  const direction = keyset?.direction === "before" ? "desc" : "asc";
  return [{ startsAt: direction }, { id: direction }];
}
