import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import {
  CAPTURE_SELECT,
  type GameSnapshotCrewMember,
  isOfficialGame,
  liveCrew,
  mergeSnapshotCrew,
} from "@/lib/services/game-snapshots";
import { scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import {
  buildPersonCards,
  buildTeamCards,
  WRAPPED_RECAP_VERSION,
  WRAPPED_SEASON_KEY,
  WRAPPED_UNLOCK_AT,
  WRAPPED_WINDOW_END,
  WRAPPED_WINDOW_LABEL,
  WRAPPED_WINDOW_START,
  type WrappedGame,
  type WrappedRecap,
} from "@/lib/wrapped/recap";

const WINDOW = { gte: WRAPPED_WINDOW_START, lt: WRAPPED_WINDOW_END };
const COUNTED_CHECKOUT_STATUSES = ["OPEN", "COMPLETED"] as const;
const COUNTED_TRADE_STATUSES = ["APPROVED", "COMPLETED"] as const;

/** Who worked it: on the crew now (or when last captured) and not marked absent. */
function workedCrew(crew: GameSnapshotCrewMember[]): WrappedGame["crew"] {
  return crew
    .filter((member) => !member.leftAt && member.attended !== false)
    .map((member) => ({ userId: member.userId, name: member.name }));
}

/**
 * Every game in the window, from snapshots first so deleted or edited events
 * keep their history, merged with the live rows so a game that ended after the
 * last nightly capture still counts.
 */
export async function loadWrappedGames(now: Date = new Date()): Promise<WrappedGame[]> {
  const [snapshots, live] = await Promise.all([
    db.gameSnapshot.findMany({
      where: { startsAt: WINDOW, status: { not: "CANCELLED" } },
      select: {
        eventId: true,
        title: true,
        startsAt: true,
        sportCode: true,
        opponent: true,
        site: true,
        venue: true,
        result: true,
        official: true,
        crew: true,
      },
    }),
    db.calendarEvent.findMany({
      where: {
        startsAt: WINDOW,
        endsAt: { lt: now },
        isHidden: false,
        status: { not: "CANCELLED" },
        OR: [{ shiftGroup: { isNot: null } }, { workers: { some: {} } }],
      },
      select: CAPTURE_SELECT,
    }),
  ]);

  const games = new Map<string, WrappedGame>();
  const storedCrew = new Map<string, GameSnapshotCrewMember[]>();
  for (const snapshot of snapshots) {
    const crew = (snapshot.crew as GameSnapshotCrewMember[] | null) ?? [];
    storedCrew.set(snapshot.eventId, crew);
    games.set(snapshot.eventId, {
      eventId: snapshot.eventId,
      title: snapshot.title,
      startsAt: snapshot.startsAt,
      sportCode: snapshot.sportCode,
      opponent: snapshot.opponent,
      site: snapshot.site,
      venue: snapshot.venue,
      result: snapshot.result,
      official: snapshot.official,
      crew: workedCrew(crew),
    });
  }
  for (const event of live) {
    const crew = mergeSnapshotCrew(storedCrew.get(event.id) ?? [], liveCrew(event), now);
    games.set(event.id, {
      eventId: event.id,
      title: event.summary,
      startsAt: event.startsAt,
      sportCode: event.sportCode,
      opponent: event.opponent,
      site: event.site,
      venue: scheduleVenueDisplayName(event.rawLocationText),
      result: event.result,
      official: isOfficialGame(event.rawSummary),
      crew: workedCrew(crew),
    });
  }
  return [...games.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function assetLabel(asset: { name: string | null; brand: string; model: string }): string {
  return asset.name?.trim() || `${asset.brand} ${asset.model}`.trim();
}

export async function buildWrappedRecap(userId: string, now: Date = new Date()): Promise<WrappedRecap | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, avatarUrl: true, primaryArea: true, role: true },
  });
  if (!user) return null;

  const games = await loadWrappedGames(now);
  const crewIds = [...new Set(games.flatMap((game) => game.crew.map((member) => member.userId)))];

  const [avatars, assignments, travelTrips, checkouts, tradesPicked, badges, teamCheckouts, badgesAwarded] = await Promise.all([
    db.user.findMany({ where: visibleActiveUserWhere({ id: { in: crewIds } }), select: { id: true, avatarUrl: true } }),
    db.shiftAssignment.findMany({
      where: {
        userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        // attended is null until someone logs it; Prisma's `not: false` would drop those rows.
        OR: [{ attended: null }, { attended: true }],
        shift: { startsAt: WINDOW, endsAt: { lt: now } },
      },
      select: {
        callStartsAt: true,
        callEndsAt: true,
        shift: { select: { startsAt: true, endsAt: true, callStartsAt: true, callEndsAt: true } },
      },
    }),
    db.eventTravelMember.count({ where: { userId, event: { startsAt: WINDOW } } }),
    db.booking.findMany({
      where: { requesterUserId: userId, kind: "CHECKOUT", status: { in: [...COUNTED_CHECKOUT_STATUSES] }, startsAt: WINDOW },
      select: {
        endsAt: true,
        completedAt: true,
        serializedItems: {
          select: { asset: { select: { name: true, brand: true, model: true, category: { select: { name: true } } } } },
        },
      },
    }),
    db.shiftTrade.count({
      where: { claimedByUserId: userId, status: { in: [...COUNTED_TRADE_STATUSES] }, claimedAt: WINDOW },
    }),
    db.studentBadge.findMany({
      where: { userId, awardedAt: WINDOW },
      select: { awardedAt: true, definition: { select: { name: true } } },
    }),
    db.booking.count({
      where: {
        kind: "CHECKOUT",
        status: { in: [...COUNTED_CHECKOUT_STATUSES] },
        startsAt: WINDOW,
        requester: { role: { not: "COLLABORATOR" } },
      },
    }),
    db.studentBadge.count({ where: { awardedAt: WINDOW, user: { role: { not: "COLLABORATOR" } } } }),
  ]);

  const shiftHours = assignments.reduce((total, assignment) => {
    const start = assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt;
    const end = assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt;
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    // A malformed or overnight-by-mistake slot shouldn't inflate the story.
    return hours > 0 && hours <= 16 ? total + hours : total;
  }, 0);

  // The route keeps collaborators out; this stays as a second guard.
  const cards = user.role === "COLLABORATOR"
    ? []
    : buildPersonCards({
      user,
      games,
      avatars: new Map(avatars.map((row) => [row.id, row.avatarUrl])),
      shiftHours,
      travelTrips,
      checkouts: checkouts.map((checkout) => ({
        endsAt: checkout.endsAt,
        completedAt: checkout.completedAt,
        items: checkout.serializedItems.map((item) => ({
          label: assetLabel(item.asset),
          category: item.asset.category?.name ?? null,
        })),
      })),
      tradesPicked,
      badges: badges.map((badge) => ({ name: badge.definition.name, awardedAt: badge.awardedAt })),
    });

  return {
    version: WRAPPED_RECAP_VERSION,
    seasonKey: WRAPPED_SEASON_KEY,
    windowLabel: WRAPPED_WINDOW_LABEL,
    generatedAt: now.toISOString(),
    person: { userId: user.id, name: user.name, avatarUrl: user.avatarUrl },
    cards,
    team: buildTeamCards({ games, checkouts: teamCheckouts, badgesAwarded }),
  };
}

