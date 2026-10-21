import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultClassesEndOn, formatClassDays, groupClassTimes, type WeeklyBlock } from "@/lib/class-times";

const block = (id: string, dayOfWeek: number, extra: Partial<WeeklyBlock> = {}): WeeklyBlock => ({
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

describe("class times", () => {
  it("folds one block per day back into a single class, Monday first", () => {
    const [comm] = groupClassTimes([block("a", 5), block("b", 1), block("c", 3)]);
    expect(comm?.days).toEqual([1, 3, 5]);
    expect(comm?.blockIds).toHaveLength(3);
    expect(formatClassDays(comm!.days)).toBe("M W F");
  });

  it("keeps different times or names apart and ignores non-class availability", () => {
    const classes = groupClassTimes([
      block("a", 1),
      block("b", 2, { label: "HIST 101", startsAt: "13:00", endsAt: "14:15" }),
      block("c", 1, { intent: "PREFER" }),
      block("d", 4, { kind: "AD_HOC", dayOfWeek: null }),
    ]);
    expect(classes.map((c) => c.label)).toEqual(["COMM 201", "HIST 101"]);
  });

  it("guesses a term end that is never in the past", () => {
    expect(defaultClassesEndOn(new Date(2026, 9, 21))).toBe("2026-12-23");
    expect(defaultClassesEndOn(new Date(2026, 11, 28))).toBe("2027-05-17");
    expect(defaultClassesEndOn(new Date(2027, 1, 3))).toBe("2027-05-17");
    expect(defaultClassesEndOn(new Date(2027, 5, 10))).toBe("2027-08-15");
  });

  it("is offered on the checklist and finish screen, never required", () => {
    const card = readFileSync("src/app/(app)/_home/GettingStartedCard.tsx", "utf8");
    const setup = readFileSync("src/app/(app)/welcome/classes/ClassTimesSetup.tsx", "utf8");
    const completion = readFileSync("src/lib/profile-completion.ts", "utf8");
    expect(card).toContain('href: "/welcome/classes"');
    expect(setup).toContain("Skip for now");
    expect(setup).toContain('intent: "CANNOT_WORK"');
    expect(completion).not.toContain("availability");
  });
});
