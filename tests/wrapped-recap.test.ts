import { describe, expect, it } from "vitest";
import {
  buildPersonCards,
  buildTeamCards,
  buildWelcomeCard,
  longestOnTimeStreak,
  WRAPPED_UNLOCK_AT,
  WRAPPED_WINDOW_END,
  WRAPPED_WINDOW_START,
  wrappedArchetype,
  type WrappedGame,
  type WrappedPersonInput,
} from "@/lib/wrapped/recap";

const ME = { userId: "me", name: "Bucky Badger" };
const JO = { userId: "jo", name: "Jordan Lee" };
const SAM = { userId: "sam", name: "Sam Ortiz" };

function game(overrides: Partial<WrappedGame> & { day: number }): WrappedGame {
  const { day, ...rest } = overrides;
  return {
    eventId: `g${day}`,
    title: `Game ${day}`,
    // 1pm Central on day N of September.
    startsAt: new Date(Date.UTC(2026, 8, day, 18)),
    sportCode: "FB",
    opponent: "Rival",
    site: "HOME",
    venue: "Camp Randall Stadium",
    result: "WIN",
    official: true,
    crew: [ME, JO],
    ...rest,
  };
}

function input(overrides: Partial<WrappedPersonInput> = {}): WrappedPersonInput {
  return {
    user: { id: "me", name: "Bucky Badger", avatarUrl: null, primaryArea: "PHOTO", role: "STUDENT" },
    games: [],
    avatars: new Map([["jo", null], ["sam", null]]),
    shiftHours: 0,
    travelTrips: 0,
    checkouts: [],
    tradesPicked: 0,
    badges: [],
    ...overrides,
  };
}

function ids(cards: { id: string }[]) {
  return cards.map((card) => card.id);
}

