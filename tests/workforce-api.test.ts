import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 100, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const models = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  studentTermPlacement: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
};
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({ get db() { return { ...models, $transaction: transaction }; } }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntryTx } from "@/lib/audit";
import { GET as getPerson, PATCH as patchPerson } from "@/app/api/workforce/people/[id]/route";
import { DELETE as deletePlacement, POST as upsertPlacement } from "@/app/api/workforce/people/[id]/placements/route";
import { compareTerms, startTermSchema, upsertPlacementSchema } from "@/lib/workforce/contract";

const user = (role: "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR") => ({
  id: `${role}-1`,
  email: `${role}@example.test`,
  name: role,
  role,
  avatarUrl: null,
  forcePasswordChange: false,
});

const req = (url: string, method: string, body?: unknown) =>
  new Request(`https://app.example.com${url}`, {
    method,
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "u1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  transaction.mockImplementation(async (callback) => callback(models));
});

describe("workforce routes are ADMIN-only", () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ["GET person", () => getPerson(req("/api/workforce/people/u1", "GET"), ctx)],
    ["PATCH start term", () => patchPerson(req("/api/workforce/people/u1", "PATCH", { startTerm: "FALL", startTermYear: 2025 }), ctx)],
    ["POST placement", () => upsertPlacement(req("/api/workforce/people/u1/placements", "POST", { term: "FALL", year: 2025 }), ctx)],
    ["DELETE placement", () => deletePlacement(req("/api/workforce/people/u1/placements?placementId=p1", "DELETE"), ctx)],
  ];

  for (const role of ["STAFF", "STUDENT", "COLLABORATOR"] as const) {
    for (const [label, call] of calls) {
      it(`${role} gets 403 on ${label}`, async () => {
        vi.mocked(requireAuth).mockResolvedValue(user(role) as never);
        expect((await call()).status).toBe(403);
        expect(createAuditEntryTx).not.toHaveBeenCalled();
        for (const model of Object.values(models)) for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
      });
    }
  }
});

describe("start term", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it("saves a start term and audits the change", async () => {
    models.user.findUnique.mockResolvedValue({ id: "u1", staffingType: "ST", startTerm: null, startTermYear: null });
    const res = await patchPerson(req("/api/workforce/people/u1", "PATCH", { startTerm: "FALL", startTermYear: 2025 }), ctx);
    expect(res.status).toBe(200);
    expect(models.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { startTerm: "FALL", startTermYear: 2025 } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(models, expect.objectContaining({ action: "start_term_update" }));
  });

  it("rejects a term without a year", async () => {
    const res = await patchPerson(req("/api/workforce/people/u1", "PATCH", { startTerm: "FALL", startTermYear: null }), ctx);
    expect(res.status).toBe(400);
    expect(models.user.update).not.toHaveBeenCalled();
  });

  it("clears both fields together", () => {
    expect(startTermSchema.safeParse({ startTerm: null, startTermYear: null }).success).toBe(true);
  });
});

