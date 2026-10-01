import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hiring/storage", () => ({
  deleteApplicantFile: vi.fn(),
  putApplicantFile: vi.fn(),
  getApplicantFile: vi.fn(),
}));
vi.mock("@/lib/services/job-runs", () => ({ recordJobRun: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const tx = {
  applicantDocument: { deleteMany: vi.fn() },
  applicationNote: { deleteMany: vi.fn() },
  applicantEmail: { deleteMany: vi.fn() },
  application: { updateMany: vi.fn() },
  applicant: { findUnique: vi.fn(), update: vi.fn() },
  applicantRetentionEvent: { create: vi.fn() },
  allowedEmail: { deleteMany: vi.fn() },
};
const models = {
  applicant: { findUnique: vi.fn(), findMany: vi.fn() },
  applicantRetentionEvent: { findMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>, _options?: unknown) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ get db() { return models; } }));

import { Prisma } from "@prisma/client";
import { deleteApplicantFile } from "@/lib/hiring/storage";
import { recordJobRun } from "@/lib/services/job-runs";
import {
  APPLICANT_RETENTION_MONTHS,
  addMonths,
  deleteQueuedBlobs,
  findPurgeCandidates,
  purgeApplicant,
  purgeDate,
  retentionCutoff,
  runApplicantRetention,
  sweepPendingBlobs,
} from "@/lib/hiring/retention";

const NOW = new Date("2029-10-15T12:00:00Z");
const closed = (iso: string) => ({ status: "CLOSED" as const, closedAt: new Date(iso) });

describe("retention policy", () => {
  it("is 36 months", () => {
    expect(APPLICANT_RETENTION_MONTHS).toBe(36);
    expect(retentionCutoff(NOW).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });

  it("adds months without overflowing short months", () => {
    expect(addMonths(new Date("2026-02-28T00:00:00Z"), 36).toISOString()).toBe("2029-02-28T00:00:00.000Z");
    expect(addMonths(new Date("2024-02-29T00:00:00Z"), 12).toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(addMonths(new Date("2026-08-31T00:00:00Z"), 1).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("schedules the purge 36 months after the latest cycle close", () => {
    const date = purgeDate({ linkedToAccount: false, purged: false, cycles: [closed("2025-05-01T00:00:00Z"), closed("2026-05-01T00:00:00Z")] });
    expect(date?.toISOString()).toBe("2029-05-01T00:00:00.000Z");
  });

  it("is not scheduled while a cycle is open, planned, or has no close time", () => {
    expect(purgeDate({ linkedToAccount: false, purged: false, cycles: [closed("2024-01-01T00:00:00Z"), { status: "OPEN", closedAt: null }] })).toBeNull();
    expect(purgeDate({ linkedToAccount: false, purged: false, cycles: [{ status: "PLANNING", closedAt: null }] })).toBeNull();
    expect(purgeDate({ linkedToAccount: false, purged: false, cycles: [{ status: "ARCHIVED", closedAt: null }] })).toBeNull();
  });

  it("is not scheduled for linked, already purged, or application-less applicants", () => {
    const cycles = [closed("2020-01-01T00:00:00Z")];
    expect(purgeDate({ linkedToAccount: true, purged: false, cycles })).toBeNull();
    expect(purgeDate({ linkedToAccount: false, purged: true, cycles })).toBeNull();
    expect(purgeDate({ linkedToAccount: false, purged: false, cycles: [] })).toBeNull();
  });
});

describe("candidate query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks only for unlinked, unpurged applicants whose every cycle closed before the cutoff", async () => {
    models.applicant.findMany.mockResolvedValue([{ id: "a1" }]);
    expect(await findPurgeCandidates(NOW, 25)).toEqual(["a1"]);
    const where = models.applicant.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ purgedAt: null, hiredUserId: null });
    const none = where.applications.none.cycle.OR;
    expect(none).toEqual([
      { closedAt: null },
      { closedAt: { gt: new Date("2026-10-15T12:00:00.000Z") } },
      { status: { in: ["OPEN", "PLANNING"] } },
    ]);
  });
});

describe("purgeApplicant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.applicantRetentionEvent.create.mockResolvedValue({ id: "ev1" });
  });

  const eligible = (overrides: Record<string, unknown> = {}) => ({
    id: "a1",
    purgedAt: null,
    hiredUserId: null,
    applications: [
      {
        id: "app1",
        allowedEmailId: "invite-1",
        cycle: closed("2025-05-01T00:00:00Z"),
        documents: [{ pathname: "applicants/app1/resume-x.pdf" }, { pathname: "applicants/app1/other-y.png" }],
      },
      { id: "app2", allowedEmailId: null, cycle: closed("2026-05-01T00:00:00Z"), documents: [] },
    ],
    ...overrides,
  });

  it("re-reads the applicant inside a serializable transaction before doing anything destructive", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    await purgeApplicant("a1", NOW);
    expect(models.$transaction).toHaveBeenCalledTimes(1);
    expect(models.$transaction.mock.calls[0]![1]).toMatchObject({ isolationLevel: "Serializable" });
    expect(tx.applicant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("never deletes a file inside the transaction (storage cannot roll back)", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    const result = await purgeApplicant("a1", NOW);
    expect(deleteApplicantFile).not.toHaveBeenCalled();
    // The pathnames are queued durably on the ledger row instead, and handed back for deletion after commit.
    expect(tx.applicantRetentionEvent.create.mock.calls[0]![0].data.pendingBlobPaths).toEqual([
      "applicants/app1/resume-x.pdf",
      "applicants/app1/other-y.png",
    ]);
    expect(result).toMatchObject({ eventId: "ev1", documents: 2, pathnames: ["applicants/app1/resume-x.pdf", "applicants/app1/other-y.png"] });
  });

  it("clears personal data, keeps the outcome, and writes a non-PII ledger row", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    const result = await purgeApplicant("a1", NOW);
    expect(result).toMatchObject({ applicantId: "a1", applications: 2, documents: 2 });

    expect(tx.applicantDocument.deleteMany).toHaveBeenCalled();
    expect(tx.applicantEmail.deleteMany).toHaveBeenCalledWith({ where: { applicantId: "a1" } });
    expect(tx.applicationNote.deleteMany).toHaveBeenCalled();
    const appData = tx.application.updateMany.mock.calls[0]![0].data;
    expect(appData).toMatchObject({ externalApplicationId: null, interviewUrl: null, rawAreas: [], sourcePayload: Prisma.DbNull });
    // Stage, decision, and cycle are the retained outcome and must not be touched.
    expect(appData).not.toHaveProperty("stage");
    expect(appData).not.toHaveProperty("decidedAt");
    expect(appData).not.toHaveProperty("cycleId");

    const personData = tx.applicant.update.mock.calls[0]![0].data;
    expect(personData).toMatchObject({ phone: null, portfolioUrl: null, notes: null, gradYear: null, purgedAt: NOW });
    expect(personData).not.toHaveProperty("name");

    const ledger = tx.applicantRetentionEvent.create.mock.calls[0]![0].data;
    expect(ledger).toMatchObject({ applicantId: "a1", purgedAt: NOW, applicationCount: 2, documentCount: 2, policyMonths: 36 });
  });

  it("deletes an unclaimed hire invite (it still holds the email and name), and never a claimed one", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    await purgeApplicant("a1", NOW);
    expect(tx.allowedEmail.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["invite-1"] }, claimedAt: null } });
  });

  it("does not touch invites when there are none", async () => {
    tx.applicant.findUnique.mockResolvedValue(
      eligible({ applications: [{ id: "app1", allowedEmailId: null, cycle: closed("2025-05-01T00:00:00Z"), documents: [] }] }),
    );
    await purgeApplicant("a1", NOW);
    expect(tx.allowedEmail.deleteMany).not.toHaveBeenCalled();
  });

  it("skips the applicant, with every file still in place, when concurrent activity aborts the transaction", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    tx.applicantRetentionEvent.create.mockRejectedValueOnce(Object.assign(new Error("could not serialize access"), { code: "P2034" }));
    expect(await purgeApplicant("a1", NOW)).toBeNull();
    // The point of the redesign: an aborted transaction has not removed any file.
    expect(deleteApplicantFile).not.toHaveBeenCalled();
  });

  it.each([
    ["inside the retention window", { applications: [{ id: "app1", allowedEmailId: null, cycle: closed("2027-05-01T00:00:00Z"), documents: [] }] }],
    ["a cycle still open", { applications: [{ id: "app1", allowedEmailId: null, cycle: { status: "OPEN", closedAt: null }, documents: [] }] }],
    ["linked to an account", { hiredUserId: "u1" }],
    ["already purged", { purgedAt: new Date("2029-01-01T00:00:00Z") }],
  ])("does not purge when %s", async (_label, overrides) => {
    tx.applicant.findUnique.mockResolvedValue(eligible(overrides));
    expect(await purgeApplicant("a1", NOW)).toBeNull();
    expect(tx.applicantDocument.deleteMany).not.toHaveBeenCalled();
    expect(tx.applicantRetentionEvent.create).not.toHaveBeenCalled();
  });

  it("does not purge an applicant who vanished", async () => {
    tx.applicant.findUnique.mockResolvedValue(null);
    expect(await purgeApplicant("gone", NOW)).toBeNull();
  });
});

