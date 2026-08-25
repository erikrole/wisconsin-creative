import type { CalendarEventResult, CalendarEventSite, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import { sportLabel } from "@/lib/sports";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { OFFICIAL_RECORD_EVENT_EXCLUSION } from "@/lib/services/game-record";
import { participatedByAnyoneWhere } from "@/lib/services/event-worker";
import { SCOREBOARD_SCOPE } from "@/lib/services/scoreboard";

export const TEAM_SCOREBOARD_MINIMUM_RATE_GAMES = 3;

export type TeamScoreboardFilters = {
  sportCode?: string;
  venue?: string;
  opponent?: string;
  site?: CalendarEventSite;
};

export type TeamScoreboardPersonIdentity = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type TeamScoreboardSummary = {
  contributors: number;
  eventsCovered: number;
  eventCredits: number;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  winRate: number | null;
  gameCredits: number;
};

export type TeamScoreboardPersonSummary = {
  eventsWorked: number;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  winRate: number | null;
};

export type TeamScoreboardPersonSport = TeamScoreboardPersonSummary & {
  key: string | null;
  label: string;
};

export type TeamScoreboardPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  summary: TeamScoreboardPersonSummary;
  bySport: TeamScoreboardPersonSport[];
};

export type TeamScoreboardBreakdown = TeamScoreboardSummary & {
  key: string | null;
  label: string;
};

export type TeamScoreboardSport = TeamScoreboardBreakdown;

export type TeamScoreboardFacet = {
  key: string;
  label: string;
};

export type TeamScoreboard = {
  generatedAt: string;
  scope: {
    key: string;
    label: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
  };
  methodology: {
    eventsCovered: string;
    eventCredits: string;
    record: string;
    gameCredits: string;
    minimumGamesForWinRate: number;
  };
  filters: {
    sportCode: string | null;
    venue: string | null;
    opponent: string | null;
    site: CalendarEventSite | null;
  };
  facets: {
    sports: TeamScoreboardFacet[];
    venues: TeamScoreboardFacet[];
    opponents: TeamScoreboardFacet[];
    sites: TeamScoreboardFacet[];
  };
  summary: TeamScoreboardSummary;
  bySport: TeamScoreboardSport[];
  byVenue: TeamScoreboardBreakdown[];
  byOpponent: TeamScoreboardBreakdown[];
  bySite: TeamScoreboardBreakdown[];
  leaderboard: TeamScoreboardPerson[];
};

const VISIBLE_PERSON_WHERE = {
  active: true,
  hiddenFromRoster: false,
} satisfies Prisma.UserWhereInput;

const VISIBLE_ACTIVE_ASSIGNMENT_WHERE = {
  status: { in: ACTIVE_ASSIGNMENT_STATUSES },
  user: VISIBLE_PERSON_WHERE,
} satisfies Prisma.ShiftAssignmentWhereInput;

