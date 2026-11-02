import { describe, expect, it } from "vitest";
import {
  availabilityConflictNote,
  evaluateAvailabilityPreferences,
  findAvailabilityConflict,
} from "@/lib/student-availability";
import { effectiveCallWindow } from "@/lib/shift-call-windows";

describe("student availability conflict helpers", () => {
  it("matches weekly class blocks inside semester date bounds", () => {
    const note = availabilityConflictNote([
      {
        kind: "WEEKLY",
        dayOfWeek: 2,
        startsAt: "09:00",
        endsAt: "10:30",
        label: "COMM 201",
        semesterStartsOn: "2026-08-24",
        semesterEndsOn: "2026-12-18",
      },
    ], {
      startsAt: new Date("2026-09-01T14:15:00.000Z"),
      endsAt: new Date("2026-09-01T15:00:00.000Z"),
    });

    expect(note).toBe("Conflicts with COMM 201 (09:00-10:30)");
  });

  it("ignores weekly class blocks outside semester date bounds", () => {
    const conflict = findAvailabilityConflict([
      {
        kind: "WEEKLY",
        dayOfWeek: 2,
        startsAt: "09:00",
        endsAt: "10:30",
        label: "COMM 201",
        semesterStartsOn: "2026-08-24",
        semesterEndsOn: "2026-12-18",
      },
    ], {
      startsAt: new Date("2027-01-05T14:15:00.000Z"),
      endsAt: new Date("2027-01-05T15:00:00.000Z"),
    });

    expect(conflict).toBeNull();
  });

  it("matches one-time ad hoc conflicts only on the exact local date", () => {
    const blocks = [{
      kind: "AD_HOC" as const,
      date: "2026-10-06",
      startsAt: "10:00",
      endsAt: "11:00",
      label: "Exam",
    }];

    expect(availabilityConflictNote(blocks, {
      startsAt: new Date("2026-10-06T15:15:00.000Z"),
      endsAt: new Date("2026-10-06T15:45:00.000Z"),
    })).toBe("Conflicts with Exam (10:00-11:00)");

    expect(findAvailabilityConflict(blocks, {
      startsAt: new Date("2026-10-07T15:15:00.000Z"),
      endsAt: new Date("2026-10-07T15:45:00.000Z"),
    })).toBeNull();
  });

  it("matches inclusive one-time date ranges and ignores dates outside them", () => {
    const block = {
      kind: "AD_HOC" as const,
      date: "2026-10-08",
      dateEndsOn: "2026-10-10",
      startsAt: "10:00",
      endsAt: "11:00",
      label: "Friends visiting",
    };

    expect(availabilityConflictNote([block], {
      startsAt: new Date("2026-10-09T15:15:00.000Z"),
      endsAt: new Date("2026-10-09T15:45:00.000Z"),
    })).toBe("Conflicts with Friends visiting (10:00-11:00, 2026-10-08 to 2026-10-10)");

    expect(findAvailabilityConflict([block], {
      startsAt: new Date("2026-10-11T15:15:00.000Z"),
      endsAt: new Date("2026-10-11T15:45:00.000Z"),
    })).toBeNull();
  });

  it("treats an all-day one-time range as unavailable at any time on covered dates", () => {
    const block = {
      kind: "AD_HOC" as const,
      date: "2026-10-08",
      dateEndsOn: "2026-10-10",
      allDay: true,
      startsAt: "00:00",
      endsAt: "23:59",
      label: "Family trip",
    };

    expect(availabilityConflictNote([block], {
      startsAt: new Date("2026-10-10T04:00:00.000Z"),
      endsAt: new Date("2026-10-10T05:00:00.000Z"),
    })).toBe("Conflicts with Family trip (all day, 2026-10-08 to 2026-10-10)");

    expect(findAvailabilityConflict([block], {
      startsAt: new Date("2026-10-11T06:00:00.000Z"),
      endsAt: new Date("2026-10-11T07:00:00.000Z"),
    })).toBeNull();
  });

  it("treats prefer and dislike as preference signals without blocking", () => {
    const evaluation = evaluateAvailabilityPreferences([
      {
        kind: "AD_HOC",
        intent: "PREFER",
        status: "APPROVED",
        date: "2026-10-06",
        startsAt: "10:00",
        endsAt: "11:00",
        label: "Tuesday mornings",
      },
      {
        kind: "AD_HOC",
        intent: "DISLIKE",
        status: "APPROVED",
        date: "2026-10-06",
        startsAt: "10:00",
        endsAt: "11:00",
        label: "Lab prep",
      },
    ], {
      startsAt: new Date("2026-10-06T15:15:00.000Z"),
      endsAt: new Date("2026-10-06T15:45:00.000Z"),
    });

    expect(evaluation.blocking).toBeNull();
    expect(evaluation.preferred?.note).toBe("Prefers Tuesday mornings (10:00-11:00)");
    expect(evaluation.advisory?.note).toBe("Dislikes Lab prep (10:00-11:00)");
  });

  it("blocks only approved time off and ignores denied time off", () => {
    const evaluation = evaluateAvailabilityPreferences([
      {
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "DENIED",
        date: "2026-10-06",
        startsAt: "10:00",
        endsAt: "11:00",
        label: "Denied trip",
      },
      {
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        date: "2026-10-06",
        startsAt: "10:00",
        endsAt: "11:00",
        label: "Family trip",
      },
    ], {
      startsAt: new Date("2026-10-06T15:15:00.000Z"),
      endsAt: new Date("2026-10-06T15:45:00.000Z"),
    });

    expect(evaluation.blocking?.note).toBe("Approved time off: Family trip (10:00-11:00)");
    expect(availabilityConflictNote(evaluation.conflicts.map((conflict) => conflict.block), {
      startsAt: new Date("2026-10-06T15:15:00.000Z"),
      endsAt: new Date("2026-10-06T15:45:00.000Z"),
    })).toBe("Approved time off: Family trip (10:00-11:00)");
  });

  it.each([
    ["second day of an overnight shift", { kind: "WEEKLY", dayOfWeek: 3, startsAt: "00:15", endsAt: "01:00" }, "2026-10-07T04:00:00Z", "2026-10-07T06:00:00Z", true],
    ["first day of an overnight shift", { kind: "WEEKLY", dayOfWeek: 2, startsAt: "22:30", endsAt: "23:30" }, "2026-10-07T04:00:00Z", "2026-10-07T06:00:00Z", true],
    ["timed range on an intermediate date", { kind: "AD_HOC", date: "2026-10-07", startsAt: "10:00", endsAt: "11:00" }, "2026-10-07T04:00:00Z", "2026-10-08T06:00:00Z", true],
    ["all-day request beginning exactly at release", { kind: "AD_HOC", date: "2026-10-07", allDay: true, startsAt: "00:00", endsAt: "23:59" }, "2026-10-07T04:00:00Z", "2026-10-07T05:00:00Z", false],
    ["term ending on the first overnight day", { kind: "WEEKLY", dayOfWeek: 3, startsAt: "00:15", endsAt: "01:00", semesterEndsOn: "2026-10-06" }, "2026-10-07T04:00:00Z", "2026-10-07T06:00:00Z", false],
    ["zero length window", { kind: "AD_HOC", date: "2026-10-07", allDay: true, startsAt: "00:00", endsAt: "23:59" }, "2026-10-07T06:00:00Z", "2026-10-07T06:00:00Z", false],
  ])("handles %s", (_name, block, start, end, matches) => {
    expect(findAvailabilityConflict([block], { startsAt: new Date(start), endsAt: new Date(end) }) !== null).toBe(matches);
  });

  it.each([
    ["fall-back first occurrence", "2026-11-01T06:50:00Z", "2026-11-01T07:10:00Z", "01:55", "01:59", true],
    ["fall-back second occurrence", "2026-11-01T06:50:00Z", "2026-11-01T07:10:00Z", "01:01", "01:05", true],
    ["fall-back gap between the two traversed windows", "2026-11-01T06:50:00Z", "2026-11-01T07:10:00Z", "01:20", "01:30", false],
    ["spring-forward nonexistent hour", "2026-03-08T07:30:00Z", "2026-03-08T08:30:00Z", "02:10", "02:20", false],
    ["spring-forward actual hour", "2026-03-08T07:30:00Z", "2026-03-08T08:30:00Z", "03:10", "03:20", true],
    ["exact adjacent boundary", "2026-10-07T14:00:00Z", "2026-10-07T15:00:00Z", "10:00", "11:00", false],
    ["sub-minute overlap", "2026-10-07T14:59:59Z", "2026-10-07T15:00:01Z", "10:00", "11:00", true],
  ])("handles %s", (_name, start, end, startsAt, endsAt, matches) => {
    const date = start.slice(0, 10);
    expect(findAvailabilityConflict([{ kind: "AD_HOC", date, startsAt, endsAt }], {
      startsAt: new Date(start), endsAt: new Date(end),
    }) !== null).toBe(matches);
  });

  it("keeps call-window precedence unchanged for conflict checks", () => {
    const window = effectiveCallWindow({
      startsAt: "2026-10-06T14:00:00.000Z",
      endsAt: "2026-10-06T17:00:00.000Z",
      callStartsAt: "2026-10-06T14:30:00.000Z",
      callEndsAt: "2026-10-06T16:00:00.000Z",
    }, {
      callStartsAt: "2026-10-06T15:15:00.000Z",
      callEndsAt: "2026-10-06T15:45:00.000Z",
    });

    expect(window.source).toBe("assignment");
    expect(availabilityConflictNote([{
      kind: "AD_HOC",
      date: "2026-10-06",
      startsAt: "10:00",
      endsAt: "11:00",
      label: "Exam",
    }], {
      startsAt: new Date(window.startsAt),
      endsAt: new Date(window.endsAt),
    })).toBe("Conflicts with Exam (10:00-11:00)");
  });
});

