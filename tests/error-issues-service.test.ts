import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, createAuditEntry } = vi.hoisted(() => ({
  db: {
    errorIssue: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn(), deleteMany: vi.fn() },
    errorEvent: { findMany: vi.fn(), deleteMany: vi.fn() },
    supportReport: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn(), deleteMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    notification: { createMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
  createAuditEntry: vi.fn<(entry: Record<string, unknown>) => Promise<void>>(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry }));

import {
  createSupportReport,
  getCrashCountsByVersion,
  getIssueDetail,
  listIssues,
  listSupportReports,
  platformLabel,
  pruneErrorReports,
  updateIssue,
  updateSupportReport,
} from "@/lib/services/error-reports";

// 9:30 AM in Madison on Oct 22.
const now = new Date("2026-10-22T14:30:00.000Z");
const admin = { id: "admin-1", role: "ADMIN" as const };

function issue(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    platform: "ios",
    kind: "crash",
    title: "Fatal error in ScheduleView",
    culprit: "ScheduleView.swift",
    status: "open",
    note: null,
    eventCount: 4,
    firstSeenAt: new Date("2026-10-10T15:00:00.000Z"),
    lastSeenAt: new Date("2026-10-21T15:00:00.000Z"),
    firstVersion: "1.4.0 (35)",
    lastVersion: "1.4.1 (37)",
    resolvedAt: null,
    resolvedById: null,
    regressedAt: null,
    ...overrides,
  };
}

function sqlText(call: unknown[]) {
  return (call[0] as string[]).join("?");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  db.errorIssue.groupBy.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listIssues", () => {
  it("draws each issue's last 14 days on Madison calendar days, ending today", async () => {
    db.errorIssue.findMany.mockResolvedValue([issue("i1")]);
    db.$queryRaw
      .mockResolvedValueOnce([
        { issue_id: "i1", day: "2026-10-09", n: 2 },
        { issue_id: "i1", day: "2026-10-21", n: 3 },
        { issue_id: "i1", day: "2026-10-22", n: 1 },
      ])
      .mockResolvedValueOnce([{ issue_id: "i1", n: 2 }]);

    const { issues } = await listIssues();

    expect(issues[0]?.daily).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1]);
    expect(issues[0]?.userCount).toBe(2);
    const daily = db.$queryRaw.mock.calls[0]!;
    expect(sqlText(daily)).toContain("AT TIME ZONE");
    expect(daily).toContain("America/Chicago");
    // The window opens at local midnight 13 days back.
    expect(daily).toContainEqual(new Date("2026-10-09T05:00:00.000Z"));
  });

  it("filters by status, platform and title or culprit text, and counts each status", async () => {
    db.errorIssue.findMany.mockResolvedValue([]);
    db.errorIssue.groupBy.mockResolvedValue([{ status: "open", _count: { _all: 5 } }, { status: "resolved", _count: { _all: 2 } }]);

    const result = await listIssues({ status: "open", platform: "web", q: "Schedule" });

    expect(db.errorIssue.findMany.mock.calls[0]?.[0]?.where).toEqual({
      status: "open",
      platform: "web",
      OR: [{ title: { contains: "Schedule", mode: "insensitive" } }, { culprit: { contains: "Schedule", mode: "insensitive" } }],
    });
    expect(result).toEqual({ counts: { open: 5, resolved: 2 }, issues: [] });
    // No issues, no event queries.
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("shows every status for all", async () => {
    db.errorIssue.findMany.mockResolvedValue([]);
    await listIssues({ status: "all" });
    expect(db.errorIssue.findMany.mock.calls[0]?.[0]?.where).toEqual({});
  });
});

