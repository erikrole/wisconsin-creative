import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  blockedWindow,
  shiftsDuring,
  defaultWeeklyEndsOn,
  formatAwayDates,
  formatWeekDays,
  groupWeekly,
  localToday,
  isUnavailableBlock,
  upcomingAway,
  type AvailabilityBlockLite,
} from "@/lib/unavailable-times";

const weekly = (id: string, dayOfWeek: number, extra: Partial<AvailabilityBlockLite> = {}): AvailabilityBlockLite => ({
  id,
  kind: "WEEKLY",
  intent: "CANNOT_WORK",
  dayOfWeek,
  startsAt: "09:30",
  endsAt: "10:45",
  label: "COMM 201",
  semesterEndsOn: "2026-12-23T00:00:00.000Z",
  ...extra,
});

const away = (id: string, date: string, dateEndsOn: string, extra: Partial<AvailabilityBlockLite> = {}): AvailabilityBlockLite => ({
  id,
  kind: "AD_HOC",
  intent: "CANNOT_WORK",
  dayOfWeek: null,
  date: `${date}T00:00:00.000Z`,
  dateEndsOn: `${dateEndsOn}T00:00:00.000Z`,
  allDay: true,
  startsAt: "00:00",
  endsAt: "23:59",
  label: "Trip home",
  ...extra,
});

describe("when a student can't work", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T17:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("keeps today's term and removes an ended term from current weekly entry", () => {
    expect(groupWeekly([weekly("past", 1, { semesterEndsOn: "2026-10-28" }), weekly("today", 3, { semesterEndsOn: "2026-10-29" })]).map((item) => item.blockIds)).toEqual([["today"]]);
    expect(localToday(new Date("2026-10-30T02:00:00Z"))).toBe("2026-10-29");
  });
  it("folds one block per day back into a single weekly item, Monday first", () => {
    const [comm] = groupWeekly([weekly("a", 5), weekly("b", 1), weekly("c", 3)]);
    expect(comm?.days).toEqual([1, 3, 5]);
    expect(comm?.blockIds).toHaveLength(3);
    expect(formatWeekDays(comm!.days)).toBe("M W F");
  });

  it("keeps a job apart from a class and ignores preferences and time-off requests", () => {
    const items = groupWeekly([
      weekly("a", 1),
      weekly("b", 2, { label: "Job at the Union", startsAt: "17:00", endsAt: "21:00" }),
      weekly("c", 1, { intent: "PREFER" }),
      weekly("d", 3, { intent: "TIME_OFF" }),
    ]);
    expect(items.map((c) => c.label)).toEqual(["COMM 201", "Job at the Union"]);
  });

  it("lists dates away that haven't ended, soonest first", () => {
    const items = upcomingAway(
      [away("old", "2026-10-01", "2026-10-03"), away("late", "2026-11-20", "2026-11-22"), away("soon", "2026-11-06", "2026-11-06", { label: "Exam" })],
      "2026-10-21",
    );
    expect(items.map((i) => i.id)).toEqual(["soon", "late"]);
    expect(formatAwayDates(items[1]!)).toBe("Fri, Nov 20 – Sun, Nov 22");
  });

  it("counts weekly and dated can't-work blocks, nothing else", () => {
    expect(isUnavailableBlock(weekly("a", 1))).toBe(true);
    expect(isUnavailableBlock(away("b", "2026-11-06", "2026-11-06"))).toBe(true);
    expect(isUnavailableBlock(weekly("c", 1, { intent: "PREFER" }))).toBe(false);
  });

  it("guesses a term end that is never in the past", () => {
    expect(defaultWeeklyEndsOn(new Date(2026, 9, 21))).toBe("2026-12-23");
    expect(defaultWeeklyEndsOn(new Date(2026, 11, 28))).toBe("2027-05-17");
    expect(defaultWeeklyEndsOn(new Date(2027, 1, 3))).toBe("2027-05-17");
    expect(defaultWeeklyEndsOn(new Date(2027, 5, 10))).toBe("2027-08-15");
  });

  it("is offered on the checklist and finish screen, never required", () => {
    const card = readFileSync("src/app/(app)/_home/GettingStartedCard.tsx", "utf8");
    const setup = readFileSync("src/app/(app)/welcome/availability/AvailabilitySetup.tsx", "utf8");
    const forms = readFileSync("src/components/availability/cant-work-forms.tsx", "utf8");
    const completion = readFileSync("src/lib/profile-completion.ts", "utf8");
    expect(card).toContain('href: "/welcome/availability"');
    expect(setup).toContain("Skip for now");
    expect(forms).toContain('intent: "CANNOT_WORK"');
    expect(forms).toContain('kind: "AD_HOC"');
    expect(completion).not.toContain("availability");
  });

  it("keeps days off one tap away on Home and Schedule for student workers", () => {
    const home = readFileSync("src/app/(app)/_home/HomePage.tsx", "utf8");
    const view = readFileSync("src/app/(app)/_home/HomeView.tsx", "utf8");
    const schedule = readFileSync("src/app/(app)/schedule/page.tsx", "utf8");
    // Only student workers can edit their own availability, so only they see it.
    expect(home).toContain('role === "STUDENT" && me?.staffingType === "ST" && !readOnly');
    expect(schedule).toContain('!isStaff && me?.staffingType === "ST"');
    expect(home).toContain("<CantWorkDialog");
    expect(schedule).toContain("<CantWorkDialog");
    expect(view).toContain("Add days you can’t work");
    expect(view).toContain('href="/welcome/availability"');
  });
});

describe("shiftsDuring", () => {
  const shift = (id: string, startsAt: Date, endsAt: Date, allDay = false, eventDay = "") => ({
    id,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    event: { summary: id, allDay, startsAt: allDay ? `${eventDay}T00:00:00.000Z` : startsAt.toISOString() },
  });
  const game = shift("game", new Date(2026, 10, 27, 18, 0), new Date(2026, 10, 27, 21, 0));
  const morning = shift("morning", new Date(2026, 10, 27, 8, 0), new Date(2026, 10, 27, 10, 0));
  const after = shift("after", new Date(2026, 10, 30, 18, 0), new Date(2026, 10, 30, 21, 0));
  const mediaDay = shift("media", new Date(Date.UTC(2026, 10, 26)), new Date(Date.UTC(2026, 10, 27)), true, "2026-11-26");

  it("finds every shift inside an all-day range, including all-day events by date", () => {
    const range = { from: "2026-11-25", through: "2026-11-29", allDay: true, startsAt: "00:00", endsAt: "23:59" };
    expect(shiftsDuring([game, morning, after, mediaDay], range).map((s) => s.id)).toEqual(["game", "morning", "media"]);
  });

  it("only matches the blocked hours for a part-day range", () => {
    const range = { from: "2026-11-27", through: "2026-11-27", allDay: false, startsAt: "17:00", endsAt: "19:00" };
    expect(shiftsDuring([game, morning], range).map((s) => s.id)).toEqual(["game"]);
  });

  it("repeats part-day hours on each day of the range", () => {
    const range = { from: "2026-11-27", through: "2026-11-30", allDay: false, startsAt: "19:30", endsAt: "22:00" };
    expect(shiftsDuring([game, morning, after], range).map((s) => s.id)).toEqual(["game", "after"]);
  });

  it("builds a local query window for the whole range", () => {
    const { start, end } = blockedWindow({ from: "2026-11-25", through: "2026-11-29", allDay: true, startsAt: "00:00", endsAt: "23:59" });
    expect(start.getDate()).toBe(25);
    expect(end.getDate()).toBe(29);
    expect(end.getHours()).toBe(23);
  });
});