describe("queued file deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes each queued file, then clears the queue", async () => {
    const order: string[] = [];
    vi.mocked(deleteApplicantFile).mockImplementation(async () => void order.push("blob"));
    models.applicantRetentionEvent.update.mockImplementation(async () => void order.push("clear"));
    await deleteQueuedBlobs("ev1", ["a.pdf", "b.png"]);
    expect(order).toEqual(["blob", "blob", "clear"]);
    expect(models.applicantRetentionEvent.update).toHaveBeenCalledWith({ where: { id: "ev1" }, data: { pendingBlobPaths: [] } });
  });

  it("keeps the queue intact when a deletion fails, so a later sweep can retry", async () => {
    vi.mocked(deleteApplicantFile).mockRejectedValueOnce(new Error("storage down"));
    await expect(deleteQueuedBlobs("ev1", ["a.pdf"])).rejects.toThrow("storage down");
    expect(models.applicantRetentionEvent.update).not.toHaveBeenCalled();
  });

  it("sweeps files left over from earlier purges and reports failures without stopping", async () => {
    models.applicantRetentionEvent.findMany.mockResolvedValue([
      { id: "ev1", pendingBlobPaths: ["a.pdf"] },
      { id: "ev2", pendingBlobPaths: ["b.pdf"] },
    ]);
    vi.mocked(deleteApplicantFile).mockRejectedValueOnce(new Error("storage down")).mockResolvedValue(undefined);
    expect(await sweepPendingBlobs()).toEqual({ swept: 1, failed: 1 });
    expect(models.applicantRetentionEvent.findMany.mock.calls[0]![0].where).toEqual({ pendingBlobPaths: { isEmpty: false } });
  });
});

