import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "./_helpers/mock-db";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 100, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/services/onboarding-lifecycle", () => ({ createAllowedEmailInvite: vi.fn() }));
vi.mock("@/lib/hiring/storage", () => ({
  putApplicantFile: vi.fn(),
  getApplicantFile: vi.fn(),
  deleteApplicantFile: vi.fn(),
}));

const models = {
  hiringCycle: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  hiringCycleSlot: { deleteMany: vi.fn(), createMany: vi.fn() },
  application: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
  },
  applicant: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  allowedEmail: { findUnique: vi.fn(), delete: vi.fn(), create: vi.fn(), update: vi.fn() },
  applicantEmail: { findUnique: vi.fn(), create: vi.fn() },
  applicantDocument: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  applicationNote: { create: vi.fn() },
};
const { db } = createMockDb(models);
vi.mock("@/lib/db", () => ({ get db() { return db; } }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { GET as listCycles, POST as createCycle } from "@/app/api/hiring/cycles/route";
import { PATCH as patchCycle } from "@/app/api/hiring/cycles/[id]/route";
import { GET as listApplications, POST as createApplication } from "@/app/api/hiring/applications/route";
import { GET as getApplication, PATCH as patchApplication } from "@/app/api/hiring/applications/[id]/route";
import { POST as addNote } from "@/app/api/hiring/applications/[id]/notes/route";
import { DELETE as deleteDocument, GET as readDocument } from "@/app/api/hiring/documents/[id]/route";
import { POST as inviteHire } from "@/app/api/hiring/applications/[id]/invite/route";
import { POST as uploadDocument } from "@/app/api/hiring/applications/[id]/documents/route";
import { deleteApplicantFile, putApplicantFile } from "@/lib/hiring/storage";
import { createAllowedEmailInvite } from "@/lib/services/onboarding-lifecycle";

const user = (role: "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR") => ({
  id: `${role}-1`,
  email: `${role}@example.test`,
  name: role,
  role,
  avatarUrl: null,
  forcePasswordChange: false,
});

const json = (url: string, method: string, body?: unknown) =>
  new Request(`https://app.example.com${url}`, {
    method,
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id = "app-1") => ({ params: Promise.resolve({ id }) });
const CYCLE_ID = "clh0000000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hiring routes are ADMIN-only", () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ["GET cycles", () => listCycles(json("/api/hiring/cycles", "GET"), ctx())],
    ["POST cycles", () => createCycle(json("/api/hiring/cycles", "POST", { term: "FALL", year: 2026 }), ctx())],
    ["PATCH cycle", () => patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "CLOSED" }), ctx("c1"))],
    ["GET applications", () => listApplications(json(`/api/hiring/applications?cycleId=${CYCLE_ID}`, "GET"), ctx())],
    [
      "POST applications",
      () => createApplication(json("/api/hiring/applications", "POST", { cycleId: CYCLE_ID, name: "A B", email: "a@example.edu" }), ctx()),
    ],
    ["GET application", () => getApplication(json("/api/hiring/applications/app-1", "GET"), ctx())],
    ["PATCH application", () => patchApplication(json("/api/hiring/applications/app-1", "PATCH", { reviewed: true }), ctx())],
    ["POST note", () => addNote(json("/api/hiring/applications/app-1/notes", "POST", { body: "Good" }), ctx())],
    ["POST invite", () => inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx())],
    ["GET document", () => readDocument(json("/api/hiring/documents/d1", "GET"), ctx("d1"))],
  ];

  for (const role of ["STAFF", "STUDENT", "COLLABORATOR"] as const) {
    for (const [label, call] of calls) {
      it(`${role} gets 403 on ${label}`, async () => {
        vi.mocked(requireAuth).mockResolvedValue(user(role) as never);
        const res = await call();
        expect(res.status).toBe(403);
        expect(createAuditEntry).not.toHaveBeenCalled();
        for (const model of Object.values(models)) {
          for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
        }
      });
    }
  }
});

describe("role preview", () => {
  it("an admin previewing as Staff loses hiring access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...user("STAFF"), preview: true } as never);
    const res = await listCycles(json("/api/hiring/cycles", "GET"), ctx());
    expect(res.status).toBe(403);
    expect(models.hiringCycle.findMany).not.toHaveBeenCalled();
  });
});

describe("cycle lifecycle", () => {
  it("stamps closedAt when a cycle is closed (retention clock input)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.hiringCycle.findUnique.mockResolvedValue({ id: "c1", status: "OPEN", closedAt: null });
    const res = await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "CLOSED" }), ctx("c1"));
    expect(res.status).toBe(200);
    const data = models.hiringCycle.update.mock.calls[0]![0].data;
    expect(data.status).toBe("CLOSED");
    expect(data.closedAt).toBeInstanceOf(Date);
  });
});