describe("getIssueDetail", () => {
  it("returns the issue with versions, who resolved it, and the people affected, most first", async () => {
    db.errorIssue.findUnique.mockResolvedValue(issue("i1", { status: "resolved", resolvedById: "admin-1", resolvedAt: now }));
    db.user.findUnique.mockResolvedValue({ name: "Avery Admin" });
    const event = (id: string, user: { id: string; name: string; email: string } | null) => ({
      id,
      occurredAt: now,
      user,
      breadcrumbs: null,
      context: null,
    });
    db.errorEvent.findMany.mockResolvedValue([
      event("e1", { id: "u1", name: "Rowan", email: "r@wisc.edu" }),
      event("e2", { id: "u2", name: "Maddy", email: "m@wisc.edu" }),
      event("e3", { id: "u2", name: "Maddy", email: "m@wisc.edu" }),
      event("e4", null),
    ]);
    db.$queryRaw.mockResolvedValue([
      { app_version: "1.4.1", app_build: "37", release_channel: "app_store", n: 3 },
      { app_version: null, app_build: null, release_channel: null, n: 1 },
    ]);

    const detail = await getIssueDetail("i1");

    expect(detail.issue).toMatchObject({ id: "i1", status: "resolved", resolvedByName: "Avery Admin", resolvedAt: now.toISOString() });
    expect(detail.versions).toEqual([
      { version: expect.stringContaining("1.4.1"), channel: "app_store", count: 3 },
      { version: "Unknown", channel: null, count: 1 },
    ]);
    expect(detail.people).toEqual([{ id: "u2", name: "Maddy", count: 2 }, { id: "u1", name: "Rowan", count: 1 }]);
    expect(detail.events[0]).toMatchObject({ id: "e1", occurredAt: now.toISOString(), breadcrumbs: [], context: null });
  });

  it("says when the issue is gone", async () => {
    db.errorIssue.findUnique.mockResolvedValue(null);
    await expect(getIssueDetail("missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateIssue", () => {
  it("records who resolved an issue and clears its regression", async () => {
    db.errorIssue.findUnique.mockResolvedValue({ status: "open", note: null });
    db.errorIssue.update.mockResolvedValue({ status: "resolved", note: null });

    await updateIssue("i1", { status: "resolved" }, admin);

    expect(db.errorIssue.update.mock.calls[0]?.[0]?.data).toEqual({ status: "resolved", resolvedAt: now, resolvedById: "admin-1", regressedAt: null });
    expect(createAuditEntry.mock.calls[0]?.[0]).toMatchObject({ entityType: "error_issue", entityId: "i1", action: "issue_resolved" });
  });

  it("clears the resolver when an issue is reopened or ignored", async () => {
    db.errorIssue.findUnique.mockResolvedValue({ status: "resolved", note: null });
    db.errorIssue.update.mockResolvedValue({ status: "ignored", note: null });

    await updateIssue("i1", { status: "ignored" }, admin);

    expect(db.errorIssue.update.mock.calls[0]?.[0]?.data).toEqual({ status: "ignored", resolvedAt: null, resolvedById: null });
    expect(createAuditEntry.mock.calls[0]?.[0]?.action).toBe("issue_ignored");
  });

  it("saves a trimmed note without touching the status, and audits it as a note", async () => {
    db.errorIssue.findUnique.mockResolvedValue({ status: "open", note: null });
    db.errorIssue.update.mockResolvedValue({ status: "open", note: "Seen on iPad only" });

    await updateIssue("i1", { status: "open", note: "  Seen on iPad only  " }, admin);
    expect(db.errorIssue.update.mock.calls[0]?.[0]?.data).toEqual({ note: "Seen on iPad only" });
    expect(createAuditEntry.mock.calls[0]?.[0]?.action).toBe("issue_note_updated");

    db.errorIssue.update.mockClear();
    await updateIssue("i1", { note: "   " }, admin);
    expect(db.errorIssue.update.mock.calls[0]?.[0]?.data).toEqual({ note: null });
  });

  it("says when the issue is gone", async () => {
    db.errorIssue.findUnique.mockResolvedValue(null);
    await expect(updateIssue("missing", { status: "resolved" }, admin)).rejects.toMatchObject({ status: 404 });
  });
});

describe("getCrashCountsByVersion", () => {
  it("counts client occurrences by version over a window clamped to retention", async () => {
    db.$queryRaw.mockResolvedValue([{ platform: "ios", app_version: "1.4.1", app_build: "37", kind: "crash", n: 6 }]);

    expect(await getCrashCountsByVersion(500)).toEqual([{ platform: "ios", appVersion: "1.4.1", appBuild: "37", kind: "crash", count: 6 }]);
    expect(db.$queryRaw.mock.calls[0]).toContainEqual(new Date(now.getTime() - 90 * 86_400_000));
    expect(sqlText(db.$queryRaw.mock.calls[0]!)).toContain("e.platform <> 'server'");

    await getCrashCountsByVersion(0);
    expect(db.$queryRaw.mock.calls[1]).toContainEqual(new Date(now.getTime() - 86_400_000));
  });
});

describe("support reports", () => {
  const reporter = { id: "u1", name: "Maddy Student", role: "STUDENT" as const };

  it("files a report linked to the reporter's recent issues and tells each admin", async () => {
    db.errorEvent.findMany.mockResolvedValue([{ issueId: "i1" }, { issueId: "i2" }]);
    db.supportReport.create.mockResolvedValue({ id: "r1" });

    await createSupportReport({ message: "  The scanner froze  ", platform: "ios", screen: "Scan", appVersion: "1.4.1" }, reporter);

    expect(db.errorEvent.findMany.mock.calls[0]?.[0]?.where).toEqual({
      userId: "u1",
      occurredAt: { gte: new Date(now.getTime() - 30 * 60_000) },
    });
    expect(db.supportReport.create.mock.calls[0]?.[0]?.data).toMatchObject({
      userId: "u1",
      message: "The scanner froze",
      platform: "ios",
      appVersion: "1.4.1",
      appBuild: null,
      role: "STUDENT",
      screen: "Scan",
      relatedIssueIds: ["i1", "i2"],
    });
    expect(db.notification.createMany.mock.calls[0]?.[0]).toMatchObject({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          userId: "admin-1",
          type: "support_report",
          title: "Maddy Student reported a problem",
          body: "The scanner froze",
          payload: { href: "/issues?tab=reports&report=r1", supportReportId: "r1" },
          dedupeKey: "support_report:r1:admin-1",
        }),
        expect.objectContaining({ userId: "admin-2", dedupeKey: "support_report:r1:admin-2" }),
      ],
    });
  });

  it("keeps the report when telling admins fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.errorEvent.findMany.mockResolvedValue([]);
    db.supportReport.create.mockResolvedValue({ id: "r1" });
    db.notification.createMany.mockRejectedValue(new Error("timeout"));

    await expect(createSupportReport({ message: "Help", platform: "web" }, reporter)).resolves.toEqual({ id: "r1" });
  });

  it("lists reports with their related issues and status counts", async () => {
    db.supportReport.findMany.mockResolvedValue([{
      id: "r1",
      message: "The scanner froze",
      status: "open",
      platform: "ios",
      appVersion: null,
      appBuild: null,
      releaseChannel: null,
      osVersion: null,
      deviceModel: null,
      role: "STUDENT",
      screen: null,
      breadcrumbs: null,
      createdAt: now,
      closedAt: null,
      user: { id: "u1", name: "Maddy", email: "m@wisc.edu" },
      relatedIssueIds: ["i1", "i-pruned"],
    }]);
    db.errorIssue.findMany.mockResolvedValue([{ id: "i1", title: "Crash", platform: "ios", status: "open" }]);
    db.supportReport.groupBy.mockResolvedValue([{ status: "open", _count: { _all: 1 } }]);

    const result = await listSupportReports();

    expect(db.supportReport.findMany.mock.calls[0]?.[0]?.where).toEqual({ status: "open" });
    expect(result.counts).toEqual({ open: 1 });
    expect(result.reports[0]).toMatchObject({ id: "r1", breadcrumbs: [], createdAt: now.toISOString(), closedAt: null });
    // An issue pruned since the report drops out instead of showing a blank row.
    expect(result.reports[0]?.relatedIssues).toEqual([{ id: "i1", title: "Crash", platform: "ios", status: "open" }]);

    await listSupportReports("all");
    expect(db.supportReport.findMany.mock.calls[1]?.[0]?.where).toEqual({});
  });

  it("records who closed a report, and clears it on reopen", async () => {
    db.supportReport.findUnique.mockResolvedValue({ status: "open" });
    db.supportReport.update.mockResolvedValue({ status: "closed" });
    await updateSupportReport("r1", "closed", admin);
    expect(db.supportReport.update.mock.calls[0]?.[0]?.data).toEqual({ status: "closed", closedAt: now, closedById: "admin-1" });
    expect(createAuditEntry.mock.calls[0]?.[0]).toMatchObject({ entityType: "support_report", action: "support_report_closed" });

    await updateSupportReport("r1", "open", admin);
    expect(db.supportReport.update.mock.calls[1]?.[0]?.data).toEqual({ status: "open", closedAt: null, closedById: null });

    db.supportReport.findUnique.mockResolvedValue(null);
    await expect(updateSupportReport("gone", "closed", admin)).rejects.toMatchObject({ status: 404 });
  });
});

describe("pruneErrorReports", () => {
  it("drops occurrences after 90 days, overflow beyond 50 per issue, quiet issues, and year-old support reports", async () => {
    db.errorEvent.deleteMany.mockResolvedValue({ count: 7 });
    db.$executeRaw.mockResolvedValue(3);
    db.errorIssue.deleteMany.mockResolvedValue({ count: 2 });
    db.supportReport.deleteMany.mockResolvedValue({ count: 1 });

    expect(await pruneErrorReports(now)).toEqual({ events: 10, issues: 2, supportReports: 1 });
    const cutoff = new Date(now.getTime() - 90 * 86_400_000);
    expect(db.errorEvent.deleteMany).toHaveBeenCalledWith({ where: { occurredAt: { lt: cutoff } } });
    expect(db.errorIssue.deleteMany).toHaveBeenCalledWith({ where: { lastSeenAt: { lt: cutoff } } });
    expect(db.supportReport.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(now.getTime() - 365 * 86_400_000) } } });
    expect(db.$executeRaw.mock.calls[0]).toContain(50);
  });
});

describe("platformLabel", () => {
  it("names each client the way the Issues page shows it", () => {
    expect(["web", "server", "ios", "kiosk", "macos", "watch"].map(platformLabel)).toEqual(["Web", "Server", "iPhone app", "Kiosk", "Mac app", "watch"]);
  });
});
