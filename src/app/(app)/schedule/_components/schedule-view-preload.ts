import type { ViewMode } from "@/hooks/use-schedule-data";

/** Load a schedule view chunk before it is shown, so the switch does not paint a gap. */
export function preloadScheduleView(mode: ViewMode): Promise<unknown> {
  if (mode === "calendar") return import("./CalendarView");
  if (mode === "week") return import("./WeekView");
  return Promise.resolve();
}