describe("runApplicantRetention (runs inside the weekly audit-archive cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    models.applicantRetentionEvent.findMany.mockResolvedValue([]);
    tx.applicantRetentionEvent.create.mockResolvedValue({ id: "ev1" });
  });

  const person = (id: string) => ({
    id,
    purgedAt: null,
    hiredUserId: null,
    applications: [{ id: `app-${id}`, allowedEmailId: null, cycle: { status: "CLOSED", closedAt: new Date("2020-01-01T00:00:00Z") }, documents: [{ pathname: `applicants/app-${id}/resume.pdf` }] }],
  });
  const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `a${from + i}` }));

  it("dry run reports the count and changes nothing", async () => {
    models.applicant.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    const result = await runApplicantRetention(NOW, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, due: 2, purged: 0 });
    expect(models.$transaction).not.toHaveBeenCalled();
    expect(recordJobRun).not.toHaveBeenCalled();
  });

  it("does nothing, and records nothing, when no one is due", async () => {
    models.applicant.findMany.mockResolvedValue([]);
    expect(await runApplicantRetention(NOW)).toMatchObject({ due: 0, purged: 0, failed: 0, blobsSwept: 0 });
    expect(recordJobRun).not.toHaveBeenCalled();
  });

  it("drains every due batch in one run, so a whole cycle reaching its deadline is purged together", async () => {
    // 25 + 25 + 3 applicants are due across three batches.
    models.applicant.findMany
      .mockResolvedValueOnce(ids(0, 25))
      .mockResolvedValueOnce(ids(25, 25))
      .mockResolvedValueOnce(ids(50, 3))
      .mockResolvedValue([]);
    tx.applicant.findUnique.mockImplementation(async () => person("x"));
    const result = await runApplicantRetention(NOW);
    expect(result.purged).toBe(53);
    expect(result.failed).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(models.applicant.findMany).toHaveBeenCalledTimes(3);
    // Files were deleted after each commit.
    expect(deleteApplicantFile).toHaveBeenCalledTimes(53);
  });

  it("stops (and reports hasMore) at the batch ceiling instead of running unbounded", async () => {
    models.applicant.findMany.mockImplementation(async () => ids(0, 25));
    tx.applicant.findUnique.mockImplementation(async () => person("x"));
    const result = await runApplicantRetention(NOW);
    expect(result.purged).toBe(20 * 25);
    expect(result.hasMore).toBe(true);
  });

  it("stops when a whole batch makes no progress, so a stuck applicant cannot loop forever", async () => {
    models.applicant.findMany.mockImplementation(async () => ids(0, 25));
    tx.applicant.findUnique.mockImplementation(async () => null); // everyone ineligible now
    const result = await runApplicantRetention(NOW);
    expect(result.purged).toBe(0);
    expect(models.applicant.findMany).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one applicant fails, and records the run as failed", async () => {
    models.applicant.findMany.mockResolvedValueOnce([{ id: "a1" }, { id: "a2" }]).mockResolvedValue([]);
    tx.applicant.findUnique.mockResolvedValueOnce(person("a1")).mockResolvedValueOnce(person("a2"));
    tx.applicantRetentionEvent.create.mockRejectedValueOnce(new Error("db hiccup")).mockResolvedValueOnce({ id: "ev2" });

    const result = await runApplicantRetention(NOW);
    expect(result).toMatchObject({ purged: 1, failed: 1 });
    expect(recordJobRun).toHaveBeenCalledWith(expect.objectContaining({ job: "applicant_retention", outcome: "failed" }));
  });

  it("defers a failed file deletion to the queue without undoing the committed purge", async () => {
    models.applicant.findMany.mockResolvedValueOnce([{ id: "a1" }]).mockResolvedValue([]);
    tx.applicant.findUnique.mockResolvedValueOnce(person("a1"));
    vi.mocked(deleteApplicantFile).mockRejectedValueOnce(new Error("storage down"));
    const result = await runApplicantRetention(NOW);
    expect(result.purged).toBe(1);
    expect(result.failed).toBe(1);
    // The queue was not cleared, so the next sweep retries it.
    expect(models.applicantRetentionEvent.update).not.toHaveBeenCalled();
  });

  it("retries previously queued files at the end of the run", async () => {
    models.applicant.findMany.mockResolvedValue([]);
    models.applicantRetentionEvent.findMany.mockResolvedValue([{ id: "ev9", pendingBlobPaths: ["old.pdf"] }]);
    const result = await runApplicantRetention(NOW);
    expect(result.blobsSwept).toBe(1);
    expect(deleteApplicantFile).toHaveBeenCalledWith("old.pdf");
    expect(recordJobRun).toHaveBeenCalled();
  });
});
