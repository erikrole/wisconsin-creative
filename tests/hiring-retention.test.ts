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
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>, _options?: unknown) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ get db() { return models; } }));

import { Prisma } from "@prisma/client";
import { deleteApplicantFile } from "@/lib/hiring/storage";
import { recordJobRun } from "@/lib/services/job-runs";
import {
  APPLICANT_RETENTION_MONTHS,
  addMonths,
  findPurgeCandidates,
  purgeApplicant,
  purgeDate,
  retentionCutoff,
  runApplicantRetention,
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
  beforeEach(() => vi.clearAllMocks());

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
    // The eligibility read happens on the transaction client, not before it.
    expect(tx.applicant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("deletes files first, clears personal data, keeps the outcome, and writes a non-PII ledger row", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    const order: string[] = [];
    vi.mocked(deleteApplicantFile).mockImplementation(async () => void order.push("blob"));
    tx.applicantDocument.deleteMany.mockImplementation(async () => void order.push("rows"));

    const result = await purgeApplicant("a1", NOW);
    expect(result).toEqual({ applicantId: "a1", applications: 2, documents: 2 });
    expect(order).toEqual(["blob", "blob", "rows"]);

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
    expect(ledger).toEqual({ applicantId: "a1", purgedAt: NOW, applicationCount: 2, documentCount: 2, policyMonths: 36 });
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

  it("stops before deleting any rows when file deletion fails", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    vi.mocked(deleteApplicantFile).mockRejectedValueOnce(new Error("storage down"));
    await expect(purgeApplicant("a1", NOW)).rejects.toThrow("storage down");
    expect(tx.applicantDocument.deleteMany).not.toHaveBeenCalled();
    expect(tx.applicantRetentionEvent.create).not.toHaveBeenCalled();
  });

  it("skips the applicant when concurrent hiring activity causes a serialization conflict", async () => {
    tx.applicant.findUnique.mockResolvedValue(eligible());
    tx.applicantRetentionEvent.create.mockRejectedValueOnce(Object.assign(new Error("could not serialize access"), { code: "P2034" }));
    expect(await purgeApplicant("a1", NOW)).toBeNull();
  });

  it.each([
    ["inside the retention window", { applications: [{ id: "app1", allowedEmailId: null, cycle: closed("2027-05-01T00:00:00Z"), documents: [] }] }],
    ["a cycle still open", { applications: [{ id: "app1", allowedEmailId: null, cycle: { status: "OPEN", closedAt: null }, documents: [] }] }],
    ["linked to an account", { hiredUserId: "u1" }],
    ["already purged", { purgedAt: new Date("2029-01-01T00:00:00Z") }],
  ])("does not purge when %s", async (_label, overrides) => {
    tx.applicant.findUnique.mockResolvedValue(eligible(overrides));
    expect(await purgeApplicant("a1", NOW)).toBeNull();
    expect(deleteApplicantFile).not.toHaveBeenCalled();
    expect(tx.applicantDocument.deleteMany).not.toHaveBeenCalled();
    expect(tx.applicantRetentionEvent.create).not.toHaveBeenCalled();
  });

  it("does not purge an applicant who vanished or became eligible-looking only in a stale read", async () => {
    tx.applicant.findUnique.mockResolvedValue(null);
    expect(await purgeApplicant("gone", NOW)).toBeNull();
    expect(deleteApplicantFile).not.toHaveBeenCalled();
  });
});

describe("runApplicantRetention (runs inside the weekly audit-archive cron)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dry run reports the count and changes nothing", async () => {
    models.applicant.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    const result = await runApplicantRetention(NOW, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, due: 2, purged: 0 });
    expect(models.$transaction).not.toHaveBeenCalled();
    expect(recordJobRun).not.toHaveBeenCalled();
  });

  it("does nothing, and records nothing, when no one is due", async () => {
    models.applicant.findMany.mockResolvedValue([]);
    expect(await runApplicantRetention(NOW)).toMatchObject({ due: 0, purged: 0, failed: 0 });
    expect(recordJobRun).not.toHaveBeenCalled();
  });

  it("keeps going when one applicant fails, and records the run as failed", async () => {
    models.applicant.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    const person = (id: string) => ({
      id,
      purgedAt: null,
      hiredUserId: null,
      applications: [{ id: `app-${id}`, allowedEmailId: null, cycle: { status: "CLOSED", closedAt: new Date("2020-01-01T00:00:00Z") }, documents: [] }],
    });
    tx.applicant.findUnique.mockResolvedValueOnce(person("a1")).mockResolvedValueOnce(person("a2"));
    tx.applicantRetentionEvent.create.mockRejectedValueOnce(new Error("db hiccup")).mockResolvedValueOnce({});

    const result = await runApplicantRetention(NOW);
    expect(result).toMatchObject({ purged: 1, failed: 1 });
    expect(recordJobRun).toHaveBeenCalledWith(expect.objectContaining({ job: "applicant_retention", outcome: "failed" }));
  });
});
