/**
 * Student class times, as a student thinks of them: one class meets on several
 * days at one time. Storage stays one weekly CANNOT_WORK availability block per
 * day, so scheduling, conflicts and the staff Availability tab read them unchanged.
 */

export type WeeklyBlock = {
  id: string;
  kind?: "WEEKLY" | "AD_HOC";
  intent?: "CANNOT_WORK" | "PREFER" | "DISLIKE" | "TIME_OFF";
  dayOfWeek: number | null;
  startsAt: string;
  endsAt: string;
  label: string | null;
  semesterEndsOn?: string | null;
};

export type ClassTime = {
  key: string;
  label: string | null;
  days: number[];
  startsAt: string;
  endsAt: string;
  endsOn: string | null;
  blockIds: string[];
};

/** Monday-first, the way a class schedule reads. */
export const CLASS_DAYS = [
  { day: 1, short: "M", name: "Monday" },
  { day: 2, short: "T", name: "Tuesday" },
  { day: 3, short: "W", name: "Wednesday" },
  { day: 4, short: "Th", name: "Thursday" },
  { day: 5, short: "F", name: "Friday" },
  { day: 6, short: "Sa", name: "Saturday" },
  { day: 0, short: "Su", name: "Sunday" },
] as const;

const DAY_ORDER = CLASS_DAYS.map((d) => d.day as number);

export function isClassBlock(block: WeeklyBlock): boolean {
  return (block.kind ?? "WEEKLY") === "WEEKLY" && (block.intent ?? "CANNOT_WORK") === "CANNOT_WORK" && block.dayOfWeek !== null;
}

/** Folds per-day blocks back into classes: same name, time and end date. */
export function groupClassTimes(blocks: WeeklyBlock[]): ClassTime[] {
  const groups = new Map<string, ClassTime>();
  for (const block of blocks.filter(isClassBlock)) {
    const endsOn = block.semesterEndsOn ? block.semesterEndsOn.slice(0, 10) : null;
    const key = [block.label?.trim().toLowerCase() ?? "", block.startsAt, block.endsAt, endsOn ?? ""].join("|");
    const group = groups.get(key) ?? { key, label: block.label?.trim() || null, days: [], startsAt: block.startsAt, endsAt: block.endsAt, endsOn, blockIds: [] };
    if (!group.days.includes(block.dayOfWeek!)) group.days.push(block.dayOfWeek!);
    group.blockIds.push(block.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, days: g.days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)) }))
    .sort((a, b) => DAY_ORDER.indexOf(a.days[0]!) - DAY_ORDER.indexOf(b.days[0]!) || a.startsAt.localeCompare(b.startsAt));
}

export function formatClassDays(days: number[]): string {
  return days.map((d) => CLASS_DAYS.find((c) => c.day === d)?.short ?? "").join(" ");
}

export function formatClockTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A safe guess at when this term's classes end, so last term's classes stop
 * creating warnings. Students can change it. Errs a little late, since a class
 * left on a few extra days only adds a warning staff can ignore.
 */
export function defaultClassesEndOn(today = new Date()): string {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  if (month === 12 && today.getDate() > 23) return iso(year + 1, 5, 17);
  if (month >= 8) return iso(year, 12, 23);
  if (month <= 5) return iso(year, 5, 17);
  return iso(year, 8, 15);
}