describe("application creation", () => {
  const body = { cycleId: CYCLE_ID, name: "Alex Sample", email: "Alex@Example.edu", gradTerm: "SPRING", gradYear: 2027 };

  it("returns a possible_match 409 instead of creating a silent duplicate", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    models.applicant.findMany.mockResolvedValue([
      { id: "p1", name: "Alex Sample", gradTerm: "SPRING", gradYear: 2027, emails: [{ email: "alex@example.edu" }] },
    ]);
    const res = await createApplication(json("/api/hiring/applications", "POST", body), ctx());
    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.code).toBe("possible_match");
    expect(payload.data.matches).toEqual([{ applicantId: "p1", name: "Alex Sample", reason: "email" }]);
    expect(models.applicant.create).not.toHaveBeenCalled();
    expect(models.application.create).not.toHaveBeenCalled();
  });

  it("creates the person and application, storing a normalized email, and audits without contact data", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    models.applicant.findMany.mockResolvedValue([]);
    models.applicant.create.mockResolvedValue({ id: "p2" });
    models.application.create.mockResolvedValue({ id: "app-9", cycleId: CYCLE_ID, applicantId: "p2", stage: "APPLIED" });

    const res = await createApplication(json("/api/hiring/applications", "POST", { ...body, phone: "‭(555) 010-0101‬" }), ctx());
    expect(res.status).toBe(201);

    const created = models.applicant.create.mock.calls[0]![0].data;
    expect(created.emails.create.email).toBe("alex@example.edu");
    expect(created.phone).toBe("5550100101");

    const audit = JSON.stringify(vi.mocked(createAuditEntry).mock.calls[0]![0]);
    expect(audit).not.toContain("alex@example.edu");
    expect(audit).not.toContain("5550100101");
  });
});

describe("returning applicant with a purged record", () => {
  it("refills the profile and restarts the retention clock when attached", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    models.applicant.findUnique.mockResolvedValue({ id: "t1", purgedAt: new Date("2029-01-01T00:00:00Z") });
    models.applicantEmail.findUnique.mockResolvedValue(null);
    models.application.create.mockResolvedValue({ id: "app-2", cycleId: CYCLE_ID, applicantId: "t1", stage: "APPLIED" });

    const res = await createApplication(
      json("/api/hiring/applications", "POST", {
        cycleId: CYCLE_ID,
        name: "Taylor Tombstone",
        email: "taylor@example.edu",
        gradTerm: "SPRING",
        gradYear: 2031,
        existingApplicantId: "clh0000000000000000000002",
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = models.applicant.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ gradTerm: "SPRING", gradYear: 2031, purgedAt: null });
    // The restored address must be primary: retention deleted every email.
    expect(models.applicantEmail.create).toHaveBeenCalledWith({ data: { applicantId: "clh0000000000000000000002", email: "taylor@example.edu", isPrimary: true } });
  });
});

beforeEach(() => {
  // Default: the applicant's record is live (not a retention tombstone).
  models.applicant.findUnique.mockResolvedValue({ purgedAt: null });
});

describe("stage changes", () => {
  it("records the decider and time on a decision, and audits only the transition", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicantId: "p1", stage: "ROUND_1", reviewed: true, applicant: { purgedAt: null } });

    const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { stage: "HIRE" }), ctx());
    expect(res.status).toBe(200);

    const data = models.application.update.mock.calls[0]![0].data;
    expect(data.stage).toBe("HIRE");
    expect(data.decidedById).toBe("ADMIN-1");
    expect(data.decidedAt).toBeInstanceOf(Date);

    const entry = vi.mocked(createAuditEntryTx).mock.calls[0]![1];
    expect(entry.action).toBe("stage_change");
    expect(entry.before).toMatchObject({ stage: "ROUND_1" });
    expect(entry.after).toMatchObject({ stage: "HIRE" });
  });

  it("clears the decision when an application moves back to an open stage", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicantId: "p1", stage: "PASSED", reviewed: true, applicant: { purgedAt: null } });
    await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { stage: "ROUND_1" }), ctx());
    const data = models.application.update.mock.calls[0]![0].data;
    expect(data.decidedAt).toBeNull();
    expect(data.decidedById).toBeNull();
  });

  it("rejects non-https interview links", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { interviewUrl: "http://example.com/x" }), ctx());
    expect(res.status).toBe(400);
  });
});

describe("notes", () => {
  it("does not copy note text into the audit trail", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicant: { purgedAt: null } });
    models.applicationNote.create.mockResolvedValue({ id: "n1", body: "Private opinion", rating: 4, createdAt: new Date(), author: null });
    const res = await addNote(json("/api/hiring/applications/app-1/notes", "POST", { body: "Private opinion", rating: 4 }), ctx());
    expect(res.status).toBe(201);
    expect(JSON.stringify(vi.mocked(createAuditEntryTx).mock.calls[0]![1])).not.toContain("Private opinion");
  });
});

