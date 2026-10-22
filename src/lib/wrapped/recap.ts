import type { CalendarEventResult, CalendarEventSite, Role, ShiftArea } from "@prisma/client";
import { env } from "@/lib/env";
import { appTzHour, startOfAppWeek, startOfDayInAppTz } from "@/lib/app-time";
import { recordLabel } from "@/lib/scoreboard-digest";
import { sportLabel } from "@/lib/sports";

/**
 * Creative Wrapped: a tap-through story about one person's fall, built only
 * from durable facts. Everything here is pure so each card's skip rule and
 * wording can be tested without a database.
 */

export const WRAPPED_SEASON_KEY = "2026-fall";
export const WRAPPED_WINDOW_START = startOfDayInAppTz(new Date("2026-07-01T12:00:00.000Z"));
/** Exclusive end, and the unlock: midnight December 1 in the app timezone. */
export const WRAPPED_WINDOW_END = startOfDayInAppTz(new Date("2026-12-01T12:00:00.000Z"));
export const WRAPPED_UNLOCK_AT = WRAPPED_WINDOW_END;
export const WRAPPED_WINDOW_LABEL = "July to November 2026";
export const WRAPPED_RECAP_VERSION = 1;

export type WrappedTone = "red" | "blue" | "green" | "gold" | "violet" | "ink";
export type WrappedLayout = "cover" | "stat" | "list" | "people" | "summary";

export type WrappedCardItem = {
  label: string;
  value: string;
  userId?: string;
  avatarUrl?: string | null;
  /** 0 to 1, for a bar relative to the first item. */
  share?: number;
};

export type WrappedCard = {
  id: string;
  layout: WrappedLayout;
  tone: WrappedTone;
  eyebrow: string;
  value: string;
  /** When set, players count up to this number instead of showing `value` at once. */
  countTo?: number;
  sentence: string;
  items?: WrappedCardItem[];
};

export type WrappedRecap = {
  version: number;
  seasonKey: string;
  windowLabel: string;
  generatedAt: string;
  person: { userId: string; name: string; avatarUrl: string | null };
  /** Empty when the person has nothing to recap; they still get the team cards. */
  cards: WrappedCard[];
  team: WrappedCard[];
};

export type WrappedGame = {
  eventId: string;
  title: string;
  startsAt: Date;
  sportCode: string | null;
  opponent: string | null;
  site: CalendarEventSite | null;
  venue: string | null;
  result: CalendarEventResult | null;
  official: boolean;
  /** People who worked it: still on crew and not marked absent. */
  crew: { userId: string; name: string }[];
};

export type WrappedCheckout = {
  endsAt: Date;
  completedAt: Date | null;
  items: { label: string; category: string | null }[];
};

export type WrappedPersonInput = {
  user: { id: string; name: string; avatarUrl: string | null; primaryArea: ShiftArea | null; role: Role };
  /** Every team game in the window; the person's games are the ones they crewed. */
  games: WrappedGame[];
  avatars: Map<string, string | null>;
  shiftHours: number;
  travelTrips: number;
  checkouts: WrappedCheckout[];
  tradesPicked: number;
  badges: { name: string; awardedAt: Date }[];
};

export type WrappedTeamInput = {
  games: WrappedGame[];
  checkouts: number;
  badgesAwarded: number;
};

type Record3 = { wins: number; losses: number; ties: number };

const AREA_LABELS: Record<ShiftArea, string> = {
  VIDEO: "Video",
  PHOTO: "Photo",
  GRAPHICS: "Graphics",
  SOCIAL: "Social",
  COMMS: "Comms",
  LIVE_PRODUCTION: "Live production",
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: env.appTimezone, month: "short", day: "numeric" }).format(date);
}

function gameSportLabel(game: Pick<WrappedGame, "sportCode">): string {
  return game.sportCode ? sportLabel(game.sportCode) : "Other";
}

function record(games: WrappedGame[]): Record3 {
  const out: Record3 = { wins: 0, losses: 0, ties: 0 };
  for (const game of games) {
    if (!game.official) continue;
    if (game.result === "WIN") out.wins += 1;
    else if (game.result === "LOSS") out.losses += 1;
    else if (game.result === "TIE") out.ties += 1;
  }
  return out;
}

function decided(rec: Record3): number {
  return rec.wins + rec.losses + rec.ties;
}

/** A tie counts as half a win, matching the Scoreboard. */
function winRate(rec: Record3): number | null {
  const total = decided(rec);
  return total === 0 ? null : (rec.wins + rec.ties / 2) / total;
}

