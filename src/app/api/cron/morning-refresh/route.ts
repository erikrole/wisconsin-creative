import { NextResponse } from "next/server";
import { withCron } from "@/lib/cron";
import { db } from "@/lib/db";
import { syncCalendarSource } from "@/lib/services/calendar-sync";
import { updateCalendarSyncHealth } from "@/lib/services/calendar-sync-health";
import { generateShiftsForNewEvents } from "@/lib/services/shift-generation";
import { expireOpenTrades } from "@/lib/services/shift-trades";
import { expirePickupNoShows } from "@/lib/services/pending-pickup-expiry";
import { pollFirmwareWatchTargets } from "@/lib/services/firmware-watch";
import { DEFAULT_RESERVATION_RULES } from "@/lib/services/reservation-rules";
import { getScheduleAutomationDigest } from "@/lib/services/schedule-automation";
import { refreshCompanionProjection } from "@/lib/services/companion-projection";
import { cleanupPendingSignatureArtifacts } from "@/lib/services/signatures";
import { pruneNotificationDeliveries } from "@/lib/services/notification-deliveries";
import { pruneAppDiagnostics } from "@/lib/services/app-diagnostics";
import { pruneJobRuns, recordJobRun } from "@/lib/services/job-runs";
import { badges, badgesEnabled } from "@/lib/badges";
import { recentlyWorkedEventUsers } from "@/lib/badges/worked-evidence";

function maintenanceValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  failures: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  console.error(`morning-refresh: ${label} failed`, result.reason);
  failures.push(label);
  return fallback;
}

/** How far back to look for shifts that just finished. The cron runs nightly;
 *  two days is that cadence plus slack for a missed or delayed run. */
const SHIFT_BADGE_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Wall-clock budget shared by the two fan-out loops below, matching the
 * rehost-images cron: the Hobby 10s function budget minus room for the
 * maintenance steps and the response. Whatever is left over carries to the
 * next nightly run and is reported as `sourcesSkipped` / `shiftBadgeUsersRemaining`.
 */
const DEADLINE_MS = 8000;
/** Each source is an external ICS fetch plus two writes, so keep the fan-out
 *  small enough that one slow calendar host cannot starve the others. */
const SOURCE_CONCURRENCY = 3;
/** Badge evaluation is database-only and tolerates a wider batch. */
const SHIFT_BADGE_CONCURRENCY = 5;

/** Events older than this many months are soft-archived (archivedAt stamped). */
const EVENT_ARCHIVE_MONTHS = 4;
const PRODUCT_EVENT_RETENTION_DAYS = 90;

/**
 * Nightly 3 AM Central refresh (08:00 UTC):
 *   1. Sync all enabled calendar sources (fetch ICS, upsert events)
 *   2. Generate shifts for any newly synced events
 *   3. Archive shift groups for events that have ended, and award shift badges
 *      for the crew whose shifts just finished
 *   4. Archive calendar events older than EVENT_ARCHIVE_MONTHS
 *   5. Expire stale open trades and pending kiosk pickups
 *   6. Poll official firmware watch targets
 *   7. Retry private signature artifact cleanup
 *
 * Operational history is archived rather than deleted. The privacy-bounded
 * product-event stream is the sole exception and expires after 90 days.
 */