/** Frozen numbers stay fixed, but identity visibility is checked on every read. */
async function redactFrozenIdentities(recap: WrappedRecap): Promise<WrappedRecap> {
  const isSummary = (card: WrappedRecap["cards"][number]) => card.layout === "summary" || card.id === "summary";
  // Older summaries stored the teammate's name without an identity. Those
  // rows cannot be checked, even when no other card supplies a user id.
  const stripLegacy = (cards: WrappedRecap["cards"]) => cards.map((card) => isSummary(card)
    ? { ...card, items: (card.items ?? []).filter((item) => item.label !== "Top crewmate" || item.userId) }
    : card);
  const cards = stripLegacy(recap.cards);
  const team = stripLegacy(recap.team);
  const ids = [...new Set([...cards, ...team].flatMap((card) =>
    (card.items ?? []).flatMap((item) => item.userId ? [item.userId] : []),
  ))];
  if (!ids.length) return { ...recap, cards, team };
  const visible = await db.user.findMany({
    where: visibleActiveUserWhere({ id: { in: ids } }),
    select: { id: true },
  });
  const allowed = new Set(visible.map((person) => person.id));
  // A people card repeats names in its heading and sentence, so removing an
  // item alone would still disclose its identity. Omit the whole affected card.
  const safeCards = (source: WrappedRecap["cards"]) => source.flatMap((card) => {
    if (isSummary(card)) return [{ ...card, items: (card.items ?? []).filter((item) => !item.userId || allowed.has(item.userId)) }];
    return (card.items ?? []).some((item) => item.userId && !allowed.has(item.userId)) ? [] : [card];
  });
  return { ...recap, cards: safeCards(cards), team: safeCards(team) };
}

export type WrappedResponse =
  | { status: "locked"; unlockAt: string }
  | { status: "ready"; preview: boolean; frozen: boolean; recap: WrappedRecap };

export function isWrappedUnlocked(now: Date = new Date()): boolean {
  return now.getTime() >= WRAPPED_UNLOCK_AT.getTime();
}

/**
 * The person's own recap. Before unlock only a preview (admins) gets numbers.
 * After unlock the first open freezes the recap and later opens read it back.
 */
export async function getWrappedRecap(
  userId: string,
  options: { now?: Date; preview?: boolean; readOnly?: boolean } = {},
): Promise<WrappedResponse | null> {
  const now = options.now ?? new Date();
  const unlocked = isWrappedUnlocked(now);
  if (!unlocked && !options.preview) {
    return { status: "locked", unlockAt: WRAPPED_UNLOCK_AT.toISOString() };
  }

  if (unlocked) {
    const stored = await db.wrappedRecap.findUnique({
      where: { userId_seasonKey: { userId, seasonKey: WRAPPED_SEASON_KEY } },
      select: { version: true, payload: true },
    });
    if (stored && stored.version === WRAPPED_RECAP_VERSION) {
      return { status: "ready", preview: false, frozen: true, recap: await redactFrozenIdentities(stored.payload as unknown as WrappedRecap) };
    }
  }

  const recap = await buildWrappedRecap(userId, now);
  if (!recap) return null;
  if (!unlocked) return { status: "ready", preview: true, frozen: false, recap };
  // An admin looking at someone else's recap must not freeze it for them.
  if (options.readOnly) return { status: "ready", preview: true, frozen: false, recap };

  const payload = recap as unknown as Prisma.InputJsonValue;
  await db.wrappedRecap.upsert({
    where: { userId_seasonKey: { userId, seasonKey: WRAPPED_SEASON_KEY } },
    create: { userId, seasonKey: WRAPPED_SEASON_KEY, version: WRAPPED_RECAP_VERSION, payload },
    update: { version: WRAPPED_RECAP_VERSION, payload, generatedAt: now },
  });
  return { status: "ready", preview: false, frozen: true, recap };
}

/** Admin: drop a frozen recap so the next open rebuilds it from current data. */
export async function resetWrappedRecap(userId: string): Promise<boolean> {
  const { count } = await db.wrappedRecap.deleteMany({ where: { userId, seasonKey: WRAPPED_SEASON_KEY } });
  return count > 0;
}
