import { describe, expect, it } from "vitest";
import {
  NONE_SPORT_VALUE,
  buildCreatedEventWindow,
  buildEventDraftDateTime,
  createManualEventDraft,
  eventDraftDate,
  eventDraftTime,
  emptyEventEditorDraft,
  gameTitleIsNotMatchup,
  suggestedEventEditorTitle,
} from "@/lib/event-editor";

describe("createManualEventDraft", () => {
  it("opens on today as a Home game", () => {
    const now = new Date(2026, 8, 18, 15, 30);
    const draft = createManualEventDraft(now);
    expect(draft.eventType).toBe("home");
    expect(draft.startDate?.toDateString()).toBe(now.toDateString());
    expect(draft.endDate?.toDateString()).toBe(now.toDateString());
    expect(draft.startTime).toBe("09:00");
    expect(draft.endTime).toBe("17:00");
  });
});

describe("suggestedEventEditorTitle", () => {
  it("names home, away, and neutral games from the sport label", () => {
    const base = createManualEventDraft();
    expect(suggestedEventEditorTitle({
      ...base,
      sportCode: "MBB",
      opponent: "Duke",
      eventType: "home",
    })).toBe("Men's Basketball vs Duke");
    expect(suggestedEventEditorTitle({
      ...base,
      sportCode: "FB",
      opponent: "Ohio State",
      eventType: "away",
    })).toBe("Football at Ohio State");
    expect(suggestedEventEditorTitle({
      ...base,
      sportCode: "WBB",
      opponent: "Iowa",
      eventType: "neutral",
    })).toBe("Women's Basketball vs Iowa (Neutral)");
  });

  it("uses the sport label alone for non-game work", () => {
    const draft = createManualEventDraft();
    expect(suggestedEventEditorTitle({
      ...draft,
      eventType: "non-game",
      sportCode: "VB",
    })).toBe("Volleyball");
    expect(suggestedEventEditorTitle({
      ...draft,
      eventType: "home",
      sportCode: NONE_SPORT_VALUE,
      opponent: "Duke",
    })).toBe("");
  });
});

describe("gameTitleIsNotMatchup", () => {
  const base = { ...emptyEventEditorDraft(), eventType: "home" as const };
  it("flags a game title without vs or at", () => {
    expect(gameTitleIsNotMatchup({ ...base, title: "Football Official Visit" })).toBe(true);
  });
  it("accepts matchups, blanks, and non-game events", () => {
    expect(gameTitleIsNotMatchup({ ...base, title: "Football vs Iowa" })).toBe(false);
    expect(gameTitleIsNotMatchup({ ...base, title: "Football at Iowa" })).toBe(false);
    expect(gameTitleIsNotMatchup({ ...base, title: "" })).toBe(false);
    expect(gameTitleIsNotMatchup({ ...base, eventType: "non-game", title: "Official Visit" })).toBe(false);
  });
});

describe("event draft dates and times", () => {
  // Tests run in America/Chicago (see vitest.config.ts).
  const oct31 = new Date(2026, 9, 31);

  it("stores all-day events as UTC midnights with an exclusive end, and reads them back as the same days", () => {
    const startsAt = buildEventDraftDateTime(oct31, "09:00", true, false);
    const endsAt = buildEventDraftDateTime(oct31, "17:00", true, true);

    expect(startsAt).toBe("2026-10-31T00:00:00.000Z");
    expect(endsAt).toBe("2026-11-01T00:00:00.000Z");
    expect(eventDraftDate(startsAt!, true, false).toDateString()).toBe(oct31.toDateString());
    expect(eventDraftDate(endsAt!, true, true).toDateString()).toBe(oct31.toDateString());
  });

  it("stores timed events at the chosen Chicago wall time, across the DST change", () => {
    expect(buildEventDraftDateTime(oct31, "13:30", false, false)).toBe("2026-10-31T18:30:00.000Z");
    // Nov 1, 2026 falls back to CST (UTC-6).
    expect(buildEventDraftDateTime(new Date(2026, 10, 1), "13:30", false, false)).toBe("2026-11-01T19:30:00.000Z");
    expect(eventDraftTime("2026-11-01T19:30:00.000Z")).toBe("13:30");
    expect(eventDraftDate("2026-10-31T18:30:00.000Z", false, false).toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });

  it("needs both dates, and rounds timed windows up to the quarter hour", () => {
    const draft = { ...createManualEventDraft(oct31), startTime: "13:05", endTime: "15:46" };

    expect(buildCreatedEventWindow({ ...draft, endDate: undefined })).toEqual({ startsAt: null, endsAt: null });
    expect(buildCreatedEventWindow(draft)).toEqual({ startsAt: "2026-10-31T18:15:00.000Z", endsAt: "2026-10-31T21:00:00.000Z" });
    expect(buildCreatedEventWindow({ ...draft, allDay: true })).toEqual({ startsAt: "2026-10-31T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" });
  });
});
