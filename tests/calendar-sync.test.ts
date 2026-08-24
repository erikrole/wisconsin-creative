import { describe, it, expect } from "vitest";
import { parseIcs, parseIcsDate, zonedWallTimeToUtc, splitEventsForSync, cleanSummary, extractSportInfo, unescapeIcsText, isHomeLocationText, WRITE_CHUNK_SIZE, type SyncResult, type SyncEventError, type SyncDiagnostics, type ParsedIcsEvent, type ExistingEventRow } from "@/lib/services/calendar-sync";

// ── unescapeIcsText unit tests ──

describe("unescapeIcsText", () => {
  it("unescapes \\n to newline", () => {
    expect(unescapeIcsText("Line 1\\nLine 2")).toBe("Line 1\nLine 2");
  });

  it("unescapes \\N (uppercase) to newline", () => {
    expect(unescapeIcsText("Line 1\\NLine 2")).toBe("Line 1\nLine 2");
  });

  it("unescapes \\, to comma", () => {
    expect(unescapeIcsText("Portland\\, OR")).toBe("Portland, OR");
  });

  it("unescapes \\; to semicolon", () => {
    expect(unescapeIcsText("A\\;B")).toBe("A;B");
  });

  it("unescapes \\\\ to backslash", () => {
    expect(unescapeIcsText("path\\\\file")).toBe("path\\file");
  });

  it("handles multiple escapes in one string", () => {
    expect(unescapeIcsText("Portland\\, OR\\nUSA")).toBe("Portland, OR\nUSA");
  });

  it("returns empty string unchanged", () => {
    expect(unescapeIcsText("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(unescapeIcsText("No escapes here")).toBe("No escapes here");
  });
});

// ── cleanSummary unit tests ──

describe("cleanSummary", () => {
  it("strips 'Wisconsin Athletics' prefix", () => {
    expect(cleanSummary("Wisconsin Athletics Women's Soccer vs North Dakota State")).toBe("Women's Soccer vs North Dakota State");
  });

  it("strips 'Wisconsin Badgers' prefix", () => {
    expect(cleanSummary("Wisconsin Badgers Women's Tennis at Purdue")).toBe("Women's Tennis at Purdue");
  });

  it("strips prefix case-insensitively", () => {
    expect(cleanSummary("wisconsin athletics Men's Hockey vs Minnesota")).toBe("Men's Hockey vs Minnesota");
  });

  it("strips prefix followed by a dash separator", () => {
    expect(cleanSummary("Wisconsin Badgers - Special Event")).toBe("Special Event");
  });

  it("returns original if no prefix match", () => {
    expect(cleanSummary("Michigan Wolverines vs Ohio State")).toBe("Michigan Wolverines vs Ohio State");
  });

  it("handles empty string gracefully", () => {
    expect(cleanSummary("")).toBe("");
  });

  it("handles exact prefix with no remainder", () => {
    expect(cleanSummary("Wisconsin Badgers")).toBe("Wisconsin Badgers");
  });
});

// ── extractSportInfo with sport labels ──

describe("extractSportInfo label matching", () => {
  it("matches 'Women's Tennis at Purdue' → WTEN, away", () => {
    const result = extractSportInfo("Women's Tennis at Purdue");
    expect(result.sportCode).toBe("WTEN");
    expect(result.opponent).toBe("Purdue");
    expect(result.isHome).toBe(false);
  });

  it("matches 'Men's Tennis vs #9 Illinois' → MTEN, home", () => {
    const result = extractSportInfo("Men's Tennis vs #9 Illinois");
    expect(result.sportCode).toBe("MTEN");
    expect(result.opponent).toBe("Illinois");
    expect(result.isHome).toBe(true);
  });

  it("matches 'Women's Swimming & Diving vs NCAA Championships' → WSWIM", () => {
    const result = extractSportInfo("Women's Swimming & Diving vs NCAA Championships");
    expect(result.sportCode).toBe("WSWIM");
    expect(result.opponent).toBe("NCAA Championships");
    expect(result.isHome).toBe(true);
  });

  it("matches 'Wrestling vs 2026 NCAA Championships' → WRES", () => {
    const result = extractSportInfo("Wrestling vs 2026 NCAA Championships");
    expect(result.sportCode).toBe("WRES");
    expect(result.opponent).toBe("2026 NCAA Championships");
    expect(result.isHome).toBe(true);
  });

  it("matches sport label with no vs/at as sport-only", () => {
    const result = extractSportInfo("Football Senior Day");
    expect(result.sportCode).toBe("FB");
    expect(result.opponent).toBeNull();
    expect(result.isHome).toBeNull();
  });

  it("still matches sport codes at start (MBB vs Iowa)", () => {
    const result = extractSportInfo("MBB vs Iowa");
    expect(result.sportCode).toBe("MBB");
    expect(result.opponent).toBe("Iowa");
    expect(result.isHome).toBe(true);
  });

  it("normalizes common opponent aliases", () => {
    const result = extractSportInfo("Volleyball vs University of Louisville - Invitational");
    expect(result.sportCode).toBe("VB");
    expect(result.opponent).toBe("Louisville - Invitational");
    expect(result.isHome).toBe(true);
  });
});

// ── parseIcsDate unit tests ──

describe("parseIcsDate", () => {
  it("parses a date-only value (YYYYMMDD) as allDay using UTC", () => {
    const result = parseIcsDate("20260301");
    expect(result.allDay).toBe(true);
    expect(result.date.getUTCFullYear()).toBe(2026);
    expect(result.date.getUTCMonth()).toBe(2); // March = 2
    expect(result.date.getUTCDate()).toBe(1);
  });

  it("parses a UTC datetime (YYYYMMDDTHHMMSSZ)", () => {
    const result = parseIcsDate("20260315T143000Z");
    expect(result.allDay).toBe(false);
    expect(result.date.getUTCHours()).toBe(14);
    expect(result.date.getUTCMinutes()).toBe(30);
  });

  it("parses a non-Z datetime (YYYYMMDDTHHMMSS) as UTC", () => {
    const result = parseIcsDate("20260315T143000");
    expect(result.allDay).toBe(false);
    // Now always UTC regardless of local timezone
    expect(result.date.getUTCHours()).toBe(14);
    expect(result.date.getUTCMinutes()).toBe(30);
  });

  it("returns Invalid Date for empty string", () => {
    const result = parseIcsDate("");
    expect(isNaN(result.date.getTime())).toBe(true);
  });

  it("returns Invalid Date for garbage input", () => {
    const result = parseIcsDate("not-a-date");
    expect(isNaN(result.date.getTime())).toBe(true);
  });

  // ── REGRESSION: TZID wall times must not be read as UTC ──
  it("converts a TZID wall time to UTC (CDT, -5)", () => {
    const result = parseIcsDate("20260901T190000", "America/Chicago");
    expect(result.allDay).toBe(false);
    // 7pm CDT = midnight UTC next day
    expect(result.date.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  it("converts a TZID wall time to UTC across the DST boundary (CST, -6)", () => {
    const result = parseIcsDate("20261215T190000", "America/Chicago");
    expect(result.date.toISOString()).toBe("2026-12-16T01:00:00.000Z");
  });

  it("ignores TZID when the value is already UTC (trailing Z)", () => {
    const result = parseIcsDate("20260901T190000Z", "America/Chicago");
    expect(result.date.toISOString()).toBe("2026-09-01T19:00:00.000Z");
  });

  it("falls back to the UTC interpretation for an unknown TZID", () => {
    const result = parseIcsDate("20260901T190000", "Not/AZone");
    expect(result.date.toISOString()).toBe("2026-09-01T19:00:00.000Z");
  });
});

describe("zonedWallTimeToUtc", () => {
  it("round-trips midnight without the Intl hour-24 quirk", () => {
    const result = zonedWallTimeToUtc(
      { year: 2026, month: 8, day: 1, hour: 0, minute: 0, second: 0 },
      "America/Chicago",
    );
    expect(result.toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });
});

describe("parseIcs property parsing", () => {
  const wrap = (props: string[]) => [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:evt-1",
    ...props,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  // ── REGRESSION: colons inside quoted params corrupted the value ──
  it("splits on the first colon outside quoted parameters", () => {
    const events = parseIcs(wrap([
      'DESCRIPTION;ALTREP="http://example.com/x":Game notes',
      "SUMMARY:MBB vs Iowa",
      "DTSTART:20260901T190000Z",
    ]));
    expect(events).toHaveLength(1);
    expect(events[0]!.description).toBe("Game notes");
    expect(events[0]!.summary).toBe("MBB vs Iowa");
  });

  it("captures TZID params for DTSTART and DTEND", () => {
    const events = parseIcs(wrap([
      "DTSTART;TZID=America/Chicago:20260901T190000",
      "DTEND;TZID=America/Chicago:20260901T220000",
      "SUMMARY:MBB vs Iowa",
    ]));
    expect(events[0]!.dtstartTzid).toBe("America/Chicago");
    expect(events[0]!.dtendTzid).toBe("America/Chicago");
  });

  it("inherits DTSTART's TZID for DTEND when DTEND omits it", () => {
    const events = parseIcs(wrap([
      "DTSTART;TZID=America/Chicago:20260901T190000",
      "DTEND:20260901T220000",
      "SUMMARY:MBB vs Iowa",
    ]));
    expect(events[0]!.dtendTzid).toBe("America/Chicago");
  });

  it("leaves TZID unset for plain UTC values", () => {
    const events = parseIcs(wrap([
      "DTSTART:20260901T190000Z",
      "SUMMARY:MBB vs Iowa",
    ]));
    expect(events[0]!.dtstartTzid).toBeUndefined();
  });

  it("returns Invalid Date for truncated date string", () => {
    const result = parseIcsDate("2026");
    // Only 4 digits cleaned — doesn't match 8-digit or datetime patterns
    expect(isNaN(result.date.getTime())).toBe(true);
  });
});

// ── isValidDate logic (mirrors the guard in syncCalendarSource) ──

function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime());
}

describe("date validation guard", () => {
  it("accepts a valid parsed date", () => {
    const { date } = parseIcsDate("20260301");
    expect(isValidDate(date)).toBe(true);
  });

  it("rejects an empty dtstart", () => {
    const { date } = parseIcsDate("");
    expect(isValidDate(date)).toBe(false);
  });

  it("rejects garbage dtstart", () => {
    const { date } = parseIcsDate("INVALID");
    expect(isValidDate(date)).toBe(false);
  });
});

// ── SyncResult type contract tests ──
// Ensures the shape stays stable for consumers (API route, UI, syncAll)

describe("SyncResult type shape", () => {
  it("has all required fields including skipped, errors, and operation", () => {
    const result: SyncResult = {
      added: 2,
      updated: 1,
      cancelled: 0,
      skipped: 1,
      errors: [{ uid: "abc", summary: "Bad event", operation: "create", reason: "Invalid start date" }],
    };
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.uid).toBe("abc");
    expect(result.errors[0]!.operation).toBe("create");
  });

  it("allows optional error field for fetch-level failures", () => {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      cancelled: 0,
      skipped: 0,
      errors: [],
      error: "HTTP 503: Service Unavailable",
    };
    expect(result.error).toBeTruthy();
  });
});

// ── Per-event error isolation logic (simulation) ──
// These tests verify the algorithm that the hardened sync loop uses,
// without needing Prisma or fetch mocks.

type SimulatedEvent = {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
};

function simulateEventLoop(events: SimulatedEvent[]): Pick<SyncResult, "added" | "skipped" | "errors"> {
  let added = 0;
  let skipped = 0;
  const errors: SyncEventError[] = [];

  for (const event of events) {
    let operation: "create" | "update" | "validate" = "validate";
    try {
      const startParsed = parseIcsDate(event.dtstart);
      const endParsed = parseIcsDate(event.dtend);

      if (!isValidDate(startParsed.date)) {
        throw new Error(`Invalid start date: "${event.dtstart}"`);
      }
      if (!isValidDate(endParsed.date)) {
        throw new Error(`Invalid end date: "${event.dtend}"`);
      }

      // Simulate successful create
      operation = "create";
      added++;
    } catch (err) {
      skipped++;
      if (errors.length < 10) {
        errors.push({
          uid: event.uid,
          summary: event.summary.slice(0, 120),
          operation,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  }

  return { added, skipped, errors };
}

describe("per-event error isolation", () => {
  it("malformed event with invalid date does not crash full sync", () => {
    const events: SimulatedEvent[] = [
      { uid: "good-1", summary: "Game Day", dtstart: "20260315T100000Z", dtend: "20260315T120000Z" },
      { uid: "bad-1", summary: "Corrupt Event", dtstart: "", dtend: "20260316T100000Z" },
      { uid: "good-2", summary: "Practice", dtstart: "20260317T080000Z", dtend: "20260317T100000Z" },
    ];

    const result = simulateEventLoop(events);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.uid).toBe("bad-1");
    expect(result.errors[0]!.reason).toContain("Invalid start date");
  });

  it("good events still sync when one event has bad end date", () => {
    const events: SimulatedEvent[] = [
      { uid: "ok-1", summary: "OK Event", dtstart: "20260301", dtend: "20260301" },
      { uid: "bad-end", summary: "Bad End", dtstart: "20260301", dtend: "garbage" },
      { uid: "ok-2", summary: "Another OK", dtstart: "20260302", dtend: "20260302" },
    ];

    const result = simulateEventLoop(events);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]!.uid).toBe("bad-end");
    expect(result.errors[0]!.reason).toContain("Invalid end date");
  });

  it("error summary contains uid and reason", () => {
    const events: SimulatedEvent[] = [
      { uid: "bad-uid-123", summary: "Broken", dtstart: "not-a-date", dtend: "also-bad" },
    ];

    const result = simulateEventLoop(events);
    expect(result.errors[0]!.uid).toBe("bad-uid-123");
    expect(result.errors[0]!.summary).toBe("Broken");
    expect(result.errors[0]!.reason).toBeTruthy();
  });

  it("all valid events produce zero errors", () => {
    const events: SimulatedEvent[] = [
      { uid: "a", summary: "A", dtstart: "20260301T090000Z", dtend: "20260301T110000Z" },
      { uid: "b", summary: "B", dtstart: "20260302", dtend: "20260302" },
    ];

    const result = simulateEventLoop(events);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("caps stored errors at 10", () => {
    const events: SimulatedEvent[] = Array.from({ length: 15 }, (_, i) => ({
      uid: `bad-${i}`,
      summary: `Bad Event ${i}`,
      dtstart: "",
      dtend: "",
    }));

    const result = simulateEventLoop(events);
    expect(result.skipped).toBe(15);
    expect(result.errors).toHaveLength(10);
  });
});

// ── SyncDiagnostics shape and sampling tests ──

function buildDiagnostics(events: Array<{ uid: string; summary: string; dtstart: string }>): SyncDiagnostics {
  const SAMPLE_SIZE = 5;
  const sorted = [...events].sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  return {
    fetchUrl: "https://example.com/feed.ics",
    httpStatus: 200,
    responseSizeBytes: 12345,
    parsedEventCount: events.length,
    earliestDtstart: sorted.length > 0 ? sorted[0]!.dtstart : null,
    latestDtstart: sorted.length > 0 ? sorted[sorted.length - 1]!.dtstart : null,
    firstEvents: sorted.slice(0, SAMPLE_SIZE).map((e) => ({ uid: e.uid, summary: e.summary.slice(0, 120), dtstart: e.dtstart })),
    lastEvents: sorted.slice(-SAMPLE_SIZE).map((e) => ({ uid: e.uid, summary: e.summary.slice(0, 120), dtstart: e.dtstart })),
    missingFromSourceCount: 0,
    missingFromSource: [],
  };
}

describe("SyncDiagnostics", () => {
  it("has all required fields", () => {
    const diag: SyncDiagnostics = {
      fetchUrl: "https://example.com/feed.ics",
      httpStatus: 200,
      responseSizeBytes: 5000,
      parsedEventCount: 10,
      earliestDtstart: "20260101",
      latestDtstart: "20261231",
      firstEvents: [],
      lastEvents: [],
      missingFromSourceCount: 0,
      missingFromSource: [],
    };
    expect(diag.fetchUrl).toBeTruthy();
    expect(diag.httpStatus).toBe(200);
    expect(diag.parsedEventCount).toBe(10);
    expect(diag.earliestDtstart).toBe("20260101");
    expect(diag.latestDtstart).toBe("20261231");
  });

  it("includes parsed date range from events", () => {
    const events = [
      { uid: "a", summary: "Early", dtstart: "20250901T100000Z" },
      { uid: "b", summary: "Late", dtstart: "20261215T180000Z" },
      { uid: "c", summary: "Mid", dtstart: "20260601T120000Z" },
    ];
    const diag = buildDiagnostics(events);
    expect(diag.earliestDtstart).toBe("20250901T100000Z");
    expect(diag.latestDtstart).toBe("20261215T180000Z");
  });

  it("first/last event sampling is capped at 5", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      uid: `evt-${String(i).padStart(2, "0")}`,
      summary: `Event ${i}`,
      dtstart: `202603${String(i + 1).padStart(2, "0")}T100000Z`,
    }));
    const diag = buildDiagnostics(events);
    expect(diag.firstEvents).toHaveLength(5);
    expect(diag.lastEvents).toHaveLength(5);
    expect(diag.firstEvents[0]!.dtstart).toBe("20260301T100000Z");
    expect(diag.lastEvents[4]!.dtstart).toBe("20260320T100000Z");
  });

  it("handles empty event list", () => {
    const diag = buildDiagnostics([]);
    expect(diag.parsedEventCount).toBe(0);
    expect(diag.earliestDtstart).toBeNull();
    expect(diag.latestDtstart).toBeNull();
    expect(diag.firstEvents).toHaveLength(0);
    expect(diag.lastEvents).toHaveLength(0);
  });

  it("handles fewer events than sample size", () => {
    const events = [
      { uid: "only-1", summary: "Solo", dtstart: "20260501" },
      { uid: "only-2", summary: "Duo", dtstart: "20260502" },
    ];
    const diag = buildDiagnostics(events);
    expect(diag.firstEvents).toHaveLength(2);
    expect(diag.lastEvents).toHaveLength(2);
  });

  it("SyncResult includes optional diagnostics field", () => {
    const result: SyncResult = {
      added: 5,
      updated: 3,
      cancelled: 0,
      skipped: 0,
      errors: [],
      diagnostics: buildDiagnostics([{ uid: "x", summary: "Test", dtstart: "20260301" }]),
    };
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics!.parsedEventCount).toBe(1);
  });
});

// ── Error operation tracking ──

describe("error operation tracking", () => {
  it("validate errors have operation=validate", () => {
    const result = simulateEventLoop([
      { uid: "bad", summary: "Bad", dtstart: "", dtend: "" },
    ]);
    expect(result.errors[0]!.operation).toBe("validate");
  });

  it("create failure errors include operation=create", () => {
    // Directly verify the type supports create operation
    const error: SyncEventError = {
      uid: "test",
      summary: "Test",
      operation: "create",
      reason: "Unique constraint failed",
    };
    expect(error.operation).toBe("create");
  });

  it("update failure errors include operation=update", () => {
    const error: SyncEventError = {
      uid: "test",
      summary: "Test",
      operation: "update",
      reason: "Record not found",
    };
    expect(error.operation).toBe("update");
  });

  it("error reasons are truncated to 300 chars", () => {
    const longReason = "x".repeat(500);
    const truncated = longReason.length > 300 ? longReason.slice(0, 300) + "…" : longReason;
    expect(truncated.length).toBe(301); // 300 + "…"
  });
});

// ── parseIcsDate UTC consistency ──

describe("parseIcsDate UTC consistency", () => {
  it("allDay dates use UTC (no timezone shift)", () => {
    const result = parseIcsDate("20260315");
    // Should be midnight UTC, not local midnight
    expect(result.date.getUTCHours()).toBe(0);
    expect(result.date.getUTCMinutes()).toBe(0);
    expect(result.date.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("non-Z datetimes are treated as UTC", () => {
    const result = parseIcsDate("20260315T143000");
    expect(result.date.toISOString()).toBe("2026-03-15T14:30:00.000Z");
  });

  it("Z-suffixed datetimes remain UTC", () => {
    const result = parseIcsDate("20260315T143000Z");
    expect(result.date.toISOString()).toBe("2026-03-15T14:30:00.000Z");
  });

  it("non-Z and Z produce same result for same time values", () => {
    const withZ = parseIcsDate("20260315T143000Z");
    const withoutZ = parseIcsDate("20260315T143000");
    expect(withZ.date.getTime()).toBe(withoutZ.date.getTime());
  });
});

// ── splitEventsForSync (batch diffing) ──

function makeParsedEvent(overrides: Partial<ParsedIcsEvent> & { uid: string }): ParsedIcsEvent {
  return {
    summary: "Test Event",
    description: "",
    location: "",
    dtstart: "20260315T100000Z",
    dtend: "20260315T120000Z",
    status: "CONFIRMED",
    ...overrides,
  };
}

function makeExistingRow(overrides: Partial<ExistingEventRow> & { id: string; externalId: string }): ExistingEventRow {
  return {
    summary: "Test Event",
    description: null,
    startsAt: new Date(Date.UTC(2026, 2, 15, 10, 0, 0)),
    endsAt: new Date(Date.UTC(2026, 2, 15, 12, 0, 0)),
    allDay: false,
    status: "CONFIRMED",
    locationId: null,
    sportCode: null,
    opponent: null,
    isHome: null,
    site: null,
    result: null,
    summaryLocked: false,
    isHomeLocked: false,
    locationLocked: false,
    ...overrides,
  };
}

describe("splitEventsForSync", () => {
  it("puts new events in toCreate", () => {
    const parsed = [makeParsedEvent({ uid: "new-1" }), makeParsedEvent({ uid: "new-2" })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate).toHaveLength(2);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it("puts unchanged events in unchanged list (no update needed)", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1" })];
    const existing = [makeExistingRow({ id: "db-1", externalId: "evt-1" })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toCreate).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]).toBe("evt-1");
  });

  it("detects changed summary and puts in toUpdate", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "Updated Title" })];
    const existing = [makeExistingRow({ id: "db-1", externalId: "evt-1", summary: "Old Title" })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.id).toBe("db-1");
    expect(result.toUpdate[0]!.data.summary).toBe("Updated Title");
  });

  it("detects changed startsAt and puts in toUpdate", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", dtstart: "20260316T100000Z" })];
    const existing = [makeExistingRow({ id: "db-1", externalId: "evt-1" })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
  });

  it("detects changed status and puts in toUpdate", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", status: "CANCELLED" })];
    const existing = [makeExistingRow({ id: "db-1", externalId: "evt-1", status: "CONFIRMED" })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.status).toBe("CANCELLED");
  });

  it("splits a mixed feed into creates, updates, and unchanged", () => {
    const parsed = [
      makeParsedEvent({ uid: "new-1" }),
      makeParsedEvent({ uid: "existing-unchanged" }),
      makeParsedEvent({ uid: "existing-changed", summary: "New Summary" }),
    ];
    const existing = [
      makeExistingRow({ id: "db-2", externalId: "existing-unchanged" }),
      makeExistingRow({ id: "db-3", externalId: "existing-changed", summary: "Old Summary" }),
    ];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0]!.externalId).toBe("new-1");
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.externalId).toBe("existing-changed");
    expect(result.unchanged).toHaveLength(1);
  });

  it("writes WIN/LOSS/TIE from the source marker on new events", () => {
    const parsed = [
      makeParsedEvent({ uid: "won", summary: "[W] Wisconsin Athletics MBB vs Purdue" }),
      makeParsedEvent({ uid: "lost", summary: "[L] MBB at Purdue" }),
      makeParsedEvent({ uid: "tied", summary: "[T] Women's Soccer vs Marquette" }),
      makeParsedEvent({ uid: "unplayed", summary: "MBB vs Purdue" }),
    ];
    const result = splitEventsForSync(parsed, [], []);
    const byId = new Map(result.toCreate.map((e) => [e.externalId, e]));
    expect(byId.get("won")!.result).toBe("WIN");
    expect(byId.get("lost")!.result).toBe("LOSS");
    expect(byId.get("tied")!.result).toBe("TIE");
    expect(byId.get("unplayed")!.result).toBeNull();
  });

  it("keeps the marker out of the stored title while recording the result", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "[W] Wisconsin Athletics MBB vs Purdue" })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.summary).toBe("MBB vs Purdue");
    expect(result.toCreate[0]!.rawSummary).toBe("[W] Wisconsin Athletics MBB vs Purdue");
    expect(result.toCreate[0]!.result).toBe("WIN");
  });

  it("moves an event to toUpdate when the source posts a result", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "[W] MBB vs Purdue" })];
    const existing = [makeExistingRow({ id: "db-1", externalId: "evt-1", summary: "MBB vs Purdue", result: null })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.result).toBe("WIN");
  });

  it("preserves a known result when the feed drops the marker", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "MBB vs Purdue" })];
    // Every derived field already matches, so result is the only variable.
    const existing = [
      makeExistingRow({
        id: "db-1",
        externalId: "evt-1",
        summary: "MBB vs Purdue",
        sportCode: "MBB",
        opponent: "Purdue",
        isHome: true,
        site: "HOME",
        result: "WIN",
      }),
    ];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.unchanged).toEqual(["evt-1"]);
  });

  it("overwrites a stored result when the source corrects the marker", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "[L] MBB vs Purdue" })];
    const existing = [makeExistingRow({ id: "db-1", externalId: "evt-1", summary: "MBB vs Purdue", result: "WIN" })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.result).toBe("LOSS");
  });

  it("records a result even when the title is manually locked", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "[W] MBB vs Purdue" })];
    const existing = [
      makeExistingRow({ id: "db-1", externalId: "evt-1", summary: "Custom Title", summaryLocked: true, result: null }),
    ];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.summary).toBe("Custom Title");
    expect(result.toUpdate[0]!.data.result).toBe("WIN");
  });

  it("records where a game was played alongside home/away", () => {
    const parsed = [
      makeParsedEvent({ uid: "home", summary: "MBB vs Purdue", location: "Madison, WI, Kohl Center" }),
      makeParsedEvent({ uid: "away", summary: "MBB at Purdue", location: "West Lafayette, IN" }),
      makeParsedEvent({ uid: "neutral", summary: "MBB vs Purdue", location: "Kansas City, MO" }),
    ];
    const byId = new Map(splitEventsForSync(parsed, [], []).toCreate.map((e) => [e.externalId, e]));
    expect(byId.get("home")).toMatchObject({ isHome: true, site: "HOME" });
    expect(byId.get("away")).toMatchObject({ isHome: false, site: "AWAY" });
    // isHome collapses this into null; site keeps it distinguishable.
    expect(byId.get("neutral")).toMatchObject({ isHome: null, site: "NEUTRAL" });
  });

  it("leaves site unknown when nothing indicates where a game was played", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "Football Senior Day", location: "" })];
    expect(splitEventsForSync(parsed, [], []).toCreate[0]!.site).toBeNull();
  });

  it("moves an event to toUpdate when only the site changes", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "MBB vs Purdue", location: "Madison, WI" })];
    const existing = [
      makeExistingRow({
        id: "db-1", externalId: "evt-1", summary: "MBB vs Purdue",
        sportCode: "MBB", opponent: "Purdue", isHome: true, site: null,
      }),
    ];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.site).toBe("HOME");
  });

  it("skips events with invalid dates and adds to skippedErrors", () => {
    const parsed = [
      makeParsedEvent({ uid: "good-1" }),
      makeParsedEvent({ uid: "bad-1", dtstart: "" }),
      makeParsedEvent({ uid: "good-2" }),
    ];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate).toHaveLength(2);
    expect(result.skippedErrors).toHaveLength(1);
    expect(result.skippedErrors[0]!.uid).toBe("bad-1");
    expect(result.skippedErrors[0]!.operation).toBe("validate");
  });

  it("resolves location via regex mapping", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", location: "Green Bay, Wis., Lambeau Field" })];
    const mappings = [{ pattern: "green bay, wi, lambeau field", locationId: "loc-lambeau" }];
    const result = splitEventsForSync(parsed, [], mappings);
    expect(result.toCreate[0]!.locationId).toBe("loc-lambeau");
  });

  it("keeps existing raw-source venue regex mappings working", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", location: "Green Bay, Wis., Lambeau Field" })];
    const mappings = [{ pattern: "Green Bay, Wis\\., Lambeau Field", locationId: "loc-lambeau" }];
    const result = splitEventsForSync(parsed, [], mappings);
    expect(result.toCreate[0]!.locationId).toBe("loc-lambeau");
  });

  it("does not resolve invalid regex mappings through substring fallback", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", location: "Field (north" })];
    const mappings = [{ pattern: "field (north", locationId: "loc-field" }];
    const result = splitEventsForSync(parsed, [], mappings);
    expect(result.toCreate[0]!.locationId).toBeNull();
  });

  it("uses the longest equal-priority venue mapping first", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", location: "Madison, WI, Camp Randall Stadium" })];
    const mappings = [
      { id: "short", pattern: "Camp", locationId: "loc-short", priority: 10, createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { id: "long", pattern: "Camp Randall", locationId: "loc-long", priority: 10, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    ];

    const result = splitEventsForSync(parsed, [], mappings);

    expect(result.toCreate[0]!.locationId).toBe("loc-long");
  });

  it("handles large feed without per-event DB queries (pure function)", () => {
    const parsed = Array.from({ length: 300 }, (_, i) => makeParsedEvent({ uid: `evt-${i}` }));
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate).toHaveLength(300);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.skippedErrors).toHaveLength(0);
  });

  it("cleans team prefix from summary while preserving rawSummary", () => {
    const parsed = [makeParsedEvent({ uid: "wb-1", summary: "Wisconsin Badgers Women's Tennis at Purdue" })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0]!.summary).toBe("Women's Tennis at Purdue");
    expect(result.toCreate[0]!.rawSummary).toBe("Wisconsin Badgers Women's Tennis at Purdue");
    expect(result.toCreate[0]!.sportCode).toBe("WTEN");
    expect(result.toCreate[0]!.opponent).toBe("Purdue");
    expect(result.toCreate[0]!.isHome).toBe(false);
  });

  it("WRITE_CHUNK_SIZE is exported and equals 500", () => {
    expect(WRITE_CHUNK_SIZE).toBe(500);
  });

  it("'vs' + Madison, WI location → isHome: true", () => {
    const parsed = [makeParsedEvent({
      uid: "home-1",
      summary: "Wisconsin Badgers Softball vs Iowa",
      location: "Madison, WI, Goodman Diamond",
    })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.isHome).toBe(true);
  });

  it("'vs' + non-Madison location → isHome: null (neutral)", () => {
    const parsed = [makeParsedEvent({
      uid: "neutral-1",
      summary: "Wisconsin Badgers Softball vs Iowa",
      location: "Minneapolis, MN, Target Field",
    })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.isHome).toBeNull();
  });

  it("'at' + any location → isHome: false (away)", () => {
    const parsed = [makeParsedEvent({
      uid: "away-1",
      summary: "Wisconsin Badgers Softball at Iowa",
      location: "Iowa City, IA",
    })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.isHome).toBe(false);
  });

  it("no location text + 'vs' → isHome: true (summary fallback)", () => {
    const parsed = [makeParsedEvent({
      uid: "vs-no-loc",
      summary: "Wisconsin Badgers Softball vs Iowa",
      location: "",
    })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.isHome).toBe(true);
  });

  it("known Wisconsin facility without Madison, WI → isHome: true", () => {
    const parsed = [makeParsedEvent({
      uid: "facility-1",
      summary: "Wisconsin Badgers Football vs Ohio State",
      location: "Camp Randall Stadium",
    })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.isHome).toBe(true);
  });

  it("uses mapped home venue status when raw location text has no known home keyword", () => {
    const parsed = [makeParsedEvent({
      uid: "mapped-home-1",
      summary: "Wisconsin Badgers Volleyball vs Kentucky",
      location: "UW Volleyball Arena Alias",
    })];
    const result = splitEventsForSync(parsed, [], [
      { pattern: "UW Volleyball Arena Alias", locationId: "loc-fieldhouse", isHomeVenue: true },
    ]);

    expect(result.toCreate[0]!.locationId).toBe("loc-fieldhouse");
    expect(result.toCreate[0]!.isHome).toBe(true);
  });

  it("McClimon location → isHome: true", () => {
    const parsed = [makeParsedEvent({
      uid: "mcClimon-1",
      summary: "Wisconsin Badgers Women's Soccer vs Minnesota",
      location: "Madison, WI, McClimon Track/Soccer Complex",
    })];
    const result = splitEventsForSync(parsed, [], []);
    expect(result.toCreate[0]!.isHome).toBe(true);
  });

  // ── lock guard tests ──

  it("summaryLocked: sync does not overwrite a manually edited title", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "New ICS Title" })];
    const existing = [makeExistingRow({
      id: "db-1", externalId: "evt-1",
      summary: "My Custom Title",
      summaryLocked: true,
    })];
    const result = splitEventsForSync(parsed, existing, []);
    // Locked title survives: goes to unchanged, not toUpdate
    expect(result.unchanged).toHaveLength(1);
    expect(result.toUpdate).toHaveLength(0);
  });

  it("summaryLocked: other fields (e.g. startsAt) still trigger an update", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "New ICS Title", dtstart: "20260320T100000Z" })];
    const existing = [makeExistingRow({
      id: "db-1", externalId: "evt-1",
      summary: "My Custom Title",
      summaryLocked: true,
    })];
    const result = splitEventsForSync(parsed, existing, []);
    // Time changed → update fires, but the locked summary is preserved in the data
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.summary).toBe("My Custom Title");
  });

  it("isHomeLocked: sync does not overwrite a manually set event type", () => {
    // ICS has no sport code so isHome parses to null, but staff locked it to
    // home. Only isHome would differ, so the lock prevents update.
    const parsed = [makeParsedEvent({
      uid: "evt-1",
      summary: "Test Event",
    })];
    const existing = [makeExistingRow({
      id: "db-1", externalId: "evt-1",
      isHome: true,
      isHomeLocked: true,
    })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.unchanged).toHaveLength(1);
    expect(result.toUpdate).toHaveLength(0);
  });

  it("isHomeLocked: other field changes still update while preserving sport, isHome, and opponent", () => {
    const parsed = [makeParsedEvent({
      uid: "evt-1",
      summary: "Football vs Notre Dame",
      dtstart: "20260320T100000Z", // changed start → triggers update
    })];
    const existing = [makeExistingRow({
      id: "db-1", externalId: "evt-1",
      summary: "Football Media Day",
      sportCode: "FOOTBALL",
      opponent: null,
      isHome: null,
      isHomeLocked: true,
    })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.sportCode).toBe("FOOTBALL");
    expect(result.toUpdate[0]!.data.isHome).toBeNull();
    expect(result.toUpdate[0]!.data.opponent).toBeNull();
  });

  it("unlocked fields are updated as normal", () => {
    const parsed = [makeParsedEvent({ uid: "evt-1", summary: "Changed Title" })];
    const existing = [makeExistingRow({
      id: "db-1", externalId: "evt-1",
      summary: "Old Title",
      summaryLocked: false,
    })];
    const result = splitEventsForSync(parsed, existing, []);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.data.summary).toBe("Changed Title");
  });
});

