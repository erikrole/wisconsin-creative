import { describe, expect, it } from "vitest";
import {
  parseScheduleEventKeyset,
  scheduleEventKeysetOrder,
  scheduleEventKeysetWhere,
} from "@/lib/schedule-event-keyset";
import { HttpError } from "@/lib/http";

describe("schedule event keyset", () => {
  it("parses a before cursor with an id tie-breaker", () => {
    const keyset = parseScheduleEventKeyset(new URLSearchParams({
      beforeStartsAt: "2026-09-18T12:00:00.000Z",
      beforeId: "event-1",
    }));
    expect(keyset).toEqual({
      direction: "before",
      startsAt: new Date("2026-09-18T12:00:00.000Z"),
      id: "event-1",
    });
    expect(scheduleEventKeysetWhere(keyset!)).toEqual({
      OR: [
        { startsAt: { lt: new Date("2026-09-18T12:00:00.000Z") } },
        { AND: [{ startsAt: new Date("2026-09-18T12:00:00.000Z") }, { id: { lt: "event-1" } }] },
      ],
    });
    expect(scheduleEventKeysetOrder(keyset)).toEqual([{ startsAt: "desc" }, { id: "desc" }]);
  });

  it("parses an after cursor without an id as a strict start bound", () => {
    const keyset = parseScheduleEventKeyset(new URLSearchParams({
      afterStartsAt: "2026-09-18T12:00:00.000Z",
    }));
    expect(keyset).toEqual({
      direction: "after",
      startsAt: new Date("2026-09-18T12:00:00.000Z"),
      id: null,
    });
    expect(scheduleEventKeysetWhere(keyset!)).toEqual({
      startsAt: { gt: new Date("2026-09-18T12:00:00.000Z") },
    });
    expect(scheduleEventKeysetOrder(keyset)).toEqual([{ startsAt: "asc" }, { id: "asc" }]);
  });

  it("rejects mixing before and after cursors", () => {
    expect(() => parseScheduleEventKeyset(new URLSearchParams({
      beforeStartsAt: "2026-09-18T12:00:00.000Z",
      afterStartsAt: "2026-09-19T12:00:00.000Z",
    }))).toThrow(HttpError);
  });
});