describe("Wrapped window", () => {
  it("covers Jul 1 through Nov 30 in Central time and unlocks Dec 1", () => {
    expect(WRAPPED_WINDOW_START.toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(WRAPPED_WINDOW_END.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(WRAPPED_UNLOCK_AT).toEqual(WRAPPED_WINDOW_END);
  });
});

describe("buildPersonCards", () => {
  it("gives nothing to someone with no events and no checkouts", () => {
    expect(buildPersonCards(input({ games: [game({ day: 1, crew: [JO] })] }))).toEqual([]);
  });

  it("opens someone with nothing personal on a cover that hands off to the team", () => {
    const card = buildWelcomeCard({ name: "Bucky Badger", primaryArea: "PHOTO" });
    expect(card.layout).toBe("cover");
    expect(card.value).toBe("Bucky's fall in Creative");
    expect(card.sentence).toBe("Photo crew. Your story starts with your first event. Here's the team's fall.");
    expect(buildWelcomeCard({ name: "Pat", primaryArea: null }).sentence).toBe("Your story starts with your first event. Here's the team's fall.");
  });

  it("says a whole number of days without calling it more", () => {
    const sentence = (shiftHours: number) => buildPersonCards(input({ games: [game({ day: 5 })], shiftHours })).find((card) => card.id === "hours")!.sentence;
    expect(sentence(48)).toBe("That's 2 full days of call time.");
    expect(sentence(50)).toBe("That's more than 2 full days of call time.");
    expect(sentence(24)).toBe("That's 1 full day of call time.");
  });

  it("tells a short story for a light fall and always ends on style and summary", () => {
    const cards = buildPersonCards(input({ games: [game({ day: 5 })] }));
    expect(ids(cards)).toEqual(["cover", "events", "sport", "style", "summary"]);
    expect(cards[0]!.value).toBe("Bucky's fall in Creative");
    expect(cards[1]!.sentence).toBe("It started with Game 5 on Sep 5.");
    expect(cards.at(-2)!.value).toBe("Fresh Face");
  });

  it("only counts games the person crewed", () => {
    const cards = buildPersonCards(input({ games: [game({ day: 1 }), game({ day: 2, crew: [JO] })] }));
    expect(cards.find((card) => card.id === "events")!.countTo).toBe(1);
  });

  it("names the crewmates worked with most, ignoring one-offs", () => {
    const games = [
      game({ day: 1, crew: [ME, JO, SAM] }),
      game({ day: 2, crew: [ME, JO] }),
      game({ day: 3, crew: [ME, JO] }),
    ];
    const crew = buildPersonCards(input({ games })).find((card) => card.id === "crew")!;
    expect(crew.sentence).toBe("You and Jordan worked 3 events together.");
    expect(crew.items!.map((item) => item.userId)).toEqual(["jo"]);
  });

  it("shows the lucky-charm record only when it beats or matches the team", () => {
    const winning = [1, 2, 3, 4].map((day) => game({ day }));
    const losingElsewhere = [5, 6, 7].map((day) => game({ day, crew: [JO], result: "LOSS" }));
    const card = buildPersonCards(input({ games: [...winning, ...losingElsewhere] })).find((c) => c.id === "record")!;
    expect(card.value).toBe("4–0");
    expect(card.sentence).toContain("better than the 4–3 overall");

    const losing = [1, 2, 3, 4].map((day) => game({ day, result: "LOSS" }));
    const others = [5, 6].map((day) => game({ day, crew: [JO], result: "WIN" }));
    expect(ids(buildPersonCards(input({ games: [...losing, ...others] })))).not.toContain("record");
  });

  it("never counts exhibitions in the record", () => {
    const games = [1, 2, 3, 4].map((day) => game({ day, official: day !== 4 }));
    expect(ids(buildPersonCards(input({ games })))).not.toContain("record");
  });

  it("only celebrates returns and never mentions late ones", () => {
    const due = new Date("2026-09-10T22:00:00Z");
    const early = new Date("2026-09-10T20:00:00Z");
    const late = new Date("2026-09-11T20:00:00Z");
    const checkouts = [
      { endsAt: due, completedAt: early, items: [{ label: "Sony FX3", category: "Cameras" }] },
      { endsAt: due, completedAt: late, items: [{ label: "Sony FX3", category: "Cameras" }] },
      { endsAt: due, completedAt: early, items: [{ label: "Canon R5", category: "Cameras" }] },
    ];
    const cards = buildPersonCards(input({ checkouts }));
    const gear = cards.find((card) => card.id === "gear")!;
    expect(gear.sentence).toBe("Your ride or die: Sony FX3, 2 times.");
    const handoffs = cards.find((card) => card.id === "handoffs")!;
    expect(handoffs.value).toBe("2");
    expect(JSON.stringify(cards).toLowerCase()).not.toMatch(/late|overdue/);
  });

  it("finds the busiest week only when it has more than one event", () => {
    const one = buildPersonCards(input({ games: [game({ day: 1 }), game({ day: 15 })] }));
    expect(ids(one)).not.toContain("busiest-week");
    // Sep 7 2026 is a Monday.
    const busy = buildPersonCards(input({ games: [7, 9, 11].map((day) => game({ day })) }));
    const week = busy.find((card) => card.id === "busiest-week")!;
    expect(week.value).toBe("Sep 7 to Sep 13");
    expect(week.sentence).toContain("3 events in 7 days");
  });

  it("never ranks events without a sport as a sport", () => {
    const games = [1, 2, 3, 4, 5].map((day) => game({ day, sportCode: null }));
    const cards = buildPersonCards(input({ games }));
    expect(ids(cards)).not.toContain("sport");
    expect(JSON.stringify(cards)).not.toContain("Other");
    expect(cards.find((card) => card.id === "style")!.value).toBe("Team Player");
  });

  it("puts at most four stats on the summary card", () => {
    const cards = buildPersonCards(input({
      games: [1, 2, 3].map((day) => game({ day })),
      shiftHours: 12.4,
      checkouts: [{ endsAt: new Date("2026-09-10T22:00:00Z"), completedAt: null, items: [] }],
    }));
    const summary = cards.at(-1)!;
    expect(summary.layout).toBe("summary");
    expect(summary.items!.map((item) => item.label)).toEqual(["Events", "Top sport", "Hours", "Checkouts"]);
  });
});

describe("wrappedArchetype", () => {
  const base = { events: 10, awayGames: 0, sports: 1, topSport: null, nightGames: 0, checkouts: 0 };
  it("checks rules in priority order", () => {
    expect(wrappedArchetype({ ...base, awayGames: 5 }).id).toBe("road-warrior");
    expect(wrappedArchetype({ ...base, checkouts: 12 }).id).toBe("gear-whisperer");
    expect(wrappedArchetype({ ...base, sports: 4 }).id).toBe("utility-player");
    expect(wrappedArchetype({ ...base, nightGames: 6 }).id).toBe("night-owl");
    expect(wrappedArchetype({ ...base, topSport: { label: "Volleyball", count: 8 } }).title).toBe("Volleyball Regular");
    expect(wrappedArchetype({ ...base, events: 16 }).id).toBe("iron-crew");
    expect(wrappedArchetype({ ...base, events: 2 }).id).toBe("fresh-face");
    expect(wrappedArchetype(base).id).toBe("team-player");
  });
});

describe("longestOnTimeStreak", () => {
  it("counts consecutive on-time returns in return order and skips open checkouts", () => {
    const due = new Date("2026-10-01T22:00:00Z");
    const on = (iso: string) => ({ endsAt: due, completedAt: new Date(iso), items: [] });
    const late = { endsAt: new Date("2026-09-01T00:00:00Z"), completedAt: new Date("2026-09-15T00:00:00Z"), items: [] };
    expect(longestOnTimeStreak([
      on("2026-09-20T00:00:00Z"),
      late,
      on("2026-09-01T00:00:00Z"),
      on("2026-09-02T00:00:00Z"),
      { endsAt: due, completedAt: null, items: [] },
    ])).toBe(2);
  });
});

describe("buildTeamCards", () => {
  it("summarizes covered games and names the biggest crew", () => {
    const cards = buildTeamCards({
      games: [game({ day: 1 }), game({ day: 2, crew: [ME, JO, SAM], title: "Homecoming" }), game({ day: 3, crew: [] })],
      checkouts: 40,
      badgesAwarded: 3,
    });
    expect(ids(cards)).toEqual(["team-events", "team-record", "team-biggest", "team-numbers"]);
    expect(cards[0]!.sentence).toBe("Events covered by 3 people.");
    expect(cards[1]!.value).toBe("2–0");
    expect(cards[2]!.sentence).toBe("Homecoming on Sep 2.");
  });

  it("skips the biggest-crew card when nobody worked together", () => {
    const cards = buildTeamCards({ games: [game({ day: 1, crew: [ME] })], checkouts: 0, badgesAwarded: 0 });
    expect(ids(cards)).not.toContain("team-biggest");
  });

  it("is empty when nobody worked anything", () => {
    expect(buildTeamCards({ games: [game({ day: 1, crew: [] })], checkouts: 0, badgesAwarded: 0 })).toEqual([]);
  });
});

describe("client-safe Wrapped dates", () => {
  it("unlock in the client matches the server's app-timezone unlock", async () => {
    const { WRAPPED_UNLOCK_ISO, wrappedPromoState } = await import("@/lib/wrapped/dates");
    expect(WRAPPED_UNLOCK_ISO).toBe(WRAPPED_UNLOCK_AT.toISOString());
    expect(wrappedPromoState(new Date("2026-11-20T12:00:00Z"), "STUDENT")).toBe("hidden");
    expect(wrappedPromoState(new Date("2026-10-24T12:00:00Z"), "ADMIN")).toBe("hidden");
    expect(wrappedPromoState(new Date("2026-11-20T12:00:00Z"), "ADMIN")).toBe("preview");
    expect(wrappedPromoState(new Date("2026-12-01T06:00:00Z"), "STUDENT")).toBe("open");
    expect(wrappedPromoState(new Date("2026-12-05T12:00:00Z"), "COLLABORATOR")).toBe("hidden");
    expect(wrappedPromoState(new Date("2027-01-20T12:00:00Z"), "ADMIN")).toBe("hidden");
  });
});
