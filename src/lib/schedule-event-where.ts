import type { Prisma } from "@prisma/client";
import { startOfTodayInAppTz } from "@/lib/app-time";

type ScheduleEventWhereInput = {
  parsedStartDate?: Date | null;
  parsedEndDate?: Date | null;
  includePast: boolean;
  includeHidden?: boolean;
  includeArchived: boolean;
  unmappedOnly?: boolean;
  sportCode: string | null;
  now?: Date;
};

export function buildScheduleEventWhere({
  parsedStartDate,
  parsedEndDate,
  includePast,
  includeHidden = false,
  includeArchived,
  unmappedOnly = false,
  sportCode,
  now = new Date(),
}: ScheduleEventWhereInput): Prisma.CalendarEventWhereInput {
  const where: Prisma.CalendarEventWhereInput = {
    status: { not: "CANCELLED" },
    ...(!includeHidden ? { isHidden: false } : {}),
    ...(!includeArchived ? { archivedAt: null } : {}),
    ...(unmappedOnly ? { locationId: null } : {}),
    ...(sportCode ? { sportCode } : {}),
  };

  if (parsedStartDate && parsedEndDate) {
    where.startsAt = { lte: parsedEndDate };
    where.endsAt = { gt: parsedStartDate };
  } else if (parsedStartDate) {
    where.endsAt = { gt: parsedStartDate };
  } else if (parsedEndDate) {
    where.startsAt = { lte: parsedEndDate };
  } else if (!includePast) {
    where.endsAt = { gt: startOfTodayInAppTz(now) };
  }

  return where;
}
