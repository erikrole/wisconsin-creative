import { describe, expect, it } from "vitest";
import { addDays, blockTimeLabel, blocksOnDate, weekStartOf, type TeamBlock } from "@/lib/team-availability";

const base: TeamBlock = {
  id: "a", kind: "WEEKLY", intent: "CANNOT_WORK", status: "APPROVED", dayOfWeek: 1,
  date: null, dateEndsOn: null, allDay: false, startsAt: "09:00", endsAt: "11:30", label: null,
  semesterStartsOn: null, semesterEndsOn: null,
};

describe("team availability helpers", () => {
  it("finds the Monday of a week", () => {
    expect(weekStartOf("2026-10-27")).toBe("2026-10-26");
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("applies weekly blocks on their weekday inside the semester", () => {
    const block = { ...base, semesterEndsOn: "2026-12-18" };
    expect(blocksOnDate([block], "2026-10-26")).toHaveLength(1);
    expect(blocksOnDate([block], "2026-10-27")).toHaveLength(0);
    expect(blocksOnDate([block], "2026-12-21")).toHaveLength(0);
  });

  it("applies date ranges inclusively and hides denied blocks", () => {
    const trip = { ...base, id: "b", kind: "AD_HOC" as const, dayOfWeek: null, date: "2026-11-02", dateEndsOn: "2026-11-04", allDay: true };
    expect(blocksOnDate([trip], "2026-11-04")).toHaveLength(1);
    expect(blocksOnDate([trip], "2026-11-05")).toHaveLength(0);
    expect(blocksOnDate([{ ...trip, status: "DENIED" }], "2026-11-03")).toHaveLength(0);
  });

  it("labels times compactly", () => {
    expect(blockTimeLabel(base)).toBe("9a–11:30a");
    expect(blockTimeLabel({ allDay: true, startsAt: "00:00", endsAt: "23:59" })).toBe("All day");
  });
});
