import { db } from "@/lib/db";
import { createAuditEntriesTx } from "@/lib/audit";
import type { CalendarEventResult, CalendarEventSite, CalendarEventStatus } from "@prisma/client";
import {
  buildVenueSearchText,
  classifySourceEvent,
  cleanSourceSummary,
  extractSportInfo,
  isHomeLocationText,
} from "@/lib/schedule-event-identity";
import { sortVenueMappings, venueMappingMatches } from "@/lib/venue-mapping-contract";
import { resolvedEventSite } from "@/lib/venue-tone";

// Sport/opponent classification lives with the other summary parsing in
// `schedule-event-identity`. Re-exported here so existing sync-side importers
// and contract tests keep one import path.
export { extractSportInfo, isHomeLocationText };

/** Max events per createMany / update batch */
export const WRITE_CHUNK_SIZE = 500;

/** Abort a source fetch that hangs — morning-refresh has more work to do. */
export const ICS_FETCH_TIMEOUT_MS = 20_000;

/** Reject absurdly large feed responses before buffering them. */
export const ICS_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Unescape ICS text values per RFC 5545 §3.3.11.
 * Handles: \n → newline, \, → comma, \; → semicolon, \\ → backslash
 */
export function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Find the first colon outside double-quoted parameter values.
 * `DESCRIPTION;ALTREP="http://x":text` must split after the closing quote,
 * not inside the quoted URL (RFC 5545 §3.2 allows colons in quoted params).
 */
function propertyColonIndex(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) return i;
  }
  return -1;
}

/** Extract a TZID=... parameter value from a property's parameter list. */
function tzidParam(paramText: string): string | null {
  const match = paramText.match(/(?:^|;)TZID=("?)([^";]+)\1/i);
  return match ? match[2]! : null;
}

/**
 * Minimal ICS parser — extracts VEVENT blocks and their key properties.
 * Does not depend on any external library. Exported for testing.
 */
export function parseIcs(icsText: string): ParsedIcsEvent[] {
  const events: ParsedIcsEvent[] = [];

  // Unfold continued lines (RFC 5545 §3.1)
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  let current: Record<string, string> = {};

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      inEvent = false;
      if (current.UID) {
        events.push({
          uid: current.UID,
          summary: unescapeIcsText(current.SUMMARY ?? ""),
          description: unescapeIcsText(current.DESCRIPTION ?? ""),
          location: unescapeIcsText(current.LOCATION ?? ""),
          dtstart: current.DTSTART ?? "",
          dtend: current.DTEND ?? current.DTSTART ?? "",
          dtstartTzid: current["DTSTART;TZID"] || undefined,
          dtendTzid: current["DTEND;TZID"] ?? current["DTSTART;TZID"] ?? undefined,
          status: current.STATUS ?? "CONFIRMED"
        });
      }
      continue;
    }

    if (!inEvent) continue;

    // Handle properties with parameters like DTSTART;VALUE=DATE:20260301
    const colonIdx = propertyColonIndex(line);
    if (colonIdx < 0) continue;

    const keyWithParams = line.slice(0, colonIdx);
    const key = keyWithParams.split(";")[0]!.toUpperCase(); // split always returns at least one element
    const value = line.slice(colonIdx + 1);
    current[key] = value;

    // Retain TZID for date properties — local wall times must not be read
    // as UTC (that would shift every event by the zone offset).
    if (key === "DTSTART" || key === "DTEND") {
      const tzid = tzidParam(keyWithParams.slice(key.length));
      if (tzid) current[`${key};TZID`] = tzid;
    }
  }

  return events;
}

/**
 * Convert a wall-clock time in a named IANA zone to UTC using the two-pass
 * Intl technique (no timezone database dependency).
 */
export function zonedWallTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date {
  const asUtc = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  let guess = asUtc;
  // Two passes converge across DST boundaries.
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const wall = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      // Intl can render midnight as "24" with hour12: false
      Number(p.hour) % 24, Number(p.minute), Number(p.second),
    );
    guess += asUtc - wall;
  }
  return new Date(guess);
}