const TEAM_EVENT_SELECT = {
  id: true,
  sportCode: true,
  opponent: true,
  site: true,
  rawLocationText: true,
  result: true,
  shiftGroup: {
    select: {
      shifts: {
        select: {
          assignments: {
            where: VISIBLE_ACTIVE_ASSIGNMENT_WHERE,
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      },
    },
  },
  workers: {
    where: { user: VISIBLE_PERSON_WHERE },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
  },
} satisfies Prisma.CalendarEventSelect;

type TeamEventRow = Prisma.CalendarEventGetPayload<{ select: typeof TEAM_EVENT_SELECT }>;

type MutablePersonSport = {
  key: string | null;
  eventIds: Set<string>;
  wins: number;
  losses: number;
  ties: number;
};

type MutablePerson = {
  identity: TeamScoreboardPersonIdentity;
  eventIds: Set<string>;
  wins: number;
  losses: number;
  ties: number;
  bySport: Map<string | null, MutablePersonSport>;
};

type MutableTeamBreakdown = {
  key: string | null;
  contributorIds: Set<string>;
  eventIds: Set<string>;
  eventCredits: number;
  wins: number;
  losses: number;
  ties: number;
  gameCredits: number;
};

type TeamScoreboardDimension = "sport" | "venue" | "opponent" | "site";
type TeamScoreboardBreakdownMaps = Record<
  TeamScoreboardDimension,
  Map<string | null, MutableTeamBreakdown>
>;

const SITE_LABELS: Record<CalendarEventSite, string> = {
  HOME: "Home",
  AWAY: "Away",
  NEUTRAL: "Neutral",
};

const SITE_ORDER: Array<CalendarEventSite | null> = ["HOME", "AWAY", "NEUTRAL", null];

function rate(wins: number, losses: number, ties: number): number | null {
  const games = wins + losses + ties;
  return games > 0 ? Math.round(((wins + ties / 2) / games) * 1000) / 10 : null;
}

function labelForSport(key: string | null): string {
  return key ? sportLabel(key) : "Unknown sport";
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function dimensionKey(event: TeamEventRow, dimension: TeamScoreboardDimension): string | null {
  if (dimension === "sport") return event.sportCode;
  if (dimension === "venue") return scheduleVenueDisplayName(event.rawLocationText);
  if (dimension === "opponent") return trimmedOrNull(event.opponent);
  return event.site;
}

function dimensionLabel(dimension: TeamScoreboardDimension, key: string | null): string {
  if (dimension === "sport") return labelForSport(key);
  if (dimension === "venue") return key ?? "Unknown venue";
  if (dimension === "opponent") return key ?? "Unknown opponent";
  return key ? SITE_LABELS[key as CalendarEventSite] : "Unknown site";
}

function matchesFilters(event: TeamEventRow, filters: TeamScoreboardFilters): boolean {
  if (filters.sportCode && event.sportCode !== filters.sportCode) return false;
  if (filters.venue && dimensionKey(event, "venue") !== filters.venue) return false;
  if (filters.opponent && dimensionKey(event, "opponent") !== filters.opponent) return false;
  if (filters.site && event.site !== filters.site) return false;
  return true;
}

/**
 * Everyone on record for the event, whether they held an assignment or were
 * added by an admin. The map keys by person, so multiple shifts -- or a shift
 * plus an added-worker row -- still earn exactly one credit.
 */
function peopleForEvent(event: TeamEventRow): TeamScoreboardPersonIdentity[] {
  const people = new Map<string, TeamScoreboardPersonIdentity>();
  for (const shift of event.shiftGroup?.shifts ?? []) {
    for (const assignment of shift.assignments) {
      people.set(assignment.user.id, assignment.user);
    }
  }
  for (const worker of event.workers ?? []) {
    people.set(worker.user.id, worker.user);
  }
  return [...people.values()];
}

function personState(
  people: Map<string, MutablePerson>,
  identity: TeamScoreboardPersonIdentity,
): MutablePerson {
  const current = people.get(identity.id);
  if (current) return current;
  const created: MutablePerson = {
    identity,
    eventIds: new Set(),
    wins: 0,
    losses: 0,
    ties: 0,
    bySport: new Map(),
  };
  people.set(identity.id, created);
  return created;
}

function personSportState(person: MutablePerson, key: string | null): MutablePersonSport {
  const current = person.bySport.get(key);
  if (current) return current;
  const created: MutablePersonSport = { key, eventIds: new Set(), wins: 0, losses: 0, ties: 0 };
  person.bySport.set(key, created);
  return created;
}

function teamBreakdownState(
  breakdowns: Map<string | null, MutableTeamBreakdown>,
  key: string | null,
): MutableTeamBreakdown {
  const current = breakdowns.get(key);
  if (current) return current;
  const created: MutableTeamBreakdown = {
    key,
    contributorIds: new Set(),
    eventIds: new Set(),
    eventCredits: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    gameCredits: 0,
  };
  breakdowns.set(key, created);
  return created;
}

function breakdownStatesForEvent(
  maps: TeamScoreboardBreakdownMaps,
  event: TeamEventRow,
): MutableTeamBreakdown[] {
  return (Object.keys(maps) as TeamScoreboardDimension[]).map((dimension) => (
    teamBreakdownState(maps[dimension], dimensionKey(event, dimension))
  ));
}

function addResult(
  target: { wins: number; losses: number; ties: number },
  result: CalendarEventResult | null,
): void {
  if (result === "WIN") target.wins += 1;
  if (result === "LOSS") target.losses += 1;
  if (result === "TIE") target.ties += 1;
}

function personSummary(person: MutablePerson): TeamScoreboardPersonSummary {
  const games = person.wins + person.losses + person.ties;
  return {
    eventsWorked: person.eventIds.size,
    wins: person.wins,
    losses: person.losses,
    ties: person.ties,
    games,
    winRate: rate(person.wins, person.losses, person.ties),
  };
}

function personSportSummary(sport: MutablePersonSport): TeamScoreboardPersonSport {
  const games = sport.wins + sport.losses + sport.ties;
  return {
    key: sport.key,
    label: labelForSport(sport.key),
    eventsWorked: sport.eventIds.size,
    wins: sport.wins,
    losses: sport.losses,
    ties: sport.ties,
    games,
    winRate: rate(sport.wins, sport.losses, sport.ties),
  };
}

function comparePersonSummary(
  a: TeamScoreboardPersonSummary,
  b: TeamScoreboardPersonSummary,
): number {
  return b.eventsWorked - a.eventsWorked || b.games - a.games || b.wins - a.wins;
}

function finishBreakdowns(
  breakdowns: Map<string | null, MutableTeamBreakdown>,
  dimension: TeamScoreboardDimension,
): TeamScoreboardBreakdown[] {
  return [...breakdowns.values()]
    .map((breakdown) => {
      const games = breakdown.wins + breakdown.losses + breakdown.ties;
      return {
        key: breakdown.key,
        label: dimensionLabel(dimension, breakdown.key),
        contributors: breakdown.contributorIds.size,
        eventsCovered: breakdown.eventIds.size,
        eventCredits: breakdown.eventCredits,
        wins: breakdown.wins,
        losses: breakdown.losses,
        ties: breakdown.ties,
        games,
        winRate: rate(breakdown.wins, breakdown.losses, breakdown.ties),
        gameCredits: breakdown.gameCredits,
      };
    })
    .sort((a, b) => {
      if (dimension === "site") {
        return SITE_ORDER.indexOf(a.key as CalendarEventSite | null)
          - SITE_ORDER.indexOf(b.key as CalendarEventSite | null);
      }
      return b.eventCredits - a.eventCredits
        || b.games - a.games
        || a.label.localeCompare(b.label);
    });
}

function facetOptions(
  events: TeamEventRow[],
  dimension: TeamScoreboardDimension,
): TeamScoreboardFacet[] {
  const keys = new Set<string>();
  for (const event of events) {
    const key = dimensionKey(event, dimension);
    if (key) keys.add(key);
  }
  return [...keys]
    .map((key) => ({ key, label: dimensionLabel(dimension, key) }))
    .sort((a, b) => {
      if (dimension === "site") {
        return SITE_ORDER.indexOf(a.key as CalendarEventSite)
          - SITE_ORDER.indexOf(b.key as CalendarEventSite);
      }
      return a.label.localeCompare(b.label);
    });
}

function visibleParticipationWhere(eventWhere: Prisma.CalendarEventWhereInput): Prisma.CalendarEventWhereInput {
  return {
    ...eventWhere,
    ...participatedByAnyoneWhere(VISIBLE_PERSON_WHERE, VISIBLE_ACTIVE_ASSIGNMENT_WHERE),
  };
}

export async function getTeamScoreboard(
  options: { now?: Date; filters?: TeamScoreboardFilters } = {},
): Promise<TeamScoreboard> {
  const now = options.now ?? new Date();
  const filters = options.filters ?? {};
  const [workedEvents, recordEvents] = await Promise.all([
    db.calendarEvent.findMany({
      where: visibleParticipationWhere({
        startsAt: { gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt },
        endsAt: { lt: now },
        status: "CONFIRMED",
        isHidden: false,
      }),
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: TEAM_EVENT_SELECT,
    }),
    db.calendarEvent.findMany({
      where: visibleParticipationWhere({
        ...OFFICIAL_RECORD_EVENT_EXCLUSION,
        result: { not: null },
        startsAt: { gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt },
        status: { not: "CANCELLED" },
        isHidden: false,
        archivedAt: null,
      }),
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: TEAM_EVENT_SELECT,
    }),
  ]);

  const facetEvents = [...new Map(
    [...workedEvents, ...recordEvents].map((event) => [event.id, event]),
  ).values()];
  const filteredWorkedEvents = workedEvents.filter((event) => matchesFilters(event, filters));
  const filteredRecordEvents = recordEvents.filter((event) => matchesFilters(event, filters));

  const people = new Map<string, MutablePerson>();
  const breakdowns: TeamScoreboardBreakdownMaps = {
    sport: new Map(),
    venue: new Map(),
    opponent: new Map(),
    site: new Map(),
  };
  const contributorIds = new Set<string>();
  let eventCredits = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let gameCredits = 0;

  for (const event of filteredWorkedEvents) {
    const eventPeople = peopleForEvent(event);
    const eventBreakdowns = breakdownStatesForEvent(breakdowns, event);
    for (const breakdown of eventBreakdowns) {
      breakdown.eventIds.add(event.id);
      breakdown.eventCredits += eventPeople.length;
    }
    eventCredits += eventPeople.length;

    for (const identity of eventPeople) {
      contributorIds.add(identity.id);
      for (const breakdown of eventBreakdowns) breakdown.contributorIds.add(identity.id);
      const person = personState(people, identity);
      person.eventIds.add(event.id);
      personSportState(person, event.sportCode).eventIds.add(event.id);
    }
  }

  for (const event of filteredRecordEvents) {
    if (event.result !== "WIN" && event.result !== "LOSS" && event.result !== "TIE") continue;
    const eventPeople = peopleForEvent(event);
    const eventBreakdowns = breakdownStatesForEvent(breakdowns, event);
    for (const breakdown of eventBreakdowns) {
      addResult(breakdown, event.result);
      breakdown.gameCredits += eventPeople.length;
    }
    if (event.result === "WIN") wins += 1;
    else if (event.result === "LOSS") losses += 1;
    else ties += 1;
    gameCredits += eventPeople.length;

    for (const identity of eventPeople) {
      contributorIds.add(identity.id);
      for (const breakdown of eventBreakdowns) breakdown.contributorIds.add(identity.id);
      const person = personState(people, identity);
      addResult(person, event.result);
      addResult(personSportState(person, event.sportCode), event.result);
    }
  }

  const leaderboard = [...people.values()]
    .map((person): TeamScoreboardPerson => {
      const summary = personSummary(person);
      const bySport = [...person.bySport.values()]
        .map(personSportSummary)
        .sort((a, b) => comparePersonSummary(a, b) || a.label.localeCompare(b.label));
      return {
        userId: person.identity.id,
        name: person.identity.name,
        avatarUrl: person.identity.avatarUrl,
        summary,
        bySport,
      };
    })
    .sort((a, b) => comparePersonSummary(a.summary, b.summary)
      || a.name.localeCompare(b.name)
      || a.userId.localeCompare(b.userId));

  const bySport = finishBreakdowns(breakdowns.sport, "sport");
  const byVenue = finishBreakdowns(breakdowns.venue, "venue");
  const byOpponent = finishBreakdowns(breakdowns.opponent, "opponent");
  const bySite = finishBreakdowns(breakdowns.site, "site");

  const games = wins + losses + ties;
  return {
    generatedAt: now.toISOString(),
    scope: {
      key: SCOREBOARD_SCOPE.key,
      label: SCOREBOARD_SCOPE.label,
      startsAt: SCOREBOARD_SCOPE.startsAt.toISOString(),
      endsAt: SCOREBOARD_SCOPE.endsAt.toISOString(),
      timeZone: SCOREBOARD_SCOPE.timeZone,
    },
    methodology: {
      eventsCovered: "Unique completed, confirmed Schedule events worked by at least one visible active person, by assignment or admin-added worker.",
      eventCredits: "One credit per person per completed event, even when that person worked multiple shifts.",
      record: "Unique resolved games (wins, losses, or ties) after the official exhibition, scrimmage, and alumni-match exclusions.",
      gameCredits: "One record credit per person per resolved game, even when that person worked multiple shifts.",
      minimumGamesForWinRate: TEAM_SCOREBOARD_MINIMUM_RATE_GAMES,
    },
    filters: {
      sportCode: filters.sportCode ?? null,
      venue: filters.venue ?? null,
      opponent: filters.opponent ?? null,
      site: filters.site ?? null,
    },
    facets: {
      sports: facetOptions(facetEvents, "sport"),
      venues: facetOptions(facetEvents, "venue"),
      opponents: facetOptions(facetEvents, "opponent"),
      sites: facetOptions(facetEvents, "site"),
    },
    summary: {
      contributors: contributorIds.size,
      eventsCovered: filteredWorkedEvents.length,
      eventCredits,
      wins,
      losses,
      ties,
      games,
      winRate: rate(wins, losses, ties),
      gameCredits,
    },
    bySport,
    byVenue,
    byOpponent,
    bySite,
    leaderboard,
  };
}
