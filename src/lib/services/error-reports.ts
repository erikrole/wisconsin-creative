import { Prisma } from "@prisma/client";
import { appTzDateKey, startOfDayInAppTz } from "@/lib/app-time";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import {
  boundBreadcrumbs,
  errorTitle,
  scrubSecrets,
  versionLabel,
  type Breadcrumb,
  type ErrorReportInput,
} from "@/lib/error-reporting/grouping";
import { fingerprintFor } from "@/lib/error-reporting/fingerprint";
import type { Role } from "@prisma/client";

/**
 * Crash and error reports from every client, grouped into issues. Writes are
 * small and bounded so a crash loop cannot run up database cost: an issue
 * stores at most EVENTS_PER_HOUR occurrences an hour (its count still goes
 * up), keeps the newest MAX_EVENTS_PER_ISSUE, and everything is pruned after
 * ERROR_RETENTION_DAYS.
 */

export const ERROR_RETENTION_DAYS = 90;
export const SUPPORT_REPORT_RETENTION_DAYS = 365;
const MAX_EVENTS_PER_ISSUE = 50;
const EVENTS_PER_HOUR = 20;
const MAX_MESSAGE = 1_000;
const MAX_STACK = 16_000;
const DIGEST_JOIN_WINDOW_MS = 30 * 60_000;
const RELATED_ISSUE_WINDOW_MS = 30 * 60_000;

export const ISSUE_STATUSES = ["open", "resolved", "ignored"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export type ReportActor = { id: string; role: Role | string } | null;

export type RecordResult = { issueId: string; stored: boolean; isNew: boolean; regressed: boolean };

/** Client context is flat and small: at most 20 keys, strings scrubbed and cut. */
function boundContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return Object.fromEntries(
    Object.entries(context)
      .slice(0, 20)
      .map(([key, value]) => [key.slice(0, 40), typeof value === "string" ? scrubSecrets(value.slice(0, 300)) : value]),
  );
}

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
}

/**
 * A browser report for a server render failure only knows the digest. When the
 * server already logged that digest, add what the browser saw (screen, recent
 * actions, person) to that occurrence instead of opening a second issue.
 */
async function joinServerRenderEvent(input: ErrorReportInput, actor: ReportActor): Promise<RecordResult | null> {
  if (!input.digest || input.platform !== "web") return null;
  // Next digests hash the error, so two people hitting the same render
  // failure share one. Only a server event nobody has claimed yet (or this
  // person already claimed) takes this browser's context; otherwise the report
  // goes through as its own occurrence, never onto someone else's.
  const match = await db.errorEvent.findFirst({
    where: {
      digest: input.digest,
      platform: "server",
      occurredAt: { gte: new Date(Date.now() - DIGEST_JOIN_WINDOW_MS) },
      breadcrumbs: { equals: Prisma.DbNull },
      OR: [{ userId: null }, ...(actor ? [{ userId: actor.id }] : [])],
    },
    orderBy: { occurredAt: "desc" },
    select: { id: true, issueId: true, userId: true, screen: true, context: true },
  });
  if (!match) return null;
  const crumbs = boundBreadcrumbs(input.breadcrumbs);
  await db.errorEvent.update({
    where: { id: match.id },
    data: {
      userId: match.userId ?? actor?.id ?? null,
      role: actor?.role ? String(actor.role) : undefined,
      screen: match.screen ?? input.screen ?? null,
      breadcrumbs: json(crumbs),
      context: json({
        ...(match.context && typeof match.context === "object" ? (match.context as Record<string, unknown>) : {}),
        browser: { appBuild: input.appBuild ?? null, osVersion: input.osVersion ?? null, deviceModel: input.deviceModel ?? null },
      }),
    },
  });
  return { issueId: match.issueId, stored: true, isNew: false, regressed: false };
}

