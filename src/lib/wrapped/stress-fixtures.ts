import { buildPersonCards, buildTeamCards, type WrappedGame, type WrappedPersonInput, type WrappedRecap } from "@/lib/wrapped/recap";

/** Synthetic extremes for the Wrapped dev lab and stress tests; no database needed. */

export const WRAPPED_SCENARIOS = ["nothing", "one-shift", "checkouts-only", "huge", "long-text", "collaborator"] as const;
export type WrappedScenario = (typeof WRAPPED_SCENARIOS)[number];

const SPORTS = ["FB", "MBB", "WBB", "VB", "MHKY", "WHKY", "WSOC", "SB", "WRES", "MSWIM", "WTRACK", "MXC"];
const ME = { userId: "me", name: "Bucky Badger" };

function mate(n: number, name = `Teammate ${n}`) {
  return { userId: `u${n}`, name };
}

function makeGame(n: number, overrides: Partial<WrappedGame> = {}): WrappedGame {
  return {
    eventId: `g${n}`,
    title: `Event ${n}`,
    startsAt: new Date(Date.UTC(2026, 7, 20 + (n % 100), 18 + (n % 5))),
    sportCode: SPORTS[n % SPORTS.length]!,
    opponent: `Opponent ${n}`,
    site: n % 3 === 0 ? "AWAY" : "HOME",
    venue: n % 3 === 0 ? `Road Venue ${n % 7}` : "Camp Randall Stadium",
    result: n % 4 === 0 ? "LOSS" : "WIN",
    official: true,
    crew: [ME, mate(n % 9), mate((n + 3) % 9)],
    ...overrides,
  };
}

function person(overrides: Partial<WrappedPersonInput> = {}): WrappedPersonInput {
  return {
    user: { id: "me", name: "Bucky Badger", avatarUrl: null, primaryArea: "PHOTO", role: "STUDENT" },
    games: [],
    avatars: new Map(Array.from({ length: 9 }, (_, n) => [`u${n}`, null] as const)),
    shiftHours: 0,
    travelTrips: 0,
    checkouts: [],
    tradesPicked: 0,
    badges: [],
    ...overrides,
  };
}

function checkout(n: number, label = `Sony FX3 #${n % 4}`) {
  const due = new Date(Date.UTC(2026, 8, 1 + (n % 80), 22));
  return {
    endsAt: due,
    completedAt: new Date(due.getTime() - (n % 5 === 0 ? -3_600_000 : 3_600_000)),
    items: [{ label, category: "Cameras" }, { label: `Battery ${n % 6}`, category: "Batteries" }],
  };
}

export function wrappedScenario(name: WrappedScenario): WrappedRecap {
  let input = person();
  let teamGames: WrappedGame[] = [];
  let teamCheckouts = 0;
  let badges = 0;
  switch (name) {
    case "nothing":
      teamGames = [];
      break;
    case "one-shift":
      input = person({ games: [makeGame(1, { crew: [ME] })], shiftHours: 0.5 });
      teamGames = input.games;
      break;
    case "checkouts-only":
      input = person({ checkouts: Array.from({ length: 3 }, (_, n) => checkout(n)) });
      break;
    case "huge": {
      const games = Array.from({ length: 220 }, (_, n) => makeGame(n));
      input = person({
        games,
        shiftHours: 999.6,
        travelTrips: 41,
        checkouts: Array.from({ length: 480 }, (_, n) => checkout(n)),
        tradesPicked: 37,
        badges: Array.from({ length: 12 }, (_, n) => ({ name: `Badge ${n}`, awardedAt: new Date(Date.UTC(2026, 8, 1 + n)) })),
      });
      teamGames = games;
      teamCheckouts = 12_345;
      badges = 678;
      break;
    }
    case "long-text": {
      const longName = "Maximilian Alexander Bartholomew-Featherstonehaugh III";
      const games = Array.from({ length: 6 }, (_, n) => makeGame(n, {
        title: "Wisconsin Badgers Men's Hockey vs Minnesota Golden Gophers Border Battle Series Game 2 (Special Broadcast)",
        venue: "Kohl Center, 601 W Dayton St, Madison, WI 53715, Third Floor Press Level Broadcast Suite",
        crew: [ME, { userId: "u1", name: longName }, mate(2)],
      }));
      input = person({
        user: { id: "me", name: longName, avatarUrl: null, primaryArea: "LIVE_PRODUCTION", role: "STUDENT" },
        games,
        shiftHours: 31,
        checkouts: [checkout(1, "Sony FX6 Full-Frame Cinema Line Camera with 24-70mm f/2.8 GM II Lens Kit")],
        badges: [{ name: "The Very Long Badge Name That Keeps Going", awardedAt: new Date(Date.UTC(2026, 9, 1)) }],
      });
      teamGames = games;
      break;
    }
    case "collaborator":
      input = person({ user: { id: "me", name: "Casey Collab", avatarUrl: null, primaryArea: null, role: "COLLABORATOR" } });
      teamGames = Array.from({ length: 5 }, (_, n) => makeGame(n));
      teamCheckouts = 40;
      break;
  }
  const cards = input.user.role === "COLLABORATOR" ? [] : buildPersonCards(input);
  return {
    version: 1,
    seasonKey: "2026-fall",
    windowLabel: "July to November 2026",
    generatedAt: "2026-11-30T12:00:00.000Z",
    person: { userId: input.user.id, name: input.user.name, avatarUrl: null },
    cards,
    team: buildTeamCards({ games: teamGames, checkouts: teamCheckouts, badgesAwarded: badges }),
  };
}