describe("notes on retention tombstones", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it("rejects a note for a purged applicant, so new personal data is never created on a tombstone", async () => {
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicant: { purgedAt: new Date("2029-01-01T00:00:00Z") } });
    const res = await addNote(json("/api/hiring/applications/app-1/notes", "POST", { body: "Late note" }), ctx());
    expect(res.status).toBe(409);
    expect(models.applicationNote.create).not.toHaveBeenCalled();
  });

  it("re-checks the purge state inside the transaction", async () => {
    models.application.findUnique
      .mockResolvedValueOnce({ id: "app-1", applicant: { purgedAt: null } })
      .mockResolvedValueOnce({ applicant: { purgedAt: new Date("2029-01-01T00:00:00Z") } });
    const res = await addNote(json("/api/hiring/applications/app-1/notes", "POST", { body: "Racing note" }), ctx());
    expect(res.status).toBe(409);
    expect(models.applicationNote.create).not.toHaveBeenCalled();
  });
});

describe("document deletion", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));
  const doc = { id: "d1", applicationId: "app-1", pathname: "applicants/app-1/resume-d1.pdf", kind: "RESUME" };

  it("deletes the blob first, then the row and its audit entry in one transaction", async () => {
    models.applicantDocument.findUnique.mockResolvedValue(doc);
    const order: string[] = [];
    vi.mocked(deleteApplicantFile).mockImplementation(async () => void order.push("blob"));
    models.applicantDocument.delete.mockImplementation(async () => void order.push("row"));
    vi.mocked(createAuditEntryTx).mockImplementation(async () => void order.push("audit"));
    const res = await deleteDocument(json("/api/hiring/documents/d1", "DELETE"), ctx("d1"));
    expect(res.status).toBe(200);
    expect(order).toEqual(["blob", "row", "audit"]);
  });

  it("keeps the row when the audit fails, so a retry can finish (the blob is already gone)", async () => {
    models.applicantDocument.findUnique.mockResolvedValue(doc);
    vi.mocked(deleteApplicantFile).mockResolvedValue(undefined);
    models.applicantDocument.delete.mockResolvedValue({});
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(new Error("audit down"));
    const res = await deleteDocument(json("/api/hiring/documents/d1", "DELETE"), ctx("d1"));
    expect(res.status).toBe(500);
    // The mock transaction has no rollback, but the route did not report success.
    expect(createAuditEntry).not.toHaveBeenCalled();
  });
});

describe("cycle close dates", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it("creates a historical cycle already closed, with its real end date as the retention clock start", async () => {
    models.hiringCycle.create.mockResolvedValue({ id: "c9", label: "Spring 2025", status: "CLOSED" });
    const res = await createCycle(json("/api/hiring/cycles", "POST", { term: "SPRING", year: 2025, status: "CLOSED", closedOn: "2025-05-01" }), ctx());
    expect(res.status).toBe(201);
    const data = models.hiringCycle.create.mock.calls[0]![0].data;
    expect(data.status).toBe("CLOSED");
    expect((data.closedAt as Date).toISOString()).toBe("2025-05-01T12:00:00.000Z");
  });

  it("defaults the close time to now when no date is given", async () => {
    models.hiringCycle.create.mockResolvedValue({ id: "c9", label: "Spring 2025", status: "CLOSED" });
    await createCycle(json("/api/hiring/cycles", "POST", { term: "SPRING", year: 2025, status: "CLOSED" }), ctx());
    expect(models.hiringCycle.create.mock.calls[0]![0].data.closedAt).toBeInstanceOf(Date);
  });

  it("does not stamp a close time on an open cycle, and rejects a close date without a closed status", async () => {
    models.hiringCycle.create.mockResolvedValue({ id: "c9", label: "Fall 2026", status: "OPEN" });
    await createCycle(json("/api/hiring/cycles", "POST", { term: "FALL", year: 2026 }), ctx());
    expect(models.hiringCycle.create.mock.calls[0]![0].data.closedAt).toBeNull();
    const bad = await createCycle(json("/api/hiring/cycles", "POST", { term: "FALL", year: 2026, closedOn: "2026-01-01" }), ctx());
    expect(bad.status).toBe(400);
  });

  it("rejects future and malformed close dates", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await createCycle(json("/api/hiring/cycles", "POST", { term: "SPRING", year: 2025, status: "CLOSED", closedOn: future }), ctx())).status).toBe(400);
    expect((await createCycle(json("/api/hiring/cycles", "POST", { term: "SPRING", year: 2025, status: "CLOSED", closedOn: "05/01/2025" }), ctx())).status).toBe(400);
  });

  it("closes an existing cycle on its real end date, and can correct a late close time", async () => {
    models.hiringCycle.findUnique.mockResolvedValue({ id: "c1", status: "OPEN", closedAt: null });
    await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "CLOSED", closedOn: "2025-05-01" }), ctx("c1"));
    expect((models.hiringCycle.update.mock.calls[0]![0].data.closedAt as Date).toISOString()).toBe("2025-05-01T12:00:00.000Z");

    models.hiringCycle.findUnique.mockResolvedValue({ id: "c1", status: "CLOSED", closedAt: new Date("2026-09-30T00:00:00Z") });
    await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "CLOSED", closedOn: "2025-05-01" }), ctx("c1"));
    expect((models.hiringCycle.update.mock.calls[1]![0].data.closedAt as Date).toISOString()).toBe("2025-05-01T12:00:00.000Z");
  });

  it("rejects a close date on a status that is not closed or archived", async () => {
    const res = await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "OPEN", closedOn: "2025-05-01" }), ctx("c1"));
    expect(res.status).toBe(400);
  });
});