async function upsertIssue(input: ErrorReportInput, occurredAt: Date) {
  const fingerprint = fingerprintFor(input);
  const version = versionLabel(input.appVersion, input.appBuild);
  const select = { id: true, status: true, eventCount: true, resolvedAt: true } as const;
  const write = () =>
    db.errorIssue.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        platform: input.platform,
        kind: input.kind,
        title: errorTitle(input),
        culprit: input.culprit?.slice(0, 200) ?? null,
        eventCount: 1,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
        firstVersion: version,
        lastVersion: version,
      },
      update: {
        eventCount: { increment: 1 },
        lastSeenAt: occurredAt,
        ...(version ? { lastVersion: version } : {}),
      },
      select,
    });
  try {
    return await write();
  } catch (error) {
    // Two first occurrences racing on the unique fingerprint: the loser retries as an update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return write();
    throw error;
  }
}

export async function recordErrorReport(raw: ErrorReportInput, actor: ReportActor = null): Promise<RecordResult> {
  // Scrubbed before anything else, so titles and fingerprints never carry a secret either.
  const input: ErrorReportInput = {
    ...raw,
    message: scrubSecrets(raw.message),
    stack: scrubSecrets(raw.stack),
    screen: scrubSecrets(raw.screen),
  };
  const joined = await joinServerRenderEvent(input, actor);
  if (joined) return joined;

  const occurredAt = input.occurredAt ?? new Date();
  const issue = await upsertIssue(input, occurredAt);
  const isNew = issue.eventCount === 1;

  // A resolved issue reopens only for an occurrence after the fix was marked;
  // MetricKit delivers up to a day late, so an old crash is not a regression.
  let regressed = false;
  if (issue.status === "resolved" && (!issue.resolvedAt || occurredAt > issue.resolvedAt)) {
    const { count } = await db.errorIssue.updateMany({
      where: { id: issue.id, status: "resolved" },
      data: { status: "open", regressedAt: new Date() },
    });
    regressed = count > 0;
  }

  const recent = isNew
    ? 0
    : await db.errorEvent.count({
        where: { issueId: issue.id, occurredAt: { gte: new Date(Date.now() - 60 * 60_000) } },
      });
  if (recent >= EVENTS_PER_HOUR) return { issueId: issue.id, stored: false, isNew, regressed };

  await db.errorEvent.create({
    data: {
      issueId: issue.id,
      occurredAt,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      appBuild: input.appBuild ?? null,
      releaseChannel: input.releaseChannel ?? null,
      osVersion: input.osVersion ?? null,
      deviceModel: input.deviceModel ?? null,
      userId: actor?.id ?? null,
      role: actor?.role ? String(actor.role) : null,
      screen: input.screen?.slice(0, 300) ?? null,
      requestId: input.requestId?.slice(0, 120) ?? null,
      digest: input.digest?.slice(0, 64) ?? null,
      message: (input.message || "(no message)").slice(0, MAX_MESSAGE),
      stack: input.stack?.slice(0, MAX_STACK) ?? null,
      breadcrumbs: json(boundBreadcrumbs(input.breadcrumbs)),
      context: json(boundContext(input.context)),
      callStack: json(input.callStack),
    },
  });

  if (isNew || regressed) await notifyAdminsOfIssue(issue.id, input, regressed);
  return { issueId: issue.id, stored: true, isNew, regressed };
}

export async function recordErrorReports(inputs: ErrorReportInput[], actor: ReportActor = null): Promise<RecordResult[]> {
  const results: RecordResult[] = [];
  for (const input of inputs) results.push(await recordErrorReport(input, actor));
  return results;
}

/** One inbox row per admin when an issue first appears or comes back. */
async function notifyAdminsOfIssue(issueId: string, input: ErrorReportInput, regressed: boolean): Promise<void> {
  // Browser network blips and slow launches are triage material, not alerts.
  if (input.kind === "app_launch" || input.kind === "disk_write_exception") return;
  try {
    const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    if (admins.length === 0) return;
    const title = regressed ? "A fixed problem is back" : "New problem reported";
    const now = new Date();
    await db.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: "error_issue",
        title,
        body: `${platformLabel(input.platform)}: ${errorTitle(input)}`.slice(0, 240),
        payload: { href: `/issues/${issueId}`, issueId },
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `error_issue:${issueId}:${regressed ? `regressed:${appTzDateKey(now)}` : "new"}:${admin.id}`,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error("event=error_issue_notify_failed", { issueId, error: error instanceof Error ? error.message : String(error) });
  }
}

