import { describe, expect, it } from "vitest";
import { scheduleEventTitleParts } from "@/app/(app)/schedule/_components/types";

describe("scheduleEventTitleParts", () => {
  it("removes Wisconsin Athletics source prefixes from fallback summaries", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Wisconsin Athletics Women's Soccer vs North Dakota State",
        sportCode: null,
        opponent: null,
        isHome: null,
      }),
    ).toEqual({
      title: "Women's Soccer vs North Dakota State",
      detail: null,
    });
  });

  it("keeps structured sport matchups clean", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Wisconsin Athletics Men's Soccer vs Drake",
        sportCode: "MSOC",
        opponent: "Drake",
        isHome: true,
      }),
    ).toEqual({
      title: "Men's Soccer vs Drake",
      detail: null,
    });
  });

  it("corrects legacy abbreviated opponent casing", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Wisconsin Athletics Women's Soccer vs Tcu",
        sportCode: "WSOC",
        opponent: "Tcu",
        isHome: true,
      }),
    ).toEqual({
      title: "Women's Soccer vs TCU",
      detail: null,
    });
  });

  it("uses neutral-site location as the secondary line for structured games", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Wisconsin Athletics Volleyball vs Kentucky",
        sportCode: "VB",
        opponent: "Kentucky",
        isHome: null,
        location: { id: "fiserv", name: "Fiserv Forum" },
      }),
    ).toEqual({
      title: "Volleyball vs Kentucky",
      detail: "Fiserv Forum",
    });
  });

  it("keeps dash qualifiers as the secondary line before neutral location", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Wisconsin Athletics Football vs Notre Dame",
        sportCode: "FB",
        opponent: "Notre Dame - Shamrock Series",
        isHome: null,
        location: { id: "lambeau", name: "Lambeau Field" },
      }),
    ).toEqual({
      title: "Football vs Notre Dame",
      detail: "Shamrock Series",
    });
  });

  it("pulls a promotion qualifier out of the summary when the opponent is clean", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Volleyball vs Marquette- White Out",
        sportCode: "VB",
        opponent: "Marquette",
        isHome: true,
      }),
    ).toEqual({
      title: "Volleyball vs Marquette",
      detail: "White Out",
    });
  });

  it("uses the canonical Schedule site when the legacy boolean disagrees", () => {
    expect(
      scheduleEventTitleParts({
        summary: "Wisconsin Athletics Football vs Notre Dame",
        sportCode: "FB",
        opponent: "Notre Dame",
        isHome: true,
        site: "AWAY",
      }),
    ).toEqual({
      title: "Football at Notre Dame",
      detail: null,
    });
  });
});
