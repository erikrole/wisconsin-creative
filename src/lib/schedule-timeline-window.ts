export const SCHEDULE_TIMELINE_PAGE_SIZE = 200;
export const SCHEDULE_TIMELINE_SLICE_SIZE = 80;
export const SCHEDULE_TIMELINE_INITIAL_PAST_DAYS = 21;
export const SCHEDULE_TIMELINE_INITIAL_FUTURE_DAYS = 84;

export type ScheduleTimelineWindow = {
  start: Date;
  end: Date;
};

export type ScheduleTimelineCursor = {
  startsAt: string;
  id: string;
};

export function startOfLocalDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function createInitialScheduleTimelineWindow(now = new Date()): ScheduleTimelineWindow {
  const today = startOfLocalDay(now);
  return {
    start: addLocalDays(today, -SCHEDULE_TIMELINE_INITIAL_PAST_DAYS),
    end: new Date(addLocalDays(today, SCHEDULE_TIMELINE_INITIAL_FUTURE_DAYS).getTime() + (24 * 60 * 60 * 1000 - 1)),
  };
}

export function mergeRowsById<T extends { id: string }>(...lists: readonly T[][]): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const list of lists) {
    for (const row of list) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

export function oldestScheduleCursor<T extends { id: string; startsAt: string }>(
  rows: readonly T[],
): ScheduleTimelineCursor | null {
  const oldest = rows.reduce<T | null>((current, row) => {
    if (!current) return row;
    if (row.startsAt < current.startsAt) return row;
    if (row.startsAt === current.startsAt && row.id < current.id) return row;
    return current;
  }, null);
  return oldest ? { startsAt: oldest.startsAt, id: oldest.id } : null;
}

export function newestScheduleCursor<T extends { id: string; startsAt: string }>(
  rows: readonly T[],
): ScheduleTimelineCursor | null {
  const newest = rows.reduce<T | null>((current, row) => {
    if (!current) return row;
    if (row.startsAt > current.startsAt) return row;
    if (row.startsAt === current.startsAt && row.id > current.id) return row;
    return current;
  }, null);
  return newest ? { startsAt: newest.startsAt, id: newest.id } : null;
}

export function sliceHasMore(rowCount: number, pageSize = SCHEDULE_TIMELINE_SLICE_SIZE): boolean {
  return rowCount >= pageSize;
}

export function eventBoundsForGroups<T extends { startsAt: string; endsAt: string }>(
  rows: readonly T[],
): { startDate: string; endDate: string } | null {
  if (rows.length === 0) return null;
  let start = rows[0]!.startsAt;
  let end = rows[0]!.endsAt;
  for (const row of rows) {
    if (row.startsAt < start) start = row.startsAt;
    if (row.endsAt > end) end = row.endsAt;
  }
  return { startDate: start, endDate: end };
}