export function platformLabel(platform: string): string {
  return (
    { web: "Web", server: "Server", ios: "iPhone app", kiosk: "Kiosk", macos: "Mac app" } as Record<string, string>
  )[platform] ?? platform;
}

// ── Reads for the Issues page ──────────────────────────────────────────────

export type IssueListFilters = { status?: IssueStatus | "all"; platform?: string; q?: string };

export async function listIssues(filters: IssueListFilters = {}) {
  const where: Prisma.ErrorIssueWhereInput = {
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
    ...(filters.platform ? { platform: filters.platform } : {}),
    ...(filters.q ? { OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { culprit: { contains: filters.q, mode: "insensitive" } }] } : {}),
  };
  // Fourteen Madison calendar days ending today, so an evening crash lands on
  // the day it happened rather than the next UTC day.
  const now = new Date();
  const since = startOfDayInAppTz(now, -13);
  const [issues, statusCounts] = await Promise.all([
    db.errorIssue.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: 200 }),
    db.errorIssue.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const ids = issues.map((issue) => issue.id);
  const [daily, users] = ids.length
    ? await Promise.all([
        db.$queryRaw<Array<{ issue_id: string; day: string; n: number }>>`
          SELECT issue_id,
                 to_char(occurred_at AT TIME ZONE 'UTC' AT TIME ZONE ${env.appTimezone}::text, 'YYYY-MM-DD') AS day,
                 count(*)::int AS n
          FROM error_events
          WHERE issue_id IN (${Prisma.join(ids)}) AND occurred_at >= ${since}
          GROUP BY 1, 2`,
        db.$queryRaw<Array<{ issue_id: string; n: number }>>`
          SELECT issue_id, count(DISTINCT user_id)::int AS n
          FROM error_events
          WHERE issue_id IN (${Prisma.join(ids)}) AND user_id IS NOT NULL
          GROUP BY 1`,
      ])
    : [[], []];

  const dayKeys = Array.from({ length: 14 }, (_, index) => appTzDateKey(startOfDayInAppTz(now, index - 13)));
  const dailyByIssue = new Map<string, Map<string, number>>();
  for (const row of daily) {
    const map = dailyByIssue.get(row.issue_id) ?? new Map<string, number>();
    map.set(row.day, row.n);
    dailyByIssue.set(row.issue_id, map);
  }
  const usersByIssue = new Map(users.map((row) => [row.issue_id, row.n]));

  return {
    counts: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])) as Partial<Record<IssueStatus, number>>,
    issues: issues.map((issue) => ({
      id: issue.id,
      platform: issue.platform,
      kind: issue.kind,
      title: issue.title,
      culprit: issue.culprit,
      status: issue.status,
      eventCount: issue.eventCount,
      userCount: usersByIssue.get(issue.id) ?? 0,
      firstSeenAt: issue.firstSeenAt.toISOString(),
      lastSeenAt: issue.lastSeenAt.toISOString(),
      firstVersion: issue.firstVersion,
      lastVersion: issue.lastVersion,
      regressedAt: issue.regressedAt?.toISOString() ?? null,
      daily: dayKeys.map((day) => dailyByIssue.get(issue.id)?.get(day) ?? 0),
    })),
  };
}