describe("hire invite (staged conversion)", () => {
  const hireApplication = (overrides: Record<string, unknown> = {}) => ({
    id: "app-1",
    stage: "HIRE",
    primaryArea: "VIDEO",
    rawAreas: [],
    allowedEmail: null,
    applicant: {
      id: "p1",
      name: "Alex Sample",
      hiredUserId: null,
      emails: [{ email: "alex@example.edu", isPrimary: true }],
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
  });

  it("refuses to invite before the applicant is marked Hire", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication({ stage: "ROUND_1" }));
    const res = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(res.status).toBe(409);
    expect(createAllowedEmailInvite).not.toHaveBeenCalled();
  });

  it("stages a student invite prefilled from the applicant and records the link", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication());
    models.user.findFirst.mockResolvedValue(null);
    models.user.findMany.mockResolvedValue([]);
    models.allowedEmail.create.mockResolvedValue({ id: "invite-1" });

    const res = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(res.status).toBe(201);
    // Created inside the transaction (not through the shared helper), prefilled from the applicant.
    expect(models.allowedEmail.create.mock.calls[0]![0].data).toEqual({
      email: "alex@example.edu",
      role: "STUDENT",
      preloadedName: "Alex Sample",
      preloadedPrimaryArea: "VIDEO",
      preloadedAreas: ["VIDEO"],
      createdById: "ADMIN-1",
    });
    expect(createAllowedEmailInvite).not.toHaveBeenCalled();
    expect(models.application.update).toHaveBeenCalledWith({ where: { id: "app-1" }, data: { allowedEmailId: "invite-1" } });
    // Both audit entries are transactional and carry no email or name.
    const audits = vi.mocked(createAuditEntryTx).mock.calls.map((c) => c[1]);
    expect(audits.map((a) => `${a.entityType}:${a.action}`)).toEqual(["allowed_email:created", "hiring_application:hire_invited"]);
    expect(JSON.stringify(audits)).not.toContain("alex@example.edu");
    expect(JSON.stringify(audits)).not.toContain("Alex Sample");
  });

  it("asks before linking when an account already exists, then links only on confirm", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication());
    models.user.findFirst.mockResolvedValue({ id: "u9", name: "Alex Sample" });

    const first = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(first.status).toBe(409);
    expect((await first.json()).code).toBe("user_exists");
    expect(models.applicant.update).not.toHaveBeenCalled();

    const second = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", { linkExistingUser: true }), ctx());
    expect(second.status).toBe(200);
    expect(models.applicant.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { hiredUserId: "u9" } });
    expect(createAllowedEmailInvite).not.toHaveBeenCalled();
  });

  it("does not leave a live invite when the Hire was undone while the invite was being created", async () => {
    models.application.findUnique
      .mockResolvedValueOnce(hireApplication()) // initial read: still Hire
      .mockResolvedValueOnce({ stage: "PASSED", allowedEmailId: null }); // re-read inside the transaction
    models.user.findFirst.mockResolvedValue(null);
    models.user.findMany.mockResolvedValue([]);

    const res = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(res.status).toBe(409);
    // The invite is created inside the same transaction, so nothing is created or left to clean up.
    expect(models.allowedEmail.create).not.toHaveBeenCalled();
    expect(models.application.update).not.toHaveBeenCalled();
    expect(models.allowedEmail.delete).not.toHaveBeenCalled();
  });

  it("attaches the invite under serializable isolation", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication());
    models.user.findFirst.mockResolvedValue(null);
    models.user.findMany.mockResolvedValue([]);
    models.allowedEmail.create.mockResolvedValue({ id: "invite-ok" });
    await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(db.$transaction.mock.calls.some((c: unknown[]) => (c[1] as { isolationLevel?: string } | undefined)?.isolationLevel === "Serializable")).toBe(true);
  });

  it("invites the newest address by default, and any known address on request", async () => {
    models.application.findUnique.mockResolvedValue({
      ...hireApplication(),
      applicant: {
        id: "p1",
        name: "Alex Sample",
        hiredUserId: null,
        emails: [
          { email: "alex.new@example.edu", isPrimary: false },
          { email: "alex@example.edu", isPrimary: true },
        ],
      },
    });
    models.user.findFirst.mockResolvedValue(null);
    models.user.findMany.mockResolvedValue([]);
    models.allowedEmail.create.mockResolvedValue({ id: "invite-1" });

    await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(models.allowedEmail.create.mock.calls[0]![0].data.email).toBe("alex.new@example.edu");

    await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", { email: "alex@example.edu" }), ctx());
    expect(models.allowedEmail.create.mock.calls[1]![0].data.email).toBe("alex@example.edu");
  });

  it("rejects an email that is not one of the applicant's", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication());
    const res = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", { email: "stranger@example.com" }), ctx());
    expect(res.status).toBe(400);
  });

  it("will not create a second invite for the same application", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication({ allowedEmail: { id: "invite-1" } }));
    const res = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(res.status).toBe(409);
  });
});