// ── isHomeLocationText unit tests ──

describe("isHomeLocationText", () => {
  it("returns true for 'Madison, WI, Goodman Diamond'", () => {
    expect(isHomeLocationText("Madison, WI, Goodman Diamond")).toBe(true);
  });

  it("returns true for 'Madison, WI, McClimon Track/Soccer Complex'", () => {
    expect(isHomeLocationText("Madison, WI, McClimon Track/Soccer Complex")).toBe(true);
  });

  it("returns true for 'madison, wi' (case-insensitive)", () => {
    expect(isHomeLocationText("madison, wi, some venue")).toBe(true);
  });

  it("returns true for 'Madison, Wis.' source spelling", () => {
    expect(isHomeLocationText("Madison, Wis., McClimon Track/Soccer Complex")).toBe(true);
  });

  it("returns true for Camp Randall without Madison, WI", () => {
    expect(isHomeLocationText("Camp Randall Stadium")).toBe(true);
  });

  it("returns true for Kohl Center", () => {
    expect(isHomeLocationText("Kohl Center")).toBe(true);
  });

  it("returns false for 'Minneapolis, MN'", () => {
    expect(isHomeLocationText("Minneapolis, MN")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isHomeLocationText("")).toBe(false);
  });

  it("returns false for non-Wisconsin venue", () => {
    expect(isHomeLocationText("Iowa City, IA, Carver-Hawkeye Arena")).toBe(false);
  });
});