export async function getIssueDetail(id: string) {
  const issue = await db.errorIssue.findUnique({ where: { id } });
  if (!issue) throw new HttpError(404, "Issue not found");
  const [events, versions, resolvedBy] = await Promise.all([
    db.errorEvent.findMany({
      where: { issueId: id },
      orderBy: { occurredAt: "desc" },
      take: MAX_EVENTS_PER_ISSUE,
      select: {
        id: true,
        occurredAt: true,
        platform: true,
        appVersion: true,
        appBuild: true,
        releaseChannel: true,
        osVersion: true,
        deviceModel: true,
        role: true,
        screen: true,
        requestId: true,
        digest: true,
        message: true,
        stack: true,
        breadcrumbs: true,
        context: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    db.$queryRaw<Array<{ app_version: string | null; app_build: string | null; release_channel: string | null; n: number }>>`
      SELECT app_version, app_build, release_channel, count(*)::int AS n
      FROM error_events WHERE issue_id = ${id}
      GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 12`,
    issue.resolvedById
      ? db.user.findUnique({ where: { id: issue.resolvedById }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  const people = new Map<string, { id: string; name: string; count: number }>();
  for (const event of events) {
    if (!event.user) continue;
    const entry = people.get(event.user.id) ?? { id: event.user.id, name: event.user.name, count: 0 };
    entry.count += 1;
    people.set(event.user.id, entry);
  }
  return {
    issue: {
      id: issue.id,
      platform: issue.platform,
      kind: issue.kind,
      title: issue.title,
      culprit: issue.culprit,
      status: issue.status,
      note: issue.note,
      eventCount: issue.eventCount,
      firstSeenAt: issue.firstSeenAt.toISOString(),
      lastSeenAt: issue.lastSeenAt.toISOString(),
      firstVersion: issue.firstVersion,
      lastVersion: issue.lastVersion,
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      resolvedByName: resolvedBy?.name ?? null,
      regressedAt: issue.regressedAt?.toISOString() ?? null,
    },
    versions: versions.map((row) => ({
      version: versionLabel(row.app_version, row.app_build) ?? "Unknown",
      channel: row.release_channel,
      count: row.n,
    })),
    people: [...people.values()].sort((a, b) => b.count - a.count),
    events: events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
      breadcrumbs: (event.breadcrumbs as Breadcrumb[] | null) ?? [],
      context: (event.context as Record<string, unknown> | null) ?? null,
    })),
  };
}

export async function updateIssue(
  id: string,
  patch: { status?: IssueStatus; note?: string | null },
  actor: { id: string; role: Role },
) {
  const before = await db.errorIssue.findUnique({ where: { id }, select: { status: true, note: true } });
  if (!before) throw new HttpError(404, "Issue not found");
  const statusChanged = patch.status !== undefined && patch.status !== before.status;
  const updated = await db.errorIssue.update({
    where: { id },
    data: {
      ...(patch.note !== undefined ? { note: patch.note?.trim().slice(0, 2_000) || null } : {}),
      ...(statusChanged
        ? patch.status === "resolved"
          ? { status: "resolved", resolvedAt: new Date(), resolvedById: actor.id, regressedAt: null }
          : { status: patch.status, resolvedAt: null, resolvedById: null }
        : {}),
    },
    select: { status: true, note: true },
  });
  await createAuditEntry({
    actorId: actor.id,
    actorRole: actor.role,
    entityType: "error_issue",
    entityId: id,
    action: statusChanged ? `issue_${updated.status}` : "issue_note_updated",
    before,
    after: updated,
  });
  return updated;
}

/** For the App activity page: stored occurrences by app version over a window. */
export async function getCrashCountsByVersion(days: number) {
  const since = new Date(Date.now() - Math.max(1, Math.min(days, ERROR_RETENTION_DAYS)) * 86_400_000);
  const rows = await db.$queryRaw<
    Array<{ platform: string; app_version: string | null; app_build: string | null; kind: string; n: number }>
  >`
    SELECT e.platform, e.app_version, e.app_build, i.kind, count(*)::int AS n
    FROM error_events e JOIN error_issues i ON i.id = e.issue_id
    WHERE e.occurred_at >= ${since} AND e.platform <> 'server'
    GROUP BY 1, 2, 3, 4
    ORDER BY 5 DESC`;
  return rows.map((row) => ({
    platform: row.platform,
    appVersion: row.app_version,
    appBuild: row.app_build,
    kind: row.kind,
    count: row.n,
  }));
}

// ── Support reports ────────────────────────────────────────────────────────

export type SupportReportInput = {
  message: string;
  platform: string;
  appVersion?: string | null;
  appBuild?: string | null;
  releaseChannel?: string | null;
  osVersion?: string | null;
  deviceModel?: string | null;
  screen?: string | null;
  breadcrumbs?: Breadcrumb[];
};

export async function createSupportReport(input: SupportReportInput, user: { id: string; name: string; role: Role }) {
  const recent = await db.errorEvent.findMany({
    where: { userId: user.id, occurredAt: { gte: new Date(Date.now() - RELATED_ISSUE_WINDOW_MS) } },
    select: { issueId: true },
    distinct: ["issueId"],
    take: 10,
  });
  const report = await db.supportReport.create({
    data: {
      userId: user.id,
      message: input.message.trim().slice(0, 4_000),
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      appBuild: input.appBuild ?? null,
      releaseChannel: input.releaseChannel ?? null,
      osVersion: input.osVersion ?? null,
      deviceModel: input.deviceModel ?? null,
      role: String(user.role),
      screen: input.screen?.slice(0, 300) ?? null,
      breadcrumbs: json(boundBreadcrumbs(input.breadcrumbs)),
      relatedIssueIds: recent.map((row) => row.issueId),
    },
    select: { id: true },
  });
  try {
    const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    const now = new Date();
    await db.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: "support_report",
        title: `${user.name} reported a problem`,
        body: input.message.trim().slice(0, 240),
        payload: { href: `/issues?tab=reports&report=${report.id}`, supportReportId: report.id },
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `support_report:${report.id}:${admin.id}`,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error("event=support_report_notify_failed", { reportId: report.id, error: error instanceof Error ? error.message : String(error) });
  }
  return report;
}

export async function listSupportReports(status: "open" | "closed" | "all" = "open") {
  const reports = await db.supportReport.findMany({
    where: status === "all" ? {} : { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  const issueIds = [...new Set(reports.flatMap((report) => report.relatedIssueIds))];
  const issues = issueIds.length
    ? await db.errorIssue.findMany({ where: { id: { in: issueIds } }, select: { id: true, title: true, platform: true, status: true } })
    : [];
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const counts = await db.supportReport.groupBy({ by: ["status"], _count: { _all: true } });
  return {
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Partial<Record<"open" | "closed", number>>,
    reports: reports.map((report) => ({
      id: report.id,
      message: report.message,
      status: report.status,
      platform: report.platform,
      appVersion: report.appVersion,
      appBuild: report.appBuild,
      releaseChannel: report.releaseChannel,
      osVersion: report.osVersion,
      deviceModel: report.deviceModel,
      role: report.role,
      screen: report.screen,
      breadcrumbs: (report.breadcrumbs as Breadcrumb[] | null) ?? [],
      createdAt: report.createdAt.toISOString(),
      closedAt: report.closedAt?.toISOString() ?? null,
      user: report.user,
      relatedIssues: report.relatedIssueIds.map((id) => issueById.get(id)).filter((issue) => issue !== undefined),
    })),
  };
}

export async function updateSupportReport(id: string, status: "open" | "closed", actor: { id: string; role: Role }) {
  const before = await db.supportReport.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw new HttpError(404, "Report not found");
  const updated = await db.supportReport.update({
    where: { id },
    data: status === "closed" ? { status, closedAt: new Date(), closedById: actor.id } : { status, closedAt: null, closedById: null },
    select: { status: true },
  });
  await createAuditEntry({
    actorId: actor.id,
    actorRole: actor.role,
    entityType: "support_report",
    entityId: id,
    action: `support_report_${status}`,
    before,
    after: updated,
  });
  return updated;
}

// ── Retention ──────────────────────────────────────────────────────────────

export async function pruneErrorReports(now = new Date()): Promise<{ events: number; issues: number; supportReports: number }> {
  const cutoff = new Date(now.getTime() - ERROR_RETENTION_DAYS * 86_400_000);
  const supportCutoff = new Date(now.getTime() - SUPPORT_REPORT_RETENTION_DAYS * 86_400_000);
  const aged = await db.errorEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });
  // Keep only the newest occurrences of each issue.
  const overflow = await db.$executeRaw`
    DELETE FROM error_events WHERE id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY issue_id ORDER BY occurred_at DESC) AS rank
        FROM error_events
      ) ranked WHERE rank > ${MAX_EVENTS_PER_ISSUE}
    )`;
  const issues = await db.errorIssue.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
  const supportReports = await db.supportReport.deleteMany({ where: { createdAt: { lt: supportCutoff } } });
  return { events: aged.count + overflow, issues: issues.count, supportReports: supportReports.count };
}