export const GET = withCron(async () => {
  const now = new Date();
  const syncResults: Array<{
    sourceId: string;
    sourceName: string;
    eventsAdded?: number;
    eventsUpdated?: number;
    groupsCreated?: number;
    shiftsCreated?: number;
    error?: string;
    consecutiveFailures?: number;
    adminNotificationsCreated?: number;
  }> = [];

  // ── 1. Sync all enabled calendar sources ──────────────────────────────
  const sources = await db.calendarSource.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Bounded concurrency with a deadline: each source stays atomic (its own
  // try/catch plus a health write), so a skipped source simply carries over.
  const deadlineStart = Date.now();
  let sourcesSkipped = 0;
  for (let i = 0; i < sources.length; i += SOURCE_CONCURRENCY) {
    if (Date.now() - deadlineStart > DEADLINE_MS) {
      sourcesSkipped = sources.length - i;
      break;
    }
    await Promise.all(sources.slice(i, i + SOURCE_CONCURRENCY).map(async (source) => {
      try {
        const syncResult = await syncCalendarSource(source.id);
        const shiftResult = await generateShiftsForNewEvents(source.id);
        const healthResult = await recordCalendarSyncHealth({
          sourceId: source.id,
          sourceName: source.name,
          result: syncResult,
          now,
        });

        syncResults.push({
          sourceId: source.id,
          sourceName: source.name,
          eventsAdded: syncResult.added ?? 0,
          eventsUpdated: syncResult.updated ?? 0,
          groupsCreated: shiftResult.groupsCreated,
          shiftsCreated: shiftResult.shiftsCreated,
          error: syncResult.error,
          consecutiveFailures: healthResult.consecutiveFailures,
          adminNotificationsCreated: healthResult.notificationsCreated,
        });
      } catch (err) {
        console.error(`morning-refresh: sync failed for source ${source.name}:`, err);
        const error = err instanceof Error ? err.message : "Unknown error";
        const healthResult = await recordCalendarSyncHealth({
          sourceId: source.id,
          sourceName: source.name,
          result: { added: 0, updated: 0, cancelled: 0, skipped: 0, errors: [], error },
          now,
        });
        syncResults.push({
          sourceId: source.id,
          sourceName: source.name,
          error,
          consecutiveFailures: healthResult.consecutiveFailures,
          adminNotificationsCreated: healthResult.notificationsCreated,
        });
      }
    }));
  }

  // ── 2. Archive completed shift groups ─────────────────────────────────
  const { count: archived } = await db.shiftGroup.updateMany({
    where: {
      archivedAt: null,
      event: { endsAt: { lt: now } },
    },
    data: { archivedAt: now },
  });

  // ── 2b. Recognise shift work that just finished ──────────────────────
  // Nothing calls the server when a game ends, so this is the one badge family
  // without a request to hang itself on. It is bounded to people whose shift or
  // admin-added worker row ended in the last couple of days -- the nightly cadence plus slack -- and
  // each evaluation recounts that person's full history, so a first qualifying
  // shift awards every threshold they had already passed.
  let shiftBadgeUsers = 0;
  let shiftBadgeUsersRemaining = 0;
  if (badgesEnabled()) {
    try {
      const recentlyEnded = await recentlyWorkedEventUsers(
        new Date(now.getTime() - SHIFT_BADGE_LOOKBACK_MS),
        now,
      );

      // Same bounded-concurrency + deadline shape as the source loop. Each
      // person's evaluation is independent and idempotent, so anyone skipped is
      // simply picked up by the next run.
      for (let i = 0; i < recentlyEnded.length; i += SHIFT_BADGE_CONCURRENCY) {
        if (Date.now() - deadlineStart > DEADLINE_MS) break;
        const batch = recentlyEnded.slice(i, i + SHIFT_BADGE_CONCURRENCY);
        await Promise.all(
          batch.map(({ userId, hasAddedWorker, hasBackfilledAssignment }) =>
            badges.onShiftsWorked(
              { userId },
              { notify: !(hasAddedWorker || hasBackfilledAssignment) },
            ),
          ),
        );
        shiftBadgeUsers += batch.length;
      }
      shiftBadgeUsersRemaining = recentlyEnded.length - shiftBadgeUsers;
    } catch (err) {
      console.error("morning-refresh: shift badge step failed", err);
    }
  }

  // ── 3. Archive old calendar events ───────────────────────────────────
  const archiveCutoff = new Date(now);
  archiveCutoff.setMonth(archiveCutoff.getMonth() - EVENT_ARCHIVE_MONTHS);
  const eventsArchived = await db.calendarEvent
    .updateMany({
      where: { endsAt: { lt: archiveCutoff }, archivedAt: null },
      data: { archivedAt: now },
    })
    .then((r) => r.count)
    .catch((err) => {
      console.error("morning-refresh: event archive step failed", err);
      return 0;
    });

  // ── 4. Expire stale open/claimed trades and pickup no-shows ─────────
  const productEventCutoff = new Date(now.getTime() - PRODUCT_EVENT_RETENTION_DAYS * 86_400_000);
  const [tradeResult, pendingPickupResult, firmwareWatchResult, productEventRetentionResult, signatureCleanupResult, deliveryRetentionResult, telemetryRetentionResult] = await Promise.allSettled([
    expireOpenTrades(),
    expirePickupNoShows(now),
    pollFirmwareWatchTargets({ now }),
    Promise.resolve().then(() => db.productEvent.deleteMany({ where: { occurredAt: { lt: productEventCutoff } } })),
    cleanupPendingSignatureArtifacts(),
    pruneNotificationDeliveries(now),
    Promise.all([pruneAppDiagnostics(now), pruneJobRuns(now)]),
  ]);
  const maintenanceFailures: string[] = [];
  const { expired: tradesExpired } = maintenanceValue(
    tradeResult,
    { expired: 0 },
    "tradesExpired",
    maintenanceFailures,
  );
  const pendingPickups = maintenanceValue(
    pendingPickupResult,
    {
      scanned: 0,
      expired: 0,
      failed: 1,
      cutoff: new Date(now.getTime() - DEFAULT_RESERVATION_RULES.noShowExpiryHours * 3_600_000),
      errors: { pendingPickups: "Pending pickup expiry failed" },
    },
    "pendingPickups",
    maintenanceFailures,
  );
  if (pendingPickups.expired > 0) {
    try {
      await refreshCompanionProjection({ notify: true });
    } catch (error) {
      console.error("morning-refresh: companion projection publication failed", error);
      maintenanceFailures.push("companionProjection");
    }
  }
  const firmwareWatch = maintenanceValue(
    firmwareWatchResult,
    {
      checked: 0,
      changed: 0,
      baselined: 0,
      failed: 1,
      skipped: 0,
      notificationsCreated: 0,
      errors: [{ targetId: "unknown", product: "Firmware watch", error: "Firmware watch failed" }],
    },
    "firmwareWatch",
    maintenanceFailures,
  );
  const productEventsDeleted = maintenanceValue(
    productEventRetentionResult,
    { count: 0 },
    "productEventRetention",
    maintenanceFailures,
  ).count;
  const notificationDeliveriesDeleted = maintenanceValue(
    deliveryRetentionResult,
    0,
    "notificationDeliveryRetention",
    maintenanceFailures,
  );
  maintenanceValue(telemetryRetentionResult, [0, 0], "telemetryRetention", maintenanceFailures);
  const signatureCleanup = maintenanceValue(
    signatureCleanupResult,
    { abandoned: 0, attempted: 0, deleted: 0 },
    "signatureCleanup",
    maintenanceFailures,
  );
  const automationDigest = await getScheduleAutomationDigest({
    userId: "system",
    includePast: false,
    includeArchived: false,
    sportCode: null,
    now,
    maintenance: {
      syncResults,
      shiftGroupsArchived: archived,
      eventsArchived,
      tradesExpired,
      pendingPickupsExpired: pendingPickups.expired,
    },
  }).catch((err) => {
    console.error("morning-refresh: schedule automation digest failed", err);
    maintenanceFailures.push("scheduleAutomation");
    return null;
  });

  // Scheduled for 08:00 UTC in vercel.json; lateness shows cron drift.
  const scheduledAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8));
  await recordJobRun({
    job: "morning_refresh",
    outcome: maintenanceFailures.length === 0 ? "succeeded" : "failed",
    dueAt: scheduledAt,
    detail: maintenanceFailures.length === 0 ? null : maintenanceFailures.join(","),
  });

  return NextResponse.json({
    ok: maintenanceFailures.length === 0,
    runAt: now.toISOString(),
    sourcesProcessed: sources.length,
    sourcesSkipped,
    syncResults,
    shiftGroupsArchived: archived,
    shiftBadgeUsers,
    shiftBadgeUsersRemaining,
    deadlineExceeded: sourcesSkipped > 0 || shiftBadgeUsersRemaining > 0 || firmwareWatch.skipped > 0,
    eventsArchived,
    tradesExpired,
    pendingPickups,
    firmwareWatch,
    productEventsDeleted,
    notificationDeliveriesDeleted,
    signatureCleanup,
    scheduleAutomation: automationDigest,
    maintenanceFailures,
  });
});

async function recordCalendarSyncHealth(args: {
  sourceId: string;
  sourceName: string;
  result: Awaited<ReturnType<typeof syncCalendarSource>>;
  now: Date;
}) {
  try {
    return await updateCalendarSyncHealth(args);
  } catch (err) {
    console.error(`morning-refresh: sync health update failed for source ${args.sourceName}:`, err);
    return {
      sourceId: args.sourceId,
      sourceName: args.sourceName,
      consecutiveFailures: 0,
      failed: Boolean(args.result.error),
      notificationsCreated: 0,
    };
  }
}
