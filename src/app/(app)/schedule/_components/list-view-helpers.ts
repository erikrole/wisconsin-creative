import { formatTimeShort } from "@/lib/format";
import { formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import { shiftWorkerSlotLabel, type ShiftWorkerKind } from "@/lib/shift-display";
import {
  callWindowKey,
  effectiveCallWindow,
  isInheritedFullDayCallWindow,
  studentCallTimeAppliesToEvent,
} from "@/lib/shift-call-windows";
import type { CalendarEntry, Shift } from "./types";
import { ACTIVE_STATUSES } from "./types";

export function shiftAssignee(shift: Shift) {
  const active = shift.assignments.find((a) => ACTIVE_STATUSES.includes(a.status));
  return active?.user ?? null;
}

export function activeShiftAssignment(shift: Shift) {
  return shift.assignments.find((a) => ACTIVE_STATUSES.includes(a.status)) ?? null;
}

export function openShiftCount(entry: CalendarEntry) {
  return entry.shifts.reduce((count, shift) => count + (shiftAssignee(shift) ? 0 : 1), 0);
}

export function workerKindForShift(shift: Shift): ShiftWorkerKind {
  return shift.workerType === "FT" ? "FT" : "ST";
}

export function roleSlotLabel(kind: ShiftWorkerKind) {
  return shiftWorkerSlotLabel(kind);
}

export function eventStartLabel(entry: CalendarEntry) {
  return entry.allDay ? formatCalendarEventAllDayLabel(entry) : formatTimeShort(entry.startsAt);
}

export function commonCallWindow(entry: CalendarEntry) {
  if (entry.allDay || !studentCallTimeAppliesToEvent(entry)) return null;

  const counts = new Map<string, { count: number; window: ReturnType<typeof effectiveCallWindow> }>();
  for (const shift of entry.shifts) {
    if (workerKindForShift(shift) !== "ST") continue;
    const window = effectiveCallWindow(shift, activeShiftAssignment(shift));
    if (isInheritedFullDayCallWindow(window)) continue;
    const key = callWindowKey(window);
    const current = counts.get(key);
    counts.set(key, { count: (current?.count ?? 0) + 1, window });
  }

  const [mostCommon] = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  if (!mostCommon || mostCommon[1].count < 2) return null;
  return { key: mostCommon[0], count: mostCommon[1].count, window: mostCommon[1].window };
}
