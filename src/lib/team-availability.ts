export type TeamBlock = {
  id: string;
  kind: "WEEKLY" | "AD_HOC";
  intent: "CANNOT_WORK" | "PREFER" | "DISLIKE" | "TIME_OFF";
  status: "APPROVED" | "PENDING" | "DENIED";
  dayOfWeek: number | null;
  date: string | null;
  dateEndsOn: string | null;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  label: string | null;
  semesterStartsOn: string | null;
  semesterEndsOn: string | null;
};

export type TeamStudent = {
  id: string;
  name: string;
  avatarUrl: string | null;
  blocks: TeamBlock[];
};

/** Date-only strings (YYYY-MM-DD) shift by whole days in UTC, which never crosses a DST edge. */
export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `dateKey`. */
export function weekStartOf(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return addDays(dateKey, -((day + 6) % 7));
}

/** Blocks that apply on a calendar day, denied ones excluded. */
export function blocksOnDate(blocks: TeamBlock[], dateKey: string): TeamBlock[] {
  const dayOfWeek = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return blocks
    .filter((b) => {
      if (b.status === "DENIED") return false;
      if (b.kind === "AD_HOC") {
        if (!b.date) return false;
        return dateKey >= b.date && dateKey <= (b.dateEndsOn ?? b.date);
      }
      if (b.dayOfWeek !== dayOfWeek) return false;
      if (b.semesterStartsOn && dateKey < b.semesterStartsOn) return false;
      if (b.semesterEndsOn && dateKey > b.semesterEndsOn) return false;
      return true;
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt));
}

function shortTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

export function blockTimeLabel(b: Pick<TeamBlock, "allDay" | "startsAt" | "endsAt">): string {
  return b.allDay ? "All day" : `${shortTime(b.startsAt)}–${shortTime(b.endsAt)}`;
}