describe("student availability conflicts across midnight", () => {
  // Saturday 19:00 to Sunday 01:30 Madison time (CST, UTC-6).
  const overnightShift = {
    startsAt: new Date("2026-11-15T01:00:00.000Z"),
    endsAt: new Date("2026-11-15T07:30:00.000Z"),
  };

  it("matches a weekly block late on the shift's start day", () => {
    expect(availabilityConflictNote([
      { kind: "WEEKLY", dayOfWeek: 6, startsAt: "20:00", endsAt: "21:00", label: "Shabbat dinner" },
    ], overnightShift)).toBe("Conflicts with Shabbat dinner (20:00-21:00)");
  });

  it("matches a weekly block on the day the shift ends", () => {
    expect(availabilityConflictNote([
      { kind: "WEEKLY", dayOfWeek: 0, startsAt: "00:30", endsAt: "02:00", label: "Sunday shift" },
    ], overnightShift)).toBe("Conflicts with Sunday shift (00:30-02:00)");
  });

  it("ignores a block on the end day that starts after the shift ends", () => {
    expect(findAvailabilityConflict([
      { kind: "WEEKLY", dayOfWeek: 0, startsAt: "02:00", endsAt: "03:00" },
    ], overnightShift)).toBeNull();
  });

  it("matches a timed one-time block on the day the shift ends", () => {
    expect(availabilityConflictNote([
      { kind: "AD_HOC", date: "2026-11-15", startsAt: "01:00", endsAt: "03:00", label: "Flight" },
    ], overnightShift)).toBe("Conflicts with Flight (01:00-03:00)");
  });

  it("checks the semester bounds against the day each segment falls on", () => {
    expect(findAvailabilityConflict([
      { kind: "WEEKLY", dayOfWeek: 0, startsAt: "00:30", endsAt: "02:00", semesterStartsOn: "2026-11-15", semesterEndsOn: "2026-12-18" },
    ], overnightShift)).not.toBeNull();
  });

  it("ends a window exactly at midnight without touching the next day", () => {
    expect(findAvailabilityConflict([
      { kind: "WEEKLY", dayOfWeek: 0, startsAt: "00:00", endsAt: "01:00" },
    ], {
      startsAt: new Date("2026-11-15T01:00:00.000Z"),
      endsAt: new Date("2026-11-15T06:00:00.000Z"),
    })).toBeNull();
  });
});