describe("hire invite identity checks", () => {
  const hireApplication = () => ({
    id: "app-1",
    stage: "HIRE",
    primaryArea: "VIDEO",
    rawAreas: [],
    allowedEmail: null,
    applicant: { id: "p1", name: "Alex Sample", hiredUserId: null, emails: [{ email: "alex@example.edu", isPrimary: true }] },
  });
  const post = (body: unknown) => inviteHire(json("/api/hiring/applications/app-1/invite", "POST", body), ctx());

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue(hireApplication());
    models.user.findFirst.mockResolvedValue(null);
    models.user.findMany.mockResolvedValue([]);
  });

  it("looks for an existing account by campus email or athletics email", async () => {
    await post({});
    expect(models.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ email: "alex@example.edu" }, { athleticsEmail: "alex@example.edu" }] } }),
    );
  });

  it("asks before issuing an invite when a same-name account exists under another email", async () => {
    models.user.findMany.mockResolvedValue([{ id: "u7", name: "Alex Sample" }]);
    const res = await post({});
    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.code).toBe("possible_account");
    expect(payload.data.users).toEqual([{ id: "u7", name: "Alex Sample" }]);
    expect(createAllowedEmailInvite).not.toHaveBeenCalled();
  });

  it("links to a confirmed same-name account, and refuses an account that is not a name match", async () => {
    models.user.findMany.mockResolvedValue([{ id: "u7", name: "Alex Sample" }]);
    const refused = await post({ linkUserId: "clh0000000000000000000007" });
    expect(refused.status).toBe(400);

    models.user.findMany.mockResolvedValue([{ id: "clh0000000000000000000007", name: "Alex Sample" }]);
    const linked = await post({ linkUserId: "clh0000000000000000000007" });
    expect(linked.status).toBe(200);
    expect(models.applicant.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { hiredUserId: "clh0000000000000000000007" } });
    expect(createAllowedEmailInvite).not.toHaveBeenCalled();
  });

  it("issues the invite when the admin confirms a separate account", async () => {
    models.user.findMany.mockResolvedValue([{ id: "u7", name: "Alex Sample" }]);
    models.allowedEmail.create.mockResolvedValue({ id: "invite-9" });
    const res = await post({ confirmNewAccount: true });
    expect(res.status).toBe(201);
    expect(models.allowedEmail.create).toHaveBeenCalled();
  });
});