function countBy<T>(rows: T[], key: (row: T) => string | null): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ key: value, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function busiestWeek(games: WrappedGame[]): { start: Date; count: number } | null {
  const weeks = new Map<number, number>();
  for (const game of games) {
    const start = startOfAppWeek(game.startsAt).getTime();
    weeks.set(start, (weeks.get(start) ?? 0) + 1);
  }
  let best: { start: Date; count: number } | null = null;
  for (const [start, count] of weeks) {
    if (!best || count > best.count || (count === best.count && start < best.start.getTime())) {
      best = { start: new Date(start), count };
    }
  }
  return best && best.count >= 2 ? best : null;
}

function weekLabel(start: Date): string {
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  return `${shortDate(start)} to ${shortDate(end)}`;
}

/** Longest run of on-time returns, in the order they came back. */
export function longestOnTimeStreak(checkouts: WrappedCheckout[]): number {
  const returned = checkouts
    .filter((checkout): checkout is WrappedCheckout & { completedAt: Date } => checkout.completedAt !== null)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  let best = 0;
  let run = 0;
  for (const checkout of returned) {
    run = checkout.completedAt.getTime() <= checkout.endsAt.getTime() ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export type WrappedArchetype = { id: string; title: string; sentence: string };

export type WrappedArchetypeSignals = {
  events: number;
  awayGames: number;
  sports: number;
  topSport: { label: string; count: number } | null;
  nightGames: number;
  checkouts: number;
};

/** First matching rule wins, so the order is the personality's priority. */
export function wrappedArchetype(signals: WrappedArchetypeSignals): WrappedArchetype {
  const { events, awayGames, sports, topSport, nightGames, checkouts } = signals;
  if (awayGames >= 3 && awayGames / Math.max(events, 1) >= 0.4) {
    return { id: "road-warrior", title: "Road Warrior", sentence: "Bags packed, batteries charged. You went where the team went." };
  }
  if (checkouts >= 8 && checkouts >= events) {
    return { id: "gear-whisperer", title: "Gear Whisperer", sentence: "The cage knows you by name. So does every lens in it." };
  }
  if (sports >= 4) {
    return { id: "utility-player", title: "Utility Player", sentence: `${sports} sports and you made it look easy.` };
  }
  if (events >= 4 && nightGames / events >= 0.5) {
    return { id: "night-owl", title: "Night Owl", sentence: "Most of your events started after 6. The lights suit you." };
  }
  if (topSport && events >= 5 && topSport.count / events >= 0.6) {
    return { id: "regular", title: `${topSport.label} Regular`, sentence: `If it was ${topSport.label}, you were probably there.` };
  }
  if (events >= 15) {
    return { id: "iron-crew", title: "Iron Crew", sentence: "Week in, week out. The schedule leaned on you." };
  }
  if (events < 3) {
    return { id: "fresh-face", title: "Fresh Face", sentence: "A great start. Spring is wide open." };
  }
  return { id: "team-player", title: "Team Player", sentence: "Wherever the crew needed a hand, yours was up." };
}

export function buildPersonCards(input: WrappedPersonInput): WrappedCard[] {
  const { user } = input;
  const mine = input.games
    .filter((game) => game.crew.some((member) => member.userId === user.id))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const checkouts = input.checkouts;
  if (mine.length === 0 && checkouts.length === 0) return [];

  const cards: WrappedCard[] = [];
  const first = mine[0];

  cards.push({
    id: "cover",
    layout: "cover",
    tone: "red",
    eyebrow: WRAPPED_WINDOW_LABEL,
    value: `${firstName(user.name)}'s fall in Creative`,
    sentence: user.primaryArea ? `${AREA_LABELS[user.primaryArea]} crew. Let's look back.` : "Let's look back.",
  });

  if (mine.length > 0 && first) {
    cards.push({
      id: "events",
      layout: "stat",
      tone: "blue",
      eyebrow: "Events worked",
      value: String(mine.length),
      countTo: mine.length,
      sentence: `It started with ${first.title} on ${shortDate(first.startsAt)}.`,
    });
  }

  const hours = Math.round(input.shiftHours);
  if (hours >= 1) {
    cards.push({
      id: "hours",
      layout: "stat",
      tone: "gold",
      eyebrow: "Hours on the clock",
      value: String(hours),
      countTo: hours,
      sentence: hours >= 24 ? `That's more than ${plural(Math.floor(hours / 24), "full day")} of call time.` : "Every one of them counted.",
    });
  }

  const sports = countBy(mine, gameSportLabel);
  const topSport = sports[0] ? { label: sports[0].key, count: sports[0].count } : null;
  if (topSport) {
    cards.push({
      id: "sport",
      layout: "list",
      tone: "green",
      eyebrow: "Your sport",
      value: topSport.label,
      sentence: sports.length > 1
        ? `${plural(topSport.count, "event")}, more than any other sport you worked.`
        : `All ${plural(topSport.count, "event")} of yours.`,
      items: sports.slice(0, 3).map((sport) => ({
        label: sport.key,
        value: plural(sport.count, "event"),
        share: sport.count / topSport.count,
      })),
    });
  }

  const yours = record(mine);
  const team = record(input.games.filter((game) => game.crew.length > 0));
  const yourRate = winRate(yours);
  const teamRate = winRate(team);
  if (yourRate !== null && decided(yours) >= 4 && (teamRate === null || yourRate >= teamRate)) {
    cards.push({
      id: "record",
      layout: "stat",
      tone: "red",
      eyebrow: "Lucky charm",
      value: recordLabel(yours),
      sentence: teamRate !== null && yourRate > teamRate
        ? `Wisconsin was ${recordLabel(yours)} with you on crew, better than the ${recordLabel(team)} overall.`
        : `Wisconsin was ${recordLabel(yours)} with you on crew.`,
    });
  }

  const mates = countBy(
    mine.flatMap((game) => game.crew.filter((member) => member.userId !== user.id)),
    (member) => member.userId,
  ).slice(0, 3);
  const mateNames = new Map(mine.flatMap((game) => game.crew.map((member) => [member.userId, member.name] as const)));
  const topMate = mates[0];
  if (topMate && topMate.count >= 2) {
    const topMateName = mateNames.get(topMate.key) ?? "A teammate";
    cards.push({
      id: "crew",
      layout: "people",
      tone: "violet",
      eyebrow: "Your crew",
      value: firstName(topMateName),
      sentence: `You and ${firstName(topMateName)} worked ${plural(topMate.count, "event")} together.`,
      items: mates
        .filter((mate) => mate.count >= 2)
        .map((mate) => ({
          label: mateNames.get(mate.key) ?? "Teammate",
          value: `${mate.count} together`,
          userId: mate.key,
          avatarUrl: input.avatars.get(mate.key) ?? null,
        })),
    });
  }

  const awayGames = mine.filter((game) => game.site === "AWAY").length;
  const venues = countBy(mine, (game) => game.venue);
  const topVenue = venues[0];
  if (awayGames > 0 || input.travelTrips > 0 || (topVenue && topVenue.count >= 2)) {
    const items: WrappedCardItem[] = [];
    if (awayGames > 0) items.push({ label: "Away games", value: String(awayGames) });
    if (input.travelTrips > 0) items.push({ label: "Trips", value: String(input.travelTrips) });
    if (topVenue && topVenue.count >= 2) items.push({ label: "Most-worked venue", value: topVenue.key });
    const onTheRoad = awayGames > 0 || input.travelTrips > 0;
    cards.push({
      id: "road",
      layout: "list",
      tone: "ink",
      eyebrow: onTheRoad ? "On the road" : "Home base",
      value: onTheRoad ? plural(Math.max(awayGames, input.travelTrips), awayGames >= input.travelTrips ? "away game" : "trip") : topVenue!.key,
      sentence: topVenue && topVenue.count >= 2
        ? `${topVenue.key} saw you ${plural(topVenue.count, "time")}.`
        : "Wherever the team went.",
      items,
    });
  }

  const week = busiestWeek(mine);
  if (week) {
    cards.push({
      id: "busiest-week",
      layout: "stat",
      tone: "gold",
      eyebrow: "Your busiest week",
      value: weekLabel(week.start),
      sentence: `${plural(week.count, "event")} in 7 days. You earned that weekend.`,
    });
  }

  if (checkouts.length > 0) {
    const items = checkouts.flatMap((checkout) => checkout.items);
    const topItem = countBy(items, (item) => item.label)[0];
    const topCategory = countBy(items, (item) => item.category)[0];
    cards.push({
      id: "gear",
      layout: "list",
      tone: "blue",
      eyebrow: "Gear",
      value: plural(checkouts.length, "checkout"),
      countTo: checkouts.length,
      sentence: topItem && topItem.count >= 2
        ? `Your ride or die: ${topItem.key}, ${plural(topItem.count, "time")}.`
        : "Out the door, back on the shelf.",
      items: [
        ...(topItem ? [{ label: "Most borrowed", value: topItem.key }] : []),
        ...(topCategory ? [{ label: "Top category", value: topCategory.key }] : []),
        { label: "Items handled", value: String(items.length) },
      ],
    });
  }

  const onTime = checkouts.filter((checkout) => checkout.completedAt && checkout.completedAt.getTime() <= checkout.endsAt.getTime()).length;
  const streak = longestOnTimeStreak(checkouts);
  if (onTime >= 2) {
    cards.push({
      id: "handoffs",
      layout: "stat",
      tone: "green",
      eyebrow: "Clean handoffs",
      value: String(onTime),
      countTo: onTime,
      sentence: streak >= 3 ? `On-time returns, with a best streak of ${streak} in a row.` : "On-time returns. The next person thanks you.",
    });
  }

  if (input.tradesPicked > 0 || input.badges.length > 0) {
    const items: WrappedCardItem[] = input.badges
      .slice()
      .sort((a, b) => a.awardedAt.getTime() - b.awardedAt.getTime())
      .slice(0, 4)
      .map((badge) => ({ label: badge.name, value: shortDate(badge.awardedAt) }));
    cards.push({
      id: "teammate",
      layout: "list",
      tone: "violet",
      eyebrow: input.tradesPicked > 0 ? "Good teammate" : "Badges earned",
      value: input.tradesPicked > 0 ? plural(input.tradesPicked, "shift") : plural(input.badges.length, "badge"),
      sentence: input.tradesPicked > 0
        ? `Picked up for a teammate who needed it${input.badges.length > 0 ? `, plus ${plural(input.badges.length, "badge")} earned` : ""}.`
        : "Earned the honest way.",
      items,
    });
  }

  const archetype = wrappedArchetype({
    events: mine.length,
    awayGames,
    sports: sports.length,
    topSport,
    nightGames: mine.filter((game) => appTzHour(game.startsAt) >= 18).length,
    checkouts: checkouts.length,
  });
  cards.push({
    id: "style",
    layout: "stat",
    tone: "red",
    eyebrow: "Your style",
    value: archetype.title,
    sentence: archetype.sentence,
  });

  const summary: WrappedCardItem[] = [];
  if (mine.length > 0) summary.push({ label: "Events", value: String(mine.length) });
  if (topSport) summary.push({ label: "Top sport", value: topSport.label });
  if (hours >= 1) summary.push({ label: "Hours", value: String(hours) });
  if (checkouts.length > 0) summary.push({ label: "Checkouts", value: String(checkouts.length) });
  if (summary.length < 4 && topMate && topMate.count >= 2) summary.push({ label: "Top crewmate", value: firstName(mateNames.get(topMate.key) ?? "") });
  if (summary.length < 4 && onTime > 0) summary.push({ label: "On-time returns", value: String(onTime) });
  cards.push({
    id: "summary",
    layout: "summary",
    tone: "ink",
    eyebrow: "My fall in Creative",
    value: archetype.title,
    sentence: "As of Nov 30, 2026",
    items: summary.slice(0, 4),
  });

  return cards;
}

export function buildTeamCards(input: WrappedTeamInput): WrappedCard[] {
  const covered = input.games.filter((game) => game.crew.length > 0);
  if (covered.length === 0) return [];
  const rec = record(covered);
  const people = new Set(covered.flatMap((game) => game.crew.map((member) => member.userId)));
  const biggest = [...covered].sort((a, b) => b.crew.length - a.crew.length || a.startsAt.getTime() - b.startsAt.getTime())[0]!;
  const venue = countBy(covered, (game) => game.venue)[0];
  const week = busiestWeek(covered);

  const cards: WrappedCard[] = [
    {
      id: "team-events",
      layout: "stat",
      tone: "red",
      eyebrow: "The team's fall",
      value: String(covered.length),
      countTo: covered.length,
      sentence: `Events covered by ${plural(people.size, "person", "people")}.`,
    },
  ];
  if (decided(rec) > 0) {
    cards.push({
      id: "team-record",
      layout: "stat",
      tone: "blue",
      eyebrow: "Record with our crew there",
      value: recordLabel(rec),
      sentence: "Every official game somebody from Creative worked.",
    });
  }
  cards.push({
    id: "team-biggest",
    layout: "stat",
    tone: "violet",
    eyebrow: "Biggest crew",
    value: plural(biggest.crew.length, "person", "people"),
    sentence: `${biggest.title} on ${shortDate(biggest.startsAt)}.`,
  });
  const items: WrappedCardItem[] = [];
  if (venue) items.push({ label: "Most-worked venue", value: venue.key });
  if (week) items.push({ label: "Busiest week", value: `${weekLabel(week.start)}, ${plural(week.count, "event")}` });
  if (input.checkouts > 0) items.push({ label: "Checkouts", value: String(input.checkouts) });
  if (input.badgesAwarded > 0) items.push({ label: "Badges earned", value: String(input.badgesAwarded) });
  if (items.length > 0) {
    cards.push({
      id: "team-numbers",
      layout: "list",
      tone: "ink",
      eyebrow: "By the numbers",
      value: "Fall 2026",
      sentence: "See you in the spring.",
      items,
    });
  }
  return cards;
}
