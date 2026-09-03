import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { cleanSummary } from "@/lib/services/calendar-sync";
import { classifySourceEvent, normalizeOpponentName } from "@/lib/schedule-event-identity";
import { nullableSportCodeSchema } from "@/lib/validation";
import { isHomeFromVenueTone, resolvedEventSite, siteFromVenueTone, VENUE_TONE_VALUES } from "@/lib/venue-tone";
import { z } from "zod";
import { normalizeManualEventTitle } from "@/lib/title-normalization";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { normalizeAllDayToUtcMidnight } from "@/lib/app-time";
import { shiftManualEventScheduleTx } from "@/lib/services/manual-event-time";
import { withSerializationRetry } from "@/lib/serialization";
import { after } from "next/server";
import { notifyPublishedScheduleFollowers, notifyPublishedShiftGroupWorkers } from "@/lib/services/notifications";

const patchSchema = z
  .object({
    summary: z.string().min(1).max(200).optional(),
    subtitle: z.string().max(100).nullable().optional(),
    eventType: z.enum(VENUE_TONE_VALUES).optional(),
    sportCode: nullableSportCodeSchema.optional(),
    opponent: z.string().max(120).nullable().optional(),
    locationId: z.string().cuid().nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    allDay: z.boolean().optional(),
    revertTitle: z.literal(true).optional(),
    revertHomeAway: z.literal(true).optional(),
    revertLocation: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.opponent !== undefined && value.eventType === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventType"],
        message: "Event type is required when changing the opponent",
      });
    }
    if (value.revertHomeAway && (value.eventType !== undefined || value.sportCode !== undefined || value.opponent !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revertHomeAway"],
        message: "Restore calendar value cannot be combined with event classification edits",
      });
    }
    if ((value.startsAt === undefined) !== (value.endsAt === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: value.startsAt === undefined ? ["startsAt"] : ["endsAt"],
        message: "Start and end are required together",
      });
    }
    if (value.allDay !== undefined && (value.startsAt === undefined || value.endsAt === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allDay"],
        message: "Start and end are required when changing event timing mode",
      });
    }
  })
  .refine(
    (v) =>
      v.summary !== undefined ||
      v.subtitle !== undefined ||
      v.eventType !== undefined ||
      v.sportCode !== undefined ||
      v.opponent !== undefined ||
      v.locationId !== undefined ||
      v.startsAt !== undefined ||
      v.endsAt !== undefined ||
      v.allDay !== undefined ||
      v.revertTitle !== undefined ||
      v.revertHomeAway !== undefined ||
      v.revertLocation !== undefined,
    { message: "At least one field is required" },
  );

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  if (user.role !== "ADMIN" && user.role !== "STAFF") {
    throw new HttpError(403, "Only staff and admins can edit events");
  }
  await enforceRateLimit(`calendar-event:write:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const { id } = params;
  const rawBody = await req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  const body = patchSchema.parse(rawBody);

  const mutation = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const existing = await tx.calendarEvent.findUnique({
      where: { id },
      select: {
        id: true,
        sourceId: true,
        summary: true,
        subtitle: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        sportCode: true,
        isHome: true,
        site: true,
        locationId: true,
        rawSummary: true,
        rawLocationText: true,
        opponent: true,
        summaryLocked: true,
        isHomeLocked: true,
        locationLocked: true,
        location: { select: { isHomeVenue: true } },
      },
    });
    if (!existing) throw new HttpError(404, "Event not found");

    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let scheduleShift = null;

    if (body.allDay !== undefined || body.startsAt !== undefined || body.endsAt !== undefined) {
      if (existing.sourceId !== null) {
        throw new HttpError(400, "Imported event times are controlled by their calendar source");
      }
      if (body.startsAt === undefined || body.endsAt === undefined) {
        throw new HttpError(400, "Start and end are required when changing event timing mode");
      }
      const rawStart = new Date(body.startsAt);
      const rawEnd = new Date(body.endsAt);
      const nextAllDay = body.allDay ?? existing.allDay;
      const nextStartsAt = nextAllDay ? normalizeAllDayToUtcMidnight(rawStart) : rawStart;
      const nextEndsAt = nextAllDay ? normalizeAllDayToUtcMidnight(rawEnd) : rawEnd;
      if (nextEndsAt <= nextStartsAt) {
        throw new HttpError(400, "End must be after start");
      }

      before.startsAt = existing.startsAt.toISOString();
      before.endsAt = existing.endsAt.toISOString();
      patch.startsAt = nextStartsAt;
      patch.endsAt = nextEndsAt;
      after.startsAt = nextStartsAt.toISOString();
      after.endsAt = nextEndsAt.toISOString();
      if (nextAllDay !== existing.allDay) {
        before.allDay = existing.allDay;
        patch.allDay = nextAllDay;
        after.allDay = nextAllDay;
      }
      scheduleShift = await shiftManualEventScheduleTx(tx, {
        eventId: id,
        previousStartsAt: existing.startsAt,
        previousEndsAt: existing.endsAt,
        nextStartsAt,
        nextEndsAt,
        actor: user,
      });
    }

    if (body.subtitle !== undefined) {
      before.subtitle = existing.subtitle;
      patch.subtitle = body.subtitle === "" ? null : body.subtitle;
      after.subtitle = patch.subtitle;
    }

    if (body.revertTitle) {
      before.summary = existing.summary;
      before.summaryLocked = existing.summaryLocked;
      const derived = existing.rawSummary
        ? cleanSummary(existing.rawSummary)
        : existing.summary;
      patch.summary = derived;
      patch.summaryLocked = false;
      after.summary = patch.summary;
      after.summaryLocked = false;
    } else if (body.summary !== undefined) {
      before.summary = existing.summary;
      before.summaryLocked = existing.summaryLocked;
      patch.summary = existing.sourceId === null
        ? normalizeManualEventTitle(body.summary)
        : body.summary.trim();
      patch.summaryLocked = true;
      after.summary = patch.summary;
      after.summaryLocked = true;
    }

    if (body.revertHomeAway) {
      before.isHome = existing.isHome;
      before.isHomeLocked = existing.isHomeLocked;
      before.site = existing.site;
      before.opponent = existing.opponent;
      before.sportCode = existing.sportCode;
      let derived = {
        isHome: null as boolean | null,
        site: null as "HOME" | "AWAY" | "NEUTRAL" | null,
        opponent: null as string | null,
        sportCode: null as string | null,
      };
      if (existing.rawSummary) {
        const classified = classifySourceEvent({
          rawSummary: existing.rawSummary,
          rawLocationText: existing.rawLocationText,
          mappedIsHomeVenue: existing.location?.isHomeVenue ?? null,
        });
        derived = {
          isHome: classified.isHome,
          site: classified.site,
          opponent: classified.opponent,
          sportCode: classified.sportCode,
        };
      }
      patch.isHome = derived.isHome;
      patch.site = derived.site;
      patch.opponent = derived.opponent;
      patch.sportCode = derived.sportCode;
      patch.isHomeLocked = false;
      after.isHome = derived.isHome;
      after.site = derived.site;
      after.opponent = derived.opponent;
      after.sportCode = derived.sportCode;
      after.isHomeLocked = false;
    } else if (body.eventType !== undefined) {
      const normalizedOpponent = body.eventType === "non-game"
        ? null
        : normalizeOpponentName(body.opponent ?? existing.opponent);
      const effectiveSportCode = body.sportCode !== undefined ? body.sportCode : existing.sportCode;
      if (body.eventType !== "non-game" && !effectiveSportCode) {
        throw new HttpError(400, "Sport is required for a game event");
      }
      if (body.eventType !== "non-game" && !normalizedOpponent) {
        throw new HttpError(400, "Opponent is required for a game event");
      }

      before.isHome = existing.isHome;
      before.isHomeLocked = existing.isHomeLocked;
      before.site = existing.site;
      before.opponent = existing.opponent;
      before.sportCode = existing.sportCode;
      patch.isHome = isHomeFromVenueTone(body.eventType);
      patch.site = siteFromVenueTone(body.eventType);
      patch.opponent = normalizedOpponent;
      patch.sportCode = effectiveSportCode;
      patch.isHomeLocked = true;
      after.isHome = patch.isHome;
      after.site = patch.site;
      after.opponent = patch.opponent;
      after.sportCode = patch.sportCode;
      after.isHomeLocked = true;
    } else if (body.sportCode !== undefined) {
      if (existing.opponent && !body.sportCode) {
        throw new HttpError(400, "Sport is required for a game event");
      }
      before.sportCode = existing.sportCode;
      before.isHomeLocked = existing.isHomeLocked;
      patch.sportCode = body.sportCode;
      patch.isHomeLocked = true;
      after.sportCode = patch.sportCode;
      after.isHomeLocked = true;
      // Changing only the sport still sets the home/away lock, which shuts sync
      // out of this row's classification for good. Locking a row that has no
      // stored site froze it as an unknown one, so capture the site the row
      // already implies at the moment the lock goes on.
      if (existing.site === null) {
        const locked = resolvedEventSite(existing);
        if (locked !== null) {
          before.site = existing.site;
          patch.site = locked;
          after.site = locked;
        }
      }
    }

    if (body.revertLocation) {
      before.locationId = existing.locationId;
      before.locationLocked = existing.locationLocked;
      patch.locationLocked = false;
      after.locationId = existing.locationId;
      after.locationLocked = false;
    } else if (body.locationId !== undefined) {
      before.locationId = existing.locationId;
      before.locationLocked = existing.locationLocked;
      patch.locationId = body.locationId;
      patch.locationLocked = body.locationId !== null;
      after.locationId = body.locationId;
      after.locationLocked = patch.locationLocked;
    }

    const result = await tx.calendarEvent.update({
      where: { id },
      data: patch,
      select: {
        id: true,
        summary: true,
        subtitle: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        sportCode: true,
        isHome: true,
        site: true,
        opponent: true,
        locationId: true,
        summaryLocked: true,
        isHomeLocked: true,
        locationLocked: true,
        location: { select: { id: true, name: true } },
      },
    });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "calendar_event",
      entityId: id,
      action: "calendar_event_updated",
      before,
      after,
    });

    return { event: result, scheduleShift };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  if (mutation.scheduleShift?.published) {
    after(() => Promise.allSettled([
      notifyPublishedShiftGroupWorkers(
        mutation.scheduleShift!.shiftGroupId,
        mutation.scheduleShift!.affectedUserIds,
      ),
      notifyPublishedScheduleFollowers(mutation.scheduleShift!.shiftGroupId),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("Manual event time-change notification failed", result.reason);
        }
      }
    }));
  }

  return ok({ data: mutation.event });
});

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "calendar_source", "view");
  const { id } = params;

  const event = await db.calendarEvent.findUnique({
    where: { id },
    include: {
      location: { select: { id: true, name: true } },
      source: { select: { id: true, name: true } },
      combinedInto: { select: { id: true, summary: true } },
      combinedEvents: {
        select: { id: true, summary: true, startsAt: true, endsAt: true, allDay: true, sportCode: true },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      },
    }
  });

  if (!event) {
    throw new HttpError(404, "Event not found");
  }

  return ok({ data: event });
});
