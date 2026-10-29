import { describe, expect, it } from "vitest";
import { buildPersonWeek } from "@/lib/schedule-by-person";
import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import type { TeamBlock } from "@/lib/team-availability";

const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

const user = (id: string, name: string) => ({ id, name, role: "STUDENT", primaryArea: null });

function entry(shifts: Array<{ startsAt: string; endsAt: string; people: Array<[string, string, string]> }>, allDay = false): CalendarEntry {
  return {
    id: "e1", summary: "Football vs Iowa", startsAt: shifts[0]!.startsAt, endsAt: shifts[0]!.endsAt, allDay,
    status: "CONFIRMED", rawLocationText: null, sportCode: null, opponent: null, isHome: null, site: null, subtitle: null,
    location: null, source: null, shiftGroupId: "g1", coverage: null,
    shifts: shifts.map((s, i) => ({
      id: `s${i}`, area: "VIDEO", workerType: "ST", startsAt: s.startsAt, endsAt: s.endsAt, notes: null,
      assignments: s.people.map(([id, name, status]) => ({ id: `${id}-${i}`, status, user: user(id, name) })),
    })),
  };
}

describe("buildPersonWeek", () => {
  it("groups shifts by person, totals hours, and ignores people outside the week", () => {
    const rows = buildPersonWeek([
      entry([{ startsAt: "2026-11-03T20:00:00Z", endsAt: "2026-11-04T01:00:00Z", people: [["a", "Avery", "APPROVED"], ["b", "Blake", "DIRECT_ASSIGNED"]] }]),
      entry([{ startsAt: "2026-11-20T20:00:00Z", endsAt: "2026-11-21T01:00:00Z", people: [["a", "Avery", "APPROVED"]] }]),
    ], week);
    expect(rows.map((r) => [r.name, r.shifts.length, r.hours])).toEqual([["Avery", 1, 5], ["Blake", 1, 5]]);
  });

  it("buckets a late shift on the Central day, not the UTC day", () => {
    // 7 PM CST on Nov 3 is already Nov 4 in UTC.
    const [row] = buildPersonWeek([
      entry([{ startsAt: "2026-11-04T01:00:00Z", endsAt: "2026-11-04T04:00:00Z", people: [["a", "Avery", "APPROVED"]] }]),
    ], week);
    expect(row!.shifts[0]!.dayKey).toBe("2026-11-03");
  });

  it("keeps pending requests visible but out of the hours", () => {
    const [row] = buildPersonWeek([
      entry([{ startsAt: "2026-11-03T20:00:00Z", endsAt: "2026-11-03T22:00:00Z", people: [["a", "Avery", "REQUESTED"], ["a", "Avery", "DECLINED"]] }]),
    ], week);
    expect(row!.shifts).toHaveLength(1);
    expect(row!.shifts[0]!.pending).toBe(true);
    expect(row!.hours).toBe(0);
  });

  it("adds roster students with no shifts and flags shifts that overlap can't-work times", () => {
    const block: TeamBlock = {
      id: "b", kind: "WEEKLY", intent: "CANNOT_WORK", status: "APPROVED", dayOfWeek: 2, date: null, dateEndsOn: null,
      allDay: false, startsAt: "14:00", endsAt: "16:00", label: "Class", semesterStartsOn: null, semesterEndsOn: null,
    };
    const rows = buildPersonWeek(
      [entry([{ startsAt: "2026-11-03T20:00:00Z", endsAt: "2026-11-03T22:00:00Z", people: [["a", "Avery", "APPROVED"]] }])],
      week,
      [{ id: "a", name: "Avery", avatarUrl: null, blocks: [block] }, { id: "c", name: "Casey", avatarUrl: null, blocks: [] }],
    );
    expect(rows.map((r) => r.name)).toEqual(["Avery", "Casey"]);
    expect(rows[0]!.shifts[0]!.conflictsAvailability).toBe(true);
    expect(rows[1]!.shifts).toHaveLength(0);
  });
});
