"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEvent, ShiftGroup } from "@/app/(app)/schedule/_components/types";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { AREAS } from "@/types/areas";

/* ───── Types ───── */

export type GridAssignment = {
  id: string;
  status: string;
  hasConflict: boolean;
  conflictNote: string | null;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  callNote?: string | null;
  user: { id: string; name: string; primaryArea: string | null; avatarUrl?: string | null };
};

export type GridShift = {
  id: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  assignments: GridAssignment[];
};

export type GridEvent = CalendarEvent & {
  shiftGroupId: string | null;
  shifts: GridShift[];
};

/** Column descriptor: one assignable area. */
export type GridColumn = {
  key: string;
  area: string;
  label: string;
};

type UseAssignmentGridResult = {
  events: GridEvent[];
  columns: GridColumn[];
  loading: boolean;
  error: false | "network" | "server";
  refetch: () => void;
  month: Date;
  setMonth: (d: Date) => void;
  sportFilter: string;
  setSportFilter: (v: string) => void;
  areaFilter: string;
  setAreaFilter: (v: string) => void;
};

/* ───── Helpers ───── */

function monthRange(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

function activeFutureMonthRange(month: Date) {
  const { start, end } = monthRange(month);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { start: start < today ? today : start, end };
}

async function fetchGridData(
  eventsUrl: string,
  groupsUrl: string,
  signal?: AbortSignal,
): Promise<GridEvent[]> {
  const [evRes, sgRes] = await Promise.all([
    fetch(eventsUrl, { signal }),
    fetch(groupsUrl, { signal }),
  ]);

  if (handleAuthRedirect(evRes) || handleAuthRedirect(sgRes)) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!evRes.ok) throw new Error("events fetch failed");

  const evJson = await parseJsonSafely<{ data?: CalendarEvent[] }>(evRes);
  if (!evJson?.data) throw new Error("events response malformed");
  const events: CalendarEvent[] = evJson.data ?? [];

  const groupMap = new Map<string, ShiftGroup>();
  const archivedEventIds = new Set<string>();
  if (sgRes.ok) {
    const sgJson = await parseJsonSafely<{ data?: ShiftGroup[] }>(sgRes);
    if (!sgJson?.data) throw new Error("shift groups response malformed");
    const groups: ShiftGroup[] = sgJson.data ?? [];
    for (const g of groups) {
      if (g.archivedAt) archivedEventIds.add(g.eventId);
      else groupMap.set(g.eventId, g);
    }
  }

  return events.filter((ev) => !archivedEventIds.has(ev.id)).map((ev) => {
    const g = groupMap.get(ev.id);
    const gridShifts: GridShift[] = (g?.shifts ?? []).map((s) => ({
      id: s.id,
      area: s.area,
      workerType: s.workerType,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      callStartsAt: s.callStartsAt,
      callEndsAt: s.callEndsAt,
      assignments: s.assignments.map((a) => ({
        id: a.id,
        status: a.status,
        hasConflict: (a as { hasConflict?: boolean }).hasConflict ?? false,
        conflictNote: (a as { conflictNote?: string | null }).conflictNote ?? null,
        callStartsAt: (a as { callStartsAt?: string | null }).callStartsAt ?? null,
        callEndsAt: (a as { callEndsAt?: string | null }).callEndsAt ?? null,
        callNote: (a as { callNote?: string | null }).callNote ?? null,
        user: a.user,
      })),
    }));
    return {
      ...ev,
      shiftGroupId: g?.id ?? null,
      shifts: gridShifts,
    };
  });
}

/** Derive column order from areas present in the month's shift data. */
function deriveColumns(events: GridEvent[], areaFilter: string): GridColumn[] {
  const cols: GridColumn[] = [];

  for (const area of AREAS) {
    if (areaFilter && area !== areaFilter) continue;
    const exists = events.some((e) => e.shifts.some((s) => s.area === area));
    if (exists) {
      cols.push({
        key: area,
        area,
        label: area,
      });
    }
  }
  return cols;
}

/* ───── Hook ───── */

export function useAssignmentGrid(): UseAssignmentGridResult {
  const [hydrated, setHydrated] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [sportFilter, setSportFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");

  const { start, end } = activeFutureMonthRange(month);
  const evParams = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    limit: "200",
  });
  const sgParams = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    limit: "200",
  });
  if (sportFilter) {
    evParams.set("sportCode", sportFilter);
    sgParams.set("sportCode", sportFilter);
  }

  const eventsUrl = `/api/calendar-events?${evParams}`;
  const groupsUrl = `/api/shift-groups?${sgParams}`;

  const {
    data: allEvents = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["assignment-grid", eventsUrl, groupsUrl],
    queryFn: ({ signal }) => fetchGridData(eventsUrl, groupsUrl, signal),
  });
  const visibleEvents = useMemo(() => hydrated ? allEvents : [], [allEvents, hydrated]);
  const loading = !hydrated || isLoading;

  useEffect(() => {
    setHydrated(true);
  }, []);

  const events = useMemo(() => {
    if (!areaFilter) return visibleEvents;
    return visibleEvents.filter((e) => e.shifts.some((s) => s.area === areaFilter));
  }, [visibleEvents, areaFilter]);

  const columns = useMemo(() => deriveColumns(visibleEvents, areaFilter), [visibleEvents, areaFilter]);

  const loadError: false | "network" | "server" =
    hydrated && error && visibleEvents.length === 0
      ? (error as Error).name === "TypeError"
        ? "network"
        : "server"
      : false;

  return {
    events,
    columns,
    loading,
    error: loadError,
    refetch,
    month,
    setMonth,
    sportFilter,
    setSportFilter,
    areaFilter,
    setAreaFilter,
  };
}