describe("cycle archive and attach ids", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it("stamps the retention clock when a cycle is archived straight from Open", async () => {
    models.hiringCycle.findUnique.mockResolvedValue({ id: "c1", status: "OPEN", closedAt: null });
    await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "ARCHIVED" }), ctx("c1"));
    expect(models.hiringCycle.update.mock.calls[0]![0].data.closedAt).toBeInstanceOf(Date);
  });

  it("keeps the original close time when a closed cycle is archived, and clears it on reopen", async () => {
    models.hiringCycle.findUnique.mockResolvedValue({ id: "c1", status: "CLOSED", closedAt: new Date("2026-05-01T00:00:00Z") });
    await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "ARCHIVED" }), ctx("c1"));
    expect(models.hiringCycle.update.mock.calls[0]![0].data.closedAt).toBeUndefined();
    await patchCycle(json("/api/hiring/cycles/c1", "PATCH", { status: "OPEN" }), ctx("c1"));
    expect(models.hiringCycle.update.mock.calls[1]![0].data.closedAt).toBeNull();
  });

  it("accepts an importer-created (UUID) applicant id when attaching a returning application", async () => {
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    models.applicant.findUnique.mockResolvedValue({ id: "5f1b7a52-1c53-4f6e-9a0e-3b3c1a9d1e11", purgedAt: null });
    models.applicantEmail.findUnique.mockResolvedValue({ applicantId: "5f1b7a52-1c53-4f6e-9a0e-3b3c1a9d1e11" });
    models.application.create.mockResolvedValue({ id: "app-3", cycleId: CYCLE_ID, applicantId: "5f1b7a52-1c53-4f6e-9a0e-3b3c1a9d1e11", stage: "APPLIED" });
    const res = await createApplication(
      json("/api/hiring/applications", "POST", {
        cycleId: CYCLE_ID,
        name: "Imported Person",
        email: "imported@example.edu",
        existingApplicantId: "5f1b7a52-1c53-4f6e-9a0e-3b3c1a9d1e11",
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
  });
});

describe("document uploads", () => {
  const png = () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], "scan.png", { type: "image/png" }));
    form.set("kind", "OTHER");
    return new Request("https://app.example.com/api/hiring/applications/app-1/documents", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com" },
      body: form,
    });
  };

  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it("rejects uploads for an applicant whose data was purged, before storing anything", async () => {
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicant: { purgedAt: new Date("2029-01-01T00:00:00Z") } });
    const res = await uploadDocument(png(), ctx());
    expect(res.status).toBe(409);
    expect(putApplicantFile).not.toHaveBeenCalled();
    expect(models.applicantDocument.create).not.toHaveBeenCalled();
  });

  it("re-checks the purge state inside the transaction and removes the stored file when it loses a race", async () => {
    models.application.findUnique
      .mockResolvedValueOnce({ id: "app-1", applicant: { purgedAt: null } })
      .mockResolvedValueOnce({ applicant: { purgedAt: new Date("2029-01-01T00:00:00Z") } });
    const res = await uploadDocument(png(), ctx());
    expect(res.status).toBe(409);
    expect(models.applicantDocument.create).not.toHaveBeenCalled();
    expect(deleteApplicantFile).toHaveBeenCalledTimes(1);
  });

  it("writes the document row and its audit entry in one serializable transaction", async () => {
    models.application.findUnique
      .mockResolvedValueOnce({ id: "app-1", applicant: { purgedAt: null } })
      .mockResolvedValueOnce({ applicant: { purgedAt: null } });
    models.applicantDocument.create.mockResolvedValue({ id: "d1", kind: "OTHER", fileName: "scan.png", contentType: "image/png", sizeBytes: 10, createdAt: new Date() });
    const res = await uploadDocument(png(), ctx());
    expect(res.status).toBe(201);
    expect(createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "document_add" }));
    expect(deleteApplicantFile).not.toHaveBeenCalled();
  });

  it("cleans up the stored file when the audit write fails, so no orphan row or file remains", async () => {
    models.application.findUnique
      .mockResolvedValueOnce({ id: "app-1", applicant: { purgedAt: null } })
      .mockResolvedValueOnce({ applicant: { purgedAt: null } });
    models.applicantDocument.create.mockResolvedValue({ id: "d1", kind: "OTHER", fileName: "scan.png", contentType: "image/png", sizeBytes: 10, createdAt: new Date() });
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(new Error("audit down"));
    const res = await uploadDocument(png(), ctx());
    expect(res.status).toBe(500);
    expect(deleteApplicantFile).toHaveBeenCalledTimes(1);
  });
});

describe("undoing a Hire", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));
  const hired = { id: "app-1", applicantId: "p1", stage: "HIRE", reviewed: true, allowedEmailId: "invite-1", applicant: { purgedAt: null } };

  it("revokes an unclaimed invite in the same transaction", async () => {
    models.application.findUnique.mockResolvedValue(hired);
    models.allowedEmail.findUnique.mockResolvedValue({ id: "invite-1", claimedAt: null });
    const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { stage: "PASSED" }), ctx());
    expect(res.status).toBe(200);
    expect(models.allowedEmail.delete).toHaveBeenCalledWith({ where: { id: "invite-1" } });
    expect(vi.mocked(createAuditEntryTx).mock.calls[0]![1].after).toMatchObject({ invitationRevoked: true });
  });

  it("refuses to undo a Hire whose invite was already claimed", async () => {
    models.application.findUnique.mockResolvedValue(hired);
    models.allowedEmail.findUnique.mockResolvedValue({ id: "invite-1", claimedAt: new Date() });
    const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { stage: "ROUND_1" }), ctx());
    expect(res.status).toBe(409);
    expect(models.allowedEmail.delete).not.toHaveBeenCalled();
    expect(models.application.update).not.toHaveBeenCalled();
  });

  it("leaves invites alone when the stage is not leaving Hire", async () => {
    models.application.findUnique.mockResolvedValue({ ...hired, stage: "ROUND_1", allowedEmailId: null });
    await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { reviewed: true }), ctx());
    expect(models.allowedEmail.delete).not.toHaveBeenCalled();
  });
});

