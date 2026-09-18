import { describe, expect, it } from "vitest";
import {
  NONE_SPORT_VALUE,
  createManualEventDraft,
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