/** Parse ICS date strings: 20260301, 20260301T120000, 20260301T120000Z.
 * When `tzid` is provided (and the value is a floating date-time without a
 * trailing Z), the wall time is converted from that zone to UTC. */
export function parseIcsDate(value: string, tzid?: string | null): { date: Date; allDay: boolean } {
  const cleaned = value.replace(/[^0-9TZ]/g, "");

  if (cleaned.length === 8) {
    // Date only: YYYYMMDD — use UTC to avoid timezone ambiguity on edge
    const year = parseInt(cleaned.slice(0, 4));
    const month = parseInt(cleaned.slice(4, 6)) - 1;
    const day = parseInt(cleaned.slice(6, 8));
    return { date: new Date(Date.UTC(year, month, day)), allDay: true };
  }

  // Date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const year = parseInt(cleaned.slice(0, 4));
  const month = parseInt(cleaned.slice(4, 6)) - 1;
  const day = parseInt(cleaned.slice(6, 8));
  const hour = parseInt(cleaned.slice(9, 11)) || 0;
  const minute = parseInt(cleaned.slice(11, 13)) || 0;
  const second = parseInt(cleaned.slice(13, 15)) || 0;

  // Zoned wall time (DTSTART;TZID=America/Chicago:...) — reading it as UTC
  // would shift every event by the zone offset.
  if (tzid && !cleaned.endsWith("Z")) {
    try {
      return {
        date: zonedWallTimeToUtc({ year, month, day, hour, minute, second }, tzid),
        allDay: false,
      };
    } catch {
      // Unknown TZID — fall through to the UTC interpretation below.
    }
  }

  // Always use Date.UTC — ICS dates are timezone-agnostic
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));

  return { date, allDay: false };
}

/** Returns true if the Date object represents a real, finite point in time. */
function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime());
}

function mapIcsStatus(status: string): CalendarEventStatus {
  const normalized = status.toUpperCase().trim();
  if (normalized === "CANCELLED") return "CANCELLED";
  if (normalized === "TENTATIVE") return "TENTATIVE";
  return "CONFIRMED";
}

export type SyncEventError = {
  uid: string;
  summary: string;
  operation: "create" | "update" | "validate";
  reason: string;
};

export type SyncEventSample = {
  uid: string;
  summary: string;
  dtstart: string;
};

export type SyncDiagnostics = {
  fetchUrl: string;
  httpStatus: number;
  responseSizeBytes: number;
  parsedEventCount: number;
  earliestDtstart: string | null;
  latestDtstart: string | null;
  firstEvents: SyncEventSample[];
  lastEvents: SyncEventSample[];
  /** Future non-cancelled events we track that the source no longer lists.
   * Surfaced for review, never auto-cancelled — a truncated feed must not
   * mass-cancel real games. */
  missingFromSourceCount: number;
  missingFromSource: Array<{ eventId: string; externalId: string; summary: string; startsAt: string }>;
};

export type SyncResult = {
  added: number;
  updated: number;
  cancelled: number;
  skipped: number;
  errors: SyncEventError[];
  diagnostics?: SyncDiagnostics;
  error?: string;
};

/**
 * Strip redundant team-name prefix from an event summary.
 * "Wisconsin Athletics Women's Tennis at Purdue" → "Women's Tennis at Purdue"
 */
export function cleanSummary(raw: string): string {
  return cleanSourceSummary(raw);
}

// ── Validated event shape for DB writes ──

type ValidatedEventData = {
  externalId: string;
  summary: string;
  description: string | null;
  rawSummary: string;
  rawLocationText: string | null;
  rawDescription: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: CalendarEventStatus;
  locationId: string | null;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  site: CalendarEventSite | null;
  result: CalendarEventResult | null;
};