describe("tombstones are read-only", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));
  const tombstone = { id: "app-1", applicantId: "p1", stage: "PASSED", reviewed: true, allowedEmailId: null, applicant: { purgedAt: new Date("2029-01-01T00:00:00Z") } };

  it("rejects personal-data edits on a purged applicant's application", async () => {
    models.application.findUnique.mockResolvedValue(tombstone);
    for (const body of [{ interviewUrl: "https://example.com/i" }, { rawAreas: ["Video"] }, { portfolioUrl: "https://example.com/p" }, { gradYear: 2030 }, { reviewed: false }]) {
      const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", body), ctx());
      expect(res.status).toBe(409);
    }
    expect(models.application.update).not.toHaveBeenCalled();
    expect(models.applicant.update).not.toHaveBeenCalled();
  });

  it("re-checks inside the transaction when a purge committed after the first read", async () => {
    models.application.findUnique.mockResolvedValue({ ...tombstone, applicant: { purgedAt: null } });
    models.applicant.findUnique.mockResolvedValue({ purgedAt: new Date("2029-01-01T00:00:00Z") });
    const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { portfolioUrl: "https://example.com/p" }), ctx());
    expect(res.status).toBe(409);
    expect(models.application.update).not.toHaveBeenCalled();
  });
});

describe("close dates must be real calendar dates", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it.each(["2025-02-31", "2025-04-31", "2025-13-01", "2025-00-10", "2023-02-29"])("rejects %s", async (closedOn) => {
    const res = await createCycle(json("/api/hiring/cycles", "POST", { term: "SPRING", year: 2025, status: "CLOSED", closedOn }), ctx());
    expect(res.status).toBe(400);
    expect(models.hiringCycle.create).not.toHaveBeenCalled();
  });

  it("accepts a real leap day", async () => {
    models.hiringCycle.create.mockResolvedValue({ id: "c9", label: "Spring 2024", status: "CLOSED" });
    const res = await createCycle(json("/api/hiring/cycles", "POST", { term: "SPRING", year: 2024, status: "CLOSED", closedOn: "2024-02-29" }), ctx());
    expect(res.status).toBe(201);
  });
});

describe("repeat applicant details", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.hiringCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    models.applicantEmail.findUnique.mockResolvedValue({ applicantId: "clh0000000000000000000002" });
    models.application.create.mockResolvedValue({ id: "app-4", cycleId: CYCLE_ID, applicantId: "clh0000000000000000000002", stage: "APPLIED" });
  });
  const attach = (extra: Record<string, unknown>) =>
    createApplication(
      json("/api/hiring/applications", "POST", {
        cycleId: CYCLE_ID,
        name: "Alex Sample",
        email: "alex@example.edu",
        existingApplicantId: "clh0000000000000000000002",
        ...extra,
      }),
      ctx(),
    );

  it("applies newer submitted details to a live applicant, and never blanks what is on file", async () => {
    models.applicant.findUnique.mockResolvedValue({ id: "clh0000000000000000000002", purgedAt: null });
    const res = await attach({ phone: "(555) 010-0102", standing: "SENIOR", gradTerm: "SPRING", gradYear: 2027, portfolioUrl: "https://example.com/new" });
    expect(res.status).toBe(201);
    const data = models.applicant.update.mock.calls[0]![0].data;
    expect(data).toEqual({ phone: "5550100102", standing: "SENIOR", gradTerm: "SPRING", gradYear: 2027, portfolioUrl: "https://example.com/new" });
    // Fields that were not submitted are absent, so they are left untouched rather than set to null.
    expect(data).not.toHaveProperty("location");
    expect(data).not.toHaveProperty("socialHandles");
    expect(data).not.toHaveProperty("purgedAt");
  });

  it("does not write when nothing new was submitted", async () => {
    models.applicant.findUnique.mockResolvedValue({ id: "clh0000000000000000000002", purgedAt: null });
    await attach({});
    expect(models.applicant.update).not.toHaveBeenCalled();
  });
});

