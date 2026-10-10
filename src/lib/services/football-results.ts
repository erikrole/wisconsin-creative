import { Prisma, type Role } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { db } from "@/lib/db";
import { createAuditEntriesTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import {
  footballScheduleUrl, matchesFootballGame, parseEspnFootballSchedule, parseUwFootballSchedule,
  type FootballObservation,
} from "@/lib/football-results";
import { GAME_RECORD_START_DATE, GAME_RECORD_END_DATE, OFFICIAL_RECORD_EVENT_EXCLUSION } from "@/lib/services/game-record";

const PROVIDERS = ["UW", "ESPN"] as const;
const MAX_BYTES = 4 * 1024 * 1024;

/** Only fixed provider URLs; bounded body and timeout also cover streaming reads. */
async function readScheduleText(provider: typeof PROVIDERS[number], year: number, postseason = false): Promise<string> {
  const response = await fetch(footballScheduleUrl(provider, year, postseason), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    headers: { Accept: provider === "UW" ? "text/html" : "application/json" },
  });
  if (!response.ok || !response.body) throw new Error(`${provider} schedule unavailable`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0; let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error(`${provider} schedule too large`);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  return text;
}

async function readSchedule(provider: typeof PROVIDERS[number], year: number): Promise<FootballObservation[]> {
  if (provider === "UW") return parseUwFootballSchedule(await readScheduleText(provider, year), year);
  // ESPN separates postseason games; an empty bowl schedule is valid before selection.
  const [regular, postseason] = await Promise.all([readScheduleText(provider, year), readScheduleText(provider, year, true)]);
  const rows = [...parseEspnFootballSchedule(JSON.parse(regular), year), ...parseEspnFootballSchedule(JSON.parse(postseason), year, true)];
  const unique = new Map<string, FootballObservation>();
  for (const row of rows) {
    const previous = unique.get(row.externalId);
    if (previous && !isDeepStrictEqual(previous, row)) throw new Error("ESPN schedules disagree about a game");
    unique.set(row.externalId, row);
  }
  if (unique.size > 32) throw new Error("ESPN football season was unexpectedly large");
  return [...unique.values()];
}

function isUwSource(url: string | undefined): boolean {
  if (!url) return false;
  try { return new URL(url.replace(/^webcal:/, "https:")).hostname === "uwbadgers.com"; }
  catch { return false; }
}

/** Current season only. Never creates CalendarEvents or changes results, crews, or badges. */
export async function refreshFootballResults(actor?: { id: string; role: Role }) {
  const observedAt = new Date();
  const year = GAME_RECORD_START_DATE.getUTCFullYear();
  const fetched = await Promise.allSettled(PROVIDERS.map((provider) => readSchedule(provider, year)));
  const sources = fetched.map((result, index) => ({ provider: PROVIDERS[index]!,
    games: result.status === "fulfilled" ? result.value.length : 0,
    error: result.status === "rejected" ? "Schedule unavailable or invalid; previous observations retained." : null }));

  try {
    return await db.$transaction(async (tx) => {
      // A second refresh must not interleave writes or overwrite newer observations.
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(75620419) AS locked`;
      if (!lock?.locked) throw new HttpError(409, "Football results are already refreshing. Try again shortly.");
      const candidates = await tx.calendarEvent.findMany({
        where: { ...OFFICIAL_RECORD_EVENT_EXCLUSION, sportCode: "FB", sourceId: { not: null },
          startsAt: { gte: GAME_RECORD_START_DATE, lt: GAME_RECORD_END_DATE },
          endsAt: { lt: observedAt }, status: "CONFIRMED", isHidden: false },
        take: 65,
        select: { id: true, sportCode: true, opponent: true, site: true, startsAt: true, allDay: true,
          rawStartsAt: true, rawAllDay: true, result: true, source: { select: { url: true } }, resultObservations: true },
      });
      if (candidates.length > 64) throw new HttpError(409, "Too many football events to reconcile safely.");
      const events = candidates.filter((event) => isUwSource(event.source?.url));
      let updated = 0; let retained = 0;
      const issues: Array<{ eventId: string; provider: typeof PROVIDERS[number]; reason: string }> = [];
      const audit: Parameters<typeof createAuditEntriesTx>[1] = [];

      for (const event of events) {
        for (const [index, provider] of PROVIDERS.entries()) {
          const previous = event.resultObservations.find((row) => row.provider === provider);
          if (previous && previous.lastAttemptAt > observedAt) { retained++; continue; }
          const result = fetched[index]!;
          const matches = result.status === "fulfilled" ? result.value.filter((row) => matchesFootballGame(event, row)) : [];
          const match = matches.length === 1 ? matches[0]! : null;
          let reason: string | null = result.status === "rejected" ? "fetch_failed"
            : matches.length > 1 ? "ambiguous_match" : !match ? "game_not_found" : null;
          if (match && events.filter((candidate) => matchesFootballGame(candidate, match)).length !== 1) reason = "ambiguous_match";
          if (match && previous && previous.externalId !== match.externalId) reason = "identity_changed";
          if (previous && result.status === "fulfilled") {
            const linked = result.value.find((row) => row.externalId === previous.externalId);
            if (linked && !matchesFootballGame(event, linked)) reason = "identity_changed";
          }
          if (reason || !match) {
            issues.push({ eventId: event.id, provider, reason: reason ?? "game_not_found" });
            if (previous) {
              await tx.gameResultObservation.update({ where: { id: previous.id }, data: { lastAttemptAt: observedAt, lastError: reason } });
              retained++;
              if (previous.lastError !== reason) audit.push({ actorId: actor?.id ?? null, actorRole: actor?.role ?? null,
                entityType: "CalendarEvent", entityId: event.id, action: "football_result_refresh",
                before: { provider, lastError: previous.lastError }, after: { provider, lastError: reason } });
            }
            continue;
          }
          await tx.gameResultObservation.upsert({
            where: { eventId_provider: { eventId: event.id, provider } },
            create: { eventId: event.id, provider, externalId: match.externalId, snapshot: match, observedAt, lastAttemptAt: observedAt },
            update: { snapshot: match, observedAt, lastAttemptAt: observedAt, lastError: null },
          });
          updated++;
          if (!previous || !isDeepStrictEqual(previous.snapshot, match) || previous.lastError) {
            audit.push({ actorId: actor?.id ?? null, actorRole: actor?.role ?? null,
              entityType: "CalendarEvent", entityId: event.id, action: "football_result_refresh",
              before: { provider, snapshot: previous?.snapshot ?? null, lastError: previous?.lastError ?? null },
              after: { provider, snapshot: match, observedAt: observedAt.toISOString(), lastError: null } });
          }
        }
      }
      await createAuditEntriesTx(tx, audit);
      return { season: year, events: events.length, updated, retained, sources, issues,
        ok: sources.every((source) => !source.error) && issues.length === 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw new HttpError(409, "Football game identities changed during refresh. No partial changes were saved; try again.");
    }
    throw error;
  }
}