export type ExistingEventRow = {
  id: string;
  externalId: string;
  summary: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  locationId: string | null;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  site: CalendarEventSite | null;
  result: CalendarEventResult | null;
  summaryLocked: boolean;
  isHomeLocked: boolean;
  locationLocked: boolean;
};

type CalendarEventAuditSource = {
  externalId: string;
  summary: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  locationId: string | null;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  site: CalendarEventSite | null;
  result: CalendarEventResult | null;
};

function calendarEventAuditSnapshot(event: CalendarEventAuditSource) {
  return {
    externalId: event.externalId,
    summary: event.summary,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
    status: event.status,
    locationId: event.locationId,
    sportCode: event.sportCode,
    opponent: event.opponent,
    isHome: event.isHome,
    site: event.site,
    result: event.result,
  };
}

export type ParsedIcsEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  /** TZID params for floating local date-times (RFC 5545 §3.3.5 form two). */
  dtstartTzid?: string;
  dtendTzid?: string;
  status: string;
};

/**
 * Pure function: validates parsed events, resolves locations, and splits
 * into create vs update sets by diffing against existing DB rows.
 * Exported for testing — no DB access.
 */
export function splitEventsForSync(
  parsedEvents: ParsedIcsEvent[],
  existingRows: ExistingEventRow[],
  mappings: Array<{ pattern: string; locationId: string; isHomeVenue?: boolean; priority?: number | null; createdAt?: Date | string | null; id?: string | null }>,
) {
  const existingMap = new Map(existingRows.map((r) => [r.externalId, r]));
  const sortedMappings = sortVenueMappings(mappings);

  const toCreate: ValidatedEventData[] = [];
  const toUpdate: Array<{ id: string; data: ValidatedEventData }> = [];
  const unchanged: string[] = [];
  const skippedErrors: SyncEventError[] = [];

  for (const event of parsedEvents) {
    try {
      const startParsed = parseIcsDate(event.dtstart, event.dtstartTzid);
      const endParsed = parseIcsDate(event.dtend, event.dtendTzid);

      if (!isValidDate(startParsed.date)) throw new Error(`Invalid start date: "${event.dtstart}"`);
      if (!isValidDate(endParsed.date)) throw new Error(`Invalid end date: "${event.dtend}"`);

      const status = mapIcsStatus(event.status);
      let locationId: string | null = null;
      let mappedIsHomeVenue: boolean | null = null;
      const rawSearchText = `${event.location} ${event.summary}`.toLowerCase();
      const searchText = buildVenueSearchText(event.location, event.summary);

      for (const mapping of sortedMappings) {
        if (venueMappingMatches(mapping.pattern, searchText, rawSearchText)) {
          locationId = mapping.locationId;
          mappedIsHomeVenue = mapping.isHomeVenue ?? null;
          break;
        }
      }

      // One shared derivation, so a repaired row and a freshly synced row agree.
      const { summary: cleaned, sportCode, opponent, isHome, site, result } = classifySourceEvent({
        rawSummary: event.summary,
        rawLocationText: event.location,
        mappedIsHomeVenue,
      });

      const data: ValidatedEventData = {
        externalId: event.uid,
        summary: cleaned,
        description: event.description || null,
        rawSummary: event.summary,
        rawLocationText: event.location || null,
        rawDescription: event.description || null,
        startsAt: startParsed.date,
        endsAt: endParsed.date,
        allDay: startParsed.allDay,
        status,
        locationId,
        sportCode,
        opponent,
        isHome,
        site,
        result,
      };

      const existing = existingMap.get(event.uid);
      if (existing) {
        // Preserve manually locked fields: sync never overwrites them.
        if (existing.summaryLocked) data.summary = existing.summary;
        if (existing.isHomeLocked) {
          data.sportCode = existing.sportCode;
          data.isHome = existing.isHome;
          data.opponent = existing.opponent;
          // The lock protects the operator's choice, and that choice lives in
          // `isHome` + `opponent`. Re-deriving the site from `isHome` alone
          // could only ever say HOME, AWAY, or nothing, so a locked neutral
          // game was written back as an unknown site -- and stayed one, because
          // sync is the only writer that reaches these rows. Deriving it the
          // way Schedule reads the same row keeps a stored site authoritative
          // and gives a locked neutral game its NEUTRAL.
          data.site = resolvedEventSite(existing);
        }
        if (existing.locationLocked) data.locationId = existing.locationId;

        // A feed that drops the marker — or re-publishes a game before it is
        // played — must not erase an outcome we already captured. A present
        // marker still wins, so a corrected result overwrites.
        if (data.result === null) data.result = existing.result;

        const changed =
          existing.summary !== data.summary ||
          existing.description !== data.description ||
          existing.startsAt.getTime() !== data.startsAt.getTime() ||
          existing.endsAt.getTime() !== data.endsAt.getTime() ||
          existing.allDay !== data.allDay ||
          existing.status !== data.status ||
          existing.locationId !== data.locationId ||
          existing.sportCode !== data.sportCode ||
          existing.opponent !== data.opponent ||
          existing.isHome !== data.isHome ||
          existing.site !== data.site ||
          existing.result !== data.result;

        if (changed) {
          toUpdate.push({ id: existing.id, data });
        } else {
          unchanged.push(event.uid);
        }
      } else {
        toCreate.push(data);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      skippedErrors.push({
        uid: event.uid,
        summary: event.summary.slice(0, 120),
        operation: "validate",
        reason: reason.length > 300 ? reason.slice(0, 300) + "\u2026" : reason,
      });
    }
  }

  return { toCreate, toUpdate, unchanged, skippedErrors };
}

/**
 * Sync a single CalendarSource — fetches ICS, parses, upserts events.
 */
export async function syncCalendarSource(sourceId: string): Promise<SyncResult> {
  const source = await db.calendarSource.findUnique({ where: { id: sourceId } });
  const emptyResult: SyncResult = { added: 0, updated: 0, cancelled: 0, skipped: 0, errors: [] };

  if (!source || !source.enabled) {
    return { ...emptyResult, error: "Source not found or disabled" };
  }

  // Normalize webcal:// to https://
  const url = source.url.replace(/^webcal:\/\//, "https://");

  // SSRF guard: even though admins save these URLs, re-validate at fetch
  // time so a saved URL pointing at a private/internal IP can't be used
  // to probe internal services later.
  try {
    const { assertPublicHost } = await import("@/lib/security/ssrf");
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("non-http(s) protocol");
    }
    await assertPublicHost(parsed.hostname);
  } catch (err) {
    const error = `Refusing to fetch: ${err instanceof Error ? err.message : "invalid URL"}`;
    await db.calendarSource.update({
      where: { id: sourceId },
      data: { lastError: error, lastFetchedAt: new Date() }
    });
    return { ...emptyResult, error };
  }

  let icsText: string;
  let httpStatus = 0;
  try {
    // Timeout so a hanging feed can't hold the serverless function (and
    // starve the rest of morning-refresh); size cap so a huge or hostile
    // response can't exhaust memory.
    const response = await fetch(url, {
      headers: { "User-Agent": "GearTracker/1.0" },
      signal: AbortSignal.timeout(ICS_FETCH_TIMEOUT_MS),
    });
    httpStatus = response.status;
    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText}`;
      await db.calendarSource.update({
        where: { id: sourceId },
        data: { lastError: error, lastFetchedAt: new Date() }
      });
      return { ...emptyResult, error, diagnostics: { fetchUrl: url, httpStatus, responseSizeBytes: 0, parsedEventCount: 0, earliestDtstart: null, latestDtstart: null, firstEvents: [], lastEvents: [], missingFromSourceCount: 0, missingFromSource: [] } };
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > ICS_MAX_RESPONSE_BYTES) {
      throw new Error(`Feed too large: ${contentLength} bytes (max ${ICS_MAX_RESPONSE_BYTES})`);
    }
    icsText = await response.text();
    if (icsText.length > ICS_MAX_RESPONSE_BYTES) {
      throw new Error(`Feed too large: ${icsText.length} bytes (max ${ICS_MAX_RESPONSE_BYTES})`);
    }
  } catch (err) {
    const error = err instanceof Error && err.name === "TimeoutError"
      ? `Feed timed out after ${ICS_FETCH_TIMEOUT_MS / 1000}s`
      : err instanceof Error ? err.message : "Fetch failed";
    await db.calendarSource.update({
      where: { id: sourceId },
      data: { lastError: error, lastFetchedAt: new Date() }
    });
    return { ...emptyResult, error, diagnostics: { fetchUrl: url, httpStatus, responseSizeBytes: 0, parsedEventCount: 0, earliestDtstart: null, latestDtstart: null, firstEvents: [], lastEvents: [], missingFromSourceCount: 0, missingFromSource: [] } };
  }

  const responseSizeBytes = new TextEncoder().encode(icsText).length;
  const events = parseIcs(icsText);

  // Build diagnostics from parsed events (before any DB work)
  const SAMPLE_SIZE = 5;
  const sortedByStart = [...events].sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  const diagnostics: SyncDiagnostics = {
    fetchUrl: url,
    httpStatus,
    responseSizeBytes,
    parsedEventCount: events.length,
    earliestDtstart: sortedByStart.length > 0 ? sortedByStart[0]!.dtstart : null,
    latestDtstart: sortedByStart.length > 0 ? sortedByStart[sortedByStart.length - 1]!.dtstart : null,
    firstEvents: sortedByStart.slice(0, SAMPLE_SIZE).map((e) => ({ uid: e.uid, summary: e.summary.slice(0, 120), dtstart: e.dtstart })),
    lastEvents: sortedByStart.slice(-SAMPLE_SIZE).map((e) => ({ uid: e.uid, summary: e.summary.slice(0, 120), dtstart: e.dtstart })),
    missingFromSourceCount: 0,
    missingFromSource: [],
  };

  // ── Phase 1: Bulk-load existing data (2 queries) ──

  let mappings: Array<{ id: string; pattern: string; locationId: string; isHomeVenue?: boolean; priority: number; createdAt: Date }> = [];
  try {
    const rawMappings = await db.locationMapping.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { location: { select: { isHomeVenue: true } } },
    });
    mappings = rawMappings.map((m) => ({
      id: m.id,
      pattern: m.pattern,
      locationId: m.locationId,
      isHomeVenue: m.location.isHomeVenue,
      priority: m.priority,
      createdAt: m.createdAt,
    }));
  } catch (err) {
    console.error("[calendar-sync] Failed to load venue mappings", err);
  }

  const existingRows = await db.calendarEvent.findMany({
    where: { sourceId },
    select: {
      id: true, externalId: true, summary: true, description: true,
      startsAt: true, endsAt: true, allDay: true, status: true, locationId: true,
      sportCode: true, opponent: true, isHome: true, site: true, result: true,
      summaryLocked: true, isHomeLocked: true, locationLocked: true,
    }
  });

  // Surface future non-cancelled events that vanished from the feed (deleted
  // upstream without a CANCELLED status). Review-only: a truncated feed must
  // not mass-cancel real games, so nothing is mutated here.
  if (events.length > 0) {
    const parsedUids = new Set(events.map((e) => e.uid));
    const now = new Date();
    const vanished = existingRows.filter(
      (row) => !parsedUids.has(row.externalId) && row.status !== "CANCELLED" && row.startsAt > now,
    );
    diagnostics.missingFromSourceCount = vanished.length;
    diagnostics.missingFromSource = vanished.slice(0, SAMPLE_SIZE).map((row) => ({
      eventId: row.id,
      externalId: row.externalId,
      summary: row.summary.slice(0, 120),
      startsAt: row.startsAt.toISOString(),
    }));
  }

  // ── Phase 2: In-memory validate + diff (0 queries) ──

  const { toCreate, toUpdate, unchanged, skippedErrors } = splitEventsForSync(events, existingRows, mappings);

  let added = 0;
  const updated = toUpdate.length + unchanged.length;
  const cancelled = [...toCreate, ...toUpdate.map((u) => u.data)].filter((e) => e.status === "CANCELLED").length;
  let skipped = skippedErrors.length;
  const errors: SyncEventError[] = [...skippedErrors];
  const MAX_STORED_ERRORS = 10;
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  // ── Phase 3: Batch writes in chunks ──

  // Batch create new events
  for (let i = 0; i < toCreate.length; i += WRITE_CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + WRITE_CHUNK_SIZE);
    try {
      const created = await db.$transaction(async (tx) => {
        const inserted = await tx.calendarEvent.createManyAndReturn({
          data: chunk.map((c) => ({ sourceId, ...c })),
          skipDuplicates: true,
          select: {
            id: true,
            externalId: true,
            summary: true,
            description: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            status: true,
            locationId: true,
            sportCode: true,
            opponent: true,
            isHome: true,
            site: true,
            result: true,
          },
        });
        await createAuditEntriesTx(tx, inserted.map((event) => ({
          actorId: null,
          actorRole: null,
          entityType: "calendar_event",
          entityId: event.id,
          action: "calendar_event_created",
          after: calendarEventAuditSnapshot(event),
        })));
        return inserted;
      });
      added += created.length;
    } catch (err) {
      skipped += chunk.length;
      if (errors.length < MAX_STORED_ERRORS) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        errors.push({
          uid: chunk.map((e) => e.externalId).join(","),
          summary: `Batch create of ${chunk.length} events`,
          operation: "create",
          reason: reason.length > 300 ? reason.slice(0, 300) + "\u2026" : reason,
        });
      }
    }
  }

  // Batch update changed events (only rows that actually differ)
  for (let i = 0; i < toUpdate.length; i += WRITE_CHUNK_SIZE) {
    const chunk = toUpdate.slice(i, i + WRITE_CHUNK_SIZE);
    try {
      await db.$transaction(async (tx) => {
        await Promise.all(
          chunk.map((item) =>
            tx.calendarEvent.update({ where: { id: item.id }, data: item.data })
          )
        );
        await createAuditEntriesTx(tx, chunk.map((item) => ({
          actorId: null,
          actorRole: null,
          entityType: "calendar_event",
          entityId: item.id,
          action: "calendar_event_updated",
          before: existingById.has(item.id)
            ? calendarEventAuditSnapshot(existingById.get(item.id)!)
            : undefined,
          after: calendarEventAuditSnapshot(item.data),
        })));
      });
    } catch (err) {
      if (errors.length < MAX_STORED_ERRORS) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        errors.push({
          uid: chunk.map((item) => item.data.externalId).join(","),
          summary: `Batch update of ${chunk.length} events`,
          operation: "update",
          reason: reason.length > 300 ? reason.slice(0, 300) + "\u2026" : reason,
        });
      }
    }
  }

  // ── Phase 4: Update source metadata ──

  const lastError = errors.length > 0
    ? `${skipped} of ${events.length} events failed. ${errors.map((e) => `[${e.uid}] ${e.reason}`).join("; ")}`
    : null;

  try {
    await db.calendarSource.update({
      where: { id: sourceId },
      data: { lastFetchedAt: new Date(), lastError }
    });
  } catch {
    // If we can't update source metadata, still return results
  }

  return { added, updated, cancelled, skipped, errors, diagnostics };
}

/**
 * Sync all enabled calendar sources.
 */
export async function syncAllCalendarSources() {
  const sources = await db.calendarSource.findMany({ where: { enabled: true } });
  const results: Array<{ sourceId: string; name: string } & SyncResult> = [];

  for (const source of sources) {
    const result = await syncCalendarSource(source.id);
    results.push({ sourceId: source.id, name: source.name, ...result });
  }

  return results;
}