describe("term placements", () => {
  beforeEach(() => vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never));

  it("upserts one placement per person and term with normalized sport codes", async () => {
    models.user.findUnique.mockResolvedValue({ id: "u1", staffingType: "ST" });
    models.studentTermPlacement.upsert.mockResolvedValue({ id: "p1", term: "WINTER", year: 2026, area: "VIDEO", sportCodes: ["WHKY"], notes: null });
    const res = await upsertPlacement(
      req("/api/workforce/people/u1/placements", "POST", { term: "WINTER", year: 2026, area: "VIDEO", sportCodes: ["whky", "WHKY"] }),
      ctx,
    );
    expect(res.status).toBe(201);
    const args = models.studentTermPlacement.upsert.mock.calls[0]![0];
    expect(args.where).toEqual({ userId_term_year: { userId: "u1", term: "WINTER", year: 2026 } });
    expect(args.create.sportCodes).toEqual(["WHKY"]);
  });

  it("rejects placements and start terms for full-time staff", async () => {
    models.user.findUnique.mockResolvedValue({ id: "u1", staffingType: "FT", startTerm: null, startTermYear: null });
    const placement = await upsertPlacement(req("/api/workforce/people/u1/placements", "POST", { term: "FALL", year: 2025 }), ctx);
    expect(placement.status).toBe(400);
    expect(models.studentTermPlacement.upsert).not.toHaveBeenCalled();
    const start = await patchPerson(req("/api/workforce/people/u1", "PATCH", { startTerm: "FALL", startTermYear: 2025 }), ctx);
    expect(start.status).toBe(400);
    expect(models.user.update).not.toHaveBeenCalled();
  });

  it("rejects unknown sport codes", async () => {
    const res = await upsertPlacement(req("/api/workforce/people/u1/placements", "POST", { term: "FALL", year: 2025, sportCodes: ["NOPE"] }), ctx);
    expect(res.status).toBe(400);
    expect(models.studentTermPlacement.upsert).not.toHaveBeenCalled();
  });

  it("will not delete another person's placement", async () => {
    models.studentTermPlacement.findUnique.mockResolvedValue({ id: "p1", userId: "someone-else", term: "FALL", year: 2025 });
    const res = await deletePlacement(req("/api/workforce/people/u1/placements?placementId=p1", "DELETE"), ctx);
    expect(res.status).toBe(404);
    expect(models.studentTermPlacement.delete).not.toHaveBeenCalled();
  });

  it("deletes and audits a placement that belongs to the person", async () => {
    models.studentTermPlacement.findUnique.mockResolvedValue({ id: "p1", userId: "u1", term: "FALL", year: 2025 });
    const res = await deletePlacement(req("/api/workforce/people/u1/placements?placementId=p1", "DELETE"), ctx);
    expect(res.status).toBe(200);
    expect(models.studentTermPlacement.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(models, expect.objectContaining({ action: "delete" }));
  });
});

describe("atomic workforce audit", () => {
  // Audit failure must reject the transaction callback rather than happen after commit.
  // Prisma owns rollback; this route test verifies the audit shares that boundary.
  for (const [label, call] of [
    ["start term", () => patchPerson(req("/api/workforce/people/u1", "PATCH", { startTerm: "FALL", startTermYear: 2025 }), ctx)],
    ["placement save", () => upsertPlacement(req("/api/workforce/people/u1/placements", "POST", { term: "FALL", year: 2025 }), ctx)],
    ["placement removal", () => deletePlacement(req("/api/workforce/people/u1/placements?placementId=p1", "DELETE"), ctx)],
  ] as const) {
    it(`${label} cannot commit when its audit fails`, async () => {
      vi.mocked(requireAuth).mockResolvedValue(user("ADMIN") as never);
      models.user.findUnique.mockResolvedValue({ id: "u1", staffingType: "ST", startTerm: null, startTermYear: null });
      models.studentTermPlacement.findUnique.mockResolvedValue({ id: "p1", userId: "u1", term: "FALL", year: 2025, area: "VIDEO", sportCodes: [], notes: null });
      models.studentTermPlacement.upsert.mockResolvedValue({ id: "p1", term: "FALL", year: 2025, area: null, sportCodes: [], notes: null });
      vi.mocked(createAuditEntryTx).mockRejectedValue(new Error("Audit unavailable"));
      let committed = false;
      transaction.mockImplementation(async (callback) => {
        const result = await callback(models);
        committed = true;
        return result;
      });
      expect((await call()).status).toBe(500);
      expect(transaction).toHaveBeenCalledOnce();
      expect(committed).toBe(false);
    });
  }
});

describe("term ordering", () => {
  it("orders terms chronologically within and across calendar years", () => {
    const terms = [
      { term: "SPRING" as const, year: 2026 },
      { term: "FALL" as const, year: 2025 },
      { term: "WINTER" as const, year: 2026 },
      { term: "FALL" as const, year: 2026 },
    ];
    expect([...terms].sort(compareTerms).map((t) => `${t.term}${t.year}`)).toEqual(["FALL2025", "WINTER2026", "SPRING2026", "FALL2026"]);
  });

  it("accepts a placement with no area or sports", () => {
    expect(upsertPlacementSchema.safeParse({ term: "FALL", year: 2025 }).success).toBe(true);
  });
});
