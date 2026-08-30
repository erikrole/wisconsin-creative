export type ScheduleTimelineEventAnchor = {
  id: string;
  offset: number;
};

export type ScheduleTimelineDayAnchor = {
  value: number;
  offset: number;
};

export type ScheduleTimelineSnapshot = {
  events: ScheduleTimelineEventAnchor[];
  day: ScheduleTimelineDayAnchor | null;
};

export type ScheduleTimelineTarget =
  | { kind: "event"; id: string; offset: number }
  | { kind: "day"; value: number; offset: number };

export type ScheduleQueryScope = {
  viewMode: "list" | "calendar" | "week";
  includeArchived: boolean;
  sportFilter: string;
  dateRangeKey: string;
};

type SchedulePeriodView = "calendar" | "week";

const TIMELINE_TRANSITION_KEY = "schedule:timeline-transition";
const TIMELINE_READING_KEY = "schedule:timeline-reading";
const MAX_EVENT_ANCHORS = 8;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSnapshot(value: unknown): value is ScheduleTimelineSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScheduleTimelineSnapshot>;
  if (!Array.isArray(candidate.events)) return false;
  if (!candidate.events.every((event) => (
    event
    && typeof event === "object"
    && typeof event.id === "string"
    && finiteNumber(event.offset)
  ))) return false;
  return candidate.day === null || Boolean(
    candidate.day
    && typeof candidate.day === "object"
    && finiteNumber(candidate.day.value)
    && finiteNumber(candidate.day.offset),
  );
}

function stickyBottom(): number {
  if (typeof document === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--schedule-sticky-bottom")
    .trim();
  const publishedBottom = Number.parseInt(raw, 10) || 0;
  const liveBottom = document
    .querySelector<HTMLElement>("[data-schedule-sticky-frame]")
    ?.getBoundingClientRect().bottom ?? 0;
  // The sticky frame republishes the CSS variable when its pinned treatment
  // changes. A pointer can land during that layout-effect cleanup, so use the
  // live frame edge as an equally authoritative fallback instead of briefly
  // treating the viewport top as the schedule boundary.
  return Math.max(publishedBottom, liveBottom);
}

function displayedElements(selector: string): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
}

export function chooseScheduleTimelineTarget(
  snapshot: ScheduleTimelineSnapshot,
  availableEventIds: ReadonlySet<string>,
  availableDayValues: readonly number[],
): ScheduleTimelineTarget | null {
  for (const event of snapshot.events) {
    if (availableEventIds.has(event.id)) {
      return { kind: "event", id: event.id, offset: event.offset };
    }
  }

  if (!snapshot.day || availableDayValues.length === 0) return null;
  const exact = availableDayValues.find((value) => value === snapshot.day?.value);
  if (exact !== undefined) {
    return { kind: "day", value: exact, offset: snapshot.day.offset };
  }

  const nearest = availableDayValues.reduce((best, value) => (
    Math.abs(value - snapshot.day!.value) < Math.abs(best - snapshot.day!.value)
      ? value
      : best
  ));
  return { kind: "day", value: nearest, offset: snapshot.day.offset };
}

export function shouldKeepPreviousScheduleData(
  previous: ScheduleQueryScope | null | undefined,
  next: ScheduleQueryScope,
): boolean {
  return Boolean(
    previous
    && previous.viewMode === "list"
    && next.viewMode === "list"
    && previous.includeArchived === false
    && next.includeArchived === true
    && previous.sportFilter === next.sportFilter
    && previous.dateRangeKey === next.dateRangeKey,
  );
}

function startOfLocalDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function persistScheduleTimelineSnapshot(
  key: string,
  snapshot: ScheduleTimelineSnapshot,
): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function readScheduleTimelineSnapshot(key: string): ScheduleTimelineSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function scheduleTimelineSnapshotDate(
  snapshot: ScheduleTimelineSnapshot | null | undefined,
): Date | null {
  if (!snapshot?.day) return null;
  const date = new Date(snapshot.day.value);
  return Number.isNaN(date.getTime()) ? null : startOfLocalDay(date);
}

