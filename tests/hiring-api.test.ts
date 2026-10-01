import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "./_helpers/mock-db";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
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
  user: { findUnique: vi.fn() },
  applicantEmail: { findUnique: vi.fn(), create: vi.fn() },
  applicantDocument: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  applicationNote: { create: vi.fn() },
};
const { db } = createMockDb(models);
vi.mock("@/lib/db", () => ({ get db() { return db; } }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { GET as listCycles, POST as createCycle } from "@/app/api/hiring/cycles/route";
import { PATCH as patchCycle } from "@/app/api/hiring/cycles/[id]/route";
import { GET as listApplications, POST as createApplication } from "@/app/api/hiring/applications/route";
import { GET as getApplication, PATCH as patchApplication } from "@/app/api/hiring/applications/[id]/route";
import { POST as addNote } from "@/app/api/hiring/applications/[id]/notes/route";
import { GET as readDocument } from "@/app/api/hiring/documents/[id]/route";
import { POST as inviteHire } from "@/app/api/hiring/applications/[id]/invite/route";
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
    expect(models.applicantEmail.create).toHaveBeenCalledWith({ data: { applicantId: "clh0000000000000000000002", email: "taylor@example.edu" } });
  });
});

describe("stage changes", () => {
  it("records the decider and time on a decision, and audits only the transition", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicantId: "p1", stage: "ROUND_1", reviewed: true });

    const res = await patchApplication(json("/api/hiring/applications/app-1", "PATCH", { stage: "HIRE" }), ctx());
    expect(res.status).toBe(200);

    const data = models.application.update.mock.calls[0]![0].data;
    expect(data.stage).toBe("HIRE");
    expect(data.decidedById).toBe("ADMIN-1");
    expect(data.decidedAt).toBeInstanceOf(Date);

    const entry = vi.mocked(createAuditEntry).mock.calls[0]![0];
    expect(entry.action).toBe("stage_change");
    expect(entry.before).toMatchObject({ stage: "ROUND_1" });
    expect(entry.after).toMatchObject({ stage: "HIRE" });
  });

  it("clears the decision when an application moves back to an open stage", async () => {
    vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
    models.application.findUnique.mockResolvedValue({ id: "app-1", applicantId: "p1", stage: "PASSED", reviewed: true });
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
    models.application.findUnique.mockResolvedValue({ id: "app-1" });
    models.applicationNote.create.mockResolvedValue({ id: "n1", body: "Private opinion", rating: 4, createdAt: new Date(), author: null });
    const res = await addNote(json("/api/hiring/applications/app-1/notes", "POST", { body: "Private opinion", rating: 4 }), ctx());
    expect(res.status).toBe(201);
    expect(JSON.stringify(vi.mocked(createAuditEntry).mock.calls[0]![0])).not.toContain("Private opinion");
  });
});

describe("hire invite (staged conversion)", () => {
  const hireApplication = (overrides: Record<string, unknown> = {}) => ({
    id: "app-1",
    stage: "HIRE",
    primaryArea: "VIDEO",
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
    models.user.findUnique.mockResolvedValue(null);
    vi.mocked(createAllowedEmailInvite).mockResolvedValue({ skipped: false, entry: { id: "invite-1" } } as never);

    const res = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(res.status).toBe(201);
    expect(createAllowedEmailInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alex@example.edu",
        role: "STUDENT",
        preloadedName: "Alex Sample",
        preloadedPrimaryArea: "VIDEO",
        preloadedAreas: ["VIDEO"],
      }),
    );
    expect(models.application.update).toHaveBeenCalledWith({ where: { id: "app-1" }, data: { allowedEmailId: "invite-1" } });
    expect(JSON.stringify(vi.mocked(createAuditEntry).mock.calls[0]![0])).not.toContain("alex@example.edu");
  });

  it("asks before linking when an account already exists, then links only on confirm", async () => {
    models.application.findUnique.mockResolvedValue(hireApplication());
    models.user.findUnique.mockResolvedValue({ id: "u9", name: "Alex Sample" });

    const first = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", {}), ctx());
    expect(first.status).toBe(409);
    expect((await first.json()).code).toBe("user_exists");
    expect(models.applicant.update).not.toHaveBeenCalled();

    const second = await inviteHire(json("/api/hiring/applications/app-1/invite", "POST", { linkExistingUser: true }), ctx());
    expect(second.status).toBe(200);
    expect(models.applicant.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { hiredUserId: "u9" } });
    expect(createAllowedEmailInvite).not.toHaveBeenCalled();
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
