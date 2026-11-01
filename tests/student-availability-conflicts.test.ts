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