export function chooseScheduleViewContextDate({
  viewMode,
  snapshot,
  calMonth,
  weekStart,
  now = new Date(),
}: {
  viewMode: SchedulePeriodView;
  snapshot: ScheduleTimelineSnapshot | null | undefined;
  calMonth: Date;
  weekStart: Date;
  now?: Date;
}): Date {
  const snapshotDate = scheduleTimelineSnapshotDate(snapshot);
  const today = startOfLocalDay(now);

  if (viewMode === "calendar") {
    const belongsToMonth = (date: Date) => (
      date.getFullYear() === calMonth.getFullYear()
      && date.getMonth() === calMonth.getMonth()
    );
    if (snapshotDate && belongsToMonth(snapshotDate)) return snapshotDate;
    if (belongsToMonth(today)) return today;
    return new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  }

  const start = startOfLocalDay(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const belongsToWeek = (date: Date) => date >= start && date < end;
  if (snapshotDate && belongsToWeek(snapshotDate)) return snapshotDate;
  if (belongsToWeek(today)) return today;
  return start;
}

function currentScheduleTimelinePosition(): ScheduleTimelineSnapshot | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;

  const boundary = stickyBottom();
  const viewportBottom = window.innerHeight;
  const eventAnchors = displayedElements("[data-schedule-event-id]")
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > boundary && rect.top < viewportBottom)
    .sort((a, b) => a.rect.top - b.rect.top)
    .slice(0, MAX_EVENT_ANCHORS)
    .flatMap(({ element, rect }) => {
      const id = element.dataset.scheduleEventId;
      return id ? [{ id, offset: rect.top - boundary }] : [];
    });

  const visibleDays = displayedElements("[data-schedule-day]")
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > boundary && rect.top < viewportBottom)
    .sort((a, b) => a.rect.top - b.rect.top);
  // A sticky day header can land a fraction of a pixel below the measured
  // boundary while the previous group still contributes the same fractional
  // sliver. Prefer that aligned header; otherwise keep the group that actually
  // owns the boundary, then the first day below it.
  const dayElement = visibleDays.find(({ rect }) => Math.abs(rect.top - boundary) <= 2)
    ?? visibleDays.find(({ rect }) => rect.top <= boundary && rect.bottom > boundary + 2)
    ?? visibleDays.find(({ rect }) => rect.top > boundary)
    ?? visibleDays[0];
  const dayValue = dayElement
    ? Number.parseInt(dayElement.element.dataset.scheduleDay ?? "", 10)
    : Number.NaN;
  const day = dayElement && Number.isFinite(dayValue)
    ? { value: dayValue, offset: dayElement.rect.top - boundary }
    : null;

  if (eventAnchors.length === 0 && day === null) return null;
  return { events: eventAnchors, day };
}

export function saveScheduleTimelinePosition(snapshot: ScheduleTimelineSnapshot): boolean {
  return persistScheduleTimelineSnapshot(TIMELINE_TRANSITION_KEY, snapshot);
}

export function captureScheduleTimelinePosition(): ScheduleTimelineSnapshot | null {
  const snapshot = currentScheduleTimelinePosition();
  if (!snapshot) return null;
  return saveScheduleTimelinePosition(snapshot) ? snapshot : null;
}

export function rememberScheduleTimelineReadingPosition(): ScheduleTimelineSnapshot | null {
  const snapshot = currentScheduleTimelinePosition();
  if (!snapshot) return null;
  return persistScheduleTimelineSnapshot(TIMELINE_READING_KEY, snapshot) ? snapshot : null;
}

export function readScheduleTimelinePosition(): ScheduleTimelineSnapshot | null {
  return readScheduleTimelineSnapshot(TIMELINE_TRANSITION_KEY);
}

export function readScheduleTimelineReadingPosition(): ScheduleTimelineSnapshot | null {
  return readScheduleTimelineSnapshot(TIMELINE_READING_KEY);
}

export function discardScheduleTimelinePosition(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(TIMELINE_TRANSITION_KEY);
}

export function discardScheduleTimelineReadingPosition(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(TIMELINE_READING_KEY);
}

export function restoreScheduleTimelinePosition(snapshot: ScheduleTimelineSnapshot): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const eventElements = displayedElements("[data-schedule-event-id]");
  const eventById = new Map<string, HTMLElement>();
  for (const element of eventElements) {
    const id = element.dataset.scheduleEventId;
    if (id && !eventById.has(id)) eventById.set(id, element);
  }

  const dayElements = displayedElements("[data-schedule-day]");
  const dayByValue = new Map<number, HTMLElement>();
  for (const element of dayElements) {
    const value = Number.parseInt(element.dataset.scheduleDay ?? "", 10);
    if (Number.isFinite(value) && !dayByValue.has(value)) dayByValue.set(value, element);
  }

  const target = chooseScheduleTimelineTarget(
    snapshot,
    new Set(eventById.keys()),
    [...dayByValue.keys()],
  );
  if (!target) return false;

  const element = target.kind === "event"
    ? eventById.get(target.id)
    : dayByValue.get(target.value);
  if (!element) return false;

  const desiredTop = stickyBottom() + target.offset;
  const delta = element.getBoundingClientRect().top - desiredTop;
  if (Math.abs(delta) > 1) {
    window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: "instant" });
  }
  return true;
}