describe("inherited all-day windows", () => {
  // All-day Saturday 2026-11-14, stored as UTC midnights.
  const allDaySaturday = {
    startsAt: new Date("2026-11-14T00:00:00.000Z"),
    endsAt: new Date("2026-11-15T00:00:00.000Z"),
  };

  it("matches weekly blocks anywhere on the event's own weekday", () => {
    expect(availabilityConflictNote([
      { kind: "WEEKLY", dayOfWeek: 6, startsAt: "10:00", endsAt: "11:00", label: "Sat lab" },
    ], allDaySaturday)).toBe("Conflicts with Sat lab (10:00-11:00)");
    expect(findAvailabilityConflict([
      { kind: "WEEKLY", dayOfWeek: 6, startsAt: "20:00", endsAt: "21:00" },
    ], allDaySaturday)).not.toBeNull();
  });

  it("does not read the UTC midnight start as the previous evening in Madison", () => {
    expect(findAvailabilityConflict([
      { kind: "WEEKLY", dayOfWeek: 5, startsAt: "19:00", endsAt: "21:00", label: "Friday night" },
    ], allDaySaturday)).toBeNull();
  });

  it("covers every date of a multi-day all-day event", () => {
    expect(findAvailabilityConflict([
      { kind: "AD_HOC", date: "2026-11-15", startsAt: "09:00", endsAt: "10:00" },
    ], { startsAt: new Date("2026-11-14T00:00:00.000Z"), endsAt: new Date("2026-11-16T00:00:00.000Z") })).not.toBeNull();
  });
});
