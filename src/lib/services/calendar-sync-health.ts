import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SyncResult } from "@/lib/services/calendar-sync";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

const CALENDAR_SYNC_HEALTH_CONFIG_KEY = "calendar_sync_health";
const CALENDAR_SYNC_FAILURE_NOTIFY_THRESHOLD = 3;

type CalendarSyncSourceHealth = {
  sourceName?: string;
  consecutiveFailures?: number;
  lastError?: string | null;
  lastFailedAt?: string | null;
  lastSucceededAt?: string | null;
};

type CalendarSyncHealthState = {
  sources?: Record<string, CalendarSyncSourceHealth>;
};

type CalendarSyncHealthUpdate = {
  sourceId: string;
  sourceName: string;
  consecutiveFailures: number;
  failed: boolean;
  notificationsCreated: number;
};

function normalizeState(raw: unknown): Required<CalendarSyncHealthState> {
  if (!raw || typeof raw !== "object") return { sources: {} };
  const sources = (raw as CalendarSyncHealthState).sources;
  return {
    sources: sources && typeof sources === "object" ? sources : {},
  };
}

function truncate(value: string, max = 280) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function calendarSyncHardError(result: Pick<SyncResult, "error">) {
  return typeof result.error === "string" && result.error.trim()
    ? result.error.trim()
    : null;
}

export function calendarSourceFailureDetail(
  lastError: string | null,
  consecutiveFailures: number,
) {
  if (consecutiveFailures > 0) {
    const label = consecutiveFailures === 1 ? "failure" : "failures";
    return `${consecutiveFailures} consecutive ${label} / ${lastError ?? "latest error unknown"}`;
  }
  return lastError ?? "Latest sync error";
}

export async function updateCalendarSyncHealth(args: {
  sourceId: string;
  sourceName: string;
  result: SyncResult;
  now?: Date;
}): Promise<CalendarSyncHealthUpdate> {
  const now = args.now ?? new Date();
  const row = await db.systemConfig.findUnique({
    where: { key: CALENDAR_SYNC_HEALTH_CONFIG_KEY },
  });
  const current = normalizeState(row?.value);
  const previous = current.sources[args.sourceId] ?? {};
  const error = calendarSyncHardError(args.result);
  const consecutiveFailures = error
    ? (previous.consecutiveFailures ?? 0) + 1
    : 0;

  const nextState: Required<CalendarSyncHealthState> = {
    sources: {
      ...current.sources,
      [args.sourceId]: {
        sourceName: args.sourceName,
        consecutiveFailures,
        lastError: error,
        lastFailedAt: error ? now.toISOString() : previous.lastFailedAt ?? null,
        lastSucceededAt: error ? previous.lastSucceededAt ?? null : now.toISOString(),
      },
    },
  };

  await db.systemConfig.upsert({
    where: { key: CALENDAR_SYNC_HEALTH_CONFIG_KEY },
    update: { value: nextState as Prisma.InputJsonValue },
    create: {
      key: CALENDAR_SYNC_HEALTH_CONFIG_KEY,
      value: nextState as Prisma.InputJsonValue,
    },
  });

  if (!error || consecutiveFailures < CALENDAR_SYNC_FAILURE_NOTIFY_THRESHOLD) {
    return {
      sourceId: args.sourceId,
      sourceName: args.sourceName,
      consecutiveFailures,
      failed: Boolean(error),
      notificationsCreated: 0,
    };
  }

  const admins = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });
  if (admins.length === 0) {
    return {
      sourceId: args.sourceId,
      sourceName: args.sourceName,
      consecutiveFailures,
      failed: true,
      notificationsCreated: 0,
    };
  }

  const title = `Calendar sync failing: ${args.sourceName}`;
  const body = `${args.sourceName} has failed ${consecutiveFailures} consecutive daily syncs. Latest error: ${truncate(error)}`;
  const notifications = admins.map((admin) => ({
    userId: admin.id,
    type: "calendar_sync_failure",
    title,
    body,
    payload: {
      sourceId: args.sourceId,
      sourceName: args.sourceName,
      consecutiveFailures,
      error,
      href: "/settings/calendar-sources",
    },
    channel: "IN_APP" as const,
    sentAt: now,
    dedupeKey: `calendar_sync_failure:${args.sourceId}:${consecutiveFailures}:${admin.id}`,
  }));

  const created = await db.notification.createMany({
    data: notifications,
    skipDuplicates: true,
  });

  return {
    sourceId: args.sourceId,
    sourceName: args.sourceName,
    consecutiveFailures,
    failed: true,
    notificationsCreated: created.count,
  };
}

export async function getCalendarSyncFailureCounts() {
  const row = await db.systemConfig.findUnique({
    where: { key: CALENDAR_SYNC_HEALTH_CONFIG_KEY },
  });
  const state = normalizeState(row?.value);
  const counts = new Map<string, number>();
  for (const [sourceId, source] of Object.entries(state.sources)) {
    counts.set(sourceId, source.consecutiveFailures ?? 0);
  }
  return counts;
}