describe("hire invite: existing accounts, pending invites, and areas", () => {
  const app = (overrides: Record<string, unknown> = {}) => ({
    id: "app-1",
    stage: "HIRE",
    primaryArea: "VIDEO",
    rawAreas: ["Video", "Photography", "Marketing"],
    allowedEmail: null,
    applicant: { id: "p1", name: "Alex Sample", hiredUserId: null, emails: [{ email: "alex@example.edu", isPrimary: true }] },
    ...overrides,
  });
  const post = (body: unknown = {}) => inviteHire(json("/api/hiring/applications/app-1/invite", "POST", body), ctx());

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue(app());
    models.user.findFirst.mockResolvedValue(null);
    models.user.findMany.mockResolvedValue([]);
    models.allowedEmail.findUnique.mockResolvedValue(null);
    models.allowedEmail.create.mockResolvedValue({ id: "invite-new" });
  });

  it("preloads every recognized area (primary first, deduplicated), and not unmapped labels", async () => {
    await post();
    const data = models.allowedEmail.create.mock.calls[0]![0].data;
    expect(data.preloadedPrimaryArea).toBe("VIDEO");
    expect(data.preloadedAreas).toEqual(["VIDEO", "PHOTO"]);
  });

  it("uses recognized raw areas even when no primary area was mapped", async () => {
    models.application.findUnique.mockResolvedValue(app({ primaryArea: null, rawAreas: ["Photography", "Design"] }));
    await post();
    const data = models.allowedEmail.create.mock.calls[0]![0].data;
    expect(data.preloadedAreas).toEqual(["PHOTO", "GRAPHICS"]);
    expect(data.preloadedPrimaryArea).toBe("PHOTO");
  });

  it("adopts a pending ordinary student invite for the address instead of failing on the unique email", async () => {
    models.allowedEmail.findUnique.mockResolvedValue({ id: "generic-invite", role: "STUDENT", claimedAt: null, applications: [] });
    const res = await post();
    expect(res.status).toBe(201);
    expect(models.allowedEmail.create).not.toHaveBeenCalled();
    expect(models.allowedEmail.update).toHaveBeenCalledWith({
      where: { id: "generic-invite" },
      data: expect.objectContaining({ preloadedName: "Alex Sample", preloadedAreas: ["VIDEO", "PHOTO"] }),
    });
    expect(models.application.update).toHaveBeenCalledWith({ where: { id: "app-1" }, data: { allowedEmailId: "generic-invite" } });
    expect(vi.mocked(createAuditEntryTx).mock.calls[0]![1].action).toBe("adopted_for_hire");
  });

  it.each([
    ["already claimed", { id: "x", role: "STUDENT", claimedAt: new Date(), applications: [] }],
    ["a staff invitation", { id: "x", role: "STAFF", claimedAt: null, applications: [] }],
    ["invited for another application", { id: "x", role: "STUDENT", claimedAt: null, applications: [{ id: "other-app" }] }],
  ])("refuses to adopt an invite that is %s", async (_label, pending) => {
    models.allowedEmail.findUnique.mockResolvedValue(pending);
    const res = await post();
    expect(res.status).toBe(409);
    expect(models.application.update).not.toHaveBeenCalled();
    expect(models.allowedEmail.update).not.toHaveBeenCalled();
  });

  it("links an existing account only while the application is still Hire, with its audit in the same transaction", async () => {
    models.user.findFirst.mockResolvedValue({ id: "u9", name: "Alex Sample" });
    const linked = await post({ linkExistingUser: true });
    expect(linked.status).toBe(200);
    expect(models.applicant.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { hiredUserId: "u9" } });
    expect(vi.mocked(createAuditEntryTx).mock.calls.at(-1)![1].action).toBe("hire_linked_existing");
    expect(createAuditEntry).not.toHaveBeenCalled();
    expect(db.$transaction.mock.calls.at(-1)![1]).toMatchObject({ isolationLevel: "Serializable" });
  });

  it("does not link when the Hire was undone before the link transaction ran", async () => {
    models.user.findFirst.mockResolvedValue({ id: "u9", name: "Alex Sample" });
    models.application.findUnique
      .mockResolvedValueOnce(app()) // initial read
      .mockResolvedValueOnce({ stage: "PASSED", applicant: { hiredUserId: null } }); // inside the transaction
    const res = await post({ linkExistingUser: true });
    expect(res.status).toBe(409);
    expect(models.applicant.update).not.toHaveBeenCalled();
  });

  it("does not link a same-name account for a passed applicant either", async () => {
    models.user.findMany.mockResolvedValue([{ id: "clh0000000000000000000007", name: "Alex Sample" }]);
    models.application.findUnique
      .mockResolvedValueOnce(app())
      .mockResolvedValueOnce({ stage: "WITHDRAWN", applicant: { hiredUserId: null } });
    const res = await post({ linkUserId: "clh0000000000000000000007" });
    expect(res.status).toBe(409);
    expect(models.applicant.update).not.toHaveBeenCalled();
  });
});
